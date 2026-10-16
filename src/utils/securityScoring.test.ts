import { describe, expect, it } from 'vitest';
import type { BluetoothDevice } from '../types';
import { calculateTrustScore } from './trustScore';
import { analyzeDeviceThreat } from './threatDetection';
import { extractDeviceFeatures } from '../ml/featureExtractor';
import { DevelopmentModel } from '../ml/developmentModel';

const unknownTile: BluetoothDevice = {
  id: 'tile-01',
  name: 'Tile',
  type: 'unknown',
  address: 'C0:AD:19:44:DF:7F',
  rssi: -38,
  trusted: false,
  trustScore: 0,
  riskLevel: 'high',
  connectionStatus: 'unknown',
  connectionHealth: 'UNAVAILABLE',
  firstSeen: new Date('2026-10-16T12:00:00.000Z'),
  lastSeen: new Date('2026-10-16T12:01:00.000Z'),
  isKnown: false,
  manufacturer: undefined,
  services: [{ uuid: '0000feed-0000-1000-8000-00805f9b34fb', characteristics: [] }],
  discoverySource: 'REAL',
  blocked: false,
};

describe('BlueGuardian false-positive safeguards', () => {
  it('does not assign high risk solely because a device is unknown or its manufacturer is missing', () => {
    const trust = calculateTrustScore(unknownTile);
    expect(trust.score).toBeGreaterThanOrEqual(60);
    expect(trust.riskLevel).not.toBe('high');
  });

  it('does not label a generic Tile name as suspicious or score it as a threat', () => {
    const threat = analyzeDeviceThreat(unknownTile);
    expect(threat.threatScore).toBe(0);
    expect(threat.severity).toBe('low');
    expect(threat.reasons.map(reason => reason.code)).toContain('UNKNOWN_DEVICE');
    expect(threat.reasons.map(reason => reason.code)).not.toContain('BLOCKED_DEVICE');
    expect(threat.reasons.map(reason => reason.code)).not.toContain('SUSPICIOUS_NAME');
  });

  it('does not infer spoofing from one strong RSSI observation', () => {
    const threat = analyzeDeviceThreat({ ...unknownTile, rssi: -20 });
    expect(threat.threatScore).toBe(0);
    expect(threat.reasons.map(reason => reason.code)).not.toContain('UNUSUAL_SIGNAL');
  });

  it('only sets the blocked model feature for an explicit app block', () => {
    expect(extractDeviceFeatures(unknownTile).values[4]).toBe(0);
    expect(extractDeviceFeatures({ ...unknownTile, blocked: true }).values[4]).toBe(1);
  });

  it('uses the evidence heuristic deterministically instead of a hash-picked class', () => {
    const features = extractDeviceFeatures(unknownTile).values;
    const model = new DevelopmentModel();
    const first = model.predict(features);
    const second = model.predict(features);
    expect(first.label).toBe('BENIGN');
    expect(first.label).toBe(second.label);
    expect(first.confidence).toBe(second.confidence);
    expect(first.modelName).toBe('BlueGuardian Evidence Heuristic');
    expect(first.explanation).toContain('not a trained or calibrated model');
  });

  it('retains a high-risk assessment for an explicitly blocked device', () => {
    const blocked = { ...unknownTile, blocked: true };
    expect(calculateTrustScore(blocked).riskLevel).toBe('high');
    expect(analyzeDeviceThreat(blocked).threatScore).toBeGreaterThanOrEqual(70);
    expect(new DevelopmentModel().predict(extractDeviceFeatures(blocked).values).label).toBe('HIGH_RISK_DEVICE');
  });
});
