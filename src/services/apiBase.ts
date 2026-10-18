import { Capacitor } from '@capacitor/core';

export const API_BASE_CHANGED_EVENT = 'blueguardian:api-base-changed';
const API_BASE_STORAGE_KEY = 'blueguardian.apiBaseUrl';

export type ApiBaseSource = 'device' | 'build' | 'same-origin' | 'missing';

export interface ApiBaseConfig {
  /** Effective base, including /api. Empty when a native build has no endpoint. */
  baseUrl: string;
  configured: boolean;
  source: ApiBaseSource;
  nativePlatform: boolean;
  error?: string;
}

function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Hosts a packaged release app may send the owner's sign-in token to.
 * Built from VITE_API_BASE plus VITE_API_ALLOWED_HOSTS (comma separated).
 * A backend URL typed into Settings that is not on this list is refused in
 * release builds, so a tricked user cannot redirect tokens to another server.
 */
export function apiHostAllowlist(
  buildBase: string | undefined = import.meta.env.VITE_API_BASE,
  extraHosts: string | undefined = import.meta.env.VITE_API_ALLOWED_HOSTS,
): string[] {
  const hosts = new Set<string>();
  if (buildBase && !buildBase.trim().startsWith('/')) {
    try {
      hosts.add(new URL(buildBase.trim()).hostname.toLowerCase());
    } catch {
      // invalid build base is reported elsewhere
    }
  }
  for (const host of (extraHosts ?? '').split(',')) {
    const clean = host.trim().toLowerCase();
    if (clean) hosts.add(clean);
  }
  return [...hosts];
}

export function isAllowedApiHost(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((entry) => entry === host || (entry.startsWith('*.') && host.endsWith(entry.slice(1))));
}

/** Release native builds enforce the allowlist; browser and development builds do not. */
function enforceAllowlist(): boolean {
  return isNativePlatform() && import.meta.env.PROD === true && import.meta.env.VITE_ALLOW_ANY_BACKEND !== 'true';
}

function readStoredBase(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(API_BASE_STORAGE_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Validate a user-entered API origin/path and append /api if it is missing.
 * Credentials, query strings and fragments are never accepted as part of a base URL.
 * HTTPS is required for remote servers; plain HTTP is accepted only for browser-local
 * development, not for a packaged native app.
 */
export function normalizeApiBaseUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('Enter your backend HTTPS URL.');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Enter a complete URL such as https://api.example.com/api.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Do not put usernames, passwords, or tokens in the backend URL.');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('The backend URL must not contain a query string or fragment.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  const browserLocalHttp = !isNativePlatform() && parsed.protocol === 'http:' && isLoopback;
  if (parsed.protocol !== 'https:' && !browserLocalHttp) {
    throw new Error('Use HTTPS for a remote backend. HTTP is allowed only for localhost browser development, not the Android APK.');
  }

  if (enforceAllowlist()) {
    const allowlist = apiHostAllowlist();
    if (!isAllowedApiHost(hostname, allowlist)) {
      throw new Error(`This release build only connects to approved backends (${allowlist.join(', ') || 'none configured'}). Ask your administrator to add ${hostname}.`);
    }
  }

  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname) pathname = '/api';
  else if (pathname !== '/api' && !pathname.endsWith('/api')) pathname += '/api';

  return parsed.origin + pathname;
}

export function getApiBaseConfig(): ApiBaseConfig {
  const nativePlatform = isNativePlatform();
  const stored = readStoredBase();
  if (stored) {
    try {
      return {
        baseUrl: normalizeApiBaseUrl(stored),
        configured: true,
        source: 'device',
        nativePlatform,
      };
    } catch (error) {
      return {
        baseUrl: stored,
        configured: false,
        source: 'missing',
        nativePlatform,
        error: error instanceof Error ? error.message : 'The saved backend URL is invalid.',
      };
    }
  }

  const buildBase = import.meta.env.VITE_API_BASE?.trim();
  if (buildBase) {
    if (buildBase.startsWith('/')) {
      if (nativePlatform) {
        return {
          baseUrl: '',
          configured: false,
          source: 'missing',
          nativePlatform,
          error: 'This Android build has a relative VITE_API_BASE. Save an absolute HTTPS backend URL in Settings.',
        };
      }
      return {
        baseUrl: buildBase.replace(/\/+$/, '') || '/api',
        configured: true,
        source: 'build',
        nativePlatform,
      };
    }

    try {
      return {
        baseUrl: normalizeApiBaseUrl(buildBase),
        configured: true,
        source: 'build',
        nativePlatform,
      };
    } catch (error) {
      return {
        baseUrl: buildBase,
        configured: false,
        source: 'missing',
        nativePlatform,
        error: error instanceof Error ? error.message : 'VITE_API_BASE is invalid.',
      };
    }
  }

  if (nativePlatform) {
    return {
      baseUrl: '',
      configured: false,
      source: 'missing',
      nativePlatform,
      error: 'No backend URL is configured for this Android app. Open Settings → Backend and database and save your deployed HTTPS API URL.',
    };
  }

  return {
    baseUrl: '/api',
    configured: true,
    source: 'same-origin',
    nativePlatform,
  };
}

export function resolveApiBaseUrl(): string {
  const config = getApiBaseConfig();
  if (!config.configured || !config.baseUrl) {
    throw new Error(config.error || 'Backend URL is not configured. Open Settings → Backend and database.');
  }
  return config.baseUrl;
}

/** Saves only the non-secret server URL on this device; owner tokens are separate. */
export function setApiBaseUrl(input: string | null): ApiBaseConfig {
  if (typeof window === 'undefined') {
    throw new Error('Backend URL can only be changed from the running BlueGuardian app.');
  }

  try {
    if (input && input.trim()) {
      const normalized = normalizeApiBaseUrl(input);
      window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
    } else {
      window.localStorage.removeItem(API_BASE_STORAGE_KEY);
    }
  } catch (error) {
    if (error instanceof Error && /Enter |complete URL|Do not put|query string|HTTPS|backend URL|approved backends/i.test(error.message)) throw error;
    throw new Error('BlueGuardian could not save the backend URL in this device’s local settings.');
  }

  window.dispatchEvent(new Event(API_BASE_CHANGED_EVENT));
  return getApiBaseConfig();
}
