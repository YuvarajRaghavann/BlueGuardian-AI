import { Router } from 'express';
import ThreatAssessment from '../models/ThreatAssessment';
import { requireAuth } from '../auth';

const router = Router();
router.use(requireAuth('owner'));

router.get('/', async (req, res) => {
  const { deviceId } = req.query;
  const filter = deviceId ? { deviceId } : {};
  const threats = await ThreatAssessment.find(filter).sort({ timestamp: -1 });
  res.json(threats);
});

export default router;