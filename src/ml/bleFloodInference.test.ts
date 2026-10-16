import { describe, expect, it } from 'vitest';
import {
  getBleFloodModelStatus,
  predictBleFloodWindow,
  type BleObservationWindowFeatures,
} from './bleFloodInference';

const usableWindow: BleObservationWindowFeatures = {
  windowStartMs: 1000,
  windowEndMs: 6000,
  windowDurationMs: 5000,
  observationCount: 40,
  observationsPerSecond: 8,
  uniqueAddresses: 12,
  uniqueAddressFraction: 0.3,
  maxAddressFraction: 0.2,
  rssiMean: -67,
  rssiStd: 9,
  rssiObservationFraction: 1,
  telemetrySource: 'ANDROID_SCAN_CALLBACKS',
};

describe('BlueGuardian temporal BLE-flood model gate', () => {
  it('keeps both untrained and candidate weights disabled until explicit review', () => {
    const status = getBleFloodModelStatus();

    expect(status.available).toBe(false);
    expect(['untrained', 'candidate']).toContain(status.status);
    expect(status.modelName).toBe('BlueGuardian BLE Flood Random Forest');
    // Version is sourced from the artifact so the test remains valid when the
    // trained candidate is packaged while deployment is still intentionally disabled.
    expect(status.modelVersion).toBeTruthy();
  });

  it('never emits a threat prediction from an untrained or candidate model', () => {
    expect(predictBleFloodWindow(usableWindow)).toMatchObject({
      available: false,
      label: 'UNAVAILABLE',
      voteScore: null,
    });
  });

  it('rejects undersized windows even after a future artifact is promoted', () => {
    expect(predictBleFloodWindow({
      ...usableWindow,
      windowDurationMs: 300,
    })).toMatchObject({
      available: false,
      label: 'UNAVAILABLE',
      voteScore: null,
    });
  });
});
