const LABELS: Record<string, string> = {
  active: 'Activa',
  trial: 'Prueba',
  suspended: 'Suspendida',
  cancelled: 'Cancelada',
  expired: 'Vencida',
  inactive: 'Inactivo',
  deleted: 'Eliminado'
};

export default function StatusBadge({ status }: { status: string | null | undefined }) {
  const key = (status ?? '').toLowerCase();
  const label = LABELS[key] ?? (status ?? '—');
  return <span className={`status-badge ${key || 'none'}`}>{label}</span>;
}
