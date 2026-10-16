import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { BluetoothDevice, BluetoothScanState } from '../types';
import { generateSimulatedDevices } from '../services/bluetoothSimulator';
import { isBluetoothSupported, requestBluetoothDevice, connectAndDiscover, readStandardCharacteristics } from '../services/bluetoothService';
import { assessDeviceSecurity } from '../utils/securityAssessment';
import { evaluateSecureBluetoothProfile, needsManualApproval } from '../utils/connectionPolicy';
import { localDatabase } from '../services/localDatabase';
import { applySecurityActionToDevice } from '../services/securityActionService';

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

export function deviceReducer(state: DeviceState, action: Action): DeviceState {
  switch (action.type) {
    case 'SET_DEVICES':
      return {
        ...state,
        devices: Array.from(
          new Map([...action.payload.map(applySecurityPolicy), ...state.devices].map(device => [device.id, device])).values(),
        ),
      };
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
      return updateDevice(state, action.payload, device => {
        const updated = applySecurityActionToDevice(device, 'TRUST') ?? device;
        // Do not immediately run the newly approved device back through the
        // discovery gate. Future connection attempts still evaluate policy.
        return { ...updated, trusted: true, isKnown: true, blocked: false, approvalRequired: false };
      });
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
    if (state.devices.length === 0) return;
    void localDatabase.saveDevices(state.devices).catch((error: unknown) => {
      console.warn('Device state could not be persisted locally; the in-memory session remains active.', error);
    });
  }, [state.devices]);

  const scanDevices = async () => {
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
        newDevices.forEach((d) => dispatch({ type: 'ADD_DEVICE', payload: d }));
        void localDatabase.saveDevices(newDevices).catch((error: unknown) => {
          console.warn('Simulated devices are available for this session but were not saved locally.', error);
        });
        dispatch({
          type: 'SET_SCAN_STATE',
          payload: { state: 'complete', devicesFound: newDevices.length },
        });
      } else {
        const support = await isBluetoothSupported();
        if (!support.supported) {
          dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'unsupported', error: support.reason } });
          return;
        }
        const request = await requestBluetoothDevice();
        if (!request.ok) {
          dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'permission-denied', error: request.error } });
          return;
        }
        const conn = await connectAndDiscover(request.device);
        if (!conn.ok) {
          dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'error', error: conn.error } });
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

        void localDatabase.saveDevice(guardedDevice).catch((error: unknown) => {
          console.warn('Device is available for this session but was not saved locally.', error);
        });
      }
    } catch (e: any) {
      dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'error', error: e?.message ?? 'Scan failed' } });
    } finally {
      clearInterval(interval);
    }
  };

  const addMockDevices = () => {
    const mocks = generateSimulatedDevices(4);
    mocks.forEach((d) => dispatch({ type: 'ADD_DEVICE', payload: d }));
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