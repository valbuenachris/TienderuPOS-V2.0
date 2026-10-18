import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'dark' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-400 text-navy-900 hover:bg-accent-500 active:bg-accent-600 font-semibold shadow-sm',
  dark: 'bg-navy-800 text-white hover:bg-navy-700 active:bg-navy-600 font-semibold',
  outline:
    'border border-line bg-white text-ink hover:bg-line-soft active:bg-line font-medium',
  ghost: 'bg-transparent text-link-600 hover:text-link-700 hover:underline font-medium',
  danger: 'border border-line bg-white text-price hover:bg-red-50 font-medium'
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-6 py-2.5 text-base gap-2'
};

export function buttonStyles(options?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  className?: string;
}): string {
  const { variant = 'primary', size = 'md', full = false, className = '' } = options ?? {};
  return [
    'inline-flex items-center justify-center rounded-full transition-colors select-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    full ? 'w-full' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  children: ReactNode;
}

export function Button({ variant, size, full, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonStyles({ variant, size, full, className })} {...rest}>
      {children}
    </button>
  );
}
