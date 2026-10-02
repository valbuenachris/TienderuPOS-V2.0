import type { ReactNode } from 'react';

export function PageHeader({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const className = tone === 'info' ? 'notice' : `notice ${tone}`;
  return <div className={className}>{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`.trim()}>{children}</section>;
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const lastPage = Math.max(totalPages, 1);
  return (
    <div className="pagination">
      <button className="quiet" type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Anterior
      </button>
      <span>Página {page} de {lastPage} · {total} registros</span>
      <button className="quiet" type="button" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>
        Siguiente →
      </button>
    </div>
  );
}
