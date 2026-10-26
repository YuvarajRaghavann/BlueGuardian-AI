import { formatDistanceToNow } from 'date-fns';
import { Ban, CheckCircle, RotateCcw, HelpCircle, Trash2 } from 'lucide-react';
import type { SecurityAction, SecurityActionType } from '../types';
import { Pill } from '../ui/kit';

const ACTION: Partial<Record<SecurityActionType, { label: string; icon: typeof Ban; color: string }>> = {
  TRUST: { label: 'Trusted', icon: CheckCircle, color: 'var(--success)' },
  MARK_UNKNOWN: { label: 'Trust removed', icon: HelpCircle, color: 'var(--text-secondary)' },
  BLOCK: { label: 'Blocked', icon: Ban, color: 'var(--danger)' },
  UNBLOCK: { label: 'Unblocked', icon: RotateCcw, color: 'var(--accent)' },
  FORGET: { label: 'Forgotten', icon: Trash2, color: 'var(--text-muted)' },
  INVESTIGATE: { label: 'Under review', icon: HelpCircle, color: 'var(--warning)' },
  RESOLVE_THREAT: { label: 'Alert resolved', icon: CheckCircle, color: 'var(--success)' },
  DISMISS_THREAT: { label: 'Alert dismissed', icon: RotateCcw, color: 'var(--text-secondary)' },
  IGNORE_DEVICE: { label: 'Ignored', icon: HelpCircle, color: 'var(--text-muted)' },
};

/** Trust, block and forget decisions made on this phone. */
export function SecurityAuditLog({ actions, title = 'Your decisions' }: { actions: SecurityAction[]; title?: string }) {
  return (
    <section>
      <h2 className="mb-2.5 px-1 text-[15px] font-bold">{title}</h2>
      {actions.length === 0 ? (
        <p className="rounded-3xl bg-[var(--surface)] px-4 py-4 text-sm text-[var(--text-muted)]">When you trust, block or forget a device, it’s recorded here.</p>
      ) : (
        <ol className="divide-y divide-[var(--border)] overflow-hidden rounded-3xl bg-[var(--surface)]">
          {actions.map((action) => {
            const a = ACTION[action.type] ?? { label: action.type.replace(/_/g, ' ').toLowerCase(), icon: HelpCircle, color: 'var(--text-secondary)' };
            return (
              <li key={action.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${a.color} 15%, transparent)`, color: a.color }}>
                  <a.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{action.deviceName}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                    <span style={{ color: a.color }}>{a.label}</span>
                    · {formatDistanceToNow(action.timestamp, { addSuffix: true })}
                    {action.source === 'SYSTEM' && <Pill>Automatic</Pill>}
                    {action.simulated && <Pill color="var(--warning)">Sample</Pill>}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
