const BASE = (import.meta.env.VITE_API_BASE?.trim() || '/api').replace(/\/+$/, '') || '/api';

// Access tokens are deliberately held in JavaScript memory only. They are never written
// to localStorage, sessionStorage, URLs, or logs.
let ownerSessionToken = '';

export function setOwnerSessionToken(token: string): void {
  ownerSessionToken = token.trim();
}

export function hasOwnerSessionToken(): boolean {
  return ownerSessionToken.length > 0;
}

function ownerHeaders(jsonBody = false, token = ownerSessionToken): Record<string, string> {
  if (!token.trim()) {
    throw new Error('An owner access token is required for protected API operations. Sign in on Device Recovery first.');
  }
  return {
    ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
    Authorization: \`Bearer \${token.trim()}\`,
  };
}

function recoveryHeaders(token: string, jsonBody = false): Record<string, string> {
  if (!token.trim()) {
    throw new Error('An owner access token is required for protected API operations.');
  }

  return {
    ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
    Authorization: \`Bearer \${token}\`,
  };
}

function recoveryFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...options, cache: 'no-store' });
}

function ownerFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...ownerHeaders(Boolean(options.body)),
    ...(options.headers as Record<string, string> | undefined),
  };
  return recoveryFetch(url, { ...options, headers });
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
    throw new Error(\`\${res.status} \${res.statusText}\${detail ? \`: \${detail}\` : ''}\`);
  }
  return res.json();
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

export interface BackendDeviceRecord {
  _id?: string;
  deviceId: string;
  deviceIdentifier?: string;
  name?: string;
  type?: string;
  discoverySource?: 'REAL' | 'SIMULATED';
  address?: string;
  rssi?: number;
  connectionStatus?: string;
  gattConnected?: boolean;
  services?: Array<{ uuid: string; name?: string }>;
  trustScore?: number;
  riskLevel?: string;
  trusted?: boolean;
  blocked?: boolean;
  isKnown?: boolean;
  manufacturer?: string;
  connectionHealth?: string;
  firstSeen?: string;
  lastSeen?: string;
}

export interface BackendThreatRecord {
  _id: string;
  deviceId: string;
  trustScore?: number;
  trustRiskLevel?: string;
  ruleBasedThreatScore?: number;
  mlRiskScore?: number;
  finalThreatScore?: number;
  severity?: string;
  primaryCategory?: string;
  reasons?: Array<{ code: string; message: string }>;
  mlClassification?: string;
  mlConfidence?: number;
  modelName?: string;
  modelVersion?: string;
  modelValidationStatus?: string;
  status?: 'active' | 'investigating' | 'resolved' | 'dismissed';
  timestamp?: string;
}

export interface BackendActionRecord {
  _id?: string;
  deviceId: string;
  deviceName?: string;
  action: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  source?: 'USER' | 'SYSTEM';
  timestamp?: string;
  simulated?: boolean;
  reason?: string;
  threatId?: string;
}

export interface BackendEventRecord {
  _id?: string;
  deviceId?: string;
  eventType: string;
  description?: string;
  source?: 'USER' | 'SYSTEM';
  simulated?: boolean;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export const api = {
  health: () => fetch(\`\${BASE}/health\`, { cache: 'no-store' }).then(json<{ status: string; database: string }>),

  devices: {
    list: () => ownerFetch(\`\${BASE}/devices\`).then(json<BackendDeviceRecord[]>),
    get: (deviceId: string) => ownerFetch(`\${BASE}/devices/\${encodeURIComponent(deviceId)}`).then(json<BackendDeviceRecord>),
    upsert: (payload: Record<string, unknown>) => ownerFetch(\`\${BASE}/devices\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(json<BackendDeviceRecord>),
    update: (deviceId: string, payload: Record<string, unknown>) => ownerFetch(\`\${BASE}/devices/\${encodeURIComponent(deviceId)}\`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(json<BackendDeviceRecord>),
    assess: (deviceId: string) => ownerFetch(\`\${BASE}/devices/\${encodeURIComponent(deviceId)}/assess\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(json<BackendThreatRecord & { overallConfidence?: number }>).then(result => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('blueguardian:backend-threats-updated'));
      }
      return result;
    }),
  },

  threats: {
    list: () => ownerFetch(\`\${BASE}/threats\`).then(json<BackendThreatRecord[]>),
  },

  actions: {
    list: () => ownerFetch(\`\${BASE}/actions\`).then(json<BackendActionRecord[]>),
    create: (payload: Record<string, unknown>) => ownerFetch(\`\${BASE}/actions\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(json<{ action?: BackendActionRecord; audit?: BackendEventRecord }>).then(result => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('blueguardian:backend-events-updated'));
      }
      return result;
    }),
  },

  events: {
    list: () => ownerFetch(\`\${BASE}/events\`).then(json<BackendEventRecord[]>),
    create: (payload: Record<string, unknown>) => ownerFetch(\`\${BASE}/events\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(json<BackendEventRecord>).then(result => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('blueguardian:backend-events-updated'));
      }
      return result;
    }),
  },

  recovery: {
    listDevices: (token: string) => recoveryFetch(\`\${BASE}/recovery/devices\`, {
      headers: recoveryHeaders(token),
    }).then(json<RecoveryDeviceRecord[]>),
    registerDevice: (token: string, payload: Record<string, unknown>) => recoveryFetch(\`\${BASE}/recovery/devices\`, {
      method: 'POST',
      headers: recoveryHeaders(token, true),
      body: JSON.stringify(payload),
    }).then(json<RecoveryDeviceRecord>),
    updateState: (token: string, deviceId: string, status: RecoveryDeviceRecord['recoveryState']) => recoveryFetch(\`\${BASE}/recovery/devices/\${encodeURIComponent(deviceId)}\`, {
      method: 'PATCH',
      headers: recoveryHeaders(token, true),
      body: JSON.stringify({ status }),
    }).then(json<RecoveryDeviceRecord>),
    getRecoveryInfo: (token: string, deviceId: string) => recoveryFetch(\`\${BASE}/recovery/devices/\${encodeURIComponent(deviceId)}\`, {
      headers: recoveryHeaders(token),
    }).then(json<RecoveryInfoRecord>),
    listEncounters: (token: string, deviceId: string) => recoveryFetch(\`\${BASE}/recovery/devices/\${encodeURIComponent(deviceId)}/encounters\`, {
      headers: recoveryHeaders(token),
    }).then(json<RecoveryEncounterRecord[]>),
    submitEncounter: (token: string, deviceId: string, payload: Record<string, unknown>) => recoveryFetch(\`\${BASE}/recovery/devices/\${encodeURIComponent(deviceId)}/encounters\`, {
      method: 'POST',
      headers: recoveryHeaders(token, true),
      body: JSON.stringify(payload),
    }).then(json<RecoveryEncounterRecord>),
  },
};
