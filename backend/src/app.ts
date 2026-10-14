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

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.use('/api/health', healthRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/threats', threatsRouter);
app.use('/api/actions', actionsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/recovery', recoveryRouter);

app.use(errorHandler);

export default app;