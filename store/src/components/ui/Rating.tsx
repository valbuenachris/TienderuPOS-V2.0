const STAR_PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';

const SIZE_CLASSES = {
  sm: 'h-3.5 w-3.5',
  md: 'h-[1.05rem] w-[1.05rem]',
  lg: 'h-5 w-5'
} as const;

function StarRow({ size, className }: { size: keyof typeof SIZE_CLASSES; className: string }) {
  return (
    <span className={`flex gap-0.5 ${className}`}>
      {[0, 1, 2, 3, 4].map((index) => (
        <svg
          key={index}
          viewBox="0 0 24 24"
          fill="currentColor"
          className={`shrink-0 ${SIZE_CLASSES[size]}`}
          aria-hidden="true"
          focusable="false"
        >
          <path d={STAR_PATH} />
        </svg>
      ))}
    </span>
  );
}

export function Rating({
  rating,
  count,
  size = 'sm',
  showEmpty = true
}: {
  rating: number | null | undefined;
  count?: number;
  size?: keyof typeof SIZE_CLASSES;
  showEmpty?: boolean;
}) {
  if (rating === null || rating === undefined) {
    if (!showEmpty) return null;
    return <span className="text-xs text-ink-soft">Sin calificaciones</span>;
  }
  const clamped = Math.max(0, Math.min(5, rating));
  const percentage = (clamped / 5) * 100;
  return (
    <span
      className="inline-flex items-center gap-1.5"
      aria-label={`${clamped.toFixed(1)} de 5 estrellas`}
    >
      <span className="relative inline-flex" aria-hidden="true">
        <StarRow size={size} className="text-star-empty" />
        <span
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: `${percentage}%` }}
        >
          <StarRow size={size} className="text-star" />
        </span>
      </span>
      {count !== undefined ? (
        <span className="text-xs font-medium text-link-600">{count}</span>
      ) : null}
    </span>
  );
}
