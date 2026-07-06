import type { ChangeEventHandler, ReactNode } from 'react';

interface FieldProps {
  label: string;
  children?: ReactNode;
  hint?: string;
}

export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/55">{label}</span>
      {children}
      {hint && <span className="block text-xs text-base-content/55">{hint}</span>}
    </label>
  );
}

interface TextInputProps {
  value: string | number;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  type?: string;
  className?: string;
}

export function TextInput({ value, onChange, placeholder, type = 'text', className = '' }: TextInputProps) {
  return (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      type={type}
      className={`input input-bordered w-full bg-base-100 text-base-content placeholder:text-base-content/35 ${className}`}
    />
  );
}

interface TextAreaProps {
  value: string;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  rows?: number;
}

export function TextArea({ value, onChange, rows = 4 }: TextAreaProps) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      rows={rows}
      className="textarea textarea-bordered w-full resize-none bg-base-100 text-base-content placeholder:text-base-content/35"
    />
  );
}
