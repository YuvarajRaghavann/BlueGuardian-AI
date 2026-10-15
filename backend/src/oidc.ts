import { createPublicKey, verify as verifySignature } from 'node:crypto';

export interface VerifiedOidcIdentity {
  subject: string;
  scopes: string[];
}

export class OidcTokenError extends Error {
  readonly status = 401;
}

export class OidcConfigurationError extends Error {
  readonly status = 503;
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
  crv?: string;
  [key: string]: unknown;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtClaims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  scope?: unknown;
  scp?: unknown;
  [key: string]: unknown;
}

interface JwksPayload {
  keys?: Jwk[];
}

interface CachedJwks {
  keys: Jwk[];
  expiresAt: number;
}

const jwksCache = new Map<string, CachedJwks>();
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 30;

function readJsonPart<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    throw new OidcTokenError('Malformed bearer token.');
  }
}

function requiredConfig() {
  const issuer = process.env.BLUEGUARDIAN_OIDC_ISSUER?.trim();
  const audience = process.env.BLUEGUARDIAN_OIDC_AUDIENCE?.trim();
  const jwksUri = process.env.BLUEGUARDIAN_OIDC_JWKS_URI?.trim();

  if (!issuer || !audience || !jwksUri) {
    throw new OidcConfigurationError('OIDC issuer, audience, and JWKS URI must all be configured.');
  }

  let issuerUrl: URL;
  let jwksUrl: URL;
  try {
    issuerUrl = new URL(issuer);
    jwksUrl = new URL(jwksUri);
  } catch {
    throw new OidcConfigurationError('OIDC issuer or JWKS URI is not a valid URL.');
  }

  if (process.env.NODE_ENV === 'production' && (issuerUrl.protocol !== 'https:' || jwksUrl.protocol !== 'https:')) {
    throw new OidcConfigurationError('OIDC issuer and JWKS URI must use HTTPS in production.');
  }

  return { issuer, audience, jwksUri: jwksUrl.toString() };
}

async function fetchJwks(uri: string, forceRefresh = false): Promise<Jwk[]> {
  const cached = jwksCache.get(uri);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;

  let response: Response;
  try {
    response = await fetch(uri, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new OidcConfigurationError('Could not reach the configured OIDC signing-key endpoint.');
  }

  if (!response.ok) {
    throw new OidcConfigurationError('The configured OIDC signing-key endpoint returned an error.');
  }

  let payload: JwksPayload;
  try {
    payload = await response.json() as JwksPayload;
  } catch {
    throw new OidcConfigurationError('The OIDC signing-key endpoint returned malformed JSON.');
  }

  if (!payload || !Array.isArray(payload.keys) || payload.keys.length === 0) {
    throw new OidcConfigurationError('The OIDC signing-key endpoint did not return any keys.');
  }

  const keys = payload.keys.filter(key => key && typeof key === 'object' && typeof key.kid === 'string');
  if (keys.length === 0) {
    throw new OidcConfigurationError('The OIDC signing-key set contains no keyed entries.');
  }

  jwksCache.set(uri, { keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS });
  return keys;
}

function isKeyForAlgorithm(key: Jwk, header: JwtHeader): boolean {
  if (!header.kid || key.kid !== header.kid) return false;
  if (key.use && key.use !== 'sig') return false;
  if (key.alg && key.alg !== header.alg) return false;
  if (key.key_ops && !key.key_ops.includes('verify')) return false;

  if (header.alg === 'RS256') return key.kty === 'RSA';
  if (header.alg === 'ES256') return key.kty === 'EC' && key.crv === 'P-256';
  return false;
}

function verifySignatureWithJwk(
  header: JwtHeader,
  jwk: Jwk,
  signingInput: Buffer,
  signature: Buffer,
): boolean {
  const publicKey = createPublicKey({ key: jwk as any, format: 'jwk' });

  if (header.alg === 'RS256') {
    return verifySignature('RSA-SHA256', signingInput, publicKey, signature);
  }

  if (header.alg === 'ES256') {
    return verifySignature('sha256', signingInput, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  }

  return false;
}

function validateClaims(claims: JwtClaims, issuer: string, audience: string): VerifiedOidcIdentity {
  const issuerMatches = typeof claims.iss === 'string' && claims.iss === issuer;
  const aud = typeof claims.aud === 'string'
    ? [claims.aud]
    : Array.isArray(claims.aud) ? claims.aud.filter((entry): entry is string => typeof entry === 'string') : [];
  const now = Math.floor(Date.now() / 1000);

  if (!issuerMatches) throw new OidcTokenError('Token issuer does not match the configured issuer.');
  if (!aud.includes(audience)) throw new OidcTokenError('Token audience does not match the configured API audience.');
  if (typeof claims.sub !== 'string' || !claims.sub.trim()) throw new OidcTokenError('Token subject is missing.');
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || now - CLOCK_SKEW_SECONDS >= claims.exp) {
    throw new OidcTokenError('Token has expired or does not include a valid expiration.');
  }
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || now + CLOCK_SKEW_SECONDS < claims.nbf)) {
    throw new OidcTokenError('Token is not yet valid.');
  }
  if (claims.iat !== undefined && (typeof claims.iat !== 'number' || now + CLOCK_SKEW_SECONDS < claims.iat)) {
    throw new OidcTokenError('Token issued-at time is in the future.');
  }

  const scopes = typeof claims.scope === 'string'
    ? claims.scope.split(/\s+/).filter(Boolean)
    : Array.isArray(claims.scp) ? claims.scp.filter((scope): scope is string => typeof scope === 'string') : [];

  return { subject: claims.sub, scopes };
}

export async function verifyOidcAccessToken(token: string): Promise<VerifiedOidcIdentity> {
  const { issuer, audience, jwksUri } = requiredConfig();
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some(segment => !segment)) throw new OidcTokenError('Malformed bearer token.');

  const header = readJsonPart<JwtHeader>(segments[0]);
  if (header.typ !== undefined && !['JWT', 'at+jwt'].includes(header.typ)) {
    throw new OidcTokenError('Unsupported token type.');
  }
  if (!['RS256', 'ES256'].includes(header.alg ?? '') || typeof header.kid !== 'string' || !header.kid) {
    throw new OidcTokenError('Token uses an unsupported signing algorithm or key identifier.');
  }

  const claims = readJsonPart<JwtClaims>(segments[1]);
  const signingInput = Buffer.from(`${segments[0]}.${segments[1]}`);
  const signature = Buffer.from(segments[2], 'base64url');
  let keys = await fetchJwks(jwksUri);
  let key = keys.find(candidate => isKeyForAlgorithm(candidate, header));

  if (!key) {
    keys = await fetchJwks(jwksUri, true);
    key = keys.find(candidate => isKeyForAlgorithm(candidate, header));
  }
  if (!key) throw new OidcTokenError('No matching OIDC signing key was found.');

  let validSignature = false;
  try {
    validSignature = verifySignatureWithJwk(header, key, signingInput, signature);
  } catch {
    validSignature = false;
  }
  if (!validSignature) throw new OidcTokenError('Token signature is invalid.');

  return validateClaims(claims, issuer, audience);
}
