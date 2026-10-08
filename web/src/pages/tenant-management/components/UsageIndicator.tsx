interface UsageIndicatorProps {
  label: string;
  current: number;
  max: number | null;
}

export default function UsageIndicator({ label, current, max }: UsageIndicatorProps) {
  const unlimited = max === null || max === -1;
  const percent = unlimited || max <= 0 ? 100 : Math.min(100, Math.round((current / max) * 100));
  const level = unlimited ? 'ok' : percent >= 90 ? 'danger' : percent >= 80 ? 'warn' : 'ok';
  return (
    <div className="usage">
      <div className="usage-head">
        <span>{label}</span>
        <strong>{current} / {unlimited ? '∞' : max}</strong>
      </div>
      <div className="usage-bar">
        <span className={level} style={{ width: unlimited ? '10%' : `${percent}%` }} />
      </div>
    </div>
  );
}
