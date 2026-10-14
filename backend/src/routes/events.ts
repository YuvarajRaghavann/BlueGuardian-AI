import { Router } from 'express';
import AuditEvent from '../models/AuditEvent';
import { requireAuth } from '../auth';

const router = Router();
router.use(requireAuth('owner'));

router.get('/', async (req, res) => {
  const { deviceId } = req.query;
  const filter = deviceId ? { deviceId } : {};
  const events = await AuditEvent.find(filter).sort({ timestamp: -1 }).limit(200);
  res.json(events);
});

router.post('/', async (req, res) => {
  const { deviceId, eventType, description, source = 'SYSTEM', simulated = false, metadata } = req.body;
  const event = new AuditEvent({ deviceId, eventType, description, source, simulated, metadata, timestamp: new Date() });
  await event.save();
  res.status(201).json(event);
});

export default router;