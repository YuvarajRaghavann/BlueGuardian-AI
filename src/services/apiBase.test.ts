import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import {
  API_BASE_CHANGED_EVENT,
  getApiBaseConfig,
  normalizeApiBaseUrl,
  setApiBaseUrl,
} from './apiBase';

function stubBrowserStorage() {
  const values = new Map<string, string>();
  const dispatchEvent = vi.fn();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  vi.stubGlobal('window', { localStorage, dispatchEvent });
  return { values, dispatchEvent, localStorage };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runtime API base configuration', () => {
  it('adds /api when the saved URL contains only an HTTPS origin', () => {
    expect(normalizeApiBaseUrl('https://api.example.com')).toBe('https://api.example.com/api');
  });

  it('does not duplicate an existing /api suffix', () => {
    expect(normalizeApiBaseUrl('https://api.example.com/api/')).toBe('https://api.example.com/api');
  });

  it('rejects remote HTTP and credential-bearing URLs', () => {
    expect(() => normalizeApiBaseUrl('http://api.example.com')).toThrow('Use HTTPS');
    expect(() => normalizeApiBaseUrl('https://user:pass@api.example.com')).toThrow('Do not put usernames');
  });

  it('stores the normalized non-secret URL and notifies application contexts', () => {
    const { values, dispatchEvent } = stubBrowserStorage();

    const config = setApiBaseUrl('https://api.example.com');

    expect(config).toMatchObject({
      baseUrl: 'https://api.example.com/api',
      configured: true,
      source: 'device',
    });
    expect(values.get('blueguardian.apiBaseUrl')).toBe('https://api.example.com/api');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0].type).toBe(API_BASE_CHANGED_EVENT);
  });

  it('routes API health requests through the saved endpoint and disables caching', async () => {
    stubBrowserStorage();
    setApiBaseUrl('https://api.example.com');
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 'ok', database: 'connected' }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.health()).resolves.toEqual({ status: 'ok', database: 'connected' });

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/health', {
      cache: 'no-store',
    });
  });

  it('clears a custom URL and returns the browser same-origin API fallback', () => {
    const { values } = stubBrowserStorage();
    values.set('blueguardian.apiBaseUrl', 'https://api.example.com/api');

    const config = setApiBaseUrl(null);

    expect(values.has('blueguardian.apiBaseUrl')).toBe(false);
    expect(config).toMatchObject({
      baseUrl: '/api',
      configured: true,
      source: 'same-origin',
    });
  });
});
