import { Router } from 'express';
import { z } from 'zod';
import SecurityAction from '../models/SecurityAction';
import AuditEvent from '../models/AuditEvent';
import Device from '../models/Device';
import { requireAuth } from '../auth';

const router = Router();
router.use(requireAuth('owner'));

router.get('/', async (req, res) => {
  const { deviceId } = req.query;
  const filter = deviceId ? { deviceId } : {};
  const actions = await SecurityAction.find(filter).sort({ timestamp: -1 }).limit(200);
  res.json(actions);
});

const actionSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string().optional(),
  action: z.enum(['TRUST','MARK_UNKNOWN','BLOCK','UNBLOCK','FORGET','INVESTIGATE','RESOLVE_THREAT','DISMISS_THREAT','IGNORE_DEVICE']),
  previousState: z.any().optional(),
  newState: z.any().optional(),
  source: z.enum(['USER','SYSTEM']).default('USER'),
  simulated: z.boolean(),
  reason: z.string().optional(),
});

router.post('/', async (req, res) => {
  const parse = actionSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error });
  const device = await Device.findOne({ deviceId: parse.data.deviceId });
  const previousState = device ? {
    trusted: device.trusted,
    isKnown: device.isKnown,
    blocked: device.blocked,
    trustScore: device.trustScore,
    riskLevel: device.riskLevel,
  } : parse.data.previousState;

  if (device) {
    switch (parse.data.action) {
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
        await device.deleteOne();
        break;
    }
    if (parse.data.action !== 'FORGET') await device.save();
  }

  const action = new SecurityAction({ ...parse.data, previousState, timestamp: new Date() });
  await action.save();

  const audit = new AuditEvent({
    deviceId: parse.data.deviceId,
    eventType: 'SECURITY_ACTION',
    description: `${parse.data.action} performed on device ${parse.data.deviceId}`,
    source: parse.data.source,
    simulated: parse.data.simulated,
    metadata: { action: parse.data.action },
  });
  await audit.save();

  res.status(201).json({ action, audit });
});

export default router;