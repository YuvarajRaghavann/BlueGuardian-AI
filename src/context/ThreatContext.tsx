import React, { createContext, useContext, useReducer, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BluetoothDevice, Threat, ThreatSeverity, ThreatStatus, ThreatReason } from '../types';
import { deduplicateThreats } from '../services/threatService';
import { useBluetoothDevices } from './DeviceContext';
import { assessDeviceSecurity } from '../utils/securityAssessment';
import { localDatabase, type StoredAssessment } from '../services/localDatabase';
import { api } from '../services/api';
import { useOwnerToken } from '../services/ownerSession';

interface ThreatState {
  threats: Threat[];
  filterSeverity: ThreatSeverity | 'all';
  filterStatus: ThreatStatus | 'all';
  search: string;
  sort: 'severity' | 'score' | 'newest' | 'oldest';
}

type Action =
  | { type: 'SET_THREATS'; payload: Threat[] }
  | { type: 'MERGE_SERVER_THREATS'; payload: Threat[] }
  | { type: 'ADD_THREAT'; payload: Threat }
  | { type: 'UPDATE_THREAT'; payload: Threat }
  | { type: 'REMOVE_THREAT'; payload: string }
  | { type: 'SET_FILTER_SEVERITY'; payload: ThreatState['filterSeverity'] }
  | { type: 'SET_FILTER_STATUS'; payload: ThreatState['filterStatus'] }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_SORT'; payload: ThreatState['sort'] }
  | { type: 'RESOLVE_THREAT'; payload: string }
  | { type: 'DISMISS_THREAT'; payload: string }
  | { type: 'INVESTIGATE_THREAT'; payload: string }
  | { type: 'CLEAR_RESOLVED' }
  | { type: 'REFRESH_ANALYSIS'; payload: { threats: Threat[]; assessments: StoredAssessment[] } };

function threatReducer(state: ThreatState, action: Action): ThreatState {
  switch (action.type) {
    case 'SET_THREATS':
      return { ...state, threats: action.payload };
    case 'MERGE_SERVER_THREATS': {
      // Server assessments take precedence for the same device/category. Local-only records
      // remain available as a fallback, preserving browser-only use and older local history.
      const serverDeviceIds = new Set(action.payload.map(threat => threat.deviceId));
      const localOnly = state.threats.filter(threat => !serverDeviceIds.has(threat.deviceId));
      return { ...state, threats: deduplicateThreats([...localOnly, ...action.payload]) };
    }
    case 'ADD_THREAT': {
      const exists = state.threats.some(t => t.id === action.payload.id);
      if (exists) return state;
      return { ...state, threats: [...state.threats, action.payload] };
    }
    case 'UPDATE_THREAT':
      return {
        ...state,
        threats: state.threats.map(t => (t.id === action.payload.id ? action.payload : t)),
      };
    case 'REMOVE_THREAT':
      return { ...state, threats: state.threats.filter(t => t.id !== action.payload) };
    case 'SET_FILTER_SEVERITY':
      return { ...state, filterSeverity: action.payload };
    case 'SET_FILTER_STATUS':
      return { ...state, filterStatus: action.payload };
    case 'SET_SEARCH':
      return { ...state, search: action.payload };
    case 'SET_SORT':
      return { ...state, sort: action.payload };
    case 'RESOLVE_THREAT': {
      const idx = state.threats.findIndex(t => t.id === action.payload);
      if (idx === -1) return state;
      const next = [...state.threats];
      next[idx] = { ...next[idx], status: 'RESOLVED', resolved: true, updatedAt: new Date() };
      return { ...state, threats: next };
    }
    case 'DISMISS_THREAT': {
      const idx = state.threats.findIndex(t => t.id === action.payload);
      if (idx === -1) return state;
      const next = [...state.threats];
      next[idx] = { ...next[idx], status: 'DISMISSED', updatedAt: new Date() };
      return { ...state, threats: next };
    }
    case 'INVESTIGATE_THREAT': {
      const idx = state.threats.findIndex(t => t.id === action.payload);
      if (idx === -1) return state;
      const next = [...state.threats];
      next[idx] = { ...next[idx], status: 'INVESTIGATING', updatedAt: new Date() };
      return { ...state, threats: next };
    }
    case 'CLEAR_RESOLVED':
      return { ...state, threats: state.threats.filter(t => t.status !== 'RESOLVED' && t.status !== 'DISMISSED') };
    case 'REFRESH_ANALYSIS': {
      const analyzedDeviceIds = new Set(action.payload.assessments.map(item => item.deviceId));
      const history = state.threats.filter(threat =>
        !analyzedDeviceIds.has(threat.deviceId) || threat.status !== 'ACTIVE',
      );
      const merged = deduplicateThreats([...history, ...action.payload.threats]).map(threat => {
        const previous = state.threats.find(
          current => current.deviceId === threat.deviceId && current.category === threat.category,
        );
        if (!previous || previous.status === 'ACTIVE') return threat;
        return {
          ...threat,
          status: previous.status,
          updatedAt: previous.updatedAt,
          resolved: previous.resolved,
        };
      });
      return { ...state, threats: merged };
    }
    default:
      return state;
  }
}

function isActionableThreat(assessment: ReturnType<typeof assessDeviceSecurity>): boolean {
  const codes = new Set(assessment.reasons.map(reason => reason.code));
  const explicitlyBlocked = codes.has('BLOCKED_DEVICE');
  const corroboratedSuspicion = assessment.finalThreatScore >= 35
    && codes.has('SUSPICIOUS_NAME')
    && codes.has('UNSTABLE_CONNECTION');
  return assessment.finalThreatScore >= 50 || explicitlyBlocked || corroboratedSuspicion;
}

function createAnalysisPayload(devices: BluetoothDevice[]): {
  threats: Threat[];
  assessments: StoredAssessment[];
} {
  const threats: Threat[] = [];
  const assessments: StoredAssessment[] = [];

  for (const device of devices) {
    const assessment = assessDeviceSecurity(device);
    if (isActionableThreat(assessment)) {
      threats.push(assessmentToThreat(device, assessment));
    }
    assessments.push({
      deviceId: device.id,
      assessment,
      analyzedAt: new Date(),
      discoverySource: device.discoverySource,
    });
  }

  return { threats, assessments };
}

function refreshThreats(
  devices: BluetoothDevice[],
  dispatch: React.Dispatch<Action>,
): void {
  const payload = createAnalysisPayload(devices);
  dispatch({ type: 'REFRESH_ANALYSIS', payload });
  void localDatabase.saveAssessments(payload.assessments).catch((error: unknown) => {
    console.warn('Assessments are available for this session but were not saved locally.', error);
  });
}

function deviceAssessmentSignature(device: BluetoothDevice): string {
  return JSON.stringify({
    id: device.id, name: device.name, type: device.type, trusted: device.trusted,
    blocked: device.blocked, trustScore: device.trustScore, riskLevel: device.riskLevel,
    isKnown: device.isKnown, manufacturer: device.manufacturer, rssi: device.rssi,
    connectionStatus: device.connectionStatus, services: device.services,
    gattConnected: device.gattConnected, connectionHealth: device.connectionHealth,
    discoverySource: device.discoverySource,
  });
}

function assessmentToThreat(device: BluetoothDevice, a: ReturnType<typeof assessDeviceSecurity>): Threat {
  const id = `thr-${device.id}-${Date.now()}`;
  return {
    id,
    deviceId: device.id,
    deviceName: device.name,
    category: a.ruleBasedCategory,
    severity: a.finalSeverity,
    score: a.finalThreatScore,
    title: `${a.ruleBasedCategory.replace(/_/g, ' ')} Detected`,
    description: a.reasons.map((r: ThreatReason) => r.message).join(' '),
    reasons: a.reasons,
    recommendedAction: a.recommendedAction,
    status: 'ACTIVE',
    detectedAt: new Date(),
    updatedAt: new Date(),
    discoverySource: device.discoverySource,
    // ML enrichment
    mlPrediction: a.mlPrediction,
    finalClassification: a.finalClassification,
    confidence: a.confidence,
    modelName: a.mlPrediction?.modelName,
    modelVersion: a.mlPrediction?.modelVersion,
    resolved: false,
  };
}

const initialState: ThreatState = {
  threats: [],
  filterSeverity: 'all',
  filterStatus: 'all',
  search: '',
  sort: 'severity',
};

const ThreatContext = createContext<{
  state: ThreatState;
  dispatch: React.Dispatch<Action>;
  refreshThreatAnalysis: (devices: BluetoothDevice[]) => void;
  updateThreatStatus: (threatId: string, status: 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED') => void;
}>({} as any);

export function ThreatProvider({ children }: { children: ReactNode }) {
  const { state: deviceState, backendReady } = useBluetoothDevices();
  const [state, dispatch] = useReducer(threatReducer, initialState);
  const [storedThreats, setStoredThreats] = useState<Threat[] | null>(null);
  const ownerToken = useOwnerToken();
  const assessedSignatures = useRef(new Map<string, string>());
  const backendAssessedDeviceIds = useRef(new Set<string>());
  const [serverThreatsReadyToken, setServerThreatsReadyToken] = useState<string | null>(null);

  useEffect(() => {
    assessedSignatures.current.clear();
    backendAssessedDeviceIds.current.clear();
    setServerThreatsReadyToken(null);
  }, [ownerToken]);

  useEffect(() => {
    let cancelled = false;
    localDatabase.listThreats()
      .then(threats => {
        if (cancelled) return;
        setStoredThreats(threats);
        dispatch({ type: 'SET_THREATS', payload: threats });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn('Could not load local threat history; continuing for this session.', error);
        setStoredThreats([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (storedThreats === null || state.threats === initialState.threats || state.threats === storedThreats) return;
    void localDatabase.replaceThreats(state.threats).catch((error: unknown) => {
      console.warn('Threat status is available for this session but was not saved locally.', error);
    });
  }, [state.threats, storedThreats]);

  // When authenticated, store devices and run the backend assessment endpoint. The
  // browser-side development analysis remains active when no owner token is configured.
  useEffect(() => {
    if (storedThreats === null || deviceState.devices.length === 0) return;
    if (!ownerToken) {
      refreshThreats(deviceState.devices, dispatch);
      return;
    }
    if (!backendReady || serverThreatsReadyToken !== ownerToken) return;

    let cancelled = false;
    const syncAndAssess = async () => {
      let changed = false;
      for (const device of deviceState.devices) {
        const signature = deviceAssessmentSignature(device);
        const previousSignature = assessedSignatures.current.get(device.id);
        if (previousSignature === signature) continue;
        if (!previousSignature && backendAssessedDeviceIds.current.has(device.id)) {
          assessedSignatures.current.set(device.id, signature);
          continue;
        }
        try {
          // The assessment endpoint needs a persisted, owner-scoped device record first.
          await api.createDevice(ownerToken, device);
          await api.assessDevice(ownerToken, device.id);
          if (cancelled) return;
          assessedSignatures.current.set(device.id, signature);
          backendAssessedDeviceIds.current.add(device.id);
          changed = true;
        } catch (error) {
          if (!cancelled) console.warn(`Backend assessment failed for ${device.name}; local mode is still available.`, error);
        }
      }
      if (changed && !cancelled) {
        try {
          const serverThreats = await api.listThreats(ownerToken, deviceState.devices);
          if (!cancelled) dispatch({ type: 'MERGE_SERVER_THREATS', payload: serverThreats });
        } catch (error) {
          if (!cancelled) console.warn('Backend threats could not be refreshed.', error);
        }
      }
    };
    void syncAndAssess();
    return () => { cancelled = true; };
  }, [deviceState.devices, storedThreats, ownerToken, backendReady, serverThreatsReadyToken]);

  useEffect(() => {
    if (!ownerToken || !backendReady) return;
    let cancelled = false;
    api.listThreats(ownerToken, deviceState.devices)
      .then(serverThreats => {
        if (cancelled) return;
        backendAssessedDeviceIds.current = new Set(serverThreats.map(threat => threat.deviceId));
        for (const device of deviceState.devices) {
          if (backendAssessedDeviceIds.current.has(device.id)) {
            assessedSignatures.current.set(device.id, deviceAssessmentSignature(device));
          }
        }
        dispatch({ type: 'MERGE_SERVER_THREATS', payload: serverThreats });
        setServerThreatsReadyToken(ownerToken);
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn('Could not load owner-scoped backend threats; automatic backend assessment is paused until the owner data can be loaded.', error);
      });
    return () => { cancelled = true; };
  }, [ownerToken, backendReady]);

  const refreshThreatAnalysis = (devices: BluetoothDevice[]) => {
    if (!ownerToken) {
      refreshThreats(devices, dispatch);
      return;
    }
    if (!backendReady) return;
    const refreshBackend = async () => {
      for (const device of devices) {
        await api.createDevice(ownerToken, device);
        await api.assessDevice(ownerToken, device.id);
        assessedSignatures.current.set(device.id, deviceAssessmentSignature(device));
        backendAssessedDeviceIds.current.add(device.id);
      }
      const serverThreats = await api.listThreats(ownerToken, devices);
      dispatch({ type: 'MERGE_SERVER_THREATS', payload: serverThreats });
    };
    void refreshBackend().catch((error: unknown) => console.warn('Could not refresh backend threat analysis.', error));
  };

  const updateThreatStatus = (threatId: string, status: 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED') => {
    const threat = state.threats.find(item => item.id === threatId);
    const actionType = status === 'RESOLVED' ? 'RESOLVE_THREAT' : status === 'DISMISSED' ? 'DISMISS_THREAT' : 'INVESTIGATE_THREAT';
    dispatch({ type: actionType, payload: threatId });
    if (!ownerToken || !backendReady || !threat) return;

    const persistStatus = async () => {
      const device = deviceState.devices.find(item => item.id === threat.deviceId);
      if (device) await api.createDevice(ownerToken, device);
      let backendThreatId = /^[a-f0-9]{24}$/i.test(threat.id) ? threat.id : undefined;
      if (!backendThreatId) {
        if (device) await api.assessDevice(ownerToken, device.id);
        const available = await api.listThreats(ownerToken, deviceState.devices);
        backendThreatId = available.find(item => item.deviceId === threat.deviceId)?.id;
        if (backendThreatId) backendAssessedDeviceIds.current.add(threat.deviceId);
      }
      if (!backendThreatId) throw new Error('No backend assessment ID is available for this threat yet.');
      const action = status === 'RESOLVED' ? 'RESOLVE_THREAT' : status === 'DISMISSED' ? 'DISMISS_THREAT' : 'INVESTIGATE';
      await api.postAction(ownerToken, {
        deviceId: threat.deviceId,
        deviceName: threat.deviceName,
        action,
        source: 'USER',
        simulated: threat.discoverySource === 'SIMULATED',
        reason: `Threat status changed to ${status.toLowerCase()} from the security dashboard.`,
        threatId: backendThreatId,
      });
      const refreshed = await api.listThreats(ownerToken, deviceState.devices);
      dispatch({ type: 'MERGE_SERVER_THREATS', payload: refreshed });
    };
    void persistStatus().catch((error: unknown) => console.warn('Threat status changed locally, but backend persistence failed.', error));
  };

  return (
    <ThreatContext.Provider value={{ state, dispatch, refreshThreatAnalysis, updateThreatStatus }}>
      {children}
    </ThreatContext.Provider>
  );
}

export function useThreats() {
  const ctx = useContext(ThreatContext);
  if (!ctx) throw new Error('useThreats must be used within ThreatProvider');
  return ctx;
}