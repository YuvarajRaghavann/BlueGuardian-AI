import { useEffect, useState } from 'react';
import type { SecurityEvent } from '../types';
import { localDatabase } from '../services/localDatabase';
import { mergeWorkflowEvents, subscribeToWorkflowEvents } from '../services/workflowEventService';
import { api, type BackendEventRecord } from '../services/api';
import { useBackendSession } from '../context/BackendSessionContext';


const eventTypes: SecurityEvent['type'][] = [
  'scan', 'connect', 'disconnect', 'pair', 'unpair', 'alert',
  'device', 'security_action', 'threat', 'recovery',
];

function mapBackendEvent(record: BackendEventRecord): SecurityEvent {
  const rawType = record.eventType.toLowerCase();
  const normalized = rawType === 'security_action' ? 'security_action' : rawType;
  const type = eventTypes.includes(normalized as SecurityEvent['type'])
    ? normalized as SecurityEvent['type']
    : rawType.includes('threat') || rawType.includes('alert')
      ? 'threat'
      : rawType.includes('recovery')
        ? 'recovery'
        : rawType.includes('scan')
          ? 'scan'
          : 'device';
  const metadataSeverity = record.metadata?.severity;
  const severity: SecurityEvent['severity'] =
    metadataSeverity === 'error' || metadataSeverity === 'warning' || metadataSeverity === 'info'
      ? metadataSeverity
      : rawType.includes('block') || rawType.includes('critical')
        ? 'error'
        : rawType.includes('threat') || rawType.includes('unknown') || rawType.includes('reject')
          ? 'warning'
          : 'info';
  const timestamp = record.timestamp ? new Date(record.timestamp) : new Date();
  return {
    id: record._id ?? `backend-${record.deviceId ?? 'system'}-${record.eventType}-${timestamp.getTime()}`,
    type,
    message: record.description ?? record.eventType,
    deviceId: record.deviceId,
    severity,
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
    simulated: Boolean(record.simulated),
  };
}

export function useWorkflowEvents(): SecurityEvent[] {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const { ownerToken } = useBackendSession();

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeToWorkflowEvents(event => {
      setEvents(current => mergeWorkflowEvents([event], current));
    });

    const loadLocalEvents = () => {
      localDatabase.listEvents()
        .then(saved => {
          if (!cancelled) setEvents(current => mergeWorkflowEvents(saved, current));
        })
        .catch((error: unknown) => {
          if (!cancelled) console.warn('Could not load workflow activity history.', error);
        });
    };
    loadLocalEvents();

    const loadBackendEvents = () => {
      if (!ownerToken.trim()) return;
      api.events.list()
        .then(records => {
          if (!cancelled) {
            const remote = records.map(mapBackendEvent);
            setEvents(current => mergeWorkflowEvents(remote, current));
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) console.warn('Could not load cloud audit events; local events remain available.', error);
        });
    };
    loadBackendEvents();
    if (typeof window !== 'undefined') {
      window.addEventListener('blueguardian:backend-events-updated', loadBackendEvents);
    }

    return () => {
      cancelled = true;
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('blueguardian:backend-events-updated', loadBackendEvents);
      }
    };
  }, [ownerToken]);

  return events;
}

/* previous implementation removed */
