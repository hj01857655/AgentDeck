import type { ReactNode } from 'react';
import { useEffect, useId } from 'react';
import { Button } from './Button';

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-lg',
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
};

export function Dialog({ open, title, description, children, onClose, footer, size = 'md' }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`max-h-[90dvh] w-full overflow-hidden rounded-3xl border border-base-300 bg-base-100 shadow-2xl ${sizeClasses[size]}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-base-300 bg-base-200/50 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-base-content">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm leading-6 text-base-content/55">{description}</p>}
          </div>
          <Button tone="ghost" onClick={onClose} className="h-9 w-9 shrink-0 rounded-full p-0 text-lg leading-none" aria-label="关闭对话框">×</Button>
        </div>
        <div className="max-h-[calc(90dvh-9rem)] overflow-auto p-5">
          {children}
        </div>
        {footer && <div className="border-t border-base-300 bg-base-200/50 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
