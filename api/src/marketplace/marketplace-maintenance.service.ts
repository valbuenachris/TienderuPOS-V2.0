import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService, SqlExecutor } from '../database/database.service';
import { computeParentOrderStatus } from './marketplace-order-status';
import { MarketplaceSettingsService } from './marketplace-settings.service';

const EXPIRY_INTERVAL_MS = 5 * 60 * 1000;
const EXPIRY_BATCH_LIMIT = 50;

/**
 * Ciclo de vida de pedidos del marketplace (v0.11.0):
 * - Job cada 5 min que expira pedidos impagos (TTL configurable) reponiendo stock
 *   y eliminando la venta POS vinculada (nunca se pagó: no debe quedar como deuda).
 * - Rutina de cancelación compartida (expiración, pago rechazado, cliente y vendedor).
 * Guardas: solo se cancela si la sub-orden sigue `pending` y la venta vinculada
 * tiene `paid = 0`; si alguien cobró o actuó, se omite y se registra.
 */
@Injectable()
export class MarketplaceMaintenanceService {
  private readonly logger = new Logger(MarketplaceMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly settings: MarketplaceSettingsService
  ) {}

  onModuleInit(): void {
    void this.expireStaleOrders().catch((error: unknown) => {
      this.logger.warn(
        `Marketplace: no se pudo ejecutar la expiración inicial: ${error instanceof Error ? error.message : 'unknown'}`
      );
    });
    this.timer = setInterval(() => {
      void this.expireStaleOrders().catch((error: unknown) => {
        this.logger.error(
          `Marketplace: expiración de pedidos falló: ${error instanceof Error ? error.message : 'unknown'}`
        );
      });
    }, EXPIRY_INTERVAL_MS);
    this.timer.unref();
  }

  /** Expira pedidos `pending_payment` más antiguos que el TTL. Devuelve cuántos canceló. */
  async expireStaleOrders(): Promise<number> {
    if (!(await this.settings.tableExists())) return 0;
    const ttl = this.settings.paymentTtlMinutes();
    const stale = await this.database.query<{ id: number }>(
      `SELECT id FROM public.tec_marketplace_orders
       WHERE status = 'pending_payment' AND payment_status = 'pending'
         AND created_at < NOW() - ($1::int * INTERVAL '1 minute')
       ORDER BY id ASC
       LIMIT ${EXPIRY_BATCH_LIMIT}`,
      [ttl]
    );
    let expired = 0;
    for (const row of stale.rows) {
      try {
        if (await this.cancelPendingOrder(row.id, { reason: 'expired' })) expired += 1;
      } catch (error: unknown) {
        this.logger.error(
          `Marketplace: no se pudo expirar el pedido ${row.id}: ${error instanceof Error ? error.message : 'unknown'}`
        );
      }
    }
    if (expired > 0) {
      this.logger.log(`Marketplace: ${expired} pedido(s) impagos cancelados por expiración (TTL ${ttl} min)`);
    }
    return expired;
  }

  /**
   * Cancela un pedido impago completo: repone stock, elimina las ventas POS
   * vinculadas (paid = 0) y marca pedido/subórdenes `cancelled`. Idempotente:
   * devuelve `false` (sin cambios) si el pedido ya no es cancelable.
   */
  async cancelPendingOrder(
    orderId: number,
    options: { reason: string; paymentStatus?: 'failed' | null }
  ): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const orderResult = await client.query<{ id: number; order_number: string; status: string }>(
        `SELECT id, order_number, status FROM public.tec_marketplace_orders WHERE id = $1 LIMIT 1 FOR UPDATE`,
        [orderId]
      );
      const order = orderResult.rows[0];
      if (!order || order.status !== 'pending_payment') return false;

      const suborders = await client.query<{ id: number; sale_id: number | null; status: string }>(
        `SELECT id, sale_id, status FROM public.tec_marketplace_suborders WHERE order_id = $1 FOR UPDATE`,
        [orderId]
      );
      const blocked = suborders.rows.find((suborder) => suborder.status !== 'pending');
      if (blocked) {
        this.logger.warn(
          `Marketplace: pedido ${order.order_number} no se cancela (${options.reason}): sub-orden ${blocked.id} en estado ${blocked.status}`
        );
        return false;
      }

      const saleIds = suborders.rows
        .map((suborder) => suborder.sale_id)
        .filter((saleId): saleId is number => saleId !== null);
      if (saleIds.length > 0) {
        const sales = await client.query<{ id: number; paid: string | null }>(
          `SELECT id, paid::text AS paid FROM public.tec_sales WHERE id = ANY($1::bigint[]) FOR UPDATE`,
          [saleIds]
        );
        const paidSale = sales.rows.find((sale) => Number(sale.paid ?? 0) > 0);
        if (paidSale) {
          this.logger.warn(
            `Marketplace: pedido ${order.order_number} no se cancela (${options.reason}): la venta ${paidSale.id} tiene pagos registrados`
          );
          return false;
        }
      }

      await this.restoreOrderStock(client, orderId);
      if (saleIds.length > 0) {
        await client.query(`DELETE FROM public.tec_sale_items WHERE sale_id = ANY($1::bigint[])`, [saleIds]);
        await client.query(`DELETE FROM public.tec_sales WHERE id = ANY($1::bigint[])`, [saleIds]);
      }

      await client.query(
        `UPDATE public.tec_marketplace_suborders SET status = 'cancelled', updated_at = NOW() WHERE order_id = $1`,
        [orderId]
      );
      await client.query(
        `UPDATE public.tec_marketplace_orders
         SET status = 'cancelled', payment_status = COALESCE($2, payment_status), updated_at = NOW()
         WHERE id = $1`,
        [orderId, options.paymentStatus ?? null]
      );
      this.logger.log(`Marketplace: pedido ${order.order_number} cancelado (${options.reason})`);
      return true;
    });
  }

  /**
   * Cancela UNA sub-orden impaga desde el panel del vendedor (repone su stock y
   * elimina su venta POS si no tiene pagos) y recalcula el estado del pedido padre.
   */
  async cancelSuborder(tenantId: string, suborderId: number): Promise<void> {
    await this.database.transaction(async (client) => {
      const current = await client.query<{
        id: number;
        order_id: number;
        sale_id: number | null;
        status: string;
        suborder_number: string;
      }>(
        `SELECT id, order_id, sale_id, status, suborder_number
         FROM public.tec_marketplace_suborders
         WHERE id = $1 AND tenant_id = $2
         LIMIT 1
         FOR UPDATE`,
        [suborderId, tenantId]
      );
      const suborder = current.rows[0];
      if (!suborder) throw new NotFoundException('Order not found');
      if (suborder.status === 'cancelled') {
        throw new BadRequestException('Este pedido ya fue cancelado');
      }
      if (suborder.status !== 'pending') {
        throw new BadRequestException(
          'Solo puedes cancelar sub-órdenes sin pago confirmado; las pagadas requieren reembolso manual.'
        );
      }
      if (suborder.sale_id !== null) {
        const sale = await client.query<{ paid: string | null }>(
          `SELECT paid::text AS paid FROM public.tec_sales WHERE id = $1 AND tenant_id = $2 LIMIT 1 FOR UPDATE`,
          [suborder.sale_id, tenantId]
        );
        if (Number(sale.rows[0]?.paid ?? 0) > 0) {
          throw new BadRequestException('La venta ya tiene pagos registrados; requiere reembolso manual.');
        }
      }

      const items = await client.query<{ product_id: number; quantity: number }>(
        `SELECT product_id, quantity FROM public.tec_marketplace_order_items WHERE suborder_id = $1`,
        [suborderId]
      );
      for (const item of items.rows) {
        await client.query(
          `UPDATE public.tec_products SET quantity = quantity + $1 WHERE tenant_id = $2 AND id = $3`,
          [item.quantity, tenantId, item.product_id]
        );
      }

      if (suborder.sale_id !== null) {
        await client.query(`DELETE FROM public.tec_sale_items WHERE sale_id = $1 AND tenant_id = $2`, [
          suborder.sale_id,
          tenantId
        ]);
        await client.query(`DELETE FROM public.tec_sales WHERE id = $1 AND tenant_id = $2`, [
          suborder.sale_id,
          tenantId
        ]);
      }

      await client.query(
        `UPDATE public.tec_marketplace_suborders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [suborderId]
      );
      await this.recomputeParentStatus(client, suborder.order_id);
      this.logger.log(
        `Marketplace: sub-orden ${suborder.suborder_number} cancelada por el vendedor ${tenantId}`
      );
    });
  }

  /** Recalcula el estado del pedido padre (cancelled es terminal y se excluye). */
  async recomputeParentStatus(client: SqlExecutor, orderId: number): Promise<void> {
    const result = await client.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::integer AS count
       FROM public.tec_marketplace_suborders
       WHERE order_id = $1
       GROUP BY status`,
      [orderId]
    );
    const next = computeParentOrderStatus(result.rows);
    await client.query(
      `UPDATE public.tec_marketplace_orders
       SET status = CASE
             WHEN $2 = 'cancelled' THEN 'cancelled'
             WHEN status = 'pending_payment' THEN status
             ELSE $2
           END,
           updated_at = NOW()
       WHERE id = $1`,
      [orderId, next]
    );
  }

  private async restoreOrderStock(client: SqlExecutor, orderId: number): Promise<void> {
    const items = await client.query<{ product_id: number; tenant_id: string; quantity: number }>(
      `SELECT product_id, tenant_id::text AS tenant_id, quantity
       FROM public.tec_marketplace_order_items
       WHERE order_id = $1`,
      [orderId]
    );
    for (const item of items.rows) {
      await client.query(
        `UPDATE public.tec_products SET quantity = quantity + $1 WHERE tenant_id = $2 AND id = $3`,
        [item.quantity, item.tenant_id, item.product_id]
      );
    }
  }
}
