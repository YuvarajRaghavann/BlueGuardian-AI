import { describe, expect, it } from 'vitest';
import type { BluetoothDevice } from '../types';
import {
  evaluateBluetoothConnection,
  evaluateFileTransferSafety,
  evaluateRssiRisk,
  evaluateWearableProfile,
  needsManualApproval,
} from './connectionPolicy';

const baseDevice: BluetoothDevice = {
  id: 'conn-1',
  name: 'Trusted headset',
  type: 'headphones',
  trusted: true,
  isKnown: true,
  trustScore: 88,
  riskLevel: 'low',
  connectionStatus: 'disconnected',
  firstSeen: new Date('2026-01-01T00:00:00.000Z'),
  lastSeen: new Date('2026-01-01T00:00:00.000Z'),
  services: [],
  discoverySource: 'REAL',
};

describe('secure connection policy', () => {
  it('allows a safe known device to connect', () => {
    expect(evaluateBluetoothConnection(baseDevice)).toBe('ALLOW');
  });

  it('requires approval for an unknown device using fast pair', () => {
    const unknown: BluetoothDevice = {
      ...baseDevice,
      id: 'conn-2',
      name: 'Unknown quick pair',
      trusted: false,
      isKnown: false,
      trustScore: 35,
      riskLevel: 'medium',
    };

    expect(evaluateBluetoothConnection(unknown, { isFastPair: true })).toBe('REQUIRE_APPROVAL');
  });

  it('blocks a high-risk or blocked device before pairing', () => {
    const risky: BluetoothDevice = {
      ...baseDevice,
      id: 'conn-3',
      name: 'Suspicious device',
      trusted: false,
      isKnown: false,
      trustScore: 15,
      riskLevel: 'high',
      blocked: true,
    };

    expect(evaluateBluetoothConnection(risky)).toBe('BLOCK');
  });

  it('prevents unsafe file transfer from an untrusted device', () => {
    expect(evaluateFileTransferSafety(baseDevice, 'notes.txt')).toBe('ALLOW');
    expect(evaluateFileTransferSafety({ ...baseDevice, trusted: false, isKnown: false, riskLevel: 'medium' }, 'payload.exe')).toBe('BLOCK');
  });

  it('marks a device as requiring manual approval when it is untrusted or risky', () => {
    expect(needsManualApproval({ ...baseDevice, trusted: false, isKnown: false, riskLevel: 'medium' })).toBe(true);
    expect(needsManualApproval({ ...baseDevice, trusted: true, isKnown: true, riskLevel: 'low' })).toBe(false);
  });

  it('flags dangerous RSSI spikes and restricted wearable devices', () => {
    expect(evaluateRssiRisk(-20)).toBe('BLOCK');
    expect(evaluateWearableProfile({ ...baseDevice, type: 'earbuds', trusted: true, isKnown: true, trustScore: 82 })).toBe('AUDIO_ONLY');
    expect(evaluateWearableProfile({ ...baseDevice, type: 'smartwatch', trusted: false, isKnown: false, trustScore: 35 })).toBe('RESTRICTED');
  });
});
