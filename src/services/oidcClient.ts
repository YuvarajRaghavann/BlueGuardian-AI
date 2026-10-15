interface OidcClientConfig {
  issuer: string;
  clientId: string;
  audience: string;
  redirectUri: string;
  scopes: string;
}

interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  code_challenge_methods_supported?: string[];
}

export interface OidcLoginResult {
  accessToken: string;
  expiresAt?: number;
}

interface PendingOidcLogin {
  state: string;
  verifier: string;
  redirectUri: string;
}

const PENDING_LOGIN_KEY = 'blueguardian.oidc.pending';

function clientConfig(): OidcClientConfig | null {
  const issuer = import.meta.env.VITE_OIDC_ISSUER?.trim();
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID?.trim();
  const audience = import.meta.env.VITE_OIDC_AUDIENCE?.trim();
  if (!issuer || !clientId || !audience) return null;

  try {
    const issuerUrl = new URL(issuer);
    if (import.meta.env.PROD && issuerUrl.protocol !== 'https:') return null;
  } catch {
    return null;
  }

  const redirectUri = import.meta.env.VITE_OIDC_REDIRECT_URI?.trim()
    || (typeof window !== 'undefined' ? `${window.location.origin}/recovery` : '');
  if (!redirectUri) return null;

  return {
    issuer,
    clientId,
    audience,
    redirectUri,
    scopes: import.meta.env.VITE_OIDC_SCOPES?.trim() || 'openid profile email',
  };
}

export function isOidcConfigured(): boolean {
  return clientConfig() !== null;
}

function randomUrlToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function requireSecureEndpoint(value: string, label: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`The identity provider returned an invalid ${label} URL.`);
  }

  const localHost = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1';
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && localHost && !import.meta.env.PROD)) {
    throw new Error(`The identity provider ${label} endpoint must use HTTPS.`);
  }
  return endpoint.toString();
}

async function discover(config: OidcClientConfig): Promise<OidcDiscoveryDocument> {
  const discoveryUrl = new URL(`${config.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`);
  requireSecureEndpoint(discoveryUrl.toString(), 'discovery');

  let response: Response;
  try {
    response = await fetch(discoveryUrl.toString(), { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    throw new Error('Could not contact the configured identity provider.');
  }
  if (!response.ok) throw new Error('The identity provider discovery request failed.');

  let document: OidcDiscoveryDocument;
  try {
    document = await response.json() as OidcDiscoveryDocument;
  } catch {
    throw new Error('The identity provider returned invalid discovery metadata.');
  }

  if (document.issuer !== config.issuer || typeof document.authorization_endpoint !== 'string' || typeof document.token_endpoint !== 'string') {
    throw new Error('The identity provider discovery metadata does not match the configured issuer.');
  }
  requireSecureEndpoint(document.authorization_endpoint, 'authorization');
  requireSecureEndpoint(document.token_endpoint, 'token');
  if (document.code_challenge_methods_supported && !document.code_challenge_methods_supported.includes('S256')) {
    throw new Error('The identity provider does not support PKCE with SHA-256.');
  }
  return document;
}

export async function startOidcLogin(): Promise<void> {
  const config = clientConfig();
  if (!config) {
    throw new Error('Production sign-in is not configured. Set VITE_OIDC_ISSUER, VITE_OIDC_CLIENT_ID and VITE_OIDC_AUDIENCE.');
  }
  const metadata = await discover(config);
  const state = randomUrlToken(32);
  const verifier = randomUrlToken(48);
  const challenge = await codeChallenge(verifier);

  const pending: PendingOidcLogin = { state, verifier, redirectUri: config.redirectUri };
  try {
    sessionStorage.setItem(PENDING_LOGIN_KEY, JSON.stringify(pending));
  } catch {
    throw new Error('Session storage is unavailable; sign-in cannot safely retain the PKCE verifier.');
  }

  const authorizeUrl = new URL(metadata.authorization_endpoint);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizeUrl.searchParams.set('scope', config.scopes);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('audience', config.audience);
  authorizeUrl.searchParams.set('prompt', 'select_account');

  window.location.assign(authorizeUrl.toString());
}

function clearCallbackUrl(): void {
  const cleanUrl = `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState(window.history.state, typeof document === 'undefined' ? '' : document.title, cleanUrl);
}

export async function completeOidcCallback(): Promise<OidcLoginResult | null> {
  const config = clientConfig();
  if (!config || typeof window === 'undefined') return null;

  const callbackUrl = new URL(window.location.href);
  const providerError = callbackUrl.searchParams.get('error');
  const code = callbackUrl.searchParams.get('code');
  const returnedState = callbackUrl.searchParams.get('state');
  if (!providerError && !code && !returnedState) return null;

  let pending: PendingOidcLogin | null = null;
  try {
    const saved = sessionStorage.getItem(PENDING_LOGIN_KEY);
    pending = saved ? JSON.parse(saved) as PendingOidcLogin : null;
  } catch {
    pending = null;
  }
  sessionStorage.removeItem(PENDING_LOGIN_KEY);

  if (providerError) {
    clearCallbackUrl();
    throw new Error(`Identity provider sign-in failed (${providerError}).`);
  }
  if (!code || !returnedState || !pending || returnedState !== pending.state || pending.redirectUri !== config.redirectUri) {
    clearCallbackUrl();
    throw new Error('The identity provider callback could not be validated. Start sign-in again.');
  }

  const metadata = await discover(config);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });

  let response: Response;
  try {
    response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      cache: 'no-store',
    });
  } catch {
    clearCallbackUrl();
    throw new Error('The authorization code could not be exchanged with the identity provider.');
  }

  if (!response.ok) {
    clearCallbackUrl();
    throw new Error('The identity provider rejected the authorization-code exchange.');
  }

  let tokenResponse: { access_token?: unknown; token_type?: unknown; expires_in?: unknown };
  try {
    tokenResponse = await response.json() as typeof tokenResponse;
  } catch {
    clearCallbackUrl();
    throw new Error('The identity provider returned an invalid token response.');
  }

  if (typeof tokenResponse.access_token !== 'string' || !tokenResponse.access_token ||
      typeof tokenResponse.token_type !== 'string' || tokenResponse.token_type.toLowerCase() !== 'bearer') {
    clearCallbackUrl();
    throw new Error('The identity provider did not return a bearer access token.');
  }

  clearCallbackUrl();
  return {
    accessToken: tokenResponse.access_token,
    expiresAt: typeof tokenResponse.expires_in === 'number' && tokenResponse.expires_in > 0
      ? Date.now() + tokenResponse.expires_in * 1000
      : undefined,
  };
}
