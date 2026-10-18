import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { Icon, type IconName } from './Icon';

type ToastTone = 'success' | 'info' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-success-600/30 bg-success-50 text-success-600',
  info: 'border-link-600/25 bg-sky-50 text-link-700',
  error: 'border-deal-600/25 bg-red-50 text-price'
};

const TONE_ICONS: Record<ToastTone, IconName> = {
  success: 'check',
  info: 'alert',
  error: 'alert'
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    idRef.current += 1;
    const id = idRef.current;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2600);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-20 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`animate-rise-in pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-float ${TONE_STYLES[toast.tone]}`}
          >
            <Icon name={TONE_ICONS[toast.tone]} className="h-4 w-4 shrink-0" />
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
