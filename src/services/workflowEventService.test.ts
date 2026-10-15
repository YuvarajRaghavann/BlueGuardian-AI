import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_DATABASE_NAME, localDatabase } from './localDatabase';
import { recordWorkflowEvent, subscribeToWorkflowEvents } from './workflowEventService';

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Test database deletion was blocked.'));
  });
}

beforeEach(async () => {
  await localDatabase.close();
  await deleteDatabase();
});

afterEach(async () => {
  await localDatabase.close();
  vi.unstubAllGlobals();
});

describe('workflow event service', () => {
  it('publishes activity to current-page listeners and persists it locally', async () => {
    vi.stubGlobal('window', new EventTarget());
    const listener = vi.fn();
    const unsubscribe = subscribeToWorkflowEvents(listener);
    const event = recordWorkflowEvent({
      id: 'test-workflow-event',
      type: 'security_action',
      message: 'Test action recorded.',
      severity: 'info',
      simulated: false,
      deviceId: 'test-device',
    });

    expect(listener).toHaveBeenCalledWith(event);
    await expect(localDatabase.listEvents()).resolves.toContainEqual(event);
    unsubscribe();
  });

  it('preserves the simulated marker so demo activity can be filtered', async () => {
    recordWorkflowEvent({
      id: 'test-simulated-event',
      type: 'scan',
      message: 'Demo scan completed.',
      severity: 'info',
      simulated: true,
    });

    await expect(localDatabase.listEvents()).resolves.toMatchObject([{ simulated: true }]);
  });
});
