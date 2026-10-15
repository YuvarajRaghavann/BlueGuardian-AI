import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { BluetoothDevice, BluetoothScanState } from '../types';
import { generateSimulatedDevices } from '../services/bluetoothSimulator';
import { isBluetoothSupported, requestBluetoothDevice, connectAndDiscover, readStandardCharacteristics } from '../services/bluetoothService';
import { assessDeviceSecurity } from '../utils/securityAssessment';
import { evaluateSecureBluetoothProfile, needsManualApproval } from '../utils/connectionPolicy';
import { localDatabase } from '../services/localDatabase';
import { applySecurityActionToDevice } from '../services/securityActionService';
import { recordWorkflowEvent } from '../services/workflowEventService';
import { api, hasOwnerSessionToken, type BackendDeviceRecord } from '../services/api';
import { useBackendSession } from './BackendSessionContext';

export interface DeviceState {
  devices: BluetoothDevice[];
  scan: BluetoothScanState;
  simulationMode: boolean;
  filter: 'all' | 'trusted' | 'unknown' | 'review' | 'high-risk' | 'connected' | 'nearby';
  sort: 'trust' | 'signal' | 'lastSeen' | 'risk';
  search: string;
}

type Action =
  | { type: 'SET_DEVICES'; payload: BluetoothDevice[] }
  | { type: 'MERGE_REMOTE_DEVICES'; payload: BluetoothDevice[] }
  | { type: 'ADD_DEVICE'; payload: BluetoothDevice }
  | { type: 'UPDATE_DEVICE'; payload: BluetoothDevice }
  | { type: 'MARK_DISCONNECTED'; payload: string }
  | { type: 'REMOVE_DEVICE'; payload: string }
  | { type: 'SET_SCAN_STATE'; payload: Partial<BluetoothScanState> }
  | { type: 'TOGGLE_SIMULATION'; payload: boolean }
  | { type: 'SET_FILTER'; payload: DeviceState['filter'] }
  | { type: 'SET_SORT'; payload: DeviceState['sort'] }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'MARK_TRUSTED'; payload: string }
  | { type: 'MARK_UNKNOWN'; payload: string }
  | { type: 'BLOCK_DEVICE'; payload: string }
  | { type: 'UNBLOCK_DEVICE'; payload: string }
  | { type: 'FORGET_DEVICE'; payload: string };

function applySecurityPolicy(device: BluetoothDevice): BluetoothDevice {
  const profile = evaluateSecureBluetoothProfile(device, {
    rssi: device.rssi,
    fileName: device.name,
    deviceType: device.type,
  });

  if (profile.connectionDecision === 'BLOCK') {
    return { ...device, blocked: true, approvalRequired: false, riskLevel: 'high', trustScore: Math.min(device.trustScore, 25) };
  }

  if (profile.connectionDecision === 'REQUIRE_APPROVAL') {
    return {
      ...device,
      trusted: false,
      isKnown: false,
      approvalRequired: true,
      riskLevel: 'medium',
      trustScore: Math.min(device.trustScore, 45),
    };
  }

  if (profile.wearableMode === 'RESTRICTED') {
    return {
      ...device,
      approvalRequired: needsManualApproval(device),
      riskLevel: 'medium',
      trustScore: Math.min(device.trustScore, 55),
    };
  }

  return { ...device, approvalRequired: needsManualApproval(device) };
}


const knownDeviceTypes: BluetoothDevice['type'][] = [
  'smartphone', 'earbuds', 'headphones', 'smartwatch', 'laptop', 'iot', 'unknown',
];
const knownRiskLevels: BluetoothDevice['riskLevel'][] = ['trusted', 'low', 'medium', 'high'];
const knownConnectionStatuses: BluetoothDevice['connectionStatus'][] = ['connected', 'disconnected', 'connecting', 'unknown'];

function toLocalDevice(record: BackendDeviceRecord): BluetoothDevice {
  const type = record.type?.toLowerCase() as BluetoothDevice['type'] | undefined;
  const riskLevel = record.riskLevel as BluetoothDevice['riskLevel'] | undefined;
  const connectionStatus = record.connectionStatus as BluetoothDevice['connectionStatus'] | undefined;
  return {
    id: record.deviceId,
    name: record.name || record.deviceId,
    type: type && knownDeviceTypes.includes(type) ? type : 'unknown',
    address: record.address,
    rssi: record.rssi,
    trusted: Boolean(record.trusted),
    blocked: Boolean(record.blocked),
    trustScore: typeof record.trustScore === 'number' ? record.trustScore : 0,
    riskLevel: riskLevel && knownRiskLevels.includes(riskLevel) ? riskLevel : 'high',
    connectionStatus: connectionStatus && knownConnectionStatuses.includes(connectionStatus)
      ? connectionStatus : 'unknown',
    firstSeen: record.firstSeen ? new Date(record.firstSeen) : new Date(),
    lastSeen: record.lastSeen ? new Date(record.lastSeen) : new Date(),
    isKnown: Boolean(record.isKnown),
    manufacturer: record.manufacturer,
    services: (record.services ?? []).map(service => ({
      uuid: service.uuid,
      name: service.name,
      characteristics: [],
    })),
    discoverySource: record.discoverySource === 'SIMULATED' ? 'SIMULATED' : 'REAL',
    gattConnected: record.gattConnected,
    connectionHealth: record.connectionHealth as BluetoothDevice['connectionHealth'],
  };
}

function toBackendDevicePayload(device: BluetoothDevice): Record<string, unknown> {
  return {
    deviceId: device.id,
    deviceIdentifier: device.id,
    name: device.name,
    type: device.type,
    discoverySource: device.discoverySource,
    address: device.address,
    rssi: device.rssi,
    connectionStatus: device.connectionStatus,
    gattConnected: device.gattConnected,
    services: device.services.map(service => ({ uuid: service.uuid, name: service.name })),
    trustScore: device.trustScore,
    riskLevel: device.riskLevel,
    trusted: device.trusted,
    blocked: Boolean(device.blocked),
    isKnown: device.isKnown,
    manufacturer: device.manufacturer,
    connectionHealth: device.connectionHealth,
  };
}

async function syncDeviceToBackend(device: BluetoothDevice): Promise<void> {
  if (!hasOwnerSessionToken()) return;
  try {
    await api.devices.upsert(toBackendDevicePayload(device));
    await api.devices.assess(device.id);
    recordWorkflowEvent({
      type: 'device',
      message: `${device.name} was saved to the owner backend and assessed by the development classifier.`,
      severity: 'info',
      simulated: device.discoverySource === 'SIMULATED',
      deviceId: device.id,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Protected API request failed.';
    console.warn('Device remains available locally; backend sync did not complete.', error);
    recordWorkflowEvent({
      type: 'device',
      message: `${device.name} remains available locally; backend sync failed: ${detail}`,
      severity: 'warning',
      simulated: device.discoverySource === 'SIMULATED',
      deviceId: device.id,
    });
  }
}

export function deviceReducer(state: DeviceState, action: Action): DeviceState {
  switch (action.type) {
    case 'SET_DEVICES':
      return {
        ...state,
        devices: Array.from(
          new Map([...action.payload.map(applySecurityPolicy), ...state.devices].map(device => [device.id, device])).values(),
        ),
      };
    case 'MERGE_REMOTE_DEVICES': {
      // Cloud records win on duplicate IDs; local-only devices are retained.
      return {
        ...state,
        devices: Array.from(
          new Map([...state.devices.map(applySecurityPolicy), ...action.payload.map(applySecurityPolicy)]
            .map(device => [device.id, device])).values(),
        ),
      };
    }
    case 'ADD_DEVICE': {
      const exists = state.devices.some((d) => d.id === action.payload.id);
      if (exists) return state;
      return { ...state, devices: [...state.devices, applySecurityPolicy(action.payload)] };
    }
    case 'UPDATE_DEVICE':
      return {
        ...state,
        devices: state.devices.map((d) =>
          d.id === action.payload.id ? applySecurityPolicy(action.payload) : d,
        ),
      };
    case 'MARK_DISCONNECTED':
      return {
        ...state,
        devices: state.devices.map(device => device.id === action.payload
          ? {
              ...device,
              connectionStatus: 'disconnected',
              gattConnected: false,
              connectionHealth: 'UNSTABLE',
            }
          : device),
      };
    case 'REMOVE_DEVICE':
      return { ...state, devices: state.devices.filter((d) => d.id !== action.payload) };
    case 'SET_SCAN_STATE':
      return { ...state, scan: { ...state.scan, ...action.payload } };
    case 'TOGGLE_SIMULATION':
      return { ...state, simulationMode: action.payload };
    case 'SET_FILTER':
      return { ...state, filter: action.payload };
    case 'SET_SORT':
      return { ...state, sort: action.payload };
    case 'SET_SEARCH':
      return { ...state, search: action.payload };
    case 'MARK_TRUSTED': {
      return updateDevice(state, action.payload, device => applySecurityActionToDevice(device, 'TRUST') ?? device);
    }
    case 'MARK_UNKNOWN': {
      return updateDevice(state, action.payload, device => applySecurityActionToDevice(device, 'MARK_UNKNOWN') ?? device);
    }
    case 'BLOCK_DEVICE': {
      return updateDevice(state, action.payload, device => applySecurityActionToDevice(device, 'BLOCK') ?? device);
    }
    case 'UNBLOCK_DEVICE': {
      return updateDevice(state, action.payload, device => applySecurityActionToDevice(device, 'UNBLOCK') ?? device);
    }
    case 'FORGET_DEVICE':
      return { ...state, devices: state.devices.filter((d) => d.id !== action.payload) };
    default:
      return state;
  }
}

function updateDevice(
  state: DeviceState,
  deviceId: string,
  update: (device: BluetoothDevice) => BluetoothDevice,
): DeviceState {
  const index = state.devices.findIndex(device => device.id === deviceId);
  if (index === -1) return state;
  const devices = [...state.devices];
  devices[index] = update(devices[index]);
  return { ...state, devices };
}

const initialState: DeviceState = {
  devices: [],
  scan: { state: 'idle', elapsedMs: 0, devicesFound: 0 },
  simulationMode: false,
  filter: 'all',
  sort: 'trust',
  search: '',
};

const DeviceContext = createContext<{
  state: DeviceState;
  dispatch: React.Dispatch<Action>;
  scanDevices: () => Promise<void>;
  addMockDevices: () => void;
}>({} as any);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(deviceReducer, initialState);
  const { ownerToken } = useBackendSession();

  // Load local observations; storage errors leave the current session usable.
  useEffect(() => {
    let cancelled = false;
    localDatabase.listDevices()
      .then((devices) => {
        if (!cancelled) dispatch({ type: 'SET_DEVICES', payload: devices });
      })
      .catch((error: unknown) => {
        console.warn('Could not load local devices; continuing for this session.', error);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ownerToken.trim()) return;
    let cancelled = false;
    api.devices.list()
      .then(records => {
        if (!cancelled) dispatch({
          type: 'MERGE_REMOTE_DEVICES',
          payload: records.map(toLocalDevice),
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn('Could not load cloud devices; browser-local records remain available.', error);
      });
    return () => { cancelled = true; };
  }, [ownerToken]);

  useEffect(() => {
    if (state.devices.length === 0) return;
    void localDatabase.saveDevices(state.devices).catch((error: unknown) => {
      console.warn('Device state could not be persisted locally; the in-memory session remains active.', error);
    });
  }, [state.devices]);

  const scanDevices = async () => {
    const scanIsSimulated = state.simulationMode;
    recordWorkflowEvent({
      type: 'scan',
      message: scanIsSimulated ? 'Simulation scan started.' : 'Bluetooth device selection requested through the browser picker.',
      severity: 'info',
      simulated: scanIsSimulated,
    });
    dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'scanning', elapsedMs: 0, devicesFound: 0, error: undefined } });
    const start = Date.now();
    let interval: ReturnType<typeof setInterval>;

    const updateElapsed = () => {
      dispatch({ type: 'SET_SCAN_STATE', payload: { elapsedMs: Date.now() - start } });
    };
    interval = setInterval(updateElapsed, 200);

    try {
      if (state.simulationMode) {
        const newDevices = generateSimulatedDevices(6);
        newDevices.forEach((d) => {
          dispatch({ type: 'ADD_DEVICE', payload: d });
          void syncDeviceToBackend(d);
          const assessment = assessDeviceSecurity(d);
          if (assessment.finalThreatScore >= 20) {
            recordWorkflowEvent({
              type: 'alert',
              message: `Simulated development assessment for ${d.name}: ${assessment.finalSeverity} (${assessment.finalThreatScore}/100).`,
              severity: assessment.finalSeverity === 'critical' || assessment.finalSeverity === 'high' ? 'error' : 'warning',
              simulated: true,
              deviceId: d.id,
            });
          }
        });
        void localDatabase.saveDevices(newDevices).catch((error: unknown) => {
          console.warn('Simulated devices are available for this session but were not saved locally.', error);
        });
        dispatch({
          type: 'SET_SCAN_STATE',
          payload: { state: 'complete', devicesFound: newDevices.length },
        });
        recordWorkflowEvent({
          type: 'scan',
          message: `Simulation scan completed: ${newDevices.length} demo devices were prepared for local assessment.`,
          severity: 'info',
          simulated: true,
        });
      } else {
        const support = await isBluetoothSupported();
        if (!support.supported) {
          dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'unsupported', error: support.reason } });
          recordWorkflowEvent({ type: 'scan', message: `Bluetooth is unavailable: ${support.reason ?? 'unsupported browser'}.`, severity: 'warning', simulated: false });
          return;
        }
        const request = await requestBluetoothDevice();
        if (!request.ok) {
          dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'permission-denied', error: request.error } });
          recordWorkflowEvent({ type: 'scan', message: `Bluetooth selection was not completed: ${request.error}.`, severity: 'warning', simulated: false });
          return;
        }
        const conn = await connectAndDiscover(request.device);
        if (!conn.ok) {
          dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'error', error: conn.error } });
          recordWorkflowEvent({ type: 'connect', message: `Could not inspect the selected Bluetooth device: ${conn.error}.`, severity: 'warning', simulated: false });
          return;
        }
        const std = await readStandardCharacteristics(conn.gatt);

        // Build real device object
        const dev: BluetoothDevice = {
          id: request.device.id,
          name: request.device.name ?? `Device ${request.device.id.slice(-4)}`,
          type: 'unknown',
          address: undefined,
          rssi: undefined,
          trusted: false,
          trustScore: 0,
          riskLevel: 'high',
          connectionStatus: conn.ok ? 'connected' : 'unknown',
          firstSeen: new Date(),
          lastSeen: new Date(),
          isKnown: false,
          manufacturer: std.manufacturer,
          services: conn.services,
          discoverySource: 'REAL',
          gattConnected: conn.ok,
          connectionHealth: conn.ok ? 'GOOD' : 'UNSTABLE',
        };

        // Local assessment
        const assessment = assessDeviceSecurity(dev);
        dev.trustScore = assessment.trustScore;
        dev.riskLevel = assessment.trustRiskLevel;
        const guardedDevice = applySecurityPolicy(dev);
        request.device.addEventListener?.('gattserverdisconnected', () => {
          dispatch({ type: 'MARK_DISCONNECTED', payload: guardedDevice.id });
        }, { once: true });

        dispatch({ type: 'ADD_DEVICE', payload: guardedDevice });
        dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'complete', devicesFound: 1 } });
        recordWorkflowEvent({
          type: 'connect',
          message: `Selected ${dev.name}; inspected ${conn.services.length} available GATT service(s).`,
          severity: 'info',
          simulated: false,
          deviceId: dev.id,
        });
        recordWorkflowEvent({
          type: 'alert',
          message: `Development assessment for ${dev.name}: ${assessment.finalSeverity} (${assessment.finalThreatScore}/100).`,
          severity: assessment.finalSeverity === 'critical' || assessment.finalSeverity === 'high' ? 'error' : assessment.finalSeverity === 'medium' ? 'warning' : 'info',
          simulated: false,
          deviceId: dev.id,
        });

        void syncDeviceToBackend(guardedDevice);
        void localDatabase.saveDevice(guardedDevice).catch((error: unknown) => {
          console.warn('Device is available for this session but was not saved locally.', error);
        });
      }
    } catch (e: any) {
      const message = e?.message ?? 'Scan failed';
      dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'error', error: message } });
      recordWorkflowEvent({ type: 'scan', message: `Bluetooth workflow failed: ${message}.`, severity: 'warning', simulated: scanIsSimulated });
    } finally {
      clearInterval(interval);
    }
  };

  const addMockDevices = () => {
    const mocks = generateSimulatedDevices(4);
    mocks.forEach((d) => {
      dispatch({ type: 'ADD_DEVICE', payload: d });
      void syncDeviceToBackend(d);
    });
    void localDatabase.saveDevices(mocks).catch((error: unknown) => {
      console.warn('Simulated devices are available for this session but were not saved locally.', error);
    });
  };

  return (
    <DeviceContext.Provider value={{ state, dispatch, scanDevices, addMockDevices }}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useBluetoothDevices() {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useBluetoothDevices must be used within DeviceProvider');
  return ctx;
}