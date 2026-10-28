import { createHash } from 'node:crypto';
export type RecoveryStatus = 'lost' | 'searching' | 'found' | 'recovered';

export interface RegistrationInput {
  deviceName: string;
  deviceIdentifier: string;
  deviceId?: string;
  type?: string;
  discoverySource?: 'REAL' | 'SIMULATED';
  recoveryState?: RecoveryStatus | string;
  status?: RecoveryStatus | string;
  recoveryFingerprintHash?: string;
  /** Hash of the advertised name alone, so a sighting with different/no service UUIDs still matches. */
  recoveryNameHash?: string;
  /** Salted hash of the device's Bluetooth address, so nameless devices can be matched too. */
  recoveryAddressHash?: string;
}

const MAC_PATTERN = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;
export const ADDRESS_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Community address key. Helpers hash every address on their phone before sending
 * (same formula in src/services/recoveryHash.ts), so the server never receives the
 * raw addresses of bystanders' devices. Only stable addresses (classic MACs, public
 * and static LE addresses) can match; rotating private addresses simply never do.
 */
export function addressHashOf(identifier: string): string | undefined {
  const mac = identifier.trim().toUpperCase();
  if (!MAC_PATTERN.test(mac)) return undefined;
  return createHash('sha256').update(`blueguardian-recovery-address-v1:${mac}`).digest('hex');
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

  if (!deviceName) throw new RecoveryValidationError('Device name is required.');
  if (deviceName.length > 100) throw new RecoveryValidationError('Device name must not exceed 100 characters.');

  const normalizedIdentifier = deviceIdentifier || deviceId;
  if (!normalizedIdentifier) throw new RecoveryValidationError('A device identifier is required.');
  if (normalizedIdentifier.length > 256 || deviceId.length > 256) {
    throw new RecoveryValidationError('Device identifier must not exceed 256 characters.');
  }

  const recoveryFingerprint = payload.recoveryFingerprint as { name?: unknown; serviceUuids?: unknown } | undefined;
  let recoveryFingerprintHash: string | undefined;
  let recoveryNameHash: string | undefined;
  if (recoveryFingerprint !== undefined) {
    if (!recoveryFingerprint || typeof recoveryFingerprint !== 'object' || Array.isArray(recoveryFingerprint)) {
      throw new RecoveryValidationError('Recovery fingerprint must contain an advertised name and service UUID list.');
    }
    const fingerprintName = typeof recoveryFingerprint.name === 'string'
      ? recoveryFingerprint.name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
      : '';
    const rawUuids = recoveryFingerprint.serviceUuids;
    if (!fingerprintName || fingerprintName.length > 96 || !Array.isArray(rawUuids) ||
      rawUuids.length > 32 ||
      rawUuids.some((uuid) => typeof uuid !== 'string' || uuid.trim().length === 0 || uuid.length > 128)) {
      throw new RecoveryValidationError('Community recovery needs an advertised device name and a valid BLE service UUID list.');
    }
    const serviceUuids = [...new Set((rawUuids as string[]).map(uuid => uuid.trim().toLowerCase()))].sort();
    recoveryFingerprintHash = fingerprintHashOf(fingerprintName, serviceUuids);
    recoveryNameHash = fingerprintHashOf(fingerprintName, []);
  }

  const requestedState = payload.recoveryState ?? payload.status;
  if (requestedState !== undefined && requestedState !== 'lost' && requestedState !== 'searching' && requestedState !== 'found' && requestedState !== 'recovered') {
    throw new RecoveryValidationError('Recovery state must be lost, searching, found, or recovered.');
  }
  if (payload.discoverySource !== undefined && payload.discoverySource !== 'REAL' && payload.discoverySource !== 'SIMULATED') {
    throw new RecoveryValidationError('Discovery source must be REAL or SIMULATED.');
  }

  if (payload.type !== undefined && (typeof payload.type !== 'string' || payload.type.trim().length > 80)) {
    throw new RecoveryValidationError('Device type must be a string no longer than 80 characters.');
  }

  const type = typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : 'unknown';
  const discoverySource = payload.discoverySource ?? 'REAL';
  const recoveryState = normalizeRecoveryState(requestedState ?? 'lost');

  return {
    deviceName,
    deviceIdentifier: normalizedIdentifier,
    deviceId: deviceId || normalizedIdentifier,
    type,
    discoverySource,
    recoveryState,
    recoveryFingerprintHash,
    recoveryNameHash,
    recoveryAddressHash: addressHashOf(normalizedIdentifier),
  };
}

/**
 * Canonical community fingerprint hash. The name-only hash is the same formula with an
 * empty UUID list, so records registered without UUIDs keep matching unchanged.
 */
export function fingerprintHashOf(normalizedName: string, sortedServiceUuids: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ name: normalizedName, serviceUuids: sortedServiceUuids }))
    .digest('hex');
}

export function validateEncounterInput(payload: Record<string, any>): EncounterInput {
  const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
  if (!deviceId) throw new RecoveryValidationError('Device identifier is required.');
  if (deviceId.length > 256) throw new RecoveryValidationError('Device identifier must not exceed 256 characters.');

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
    if (typeof payload.confidence !== 'number' || !Number.isFinite(payload.confidence) || payload.confidence < 0 || payload.confidence > 1) {
      throw new RecoveryValidationError('Encounter confidence must be a number between 0 and 1.');
    }
    confidence = payload.confidence;
  }

  if (payload.location !== undefined && (
    payload.location === null || typeof payload.location !== 'object' || Array.isArray(payload.location)
  )) {
    throw new RecoveryValidationError('Encounter location must be an object containing latitude and longitude.');
  }
  const location = payload.location as EncounterInput['location'];
  if (location && (
    typeof location.lat !== 'number' || typeof location.lng !== 'number' ||
    !Number.isFinite(location.lat) || !Number.isFinite(location.lng) ||
    location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180
  )) {
    throw new RecoveryValidationError('Encounter location must contain valid latitude and longitude coordinates.');
  }
  if (location?.address !== undefined && (typeof location.address !== 'string' || location.address.length > 256)) {
    throw new RecoveryValidationError('Encounter address must be a string no longer than 256 characters.');
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
      lat: location.lat,
      lng: location.lng,
      address: typeof location.address === 'string' ? location.address.trim() : undefined,
    } : undefined,
    description: typeof payload.description === 'string' ? payload.description.trim() : undefined,
    manufacturer: typeof payload.manufacturer === 'string' ? payload.manufacturer.trim() : undefined,
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
    // Kept for existing authorized clients. Never return recovery records before owner filtering.
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
