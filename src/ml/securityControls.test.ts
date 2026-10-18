import { describe, expect, it } from 'vitest';
import {
  compareRfFingerprint,
  enrollRfFingerprint,
  evaluatePairingSecurity,
  runSecureRecovery,
  verifyProximity,
  type RecoveryAdapter,
} from './securityControls.js';

describe('BTGuard security controls', () => {
  it('rejects pairing profiles that do not meet the security baseline', () => {
    const result = evaluatePairingSecurity({
      secureConnections: false,
      encrypted: true,
      authenticated: false,
      keySizeBytes: 7,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('requires fresh Channel Sounding evidence within the configured boundary', () => {
    expect(verifyProximity(undefined).allowed).toBe(false);
    expect(verifyProximity({
      channelSoundingDistanceM: 2,
      rssiDbm: -48,
      maximumClaimedDistanceM: 3,
      capturedAt: Date.now(),
      calibratedRssiDistanceM: 2.5,
    }).allowed).toBe(true);
    expect(verifyProximity({
      channelSoundingDistanceM: 8,
      rssiDbm: -48,
      maximumClaimedDistanceM: 3,
      capturedAt: Date.now(),
    }).allowed).toBe(false);
  });

  it('requires multiple samples before enrolling an RF baseline', () => {
    expect(enrollRfFingerprint('device-1', [{ cfoKHz: 1, rssiDbm: -50, capturedAt: Date.now() }])).toBeUndefined();
    const samples = Array.from({ length: 5 }, (_, index) => ({ cfoKHz: 1 + index * 0.02, rssiDbm: -50 - index, capturedAt: Date.now() }));
    const baseline = enrollRfFingerprint('device-1', samples);
    expect(baseline?.sampleCount).toBe(5);
    expect(compareRfFingerprint(baseline!, { cfoKHz: 20, rssiDbm: -50, capturedAt: Date.now() }).anomaly).toBe(true);
  });

  it('requires owner confirmation before starting recovery', async () => {
    const adapter: RecoveryAdapter = {
      containDevice: async () => undefined,
      revokeBond: async () => undefined,
      rotateCredentials: async () => undefined,
      beginOutOfBandRepair: async () => undefined,
      verifyNewSession: async () => true,
    };
    await expect(runSecureRecovery('device-1', { ownerConfirmed: false, adapter })).rejects.toThrow('Owner confirmation');
  });

  it('records ordered recovery steps and stops if the new session fails verification', async () => {
    const called: string[] = [];
    const adapter: RecoveryAdapter = {
      containDevice: async () => { called.push('contain'); },
      revokeBond: async () => { called.push('revoke'); },
      rotateCredentials: async () => { called.push('rotate'); },
      beginOutOfBandRepair: async () => { called.push('repair'); },
      verifyNewSession: async () => { called.push('verify'); return false; },
    };
    await expect(runSecureRecovery('device-1', { ownerConfirmed: true, adapter })).rejects.toThrow('new session did not pass verification');
    expect(called).toEqual(['contain', 'revoke', 'rotate', 'repair', 'verify']);
  });
});
