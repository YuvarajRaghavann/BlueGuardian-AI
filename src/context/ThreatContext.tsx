import React, { createContext, useContext, useReducer, useEffect, useState, type ReactNode } from 'react';
import type { BluetoothDevice, Threat, ThreatSeverity, ThreatStatus, ThreatReason } from '../types';
import { deduplicateThreats } from '../services/threatService';
import { useBluetoothDevices } from './DeviceContext';
import { assessDeviceSecurity } from '../utils/securityAssessment';
import { localDatabase, type StoredAssessment } from '../services/localDatabase';

interface ThreatState {
  threats: Threat[];
  filterSeverity: ThreatSeverity | 'all';
  filterStatus: ThreatStatus | 'all';
  search: string;
  sort: 'severity' | 'score' | 'newest' | 'oldest';
}

type Action =
  | { type: 'SET_THREATS'; payload: Threat[] }
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
      const merged = deduplicateThreats([...state.threats, ...action.payload.threats]).map(threat => {
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

function createAnalysisPayload(devices: BluetoothDevice[]): {
  threats: Threat[];
  assessments: StoredAssessment[];
} {
  const threats: Threat[] = [];
  const assessments: StoredAssessment[] = [];

  for (const device of devices) {
    const assessment = assessDeviceSecurity(device);
    threats.push(assessmentToThreat(device, assessment));
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
}>({} as any);

export function ThreatProvider({ children }: { children: ReactNode }) {
  const { state: deviceState } = useBluetoothDevices();
  const [state, dispatch] = useReducer(threatReducer, initialState);
  const [storedThreats, setStoredThreats] = useState<Threat[] | null>(null);

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

  useEffect(() => {
    if (storedThreats === null || deviceState.devices.length === 0) return;
    refreshThreats(deviceState.devices, dispatch);
  }, [deviceState.devices, storedThreats]);

  const refreshThreatAnalysis = (devices: BluetoothDevice[]) => {
    refreshThreats(devices, dispatch);
  };

  return (
    <ThreatContext.Provider value={{ state, dispatch, refreshThreatAnalysis }}>
      {children}
    </ThreatContext.Provider>
  );
}

export function useThreats() {
  const ctx = useContext(ThreatContext);
  if (!ctx) throw new Error('useThreats must be used within ThreatProvider');
  return ctx;
}