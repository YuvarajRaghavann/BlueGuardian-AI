import type { RecoveryInfo } from '../types';

export type RecoveryWorkflowStatus = RecoveryInfo['status'];

export interface RecoveryEncounterInput {
  confidence: number;
  source: 'REAL' | 'SIMULATED';
  simulated?: boolean;
  observedAt?: Date;
  location?: RecoveryInfo['lastKnownLocation'];
  notes?: string;
}

export function normalizeRecoveryStatus(value?: string): RecoveryWorkflowStatus {
  if (value === 'found' || value === 'recovered' || value === 'searching' || value === 'lost') {
    return value;
  }
  return 'searching';
}

export function createRecoveryProfile(
  deviceName: string,
  deviceId: string,
  status?: RecoveryWorkflowStatus,
  simulated = true,
): RecoveryInfo {
  const cleanName = deviceName.trim() || 'Unregistered device';
  const cleanId = deviceId.trim() || 'device-local';
  const now = new Date();

  return {
    deviceId: cleanId,
    deviceName: cleanName,
    lastKnownLocation: simulated ? {
      lat: 37.7749,
      lng: -122.4194,
      address: 'Demo recovery area',
    } : undefined,
    lastDetected: now,
    status: normalizeRecoveryStatus(status),
    communityReports: simulated ? 1 : 0,
    simulated,
  };
}

export function validateEncounter(input: RecoveryEncounterInput): string | null {
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    return 'Observation confidence must be a number between 0 and 1.';
  }

  if (input.source === 'REAL' && !input.location) {
    return 'Real encounters must include a location or a verified location estimate.';
  }

  return null;
}

export function appendEncounter(
  recovery: RecoveryInfo,
  input: RecoveryEncounterInput,
): RecoveryInfo {
  const validationError = validateEncounter(input);
  if (validationError) {
    throw new Error(validationError);
  }

  const observedAt = input.observedAt ?? new Date();
  const nextStatus = input.confidence >= 0.8 ? 'found' : recovery.status === 'searching' ? 'searching' : recovery.status;

  return {
    ...recovery,
    deviceName: recovery.deviceName,
    lastDetected: observedAt,
    status: nextStatus,
    lastKnownLocation: input.location ?? recovery.lastKnownLocation,
    communityReports: recovery.communityReports + 1,
    simulated: Boolean(input.simulated ?? recovery.simulated),
  };
}
