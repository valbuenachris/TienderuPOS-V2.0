import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({
  icon = 'store',
  title,
  description,
  action
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-card bg-white px-6 py-14 text-center shadow-card">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-line-soft text-ink-soft">
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      {description ? <p className="text-sm text-ink-soft">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
