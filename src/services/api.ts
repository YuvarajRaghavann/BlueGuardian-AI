import type { BluetoothDevice, ConnectionStatus, DeviceType, RiskLevel, SecurityAction, SecurityActionType, Threat, ThreatCategory, ThreatSeverity, ThreatStatus, ThreatReason, MLThreatClass } from '../types';
import { resolveBluetoothDisplayName } from './bluetoothService';
import { getApiBaseConfig } from './apiBase';
import { getFreshFirebaseIdToken, hasFirebaseSession } from './firebaseAuth';

const BASE = () => getApiBaseConfig().baseUrl;

async function withFreshFirebaseAuthorization(options: RequestInit): Promise<RequestInit> {
  // Preserve the original request options for unauthenticated health checks and
  // legacy development tests. Only normalize headers when a Firebase session exists.
  if (!hasFirebaseSession()) return options;

  const headers = new Headers(options.headers);
  if (headers.has('Authorization')) {
    const token = await getFreshFirebaseIdToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  return { ...options, headers };
}

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const config = getApiBaseConfig();
  if (!config.configured || !config.baseUrl) {
    throw new Error(config.error || 'Backend URL is not configured. Open Settings → Backend and database.');
  }
  const authenticatedOptions = await withFreshFirebaseAuthorization(options);
  return fetch(url, { ...authenticatedOptions, cache: 'no-store' });
}

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
  return apiFetch(url, { ...options, cache: 'no-store' });
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

function fromApiDevice(record: Record<string, any>): BluetoothDevice {
  const validTypes: DeviceType[] = ['smartphone', 'earbuds', 'headphones', 'smartwatch', 'laptop', 'iot', 'unknown'];
  const validRiskLevels: RiskLevel[] = ['trusted', 'low', 'medium', 'high'];
  const validConnectionStatuses: ConnectionStatus[] = ['connected', 'disconnected', 'connecting', 'unknown'];
  const toDate = (value?: string | Date) => {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  };

  return {
    id: record.deviceId ?? record.id,
    name: resolveBluetoothDisplayName(record.name, record.deviceName, record.manufacturer),
    type: validTypes.includes(record.type) ? record.type : 'unknown',
    address: record.address ?? undefined,
    rssi: typeof record.rssi === 'number' ? record.rssi : undefined,
    trusted: record.trusted ?? false,
    blocked: record.blocked ?? false,
    trustScore: record.trustScore ?? 0,
    // Missing/invalid metadata means review is needed, not evidence of high threat.
    // Connection policy independently requires approval for untrusted devices.
    riskLevel: validRiskLevels.includes(record.riskLevel) ? record.riskLevel : 'medium',
    connectionStatus: validConnectionStatuses.includes(record.connectionStatus)
      ? record.connectionStatus
      : record.gattConnected ? 'connected' : 'unknown',
    firstSeen: toDate(record.firstSeen),
    lastSeen: toDate(record.lastSeen),
    isKnown: record.isKnown ?? false,
    manufacturer: record.manufacturer ?? undefined,
    services: (record.services ?? []).map((service: Record<string, any>) => ({
      uuid: service.uuid,
      name: service.name ?? undefined,
      characteristics: service.characteristics ?? [],
    })),
    discoverySource: record.discoverySource === 'SIMULATED' ? 'SIMULATED' : 'REAL',
    gattConnected: record.gattConnected ?? undefined,
    connectionHealth: record.connectionHealth ?? undefined,
  };
}

function toApiDevice(device: BluetoothDevice) {
  return {
    deviceId: device.id,
    deviceIdentifier: device.id,
    name: device.name,
    type: device.type,
    address: device.address,
    rssi: device.rssi,
    discoverySource: device.discoverySource,
    gattConnected: device.gattConnected,
    services: device.services,
    manufacturer: device.manufacturer,
    trustScore: device.trustScore,
    riskLevel: device.riskLevel,
    isKnown: device.isKnown,
    trusted: device.trusted,
    blocked: device.blocked,
    connectionStatus: device.connectionStatus,
    connectionHealth: device.connectionHealth,
  };
}

function fromApiAction(record: Record<string, any>): SecurityAction {
  return {
    id: String(record._id ?? record.id),
    type: record.action as SecurityActionType,
    deviceId: record.deviceId,
    deviceName: record.deviceName ?? record.deviceId,
    reason: record.reason ?? '',
    source: record.source === 'SYSTEM' ? 'SYSTEM' : 'USER',
    timestamp: new Date(record.timestamp),
    simulated: record.simulated ?? false,
    previousState: record.previousState,
    newState: record.newState,
  };
}

function fromApiThreat(record: Record<string, any>, devices: BluetoothDevice[] = []): Threat {
  const deviceId = String(record.deviceId ?? 'unknown-device');
  const linkedDevice = devices.find(device => device.id === deviceId);
  const timestampValue = record.timestamp ?? record.detectedAt ?? Date.now();
  const timestamp = new Date(timestampValue);
  const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
  const severityValue = String(record.severity ?? 'low').toLowerCase();
  const severity: ThreatSeverity = ['low', 'medium', 'high', 'critical'].includes(severityValue)
    ? severityValue as ThreatSeverity
    : 'low';
  const statusValue = String(record.status ?? 'active').toUpperCase();
  const status: ThreatStatus = ['ACTIVE', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'].includes(statusValue)
    ? statusValue as ThreatStatus
    : 'ACTIVE';
  const rawCategory = String(record.primaryCategory ?? record.category ?? record.mlClassification ?? 'OTHER');
  const category = rawCategory as ThreatCategory;
  const reasons: ThreatReason[] = Array.isArray(record.reasons)
    ? record.reasons.map((reason: Record<string, unknown>) => ({
        code: String(reason.code ?? 'BACKEND_ASSESSMENT'),
        message: String(reason.message ?? 'Backend assessment reported a risk factor.'),
      }))
    : [];
  const mlLabel = String(record.mlClassification ?? record.primaryCategory ?? 'SUSPICIOUS') as MLThreatClass;
  const confidence = typeof record.mlConfidence === 'number'
    ? record.mlConfidence
    : typeof record.overallConfidence === 'number' ? record.overallConfidence : 0;
  const prediction = record.mlClassification || record.mlConfidence !== undefined ? {
    label: mlLabel,
    confidence,
    modelName: String(record.modelName ?? 'Legacy development assessment'),
    modelVersion: String(record.modelVersion ?? 'unknown'),
    predictedAt: safeTimestamp,
    featuresUsed: [] as string[],
    explanation: reasons.find(reason => reason.code === 'ML_CLASSIFICATION')?.message ?? 'Development classifier output from the backend assessment service.',
  } : undefined;

  return {
    id: String(record._id ?? record.id ?? `${deviceId}-${safeTimestamp.getTime()}`),
    deviceId,
    deviceName: linkedDevice?.name ?? String(record.deviceName ?? deviceId),
    category,
    severity,
    score: Number.isFinite(Number(record.finalThreatScore)) ? Number(record.finalThreatScore) : 0,
    title: `${rawCategory.replace(/_/g, ' ')} Detected`,
    description: reasons.map(reason => reason.message).join(' ') || 'Backend security assessment recorded for this device.',
    reasons,
    recommendedAction: 'Review this assessment and decide whether to investigate, resolve, or dismiss the threat.',
    status,
    detectedAt: safeTimestamp,
    updatedAt: safeTimestamp,
    discoverySource: linkedDevice?.discoverySource ?? 'REAL',
    mlPrediction: prediction,
    finalClassification: String(record.mlClassification ?? record.primaryCategory ?? rawCategory),
    confidence,
    modelName: record.modelName ?? prediction?.modelName,
    modelVersion: record.modelVersion ?? prediction?.modelVersion,
    resolved: status === 'RESOLVED',
  };
}

export interface ThreatSnapshot {
  /** Latest assessment IDs received from the owner-scoped backend, including benign devices. */
  assessedDeviceIds: string[];
  /** Only actionable current alerts, never benign assessments treated as threats. */
  threats: Threat[];
}

function isActionableAssessment(record: Record<string, any>): boolean {
  const scoreValue = Number(record.finalThreatScore ?? record.threatScore ?? record.score ?? 0);
  const score = Number.isFinite(scoreValue) ? scoreValue : 0;
  const reasons: Array<Record<string, unknown>> = Array.isArray(record.reasons)
    ? record.reasons.filter((reason: unknown): reason is Record<string, unknown> => Boolean(reason) && typeof reason === 'object')
    : [];
  const codes = new Set(reasons.map(reason => String(reason.code ?? '')));
  const explicitlyBlocked = codes.has('BLOCKED_DEVICE');
  const corroboratedSuspicion = score >= 35
    && codes.has('SUSPICIOUS_NAME')
    && codes.has('UNSTABLE_CONNECTION');

  return score >= 50 || explicitlyBlocked || corroboratedSuspicion;
}

/**
 * Backend assessment rows are not synonymous with threats: the backend stores
 * every model evaluation, including BENIGN/low-score results. Select the newest
 * assessment per device first, then surface it only when there is actionable
 * evidence. Otherwise an old high-risk row can outlive a newer clean assessment.
 */
async function fetchThreatSnapshot(
  token: string,
  devices: BluetoothDevice[] = [],
): Promise<ThreatSnapshot> {
  const response = await apiFetch(`${BASE()}/threats`, {
    headers: recoveryHeaders(token),
  });
  const records = await json<Record<string, any>[]>(response);
  const sorted = [...records].sort((left, right) => {
    const time = (record: Record<string, any>) => {
      const parsed = new Date(record.timestamp ?? record.detectedAt ?? 0).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return time(right) - time(left);
  });

  const latestByDevice = new Map<string, Record<string, any>>();
  for (const record of sorted) {
    const deviceId = String(record.deviceId ?? record.id ?? '').trim();
    if (deviceId && !latestByDevice.has(deviceId)) {
      latestByDevice.set(deviceId, record);
    }
  }

  const latestRecords = Array.from(latestByDevice.values());
  const threats = latestRecords
    .filter(isActionableAssessment)
    .map(record => fromApiThreat(record, devices))
    .sort((left, right) => right.detectedAt.getTime() - left.detectedAt.getTime());

  return {
    assessedDeviceIds: latestRecords.map(record => String(record.deviceId ?? record.id)),
    threats,
  };
}

export interface PostSecurityActionPayload {
  deviceId: string;
  deviceName?: string;
  action: SecurityActionType;
  source: 'USER' | 'SYSTEM';
  simulated: boolean;
  reason?: string;
  previousState?: Partial<BluetoothDevice>;
  newState?: Partial<BluetoothDevice>;
  threatId?: string;
}

export const api = {
  health: () => apiFetch(`${BASE()}/health`).then(json<{ status: string; database: string }>),
  listDevices: (token: string) => apiFetch(`${BASE()}/devices`, { headers: recoveryHeaders(token) }).then(json<Record<string, any>[]>).then(records => records.map(fromApiDevice)),
  getDevice: (token: string, id: string) => apiFetch(`${BASE()}/devices/${encodeURIComponent(id)}`, { headers: recoveryHeaders(token) }).then(json<Record<string, any>>).then(fromApiDevice),
  createDevice: (token: string, device: BluetoothDevice) => apiFetch(`${BASE()}/devices`, { method: 'POST', headers: recoveryHeaders(token, true), body: JSON.stringify(toApiDevice(device)) }).then(json<Record<string, any>>).then(fromApiDevice),
  updateDevice: (token: string, id: string, patch: Partial<BluetoothDevice>) => apiFetch(`${BASE()}/devices/${encodeURIComponent(id)}`, { method: 'PATCH', headers: recoveryHeaders(token, true), body: JSON.stringify(patch) }).then(json<Record<string, any>>).then(fromApiDevice),
  assessDevice: (token: string, id: string) => apiFetch(`${BASE()}/devices/${encodeURIComponent(id)}/assess`, { method: 'POST', headers: recoveryHeaders(token) }).then(json<Record<string, any>>),
  listThreats: (token: string, devices: BluetoothDevice[] = []) =>
    fetchThreatSnapshot(token, devices).then(snapshot => snapshot.threats),
  getThreatSnapshot: (token: string, devices: BluetoothDevice[] = []) =>
    fetchThreatSnapshot(token, devices),
  listActions: (token: string) => apiFetch(`${BASE()}/actions`, { headers: recoveryHeaders(token) }).then(json<Record<string, any>[]>).then(records => records.map(fromApiAction)),
  postAction: (token: string, payload: PostSecurityActionPayload) => apiFetch(`${BASE()}/actions`, { method: 'POST', headers: recoveryHeaders(token, true), body: JSON.stringify(payload) }).then(json<{ action: Record<string, any> }>).then(result => fromApiAction(result.action)),
  listEvents: (token: string) => apiFetch(`${BASE()}/events`, { headers: recoveryHeaders(token) }).then(json<Record<string, any>[]>),
  postEvent: (token: string, ev: any) => apiFetch(`${BASE()}/events`, { method: 'POST', headers: recoveryHeaders(token, true), body: JSON.stringify(ev) }).then(json<any>),
  recovery: {
    submitCommunitySightings: (token: string, payload: { observations: Array<{ name?: string; serviceUuids: string[]; addressHash?: string }>; shareLocation: boolean; location?: { lat: number; lng: number } }) => recoveryFetch(`${BASE()}/recovery/community/sightings`, {
      method: 'POST', headers: recoveryHeaders(token, true), body: JSON.stringify(payload),
    }).then(json<{ accepted: boolean; observationsReceived: number }>),
    listDevices: (token: string) => recoveryFetch(`${BASE()}/recovery/devices`, { headers: recoveryHeaders(token) }).then(json<RecoveryDeviceRecord[]>),
    registerDevice: (token: string, payload: Record<string, unknown>) => recoveryFetch(`${BASE()}/recovery/devices`, {
      method: 'POST',
      headers: recoveryHeaders(token, true),
      body: JSON.stringify(payload),
    }).then(json<RecoveryDeviceRecord>),
    updateState: (token: string, deviceId: string, status: RecoveryDeviceRecord['recoveryState']) => recoveryFetch(`${BASE()}/recovery/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      headers: recoveryHeaders(token, true),
      body: JSON.stringify({ status }),
    }).then(json<RecoveryDeviceRecord>),
    getRecoveryInfo: (token: string, deviceId: string) => recoveryFetch(`${BASE()}/recovery/devices/${encodeURIComponent(deviceId)}`, { headers: recoveryHeaders(token) }).then(json<RecoveryInfoRecord>),
    listEncounters: (token: string, deviceId: string) => recoveryFetch(`${BASE()}/recovery/devices/${encodeURIComponent(deviceId)}/encounters`, { headers: recoveryHeaders(token) }).then(json<RecoveryEncounterRecord[]>),
    submitEncounter: (token: string, deviceId: string, payload: Record<string, unknown>) => recoveryFetch(`${BASE()}/recovery/devices/${encodeURIComponent(deviceId)}/encounters`, {
      method: 'POST',
      headers: recoveryHeaders(token, true),
      body: JSON.stringify(payload),
    }).then(json<RecoveryEncounterRecord>),
  },
};