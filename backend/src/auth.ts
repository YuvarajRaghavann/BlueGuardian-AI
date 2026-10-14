import type { NextFunction, Request, Response } from 'express';

export type AuthRole = 'owner' | 'participant';

export interface AuthContext {
  role: AuthRole;
  ownerId?: string;
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
  const value = headerValue.trim();
  if (!value.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export function requireAuth(role: AuthRole = 'owner') {
  return (req: Request, res: Response, next: NextFunction) => {
    const { mode, ownerToken, participantToken, ownerId } = getAuthConfig();
    const request = req as Request & { auth?: AuthContext };
    const logRejection = (category: 'missing_bearer_token' | 'invalid_owner_token' | 'invalid_participant_token') => {
      console.warn(`[auth] rejected protected request category=${category} role=${role}`);
    };

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

    const isOwnerToken = ownerToken !== undefined && token === ownerToken;
    const isParticipantToken = (participantToken !== undefined && token === participantToken) || isOwnerToken;

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
