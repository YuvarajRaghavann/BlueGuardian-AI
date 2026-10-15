import { Activity, ShieldCheck } from 'lucide-react';
import { SecurityTimeline } from '../components/SecurityTimeline';
import { SecurityAuditLog } from '../components/SecurityAuditLog';
import { mockEvents } from '../data/mockEvents';
import { useSecurity } from '../context/SecurityContext';
import type { SecurityEvent } from '../types';
import { visibleEvents } from '../utils/visibleEvents';
import { useWorkflowEvents } from '../hooks/useWorkflowEvents';

export function Events() {
  const { state: securityState } = useSecurity();
  const actions = securityState.actions;
  const workflowEvents = useWorkflowEvents();

  // Backfill historical user actions written before the event ledger existed.
  const actionEvents: SecurityEvent[] = actions.map(action => ({
    id: `action:${action.id}`,
    type: 'security_action',
    message: `User action: ${action.type.toLowerCase().replace(/_/g, ' ')} on ${action.deviceName}. Local browser record.`,
    severity: action.type === 'BLOCK' ? 'error' : action.type === 'MARK_UNKNOWN' ? 'warning' : 'info',
    timestamp: action.timestamp,
    simulated: action.simulated,
    deviceId: action.deviceId,
  }));

  const actualEvents = [...new Map(
    [...workflowEvents, ...actionEvents].map(event => [event.id, event]),
  ).values()]
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
    .slice(0, 50);
  const usingDemoEvents = actualEvents.length === 0;
  const availableEvents: SecurityEvent[] = usingDemoEvents ? mockEvents.slice(0, 10) : actualEvents;
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
          Recent scans, assessments, user actions, threat workflow changes and owner recovery actions recorded by this browser. Demo entries are marked as simulated. This is not a system-wide Bluetooth audit log.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
            <Activity className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Visible activity</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--text)]">
              {systemEvents.length} {usingDemoEvents ? 'simulated demo records' : 'local activity records'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
            <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Local actions</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--text)]">{actions.length} browser actions</p>
          </div>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SecurityTimeline
          events={systemEvents}
          title={usingDemoEvents ? 'Simulated Demo Events' : 'Browser Activity Timeline'}
        />
        <SecurityAuditLog actions={actions} title="Local Action History" />
      </section>
    </div>
  );
}
