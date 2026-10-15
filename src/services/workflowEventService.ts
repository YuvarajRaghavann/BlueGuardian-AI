import type { SecurityEvent } from '../types';
import { localDatabase } from './localDatabase';

const WORKFLOW_EVENT_NAME = 'blueguardian:workflow-event';
const MAX_VISIBLE_EVENTS = 200;

type WorkflowEventInput = Omit<SecurityEvent, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: Date;
};

export function recordWorkflowEvent(input: WorkflowEventInput): SecurityEvent {
  const event: SecurityEvent = {
    ...input,
    id: input.id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: input.timestamp ?? new Date(),
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SecurityEvent>(WORKFLOW_EVENT_NAME, { detail: event }));
  }

  // Activity must not cause the underlying security action to fail if IndexedDB is unavailable.
  void localDatabase.recordEvent(event).catch((error: unknown) => {
    console.warn('Workflow activity remains in this session but could not be saved locally.', error);
  });

  return event;
}

export function subscribeToWorkflowEvents(listener: (event: SecurityEvent) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handler = (rawEvent: Event) => {
    const event = (rawEvent as CustomEvent<SecurityEvent>).detail;
    if (event) listener(event);
  };

  window.addEventListener(WORKFLOW_EVENT_NAME, handler);
  return () => window.removeEventListener(WORKFLOW_EVENT_NAME, handler);
}

export function mergeWorkflowEvents(...groups: SecurityEvent[][]): SecurityEvent[] {
  const unique = new Map<string, SecurityEvent>();
  for (const event of groups.flat()) unique.set(event.id, event);

  return [...unique.values()]
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
    .slice(0, MAX_VISIBLE_EVENTS);
}
