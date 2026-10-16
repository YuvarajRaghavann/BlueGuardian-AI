import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';
import type { Request, NextFunction, Response } from 'express';

export type AuthRole = 'owner' | 'participant';

export interface AuthContext {
  role: AuthRole;
  ownerId?: string;
  /** Kept for compatibility with existing middleware consumers. Never log or return it. */
  token: string;
}

export interface FirebaseIdTokenClaims {
  aud: unknown;
  iss: unknown;
  sub: unknown;
  exp: unknown;
  iat: unknown;
  auth_time: unknown;
  role?: unknown;
  participant?: unknown;
  [claim: string]: unknown;
}

export class FirebaseTokenVerificationError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid-token' | 'verifier-unavailable' = 'invalid-token',
  ) {
    super(message);
    this.name = 'FirebaseTokenVerificationError';
  }
}

export function getAuthConfig() {
  const mode = process.env.BLUEGUARDIAN_AUTH_MODE ?? (process.env.NODE_ENV === 'production' ? 'required' : 'development');
  const ownerToken = process.env.BLUEGUARDIAN_OWNER_TOKEN?.trim() || (process.env.NODE_ENV === 'test' ? 'blueguardian-owner-token' : undefined);
  const participantToken = process.env.BLUEGUARDIAN_PARTICIPANT_TOKEN?.trim() || (process.env.NODE_ENV === 'test' ? 'blueguardian-participant-token' : undefined);
  const ownerId = process.env.BLUEGUARDIAN_OWNER_ID?.trim() || (process.env.NODE_ENV === 'test' ? 'test-owner' : undefined);
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID?.trim() || undefined;

  return { mode, ownerToken, participantToken, ownerId, firebaseProjectId };
}

export function parseBearerToken(headerValue?: string): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Hash both values before comparing so timingSafeEqual always compares fixed-length buffers.
 * This is only the development fallback, not a production identity mechanism.
 */
function tokenMatches(candidate: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const candidateHash = createHash('sha256').update(candidate, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

export function getOwnerIdFromRequest(req: Request): string {
  const request = req as Request & { auth?: AuthContext };
  if (request.auth?.role !== 'owner' || !request.auth.ownerId) {
    throw Object.assign(new Error('Verified owner identity is required for this operation.'), { status: 403 });
  }
  return request.auth.ownerId;
}

const FIREBASE_SIGNING_KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
type FirebaseSigningJwk = Record<string, unknown> & { kid?: string; kty?: string; use?: string; alg?: string };
let cachedSigningKeys: { keys: FirebaseSigningJwk[]; expiresAt: number } | null = null;

export function clearFirebaseSigningKeyCacheForTests(): void {
  cachedSigningKeys = null;
}

async function loadFirebaseSigningKeys(forceRefresh = false): Promise<FirebaseSigningJwk[]> {
  if (!forceRefresh && cachedSigningKeys && cachedSigningKeys.expiresAt > Date.now()) {
    return cachedSigningKeys.keys;
  }

  let response: Response;
  try {
    response = await fetch(FIREBASE_SIGNING_KEYS_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new FirebaseTokenVerificationError('Firebase signing keys are unreachable.', 'verifier-unavailable');
  }

  if (!response.ok) {
    throw new FirebaseTokenVerificationError('Firebase signing keys could not be retrieved.', 'verifier-unavailable');
  }

  let body: { keys?: FirebaseSigningJwk[] };
  try {
    body = await response.json() as { keys?: FirebaseSigningJwk[] };
  } catch {
    throw new FirebaseTokenVerificationError('Firebase signing-key response was invalid.', 'verifier-unavailable');
  }

  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new FirebaseTokenVerificationError('Firebase signing-key response contained no keys.', 'verifier-unavailable');
  }

  const maxAgeMatch = response.headers.get('cache-control')?.match(/max-age=(\d+)/i);
  const cacheSeconds = Math.max(60, Math.min(43_200, maxAgeMatch ? Number(maxAgeMatch[1]) : 300));
  cachedSigningKeys = { keys: body.keys, expiresAt: Date.now() + cacheSeconds * 1000 };
  return body.keys;
}

function decodeJwtJson<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    throw new FirebaseTokenVerificationError('Firebase ID token is malformed.');
  }
}

/**
 * Verify Firebase Authentication ID tokens using Google's rotating public JWKs.
 * No Firebase service-account private key is required on the backend.
 */
export async function verifyFirebaseIdToken(token: string, projectId: string): Promise<FirebaseIdTokenClaims> {
  const pieces = token.split('.');
  if (pieces.length !== 3 || pieces.some(piece => !piece)) {
    throw new FirebaseTokenVerificationError('Firebase ID token is malformed.');
  }

  const header = decodeJwtJson<{ alg?: unknown; kid?: unknown }>(pieces[0]);
  const claims = decodeJwtJson<FirebaseIdTokenClaims>(pieces[1]);

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new FirebaseTokenVerificationError('Firebase ID token uses an unsupported signing algorithm.');
  }

  const project = projectId.trim();
  if (!project) {
    throw new FirebaseTokenVerificationError('Firebase project ID is not configured.', 'verifier-unavailable');
  }

  let jwk = (await loadFirebaseSigningKeys()).find(key => key.kid === header.kid);
  if (!jwk) {
    // Firebase rotates signing keys. Refresh once before classifying the token as invalid.
    jwk = (await loadFirebaseSigningKeys(true)).find(key => key.kid === header.kid);
  }
  if (!jwk || jwk.kty !== 'RSA' || (jwk.use && jwk.use !== 'sig') || (jwk.alg && jwk.alg !== 'RS256')) {
    throw new FirebaseTokenVerificationError('Firebase ID token signing key is not recognized.');
  }

  let signatureIsValid = false;
  try {
    const publicKey = createPublicKey({ key: jwk as any, format: 'jwk' });
    signatureIsValid = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${pieces[0]}.${pieces[1]}`, 'utf8'),
      publicKey,
      Buffer.from(pieces[2], 'base64url'),
    );
  } catch {
    throw new FirebaseTokenVerificationError('Firebase ID token signature could not be verified.');
  }

  if (!signatureIsValid) {
    throw new FirebaseTokenVerificationError('Firebase ID token signature is invalid.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    claims.aud !== project ||
    claims.iss !== `https://securetoken.google.com/${project}` ||
    typeof claims.sub !== 'string' ||
    claims.sub.length === 0 ||
    claims.sub.length > 128 ||
    typeof claims.exp !== 'number' ||
    claims.exp <= nowSeconds ||
    typeof claims.iat !== 'number' ||
    claims.iat > nowSeconds + 300 ||
    typeof claims.auth_time !== 'number' ||
    claims.auth_time > nowSeconds + 300
  ) {
    throw new FirebaseTokenVerificationError('Firebase ID token claims are invalid or expired.');
  }

  return claims;
}

export function requireAuth(role: AuthRole = 'owner') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { mode, ownerToken, participantToken, ownerId, firebaseProjectId } = getAuthConfig();
    const request = req as Request & { auth?: AuthContext };
    const logRejection = (category: 'missing_bearer_token' | 'invalid_owner_token' | 'invalid_participant_token' | 'invalid_firebase_token') => {
      // Deliberately do not log the Authorization header or token value.
      console.warn(`[auth] rejected protected request category=${category} role=${role}`);
    };

    if (mode === 'disabled') {
      return res.status(503).json({
        error: 'Protected API access is disabled. Configure owner authentication before enabling these routes.',
      });
    }

    const token = parseBearerToken(req.headers.authorization);

    if (firebaseProjectId) {
      if (!token) {
        logRejection('missing_bearer_token');
        return res.status(401).json({ error: 'Authorization header with Firebase Bearer ID token is required.' });
      }

      try {
        const claims = await verifyFirebaseIdToken(token, firebaseProjectId);
        const hasParticipantRole = claims.role === 'participant' || claims.participant === true;

        if (role === 'participant' && !hasParticipantRole) {
          return res.status(403).json({ error: 'A server-assigned participant role is required for this operation.' });
        }

        request.auth = {
          role: role === 'participant' ? 'participant' : 'owner',
          ownerId: typeof claims.sub === 'string' ? claims.sub : undefined,
          token,
        };
        return next();
      } catch (error) {
        if (error instanceof FirebaseTokenVerificationError && error.kind === 'verifier-unavailable') {
          return res.status(503).json({ error: 'Firebase identity verification is temporarily unavailable or misconfigured.' });
        }
        logRejection('invalid_firebase_token');
        return res.status(401).json({ error: 'Firebase ID token is invalid or expired. Please sign in again.' });
      }
    }

    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        error: 'Firebase identity verification is not configured. Set FIREBASE_PROJECT_ID before enabling protected APIs.',
      });
    }

    if (!token) {
      logRejection('missing_bearer_token');
      return res.status(401).json({ error: 'Authorization header with Bearer token is required.' });
    }

    if ((role === 'owner' && (!ownerToken || !ownerId)) || (role === 'participant' && !ownerToken && !participantToken)) {
      return res.status(503).json({ error: 'Owner authentication is not configured on the server.' });
    }

    const isOwnerToken = tokenMatches(token, ownerToken);
    const isParticipantToken = tokenMatches(token, participantToken) || isOwnerToken;

    if (role === 'owner' && !isOwnerToken) {
      logRejection('invalid_owner_token');
      return res.status(401).json({ error: 'Owner token required.' });
    }

    if (role === 'participant' && !isParticipantToken) {
      logRejection('invalid_participant_token');
      return res.status(401).json({ error: 'Participant or owner token required.' });
    }

    request.auth = {
      role: isOwnerToken ? 'owner' : 'participant',
      ownerId: isOwnerToken ? ownerId : undefined,
      token,
    };

    return next();
  };
}
