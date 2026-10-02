import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Pagination, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useExpensesQuery } from '../pos-queries';
import { createExpense, updateExpense } from '../api';
import type { ExpensePayload, ExpenseRecord } from '../api';
import { formatMoney } from '../format';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || 'COP';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState<{ from?: string; to?: string }>({});
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const expensesQuery = useExpensesQuery(token, tenantId, applied.from, applied.to, page, 20);

  const saveMutation = useApiMutation((input: { id: number | null; payload: ExpensePayload }) =>
    input.id === null ? createExpense(input.payload) : updateExpense(input.id, input.payload)
  );

  function resetForm() {
    setEditingId(null);
    setDate(today());
    setReference('');
    setAmount('');
    setNote('');
  }

  function startEdit(expense: ExpenseRecord) {
    setEditingId(expense.id);
    setDate(expense.date ? expense.date.slice(0, 10) : today());
    setReference(expense.reference ?? '');
    setAmount(expense.amount ?? '');
    setNote(expense.note ?? '');
    setNotice('');
  }

  function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: ExpensePayload = {
      reference: reference.trim(),
      amount: amount.trim(),
      date,
      note: note.trim() || undefined
    };
    saveMutation.mutate({ id: editingId, payload }, {
      onSuccess: async () => {
        setNotice(editingId === null ? 'Gasto registrado.' : 'Gasto actualizado.');
        resetForm();
        await queryClient.invalidateQueries({ queryKey: ['expenses'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  const expenses = expensesQuery.data?.data ?? [];
  const meta = expensesQuery.data?.meta;
  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount ?? 0), 0);

  return (
    <>
      <PageHeader eyebrow="ADMINISTRACIÓN" title="Gastos" />
      {notice ? <Notice tone={/error|inválid|invalid|required/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      <div className="split-layout">
        <Panel className="stack">
          <div className="toolbar">
            <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <button className="primary" onClick={() => { setPage(1); setApplied({ from: from || undefined, to: to || undefined }); }}>Aplicar</button>
          </div>
          {expensesQuery.isError ? <Notice tone="error">No fue posible cargar los gastos.</Notice> : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Fecha</th><th>Referencia</th><th>Monto</th><th>Nota</th><th /></tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{expense.date ? expense.date.slice(0, 10) : '—'}</td>
                    <td>{expense.reference || '—'}</td>
                    <td>{formatMoney(expense.amount, currency)}</td>
                    <td>{expense.note || '—'}</td>
                    <td className="row-actions"><button className="quiet" onClick={() => startEdit(expense)}>Editar</button></td>
                  </tr>
                ))}
                {expenses.length === 0 && !expensesQuery.isPending ? (
                  <tr><td colSpan={5} className="empty">No hay gastos en el rango seleccionado.</td></tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr><th colSpan={2}>Total (página)</th><th>{formatMoney(total, currency)}</th><th colSpan={2} /></tr>
              </tfoot>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={meta?.totalPages ?? 0}
            total={meta?.total ?? 0}
            onChange={setPage}
          />
        </Panel>

        <Panel className="stack">
          <div className="section-heading">
            <div><p className="eyebrow">{editingId === null ? 'NUEVO' : 'EDITANDO'}</p><h2>{editingId === null ? 'Registrar gasto' : `Gasto #${editingId}`}</h2></div>
            {editingId !== null ? <button className="quiet" onClick={resetForm}>Cancelar</button> : null}
          </div>
          <form className="form-grid" onSubmit={submitExpense}>
            <label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
            <label>Referencia<input value={reference} onChange={(event) => setReference(event.target.value)} required maxLength={50} /></label>
            <label>Monto<input value={amount} onChange={(event) => setAmount(event.target.value)} required inputMode="decimal" placeholder="0.00" /></label>
            <label>Nota<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} /></label>
            <button className="primary" type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando…' : editingId === null ? 'Registrar gasto' : 'Guardar cambios'}
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
