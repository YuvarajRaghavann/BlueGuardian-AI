// Pure TS implementations copied from frontend utils (trustScore, threatDetection, ml).
// The current classifier is a deterministic development classifier, not a trained/validated model.
import type { BluetoothDevice, ConnectionStatus, DeviceType, RiskLevel } from '../../../src/types';
import { calculateTrustScore } from '../../../src/utils/trustScore';
import { analyzeDeviceThreat } from '../../../src/utils/threatDetection';
import { classifyDevice } from '../../../src/ml/mlService';
import ThreatAssessment from '../models/ThreatAssessment';

function toBluetoothDevice(record: Record<string, any>): BluetoothDevice {
  const deviceTypes: DeviceType[] = ['smartphone', 'earbuds', 'headphones', 'smartwatch', 'laptop', 'iot', 'unknown'];
  const riskLevels: RiskLevel[] = ['trusted', 'low', 'medium', 'high'];
  const connectionStatuses: ConnectionStatus[] = ['connected', 'disconnected', 'connecting', 'unknown'];

  return {
    id: String(record.deviceId),
    name: record.name ?? record.deviceId,
    type: deviceTypes.includes(record.type) ? record.type : 'unknown',
    address: record.address,
    rssi: record.rssi,
    trusted: Boolean(record.trusted),
    blocked: Boolean(record.blocked),
    trustScore: typeof record.trustScore === 'number' && Number.isFinite(record.trustScore) ? record.trustScore : 60,
    riskLevel: riskLevels.includes(record.riskLevel) ? record.riskLevel : 'medium',
    connectionStatus: connectionStatuses.includes(record.connectionStatus)
      ? record.connectionStatus
      : record.gattConnected ? 'connected' : 'unknown',
    firstSeen: record.firstSeen instanceof Date ? record.firstSeen : new Date(record.firstSeen ?? Date.now()),
    lastSeen: record.lastSeen instanceof Date ? record.lastSeen : new Date(record.lastSeen ?? Date.now()),
    isKnown: Boolean(record.isKnown),
    manufacturer: record.manufacturer,
    services: (record.services ?? []).map((service: Record<string, any>) => ({
      uuid: service.uuid,
      name: service.name,
      characteristics: service.characteristics ?? [],
    })),
    discoverySource: record.discoverySource === 'SIMULATED' ? 'SIMULATED' : 'REAL',
    gattConnected: record.gattConnected,
    connectionHealth: record.connectionHealth,
  };
}

export async function assessDevice(record: Record<string, any>, ownerId?: string) {
  const device = toBluetoothDevice(record);
  const trust = calculateTrustScore(device);
  const rule = analyzeDeviceThreat(device);
  const ml = classifyDevice(device);

  // Retained existing ensemble weights for backwards compatibility. They are not empirically calibrated.
  const RULE_WEIGHT = 0.6;
  const ML_WEIGHT = 0.4;
  const mlRiskScore = (() => {
    const base: Record<string, number> = {
      BENIGN: 0,
      SUSPICIOUS: 30,
      POTENTIAL_SPOOFING: 60,
      POTENTIAL_UNAUTHORIZED_ACCESS: 70,
      ANOMALOUS_BEHAVIOR: 55,
      HIGH_RISK_DEVICE: 85,
    };
    return Math.round((base[ml.label] ?? 0) * ml.confidence);
  })();

  const combinedScore = Math.round(RULE_WEIGHT * rule.threatScore + ML_WEIGHT * mlRiskScore);
  const finalScore = Math.min(100, Math.max(0, combinedScore));
  const severityFromScore = (s: number) => s >= 75 ? 'critical' : s >= 50 ? 'high' : s >= 20 ? 'medium' : 'low';
  const finalSeverity = severityFromScore(finalScore);
  const finalClassification = ml.confidence > 0 ? ml.label : rule.category;
  // The development heuristic returns evidence strength, not measured accuracy.
  const overallConfidence = ml.confidence;

  const assessment = {
    deviceId: device.id,
    ...(ownerId ? { ownerId } : {}),
    trustScore: trust.score,
    trustRiskLevel: trust.riskLevel,
    ruleBasedThreatScore: rule.threatScore,
    mlRiskScore,
    finalThreatScore: finalScore,
    severity: finalSeverity,
    primaryCategory: finalClassification,
    reasons: [...rule.reasons, { code: 'ML_CLASSIFICATION', message: `Development classifier ${ml.label} (${Math.round(ml.confidence * 100)}%) – ${ml.explanation}` }],
    mlClassification: ml.label,
    mlConfidence: ml.confidence,
    modelName: ml.modelName,
    modelVersion: ml.modelVersion,
    modelValidationStatus: 'development-not-validated',
    status: 'active' as const,
    timestamp: new Date(),
  };

  // Persist every assessment within the authenticated owner's data scope when provided by an API route.
  await new ThreatAssessment(assessment).save();

  return { ...assessment, overallConfidence };
}
