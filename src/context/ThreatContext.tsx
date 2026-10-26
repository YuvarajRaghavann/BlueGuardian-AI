import React, { createContext, useContext, useReducer, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BluetoothDevice, Threat, ThreatSeverity, ThreatStatus } from '../types';
import { deduplicateThreats } from '../services/threatService';
import { useBluetoothDevices } from './DeviceContext';
import { localDatabase, type StoredAssessment } from '../services/localDatabase';
import { api } from '../services/api';
import { useOwnerToken } from '../services/ownerSession';
import { intel } from '../intel/store';
import type { Finding } from '../intel/engine';

const FINDING_CATEGORY: Record<Finding['kind'], Threat['category']> = {
  tracker_following: 'TRACKER_FOLLOWING',
  popup_spam: 'POPUP_SPAM',
  lookalike: 'LOOKALIKE_DEVICE',
};

/** Alerts come only from concrete evidence found by the on-device engine. */
function findingToThreat(f: Finding): Threat {
  return {
    id: 'intel:' + f.id,
    deviceId: f.deviceAddress ? 'android-combined:' + f.deviceAddress.toLowerCase() : 'environment',
    deviceName: f.deviceName,
    category: FINDING_CATEGORY[f.kind],
    severity: f.severity,
    score: f.severity === 'high' ? 85 : f.severity === 'medium' ? 55 : 25,
    title: f.title,
    description: f.summary,
    reasons: f.evidence.map((message) => ({ code: f.kind.toUpperCase(), message })),
    recommendedAction: f.action,
    status: 'ACTIVE',
    detectedAt: new Date(f.detectedAt),
    updatedAt: new Date(f.updatedAt),
    discoverySource: 'REAL',
    finalClassification: f.strength === 'strong' ? 'Strong evidence' : 'Moderate evidence',
  };
}

interface ThreatState {
  threats: Threat[];
  filterSeverity: ThreatSeverity | 'all';
  filterStatus: ThreatStatus | 'all';
  search: string;
  sort: 'severity' | 'score' | 'newest' | 'oldest';
}

type Action =
  | { type: 'SET_THREATS'; payload: Threat[] }
  | { type: 'SET_INTEL_THREATS'; payload: Threat[] }
  | { type: 'MERGE_SERVER_THREATS'; payload: { threats: Threat[]; assessedDeviceIds: string[] } }
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
      const assessedDeviceIds = new Set(action.payload.assessedDeviceIds);
      // Drop stale ACTIVE local alerts when the backend has a newer assessment for
      // that device but no longer sees actionable threat evidence. Preserve non-active
      // records as history so user decisions are not erased.
      const history = state.threats.filter(threat =>
        !assessedDeviceIds.has(threat.deviceId) || threat.status !== 'ACTIVE',
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
    case 'SET_INTEL_THREATS': {
      // Old heuristic "unknown device" alerts are dropped; intel alerts keep the user's status choices.
      const kept = state.threats.filter((t) => !t.id.startsWith('intel:') && t.status !== 'ACTIVE' && t.discoverySource !== 'SIMULATED');
      const merged = action.payload.map((t) => {
        const previous = state.threats.find((p) => p.id === t.id);
        return previous && previous.status !== 'ACTIVE' ? { ...t, status: previous.status, resolved: previous.resolved } : t;
      });
      return { ...state, threats: [...merged, ...kept] };
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
    // Keep the current UI useful when the backend is temporarily unavailable.
    // Re-evaluate local devices so stale ACTIVE alerts can still be cleared safely.
    if (!ownerToken || !backendReady) {
      // Local alerts come from the evidence engine (see SET_INTEL_THREATS), not per-device guesses.
      return;
    }
    if (serverThreatsReadyToken !== ownerToken) return;

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
          const snapshot = await api.getThreatSnapshot(ownerToken, deviceState.devices);
          if (!cancelled) {
            backendAssessedDeviceIds.current = new Set(snapshot.assessedDeviceIds);
            dispatch({ type: 'MERGE_SERVER_THREATS', payload: snapshot });
          }
        } catch (error) {
          if (!cancelled) console.warn('Backend threats could not be refreshed.', error);
        }
      }
    };
    void syncAndAssess();
    return () => { cancelled = true; };
  }, [deviceState.devices, storedThreats, ownerToken, backendReady, serverThreatsReadyToken]);

  useEffect(() => {
    // Wait until the IndexedDB threat history has hydrated before merging the
    // backend snapshot. Otherwise a slow local read can overwrite fresh server data.
    if (!ownerToken || !backendReady || storedThreats === null) return;
    let cancelled = false;
    api.getThreatSnapshot(ownerToken, deviceState.devices)
      .then(snapshot => {
        if (cancelled) return;
        backendAssessedDeviceIds.current = new Set(snapshot.assessedDeviceIds);
        for (const device of deviceState.devices) {
          if (backendAssessedDeviceIds.current.has(device.id)) {
            assessedSignatures.current.set(device.id, deviceAssessmentSignature(device));
          }
        }
        dispatch({ type: 'MERGE_SERVER_THREATS', payload: snapshot });
        setServerThreatsReadyToken(ownerToken);
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn('Could not load owner-scoped backend threats; automatic backend assessment is paused until the owner data can be loaded.', error);
      });
    return () => { cancelled = true; };
  }, [ownerToken, backendReady, storedThreats]);

  useEffect(() => {
    if (storedThreats === null) return;
    const sync = () => dispatch({ type: 'SET_INTEL_THREATS', payload: intel.activeFindings().map(findingToThreat) });
    sync();
    return intel.subscribe(sync);
  }, [storedThreats]);

  const refreshThreatAnalysis = (devices: BluetoothDevice[]) => {
    if (!ownerToken) {
      dispatch({ type: 'SET_INTEL_THREATS', payload: intel.activeFindings().map(findingToThreat) });
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
      const snapshot = await api.getThreatSnapshot(ownerToken, devices);
      backendAssessedDeviceIds.current = new Set(snapshot.assessedDeviceIds);
      dispatch({ type: 'MERGE_SERVER_THREATS', payload: snapshot });
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
      const snapshot = await api.getThreatSnapshot(ownerToken, deviceState.devices);
      backendAssessedDeviceIds.current = new Set(snapshot.assessedDeviceIds);
      dispatch({ type: 'MERGE_SERVER_THREATS', payload: snapshot });
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