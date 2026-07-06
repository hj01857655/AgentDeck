import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/35 px-6 py-12 text-center">
      <div className="mx-auto mb-4 h-12 w-12 rounded-2xl border border-slate-700 bg-slate-950 shadow-inner" />
      <h3 className="text-base font-semibold text-slate-100">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}