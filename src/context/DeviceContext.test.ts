import { describe, expect, it } from 'vitest';
import type { BluetoothDevice } from '../types';
import { deviceReducer, type DeviceState } from './DeviceContext';

const device: BluetoothDevice = {
  id: 'device-1',
  name: 'Test device',
  type: 'unknown',
  trusted: true,
  trustScore: 72,
  riskLevel: 'low',
  connectionStatus: 'disconnected',
  firstSeen: new Date(0),
  lastSeen: new Date(0),
  isKnown: true,
  services: [],
  discoverySource: 'REAL',
};

function stateWithDevice(currentDevice: BluetoothDevice): DeviceState {
  return {
    devices: [currentDevice],
    scan: { state: 'idle', elapsedMs: 0, devicesFound: 0 },
    simulationMode: false,
    filter: 'all',
    sort: 'trust',
    search: '',
  };
}

describe('security action device transitions', () => {
  it('blocks a device without changing trust or risk values', () => {
    const next = deviceReducer(stateWithDevice(device), {
      type: 'BLOCK_DEVICE',
      payload: device.id,
    }).devices[0];

    expect(next.blocked).toBe(true);
    expect(next.trusted).toBe(true);
    expect(next.isKnown).toBe(true);
    expect(next.trustScore).toBe(device.trustScore);
    expect(next.riskLevel).toBe(device.riskLevel);
  });

  it('keeps a device approved even if its previous assessment required review', () => {
    const pending = {
      ...device,
      trusted: false,
      isKnown: false,
      riskLevel: 'medium' as const,
      trustScore: 45,
      approvalRequired: true,
    };
    const next = deviceReducer(stateWithDevice(pending), {
      type: 'MARK_TRUSTED',
      payload: pending.id,
    }).devices[0];

    expect(next.trusted).toBe(true);
    expect(next.isKnown).toBe(true);
    expect(next.blocked).not.toBe(true);
    expect(next.approvalRequired).toBe(false);
  });

  it('unblocks without changing the device trust state', () => {
    const blockedDevice = { ...device, blocked: true };
    const next = deviceReducer(stateWithDevice(blockedDevice), {
      type: 'UNBLOCK_DEVICE',
      payload: device.id,
    }).devices[0];

    expect(next.blocked).toBe(false);
    expect(next.trusted).toBe(blockedDevice.trusted);
    expect(next.isKnown).toBe(blockedDevice.isKnown);
    expect(next.trustScore).toBe(blockedDevice.trustScore);
    expect(next.riskLevel).toBe(blockedDevice.riskLevel);
  });

  it('reapplies the review policy when a device is updated', () => {
    const updated = {
      ...device,
      trusted: false,
      isKnown: false,
      riskLevel: 'medium' as const,
      trustScore: 45,
      approvalRequired: false,
    };

    const next = deviceReducer(stateWithDevice(device), {
      type: 'UPDATE_DEVICE',
      payload: updated,
    }).devices[0];

    expect(next.trusted).toBe(false);
    expect(next.isKnown).toBe(false);
    expect(next.approvalRequired).toBe(true);
    expect(next.riskLevel).toBe('medium');
  });

  it('marks the current-session GATT connection disconnected after the browser reports it', () => {
    const connected = {
      ...device,
      connectionStatus: 'connected' as const,
      gattConnected: true,
      connectionHealth: 'GOOD' as const,
    };

    const next = deviceReducer(stateWithDevice(connected), {
      type: 'MARK_DISCONNECTED',
      payload: device.id,
    }).devices[0];

    expect(next.connectionStatus).toBe('disconnected');
    expect(next.gattConnected).toBe(false);
    expect(next.connectionHealth).toBe('UNSTABLE');
  });
});