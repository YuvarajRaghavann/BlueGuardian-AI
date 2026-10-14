import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('recovery API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the owner bearer token to the recovery backend without storing it', async () => {
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

  it('does not send owner recovery requests without an explicit token', () => {
    expect(() => api.recovery.listDevices('  ')).toThrow('An owner access token is required for protected API operations.');
  });

  it('requires owner authorization for the general device and telemetry APIs', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('[]', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await api.listDevices('owner-session-token');
    await api.listThreats('owner-session-token');
    await api.listActions('owner-session-token');
    await api.listEvents('owner-session-token');

    expect(fetchMock.mock.calls.map(([url, options]) => [url, options?.headers])).toEqual([
      ['/api/devices', { Authorization: 'Bearer owner-session-token' }],
      ['/api/threats', { Authorization: 'Bearer owner-session-token' }],
      ['/api/actions', { Authorization: 'Bearer owner-session-token' }],
      ['/api/events', { Authorization: 'Bearer owner-session-token' }],
    ]);
    expect(() => api.listThreats('')).toThrow('An owner access token is required for protected API operations.');
  });

  it('surfaces the backend error message on failed requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Production identity verification is not configured.' }),
      { status: 503, statusText: 'Service Unavailable' },
    )));

    await expect(api.health()).rejects.toThrow('Production identity verification is not configured.');
  });
});
