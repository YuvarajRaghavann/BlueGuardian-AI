import { Pill } from '../ui/kit';

interface StatusBadgeProps {
  label: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

const COLORS = {
  default: 'var(--text-secondary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--accent)',
} as const;

/** Status label in the app's palette (kept for older components). */
export function StatusBadge({ label, variant = 'default', className }: StatusBadgeProps) {
  return <Pill color={COLORS[variant]} className={className}>{label}</Pill>;
}
