import { Router } from 'express';
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
  const limitValue = typeof req.query.limit === 'string' ? Number(req.query.limit) : 200;
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 500) {
    return res.status(400).json({ error: 'limit must be an integer between 1 and 500.' });
  }
  const threats = await ThreatAssessment.find(filter).sort({ timestamp: -1 }).limit(limitValue);
  return res.json(threats);
}));

export default router;
