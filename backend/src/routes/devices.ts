import { Router } from 'express';
import { z } from 'zod';
import Device from '../models/Device';
import { assessDevice } from '../services/assessment';
import { getOwnerIdFromRequest, requireAuth } from '../auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
router.use(requireAuth('owner'));

// Preserve existing client fields while validating size/range and never accepting ownerId as authority.
const deviceCreateSchema = z.object({
  deviceId: z.string().trim().min(1).max(256),
  deviceIdentifier: z.string().trim().min(1).max(256).optional(),
  name: z.string().trim().max(100).optional(),
  type: z.string().trim().max(80).optional(),
  discoverySource: z.enum(['REAL', 'SIMULATED']),
  address: z.string().trim().max(256).optional(),
  rssi: z.number().finite().min(-127).max(20).optional(),
  connectionStatus: z.enum(['connected', 'disconnected', 'connecting', 'unknown']).optional(),
  gattConnected: z.boolean().optional(),
  services: z.array(z.object({ uuid: z.string().max(128), name: z.string().max(120).optional() })).max(64).optional(),
  characteristics: z.array(z.object({ uuid: z.string().max(128), name: z.string().max(120).optional(), properties: z.array(z.string().max(40)).max(20).optional() })).max(256).optional(),
  batteryLevel: z.number().finite().min(0).max(100).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  trustScore: z.number().finite().min(0).max(100).optional(),
  riskLevel: z.enum(['trusted', 'low', 'medium', 'high']).optional(),
  isKnown: z.boolean().optional(),
  trusted: z.boolean().optional(),
  blocked: z.boolean().optional(),
  connectionHealth: z.string().trim().max(80).optional(),
}).strip();

const deviceUpdateSchema = deviceCreateSchema.omit({ deviceId: true }).partial();

router.get('/', asyncHandler(async (req, res) => {
  const ownerId = getOwnerIdFromRequest(req);
  const devices = await Device.find({ ownerId }).sort({ lastSeen: -1 }).limit(500);
  res.json(devices);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const ownerId = getOwnerIdFromRequest(req);
  const device = await Device.findOne({ ownerId, deviceId: req.params.id });
  if (!device) return res.status(404).json({ error: 'Device not found.' });
  return res.json(device);
}));

router.post('/', asyncHandler(async (req, res) => {
  const parse = deviceCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid device payload.', issues: parse.error.issues });

  const ownerId = getOwnerIdFromRequest(req);
  const data = parse.data;
  const deviceIdentifier = data.deviceIdentifier ?? data.deviceId;
  const existing = await Device.findOne({ ownerId, deviceId: data.deviceId });

  if (existing) {
    // Do not allow a client payload to transfer a record to a different owner.
    Object.assign(existing, data, {
      deviceIdentifier,
      ownerId,
      name: data.name ?? existing.name ?? data.deviceId,
      lastSeen: new Date(),
    });
    await existing.save();
    return res.status(200).json(existing);
  }

  const device = new Device({
    ...data,
    name: data.name ?? data.deviceId,
    deviceIdentifier,
    ownerId,
    recoveryEnabled: false,
    firstSeen: new Date(),
    lastSeen: new Date(),
  });
  await device.save();
  return res.status(201).json(device);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const parse = deviceUpdateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid device update.', issues: parse.error.issues });
  if (Object.keys(parse.data).length === 0) {
    return res.status(400).json({ error: 'Provide at least one supported field to update.' });
  }

  const ownerId = getOwnerIdFromRequest(req);
  // Explicit allowlisted fields only. deviceId and ownerId cannot be changed via PATCH.
  const device = await Device.findOneAndUpdate(
    { ownerId, deviceId: req.params.id },
    { $set: { ...parse.data, lastSeen: new Date() } },
    { new: true, runValidators: true, context: 'query' },
  );
  if (!device) return res.status(404).json({ error: 'Device not found.' });
  return res.json(device);
}));

router.post('/:id/assess', asyncHandler(async (req, res) => {
  const ownerId = getOwnerIdFromRequest(req);
  const device = await Device.findOne({ ownerId, deviceId: req.params.id });
  if (!device) return res.status(404).json({ error: 'Device not found.' });

  const assessment = await assessDevice(device.toObject(), ownerId);
  device.trustScore = assessment.trustScore;
  device.riskLevel = assessment.trustRiskLevel;
  await device.save();
  return res.json(assessment);
}));

export default router;
