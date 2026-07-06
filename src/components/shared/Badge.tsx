import type { ReactNode } from 'react';

type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'violet';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-base-200 text-base-content/70 border-base-300',
  good: 'bg-success/10 text-success border-success/25',
  warn: 'bg-warning/10 text-warning border-warning/25',
  bad: 'bg-error/10 text-error border-error/25',
  info: 'bg-info/10 text-info border-info/25',
  violet: 'bg-secondary/10 text-secondary border-secondary/25',
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

export function Badge({ children, tone = 'neutral', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}
