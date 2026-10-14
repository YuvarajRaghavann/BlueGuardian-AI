import type { BluetoothDevice, GattServiceInfo, ThreatAnalysis, ThreatReason, ThreatSeverity, ThreatCategory } from '../types/index.js';
import { calculateTrustScore } from './trustScore.js';

const SUSPICIOUS_NAME_PATTERNS = [
  /unknown/i,
  /free\s*wifi/i,
  /hack/i,
  /attack/i,
  /spoof/i,
  /test/i,
  /^device\s*\d+$/i,
  /^bt[-_]?\d+$/i,
];

const RSSI_UNUSUALLY_STRONG = -30; // dBm
const RSSI_UNUSUALLY_WEAK = -90; // dBm

function scoreToSeverity(score: number): ThreatSeverity {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

function isSuspiciousName(name: string): boolean {
  return SUSPICIOUS_NAME_PATTERNS.some((re) => re.test(name));
}

export function analyzeDeviceThreat(device: BluetoothDevice): ThreatAnalysis {
  const trust = calculateTrustScore(device);
  const reasons: ThreatReason[] = [];
  let threatScore = 0;

  // RULE 1: Very Low Trust
  if (trust.score < 30) {
    const add = 40;
    threatScore += add;
    reasons.push({
      code: 'LOW_TRUST',
      message: `Device has a very low trust score (${trust.score}/100).`,
    });
  }

  // RULE 2: Unknown Device
  if (!device.isKnown) {
    const add = 25;
    threatScore += add;
    reasons.push({
      code: 'UNKNOWN_DEVICE',
      message: 'Device has not been trusted by the user.',
    });
  }

  // RULE 3: Blocked Device (device.trusted === false && riskLevel === 'high' as proxy)
  if (!device.trusted && device.riskLevel === 'high') {
    const add = 35;
    threatScore += add;
    reasons.push({
      code: 'BLOCKED_DEVICE',
      message: 'Device has previously been blocked or marked high risk.',
    });
  }

  // RULE 4: Suspicious Device Name
  if (isSuspiciousName(device.name)) {
    const add = 20;
    threatScore += add;
    reasons.push({
      code: 'SUSPICIOUS_NAME',
      message: 'Device name matches a suspicious naming pattern.',
    });
  }

  // RULE 5: Weak Security (no services or only generic)
  const hasOnlyGenericServices = device.services.length === 0 ||
    device.services.every((service: GattServiceInfo) => service.uuid.startsWith('00001800') || service.uuid.startsWith('00001801'));
  if (hasOnlyGenericServices && device.services.length > 0) {
    const add = 10;
    threatScore += add;
    reasons.push({
      code: 'WEAK_SECURITY',
      message: 'Device exposes only generic Bluetooth services.',
    });
  }

  // RULE 6: Unusual Signal Strength
  const rssi = device.rssi ?? -65;

  if (rssi > RSSI_UNUSUALLY_STRONG) {
    const add = 15;
    threatScore += add;
    reasons.push({
      code: 'UNUSUAL_SIGNAL',
      message: `Signal strength unusually strong (${device.rssi} dBm), possible proximity spoofing.`,
    });
  } else if (rssi < RSSI_UNUSUALLY_WEAK) {
    const add = 5;
    threatScore += add;
    reasons.push({
      code: 'UNUSUAL_SIGNAL',
      message: `Signal strength very weak (${device.rssi} dBm), may indicate distant or hidden device.`,
    });
  }

  // Cap score
  threatScore = Math.min(100, Math.max(0, threatScore));

  // Determine primary category based on highest contributing rule
  let category: ThreatCategory = 'OTHER';
  if (reasons.some(r => r.code === 'LOW_TRUST')) category = 'LOW_TRUST';
  else if (reasons.some(r => r.code === 'UNKNOWN_DEVICE')) category = 'UNKNOWN_DEVICE';
  else if (reasons.some(r => r.code === 'BLOCKED_DEVICE')) category = 'BLOCKED_DEVICE';
  else if (reasons.some(r => r.code === 'SUSPICIOUS_NAME')) category = 'SUSPICIOUS_NAME';
  else if (reasons.some(r => r.code === 'WEAK_SECURITY')) category = 'WEAK_SECURITY';
  else if (reasons.some(r => r.code === 'UNUSUAL_SIGNAL')) category = 'UNUSUAL_SIGNAL';

  const severity = scoreToSeverity(threatScore);

  // Recommended action
  let recommendedAction = 'No immediate action required.';
  if (severity === 'critical') recommendedAction = 'Review the device immediately and avoid connecting until verified.';
  else if (severity === 'high') recommendedAction = 'Review the device and consider marking as unknown or blocking.';
  else if (severity === 'medium') recommendedAction = 'Monitor the device; verify its identity if possible.';

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