import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

const databaseUnavailableNames = new Set([
  'MongoNetworkError',
  'MongoNotConnectedError',
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
]);

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (mongoose.connection.readyState !== 1 || !error || typeof error !== 'object') {
    return mongoose.connection.readyState !== 1;
  }

  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  return databaseUnavailableNames.has(name) ||
    (name === 'MongooseError' && /buffering timed out|before initial connection/i.test(message));
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const status = err.status || 500;
  if (status < 500) {
    return res.status(status).json({ error: err.message || 'Request failed.' });
  }

  if (isDatabaseUnavailableError(err)) {
    const route = typeof req.route?.path === 'string' ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unknown';
    const errorName = err && typeof err.name === 'string' ? err.name : 'UnknownError';
    console.error(`[api] request failed category=database_unavailable method=${req.method} route=${route} dbState=${mongoose.connection.readyState} errorName=${errorName}`);
    return res.status(503).json({ error: 'Recovery storage is unavailable. Retry after the database connection is restored.' });
  }

  const errorName = err && typeof err.name === 'string' ? err.name : 'UnknownError';
  console.error(`[api] request failed category=internal_error method=${req.method} errorName=${errorName}`);
  return res.status(status).json({ error: 'The request could not be completed.' });
}