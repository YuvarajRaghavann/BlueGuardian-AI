import { cn } from '../utils/cn';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
  className?: string;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  className,
}: StatCardProps) {
  const positive = trend ? trend.value >= 0 : false;

  return (
    <div
      className={cn(
        'group rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)] sm:p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
            {title}
          </p>

          <p className="mt-2 text-2xl font-semibold tracking-tight text-white">
            {value}
          </p>

          {trend && (
            <p
              className={cn(
                'mt-1.5 text-[11px]',
                positive
                  ? 'text-[var(--success)]'
                  : 'text-[var(--danger)]',
              )}
            >
              {trend.value > 0 ? '+' : ''}
              {trend.value}%{' '}
              <span className="text-[var(--text-muted)]">
                {trend.label}
              </span>
            </p>
          )}
        </div>

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--accent)] transition-colors group-hover:border-[var(--border-strong)]">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
