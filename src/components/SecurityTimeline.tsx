import { cn } from '../utils/cn';
import type { SecurityEvent } from '../types';
import { StatusBadge } from './StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import {
  Radar,
  Link,
  Unlink,
  ShieldCheck,
  AlertTriangle,
  Clock3,
} from 'lucide-react';

const typeIcons = {
  scan: Radar,
  connect: Link,
  disconnect: Unlink,
  pair: ShieldCheck,
  unpair: Unlink,
  alert: AlertTriangle,
} as const;

const severityStyles = {
  info: {
    icon: 'text-[var(--accent)]',
    bg: 'bg-[var(--accent-soft)]',
    dot: 'bg-[var(--accent)]',
    label: 'Informational',
    detail: 'No confirmed threat signal is present; this is a routine observation.',
  },
  warning: {
    icon: 'text-[var(--warning)]',
    bg: 'bg-[rgba(242,184,75,0.08)]',
    dot: 'bg-[var(--warning)]',
    label: 'Suspicious indicator',
    detail: 'BlueGuardian is flagging a condition that should be reviewed before trust is increased.',
  },
  error: {
    icon: 'text-[var(--danger)]',
    bg: 'bg-[rgba(239,98,98,0.08)]',
    dot: 'bg-[var(--danger)]',
    label: 'Elevated-risk indicator',
    detail: 'A development assessment assigned an elevated risk score; this is not an independently confirmed threat.',
  },
} as const;

export function SecurityTimeline({
  events,
  title = 'Recent Security Events',
}: {
  events: SecurityEvent[];
  title?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] p-5">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>

        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Latest activity from the security layer
        </p>
      </div>

      {events.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <ShieldCheck className="mx-auto h-7 w-7 text-[var(--success)]" />
          <p className="mt-3 text-sm font-medium text-white">
            No security events
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Activity will appear here as BlueGuardian observes your environment.
          </p>
        </div>
      ) : (
        <div className="p-5">
          <div className="space-y-0">
            {events.map((event, index) => {
              const Icon = typeIcons[event.type];
              const style = severityStyles[event.severity];

              return (
                <div
                  key={event.id}
                  className="relative flex gap-3.5"
                >
                  <div className="relative flex w-7 shrink-0 justify-center">
                    <div
                      className={cn(
                        'relative z-10 mt-1 flex h-7 w-7 items-center justify-center rounded-lg',
                        style.bg,
                      )}
                    >
                      <Icon className={cn('h-3.5 w-3.5', style.icon)} />
                    </div>

                    {index < events.length - 1 && (
                      <div className="absolute left-1/2 top-8 h-[calc(100%-16px)] w-px -translate-x-1/2 bg-[var(--border)]" />
                    )}
                  </div>

                  <div
                    className={cn(
                      'min-w-0 flex-1',
                      index < events.length - 1 ? 'pb-5' : '',
                    )}
                  >
                    <p className="text-xs font-medium leading-5 text-[var(--text-secondary)]">
                      {event.message}
                    </p>
                    <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">
                      {style.label}: {style.detail}
                    </p>

                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                      <Clock3 className="h-3 w-3" />
                      {formatDistanceToNow(event.timestamp, {
                        addSuffix: true,
                      })}

                      <span
                        className={cn(
                          'ml-1 h-1.5 w-1.5 rounded-full',
                          style.dot,
                        )}
                      />
                      <span className="capitalize">{event.severity}</span>
                      {event.simulated && <StatusBadge label="SIMULATED" variant="warning" className="ml-1" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
