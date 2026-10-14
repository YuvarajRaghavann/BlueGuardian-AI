import type { BluetoothDevice, TrustAssessment, RiskLevel } from '../types/index.js';

/**
 * Rule‑Based Trust Engine
 * Pure function – no side effects, easy to unit‑test and replace with an AI model later.
 */
export function calculateTrustScore(device: BluetoothDevice): TrustAssessment {
  const WEIGHTS = {
    knownDevice: 25,
    manufacturerReputation: 20,
    connectionHistory: 15,
    suspiciousBehavior: 20,
    signalConsistency: 10,
    deviceTypeTrust: 10,
  };

  const knownDevice = device.isKnown ? 100 : 0;
  const manufacturerReputation = getManufacturerReputation(device.manufacturer);
  const connectionHistory = device.trusted ? 80 : 20;
  const suspiciousBehavior = device.riskLevel === 'high' ? 0 : device.riskLevel === 'medium' ? 40 : 80;
  const rssi = device.rssi ?? -65;
  const signalConsistency = Math.min(100, Math.max(0, 100 + rssi));
  const deviceTypeTrust = getDeviceTypeTrust(device.type);

  const weightedScore =
    (knownDevice * WEIGHTS.knownDevice +
      manufacturerReputation * WEIGHTS.manufacturerReputation +
      connectionHistory * WEIGHTS.connectionHistory +
      suspiciousBehavior * WEIGHTS.suspiciousBehavior +
      signalConsistency * WEIGHTS.signalConsistency +
      deviceTypeTrust * WEIGHTS.deviceTypeTrust) /
    100;

  const score = Math.round(Math.min(100, Math.max(0, weightedScore)));
  const riskLevel = scoreToRiskLevel(score);

  return {
    score,
    riskLevel,
    factors: {
      knownDevice: !!device.isKnown,
      manufacturerReputation,
      connectionHistory,
      suspiciousBehavior,
      signalConsistency,
      deviceTypeTrust,
    },
  };
}

function getManufacturerReputation(manufacturer?: string): number {
  if (!manufacturer) return 50;
  const reputable = ['Apple', 'Samsung', 'Google', 'Sony', 'Microsoft', 'Dell', 'Lenovo', 'CMF'];
  const lower = manufacturer.toLowerCase();
  return reputable.some((r) => lower.includes(r.toLowerCase())) ? 90 : 50;
}

function getDeviceTypeTrust(type: BluetoothDevice['type']): number {
  const map: Record<string, number> = {
    smartphone: 85,
    earbuds: 80,
    headphones: 80,
    smartwatch: 80,
    laptop: 90,
    iot: 40,
    unknown: 30,
  };
  return map[type] ?? 30;
}

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 80) return 'trusted';
  if (score >= 60) return 'low';
  if (score >= 40) return 'medium';
  return 'high';
}