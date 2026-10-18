import { describe, expect, it } from 'vitest';
import type { BluetoothDevice } from '../types/index.js';
import { assessBtGuard, ContinuousTrustRegistry } from './btguard.js';

const base: BluetoothDevice = {
  id: 'device-1', name: 'Test earbuds', type: 'earbuds', trusted: true,
  trustScore: 90, riskLevel: 'trusted', connectionStatus: 'connected',
  firstSeen: new Date(1), lastSeen: new Date(1000), isKnown: true,
  services: [], discoverySource: 'REAL', connectionHealth: 'GOOD', blocked: false,
};

describe('BTGuard continuous trust binding', () => {
  it('does not claim proximity assurance when Channel Sounding data is missing', () => {
    const result = assessBtGuard(base);
    expect(result.reasons.join(' ')).toContain('Channel Sounding/RSSI cross-check unavailable');
    expect(result.telemetryCoverage).not.toContain('Channel Sounding distance and RSSI');
  });

  it('restricts an untrusted device instead of granting full capability', () => {
    const result = assessBtGuard({ ...base, trusted: false, isKnown: false });
    expect(result.level).toBe('RESTRICTED');
    expect(result.capabilities).not.toContain('file_transfer');
  });

  it('isolates owner-blocked devices', () => {
    const result = assessBtGuard({ ...base, blocked: true });
    expect(result.level).toBe('ISOLATED');
    expect(result.capabilities).toEqual([]);
  });

  it('penalizes reported weak cryptographic state', () => {
    const result = assessBtGuard(base, { secureConnections: false, encrypted: false, keySizeBytes: 7 });
    expect(result.trustScore).toBeLessThan(40);
    expect(result.level).toBe('ISOLATED');
  });


  it('requires positive crypto and proximity evidence before recommending full capabilities', () => {
    const missingEvidence = assessBtGuard(base);
    expect(missingEvidence.level).toBe('RESTRICTED');
    const verified = assessBtGuard(base, {
      secureConnections: true,
      encrypted: true,
      authenticated: true,
      keySizeBytes: 16,
      channelSoundingDistanceM: 2,
      proximityVerified: true,
      rfFingerprintComparable: true,
      rssiDbm: -48,
    });
    expect(verified.level).toBe('FULL');
    expect(verified.capabilities).toContain('file_transfer');
  });

  it('does not promote a blocked device even with otherwise valid telemetry', () => {
    const result = assessBtGuard({ ...base, blocked: true }, {
      secureConnections: true,
      encrypted: true,
      authenticated: true,
      keySizeBytes: 16,
      channelSoundingDistanceM: 2,
      rssiDbm: -48,
    });
    expect(result.level).toBe('ISOLATED');
  });

  it('uses recent RSSI variation as a low-confidence review signal, not a spoofing verdict', () => {
    const registry = new ContinuousTrustRegistry();
    registry.observe({ ...base, rssi: -42, lastSeen: new Date(1000) });
    registry.observe({ ...base, rssi: -55, lastSeen: new Date(2000) });
    registry.observe({ ...base, rssi: -70, lastSeen: new Date(3000) });
    const result = registry.observe({ ...base, rssi: -91, lastSeen: new Date(4000) });
    expect(result.telemetryCoverage).toContain('multi-sample RSSI history');
    expect(result.reasons.join(' ')).toContain('not proof of spoofing');
  });

  it('does not decay trust on identical UI re-renders', () => {
    const registry = new ContinuousTrustRegistry();
    const first = registry.observe(base);
    const second = registry.observe(base);
    expect(second).toEqual(first);
  });

  it('drops trust faster than it recovers', () => {
    const registry = new ContinuousTrustRegistry();
    const first = registry.observe(base);
    const adverse = registry.observe({ ...base, connectionHealth: 'UNSTABLE', lastSeen: new Date(2000) });
    expect(adverse.trustScore).toBeLessThan(first.trustScore);
    const recovered = registry.observe({ ...base, connectionHealth: 'GOOD', lastSeen: new Date(3000) });
    expect(recovered.trustScore - adverse.trustScore).toBeLessThan(first.trustScore - adverse.trustScore);
  });
});
