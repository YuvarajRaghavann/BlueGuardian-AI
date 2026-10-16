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

  it('keeps benign assessments out of the threat list and uses only the latest assessment per device', async () => {
    const records = [
      {
        _id: 'old-tile-assessment',
        deviceId: 'tile-01',
        deviceName: 'Tile',
        timestamp: '2026-10-16T12:00:00.000Z',
        finalThreatScore: 82,
        severity: 'high',
        primaryCategory: 'HIGH_RISK_DEVICE',
        reasons: [{ code: 'BLOCKED_DEVICE', message: 'Legacy blocked flag.' }],
        status: 'active',
      },
      {
        _id: 'new-tile-assessment',
        deviceId: 'tile-01',
        deviceName: 'Tile',
        timestamp: '2026-10-16T12:05:00.000Z',
        finalThreatScore: 0,
        severity: 'low',
        primaryCategory: 'BENIGN',
        reasons: [{ code: 'UNKNOWN_DEVICE', message: 'Not yet owner-approved.' }],
        mlClassification: 'BENIGN',
        mlConfidence: 0.62,
        modelName: 'BlueGuardian Evidence Heuristic',
        modelVersion: '0.2.0-heuristic',
        status: 'active',
      },
      {
        _id: 'benign-unknown-assessment',
        deviceId: 'unknown-02',
        deviceName: 'Unknown Bluetooth Device',
        timestamp: '2026-10-16T12:04:00.000Z',
        finalThreatScore: 10,
        severity: 'low',
        primaryCategory: 'BENIGN',
        reasons: [{ code: 'LOW_TRUST', message: 'Limited trust evidence.' }],
        mlClassification: 'BENIGN',
        mlConfidence: 0.62,
        status: 'active',
      },
      {
        _id: 'suspicious-assessment',
        deviceId: 'suspicious-03',
        deviceName: 'spoof-test',
        timestamp: '2026-10-16T12:03:00.000Z',
        finalThreatScore: 38,
        severity: 'medium',
        primaryCategory: 'SUSPICIOUS',
        reasons: [
          { code: 'SUSPICIOUS_NAME', message: 'Suspicious advertised name.' },
          { code: 'UNSTABLE_CONNECTION', message: 'Connection observations are unstable.' },
        ],
        mlClassification: 'SUSPICIOUS',
        mlConfidence: 0.58,
        modelName: 'BlueGuardian Evidence Heuristic',
        modelVersion: '0.2.0-heuristic',
        status: 'active',
      },
      {
        _id: 'blocked-assessment',
        deviceId: 'blocked-04',
        deviceName: 'Blocked device',
        timestamp: '2026-10-16T12:02:00.000Z',
        finalThreatScore: 75,
        severity: 'critical',
        primaryCategory: 'HIGH_RISK_DEVICE',
        reasons: [{ code: 'BLOCKED_DEVICE', message: 'Explicitly blocked by the owner.' }],
        mlClassification: 'HIGH_RISK_DEVICE',
        mlConfidence: 0.92,
        status: 'active',
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(records), { status: 200 })));

    const snapshot = await api.getThreatSnapshot('owner-session-token');

    expect(snapshot.assessedDeviceIds).toEqual(['tile-01', 'unknown-02', 'suspicious-03', 'blocked-04']);
    expect(snapshot.threats.map(threat => threat.deviceId).sort()).toEqual(['blocked-04', 'suspicious-03']);
    expect(snapshot.threats.find(threat => threat.deviceId === 'blocked-04')?.score).toBe(75);
    expect(snapshot.threats.find(threat => threat.deviceId === 'suspicious-03')?.score).toBe(38);
  });

  it('does not treat an unknown or low-score device assessment as an actionable alert', async () => {
    const records = [{
      _id: 'unknown-clean',
      deviceId: 'unknown-clean',
      deviceName: 'Unknown Bluetooth Device',
      timestamp: '2026-10-16T12:05:00.000Z',
      finalThreatScore: 0,
      severity: 'low',
      primaryCategory: 'BENIGN',
      reasons: [{ code: 'UNKNOWN_DEVICE', message: 'Unknown devices require approval, not an attack label.' }],
      mlClassification: 'BENIGN',
      mlConfidence: 0.62,
      status: 'active',
    }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(records), { status: 200 })));

    await expect(api.listThreats('owner-session-token')).resolves.toEqual([]);
  });

  it('surfaces the backend error message on failed requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Production identity verification is not configured.' }),
      { status: 503, statusText: 'Service Unavailable' },
    )));

    await expect(api.health()).rejects.toThrow('Production identity verification is not configured.');
  });
});
