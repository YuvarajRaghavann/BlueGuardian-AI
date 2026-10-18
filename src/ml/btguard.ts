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
  proximityVerified?: boolean;
  rfFingerprintAnomaly?: boolean;
  rfFingerprintComparable?: boolean;
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

function inferLevel(score: number, blocked: boolean, fullEvidence = false): BtGuardLevel {
  if (blocked || score < 30) return 'ISOLATED';
  // Full capability requires affirmative security and proximity evidence, not just a high heuristic score.
  if (score >= 70 && fullEvidence) return 'FULL';
  return 'RESTRICTED';
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

  if (telemetry.proximityVerified === false) {
    score -= 20;
    reasons.push('Proximity verification failed; the peer is outside policy or the measurement was stale/inconsistent.');
    coverage.push('Channel Sounding proximity policy');
  } else if (telemetry.proximityVerified === true) {
    coverage.push('Channel Sounding proximity policy');
  }

  if (telemetry.rfFingerprintAnomaly === true) {
    score -= 20;
    coverage.push('enrolled RF fingerprint comparison');
    reasons.push('RF fingerprint differs from the enrolled baseline; treat as a possible identity anomaly, not proof of cloning.');
  } else if (telemetry.rfFingerprintComparable === true) {
    coverage.push('enrolled RF fingerprint comparison');
  }

  if (typeof telemetry.channelSoundingDistanceM === 'number' && typeof telemetry.calibratedRssiDistanceM === 'number') {
    coverage.push('Channel Sounding and calibrated RSSI-distance cross-check');
    const difference = Math.abs(telemetry.channelSoundingDistanceM - telemetry.calibratedRssiDistanceM);
    if (difference > Math.max(3, telemetry.channelSoundingDistanceM * 0.5)) {
      score -= 15;
      reasons.push('Channel Sounding and calibrated RSSI-distance estimates are inconsistent; verify calibration and repeat the measurement before taking action.');
    }
  } else {
    reasons.push('Channel Sounding/calibrated RSSI-distance cross-check unavailable; raw RSSI alone does not establish distance.');
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
  const fullEvidence = device.discoverySource === 'REAL'
    && device.isKnown && device.trusted
    && telemetry.secureConnections === true
    && telemetry.encrypted === true
    && telemetry.authenticated === true
    && typeof telemetry.keySizeBytes === 'number' && telemetry.keySizeBytes >= 16
    && telemetry.proximityVerified === true
    && typeof telemetry.channelSoundingDistanceM === 'number'
    && typeof telemetry.rssiDbm === 'number'
    && telemetry.rfFingerprintAnomaly !== true;
  const level = inferLevel(trustScore, Boolean(device.blocked), fullEvidence);
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
  private rssiHistory = new Map<string, number[]>();

  observe(device: BluetoothDevice, telemetry: BtGuardTelemetry = {}): BtGuardSnapshot {
    const observedAt = telemetry.observedAt ?? device.lastSeen.getTime();
    const effectiveTelemetry: BtGuardTelemetry = {
      ...telemetry,
      // RSSI is available on native discovery observations; it is not proof of identity or distance.
      rssiDbm: telemetry.rssiDbm ?? device.rssi,
    };
    const signature = JSON.stringify({ device, telemetry: { ...effectiveTelemetry, observedAt: undefined } });
    const previous = this.snapshots.get(device.id);
    if (previous && this.signatures.get(device.id) === signature) return previous;

    const rssiHistory = this.rssiHistory.get(device.id) ?? [];
    if (typeof effectiveTelemetry.rssiDbm === 'number') {
      rssiHistory.push(effectiveTelemetry.rssiDbm);
      if (rssiHistory.length > 8) rssiHistory.shift();
      this.rssiHistory.set(device.id, rssiHistory);
    }
    const current = assessBtGuard(device, effectiveTelemetry);
    // A wide multi-observation signal spread is a weak anomaly hint, never a spoofing verdict.
    const signalSpread = rssiHistory.length >= 4 ? Math.max(...rssiHistory) - Math.min(...rssiHistory) : 0;
    if (signalSpread >= 45) {
      current.trustScore = clamp(current.trustScore - 5);
      current.reasons.push('RSSI varied by at least 45 dB across recent observations. Movement and interference can cause this; treat it as a review signal, not proof of spoofing.');
      current.telemetryCoverage.push('multi-sample RSSI history');
    }
    // Trust falls quickly on new adverse evidence and recovers slowly after it clears.
    const smoothed = previous
      ? Math.round(previous.trustScore + (current.trustScore < previous.trustScore
        ? 0.65 : 0.2) * (current.trustScore - previous.trustScore))
      : current.trustScore;
    const trustScore = clamp(smoothed);
    const fullEvidence = current.level === 'FULL';
    const level = inferLevel(trustScore, Boolean(device.blocked), fullEvidence);
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
      this.rssiHistory.delete(deviceId);
      return;
    }
    this.snapshots.clear();
    this.signatures.clear();
    this.rssiHistory.clear();
  }
}


/** Native/firmware adapters can publish only observed values through this store. */
const telemetryByDevice = new Map<string, BtGuardTelemetry>();
const MAX_TELEMETRY_AGE_MS = 30_000;

export function publishBtGuardTelemetry(deviceId: string, telemetry: BtGuardTelemetry): void {
  if (!deviceId.trim()) throw new Error('BTGuard telemetry requires a device ID.');
  const finite = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const clean: BtGuardTelemetry = {
    secureConnections: typeof telemetry.secureConnections === 'boolean' ? telemetry.secureConnections : undefined,
    encrypted: typeof telemetry.encrypted === 'boolean' ? telemetry.encrypted : undefined,
    proximityVerified: typeof telemetry.proximityVerified === 'boolean' ? telemetry.proximityVerified : undefined,
    rfFingerprintAnomaly: typeof telemetry.rfFingerprintAnomaly === 'boolean' ? telemetry.rfFingerprintAnomaly : undefined,
    rfFingerprintComparable: typeof telemetry.rfFingerprintComparable === 'boolean' ? telemetry.rfFingerprintComparable : undefined,
    authenticated: typeof telemetry.authenticated === 'boolean' ? telemetry.authenticated : undefined,
    keySizeBytes: finite(telemetry.keySizeBytes),
    channelSoundingDistanceM: finite(telemetry.channelSoundingDistanceM),
    rssiDbm: finite(telemetry.rssiDbm),
    cfoKHz: finite(telemetry.cfoKHz),
    packetRate: finite(telemetry.packetRate),
    pairingAttempts: finite(telemetry.pairingAttempts),
    errorRate: finite(telemetry.errorRate),
    interArrivalJitterMs: finite(telemetry.interArrivalJitterMs),
    observedAt: finite(telemetry.observedAt) ?? Date.now(),
  };
  if (clean.keySizeBytes !== undefined && (clean.keySizeBytes < 1 || clean.keySizeBytes > 16)) delete clean.keySizeBytes;
  if (clean.channelSoundingDistanceM !== undefined && clean.channelSoundingDistanceM < 0) delete clean.channelSoundingDistanceM;
  if (clean.packetRate !== undefined && clean.packetRate < 0) delete clean.packetRate;
  if (clean.pairingAttempts !== undefined && clean.pairingAttempts < 0) delete clean.pairingAttempts;
  if (clean.errorRate !== undefined && (clean.errorRate < 0 || clean.errorRate > 1)) delete clean.errorRate;
  if (clean.interArrivalJitterMs !== undefined && clean.interArrivalJitterMs < 0) delete clean.interArrivalJitterMs;
  telemetryByDevice.set(deviceId, clean);
}
export function getBtGuardTelemetry(deviceId: string, now = Date.now()): BtGuardTelemetry {
  const telemetry = telemetryByDevice.get(deviceId);
  if (!telemetry) return {};
  const observedAt = telemetry.observedAt ?? 0;
  if (now - observedAt > MAX_TELEMETRY_AGE_MS || observedAt > now + 5_000) {
    return {};
  }
  return { ...telemetry };
}

export function clearBtGuardTelemetry(deviceId?: string): void {
  if (deviceId) telemetryByDevice.delete(deviceId);
  else telemetryByDevice.clear();
}

export const btGuardRegistry = new ContinuousTrustRegistry();
