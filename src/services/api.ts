const BASE = (import.meta.env.VITE_API_BASE?.trim() || '/api').replace(/\/+$/, '') || '/api';

function recoveryHeaders(token: string, jsonBody = false): Record<string, string> {
  if (!token.trim()) {
    throw new Error('An owner access token is required for protected API operations.');
  }

  return {
    ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${token}`,
  };
}

function recoveryFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...options, cache: 'no-store' });
}

export interface RecoveryDeviceRecord {
  deviceId: string;
  deviceIdentifier: string;
  name: string;
  type?: string;
  recoveryState: 'lost' | 'searching' | 'found' | 'recovered';
  discoverySource: 'REAL' | 'SIMULATED';
  registeredAt?: string;
}

export interface RecoveryInfoRecord {
  deviceId: string;
  deviceName: string;
  recoveryState: RecoveryDeviceRecord['recoveryState'];
  lastSeen: string | null;
  lastKnownLocation: { lat: number; lng: number; address?: string } | null;
  lastObservationAt: string | null;
  confidence: number | null;
  encounterCount: number;
  simulated: boolean;
  registeredAt: string | null;
}

export interface RecoveryEncounterRecord {
  _id: string;
  source: 'REAL' | 'SIMULATED';
  confidence: number | null;
  observedAt: string;
  location?: { lat: number; lng: number; address?: string };
  description?: string;
  simulated: boolean;
  isTestFixture: boolean;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text();
    let detail = txt;
    try {
      const body = JSON.parse(txt) as { error?: unknown };
      if (typeof body.error === 'string') detail = body.error;
    } catch {
      // Preserve non-JSON error bodies as received.
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}

export const api = {
  health: () => fetch(`${BASE}/health`).then(json<{ status: string; database: string }>),
  recovery: {
    listDevices: (token: string) => recoveryFetch(`${BASE}/recovery/devices`, {
      headers: recoveryHeaders(token),
    }).then(json<RecoveryDeviceRecord[]>),
    registerDevice: (token: string, payload: Record<string, unknown>) => recoveryFetch(`${BASE}/recovery/devices`, {
      method: 'POST',
      headers: recoveryHeaders(token, true),
      body: JSON.stringify(payload),
    }).then(json<RecoveryDeviceRecord>),
    updateState: (token: string, deviceId: string, status: RecoveryDeviceRecord['recoveryState']) => recoveryFetch(`${BASE}/recovery/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      headers: recoveryHeaders(token, true),
      body: JSON.stringify({ status }),
    }).then(json<RecoveryDeviceRecord>),
    getRecoveryInfo: (token: string, deviceId: string) => recoveryFetch(`${BASE}/recovery/devices/${encodeURIComponent(deviceId)}`, {
      headers: recoveryHeaders(token),
    }).then(json<RecoveryInfoRecord>),
    listEncounters: (token: string, deviceId: string) => recoveryFetch(`${BASE}/recovery/devices/${encodeURIComponent(deviceId)}/encounters`, {
      headers: recoveryHeaders(token),
    }).then(json<RecoveryEncounterRecord[]>),
    submitEncounter: (token: string, deviceId: string, payload: Record<string, unknown>) => recoveryFetch(`${BASE}/recovery/devices/${encodeURIComponent(deviceId)}/encounters`, {
      method: 'POST',
      headers: recoveryHeaders(token, true),
      body: JSON.stringify(payload),
    }).then(json<RecoveryEncounterRecord>),
  },
};
