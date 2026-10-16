import type { BluetoothDevice, ThreatAnalysis, ThreatReason, ThreatSeverity, ThreatCategory } from '../types/index.js';
import { calculateTrustScore } from './trustScore.js';

const SUSPICIOUS_NAME_PATTERNS = [
  /free\s*wifi/i,
  /hack/i,
  /attack/i,
  /spoof/i,
  /malware/i,
  /phishing/i,
];

function scoreToSeverity(score: number): ThreatSeverity {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

function isSuspiciousName(name: string): boolean {
  return SUSPICIOUS_NAME_PATTERNS.some((re) => re.test(name));
}

/** Unknown is an approval state, not proof of malicious behaviour. One RSSI
 * sample is not enough evidence to infer spoofing or an attack. */
export function analyzeDeviceThreat(device: BluetoothDevice): ThreatAnalysis {
  const trust = calculateTrustScore(device);
  const reasons: ThreatReason[] = [];
  let threatScore = 0;

  if (device.blocked) {
    // Owner policy state is important to display, but must not be counted as
    // evidence that the device itself is malicious.
    reasons.push({ code: 'BLOCKED_DEVICE', message: 'This device is blocked by owner policy. The block decision alone is not proof of an attack.' });
  }

  if (!device.isKnown) {
    reasons.push({
      code: 'UNKNOWN_DEVICE',
      message: 'This device is not yet in the owner-approved history. Unknown does not mean malicious.',
    });
  }

  if (trust.score < 30 && !device.blocked) {
    threatScore += 10;
    reasons.push({
      code: 'LOW_TRUST',
      message: `Device trust evidence is limited (${trust.score}/100); review it before granting access.`,
    });
  }

  if (isSuspiciousName(device.name)) {
    threatScore += 15;
    reasons.push({
      code: 'SUSPICIOUS_NAME',
      message: 'The advertised name contains a suspicious term. A name match alone is not proof of an attack.',
    });
  }

  if (device.connectionHealth === 'UNSTABLE') {
    threatScore += 25;
    reasons.push({
      code: 'UNSTABLE_CONNECTION',
      message: 'Bluetooth connection history is unstable. Verify the device and repeat the observation before treating this as malicious.',
    });
  } else if (device.connectionHealth === 'DEGRADED') {
    threatScore += 10;
    reasons.push({
      code: 'UNSTABLE_CONNECTION',
      message: 'Bluetooth connection quality is degraded; this is an advisory indicator, not proof of a threat.',
    });
  }

  threatScore = Math.min(100, Math.max(0, threatScore));

  let category: ThreatCategory = 'OTHER';
  if (device.blocked) category = 'BLOCKED_DEVICE';
  else if (isSuspiciousName(device.name)) category = 'SUSPICIOUS_NAME';
  else if (device.connectionHealth === 'UNSTABLE' || device.connectionHealth === 'DEGRADED') category = 'UNSTABLE_CONNECTION';
  else if (!device.isKnown) category = 'UNKNOWN_DEVICE';
  else if (reasons.some(reason => reason.code === 'LOW_TRUST')) category = 'LOW_TRUST';

  const severity = scoreToSeverity(threatScore);
  let recommendedAction = 'No immediate threat evidence detected. Keep normal approval controls enabled.';
  if (device.blocked) recommendedAction = 'Keep this device blocked according to owner policy; the block itself is not proof of an attack. Review independent signals separately.';
  if (severity === 'critical') recommendedAction = 'Multiple strong indicators are present. Keep the device isolated and review the evidence.';
  else if (severity === 'high') recommendedAction = 'Keep this device blocked and review the available evidence.';
  else if (severity === 'medium') recommendedAction = 'Review the device and gather another observation before making a security decision.';

  return {
    deviceId: device.id,
    deviceName: device.name,
    threatScore,
    severity,
    category,
    reasons,
    recommendedAction,
    analyzedAt: new Date(),
    discoverySource: device.discoverySource,
  };
}
