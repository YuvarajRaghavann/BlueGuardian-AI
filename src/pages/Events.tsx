import {
  Activity,
  ShieldCheck,
} from 'lucide-react';
import { SecurityTimeline } from '../components/SecurityTimeline';
import { SecurityAuditLog } from '../components/SecurityAuditLog';
import { mockEvents } from '../data/mockEvents';
import { useSecurity } from '../context/SecurityContext';
import type { SecurityEvent } from '../types';
import { visibleEvents } from '../utils/visibleEvents';

export function Events() {
  const { state: securityState } = useSecurity();
  const actions = securityState.actions;

  const availableEvents: SecurityEvent[] = actions.length > 0
    ? actions.slice(0, 10).map((action) => ({
        id: action.id,
        type: action.type === 'TRUST' ? 'pair' : action.type === 'BLOCK' ? 'alert' : 'scan',
        message: `${action.deviceName} · ${action.reason}`,
        severity: action.type === 'BLOCK' ? 'error' : action.type === 'TRUST' ? 'info' : 'warning',
        timestamp: action.timestamp,
        simulated: action.simulated,
      }))
    : mockEvents.slice(0, 10);
  const systemEvents = visibleEvents(availableEvents, securityState.policy.showSimulatedEvents);

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
          <Activity className="h-3.5 w-3.5" />
          Browser activity
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
          Activity &amp; actions
        </h1>

        <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
          Review locally recorded browser activity. Demo entries are marked as
          simulated; this page is not a system-wide security audit log.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
            <Activity className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
              Visible activity
            </p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--text)]">
              {systemEvents.length} {actions.length > 0 ? 'local records' : 'simulated records'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
            <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
              Local actions
            </p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--text)]">
              {actions.length} browser actions
            </p>
          </div>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SecurityTimeline
          events={systemEvents}
          title={actions.length > 0 ? 'Browser Activity Timeline' : 'Simulated Demo Events'}
        />

        <SecurityAuditLog
          actions={actions}
          title="Local Action History"
        />
      </section>
    </div>
  );
}
