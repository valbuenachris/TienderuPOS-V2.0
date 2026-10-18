import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Dialog({
  open,
  title,
  onClose,
  children,
  className = '',
  hideClose = false
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  hideClose?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-rise-in max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-float sm:max-w-lg sm:rounded-2xl ${className}`.trim()}
      >
        <header className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          {hideClose ? null : (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              title="Cerrar"
              className="rounded-full p-1 text-ink-soft transition-colors hover:bg-line-soft hover:text-ink"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          )}
        </header>
        {children}
      </section>
    </div>
  );
}
