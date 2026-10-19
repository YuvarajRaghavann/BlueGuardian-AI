import { useEffect, useState } from 'react';
import {
  Activity,
  ShieldCheck,
} from 'lucide-react';
import { SecurityTimeline } from '../components/SecurityTimeline';
import { SecurityAuditLog } from '../components/SecurityAuditLog';
import { mockEvents } from '../data/mockEvents';
import { SIMULATOR_ENABLED } from '../config/buildFlags';
import { useSecurity } from '../context/SecurityContext';
import type { SecurityEvent } from '../types';
import { visibleEvents } from '../utils/visibleEvents';
import { api } from '../services/api';
import { useOwnerToken } from '../services/ownerSession';
import { useBluetoothDevices } from '../context/DeviceContext';

export function Events() {
  const { state: securityState } = useSecurity();
  const { backendReady } = useBluetoothDevices();
  const ownerToken = useOwnerToken();
  const actions = securityState.actions;
  const [backendEvents, setBackendEvents] = useState<SecurityEvent[] | null>(null);
  const [backendEventsError, setBackendEventsError] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerToken || !backendReady) {
      setBackendEvents(null);
      setBackendEventsError(null);
      return;
    }

    let cancelled = false;
    api.listEvents(ownerToken)
      .then((records) => {
        if (cancelled) return;
        const mapped: SecurityEvent[] = records.map((record) => {
          const eventType = String(record.eventType ?? 'ACTIVITY').toUpperCase();
          const action = String(record.metadata?.action ?? '').toUpperCase();
          const message = typeof record.description === 'string' && record.description.trim()
            ? record.description
            : eventType.replace(/_/g, ' ');
          const isAlert = action === 'BLOCK' || /THREAT|ALERT|BLOCK/.test(eventType);
          const type: SecurityEvent['type'] = action === 'TRUST'
            ? 'pair'
            : /DISCONNECT/.test(eventType) ? 'disconnect'
            : /CONNECT/.test(eventType) ? 'connect'
            : isAlert ? 'alert' : 'scan';
          const date = new Date(record.timestamp ?? Date.now());

          return {
            id: String(record._id ?? record.id ?? `backend-${eventType}-${date.getTime()}`),
            type,
            message,
            deviceId: typeof record.deviceId === 'string' ? record.deviceId : undefined,
            severity: isAlert ? 'error' : action === 'TRUST' ? 'info' : 'warning',
            timestamp: Number.isNaN(date.getTime()) ? new Date() : date,
            simulated: Boolean(record.simulated),
          };
        });
        setBackendEvents(mapped);
        setBackendEventsError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBackendEvents(null);
        setBackendEventsError(error instanceof Error ? error.message : 'Backend audit events could not be loaded.');
      });

    return () => { cancelled = true; };
  }, [ownerToken, backendReady]);

  const localOrDemoEvents: SecurityEvent[] = actions.length > 0
    ? actions.slice(0, 10).map((action) => ({
        id: action.id,
        type: action.type === 'TRUST' ? 'pair' : action.type === 'BLOCK' ? 'alert' : 'scan',
        message: `${action.deviceName} · ${action.reason}`,
        severity: action.type === 'BLOCK' ? 'error' : action.type === 'TRUST' ? 'info' : 'warning',
        timestamp: action.timestamp,
        simulated: action.simulated,
      }))
    : (SIMULATOR_ENABLED ? mockEvents.slice(0, 10) : []);
  const usingBackendEvents = backendReady && backendEvents !== null;
  const availableEvents = usingBackendEvents ? backendEvents : localOrDemoEvents;
  const systemEvents = visibleEvents(availableEvents, securityState.policy.showSimulatedEvents);

  return (
    <div className="space-y-4">

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
              {systemEvents.length} {usingBackendEvents ? 'backend events' : actions.length > 0 ? 'local records' : 'simulated records'}
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

      {backendEventsError && backendReady && (
        <p role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 p-3 text-xs leading-5 text-[var(--text-secondary)]">
          Backend events could not be loaded ({backendEventsError}). Showing local activity instead.
        </p>
      )}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SecurityTimeline
          events={systemEvents}
          title={usingBackendEvents ? 'Backend Audit Events' : actions.length > 0 ? 'Browser Activity Timeline' : 'Simulated Demo Events'}
        />

        <SecurityAuditLog
          actions={actions}
          title="Local Action History"
        />
      </section>
    </div>
  );
}
