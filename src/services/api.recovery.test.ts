import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('web API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends an explicit owner bearer token without persisting it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await api.recovery.listDevices('owner-session-token');

    expect(fetchMock).toHaveBeenCalledWith('/api/recovery/devices', {
      headers: { Authorization: 'Bearer owner-session-token' },
      cache: 'no-store',
    });
  });

  it('returns a successful empty owner device list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    await expect(api.recovery.listDevices('owner-session-token')).resolves.toEqual([]);
  });

  it.each([
    [401, 'Unauthorized', 'Owner token required.'],
    [503, 'Service Unavailable', 'Recovery storage is unavailable.'],
  ])('surfaces HTTP %i errors instead of treating them as a device list', async (status, statusText, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: body }), { status, statusText })));
    await expect(api.recovery.listDevices('owner-session-token')).rejects.toThrow(
      `${status} ${statusText}: ${body}`,
    );
  });

  it('does not send protected recovery requests without an explicit token', () => {
    expect(() => api.recovery.listDevices('  ')).toThrow('An owner access token is required for protected API operations.');
  });

  it('surfaces the backend error message on failed requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Production identity verification is not configured.' }),
      { status: 503, statusText: 'Service Unavailable' },
    )));
    await expect(api.health()).rejects.toThrow('Production identity verification is not configured.');
  });

  it('encodes device identifiers in recovery URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.recovery.getRecoveryInfo('owner-session-token', 'device/with spaces');
    expect(fetchMock).toHaveBeenCalledWith('/api/recovery/devices/device%2Fwith%20spaces', {
      headers: { Authorization: 'Bearer owner-session-token' },
      cache: 'no-store',
    });
  });
});
