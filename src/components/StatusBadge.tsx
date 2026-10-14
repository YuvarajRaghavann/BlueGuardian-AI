import { cn } from '../utils/cn';

interface StatusBadgeProps {
  label: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

export function StatusBadge({ label, variant = 'default', className }: StatusBadgeProps) {
  const base = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';
  const variants = {
    default: 'bg-gray-700 text-gray-300',
    success: 'bg-green-900/30 text-green-400',
    warning: 'bg-yellow-900/30 text-yellow-400',
    danger: 'bg-red-900/30 text-red-400',
    info: 'bg-blue-900/30 text-blue-400',
  };
  return <span className={cn(base, variants[variant], className)}>{label}</span>;
}