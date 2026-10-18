import type { ReactNode } from 'react';
import { ORDER_STATUS_LABELS, SUBORDER_STATUS_LABELS } from '../../api';

export type BadgeTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

const TONES: Record<BadgeTone, string> = {
  success: 'bg-success-50 text-success-600',
  warn: 'bg-warn-50 text-warn-700',
  danger: 'bg-red-50 text-red-700',
  info: 'bg-sky-50 text-link-600',
  neutral: 'bg-line-soft text-ink-soft'
};

export function Badge({
  tone = 'neutral',
  children,
  className = ''
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${TONES[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}

function toneForStatus(status: string): BadgeTone {
  if (status === 'paid' || status === 'delivered') return 'success';
  if (status === 'cancelled') return 'danger';
  if (status === 'pending' || status === 'pending_payment') return 'warn';
  return 'info';
}

export function OrderStatusBadge({ status, kind = 'order' }: { status: string; kind?: 'order' | 'suborder' }) {
  const labels = kind === 'order' ? ORDER_STATUS_LABELS : SUBORDER_STATUS_LABELS;
  return <Badge tone={toneForStatus(status)}>{labels[status] ?? status}</Badge>;
}
