import { describe, expect, it } from 'vitest';
import { appendEncounter, createRecoveryProfile, validateEncounter } from './recoveryWorkflow';

describe('recovery workflow helpers', () => {
  it('creates a lost-device profile with an explicit demo label', () => {
    const device = createRecoveryProfile('My CMF Buds', 'cmf-01', 'lost', true);

    expect(device.deviceName).toBe('My CMF Buds');
    expect(device.deviceId).toBe('cmf-01');
    expect(device.status).toBe('lost');
    expect(device.simulated).toBe(true);
  });

  it('updates a profile only when a valid observation is supplied', () => {
    const device = createRecoveryProfile('My CMF Buds', 'cmf-01', 'lost', true);
    const next = appendEncounter(device, {
      confidence: 0.88,
      source: 'SIMULATED',
      simulated: true,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      location: {
        lat: 37.7749,
        lng: -122.4194,
        address: 'San Francisco',
      },
    });

    expect(next.status).toBe('found');
    expect(next.communityReports).toBe(2);
    expect(next.lastDetected).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('blocks invalid real encounters that lack a location', () => {
    const error = validateEncounter({
      confidence: 0.7,
      source: 'REAL',
      simulated: false,
    });

    expect(error).toBe('Real encounters must include a location or a verified location estimate.');
  });
});
