import { useEffect, useState } from 'react';
import type { SecurityEvent } from '../types';
import { localDatabase } from '../services/localDatabase';
import { mergeWorkflowEvents, subscribeToWorkflowEvents } from '../services/workflowEventService';

export function useWorkflowEvents(): SecurityEvent[] {
  const [events, setEvents] = useState<SecurityEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeToWorkflowEvents(event => {
      setEvents(current => mergeWorkflowEvents([event], current));
    });

    localDatabase.listEvents()
      .then(saved => {
        if (!cancelled) setEvents(current => mergeWorkflowEvents(saved, current));
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn('Could not load workflow activity history.', error);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return events;
}
