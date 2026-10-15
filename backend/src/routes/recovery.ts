import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHash } from 'node:crypto';
import Device from '../models/Device';
import RecoveryEncounter from '../models/RecoveryEncounter';
import { requireAuth, type AuthContext } from '../auth';
import {
  buildAuthorizedRecoveryRecord,
  normalizeRecoveryState,
  RecoveryValidationError,
  assertRecoveryTransition,
  validateEncounterInput,
  validateRegistrationInput,
} from '../services/recoveryService';

const router = Router();
const rateLimitWindowMs = 60_000;
const rateLimitMaxRequests = 10;
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  next();
});

function getOwnerIdFromRequest(req: Request): string {
  const auth = (req as Request & { auth?: AuthContext }).auth;
  if (!auth?.ownerId) {
    throw Object.assign(new Error('Owner identity is not available for this request.'), { status: 403 });
  }
  return auth.ownerId;
}

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || 'anonymous';
  const now = Date.now();
  const current = rateLimitStore.get(key);

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

router.get('/devices', requireAuth('owner'), async (req, res, next) => {
  try {
    const ownerId = getOwnerIdFromRequest(req);
    const devices = await Device.find({ ownerId }).sort({ registeredAt: -1 });
    res.json(devices);
  } catch (error) {
    next(error);
  }
});

router.post('/devices', requireAuth('owner'), async (req, res, next) => {
  try {
    const ownerId = getOwnerIdFromRequest(req);
    const registration = validateRegistrationInput(req.body ?? {});

    const existing = await Device.findOne({ ownerId, deviceIdentifier: registration.deviceIdentifier });
    if (existing) {
      existing.name = registration.deviceName;
      existing.type = registration.type;
      existing.deviceId = registration.deviceId ?? existing.deviceId;
      existing.discoverySource = registration.discoverySource ?? existing.discoverySource;
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
      discoverySource: registration.discoverySource ?? 'REAL',
      recoveryState: normalizeRecoveryState(registration.recoveryState),
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
  } catch (error) {
    next(error);
  }
});

router.get('/devices/:deviceId', requireAuth('owner'), async (req, res, next) => {
  try {
    const ownerId = getOwnerIdFromRequest(req);
    const device = await Device.findOne({ ownerId, deviceId: req.params.deviceId });
    if (!device) {
      return res.status(404).json({ error: 'Recovery device not found for this owner.' });
    }

    const encounters = await RecoveryEncounter.find({ ownerId, deviceId: device.deviceId }).sort({ observedAt: -1 }).limit(20);
    return res.json(buildAuthorizedRecoveryRecord(device.toObject(), encounters.map((entry) => entry.toObject())));
  } catch (error) {
    return next(error);
  }
});

router.patch('/devices/:deviceId', requireAuth('owner'), async (req, res, next) => {
  try {
    const ownerId = getOwnerIdFromRequest(req);
    const requestedState = req.body?.status ?? req.body?.recoveryState;
    if (requestedState !== 'lost' && requestedState !== 'searching' && requestedState !== 'found' && requestedState !== 'recovered') {
      throw new RecoveryValidationError('Recovery state must be lost, searching, found, or recovered.');
    }
    const nextState = normalizeRecoveryState(requestedState);
    const device = await Device.findOne({ ownerId, deviceId: req.params.deviceId });
    if (!device) {
      return res.status(404).json({ error: 'Recovery device not found for this owner.' });
    }

    assertRecoveryTransition(device.recoveryState, nextState);
    device.recoveryState = nextState;
    await device.save();
    return res.json(device);
  } catch (error) {
    return next(error);
  }
});

router.get('/devices/:deviceId/encounters', requireAuth('owner'), async (req, res, next) => {
  try {
    const ownerId = getOwnerIdFromRequest(req);
    const device = await Device.findOne({ ownerId, deviceId: req.params.deviceId });
    if (!device) {
      return res.status(404).json({ error: 'Recovery device not found for this owner.' });
    }

    const encounters = await RecoveryEncounter.find({ ownerId, deviceId: device.deviceId }).sort({ observedAt: -1 }).limit(50);
    return res.json(encounters);
  } catch (error) {
    return next(error);
  }
});

router.post('/devices/:deviceId/encounters', requireAuth('owner'), rateLimit, async (req, res, next) => {
  try {
    const ownerId = getOwnerIdFromRequest(req);
    const device = await Device.findOne({ ownerId, deviceId: req.params.deviceId });
    if (!device) {
      // Use the same response for missing and non-owned devices to avoid leaking existence.
      return res.status(404).json({ error: 'Recovery device not found.' });
    }

    const payload = validateEncounterInput({
      ...req.body,
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

    device.recoveryState = normalizeRecoveryState(device.recoveryState ?? 'searching');
    device.lastSeen = new Date();
    await device.save();

    const publicEncounter = encounter.toObject();
    delete publicEncounter.ownerId;
    return res.status(201).json(publicEncounter);
  } catch (error) {
    return next(error);
  }
});

export default router;
