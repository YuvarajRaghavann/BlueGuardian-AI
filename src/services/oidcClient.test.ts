import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOidcCallback, isOidcConfigured, startOidcLogin } from './oidcClient';

const localStorageValues = new Map<string, string>();
const mockSessionStorage = {
  getItem: (key: string) => localStorageValues.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageValues.set(key, value); },
  removeItem: (key: string) => { localStorageValues.delete(key); },
  clear: () => localStorageValues.clear(),
};
const mockLocation = {
  origin: 'https://app.example.test',
  href: 'https://app.example.test/recovery',
  pathname: '/recovery',
  hash: '',
  assign: vi.fn(),
};
const mockHistory = {
  state: { key: 'router-state' },
  replaceState: vi.fn((_state: unknown, _title: string, url?: string | URL | null) => {
    if (typeof url === 'string') mockLocation.href = new URL(url, mockLocation.origin).toString();
  }),
};
const metadata = {
  issuer: 'https://identity.example.test',
  authorization_endpoint: 'https://identity.example.test/authorize',
  token_endpoint: 'https://identity.example.test/token',
  code_challenge_methods_supported: ['S256'],
};

function setOidcEnvironment() {
  vi.stubEnv('VITE_OIDC_ISSUER', metadata.issuer);
  vi.stubEnv('VITE_OIDC_CLIENT_ID', 'blueguardian-spa');
  vi.stubEnv('VITE_OIDC_AUDIENCE', 'https://blueguardian-api.example/');
  vi.stubEnv('VITE_OIDC_REDIRECT_URI', 'https://app.example.test/recovery');
  vi.stubEnv('VITE_OIDC_SCOPES', 'openid profile blueguardian:recovery');
}

beforeEach(() => {
  localStorageValues.clear();
  mockLocation.href = 'https://app.example.test/recovery';
  mockLocation.assign.mockClear();
  mockHistory.replaceState.mockClear();
  vi.stubGlobal('window', { location: mockLocation, history: mockHistory });
  vi.stubGlobal('sessionStorage', mockSessionStorage);
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | URL, init?: RequestInit) => {
    if (String(input).endsWith('/token')) {
      return new Response(JSON.stringify({ access_token: 'memory-only-access-token', token_type: 'Bearer', expires_in: 300 }), { status: 200 });
    }
    return new Response(JSON.stringify(metadata), { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('OIDC browser sign-in', () => {
  it('reports unconfigured settings without pretending recovery login is ready', () => {
    vi.stubEnv('VITE_OIDC_ISSUER', '');
    vi.stubEnv('VITE_OIDC_CLIENT_ID', '');
    vi.stubEnv('VITE_OIDC_AUDIENCE', '');
    expect(isOidcConfigured()).toBe(false);
  });

  it('starts authorization-code login using PKCE S256 and a random state', async () => {
    setOidcEnvironment();
    expect(isOidcConfigured()).toBe(true);

    await startOidcLogin();

    expect(mockLocation.assign).toHaveBeenCalledTimes(1);
    const authorizeUrl = new URL(mockLocation.assign.mock.calls[0][0] as string);
    expect(authorizeUrl.origin).toBe('https://identity.example.test');
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('code_challenge')).toHaveLength(43);
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy();
    expect(authorizeUrl.searchParams.get('audience')).toBe('https://blueguardian-api.example/');
    expect(localStorageValues.size).toBe(1);
    expect(localStorageValues.values().next().value).toContain('verifier');
  });

  it('exchanges a validated callback code and keeps the access token out of storage', async () => {
    setOidcEnvironment();
    await startOidcLogin();
    const authorizeUrl = new URL(mockLocation.assign.mock.calls[0][0] as string);
    mockLocation.href = `https://app.example.test/recovery?code=sample-code&state=${encodeURIComponent(authorizeUrl.searchParams.get('state') ?? '')}`;

    const result = await completeOidcCallback();

    expect(result).toMatchObject({ accessToken: 'memory-only-access-token' });
    expect(result?.expiresAt).toBeGreaterThan(Date.now());
    expect(localStorageValues.size).toBe(0);
    expect(mockHistory.replaceState).toHaveBeenCalled();
    const fetchMock = vi.mocked(fetch);
    const tokenRequest = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/token'));
    expect(tokenRequest).toBeTruthy();
    expect(new URLSearchParams(String(tokenRequest?.[1]?.body)).get('code_verifier')).toBeTruthy();
    expect(mockLocation.href).toBe('https://app.example.test/recovery');
  });

  it('rejects a callback whose state does not match the pending login', async () => {
    setOidcEnvironment();
    await startOidcLogin();
    mockLocation.href = 'https://app.example.test/recovery?code=sample-code&state=wrong-state';
    await expect(completeOidcCallback()).rejects.toThrow(/callback could not be validated/i);
  });
});
