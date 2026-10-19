import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Field, Notice, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import { useApiMutation, useMarketplaceCouponsQuery } from '../../pos-queries';
import {
  createMarketplaceCoupon,
  deleteMarketplaceCoupon,
  updateMarketplaceCoupon,
  type MarketplaceCouponAdminRow,
  type MarketplaceCouponPayload
} from '../../api';
import { formatMoney } from '../../format';

function noticeTone(message: string): 'error' | 'success' {
  return /no |error|inválid|invalid|no se|ya existe/i.test(message) ? 'error' : 'success';
}

function isExpired(row: MarketplaceCouponAdminRow): boolean {
  return row.expires_at !== null && new Date(row.expires_at).getTime() < Date.now();
}

function discountLabel(row: MarketplaceCouponAdminRow, currency: string): string {
  return row.discount_type === 'percent'
    ? `${Number(row.discount_value)}%`
    : formatMoney(row.discount_value, currency);
}

export function CuponesTab() {
  const queryClient = useQueryClient();
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const [notice, setNotice] = useState('');
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [minTotal, setMinTotal] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const coupons = useMarketplaceCouponsQuery(token, tenantId);
  const create = useApiMutation((payload: MarketplaceCouponPayload) => createMarketplaceCoupon(payload));
  const update = useApiMutation((input: { id: number; payload: MarketplaceCouponPayload }) =>
    updateMarketplaceCoupon(input.id, input.payload)
  );
  const remove = useApiMutation((id: number) => deleteMarketplaceCoupon(id));

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['marketplace-coupons'] });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice('');
    create.mutate(
      {
        code: code.trim(),
        discount_type: discountType,
        discount_value: Number(value),
        min_total: minTotal.trim() === '' ? 0 : Number(minTotal),
        max_uses: maxUses.trim() === '' ? undefined : Number(maxUses),
        expires_at: expiresAt === '' ? '' : new Date(`${expiresAt}T23:59:59`).toISOString()
      },
      {
        onSuccess: async (row) => {
          setNotice(`Cupón ${row.code} creado.`);
          setCode('');
          setValue('');
          setMinTotal('');
          setMaxUses('');
          setExpiresAt('');
          await refresh();
        },
        onError: (error: Error) => setNotice(error.message)
      }
    );
  }

  function toggle(row: MarketplaceCouponAdminRow) {
    setNotice('');
    update.mutate(
      { id: row.id, payload: { active: !row.active } },
      {
        onSuccess: async (updated) => {
          setNotice(`Cupón ${updated.code} ${updated.active ? 'activado' : 'desactivado'}.`);
          await refresh();
        },
        onError: (error: Error) => setNotice(error.message)
      }
    );
  }

  function destroy(row: MarketplaceCouponAdminRow) {
    if (
      !window.confirm(
        `¿Eliminar el cupón ${row.code}? Los pedidos ya creados conservan su descuento.`
      )
    ) {
      return;
    }
    setNotice('');
    remove.mutate(row.id, {
      onSuccess: async () => {
        setNotice(`Cupón ${row.code} eliminado.`);
        await refresh();
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  const rows = coupons.data ?? [];

  return (
    <Panel className="stack full-width">
      <p className="muted">
        Cupones de descuento de tienderu.com. El descuento lo absorbe la comisión de la plataforma: el
        vendedor recibe el valor completo de su venta. El cupón se aplica al total de productos del pedido
        y solo uno por pedido.
      </p>
      {notice ? <Notice tone={noticeTone(notice)}>{notice}</Notice> : null}
      {coupons.isError ? <Notice tone="error">No fue posible cargar los cupones.</Notice> : null}

      <form className="form-grid" onSubmit={submit}>
        <div className="field-row">
          <Field label="Código *">
            <input
              value={code}
              required
              minLength={3}
              maxLength={40}
              placeholder="BIENVENIDO10"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Tipo de descuento">
            <select
              value={discountType}
              onChange={(event) => setDiscountType(event.target.value as 'percent' | 'fixed')}
            >
              <option value="percent">Porcentaje (%)</option>
              <option value="fixed">Monto fijo ({currency})</option>
            </select>
          </Field>
        </div>
        <div className="field-row">
          <Field label={discountType === 'percent' ? 'Valor (%) *' : `Valor (${currency}) *`}>
            <input
              value={value}
              required
              inputMode="decimal"
              placeholder={discountType === 'percent' ? '10' : '5000'}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <Field label={`Compra mínima (${currency})`}>
            <input
              value={minTotal}
              inputMode="decimal"
              placeholder="0"
              onChange={(event) => setMinTotal(event.target.value)}
            />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Usos máximos (vacío = ilimitado)">
            <input
              value={maxUses}
              inputMode="numeric"
              placeholder="100"
              onChange={(event) => setMaxUses(event.target.value)}
            />
          </Field>
          <Field label="Vence (opcional)">
            <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </Field>
        </div>
        <div>
          <button type="submit" className="primary" disabled={create.isPending}>
            {create.isPending ? 'Creando…' : 'Crear cupón'}
          </button>
        </div>
      </form>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descuento</th>
              <th>Mínimo</th>
              <th>Usos</th>
              <th>Vence</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.code}</strong>
                </td>
                <td>{discountLabel(row, currency)}</td>
                <td className="money-cell">
                  {Number(row.min_total) > 0 ? formatMoney(row.min_total, currency) : '—'}
                </td>
                <td>
                  {row.uses}
                  {row.max_uses !== null ? ` / ${row.max_uses}` : ''}
                </td>
                <td>{row.expires_at ? new Date(row.expires_at).toLocaleDateString('es-CO') : '—'}</td>
                <td>
                  <span className={`badge ${row.active && !isExpired(row) ? 'paid' : 'none'}`}>
                    {!row.active ? 'Inactivo' : isExpired(row) ? 'Vencido' : 'Activo'}
                  </span>
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="quiet"
                    disabled={update.isPending}
                    onClick={() => toggle(row)}
                  >
                    {row.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={remove.isPending}
                    onClick={() => destroy(row)}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !coupons.isPending ? (
              <tr>
                <td colSpan={7} className="empty">
                  Todavía no hay cupones.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
