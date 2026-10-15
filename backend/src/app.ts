import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import devicesRouter from './routes/devices';
import threatsRouter from './routes/threats';
import actionsRouter from './routes/actions';
import eventsRouter from './routes/events';
import recoveryRouter from './routes/recovery';

const app = express();

app.disable('x-powered-by');
app.use(helmet());

// CORS is not authentication. It controls browser access only; APIs still require auth.
// Leave BLUEGUARDIAN_CORS_ORIGINS empty until the exact frontend origin(s) are known.
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // curl, mobile clients and server-to-server requests
    const allowedOrigins = (process.env.BLUEGUARDIAN_CORS_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return callback(null, allowedOrigins.includes(origin));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'If-None-Match', 'If-Modified-Since'],
  maxAge: 600,
}));

// Bound request size to reduce accidental or abusive oversized JSON payloads.
app.use(express.json({ limit: '256kb' }));
// Avoid logging query strings, which may contain identifiers or other sensitive values.
app.use(morgan(':method :status :response-time ms'));

app.use('/api/health', healthRouter);
// Existing API routes are retained, but are now owner-scoped and validated.
app.use('/api/devices', devicesRouter);
app.use('/api/threats', threatsRouter);
app.use('/api/actions', actionsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/recovery', recoveryRouter);

app.use((_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use(errorHandler);

export default app;
