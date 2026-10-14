import { cn } from '../utils/cn';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center shadow-[0_0_0_1px_rgba(148,163,184,0.04)]',
        className,
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="mb-1 text-lg font-semibold text-[var(--text)]">{title}</h3>
      <p className="mb-4 max-w-sm text-sm leading-6 text-[var(--text-secondary)]">
        {description}
      </p>
      {action && <div>{action}</div>}
    </div>
  );
}