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
