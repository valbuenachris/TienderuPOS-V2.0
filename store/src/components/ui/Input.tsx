import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

const FIELD_BASE =
  'w-full rounded-field border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 ' +
  'focus:border-link-600 focus:ring-2 focus:ring-link-600/20 focus:outline-none disabled:bg-line-soft';

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_BASE} ${className}`.trim()} {...rest} />;
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD_BASE} ${className}`.trim()} {...rest} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${FIELD_BASE} pr-8 ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}

export function Field({
  label,
  children,
  required = false,
  hint,
  className = ''
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm font-medium text-ink ${className}`.trim()}>
      <span>
        {label}
        {required ? <span className="text-deal-600"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs font-normal text-ink-soft">{hint}</span> : null}
    </label>
  );
}
