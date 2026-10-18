import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { BluetoothDevice, SecurityAction, SecurityActionType, DeviceProtectionStatus, SecurityPolicy } from '../types';
import { validateAction, createSecurityAction, getAllowedActions, applySecurityActionToDevice } from '../services/securityActionService';
import { useBluetoothDevices } from './DeviceContext';
import { useThreats } from './ThreatContext';
import { localDatabase } from '../services/localDatabase';
import { loadSecurityPolicy, saveSecurityPolicy } from '../services/localSettings';
import { evaluateSecureBluetoothProfile } from '../utils/connectionPolicy';
import { assessDeviceSecurity } from '../utils/securityAssessment';
import { api } from '../services/api';
import { useOwnerToken } from '../services/ownerSession';
import { intel } from '../intel/store';
import { SIMULATOR_ENABLED } from '../config/buildFlags';

interface SecurityState {
  actions: SecurityAction[];
  protectionStatuses: Record<string, DeviceProtectionStatus>;
  policy: SecurityPolicy;
}

type Action =
  | { type: 'SET_ACTIONS'; payload: SecurityAction[] }
  | { type: 'MERGE_SERVER_ACTIONS'; payload: SecurityAction[] }
  | { type: 'RECONCILE_ACTION'; payload: { localId: string; action: SecurityAction } }
  | { type: 'ADD_ACTION'; payload: SecurityAction }
  | { type: 'SET_POLICY'; payload: Partial<SecurityPolicy> }
  | { type: 'RECALCULATE_PROTECTION'; payload: { deviceId: string; status: DeviceProtectionStatus } }
  | { type: 'CLEAR_HISTORY' };

const initialPolicy: SecurityPolicy = {
  confirmBlock: true,
  confirmTrust: true,
  showLowConfidenceWarnings: true,
  showSimulatedEvents: SIMULATOR_ENABLED,
  requireConnectionApproval: true,
  blockUnknownFileTransfers: true,
  enforceFastPairApproval: true,
  enableRssiGuard: true,
  restrictWearablesToAudio: true,
};

const initialState: SecurityState = {
  actions: [],
  protectionStatuses: {},
  policy: initialPolicy,
};

function createInitialState(): SecurityState {
  return { ...initialState, policy: loadSecurityPolicy(initialPolicy) };
}

function securityReducer(state: SecurityState, action: Action): SecurityState {
  switch (action.type) {
    case 'SET_ACTIONS':
      return {
        ...state,
        actions: Array.from(
          new Map([...action.payload, ...state.actions].map(item => [item.id, item])).values(),
        ).sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime()),
      };
    case 'MERGE_SERVER_ACTIONS': {
      const remote = action.payload;
      const remoteIds = new Set(remote.map(item => item.id));
      const withoutDuplicates = state.actions.filter(local => {
        if (remoteIds.has(local.id)) return false;
        return !remote.some(server => server.deviceId === local.deviceId && server.type === local.type && server.reason === local.reason && Math.abs(server.timestamp.getTime() - local.timestamp.getTime()) <= 10_000);
      });
      const merged = new Map([...withoutDuplicates, ...remote].map(item => [item.id, item]));
      return { ...state, actions: Array.from(merged.values()).sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime()) };
    }
    case 'RECONCILE_ACTION': {
      const actions = state.actions.filter(item => item.id !== action.payload.localId && item.id !== action.payload.action.id);
      return { ...state, actions: [action.payload.action, ...actions].sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime()) };
    }
    case 'ADD_ACTION':
      return { ...state, actions: [action.payload, ...state.actions] };
    case 'SET_POLICY':
      return { ...state, policy: { ...state.policy, ...action.payload } };
    case 'RECALCULATE_PROTECTION':
      return {
        ...state,
        protectionStatuses: {
          ...state.protectionStatuses,
          [action.payload.deviceId]: action.payload.status,
        },
      };
    case 'CLEAR_HISTORY':
      return { ...state, actions: [] };
    default:
      return state;
  }
}

const SecurityContext = createContext<{
  state: SecurityState;
  dispatch: React.Dispatch<Action>;
  executeAction: (type: SecurityActionType, device: BluetoothDevice, reason: string) => boolean;
  getProtectionStatus: (deviceId: string) => DeviceProtectionStatus;
  getAllowedActions: (device: BluetoothDevice) => SecurityActionType[];
}>({} as any);

export function SecurityProvider({ children }: { children: ReactNode }) {
  const { state: deviceState, dispatch: deviceDispatch, backendReady } = useBluetoothDevices();
  const { state: threatState } = useThreats();
  const [state, dispatch] = useReducer(securityReducer, initialState, createInitialState);
  const ownerToken = useOwnerToken();

  useEffect(() => {
    let cancelled = false;
    localDatabase.listActions()
      .then((actions) => {
        if (!cancelled) dispatch({ type: 'MERGE_SERVER_ACTIONS', payload: actions });
      })
      .catch((error: unknown) => {
        console.warn('Could not load local security actions; continuing for this session.', error);
      });
    return () => { cancelled = true; };
  }, []);

  // Merge owner-scoped MongoDB audit actions when the user configured an owner token.
  useEffect(() => {
    if (!ownerToken || !backendReady) return;
    let cancelled = false;
    api.listActions(ownerToken)
      .then(actions => {
        if (!cancelled) dispatch({ type: 'MERGE_SERVER_ACTIONS', payload: actions });
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn('Could not load backend security actions; browser history remains available.', error);
      });
    return () => { cancelled = true; };
  }, [ownerToken, backendReady]);

  useEffect(() => {
    if (!saveSecurityPolicy(state.policy)) {
      console.warn('Security policy settings could not be saved in this browser.');
    }
  }, [state.policy]);

  // Recalculate protection statuses when devices or threats change
  useEffect(() => {
    deviceState.devices.forEach(_device => {
      // const deviceThreats = threatState.threats.filter(t => t.deviceId === device.id);
      // Need assessment; we can import assessDeviceSecurity but avoid circular. For simplicity, compute from latest threat
      // We'll approximate using latest threat's assessment if available
      // We'll skip full assessment here; protection will be computed on-demand in components using util
    });
  }, [deviceState.devices, threatState.threats]);

  const executeAction = (type: SecurityActionType, device: BluetoothDevice, reason: string): boolean => {
    // Validate using the live security assessment for the device
    const deviceThreats = threatState.threats.filter(t => t.deviceId === device.id);
    const assessment = assessDeviceSecurity(device);
    const validation = validateAction(type, device, assessment, deviceThreats);
    if (!validation.valid) {
      console.warn('Action invalid:', validation.reason);
      return false;
    }

    // Determine simulated flag from device discoverySource
    const simulated = device.discoverySource === 'SIMULATED';
    const updatedDevice = applySecurityActionToDevice(device, type);

    const previousState = {
      trusted: device.trusted,
      isKnown: device.isKnown,
      blocked: device.blocked,
      trustScore: device.trustScore,
      riskLevel: device.riskLevel,
    };
    const newState = ['TRUST', 'MARK_UNKNOWN', 'BLOCK', 'UNBLOCK'].includes(type) && updatedDevice
      ? {
          trusted: updatedDevice.trusted,
          isKnown: updatedDevice.isKnown,
          blocked: updatedDevice.blocked,
          trustScore: updatedDevice.trustScore,
          riskLevel: updatedDevice.riskLevel,
        }
      : undefined;
    const actionRecord = createSecurityAction(type, device, reason, 'USER', simulated, previousState, newState);
    dispatch({ type: 'ADD_ACTION', payload: actionRecord });
    // Owner decisions are evidence in the device's trust ledger.
    const decision = type === 'TRUST' ? 'trust' : type === 'MARK_UNKNOWN' ? 'untrust' : type === 'BLOCK' ? 'block' : type === 'UNBLOCK' ? 'unblock' : null;
    if (decision && device.address && !simulated) intel.recordDecision(device.address, decision, device.name);

    const updatedDeviceForStorage = type === 'FORGET'
      ? null
      : ['TRUST', 'MARK_UNKNOWN', 'BLOCK', 'UNBLOCK'].includes(type)
        ? updatedDevice
        : undefined;
    void localDatabase.recordSecurityAction(actionRecord, updatedDeviceForStorage).catch((error: unknown) => {
      console.warn('Security action remains active for this session but could not be saved locally.', error);
    });

    // Keep the existing immediate local response, and persist the same decision to the
    // owner-scoped API when authenticated. The API creates an audit event server-side.
    if (ownerToken && backendReady) {
      const persistBackendAction = async () => {
        await api.createDevice(ownerToken, device);
        const backendAction = await api.postAction(ownerToken, {
          deviceId: device.id,
          deviceName: device.name,
          action: type,
          source: 'USER',
          simulated,
          reason,
          previousState,
          ...(newState ? { newState } : {}),
        });
        dispatch({ type: 'RECONCILE_ACTION', payload: { localId: actionRecord.id, action: backendAction } });
      };
      void persistBackendAction().catch((error: unknown) => {
        console.warn('Security action was applied locally, but backend persistence failed.', error);
      });
    }

    // Apply state changes to device via DeviceContext
    switch (type) {
      case 'TRUST':
        deviceDispatch({ type: 'MARK_TRUSTED', payload: device.id });
        break;
      case 'MARK_UNKNOWN':
        deviceDispatch({ type: 'MARK_UNKNOWN', payload: device.id });
        break;
      case 'BLOCK':
        deviceDispatch({ type: 'BLOCK_DEVICE', payload: device.id });
        break;
      case 'UNBLOCK':
        deviceDispatch({ type: 'UNBLOCK_DEVICE', payload: device.id });
        break;
      case 'FORGET':
        deviceDispatch({ type: 'FORGET_DEVICE', payload: device.id });
        break;
      // Threat actions handled in ThreatContext
    }
    return true;
  };

  const getProtectionStatus = (deviceId: string): DeviceProtectionStatus => {
    const device = deviceState.devices.find(d => d.id === deviceId);
    if (!device) return 'UNKNOWN';
    if (device.blocked) return 'BLOCKED';

    const profile = evaluateSecureBluetoothProfile(device, {
      rssi: device.rssi,
      fileName: device.name,
      deviceType: device.type,
    });

    if (profile.connectionDecision === 'BLOCK') return 'BLOCKED';

    const deviceThreats = threatState.threats.filter(t => t.deviceId === deviceId);
    const hasHighThreat = deviceThreats.some(t => (t.severity === 'high' || t.severity === 'critical') && t.status === 'ACTIVE');
    if (profile.approvalRequired || profile.connectionDecision === 'REQUIRE_APPROVAL' || hasHighThreat || !device.trusted || !device.isKnown) return 'MONITORING';
    if (device.trusted && device.isKnown && !hasHighThreat) return 'PROTECTED';
    return 'UNKNOWN';
  };

  const getAllowedActionsForDevice = (device: BluetoothDevice): SecurityActionType[] => {
    const deviceThreats = threatState.threats.filter(t => t.deviceId === device.id);
    const profile = evaluateSecureBluetoothProfile(device, {
      rssi: device.rssi,
      fileName: device.name,
      deviceType: device.type,
    });

    const assessment = assessDeviceSecurity(device);
    const allowed = getAllowedActions(device, assessment, deviceThreats);
    if (profile.connectionDecision === 'BLOCK') return allowed.filter(action => action === 'UNBLOCK' || action === 'FORGET' || action === 'BLOCK');
    if (profile.approvalRequired || profile.connectionDecision === 'REQUIRE_APPROVAL') return allowed.filter(action => action !== 'IGNORE_DEVICE');
    return allowed;
  };

  return (
    <SecurityContext.Provider value={{ state, dispatch, executeAction, getProtectionStatus, getAllowedActions: getAllowedActionsForDevice }}>
      {children}
    </SecurityContext.Provider>
  );
}

export function useSecurity() {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error('useSecurity must be used within SecurityProvider');
  return ctx;
}