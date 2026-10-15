import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BluetoothDevice, SecurityAction, SecurityAssessment, SecurityEvent, Threat } from '../types';
import { deviceReducer, type DeviceState } from '../context/DeviceContext';
import { createSecurityAction } from './securityActionService';
import { LOCAL_DATABASE_NAME, localDatabase } from './localDatabase';

const device: BluetoothDevice = {
  id: 'local-device-1',
  name: 'Local test device',
  type: 'smartphone',
  trusted: false,
  trustScore: 55,
  riskLevel: 'medium',
  connectionStatus: 'disconnected',
  firstSeen: new Date('2026-01-01T00:00:00.000Z'),
  lastSeen: new Date('2026-01-01T00:00:00.000Z'),
  isKnown: false,
  services: [],
  discoverySource: 'REAL',
};

const assessment: SecurityAssessment = {
  trustScore: 55,
  trustRiskLevel: 'medium',
  ruleBasedThreatScore: 25,
  ruleBasedSeverity: 'medium',
  ruleBasedCategory: 'UNKNOWN_DEVICE',
  ruleBasedReasons: [],
  finalThreatScore: 20,
  finalSeverity: 'medium',
  finalClassification: 'SUSPICIOUS',
  confidence: 0.7,
  reasons: [],
  recommendedAction: 'Monitor the device.',
};

const event: SecurityEvent = {
  id: 'local-event-1',
  type: 'scan',
  message: 'Local scan completed.',
  severity: 'info',
  timestamp: new Date('2026-01-01T00:07:00.000Z'),
  simulated: false,
  deviceId: device.id,
};

const threat: Threat = {
  id: 'local-threat-1',
  deviceId: device.id,
  deviceName: device.name,
  category: 'UNKNOWN_DEVICE',
  severity: 'medium',
  score: 25,
  title: 'Unknown device detected',
  description: 'Device has not been trusted.',
  reasons: [],
  recommendedAction: 'Monitor the device.',
  status: 'INVESTIGATING',
  detectedAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:05:00.000Z'),
  discoverySource: 'REAL',
};

function stateWithDevice(current: BluetoothDevice): DeviceState {
  return {
    devices: [current],
    scan: { state: 'idle', elapsedMs: 0, devicesFound: 0 },
    simulationMode: false,
    filter: 'all',
    sort: 'trust',
    search: '',
  };
}

function actionRecord(type: SecurityAction['type'], current: BluetoothDevice, timestamp: string): SecurityAction {
  return {
    ...createSecurityAction(type, current, 'Unit test action', 'USER', false),
    timestamp: new Date(timestamp),
  };
}

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

describe('local IndexedDB persistence', () => {
  it('retains devices, actions, threat state, and assessments after closing and reopening', async () => {
    const trusted = deviceReducer(stateWithDevice(device), {
      type: 'MARK_TRUSTED',
      payload: device.id,
    }).devices[0];
    const trustAction = actionRecord('TRUST', device, '2026-01-01T00:01:00.000Z');
    await localDatabase.recordSecurityAction(trustAction, trusted);

    const blocked = deviceReducer(stateWithDevice(trusted), {
      type: 'BLOCK_DEVICE',
      payload: device.id,
    }).devices[0];
    const blockAction = actionRecord('BLOCK', trusted, '2026-01-01T00:02:00.000Z');
    await localDatabase.recordSecurityAction(blockAction, blocked);
    await localDatabase.replaceThreats([threat]);
    await localDatabase.recordEvent(event);
    await localDatabase.saveAssessments([{
      deviceId: device.id,
      assessment,
      analyzedAt: new Date('2026-01-01T00:06:00.000Z'),
      discoverySource: 'REAL',
    }]);

    await localDatabase.close();

    const restoredDevices = await localDatabase.listDevices();
    expect(restoredDevices).toHaveLength(1);
    expect(restoredDevices[0]).toMatchObject({ ...blocked, connectionStatus: 'unknown' });
    await expect(localDatabase.listActions()).resolves.toEqual([blockAction, trustAction]);
    await expect(localDatabase.listThreats()).resolves.toEqual([threat]);
    await expect(localDatabase.listEvents()).resolves.toEqual([event]);
    await expect(localDatabase.listAssessments()).resolves.toEqual([{
      deviceId: device.id,
      assessment,
      analyzedAt: new Date('2026-01-01T00:06:00.000Z'),
      discoverySource: 'REAL',
    }]);
  });

  it('stores a trust decision with recalculated score and known-device state', async () => {
    const trusted = deviceReducer(stateWithDevice(device), {
      type: 'MARK_TRUSTED',
      payload: device.id,
    }).devices[0];
    const action = actionRecord('TRUST', device, '2026-01-01T00:01:00.000Z');

    await localDatabase.recordSecurityAction(action, trusted);

    const [stored] = await localDatabase.listDevices();
    expect(stored.trusted).toBe(true);
    expect(stored.isKnown).toBe(true);
    expect(stored.trustScore).toBeGreaterThan(device.trustScore);
    expect(stored.blocked).toBe(false);
  });

  it('recomputes approvalRequired when devices are reloaded from local persistence', async () => {
    await localDatabase.saveDevice({
      ...device,
      trusted: true,
      isKnown: true,
      riskLevel: 'low',
      trustScore: 92,
      approvalRequired: false,
    });

    const [approved] = await localDatabase.listDevices();
    expect(approved.approvalRequired).toBe(false);

    await localDatabase.saveDevice({
      ...device,
      trusted: false,
      isKnown: false,
      riskLevel: 'medium',
      trustScore: 42,
      approvalRequired: false,
    });

    const [pending] = await localDatabase.listDevices();
    expect(pending.approvalRequired).toBe(true);
  });

  it('does not restore a previous browser GATT connection as currently connected', async () => {
    await localDatabase.saveDevice({
      ...device,
      connectionStatus: 'connected',
      gattConnected: true,
      connectionHealth: 'GOOD',
    });

    const [restored] = await localDatabase.listDevices();
    expect(restored.connectionStatus).toBe('unknown');
    expect(restored.gattConnected).toBeUndefined();
    expect(restored.connectionHealth).toBeUndefined();
  });

  it('keeps session operation errors non-fatal when IndexedDB is unavailable', async () => {
    await localDatabase.close();
    vi.stubGlobal('indexedDB', undefined);

    await expect(localDatabase.listDevices()).rejects.toThrow(/IndexedDB is unavailable/);
  });
});