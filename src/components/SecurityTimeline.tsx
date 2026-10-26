import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, Link, Radar, ShieldCheck, Unlink } from 'lucide-react';
import type { SecurityEvent } from '../types';
import { Pill } from '../ui/kit';

const typeIcons = {
  scan: Radar,
  connect: Link,
  disconnect: Unlink,
  pair: ShieldCheck,
  unpair: Unlink,
  alert: AlertTriangle,
} as const;

const severityColor = {
  info: 'var(--accent)',
  warning: 'var(--warning)',
  error: 'var(--danger)',
} as const;

const severityLabel = {
  info: 'Info',
  warning: 'Review',
  error: 'Alert',
} as const;

/** Chronological activity: what happened, to which device, when. */
export function SecurityTimeline({ events, title = 'Recent activity' }: { events: SecurityEvent[]; title?: string }) {
  return (
    <section>
      <h2 className="mb-2.5 px-1 text-[15px] font-bold">{title}</h2>
      {events.length === 0 ? (
        <div className="rounded-3xl bg-[var(--surface)] px-6 py-9 text-center">
          <ShieldCheck className="mx-auto h-7 w-7 text-[var(--success)]" />
          <p className="mt-2 font-bold">Nothing yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Scans, connections and alerts will show up here.</p>
        </div>
      ) : (
        <ol className="divide-y divide-[var(--border)] overflow-hidden rounded-3xl bg-[var(--surface)]">
          {events.map((event) => {
            const Icon = typeIcons[event.type] ?? Radar;
            const color = severityColor[event.severity];
            return (
              <li key={event.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--text)]">{event.message}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                    {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                    {event.severity !== 'info' && <Pill color={color}>{severityLabel[event.severity]}</Pill>}
                    {event.simulated && <Pill color="var(--warning)">Sample</Pill>}
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
