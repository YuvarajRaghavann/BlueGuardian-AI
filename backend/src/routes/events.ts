import { Router } from 'express';
import { z } from 'zod';
import AuditEvent from '../models/AuditEvent';
import Device from '../models/Device';
import { getOwnerIdFromRequest, requireAuth } from '../auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
router.use(requireAuth('owner'));

router.get('/', asyncHandler(async (req, res) => {
  const ownerId = getOwnerIdFromRequest(req);
  const filter: Record<string, any> = { ownerId };
  if (typeof req.query.deviceId === 'string' && req.query.deviceId.trim()) {
    filter.deviceId = req.query.deviceId.trim();
  } else if (req.query.deviceId !== undefined) {
    return res.status(400).json({ error: 'deviceId must be a single non-empty string.' });
  }
  const events = await AuditEvent.find(filter).sort({ timestamp: -1 }).limit(200);
  return res.json(events);
}));

const eventSchema = z.object({
  deviceId: z.string().trim().min(1).max(256).optional(),
  eventType: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  source: z.enum(['USER', 'SYSTEM']).default('SYSTEM'),
  simulated: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
}).strip();

router.post('/', asyncHandler(async (req, res) => {
  const parse = eventSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid event payload.', issues: parse.error.issues });

  const ownerId = getOwnerIdFromRequest(req);
  const data = parse.data;
  if (data.deviceId) {
    const device = await Device.findOne({ ownerId, deviceId: data.deviceId });
    if (!device) return res.status(404).json({ error: 'Device not found.' });
  }

  // Bound metadata to avoid using event history as an unbounded arbitrary-object store.
  if (data.metadata && Buffer.byteLength(JSON.stringify(data.metadata), 'utf8') > 8_192) {
    return res.status(400).json({ error: 'Event metadata must not exceed 8 KB.' });
  }

  const event = new AuditEvent({
    ownerId,
    deviceId: data.deviceId,
    eventType: data.eventType,
    description: data.description ?? data.eventType,
    source: data.source,
    simulated: data.simulated,
    metadata: data.metadata,
    timestamp: new Date(),
  });
  await event.save();
  return res.status(201).json(event);
}));

export default router;
