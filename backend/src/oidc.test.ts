import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuth } from './auth';
import { verifyOidcAccessToken } from './oidc';

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const exportedJwk = keyPair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
let jwksNumber = 0;

const envKeys = [
  'NODE_ENV',
  'BLUEGUARDIAN_OIDC_ISSUER',
  'BLUEGUARDIAN_OIDC_AUDIENCE',
  'BLUEGUARDIAN_OIDC_JWKS_URI',
] as const;
const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]])) as Record<typeof envKeys[number], string | undefined>;

function makeToken(claimOverrides: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: 'blueguardian-test-key',
    ...headerOverrides,
  };
  const claims = {
    iss: process.env.BLUEGUARDIAN_OIDC_ISSUER,
    aud: process.env.BLUEGUARDIAN_OIDC_AUDIENCE,
    sub: 'verified-user-123',
    iat: now - 5,
    exp: now + 300,
    scope: 'openid profile',
    ...claimOverrides,
  };
  const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url');
  const claimsPart = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${headerPart}.${claimsPart}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), keyPair.privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.BLUEGUARDIAN_OIDC_ISSUER = 'https://identity.example.test/';
  process.env.BLUEGUARDIAN_OIDC_AUDIENCE = 'https://blueguardian-api.example/';
  process.env.BLUEGUARDIAN_OIDC_JWKS_URI = `https://identity.example.test/jwks-${++jwksNumber}.json`;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    keys: [{ ...exportedJwk, kid: 'blueguardian-test-key', alg: 'RS256', use: 'sig' }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

afterEach(() => {
  for (const key of envKeys) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe('OIDC access-token verification', () => {
  it('validates the signature, issuer, audience, expiry and subject', async () => {
    await expect(verifyOidcAccessToken(makeToken())).resolves.toMatchObject({
      subject: 'verified-user-123',
      scopes: ['openid', 'profile'],
    });
  });

  it('rejects a token with a modified signature', async () => {
    const token = makeToken();
    const [header, claims, signature] = token.split('.');
    const bytes = Buffer.from(signature, 'base64url');
    bytes[0] ^= 0x01;
    await expect(verifyOidcAccessToken(`${header}.${claims}.${bytes.toString('base64url')}`))
      .rejects.toMatchObject({ status: 401 });
  });

  it.each([
    [{ iss: 'https://attacker.example/' }, 'issuer'],
    [{ aud: 'another-api' }, 'audience'],
    [{ exp: Math.floor(Date.now() / 1000) - 60 }, 'expired'],
    [{ sub: '' }, 'subject'],
  ])('rejects invalid token claims: %s', async (claims) => {
    await expect(verifyOidcAccessToken(makeToken(claims))).rejects.toMatchObject({ status: 401 });
  });

  it('rejects algorithms that are not explicitly supported', async () => {
    await expect(verifyOidcAccessToken(makeToken({}, { alg: 'none' }))).rejects.toMatchObject({ status: 401 });
  });

  it('fails closed when the OIDC verifier is not configured', async () => {
    delete process.env.BLUEGUARDIAN_OIDC_ISSUER;
    await expect(verifyOidcAccessToken(makeToken())).rejects.toMatchObject({ status: 503 });
  });

  it('maps a verified access-token subject to the protected API owner identity', async () => {
    process.env.NODE_ENV = 'production';
    const request = { headers: { authorization: `Bearer ${makeToken()}` }, ip: '127.0.0.1' } as any;
    let statusCode = 0;
    let body: unknown;
    let nextCalled = false;

    await new Promise<void>((resolve, reject) => {
      const response = {
        status(code: number) {
          statusCode = code;
          return { json(value: unknown) { body = value; resolve(); } };
        },
      };
      requireAuth('owner')(request, response as any, (error?: unknown) => {
        if (error) reject(error);
        nextCalled = true;
        resolve();
      });
    });

    expect(statusCode).toBe(0);
    expect(body).toBeUndefined();
    expect(nextCalled).toBe(true);
    expect(request.auth).toMatchObject({ role: 'owner', ownerId: 'verified-user-123' });
  });
});
