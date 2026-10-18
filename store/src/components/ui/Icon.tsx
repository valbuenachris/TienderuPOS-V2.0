import type { ReactNode } from 'react';

export type IconName =
  | 'search'
  | 'cart'
  | 'user'
  | 'menu'
  | 'close'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'star'
  | 'truck'
  | 'shield'
  | 'credit-card'
  | 'package'
  | 'map-pin'
  | 'trash'
  | 'plus'
  | 'minus'
  | 'check'
  | 'alert'
  | 'store'
  | 'home'
  | 'phone'
  | 'mail'
  | 'arrow-up'
  | 'filter'
  | 'refresh'
  | 'log-out';

const ICONS: Record<IconName, { body: ReactNode; filled?: boolean }> = {
  search: {
    body: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </>
    )
  },
  cart: {
    body: (
      <>
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2 3h2l2.6 12.2a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L21.9 7H5.1" />
      </>
    )
  },
  user: {
    body: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      </>
    )
  },
  menu: {
    body: (
      <>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </>
    )
  },
  close: {
    body: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    )
  },
  'chevron-down': { body: <path d="m6 9 6 6 6-6" /> },
  'chevron-right': { body: <path d="m9 6 6 6-6 6" /> },
  'chevron-left': { body: <path d="m15 6-6 6 6 6" /> },
  star: {
    filled: true,
    body: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  },
  truck: {
    body: (
      <>
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18H9" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
        <circle cx="17" cy="18" r="2" />
        <circle cx="7" cy="18" r="2" />
      </>
    )
  },
  shield: {
    body: (
      <>
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </>
    )
  },
  'credit-card': {
    body: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </>
    )
  },
  package: {
    body: (
      <>
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </>
    )
  },
  'map-pin': {
    body: (
      <>
        <path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0" />
        <circle cx="12" cy="10" r="3" />
      </>
    )
  },
  trash: {
    body: (
      <>
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </>
    )
  },
  plus: {
    body: (
      <>
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </>
    )
  },
  minus: { body: <path d="M5 12h14" /> },
  check: { body: <path d="M20 6 9 17l-5-5" /> },
  alert: {
    body: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </>
    )
  },
  store: {
    body: (
      <>
        <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
        <path d="M2 7h20" />
        <path d="M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
      </>
    )
  },
  home: {
    body: (
      <>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M9 22V12h6v10" />
      </>
    )
  },
  phone: {
    body: (
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    )
  },
  mail: {
    body: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </>
    )
  },
  'arrow-up': {
    body: (
      <>
        <path d="m5 12 7-7 7 7" />
        <path d="M12 19V5" />
      </>
    )
  },
  filter: { body: <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /> },
  refresh: {
    body: (
      <>
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </>
    )
  },
  'log-out': {
    body: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </>
    )
  }
};

export function Icon({
  name,
  className = 'h-5 w-5',
  strokeWidth = 2,
  title
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
  title?: string;
}) {
  const icon = ICONS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={icon.filled ? 'currentColor' : 'none'}
      stroke={icon.filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {icon.body}
    </svg>
  );
}
