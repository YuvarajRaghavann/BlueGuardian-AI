import { Router } from 'express';
import { z } from 'zod';
import Device from '../models/Device';
import ThreatAssessment from '../models/ThreatAssessment';
import { assessDevice } from '../services/assessment';
import { requireAuth } from '../auth';

const router = Router();
router.use(requireAuth('owner'));

const deviceCreateSchema = z.object({
  deviceId: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  discoverySource: z.enum(['REAL','SIMULATED']),
  address: z.string().optional(),
  rssi: z.number().optional(),
  connectionStatus: z.string().optional(),
  gattConnected: z.boolean().optional(),
  services: z.array(z.object({ uuid: z.string(), name: z.string().optional() })).optional(),
  characteristics: z.array(z.object({ uuid: z.string(), name: z.string().optional(), properties: z.array(z.string()).optional() })).optional(),
  batteryLevel: z.number().optional(),
  manufacturer: z.string().optional(),
  trustScore: z.number().optional(),
  riskLevel: z.string().optional(),
  isKnown: z.boolean().optional(),
  trusted: z.boolean().optional(),
  blocked: z.boolean().optional(),
  connectionHealth: z.string().optional(),
});

router.get('/', async (req, res) => {
  const devices = await Device.find().sort({ lastSeen: -1 });
  res.json(devices);
});

router.get('/:id', async (req, res) => {
  const device = await Device.findOne({ deviceId: req.params.id });
  if (!device) return res.status(404).json({ error: 'Not found' });
  res.json(device);
});

router.post('/', async (req, res) => {
  const parse = deviceCreateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error });
  const existing = await Device.findOne({ deviceId: parse.data.deviceId });
  if (existing) {
    Object.assign(existing, parse.data, { lastSeen: new Date() });
    await existing.save();
    return res.json(existing);
  }
  const device = new Device({ ...parse.data, firstSeen: new Date(), lastSeen: new Date() });
  await device.save();
  res.status(201).json(device);
});

router.patch('/:id', async (req, res) => {
  const device = await Device.findOneAndUpdate({ deviceId: req.params.id }, { ...req.body, lastSeen: new Date() }, { new: true });
  if (!device) return res.status(404).json({ error: 'Not found' });
  res.json(device);
});

router.post('/:id/assess', async (req, res) => {
  const device = await Device.findOne({ deviceId: req.params.id });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const assessment = await assessDevice(device.toObject());
  device.trustScore = assessment.trustScore;
  device.riskLevel = assessment.trustRiskLevel;
  await device.save();
  res.json(assessment);
});

export default router;