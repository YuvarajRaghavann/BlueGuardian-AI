import type { BluetoothDevice, ConnectionStatus, DeviceType, RiskLevel, SecurityAction, SecurityActionType, Threat, ThreatCategory, ThreatSeverity, ThreatStatus, ThreatReason, MLThreatClass } from '../types';
import { resolveBluetoothDisplayName } from './bluetoothService';

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
    riskLevel: validRiskLevels.includes(record.riskLevel) ? record.riskLevel : 'high',
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
    modelName: String(record.modelName ?? 'BlueGuardian Development Classifier'),
    modelVersion: String(record.modelVersion ?? '0.1.0-demo'),
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
  health: () => fetch(`${BASE}/health`).then(json<{ status: string; database: string }>),
  listDevices: (token: string) => fetch(`${BASE}/devices`, { headers: recoveryHeaders(token) }).then(json<Record<string, any>[]>).then(records => records.map(fromApiDevice)),
  getDevice: (token: string, id: string) => fetch(`${BASE}/devices/${encodeURIComponent(id)}`, { headers: recoveryHeaders(token) }).then(json<Record<string, any>>).then(fromApiDevice),
  createDevice: (token: string, device: BluetoothDevice) => fetch(`${BASE}/devices`, { method: 'POST', headers: recoveryHeaders(token, true), body: JSON.stringify(toApiDevice(device)) }).then(json<Record<string, any>>).then(fromApiDevice),
  updateDevice: (token: string, id: string, patch: Partial<BluetoothDevice>) => fetch(`${BASE}/devices/${encodeURIComponent(id)}`, { method: 'PATCH', headers: recoveryHeaders(token, true), body: JSON.stringify(patch) }).then(json<Record<string, any>>).then(fromApiDevice),
  assessDevice: (token: string, id: string) => fetch(`${BASE}/devices/${encodeURIComponent(id)}/assess`, { method: 'POST', headers: recoveryHeaders(token) }).then(json<Record<string, any>>),
  listThreats: (token: string, devices: BluetoothDevice[] = []) => fetch(`${BASE}/threats`, { headers: recoveryHeaders(token) }).then(json<Record<string, any>[]>).then(records => {
    const latestByDeviceCategory = new Map<string, Threat>();
    for (const record of records) {
      const mapped = fromApiThreat(record, devices);
      const key = `${mapped.deviceId}|${mapped.category}`;
      const existing = latestByDeviceCategory.get(key);
      if (!existing || mapped.detectedAt.getTime() > existing.detectedAt.getTime()) latestByDeviceCategory.set(key, mapped);
    }
    return Array.from(latestByDeviceCategory.values()).sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }),
  listActions: (token: string) => fetch(`${BASE}/actions`, { headers: recoveryHeaders(token) }).then(json<Record<string, any>[]>).then(records => records.map(fromApiAction)),
  postAction: (token: string, payload: PostSecurityActionPayload) => fetch(`${BASE}/actions`, { method: 'POST', headers: recoveryHeaders(token, true), body: JSON.stringify(payload) }).then(json<{ action: Record<string, any> }>).then(result => fromApiAction(result.action)),
  listEvents: (token: string) => fetch(`${BASE}/events`, { headers: recoveryHeaders(token) }).then(json<Record<string, any>[]>),
  postEvent: (token: string, ev: any) => fetch(`${BASE}/events`, { method: 'POST', headers: recoveryHeaders(token, true), body: JSON.stringify(ev) }).then(json<any>),
  recovery: {
    listDevices: (token: string) => recoveryFetch(`${BASE}/recovery/devices`, { headers: recoveryHeaders(token) }).then(json<RecoveryDeviceRecord[]>),
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
    getRecoveryInfo: (token: string, deviceId: string) => recoveryFetch(`${BASE}/recovery/devices/${encodeURIComponent(deviceId)}`, { headers: recoveryHeaders(token) }).then(json<RecoveryInfoRecord>),
    listEncounters: (token: string, deviceId: string) => recoveryFetch(`${BASE}/recovery/devices/${encodeURIComponent(deviceId)}/encounters`, { headers: recoveryHeaders(token) }).then(json<RecoveryEncounterRecord[]>),
    submitEncounter: (token: string, deviceId: string, payload: Record<string, unknown>) => recoveryFetch(`${BASE}/recovery/devices/${encodeURIComponent(deviceId)}/encounters`, {
      method: 'POST',
      headers: recoveryHeaders(token, true),
      body: JSON.stringify(payload),
    }).then(json<RecoveryEncounterRecord>),
  },
};