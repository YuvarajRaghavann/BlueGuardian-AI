export type RecoveryStatus = 'lost' | 'searching' | 'found' | 'recovered';

export interface RegistrationInput {
  deviceName: string;
  deviceIdentifier: string;
  deviceId?: string;
  type?: string;
  discoverySource?: 'REAL' | 'SIMULATED';
  recoveryState?: RecoveryStatus | string;
  status?: RecoveryStatus | string;
}

export interface EncounterInput {
  deviceId: string;
  source: 'REAL' | 'SIMULATED';
  confidence?: number;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
  description?: string;
  manufacturer?: string;
  simulated?: boolean;
  isTestFixture?: boolean;
}

export class RecoveryValidationError extends Error {
  readonly status = 400;
}

export class RecoveryTransitionError extends Error {
  readonly status = 409;
}

const ALLOWED_RECOVERY_TRANSITIONS: Record<RecoveryStatus, RecoveryStatus[]> = {
  lost: ['searching', 'found', 'recovered'],
  searching: ['lost', 'found', 'recovered'],
  found: ['lost', 'searching', 'recovered'],
  recovered: ['lost'],
};

export function assertRecoveryTransition(currentValue: string | undefined, nextValue: RecoveryStatus): void {
  const current = normalizeRecoveryState(currentValue);
  if (current === nextValue) return;
  if (!ALLOWED_RECOVERY_TRANSITIONS[current].includes(nextValue)) {
    throw new RecoveryTransitionError(`Recovery case cannot move from ${current} to ${nextValue}. Reopen a recovered case as lost first.`);
  }
}

export function normalizeRecoveryState(value?: string): RecoveryStatus {
  if (value === 'lost' || value === 'searching' || value === 'found' || value === 'recovered') {
    return value;
  }
  return 'lost';
}

export function validateRegistrationInput(payload: Record<string, any>): RegistrationInput {
  const deviceName = typeof payload.deviceName === 'string' ? payload.deviceName.trim() : '';
  const deviceIdentifier = typeof payload.deviceIdentifier === 'string' ? payload.deviceIdentifier.trim() : '';
  const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : deviceIdentifier;

  if (!deviceName) {
    throw new RecoveryValidationError('Device name is required.');
  }
  if (deviceName.length > 100) {
    throw new RecoveryValidationError('Device name must not exceed 100 characters.');
  }

  if (!deviceIdentifier && !deviceId) {
    throw new RecoveryValidationError('A device identifier is required.');
  }
  if ((deviceIdentifier || deviceId).length > 256) {
    throw new RecoveryValidationError('Device identifier must not exceed 256 characters.');
  }

  const requestedState = payload.recoveryState ?? payload.status;
  if (requestedState !== undefined && requestedState !== 'lost' && requestedState !== 'searching' && requestedState !== 'found' && requestedState !== 'recovered') {
    throw new RecoveryValidationError('Recovery state must be lost, searching, found, or recovered.');
  }
  if (payload.discoverySource !== undefined && payload.discoverySource !== 'REAL' && payload.discoverySource !== 'SIMULATED') {
    throw new RecoveryValidationError('Discovery source must be REAL or SIMULATED.');
  }

  const normalizedIdentifier = deviceIdentifier || deviceId;
  if (payload.type !== undefined && (typeof payload.type !== 'string' || payload.type.length > 80)) {
    throw new RecoveryValidationError('Device type must be a string no longer than 80 characters.');
  }
  const type = payload.type ?? 'unknown';
  const discoverySource = payload.discoverySource ?? 'REAL';
  const recoveryState = normalizeRecoveryState(requestedState ?? 'lost');

  return {
    deviceName,
    deviceIdentifier: normalizedIdentifier,
    deviceId: deviceId || normalizedIdentifier,
    type,
    discoverySource,
    recoveryState,
  };
}

export function validateEncounterInput(payload: Record<string, any>): EncounterInput {
  const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
  if (!deviceId) {
    throw new RecoveryValidationError('Device identifier is required.');
  }

  if (payload.source !== 'REAL' && payload.source !== 'SIMULATED') {
    throw new RecoveryValidationError('Encounter source must be REAL or SIMULATED.');
  }
  if (payload.simulated !== undefined && typeof payload.simulated !== 'boolean') {
    throw new RecoveryValidationError('Encounter simulated flag must be a boolean.');
  }
  if (payload.isTestFixture !== undefined && typeof payload.isTestFixture !== 'boolean') {
    throw new RecoveryValidationError('Encounter test fixture flag must be a boolean.');
  }

  const source = payload.source;
  let confidence: number | undefined;
  if (payload.confidence !== undefined) {
    if (typeof payload.confidence !== 'number') {
      throw new RecoveryValidationError('Encounter confidence must be a number between 0 and 1.');
    }
    confidence = payload.confidence;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new RecoveryValidationError('Encounter confidence must be a number between 0 and 1.');
    }
  }

  if (payload.location !== undefined && (
    payload.location === null ||
    typeof payload.location !== 'object' ||
    Array.isArray(payload.location)
  )) {
    throw new RecoveryValidationError('Encounter location must be an object containing latitude and longitude.');
  }
  const location = payload.location as EncounterInput['location'];

  if (location && (
    typeof location.lat !== 'number' ||
    typeof location.lng !== 'number' ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lng) ||
    location.lat < -90 ||
    location.lat > 90 ||
    location.lng < -180 ||
    location.lng > 180
  )) {
    throw new RecoveryValidationError('Encounter location must contain valid latitude and longitude coordinates.');
  }
  if (typeof payload.description === 'string' && payload.description.length > 500) {
    throw new RecoveryValidationError('Encounter description must not exceed 500 characters.');
  }
  if (typeof payload.manufacturer === 'string' && payload.manufacturer.length > 120) {
    throw new RecoveryValidationError('Encounter manufacturer must not exceed 120 characters.');
  }
  if (payload.description !== undefined && typeof payload.description !== 'string') {
    throw new RecoveryValidationError('Encounter description must be a string.');
  }
  if (payload.manufacturer !== undefined && typeof payload.manufacturer !== 'string') {
    throw new RecoveryValidationError('Encounter manufacturer must be a string.');
  }

  if (source === 'SIMULATED' && payload.simulated !== true) {
    throw new RecoveryValidationError('Simulated encounters must be explicitly marked as simulated.');
  }

  if (source === 'REAL' && (payload.simulated === true || payload.isTestFixture === true)) {
    throw new RecoveryValidationError('Real encounters cannot be marked as simulated or test fixtures.');
  }

  return {
    deviceId,
    source,
    confidence,
    location: location ? {
      lat: Number(location.lat),
      lng: Number(location.lng),
      address: typeof location.address === 'string' ? location.address : undefined,
    } : undefined,
    description: typeof payload.description === 'string' ? payload.description : undefined,
    manufacturer: typeof payload.manufacturer === 'string' ? payload.manufacturer : undefined,
    simulated: source === 'SIMULATED',
    isTestFixture: source === 'SIMULATED' && payload.isTestFixture === true,
  };
}

export function buildAuthorizedRecoveryRecord(device: Record<string, any>, encounters: Array<Record<string, any>> = []) {
  const latestEncounter = encounters.length > 0
    ? encounters.reduce((latest, current) => new Date(current.observedAt ?? current.createdAt ?? Date.now()) > new Date(latest.observedAt ?? latest.createdAt ?? Date.now()) ? current : latest)
    : null;

  return {
    deviceId: device.deviceId ?? device.deviceIdentifier,
    deviceName: device.name ?? 'Lost device',
    deviceIdentifier: device.deviceIdentifier ?? device.deviceId,
    ownerId: device.ownerId,
    recoveryState: normalizeRecoveryState(device.recoveryState ?? device.status ?? 'lost'),
    lastSeen: device.lastSeen ? new Date(device.lastSeen).toISOString() : null,
    lastKnownLocation: latestEncounter?.location ?? null,
    lastObservationAt: latestEncounter ? new Date(latestEncounter.observedAt ?? latestEncounter.createdAt ?? Date.now()).toISOString() : null,
    confidence: latestEncounter?.confidence === undefined ? null : Number(latestEncounter.confidence),
    encounterCount: encounters.length,
    simulated: Boolean(latestEncounter?.simulated ?? device.discoverySource === 'SIMULATED'),
    registeredAt: device.registeredAt ? new Date(device.registeredAt).toISOString() : null,
  };
}
