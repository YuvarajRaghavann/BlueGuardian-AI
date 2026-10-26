import { useEffect, useState } from 'react';
import { Notice } from '../ui/kit';
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
        message: `${({ TRUST: 'Trusted', BLOCK: 'Blocked', UNBLOCK: 'Unblocked', FORGET: 'Forgot', MARK_UNKNOWN: 'Removed trust from' } as Record<string, string>)[action.type] ?? 'Updated'} ${action.deviceName}`,
        severity: action.type === 'BLOCK' ? 'error' : action.type === 'TRUST' ? 'info' : 'warning',
        timestamp: action.timestamp,
        simulated: action.simulated,
      }))
    : (SIMULATOR_ENABLED ? mockEvents.slice(0, 10) : []);
  const availableEvents = backendReady && backendEvents !== null ? backendEvents : localOrDemoEvents;
  const systemEvents = visibleEvents(availableEvents, securityState.policy.showSimulatedEvents);

  return (
    <div className="space-y-5">
      {backendEventsError && backendReady && (
        <Notice tone="warning">Couldn’t load your account activity. Showing this phone’s activity.</Notice>
      )}
      <SecurityTimeline events={systemEvents} title="Recent activity" />
      <SecurityAuditLog actions={actions} title="Your decisions" />
    </div>
  );
}
