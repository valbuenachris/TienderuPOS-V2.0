import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { SaleResult } from '../api';
import { paymentMethodLabel } from '../payments';
import { formatDate, formatMoney } from '../format';

interface SaleTicketProps {
  sale: SaleResult;
  currency: string;
  siteName?: string;
  storeName?: string;
  cashierName?: string;
  preview?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  paid: 'PAGADA',
  partial: 'PAGO PARCIAL',
  due: 'PENDIENTE'
};

function buildQrPayload(sale: SaleResult, storeName: string): string {
  const items = sale.items.map((item) => ({
    code: item.code ?? String(item.product_id),
    name: item.name ?? '',
    qty: Number(item.quantity),
    price: Number(item.unit_price),
    subtotal: Number(item.subtotal)
  }));
  if (items.length > 8) {
    return [
      `Ticket: #${sale.id}`,
      `Fecha: ${sale.created_at ? new Date(sale.created_at).toLocaleString('es-CO') : ''}`,
      `Tienda: ${storeName}`,
      `Items: ${items.length}`,
      `Total: ${Number(sale.grand_total).toFixed(2)}`
    ].join('\n');
  }
  return JSON.stringify({
    ticket: sale.id,
    date: sale.created_at,
    store: storeName,
    customer: sale.customer_name || 'Cliente ocasional',
    items,
    subtotal: Number(sale.total),
    tax: Number(sale.tax_total),
    total: Number(sale.grand_total),
    payment: sale.paid_by ? paymentMethodLabel(sale.paid_by) : 'pendiente',
    received: sale.amount_received === undefined || sale.amount_received === null ? null : Number(sale.amount_received),
    change: sale.change_amount === undefined || sale.change_amount === null ? null : Number(sale.change_amount)
  });
}

export default function SaleTicket({
  sale,
  currency,
  siteName,
  storeName,
  cashierName,
  preview = false
}: SaleTicketProps) {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    let active = true;
    const payload = buildQrPayload(sale, storeName || siteName || 'POS');
    QRCode.toDataURL(payload, { width: 96, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setQrDataUrl(url); })
      .catch(() => { if (active) setQrDataUrl(''); });
    return () => { active = false; };
  }, [sale, storeName, siteName]);

  const isCash = sale.paid_by === 'cash';
  const received = sale.amount_received;
  const change = sale.change_amount;
  const points = Number(sale.total_reward_points ?? 0);
  const showCustomer = Boolean(sale.customer_name) && sale.customer_name !== 'Cliente ocasional';

  return (
    <div className={`sale-ticket ${preview ? 'sale-ticket-preview' : 'print-receipt'}`}>
      <div className="ticket-header">
        <div className="ticket-logo">{siteName || 'TIENDERU POS'}</div>
        {storeName ? <div className="ticket-store">{storeName}</div> : null}
        <div className="ticket-ticket-no">Ticket #{sale.id}</div>
        <div className="ticket-meta-line">{formatDate(sale.created_at)}</div>
        {cashierName ? <div className="ticket-meta-line">Cajero: {cashierName}</div> : null}
        {showCustomer ? <div className="ticket-meta-line">Cliente: {sale.customer_name}</div> : null}
      </div>

      <div className="ticket-rule" />

      <div className="ticket-items-head"><span>Descripción</span><span>Importe</span></div>
      <div className="ticket-items">
        {sale.items.map((item, index) => (
          <div className="ticket-item" key={`${item.product_id}-${index}`}>
            <div className="ticket-item-main">
              <span className="ticket-item-name">{item.name || item.code || `#${item.product_id}`}</span>
              <span className="ticket-item-amount">{formatMoney(item.subtotal, currency)}</span>
            </div>
            <div className="ticket-item-sub">
              {item.code ? `Cód. ${item.code} · ` : ''}{Number(item.quantity)} x {formatMoney(item.unit_price, currency)}
            </div>
          </div>
        ))}
      </div>

      <div className="ticket-rule" />

      <div className="ticket-totals">
        <div><span>Subtotal</span><span>{formatMoney(sale.total, currency)}</span></div>
        <div><span>Impuestos</span><span>{formatMoney(sale.tax_total, currency)}</span></div>
        <div className="ticket-grand-total"><span>TOTAL</span><span>{formatMoney(sale.grand_total, currency)}</span></div>
      </div>

      <div className="ticket-rule" />

      <div className="ticket-payment">
        <div><span>Pago</span><span>{sale.paid_by ? paymentMethodLabel(sale.paid_by) : 'Cuenta pendiente'}</span></div>
        {isCash && received ? <div><span>Recibido</span><span>{formatMoney(received, currency)}</span></div> : null}
        {isCash && received ? <div><span>Cambio</span><span>{formatMoney(change ?? '0', currency)}</span></div> : null}
        <div><span>Estado</span><span>{STATUS_LABELS[sale.status] ?? sale.status}</span></div>
      </div>

      {points > 0 ? <div className="ticket-points">Puntos ganados: {points}</div> : null}

      <div className="ticket-rule" />

      <div className="ticket-footer">
        {qrDataUrl ? <img className="ticket-qr" src={qrDataUrl} alt="QR del ticket" /> : <div className="ticket-qr placeholder">QR</div>}
        <div className="ticket-qr-label">Escanea para ver detalles</div>
        <div className="ticket-thanks">¡Gracias por su compra!</div>
        <div className="ticket-legal">Conserva este ticket para cambios o reclamos dentro de los 30 días.</div>
        <div className="ticket-legal">Comprobante de venta · {siteName || 'Tienderu POS'}</div>
      </div>
    </div>
  );
}
