import { Icon } from './Icon';

export function Pagination({
  page,
  totalPages,
  onChange,
  className = ''
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let index = start; index <= end; index += 1) pages.push(index);

  const buttonBase =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-full border px-2 text-sm font-medium transition-colors';

  return (
    <nav className={`flex items-center justify-center gap-1.5 ${className}`.trim()} aria-label="Paginación">
      <button
        type="button"
        className={`${buttonBase} border-line bg-white text-ink hover:bg-line-soft disabled:opacity-40`}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Página anterior"
      >
        <Icon name="chevron-left" className="h-4 w-4" />
      </button>
      {pages.map((item) => (
        <button
          key={item}
          type="button"
          className={
            item === page
              ? `${buttonBase} border-navy-800 bg-navy-800 text-white`
              : `${buttonBase} border-line bg-white text-ink hover:bg-line-soft`
          }
          onClick={() => onChange(item)}
          aria-current={item === page ? 'page' : undefined}
        >
          {item}
        </button>
      ))}
      <button
        type="button"
        className={`${buttonBase} border-line bg-white text-ink hover:bg-line-soft disabled:opacity-40`}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Página siguiente"
      >
        <Icon name="chevron-right" className="h-4 w-4" />
      </button>
    </nav>
  );
}
