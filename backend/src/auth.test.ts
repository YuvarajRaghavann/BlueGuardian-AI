import { generateKeyPairSync, sign as signJwt } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFirebaseSigningKeyCacheForTests,
  FirebaseTokenVerificationError,
  verifyFirebaseIdToken,
} from './auth';

const PROJECT_ID = 'blueguardian-ai-auth';
const KEY_ID = 'test-firebase-key';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const exportedJwk = publicKey.export({ format: 'jwk' });
const testJwk = {
  ...exportedJwk,
  kid: KEY_ID,
  alg: 'RS256',
  use: 'sig',
  kty: 'RSA',
};

function createToken(overrides: Record<string, unknown> = {}, signingKey = privateKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    sub: 'firebase-test-user',
    iat: now,
    exp: now + 3600,
    auth_time: now,
    ...overrides,
  })).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = signJwt('RSA-SHA256', Buffer.from(signingInput), signingKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function stubJwksFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'public, max-age=300' },
    json: async () => ({ keys: [testJwk] }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Firebase ID token verification', () => {
  beforeEach(() => clearFirebaseSigningKeyCacheForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearFirebaseSigningKeyCacheForTests();
  });

  it('accepts a correctly signed token scoped to the configured Firebase project', async () => {
    const fetchMock = stubJwksFetch();
    const claims = await verifyFirebaseIdToken(createToken(), PROJECT_ID);
    expect(claims.sub).toBe('firebase-test-user');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects a token issued for another project', async () => {
    stubJwksFetch();
    await expect(verifyFirebaseIdToken(createToken({ aud: 'another-project' }), PROJECT_ID))
      .rejects.toThrow(FirebaseTokenVerificationError);
  });

  it('rejects expired tokens', async () => {
    stubJwksFetch();
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyFirebaseIdToken(createToken({ iat: now - 4000, auth_time: now - 4000, exp: now - 10 }), PROJECT_ID))
      .rejects.toThrow(/claims are invalid or expired/);
  });

  it('fails closed when Google signing keys cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(verifyFirebaseIdToken(createToken(), PROJECT_ID)).rejects.toMatchObject({
      kind: 'verifier-unavailable',
    });
  });

  it('rejects malformed token input before attempting network access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyFirebaseIdToken('not-a-jwt', PROJECT_ID)).rejects.toThrow(/malformed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
