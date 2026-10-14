import type { MLPrediction, MLThreatClass } from '../types/index.js';
import type { ThreatClassificationModel } from './model.js';

const MODEL_NAME = 'BlueGuardian Development Classifier';
const MODEL_VERSION = '0.1.0-demo';
const CLASSES: MLThreatClass[] = [
  'BENIGN',
  'SUSPICIOUS',
  'POTENTIAL_SPOOFING',
  'POTENTIAL_UNAUTHORIZED_ACCESS',
  'ANOMALOUS_BEHAVIOR',
  'HIGH_RISK_DEVICE',
];

function deterministicHash(arr: number[]): number {
  // simple deterministic hash for reproducible pseudo-random
  let h = 0;
  for (const v of arr) {
    h = (h * 31 + Math.round(v * 1000)) >>> 0;
  }
  return h;
}

function pickClass(hash: number, weights: number[]): { index: number; confidence: number } {
  // normalize weights to sum 1
  const sum = weights.reduce((a, b) => a + b, 0);
  const probs = weights.map((w) => w / sum);
  // use hash to pick
  let r = (hash % 10000) / 10000;
  let cum = 0;
  for (let i = 0; i < probs.length; i++) {
    cum += probs[i];
    if (r <= cum) return { index: i, confidence: probs[i] };
  }
  return { index: probs.length - 1, confidence: probs[probs.length - 1] };
}

export class DevelopmentModel implements ThreatClassificationModel {
  name = MODEL_NAME;
  version = MODEL_VERSION;

  predict(features: number[]): MLPrediction {
    // Expect features length 11 as per featureExtractor
    const fv = features;
    // Compute simple rule-based weights for each class
    // Order: BENIGN, SUSPICIOUS, POTENTIAL_SPOOFING, POTENTIAL_UNAUTHORIZED_ACCESS, ANOMALOUS_BEHAVIOR, HIGH_RISK_DEVICE
    // Use heuristics from features
    const [
      trustNorm, // 0
      rssiNorm, // 1
      knownFlag, // 2
      trustedFlag, // 3
      blockedFlag, // 4
      serviceCountNorm, // 5
      securityFlagCountNorm, // 6
      suspiciousNameFlag, // 7
      connectionStatusFlag, // 8
      deviceTypeRisk, // 9
      discoverySourceFlag, // 10
    ] = fv;

    // base weights
    const weights = CLASSES.map(() => 1);

    // BENIGN: high trust, known, trusted, low risk type, real source
    weights[0] += (1 - trustNorm) * -2 + knownFlag * 2 + trustedFlag * 2 + (1 - deviceTypeRisk) * 2 + discoverySourceFlag * 1;

    // SUSPICIOUS: low trust, unknown, suspicious name, some security flags
    weights[1] += (1 - trustNorm) * 2 + (1 - knownFlag) * 2 + suspiciousNameFlag * 2 + securityFlagCountNorm * 1.5;

    // POTENTIAL_SPOOFING: unusual RSSI (very strong), high deviceTypeRisk, blocked flag
    weights[2] += (rssiNorm > 0.9 ? 3 : 0) + deviceTypeRisk * 1.5 + blockedFlag * 2;

    // POTENTIAL_UNAUTHORIZED_ACCESS: unknown, not trusted, many security flags, low services
    weights[3] += (1 - knownFlag) * 2 + (1 - trustedFlag) * 2 + securityFlagCountNorm * 2 + (1 - serviceCountNorm) * 1;

    // ANOMALOUS_BEHAVIOR: combination of unusual signal, unknown connection, high deviceTypeRisk
    weights[4] += (rssiNorm > 0.9 || rssiNorm < 0.1 ? 2 : 0) + (1 - connectionStatusFlag) * 1.5 + deviceTypeRisk * 1.5;

    // HIGH_RISK_DEVICE: blockedFlag, high riskLevel implied, low trust
    weights[4] += blockedFlag * 3; // note overlapping with ANOMALOUS_BEHAVIOR index 4? adjust
    // Actually HIGH_RISK_DEVICE is index 5
    weights[5] += blockedFlag * 3 + (1 - trustNorm) * 2 + deviceTypeRisk * 2;

    // Ensure non-negative
    const clamped = weights.map((w) => Math.max(0.01, w));

    const hash = deterministicHash(fv);
    const { index, confidence } = pickClass(hash, clamped);
    const label = CLASSES[index];

    // Build explanation
    const reasons = [];
    if (trustNorm < 0.4) reasons.push('low trust score');
    if (!knownFlag) reasons.push('device not known');
    if (!trustedFlag) reasons.push('device not trusted');
    if (blockedFlag) reasons.push('device marked high risk/blocked');
    if (suspiciousNameFlag) reasons.push('suspicious device name');
    if (securityFlagCountNorm > 0.4) reasons.push('multiple security indicators');
    if (rssiNorm > 0.9) reasons.push('unusually strong signal');
    if (rssiNorm < 0.1) reasons.push('unusually weak signal');
    if (deviceTypeRisk > 0.5) reasons.push('device type considered higher risk');

    const explanation = reasons.length
      ? `Prediction influenced by ${reasons.join(', ')}.`
      : 'No strong risk indicators detected.';

    return {
      label,
      confidence: Math.max(0.01, Math.min(0.99, confidence)),
      modelName: this.name,
      modelVersion: this.version,
      predictedAt: new Date(),
      featuresUsed: [
        'normalizedTrustScore',
        'normalizedRSSI',
        'knownFlag',
        'trustedFlag',
        'blockedFlag',
        'serviceCountNorm',
        'securityFlagCountNorm',
        'suspiciousNameFlag',
        'connectionStatusFlag',
        'deviceTypeRisk',
        'discoverySourceFlag',
      ],
      explanation,
    };
  }
}