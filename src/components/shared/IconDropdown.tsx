import { useState, type ReactNode } from 'react';

export interface IconDropdownOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface IconDropdownProps<T extends string> {
  value: T;
  options: IconDropdownOption<T>[];
  onChange: (value: T) => void;
  label?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
}

export function IconDropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
  buttonClassName = '',
  menuClassName = '',
}: IconDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const active = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className={`dropdown dropdown-end ${open ? 'dropdown-open' : ''} ${className}`}>
      <button
        type="button"
        className={`btn btn-outline min-h-10 justify-between gap-2 rounded-2xl border-base-300 bg-base-100 px-3 font-normal text-base-content hover:bg-base-200 ${buttonClassName}`}
        onClick={() => setOpen((next) => !next)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label ?? active?.label}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          {active?.icon && <span className="grid h-5 w-5 shrink-0 place-items-center">{active.icon}</span>}
          <span className="truncate text-sm font-medium">{active?.label}</span>
        </span>
        <span className="text-base-content/45">⌄</span>
      </button>
      {open && (
        <div
          className={`dropdown-content z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-base-300 bg-base-100 p-1 shadow-2xl ${menuClassName}`}
          role="listbox"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                  selected ? 'bg-primary/10 text-primary' : 'text-base-content hover:bg-base-200'
                } ${option.disabled ? 'cursor-not-allowed opacity-45' : ''}`}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  setOpen(false);
                }}
                role="option"
                aria-selected={selected}
              >
                {option.icon && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl border border-base-300 bg-base-200/70">{option.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{option.label}</span>
                  {option.description && <span className="mt-0.5 block truncate text-xs text-base-content/45">{option.description}</span>}
                </span>
                {selected && <span className="text-sm">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
