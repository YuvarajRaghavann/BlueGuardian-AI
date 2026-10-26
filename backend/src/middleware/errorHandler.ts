import type { Request, Response, NextFunction } from 'express';
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

function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 11000;
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  // JSON body-parser errors should be understandable to the frontend, not reported as server failures.
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && (err as SyntaxError & { status?: number }).status === 400)) {
    return res.status(400).json({ error: 'Malformed JSON request body.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }

  if (isDuplicateKeyError(err)) {
    return res.status(409).json({ error: 'A record with this identifier already exists.' });
  }

  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
  if (status < 500) {
    return res.status(status).json({ error: typeof err?.message === 'string' ? err.message : 'Request failed.' });
  }

  if (isDatabaseUnavailableError(err)) {
    const route = typeof req.route?.path === 'string' ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unknown';
    const errorName = err && typeof err.name === 'string' ? err.name : 'UnknownError';
    console.error(`[api] request failed category=database_unavailable method=${req.method} route=${route} dbState=${mongoose.connection.readyState} errorName=${errorName}`);
    return res.status(503).json({ error: 'Database storage is unavailable. Retry after the connection is restored.' });
  }

  const errorName = err && typeof err.name === 'string' ? err.name : 'UnknownError';
  console.error(`[api] request failed category=internal_error method=${req.method} errorName=${errorName}`);
  return res.status(500).json({ error: 'The request could not be completed.' });
}
