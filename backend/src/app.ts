import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import recoveryRouter from './routes/recovery';

const app = express();

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // Non-browser clients do not need CORS headers. Browser origins must be explicitly allowlisted.
    if (!origin) return callback(null, true);
    const allowedOrigins = (process.env.BLUEGUARDIAN_CORS_ORIGINS ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
    return callback(null, allowedOrigins.includes(origin));
  },
}));
app.use(express.json());
app.use(morgan('dev'));

app.use('/api/health', healthRouter);
app.use('/api/recovery', recoveryRouter);

app.use(errorHandler);

export default app;