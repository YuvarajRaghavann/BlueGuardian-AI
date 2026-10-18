import type { BluetoothDevice } from '../types/index.js';

/**
 * BTGuard is an evidence-fusion prototype integrated with BlueGuardian's
 * current device model. Missing hardware telemetry is represented as unknown,
 * never fabricated. This is a policy engine, not a trained ML model.
 */
export type BtGuardLevel = 'FULL' | 'RESTRICTED' | 'ISOLATED';
export type BtGuardCapability = 'read' | 'audio' | 'file_transfer' | 'pair' | 'write';
export interface BtGuardTelemetry {
  secureConnections?: boolean;
  encrypted?: boolean;
  authenticated?: boolean;
  keySizeBytes?: number;
  channelSoundingDistanceM?: number;
  rssiDbm?: number;
  cfoKHz?: number;
  packetRate?: number;
  pairingAttempts?: number;
  errorRate?: number;
  interArrivalJitterMs?: number;
  observedAt?: number;
}
export interface BtGuardAssessment {
  deviceId: string;
  trustScore: number;
  level: BtGuardLevel;
  reasons: string[];
  telemetryCoverage: string[];
  capabilities: BtGuardCapability[];
  requiresManualReview: boolean;
}
export interface BtGuardSnapshot extends BtGuardAssessment {
  observedAt: number;
}

const FULL_CAPABILITIES: BtGuardCapability[] = ['read', 'audio', 'file_transfer', 'pair', 'write'];
const RESTRICTED_CAPABILITIES: BtGuardCapability[] = ['read', 'audio'];
const ISOLATED_CAPABILITIES: BtGuardCapability[] = [];
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

function inferLevel(score: number, blocked: boolean): BtGuardLevel {
  if (blocked || score < 30) return 'ISOLATED';
  if (score < 70) return 'RESTRICTED';
  return 'FULL';
}

/** Stateless evidence assessment. RSSI alone is never treated as spoofing proof. */
export function assessBtGuard(
  device: BluetoothDevice,
  telemetry: BtGuardTelemetry = {},
): BtGuardAssessment {
  let score = 70;
  const reasons: string[] = [];
  const coverage: string[] = [];

  if (device.discoverySource !== 'REAL') {
    score = 50;
    reasons.push('Simulated discovery: this observation cannot establish real radio trust.');
  } else {
    coverage.push('real-device discovery');
  }

  if (device.isKnown && device.trusted) {
    score += 15;
    reasons.push('Owner-approved device identity is present.');
  } else {
    score -= 8;
    reasons.push('Device is not explicitly owner-trusted; privileged actions remain restricted.');
  }

  if (device.blocked) {
    score = 0;
    reasons.push('Device is blocked by owner policy.');
  }

  if (device.connectionHealth === 'UNSTABLE') {
    score -= 25;
    reasons.push('Connection history is unstable.');
  } else if (device.connectionHealth === 'DEGRADED') {
    score -= 10;
    reasons.push('Connection quality is degraded.');
  } else if (device.connectionHealth === 'GOOD') {
    score += 3;
    coverage.push('connection-health status');
  }

  if (typeof telemetry.secureConnections === 'boolean') {
    coverage.push('LE Secure Connections state');
    if (!telemetry.secureConnections) {
      score -= 30;
      reasons.push('LE Secure Connections was reported disabled.');
    }
  }
  if (typeof telemetry.encrypted === 'boolean') {
    coverage.push('link encryption state');
    if (!telemetry.encrypted) {
      score -= 35;
      reasons.push('Link encryption was reported inactive.');
    }
  }
  if (typeof telemetry.authenticated === 'boolean') {
    coverage.push('pairing authentication state');
    if (!telemetry.authenticated) {
      score -= 25;
      reasons.push('Pairing authentication was not reported.');
    }
  }
  if (typeof telemetry.keySizeBytes === 'number') {
    coverage.push('negotiated key size');
    if (telemetry.keySizeBytes < 16) {
      score -= 30;
      reasons.push(`Negotiated key size (${telemetry.keySizeBytes} bytes) is below the configured 16-byte minimum.`);
    }
  }

  if (typeof telemetry.channelSoundingDistanceM === 'number' && typeof telemetry.rssiDbm === 'number') {
    coverage.push('Channel Sounding distance and RSSI');
    // This is only a coarse inconsistency indicator. Environment calibration is required.
    const estimatedDistance = Math.pow(10, (-45 - telemetry.rssiDbm) / 20);
    const difference = Math.abs(telemetry.channelSoundingDistanceM - estimatedDistance);
    if (difference > Math.max(8, telemetry.channelSoundingDistanceM * 1.5)) {
      score -= 15;
      reasons.push('Channel Sounding distance and RSSI-derived distance are inconsistent; verify in a calibrated environment.');
    }
  } else {
    reasons.push('Channel Sounding/RSSI cross-check unavailable; no proximity assurance is claimed.');
  }

  if (typeof telemetry.cfoKHz === 'number') {
    coverage.push('RF carrier-frequency offset');
    // A single CFO sample cannot identify a clone. Requires an enrolled baseline.
    reasons.push('CFO telemetry is present, but clone detection requires an enrolled multi-sample fingerprint.');
  }
  if (typeof telemetry.packetRate === 'number' || typeof telemetry.pairingAttempts === 'number' || typeof telemetry.errorRate === 'number' || typeof telemetry.interArrivalJitterMs === 'number') {
    coverage.push('link behaviour counters');
    if ((telemetry.packetRate ?? 0) > 100 || (telemetry.pairingAttempts ?? 0) >= 5 || (telemetry.errorRate ?? 0) > 0.2 || (telemetry.interArrivalJitterMs ?? 0) > 10) {
      score -= 20;
      reasons.push('Link-behaviour counters exceed a conservative anomaly threshold; collect more windows before confirming an attack.');
    }
  }

  const trustScore = clamp(Math.round(score));
  const level = inferLevel(trustScore, Boolean(device.blocked));
  const capabilities = level === 'FULL'
    ? [...FULL_CAPABILITIES]
    : level === 'RESTRICTED'
      ? [...RESTRICTED_CAPABILITIES]
      : [...ISOLATED_CAPABILITIES];

  return {
    deviceId: device.id,
    trustScore,
    level,
    reasons,
    telemetryCoverage: coverage,
    capabilities,
    requiresManualReview: level !== 'FULL' || coverage.length < 3,
  };
}

/**
 * Stateful continuous trust binding. Only a changed observation is processed;
 * identical UI re-renders do not repeatedly decay a device's trust score.
 */
export class ContinuousTrustRegistry {
  private snapshots = new Map<string, BtGuardSnapshot>();
  private signatures = new Map<string, string>();

  observe(device: BluetoothDevice, telemetry: BtGuardTelemetry = {}): BtGuardSnapshot {
    const observedAt = telemetry.observedAt ?? device.lastSeen.getTime();
    const signature = JSON.stringify({ device, telemetry: { ...telemetry, observedAt: undefined } });
    const previous = this.snapshots.get(device.id);
    if (previous && this.signatures.get(device.id) === signature) return previous;

    const current = assessBtGuard(device, telemetry);
    // Trust falls quickly on new adverse evidence and recovers slowly after it clears.
    const smoothed = previous
      ? Math.round(previous.trustScore + (current.trustScore < previous.trustScore
        ? 0.65 : 0.2) * (current.trustScore - previous.trustScore))
      : current.trustScore;
    const trustScore = clamp(smoothed);
    const level = inferLevel(trustScore, Boolean(device.blocked));
    const snapshot: BtGuardSnapshot = {
      ...current,
      trustScore,
      level,
      capabilities: level === 'FULL' ? [...FULL_CAPABILITIES] : level === 'RESTRICTED' ? [...RESTRICTED_CAPABILITIES] : [...ISOLATED_CAPABILITIES],
      observedAt,
    };
    this.signatures.set(device.id, signature);
    this.snapshots.set(device.id, snapshot);
    return snapshot;
  }

  get(deviceId: string): BtGuardSnapshot | undefined {
    return this.snapshots.get(deviceId);
  }

  clear(deviceId?: string): void {
    if (deviceId) {
      this.snapshots.delete(deviceId);
      this.signatures.delete(deviceId);
      return;
    }
    this.snapshots.clear();
    this.signatures.clear();
  }
}

export const btGuardRegistry = new ContinuousTrustRegistry();
