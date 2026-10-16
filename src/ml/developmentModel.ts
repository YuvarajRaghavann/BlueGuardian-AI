import type { MLPrediction, MLThreatClass } from '../types/index.js';
import type { ThreatClassificationModel } from './model.js';

const MODEL_NAME = 'BlueGuardian Evidence Heuristic';
const MODEL_VERSION = '0.3.0-heuristic';

const FEATURE_NAMES = [
  'normalizedTrustScore', 'normalizedRSSI', 'knownFlag', 'trustedFlag',
  'explicitlyBlockedFlag', 'serviceCountNorm', 'independentSecurityIndicatorCountNorm',
  'suspiciousNameFlag', 'connectionStatusFlag', 'deviceTypeRisk', 'discoverySourceFlag',
];

/**
 * Transparent development baseline, not a trained ML model.
 * "confidence" is heuristic evidence strength, not calibrated probability or accuracy.
 */
export class DevelopmentModel implements ThreatClassificationModel {
  name = MODEL_NAME;
  version = MODEL_VERSION;

  predict(features: number[]): MLPrediction {
    const safe = Array.from({ length: FEATURE_NAMES.length }, (_, index) => {
      const value = features[index];
      return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : 0;
    });

    const trustNorm = safe[0];
    const knownFlag = safe[2];
    const trustedFlag = safe[3];
    const blockedFlag = safe[4];
    const securityFlagCountNorm = safe[6];
    const suspiciousNameFlag = safe[7];

    let label: MLThreatClass = 'INSUFFICIENT_EVIDENCE';
    let confidence = 0.35;
    const reasons: string[] = [];

    if (blockedFlag >= 0.5) {
      reasons.push('the device is blocked by owner policy; this decision alone is not evidence of malicious behaviour');
    }

    if (securityFlagCountNorm >= 0.66 && suspiciousNameFlag >= 0.5) {
      label = 'POTENTIAL_UNAUTHORIZED_ACCESS';
      confidence = 0.76;
      reasons.push('multiple independent security indicators are present');
      reasons.push('the advertised name contains a suspicious term');
    } else if (suspiciousNameFlag >= 0.5) {
      label = 'SUSPICIOUS';
      confidence = 0.58;
      reasons.push('the advertised name contains a suspicious term');
      reasons.push('a name match alone does not prove malicious behaviour');
    } else if (knownFlag >= 0.5 && trustedFlag >= 0.5 && trustNorm >= 0.7) {
      label = 'BENIGN';
      confidence = 0.8;
      reasons.push('the device is known and explicitly trusted');
      reasons.push('no independent threat indicator is present in the supplied features');
    } else if (trustNorm < 0.25 && securityFlagCountNorm >= 0.66) {
      label = 'POTENTIAL_UNAUTHORIZED_ACCESS';
      confidence = 0.65;
      reasons.push('low trust is accompanied by multiple independent security indicators');
    } else {
      label = 'INSUFFICIENT_EVIDENCE';
      confidence = 0.35;
      reasons.push('no strong positive threat indicator is present in this single observation');
      reasons.push('there is not enough evidence to verify that the device is benign');
      if (knownFlag < 0.5 || trustedFlag < 0.5) {
        reasons.push('the device is not yet explicitly trusted; retain manual approval until the owner verifies it');
      }
    }

    return {
      label,
      confidence,
      modelName: this.name,
      modelVersion: this.version,
      predictedAt: new Date(),
      featuresUsed: FEATURE_NAMES,
      explanation: reasons.join('. ') + '. Heuristic evidence strength only; this is not a trained or calibrated model.',
    };
  }
}
