import type { BluetoothDevice, TrustAssessment, RiskLevel } from '../types/index.js';

/**
 * Explainable trust baseline. Unknown manufacturer/type/history is uncertainty,
 * not attack evidence. A single RSSI sample cannot measure signal consistency.
 * This is a heuristic score, not trained ML.
 */
export function calculateTrustScore(device: BluetoothDevice): TrustAssessment {
  const WEIGHTS = {
    knownDevice: 20,
    manufacturerReputation: 10,
    connectionHistory: 15,
    suspiciousBehavior: 25,
    signalConsistency: 10,
    deviceTypeTrust: 20,
  };

  const knownDevice = device.isKnown ? (device.trusted ? 100 : 75) : 60;
  const manufacturerReputation = getManufacturerReputation(device.manufacturer);
  const connectionHistory = device.connectionHealth === 'UNSTABLE'
    ? 30
    : device.connectionHealth === 'DEGRADED'
      ? 50
      : (device.trusted && device.isKnown ? 85 : 60);
  const suspiciousBehavior = device.blocked
    ? 0
    : device.connectionHealth === 'UNSTABLE'
      ? 35
      : device.connectionHealth === 'DEGRADED'
        ? 60
        : 85;
  const signalConsistency = 70;
  const deviceTypeTrust = getDeviceTypeTrust(device.type);

  const weightedScore =
    (knownDevice * WEIGHTS.knownDevice +
      manufacturerReputation * WEIGHTS.manufacturerReputation +
      connectionHistory * WEIGHTS.connectionHistory +
      suspiciousBehavior * WEIGHTS.suspiciousBehavior +
      signalConsistency * WEIGHTS.signalConsistency +
      deviceTypeTrust * WEIGHTS.deviceTypeTrust) / 100;

  const score = device.blocked ? 0 : Math.round(Math.min(100, Math.max(0, weightedScore)));
  const riskLevel = device.blocked ? 'high' : scoreToRiskLevel(score, device);

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
  if (!manufacturer) return 60;
  const reputable = ['Apple', 'Samsung', 'Google', 'Sony', 'Microsoft', 'Dell', 'Lenovo', 'CMF', 'Tile'];
  const lower = manufacturer.toLowerCase();
  return reputable.some((r) => lower.includes(r.toLowerCase())) ? 90 : 60;
}

function getDeviceTypeTrust(type: BluetoothDevice['type']): number {
  const map: Record<string, number> = {
    smartphone: 85,
    earbuds: 85,
    headphones: 85,
    smartwatch: 85,
    laptop: 90,
    iot: 60,
    unknown: 65,
  };
  return map[type] ?? 65;
}

function scoreToRiskLevel(score: number, device: BluetoothDevice): RiskLevel {
  if (score >= 80 && device.trusted && device.isKnown) return 'trusted';
  if (score >= 65) return 'low';
  if (score >= 45) return 'medium';
  return 'high';
}
