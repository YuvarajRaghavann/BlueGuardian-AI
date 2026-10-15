import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, NextFunction, Response } from 'express';

export type AuthRole = 'owner' | 'participant';

export interface AuthContext {
  role: AuthRole;
  ownerId?: string;
  /** Kept for compatibility with existing middleware consumers. Never log or return it. */
  token: string;
}

export function getAuthConfig() {
  const mode = process.env.BLUEGUARDIAN_AUTH_MODE ?? (process.env.NODE_ENV === 'production' ? 'required' : 'development');
  const ownerToken = process.env.BLUEGUARDIAN_OWNER_TOKEN?.trim() || (process.env.NODE_ENV === 'test' ? 'blueguardian-owner-token' : undefined);
  const participantToken = process.env.BLUEGUARDIAN_PARTICIPANT_TOKEN?.trim() || (process.env.NODE_ENV === 'test' ? 'blueguardian-participant-token' : undefined);
  const ownerId = process.env.BLUEGUARDIAN_OWNER_ID?.trim() || (process.env.NODE_ENV === 'test' ? 'test-owner' : undefined);

  return { mode, ownerToken, participantToken, ownerId };
}

export function parseBearerToken(headerValue?: string): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Hash both values before comparing so timingSafeEqual always compares fixed-length buffers.
 * This hardens the existing development-token mechanism; it is NOT a replacement for OIDC/JWKS.
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

export function requireAuth(role: AuthRole = 'owner') {
  return (req: Request, res: Response, next: NextFunction) => {
    const { mode, ownerToken, participantToken, ownerId } = getAuthConfig();
    const request = req as Request & { auth?: AuthContext };
    const logRejection = (category: 'missing_bearer_token' | 'invalid_owner_token' | 'invalid_participant_token') => {
      // Deliberately do not log the Authorization header or token value.
      console.warn(`[auth] rejected protected request category=${category} role=${role}`);
    };

    // Production remains fail-closed until a real issuer/audience/signature/expiry verifier is configured.
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        error: 'Production identity verification is not configured. Configure an OIDC verifier before enabling protected APIs.',
      });
    }

    if (mode === 'disabled') {
      return res.status(503).json({
        error: 'Protected API access is disabled. Configure owner authentication before enabling these routes.',
      });
    }

    if ((role === 'owner' && (!ownerToken || !ownerId)) || (role === 'participant' && !ownerToken && !participantToken)) {
      return res.status(503).json({ error: 'Owner authentication is not configured on the server.' });
    }

    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      logRejection('missing_bearer_token');
      return res.status(401).json({ error: 'Authorization header with Bearer token is required.' });
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
