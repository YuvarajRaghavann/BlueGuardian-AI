import { Router } from 'express';
const router = Router();

router.get('/', async (req, res) => {
  const mongoose = (await import('mongoose')).default;
  const dbState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const status = dbState === 'connected' ? 'ok' : 'degraded';
  res.json({ status, database: dbState });
});

export default router;