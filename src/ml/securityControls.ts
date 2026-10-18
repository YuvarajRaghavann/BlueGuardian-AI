import type { BluetoothDevice } from '../types/index.js';
import { publishBtGuardTelemetry, type BtGuardTelemetry, type BtGuardAssessment, type BtGuardLevel } from './btguard.js';

export const BTGUARD_MIN_KEY_SIZE_BYTES = 16;

export interface PairingSecurityProfile {
  secureConnections: boolean;
  encrypted: boolean;
  authenticated: boolean;
  keySizeBytes: number;
  outOfBandVerified?: boolean;
  numericComparisonVerified?: boolean;
}

export interface PairingPolicyResult {
  allowed: boolean;
  reasons: string[];
}

/** Enforce the stated minimum security profile when the native stack exposes it. */
export function evaluatePairingSecurity(profile: PairingSecurityProfile): PairingPolicyResult {
  const reasons: string[] = [];
  if (!profile.secureConnections) reasons.push('LE Secure Connections is required.');
  if (!profile.encrypted) reasons.push('An encrypted link is required.');
  if (!profile.authenticated) reasons.push('Authenticated pairing is required.');
  if (!Number.isInteger(profile.keySizeBytes) || profile.keySizeBytes < BTGUARD_MIN_KEY_SIZE_BYTES) {
    reasons.push(`Negotiated key size must be at least ${BTGUARD_MIN_KEY_SIZE_BYTES} bytes.`);
  }
  if (!profile.outOfBandVerified && !profile.numericComparisonVerified) {
    reasons.push('Complete a verified out-of-band or numeric-comparison confirmation.');
  }
  return { allowed: reasons.length === 0, reasons };
}

export interface RfFingerprintSample {
  cfoKHz: number;
  rssiDbm: number;
  timingOffsetUs?: number;
  capturedAt: number;
}
export interface RfFingerprintBaseline {
  deviceId: string;
  sampleCount: number;
  meanCfoKHz: number;
  cfoStdDevKHz: number;
  meanRssiDbm: number;
  timingMeanUs?: number;
}
export interface RfFingerprintResult {
  comparable: boolean;
  anomaly: boolean;
  normalizedDeviation?: number;
  reason: string;
}

/** Baseline requires multiple owner-approved observations; this is a heuristic, not cryptographic identity. */
export function enrollRfFingerprint(deviceId: string, samples: RfFingerprintSample[]): RfFingerprintBaseline | undefined {
  const usable = samples.filter(s => Number.isFinite(s.cfoKHz) && Number.isFinite(s.rssiDbm));
  if (usable.length < 5) return undefined;
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const cfoValues = usable.map(s => s.cfoKHz);
  const meanCfoKHz = mean(cfoValues);
  const cfoStdDevKHz = Math.sqrt(mean(cfoValues.map(v => (v - meanCfoKHz) ** 2)));
  const timed = usable.filter(s => typeof s.timingOffsetUs === 'number' && Number.isFinite(s.timingOffsetUs));
  return {
    deviceId, sampleCount: usable.length, meanCfoKHz, cfoStdDevKHz,
    meanRssiDbm: mean(usable.map(s => s.rssiDbm)),
    timingMeanUs: timed.length ? mean(timed.map(s => s.timingOffsetUs!)) : undefined,
  };
}

export function compareRfFingerprint(baseline: RfFingerprintBaseline, sample: RfFingerprintSample): RfFingerprintResult {
  if (baseline.sampleCount < 5 || !Number.isFinite(sample.cfoKHz)) {
    return { comparable: false, anomaly: false, reason: 'Insufficient valid baseline or RF sample; no identity conclusion is possible.' };
  }
  const tolerance = Math.max(0.5, baseline.cfoStdDevKHz * 4);
  const deviation = Math.abs(sample.cfoKHz - baseline.meanCfoKHz);
  const anomaly = deviation > tolerance;
  return {
    comparable: true, anomaly, normalizedDeviation: deviation / tolerance,
    reason: anomaly
      ? 'CFO is outside the enrolled baseline tolerance. Treat as a review signal, not proof of cloning.'
      : 'CFO is within the enrolled baseline tolerance for this sample.',
  };
}

export interface ProximityEvidence {
  channelSoundingDistanceM: number;
  rssiDbm: number;
  maximumClaimedDistanceM: number;
  calibratedRssiDistanceM?: number;
  capturedAt: number;
}
export interface ProximityCheck {
  allowed: boolean;
  reason: string;
  distanceM?: number;
}

/** Only accepts actual controller-provided Channel Sounding evidence; never fabricates it from RSSI. */
export function verifyProximity(evidence: ProximityEvidence | undefined): ProximityCheck {
  if (!evidence) return { allowed: false, reason: 'Channel Sounding evidence unavailable; proximity has not been verified.' };
  const { channelSoundingDistanceM: distance, maximumClaimedDistanceM: maximum, capturedAt } = evidence;
  if (![distance, maximum, capturedAt, evidence.rssiDbm].every(Number.isFinite) || distance < 0 || maximum <= 0) {
    return { allowed: false, reason: 'Invalid proximity telemetry.' };
  }
  if (Date.now() - capturedAt > 5000) return { allowed: false, reason: 'Channel Sounding evidence is stale; obtain a fresh measurement.' };
  if (distance > maximum) return { allowed: false, reason: 'Measured Channel Sounding distance exceeds the permitted proximity boundary.', distanceM: distance };
  if (typeof evidence.calibratedRssiDistanceM === 'number') {
    const disagreement = Math.abs(distance - evidence.calibratedRssiDistanceM);
    if (disagreement > Math.max(3, distance * 0.75)) {
      return { allowed: false, reason: 'Channel Sounding and calibrated RSSI distance disagree; require another measurement.', distanceM: distance };
    }
  }
  return { allowed: true, reason: 'Fresh Channel Sounding evidence satisfies the configured distance threshold.', distanceM: distance };
}

export type RecoveryStep = 'OWNER_CONFIRMATION' | 'CONTAINMENT' | 'REVOKE_BOND' | 'ROTATE_CREDENTIALS' | 'REPAIR_OOB' | 'VERIFY_NEW_SESSION' | 'COMPLETE';
export interface RecoveryRecord {
  recoveryId: string;
  deviceId: string;
  state: RecoveryStep;
  completedSteps: RecoveryStep[];
  audit: Array<{ step: RecoveryStep; at: number; note: string }>;
}
export interface RecoveryAdapter {
  containDevice(deviceId: string): Promise<void>;
  revokeBond(deviceId: string): Promise<void>;
  rotateCredentials(deviceId: string): Promise<void>;
  beginOutOfBandRepair(deviceId: string): Promise<void>;
  verifyNewSession(deviceId: string): Promise<boolean>;
}
export interface RecoveryOptions {
  ownerConfirmed: boolean;
  adapter: RecoveryAdapter;
  onAudit?: (record: RecoveryRecord) => void;
}

/**
 * Recovery orchestration with explicit owner consent. Native operations are delegated
 * to a platform adapter; unsupported operations fail closed instead of being simulated.
 */
export async function runSecureRecovery(deviceId: string, options: RecoveryOptions): Promise<RecoveryRecord> {
  if (!options.ownerConfirmed) throw new Error('Owner confirmation is required before recovery can alter pairing state.');
  if (!deviceId.trim()) throw new Error('A device identifier is required.');
  const record: RecoveryRecord = {
    recoveryId: `btguard-${deviceId}-${Date.now()}`,
    deviceId,
    state: 'OWNER_CONFIRMATION',
    completedSteps: ['OWNER_CONFIRMATION'],
    audit: [{ step: 'OWNER_CONFIRMATION', at: Date.now(), note: 'Owner explicitly confirmed recovery.' }],
  };
  const advance = (step: RecoveryStep, note: string) => {
    record.state = step;
    record.completedSteps.push(step);
    record.audit.push({ step, at: Date.now(), note });
    options.onAudit?.({ ...record, completedSteps: [...record.completedSteps], audit: [...record.audit] });
  };
  advance('CONTAINMENT', 'Requesting platform adapter to contain app-managed access.');
  await options.adapter.containDevice(deviceId);
  advance('REVOKE_BOND', 'Requesting platform adapter to revoke the existing bond.');
  await options.adapter.revokeBond(deviceId);
  advance('ROTATE_CREDENTIALS', 'Requesting platform adapter to rotate application/controller-managed credentials.');
  await options.adapter.rotateCredentials(deviceId);
  advance('REPAIR_OOB', 'Starting owner-verified out-of-band re-pairing.');
  await options.adapter.beginOutOfBandRepair(deviceId);
  advance('VERIFY_NEW_SESSION', 'Verifying the newly established session.');
  const verified = await options.adapter.verifyNewSession(deviceId);
  if (!verified) throw new Error('Recovery stopped: the new session did not pass verification.');
  advance('COMPLETE', 'Recovery completed and the new session was verified.');
  return record;
}

export interface CapabilityEnforcer {
  enforce(deviceId: string, level: BtGuardLevel): Promise<void>;
}

/** Calls a real native enforcement adapter when provided; otherwise refuses to claim enforcement. */
export async function enforceBtGuardLevel(
  deviceId: string,
  assessment: BtGuardAssessment,
  enforcer?: CapabilityEnforcer,
): Promise<{ enforced: boolean; message: string }> {
  if (!enforcer) return { enforced: false, message: 'No native capability-enforcement adapter is registered; this assessment remains advisory.' };
  await enforcer.enforce(deviceId, assessment.level);
  return { enforced: true, message: `Native adapter applied ${assessment.level} policy.` };
}


export interface BtGuardEvidenceBundle {
  pairing?: PairingSecurityProfile;
  proximity?: ProximityEvidence;
  rfBaseline?: RfFingerprintBaseline;
  rfSample?: RfFingerprintSample;
  behaviour?: Pick<BtGuardTelemetry, 'packetRate' | 'pairingAttempts' | 'errorRate' | 'interArrivalJitterMs'>;
}

/**
 * Normalizes native/controller evidence into the live BTGuard telemetry store.
 * Missing evidence stays missing; a failed supplied check is recorded as false.
 */
export function ingestBtGuardEvidence(deviceId: string, bundle: BtGuardEvidenceBundle): BtGuardTelemetry {
  const telemetry: BtGuardTelemetry = {};
  if (bundle.pairing) {
    telemetry.secureConnections = bundle.pairing.secureConnections;
    telemetry.encrypted = bundle.pairing.encrypted;
    telemetry.authenticated = bundle.pairing.authenticated;
    telemetry.keySizeBytes = bundle.pairing.keySizeBytes;
  }
  if (bundle.proximity) {
    const result = verifyProximity(bundle.proximity);
    telemetry.channelSoundingDistanceM = bundle.proximity.channelSoundingDistanceM;
    telemetry.rssiDbm = bundle.proximity.rssiDbm;
    telemetry.proximityVerified = result.allowed;
  }
  if (bundle.rfBaseline && bundle.rfSample) {
    const result = compareRfFingerprint(bundle.rfBaseline, bundle.rfSample);
    telemetry.rfFingerprintComparable = result.comparable;
    if (result.comparable) telemetry.rfFingerprintAnomaly = result.anomaly;
    telemetry.cfoKHz = bundle.rfSample.cfoKHz;
  }
  if (bundle.behaviour) Object.assign(telemetry, bundle.behaviour);
  telemetry.observedAt = Date.now();
  publishBtGuardTelemetry(deviceId, telemetry);
  return telemetry;
}
