import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useCurrentRegisterQuery, useRegisterSummaryQuery, useRegistersQuery } from '../pos-queries';
import { closeRegister, openRegister } from '../api';
import { formatDate, formatMoney } from '../format';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CashRegisterPage() {
  const queryClient = useQueryClient();
  const { token, tenantId, user, isAdmin, stores, settings } = useSession();
  const currency = settings?.currency_prefix || 'COP';
  const [storeId, setStoreId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [cashInHand, setCashInHand] = useState('0');
  const [closeNote, setCloseNote] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const date = today();

  const effectiveStoreId = storeId ?? user?.store_id ?? (isAdmin ? stores[0]?.id ?? null : null);
  const currentQuery = useCurrentRegisterQuery(token, tenantId, effectiveStoreId);
  const summaryQuery = useRegisterSummaryQuery(token, tenantId, date, effectiveStoreId);
  const registersQuery = useRegistersQuery(token, tenantId);
  const current = currentQuery.data ?? null;
  const summary = summaryQuery.data;

  const openMutation = useApiMutation((input: { store_id: number; cash_in_hand: string }) => openRegister(input));
  const closeMutation = useApiMutation((input: { id: number; payload: { note?: string; total_cash_submitted?: string } }) =>
    closeRegister(input.id, input.payload)
  );

  async function invalidateAll() {
    await queryClient.invalidateQueries({ queryKey: ['registers'] });
    await queryClient.invalidateQueries({ queryKey: ['register-current'] });
    await queryClient.invalidateQueries({ queryKey: ['register-summary'] });
  }

  function submitOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!effectiveStoreId) {
      setNotice('Selecciona una tienda.');
      return;
    }
    openMutation.mutate({ store_id: effectiveStoreId, cash_in_hand: cashInHand.trim() || '0' }, {
      onSuccess: async () => {
        setNotice('Caja abierta.');
        await invalidateAll();
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function submitClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    const payload: { note?: string; total_cash_submitted?: string } = {};
    if (closeNote.trim()) payload.note = closeNote.trim();
    if (countedCash.trim()) payload.total_cash_submitted = countedCash.trim();
    closeMutation.mutate({ id: current.id, payload }, {
      onSuccess: async () => {
        setNotice('Caja cerrada.');
        setCloseNote('');
        setCountedCash('');
        await invalidateAll();
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  const registers = registersQuery.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="OPERACIÓN"
        title="Cierre de caja"
        actions={isAdmin ? (
          <select value={effectiveStoreId ?? ''} onChange={(event) => setStoreId(Number(event.target.value) || null)} aria-label="Tienda">
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        ) : <span className="store-pill">{stores[0]?.name || 'Tienda asignada'}</span>}
      />
      {notice ? <Notice tone={/error|inválid|invalid|abierta|open/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}

      <div className="stat-grid">
        <article className="stat-card"><span>Ventas de hoy</span><strong>{summary?.sales.sales_count ?? '—'}</strong></article>
        <article className="stat-card"><span>Cobrado</span><strong>{formatMoney(summary?.sales.paid, currency)}</strong><small>Pagos registrados</small></article>
        <article className="stat-card"><span>Efectivo</span><strong>{formatMoney(summary?.payments.cash, currency)}</strong></article>
        <article className="stat-card"><span>Tarjeta</span><strong>{formatMoney(summary?.payments.card, currency)}</strong></article>
        <article className="stat-card"><span>Transferencia</span><strong>{formatMoney(summary?.payments.transfer, currency)}</strong></article>
        <article className="stat-card"><span>Sistecrédito</span><strong>{formatMoney(summary?.payments.sistecredito, currency)}</strong></article>
        <article className="stat-card"><span>Addi</span><strong>{formatMoney(summary?.payments.adi, currency)}</strong></article>
        <article className="stat-card"><span>Crédito tienda</span><strong>{formatMoney(summary?.payments.credit, currency)}</strong></article>
      </div>

      <div className="split-layout">
        <Panel className="stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TURNO ACTUAL</p>
              <h2>{current ? `Caja abierta #${current.id}` : 'Sin caja abierta'}</h2>
            </div>
            {current ? <span className="badge paid">{current.status}</span> : null}
          </div>

          {current ? (
            <>
              <p className="muted">Abierta el {formatDate(current.date)} · Fondo inicial {formatMoney(current.cash_in_hand, currency)}</p>
              <form className="form-grid" onSubmit={submitClose}>
                <label>Efectivo contado
                  <input value={countedCash} onChange={(event) => setCountedCash(event.target.value)} inputMode="decimal" placeholder={summary?.payments.cash ?? '0.00'} />
                </label>
                <label>Nota de cierre<input value={closeNote} onChange={(event) => setCloseNote(event.target.value)} maxLength={200} /></label>
                <button className="primary" type="submit" disabled={closeMutation.isPending}>
                  {closeMutation.isPending ? 'Cerrando…' : 'Cerrar caja'}
                </button>
              </form>
            </>
          ) : (
            <form className="form-grid" onSubmit={submitOpen}>
              <label>Fondo inicial en efectivo
                <input value={cashInHand} onChange={(event) => setCashInHand(event.target.value)} inputMode="decimal" placeholder="0.00" />
              </label>
              <button className="primary" type="submit" disabled={openMutation.isPending || !effectiveStoreId}>
                {openMutation.isPending ? 'Abriendo…' : 'Abrir caja'}
              </button>
            </form>
          )}
          {currentQuery.isError ? <Notice tone="error">No fue posible consultar la caja actual.</Notice> : null}
        </Panel>

        <Panel className="stack">
          <div className="section-heading"><div><p className="eyebrow">HISTORIAL</p><h2>Últimos cierres</h2></div></div>
          {registersQuery.isError ? <Notice tone="error">No fue posible cargar los cierres.</Notice> : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>#</th><th>Fecha</th><th>Fondo</th><th>Cobrado</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {registers.map((register) => (
                  <tr key={register.id}>
                    <td>{register.id}</td>
                    <td>{formatDate(register.date)}</td>
                    <td>{formatMoney(register.cash_in_hand, currency)}</td>
                    <td>{formatMoney(register.total_cash, currency)}</td>
                    <td><span className={`badge ${register.status === 'closed' ? 'paid' : 'partial'}`}>{register.status || '—'}</span></td>
                  </tr>
                ))}
                {registers.length === 0 && !registersQuery.isPending ? (
                  <tr><td colSpan={5} className="empty">No hay cierres registrados.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
