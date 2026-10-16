import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHash } from 'node:crypto';
import Device from '../models/Device';
import RecoveryEncounter from '../models/RecoveryEncounter';
import { getOwnerIdFromRequest, requireAuth } from '../auth';
import {
  buildAuthorizedRecoveryRecord,
  normalizeRecoveryState,
  RecoveryValidationError,
  validateEncounterInput,
  validateRegistrationInput,
} from '../services/recoveryService';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const rateLimitWindowMs = 60_000;
const rateLimitMaxRequests = 10;
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

// Records created before recoveryEnabled existed are included for backwards compatibility.
// New non-recovery device records explicitly store recoveryEnabled=false.
const recoveryEnabledOrLegacy = { $or: [{ recoveryEnabled: true }, { recoveryEnabled: { $exists: false } }] };

router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  next();
});

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || 'anonymous';
  const now = Date.now();
  const current = rateLimitStore.get(key);

  // Bound the in-memory limiter map if many unique client addresses reach this process.
  if (rateLimitStore.size > 1_000) {
    for (const [storedKey, entry] of rateLimitStore) {
      if (now - entry.windowStart > rateLimitWindowMs) rateLimitStore.delete(storedKey);
    }
  }

  if (!current || now - current.windowStart > rateLimitWindowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return next();
  }

  if (current.count >= rateLimitMaxRequests) {
    return res.status(429).json({ error: 'Too many recovery requests. Please try again later.' });
  }

  current.count += 1;
  return next();
}

router.get('/devices', requireAuth('owner'), asyncHandler(async (req, res) => {
  const ownerId = getOwnerIdFromRequest(req);
  const devices = await Device.find({ ownerId, ...recoveryEnabledOrLegacy }).sort({ registeredAt: -1 }).limit(500);
  return res.json(devices);
}));

router.post('/devices', requireAuth('owner'), asyncHandler(async (req, res) => {
  const ownerId = getOwnerIdFromRequest(req);
  const registration = validateRegistrationInput(req.body ?? {});

  const existing = await Device.findOne({ ownerId, deviceIdentifier: registration.deviceIdentifier });
  if (existing) {
    existing.name = registration.deviceName;
    existing.type = registration.type;
    existing.deviceId = registration.deviceId ?? existing.deviceId;
    existing.discoverySource = registration.discoverySource ?? existing.discoverySource;
    existing.recoveryEnabled = true;
    if (registration.recoveryFingerprintHash) existing.recoveryFingerprintHash = registration.recoveryFingerprintHash;
    existing.recoveryState = normalizeRecoveryState(registration.recoveryState ?? existing.recoveryState ?? 'lost');
    existing.lastSeen = new Date();
    await existing.save();
    return res.status(200).json(existing);
  }

  const device = new Device({
    deviceId: registration.deviceId ?? registration.deviceIdentifier,
    deviceIdentifier: registration.deviceIdentifier,
    name: registration.deviceName,
    type: registration.type,
    ownerId,
    recoveryEnabled: true,
    discoverySource: registration.discoverySource ?? 'REAL',
    recoveryState: normalizeRecoveryState(registration.recoveryState),
    recoveryFingerprintHash: registration.recoveryFingerprintHash,
    registeredAt: new Date(),
    firstSeen: new Date(),
    lastSeen: new Date(),
    connectionStatus: 'unknown',
    isKnown: false,
    trusted: false,
    blocked: false,
    trustScore: 0,
    riskLevel: 'high',
  });

  await device.save();
  return res.status(201).json(device);
}));

router.get('/devices/:deviceId', requireAuth('owner'), asyncHandler(async (req, res) => {
  const ownerId = getOwnerIdFromRequest(req);
  const device = await Device.findOne({ ownerId, deviceId: req.params.deviceId, ...recoveryEnabledOrLegacy });
  if (!device) return res.status(404).json({ error: 'Recovery device not found for this owner.' });

  const encounters = await RecoveryEncounter.find({ ownerId, deviceId: device.deviceId }).sort({ observedAt: -1 }).limit(20);
  return res.json(buildAuthorizedRecoveryRecord(device.toObject(), encounters.map((entry) => entry.toObject())));
}));

router.patch('/devices/:deviceId', requireAuth('owner'), asyncHandler(async (req, res) => {
  const ownerId = getOwnerIdFromRequest(req);
  const requestedState = req.body?.status ?? req.body?.recoveryState;
  if (requestedState !== 'lost' && requestedState !== 'searching' && requestedState !== 'found' && requestedState !== 'recovered') {
    throw new RecoveryValidationError('Recovery state must be lost, searching, found, or recovered.');
  }
  const nextState = normalizeRecoveryState(requestedState);
  const device = await Device.findOne({ ownerId, deviceId: req.params.deviceId, ...recoveryEnabledOrLegacy });
  if (!device) return res.status(404).json({ error: 'Recovery device not found for this owner.' });

  device.recoveryState = nextState;
  await device.save();
  return res.json(device);
}));

router.get('/devices/:deviceId/encounters', requireAuth('owner'), asyncHandler(async (req, res) => {
  const ownerId = getOwnerIdFromRequest(req);
  const device = await Device.findOne({ ownerId, deviceId: req.params.deviceId, ...recoveryEnabledOrLegacy });
  if (!device) return res.status(404).json({ error: 'Recovery device not found for this owner.' });

  const encounters = await RecoveryEncounter.find({ ownerId, deviceId: device.deviceId }).sort({ observedAt: -1 }).limit(50);
  return res.json(encounters);
}));

router.post('/devices/:deviceId/encounters', requireAuth('owner'), rateLimit, asyncHandler(async (req, res) => {
  const ownerId = getOwnerIdFromRequest(req);
  // Scope at the database query itself; never load another owner's record for an application-level check.
  const device = await Device.findOne({ ownerId, deviceId: req.params.deviceId, ...recoveryEnabledOrLegacy });
  if (!device) return res.status(404).json({ error: 'Recovery device not found.' });

  const payload = validateEncounterInput({
    ...((req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}),
    deviceId: device.deviceId,
  });
  const timeBucket = Math.floor(Date.now() / 60_000);
  const deduplicationKey = createHash('sha256')
    .update(JSON.stringify({
      ownerId,
      deviceId: device.deviceId,
      source: payload.source,
      confidence: payload.confidence ?? null,
      location: payload.location ?? null,
      description: payload.description ?? null,
      manufacturer: payload.manufacturer ?? null,
      simulated: payload.simulated,
      isTestFixture: payload.isTestFixture,
      timeBucket,
    }))
    .digest('hex');

  const existingEncounter = await RecoveryEncounter.findOne({ ownerId, deviceId: device.deviceId, deduplicationKey });
  if (existingEncounter) {
    const duplicateResponse = existingEncounter.toObject();
    delete duplicateResponse.ownerId;
    return res.status(200).json({ ...duplicateResponse, duplicate: true });
  }

  const encounter = new RecoveryEncounter({
    deviceId: device.deviceId,
    ownerId,
    deduplicationKey,
    source: payload.source,
    confidence: payload.confidence,
    location: payload.location,
    description: payload.description,
    manufacturer: payload.manufacturer,
    simulated: payload.simulated,
    isTestFixture: payload.isTestFixture,
    observedAt: new Date(),
  });

  try {
    await encounter.save();
  } catch (error) {
    if ((error as { code?: number })?.code !== 11000) throw error;
    const duplicate = await RecoveryEncounter.findOne({ ownerId, deviceId: device.deviceId, deduplicationKey });
    if (!duplicate) throw error;
    const duplicateResponse = duplicate.toObject();
    delete duplicateResponse.ownerId;
    return res.status(200).json({ ...duplicateResponse, duplicate: true });
  }

  // A genuine sighting changes lost -> searching, but does not claim that the item is recovered.
  if (!device.recoveryState || device.recoveryState === 'lost') device.recoveryState = 'searching';
  device.lastSeen = new Date();
  await device.save();

  const publicEncounter = encounter.toObject();
  delete publicEncounter.ownerId;
  return res.status(201).json(publicEncounter);
}));


// Community sighting intake. Participants submit only a canonical BLE fingerprint;
// the API never reveals which owner's case matched. Location is optional and explicit.
router.post('/community/sightings', requireAuth('participant'), rateLimit, asyncHandler(async (req, res) => {
  const observations = req.body?.observations;
  const shareLocation = req.body?.shareLocation === true;
  const location = req.body?.location;
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 30) {
    throw new RecoveryValidationError('Submit between 1 and 30 nearby BLE observations.');
  }
  if (req.body?.shareLocation !== undefined && typeof req.body.shareLocation !== 'boolean') {
    throw new RecoveryValidationError('shareLocation must be a boolean.');
  }
  if (location !== undefined && !shareLocation) {
    throw new RecoveryValidationError('Location cannot be submitted unless the participant explicitly opts in.');
  }
  const locationPayload = location === undefined ? undefined : validateEncounterInput({
    deviceId: 'community-observation',
    source: 'REAL',
    simulated: false,
    isTestFixture: false,
    location,
  }).location;

  const fingerprintHashes = new Set<string>();
  for (const observation of observations) {
    const registration = validateRegistrationInput({
      deviceName: typeof observation?.name === 'string' ? observation.name : '',
      deviceIdentifier: 'community-observation',
      recoveryFingerprint: {
        name: observation?.name,
        serviceUuids: observation?.serviceUuids,
      },
      discoverySource: 'REAL',
    });
    if (registration.recoveryFingerprintHash) fingerprintHashes.add(registration.recoveryFingerprintHash);
  }

  const timeBucket = Math.floor(Date.now() / 60_000);
  for (const fingerprintHash of fingerprintHashes) {
    const matches = await Device.find({
      recoveryEnabled: true,
      recoveryState: { $in: ['lost', 'searching'] },
      recoveryFingerprintHash: fingerprintHash,
    }).limit(5);
    for (const device of matches) {
      if (!device.ownerId || !device.deviceId) continue;
      const deduplicationKey = createHash('sha256')
        .update(JSON.stringify({ ownerId: device.ownerId, deviceId: device.deviceId, fingerprintHash, timeBucket }))
        .digest('hex');
      const existing = await RecoveryEncounter.findOne({
        ownerId: device.ownerId, deviceId: device.deviceId, deduplicationKey,
      });
      if (existing) continue;
      const encounter = new RecoveryEncounter({
        deviceId: device.deviceId,
        ownerId: device.ownerId,
        deduplicationKey,
        source: 'REAL',
        confidence: 0.45,
        location: locationPayload,
        description: 'Community BLE fingerprint candidate. This is an unverified lead; confirm the device before marking it found.',
        simulated: false,
        isTestFixture: false,
        observedAt: new Date(),
      });
      try {
        await encounter.save();
      } catch (error) {
        if ((error as { code?: number })?.code === 11000) continue;
        throw error;
      }
      // Candidate reports never change lost/found state automatically; only the owner confirms them.
    }
  }

  // Do not reveal whether any owner/device matched, or return device IDs.
  return res.status(202).json({ accepted: true, observationsReceived: fingerprintHashes.size });
}));

export default router;
