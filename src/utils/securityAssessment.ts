import type { BluetoothDevice, TrustAssessment, ThreatReason, ThreatSeverity, MLPrediction, MLThreatClass, SecurityAssessment } from '../types';
import { calculateTrustScore } from './trustScore';
import { analyzeDeviceThreat } from './threatDetection';
import { classifyDevice } from '../ml/mlService';
import { btGuardRegistry } from '../ml/btguard';

const RULE_WEIGHT = 0.6;
const ML_WEIGHT = 0.4; // Development integration weighting

function mlClassToRiskScore(label: MLThreatClass, confidence: number): number {
  // Map ML class to a 0-100 risk contribution
  const base: Record<MLThreatClass, number> = {
    INSUFFICIENT_EVIDENCE: 0,
    BENIGN: 0,
    SUSPICIOUS: 30,
    POTENTIAL_SPOOFING: 60,
    POTENTIAL_UNAUTHORIZED_ACCESS: 70,
    ANOMALOUS_BEHAVIOR: 55,
    HIGH_RISK_DEVICE: 85,
  };
  const b = base[label] ?? 0;
  // Scale by confidence
  return Math.round(b * confidence);
}

function severityFromScore(score: number): ThreatSeverity {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

function combineReasons(ruleReasons: ThreatReason[], mlPrediction?: MLPrediction): ThreatReason[] {
  const combined = [...ruleReasons];
  if (mlPrediction && mlPrediction.confidence > 0) {
    combined.push({
      code: 'ML_CLASSIFICATION',
      message: `ML model (${mlPrediction.modelName} v${mlPrediction.modelVersion}) classified as ${mlPrediction.label} with ${Math.round(mlPrediction.confidence * 100)}% confidence. ${mlPrediction.explanation}`,
    });
  }
  return combined;
}

export function assessDeviceSecurity(device: BluetoothDevice): SecurityAssessment {
  // 1. Trust score and BTGuard continuous policy assessment
  const trust: TrustAssessment = calculateTrustScore(device);
  const btGuard = btGuardRegistry.observe(device);

  // 2. Rule-based threat analysis
  const rule = analyzeDeviceThreat(device);

  // 3. ML classification
  const mlPrediction = classifyDevice(device);

  // 4. Combine scores
  const mlRiskScore = mlClassToRiskScore(mlPrediction.label, mlPrediction.confidence);
  const combinedScore = Math.round(
    RULE_WEIGHT * rule.threatScore + ML_WEIGHT * mlRiskScore
  );
  const finalScore = Math.min(100, Math.max(0, combinedScore));
  const finalSeverity = severityFromScore(finalScore);

  // Final classification label
  const finalClassification = mlPrediction.confidence > 0 ? mlPrediction.label : rule.category;

  // Heuristic confidence is evidence strength, not a calibrated attack probability.
  const overallConfidence = mlPrediction.confidence;

  // Reasons
  const reasons = combineReasons(rule.reasons, mlPrediction);
  if (btGuard.level !== 'FULL') {
    reasons.push({
      code: 'BTGUARD_POLICY',
      message: `BTGuard policy: ${btGuard.level} capability level (trust ${btGuard.trustScore}/100). ${btGuard.reasons.join(' ')} App-level capabilities are advisory until enforced at the native connection boundary.`,
    });
  } else if (btGuard.requiresManualReview) {
    reasons.push({
      code: 'BTGUARD_TELEMETRY_GAP',
      message: 'BTGuard has limited telemetry coverage. Channel Sounding, negotiated crypto state, and RF fingerprint data are not assumed available unless supplied by the controller.',
    });
  }

  // Recommended action based on final severity
  let recommendedAction = 'No immediate action required.';
  if (finalSeverity === 'critical') recommendedAction = 'Review the device immediately and avoid connecting until verified.';
  else if (finalSeverity === 'high') recommendedAction = 'Review the device and consider marking as unknown or blocking.';
  else if (finalSeverity === 'medium') recommendedAction = 'Monitor the device; verify its identity if possible.';
  if (btGuard.level === 'ISOLATED') recommendedAction = 'BTGuard recommends isolation under current policy. Keep the device blocked and verify independent evidence.';
  else if (btGuard.level === 'RESTRICTED' && finalSeverity === 'low') recommendedAction = 'BTGuard recommends restricted capabilities pending owner verification; proximity and controller security telemetry are not fully available.';

  return {
    trustScore: trust.score,
    trustRiskLevel: trust.riskLevel,
    ruleBasedThreatScore: rule.threatScore,
    ruleBasedSeverity: rule.severity,
    ruleBasedCategory: rule.category,
    ruleBasedReasons: rule.reasons,
    mlPrediction,
    finalThreatScore: finalScore,
    finalSeverity,
    finalClassification,
    confidence: overallConfidence,
    reasons,
    recommendedAction,
  };
}