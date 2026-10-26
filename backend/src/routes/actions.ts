import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import SecurityAction from '../models/SecurityAction';
import AuditEvent from '../models/AuditEvent';
import Device from '../models/Device';
import ThreatAssessment from '../models/ThreatAssessment';
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
  const actions = await SecurityAction.find(filter).sort({ timestamp: -1 }).limit(200);
  return res.json(actions);
}));

const actionSchema = z.object({
  deviceId: z.string().trim().min(1).max(256),
  deviceName: z.string().trim().max(100).optional(),
  action: z.enum(['TRUST', 'MARK_UNKNOWN', 'BLOCK', 'UNBLOCK', 'FORGET', 'INVESTIGATE', 'RESOLVE_THREAT', 'DISMISS_THREAT', 'IGNORE_DEVICE']),
  // Accepted for backwards compatibility, but before/after state is derived on the server.
  previousState: z.unknown().optional(),
  newState: z.unknown().optional(),
  source: z.enum(['USER', 'SYSTEM']).default('USER'),
  simulated: z.boolean(),
  reason: z.string().trim().max(500).optional(),
  threatId: z.string().trim().max(100).optional(),
}).strip();

router.post('/', asyncHandler(async (req, res) => {
  const parse = actionSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid security action.', issues: parse.error.issues });

  const ownerId = getOwnerIdFromRequest(req);
  const data = parse.data;
  const isThreatAction = data.action === 'INVESTIGATE' || data.action === 'RESOLVE_THREAT' || data.action === 'DISMISS_THREAT';
  if (data.threatId && isThreatAction && !mongoose.isValidObjectId(data.threatId)) {
    return res.status(400).json({ error: 'threatId must be a valid threat record identifier.' });
  }
  // Never mutate or record an action against another owner's device (or a fabricated device ID).
  const device = await Device.findOne({ ownerId, deviceId: data.deviceId });
  if (!device) return res.status(404).json({ error: 'Device not found.' });

  const previousState = {
    trusted: Boolean(device.trusted),
    isKnown: Boolean(device.isKnown),
    blocked: Boolean(device.blocked),
    trustScore: device.trustScore ?? null,
    riskLevel: device.riskLevel ?? null,
  };
  let newState: Record<string, any> = { ...previousState };
  let relatedThreatId: string | undefined;

  switch (data.action) {
    case 'TRUST':
      device.trusted = true;
      device.isKnown = true;
      break;
    case 'MARK_UNKNOWN':
      device.trusted = false;
      device.isKnown = false;
      break;
    case 'BLOCK':
      device.blocked = true;
      break;
    case 'UNBLOCK':
      device.blocked = false;
      break;
    case 'FORGET':
      // A forgotten security-dashboard device may also have an active recovery case because the
      // existing application shares the Device collection. Preserve that case until it is closed.
      if (device.recoveryEnabled !== false && device.recoveryState !== 'recovered') {
        return res.status(409).json({ error: 'This device has an active recovery case. Mark it recovered before forgetting it.' });
      }
      // Keep an audit trail after removing the device record.
      await device.deleteOne();
      newState = { removed: true };
      break;
    case 'INVESTIGATE':
    case 'RESOLVE_THREAT':
    case 'DISMISS_THREAT': {
      const threatFilter: Record<string, any> = { ownerId, deviceId: data.deviceId };
      if (data.threatId) threatFilter._id = data.threatId;
      const threat = await ThreatAssessment.findOne(threatFilter).sort({ timestamp: -1 });
      if (!threat) return res.status(404).json({ error: 'No matching threat assessment was found for this device.' });
      const priorThreatStatus = threat.status ?? 'active';
      const nextThreatStatus = data.action === 'INVESTIGATE'
        ? 'investigating'
        : data.action === 'RESOLVE_THREAT' ? 'resolved' : 'dismissed';
      threat.status = nextThreatStatus;
      await threat.save();
      relatedThreatId = String(threat._id);
      newState = { ...previousState, threatStatus: nextThreatStatus, previousThreatStatus: priorThreatStatus };
      break;
    }
    case 'IGNORE_DEVICE':
      // Intentional no-op on device trust flags; action is still audited for history.
      break;
  }

  if (data.action !== 'FORGET' && !isThreatAction) {
    await device.save();
  }

  const timestamp = new Date();
  const action = new SecurityAction({
    ownerId,
    deviceId: data.deviceId,
    deviceName: data.deviceName ?? device.name,
    action: data.action,
    previousState,
    newState,
    source: data.source,
    simulated: data.simulated,
    reason: data.reason,
    threatId: data.threatId ?? relatedThreatId,
    timestamp,
  });
  await action.save();

  const audit = new AuditEvent({
    ownerId,
    deviceId: data.deviceId,
    eventType: 'SECURITY_ACTION',
    description: `${data.action} performed on device ${data.deviceId}`,
    source: data.source,
    simulated: data.simulated,
    metadata: { action: data.action, threatId: data.threatId ?? relatedThreatId },
    timestamp,
  });
  await audit.save();

  return res.status(201).json({ action, audit });
}));

export default router;
