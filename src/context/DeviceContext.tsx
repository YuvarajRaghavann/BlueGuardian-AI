import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { BluetoothDevice, BluetoothScanState, DeviceType } from '../types';
import { generateSimulatedDevices } from '../services/bluetoothSimulator';
import { isBluetoothSupported, requestBluetoothDevice, connectAndDiscover, readStandardCharacteristics, normalizeBluetoothName, resolveBluetoothDisplayName, getPreviouslyGrantedBluetoothDevices, watchBluetoothAdvertisements, type BluetoothPickerMode, type BluetoothDeviceInfo } from '../services/bluetoothService';
import { assessDeviceSecurity } from '../utils/securityAssessment';
import { evaluateSecureBluetoothProfile, needsManualApproval } from '../utils/connectionPolicy';
import { localDatabase } from '../services/localDatabase';
import { applySecurityActionToDevice } from '../services/securityActionService';
import { api } from '../services/api';
import { useOwnerToken } from '../services/ownerSession';
import { isNativeAndroidApp, scanNativeAndroidBle, scanNativeAndroidClassic, listNativeAndroidPairedDevices, type NativeClassicObservation } from '../services/nativeBluetoothService';

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
  | { type: 'MERGE_SERVER_DEVICES'; payload: BluetoothDevice[] }
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
  | { type: 'FORGET_DEVICE'; payload: string }
  | { type: 'CLEAR_SIMULATED_DEVICES' };

function applySecurityPolicy(device: BluetoothDevice): BluetoothDevice {
  const normalizedDevice: BluetoothDevice = {
    ...device,
    // Repair legacy placeholder names in IndexedDB/API records whenever they are loaded.
    name: resolveBluetoothDisplayName(device.name, undefined, device.manufacturer),
  };
  const profile = evaluateSecureBluetoothProfile(normalizedDevice, {
    rssi: normalizedDevice.rssi,
    fileName: normalizedDevice.name,
    deviceType: normalizedDevice.type,
  });

  if (profile.connectionDecision === 'BLOCK') {
    return { ...normalizedDevice, blocked: true, approvalRequired: false, riskLevel: 'high', trustScore: Math.min(device.trustScore, 25) };
  }

  if (profile.connectionDecision === 'REQUIRE_APPROVAL') {
    return {
      ...normalizedDevice,
      trusted: false,
      isKnown: false,
      approvalRequired: true,
      riskLevel: 'medium',
      trustScore: Math.min(device.trustScore, 45),
    };
  }

  if (profile.wearableMode === 'RESTRICTED') {
    return {
      ...normalizedDevice,
      approvalRequired: needsManualApproval(normalizedDevice),
      riskLevel: 'medium',
      trustScore: Math.min(device.trustScore, 55),
    };
  }

  return { ...normalizedDevice, approvalRequired: needsManualApproval(normalizedDevice) };
}

export function deviceReducer(state: DeviceState, action: Action): DeviceState {
  switch (action.type) {
    case 'SET_DEVICES':
      return {
        ...state,
        devices: Array.from(
          new Map([
            ...action.payload.filter(device => device.discoverySource !== 'SIMULATED').map(applySecurityPolicy),
            ...state.devices,
          ].map(device => [device.id, device])).values(),
        ),
      };
    case 'MERGE_SERVER_DEVICES': {
      // Backend settings win for matching IDs, but a generic server placeholder must
      // not erase a meaningful name already learned from the local GATT session.
      const merged = new Map(state.devices.map(device => [device.id, applySecurityPolicy(device)]));
      for (const rawServerDevice of action.payload.filter(device => device.discoverySource !== 'SIMULATED')) {
        const serverDevice = applySecurityPolicy(rawServerDevice);
        const localDevice = merged.get(serverDevice.id);
        const serverName = normalizeBluetoothName(serverDevice.name);
        const localName = localDevice ? normalizeBluetoothName(localDevice.name) : undefined;
        merged.set(serverDevice.id, localDevice && !serverName && localName
          ? { ...serverDevice, name: localDevice.name }
          : serverDevice);
      }
      return { ...state, devices: Array.from(merged.values()) };
    }
    case 'ADD_DEVICE': {
      const incoming = applySecurityPolicy(action.payload);
      const existing = state.devices.find((device) => device.id === incoming.id);
      if (!existing) return { ...state, devices: [...state.devices, incoming] };

      // Keep owner decisions/trust scores intact for an already-known ID while
      // refreshing the name and facts that were unavailable in its earlier scan.
      const existingName = normalizeBluetoothName(existing.name);
      const incomingName = normalizeBluetoothName(incoming.name);
      const shouldUpgradeName = !existingName && Boolean(incomingName);
      const shouldRefreshConnection = incoming.discoverySource === 'REAL';
      if (!shouldUpgradeName && !shouldRefreshConnection) return state;

      const refreshed = applySecurityPolicy({
        ...existing,
        ...(shouldUpgradeName ? { name: incoming.name } : {}),
        ...(existing.type === 'unknown' && incoming.type !== 'unknown' ? { type: incoming.type } : {}),
        manufacturer: existing.manufacturer ?? incoming.manufacturer,
        services: incoming.services.length > 0 ? incoming.services : existing.services,
        discoveryTransport: incoming.discoveryTransport ?? existing.discoveryTransport,
        paired: incoming.paired ?? existing.paired,
        rssi: typeof incoming.rssi === 'number' ? incoming.rssi : existing.rssi,
        lastSeen: incoming.lastSeen,
        ...(shouldRefreshConnection ? {
          connectionStatus: incoming.connectionStatus,
          gattConnected: incoming.gattConnected,
          connectionHealth: incoming.connectionHealth,
        } : {}),
      });
      return {
        ...state,
        devices: state.devices.map((device) => device.id === incoming.id ? refreshed : device),
      };
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
    case 'CLEAR_SIMULATED_DEVICES':
      return { ...state, devices: state.devices.filter(device => device.discoverySource !== 'SIMULATED') };
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
  /** Uses the selected default mode for backwards compatibility. */
  scanDevices: () => Promise<void>;
  /** Explicitly generates demo data and never opens the Bluetooth picker. */
  scanSimulatedDevices: () => Promise<void>;
  /** Explicitly scans a real Bluetooth device and may open the browser picker. */
  scanRealDevices: (pickerMode?: BluetoothPickerMode) => Promise<void>;
  /** Runs native Android classic discovery as a separate foreground scan. */
  scanClassicDevices: () => Promise<void>;
  /** Loads system-bonded devices separately; this is not a live scan or connection. */
  loadPairedDevices: () => Promise<number>;
  addMockDevices: () => void;
  /** Remove only in-memory simulated/demo records; physical observations are untouched. */
  clearSimulatedDevices: () => void;
  /** Listen for advertisements from previously authorized BLE devices only. */
  startWatchingPermittedBleDevices: () => Promise<{ ok: boolean; message: string; watchedCount: number }>;
  stopWatchingPermittedBleDevices: () => void;
  backendReady: boolean;
}>({} as any);

/** Conservative display classification from the visible name/manufacturer.
 * Web Bluetooth does not offer a reliable generic device type, so unknown is
 * retained whenever there is not enough evidence to make a useful guess.
 */
function inferDeviceType(
  name: string,
  manufacturer?: string,
  services: Array<{ uuid: string; name?: string }> = [],
): DeviceType {
  const text = [name, manufacturer ?? '', ...services.map(service => service.name ?? '')]
    .join(' ')
    .toLowerCase();

  if (/\b(buds?|earbuds?|earphones?|airpods?|galaxy buds|pixel buds|nothing ear|oneplus nord buds)\b/.test(text)) {
    return 'earbuds';
  }
  if (/\b(headphone|headphones|headset|headsets|over[- ]?ear)\b/.test(text)) {
    return 'headphones';
  }
  if (/\b(smartwatch|smart watch|apple watch|galaxy watch|pixel watch|fitbit|garmin watch|watch)\b/.test(text)) {
    return 'smartwatch';
  }
  if (/\b(laptop|notebook|macbook|thinkpad|chromebook|surface pro)\b/.test(text)) {
    return 'laptop';
  }
  if (/\b(iphone|android phone|smartphone|galaxy s\d+|galaxy note|pixel \d+|redmi|oneplus|oppo|vivo|realme|motorola|nothing phone|phone)\b/.test(text)) {
    return 'smartphone';
  }
  if (/\b(esp32|esp8266|smart bulb|smart plug|sensor|iot|thermostat|smart lock|raspberry pi)\b/.test(text)) {
    return 'iot';
  }

  return 'unknown';
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(deviceReducer, initialState);
  const advertisementWatchRef = React.useRef<(() => void) | null>(null);
  const authorizedDeviceRefs = React.useRef<Map<string, BluetoothDeviceInfo>>(new Map());
  const lastAdvertisementUiUpdateRef = React.useRef<Map<string, number>>(new Map());
  const ownerToken = useOwnerToken();
  const [registryReadyToken, setRegistryReadyToken] = React.useState<string | null>(null);
  const backendReady = Boolean(ownerToken && registryReadyToken === ownerToken);

  useEffect(() => () => {
    advertisementWatchRef.current?.();
    advertisementWatchRef.current = null;
  }, []);

  // Load only physical device observations. Older versions persisted simulated
  // examples, making them look like discoveries after reload; migrate those out
  // of the device store without touching genuine records, actions, threats or settings.
  useEffect(() => {
    let cancelled = false;
    const loadPhysicalDevices = async () => {
      try {
        const removed = await localDatabase.removeSimulatedDevices();
        if (removed > 0) {
          console.info(`[BlueGuardian][BLE] Removed ${removed} old simulated device record(s) from local device storage.`);
        }
      } catch (error: unknown) {
        console.warn('[BlueGuardian][BLE] Legacy demo-record cleanup could not complete; records will still be filtered from the device list.', error);
      }

      try {
        const devices = await localDatabase.listDevices();
        if (!cancelled) dispatch({
          type: 'SET_DEVICES',
          payload: devices.filter(device => device.discoverySource !== 'SIMULATED'),
        });
      } catch (error: unknown) {
        console.warn('Could not load local devices; continuing for this session.', error);
      }
    };
    void loadPhysicalDevices();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const physicalDevices = state.devices.filter(device => device.discoverySource !== 'SIMULATED');
    if (physicalDevices.length === 0) return;
    void localDatabase.saveDevices(physicalDevices).catch((error: unknown) => {
      console.warn('Physical device state could not be persisted locally; the in-memory session remains active.', error);
    });
  }, [state.devices]);

  // Load the owner's MongoDB device registry when an owner token is configured.
  // A backend failure is non-fatal: existing browser-local mode remains usable.
  useEffect(() => {
    setRegistryReadyToken(null);
    if (!ownerToken) return;
    let cancelled = false;
    api.listDevices(ownerToken)
      .then(devices => {
        if (cancelled) return;
        dispatch({ type: 'MERGE_SERVER_DEVICES', payload: devices });
        // Do not push local cached records until the server records have been merged;
        // this avoids overwriting a saved owner decision during initial synchronization.
        setRegistryReadyToken(ownerToken);
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn('Backend device registry is unavailable; using browser-local records without remote writes.', error);
      });
    return () => { cancelled = true; };
  }, [ownerToken]);

  /**
   * Run one scan mode explicitly. Keeping simulation and real scans separate
   * prevents a demo workflow from accidentally opening the browser Bluetooth
   * picker. All existing persistence and security-assessment behavior is kept.
   */
  const runScan = async (mode: 'simulated' | 'real', pickerMode: BluetoothPickerMode = 'all'): Promise<void> => {
    dispatch({
      type: 'SET_SCAN_STATE',
      payload: {
        state: 'scanning',
        elapsedMs: 0,
        devicesFound: 0,
        source: mode === 'simulated' ? 'SIMULATED' : 'REAL',
        transport: mode === 'simulated' ? undefined : (isNativeAndroidApp() ? 'ANDROID_BLE_SCAN' : 'WEB_BLE_SELECTION'),
        error: undefined,
      },
    });

    const start = Date.now();
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      dispatch({ type: 'SET_SCAN_STATE', payload: { elapsedMs: Date.now() - start } });
    }, 200);
    let diagnosticStage = mode === 'simulated' ? 'simulated sample generation' : 'browser BLE support check';

    try {
      if (mode === 'simulated') {
        // This code path deliberately makes no Web Bluetooth calls.
        const newDevices = generateSimulatedDevices(6);
        newDevices.forEach(device => dispatch({ type: 'ADD_DEVICE', payload: device }));
        // Demo records stay in memory only and are never persisted as physical hardware.
        console.info('[BlueGuardian][BLE] Generated simulated records; no hardware scan was performed.', {
          simulatedCount: newDevices.length,
        });

        dispatch({
          type: 'SET_SCAN_STATE',
          payload: { state: 'complete', devicesFound: newDevices.length, error: undefined },
        });
        return;
      }

      if (isNativeAndroidApp()) {
        diagnosticStage = 'Android native BLE discovery';
        console.info('[BlueGuardian][BLE] Using Android BluetoothLeScanner for a bounded foreground scan.');

        const nativeResult = await scanNativeAndroidBle((observation) => {
          const physicalId = String(observation.address || observation.id || '').trim();
          if (!physicalId) return;

          const observedAt = new Date(typeof observation.observedAt === 'number' ? observation.observedAt : Date.now());
          const deviceName = resolveBluetoothDisplayName(observation.name);
          const services: BluetoothDevice['services'] = (observation.serviceUuids ?? []).map((uuid) => ({
            uuid,
            characteristics: [],
          }));

          const device: BluetoothDevice = {
            id: 'android-ble:' + physicalId.toLowerCase(),
            name: deviceName,
            type: inferDeviceType(deviceName, undefined, services),
            address: observation.address,
            rssi: typeof observation.rssi === 'number' ? observation.rssi : undefined,
            trusted: false,
            trustScore: 0,
            riskLevel: 'high',
            connectionStatus: 'unknown',
            firstSeen: observedAt,
            lastSeen: observedAt,
            isKnown: false,
            services,
            discoverySource: 'REAL',
            gattConnected: false,
            connectionHealth: 'UNAVAILABLE',
          };

          const assessment = assessDeviceSecurity(device);
          device.trustScore = assessment.trustScore;
          device.riskLevel = assessment.trustRiskLevel;
          const guardedDevice = applySecurityPolicy(device);
          dispatch({ type: 'ADD_DEVICE', payload: guardedDevice });
          void localDatabase.saveDevice(guardedDevice).catch((error: unknown) => {
            console.warn('Android BLE observation was received but could not be saved locally.', error);
          });
        }, 12000);

        if (nativeResult.ok === false) {
          const permissionFailure = /permission|denied|not allowed/i.test(nativeResult.error);
          dispatch({
            type: 'SET_SCAN_STATE',
            payload: {
              state: permissionFailure ? 'permission-denied' : 'error',
              source: 'REAL',
              transport: 'ANDROID_BLE_SCAN',
              error: nativeResult.error,
            },
          });
          return;
        }

        dispatch({
          type: 'SET_SCAN_STATE',
          payload: {
            state: 'complete',
            source: 'REAL',
            transport: 'ANDROID_BLE_SCAN',
            devicesFound: nativeResult.devicesFound,
            error: nativeResult.message,
          },
        });
        return;
      }

      diagnosticStage = 'browser BLE support check';
      console.info('[BlueGuardian][BLE] Starting a real hardware selection. Simulation mode is bypassed.', { pickerMode });
      const support = await isBluetoothSupported();
      if (!support.supported) {
        console.warn('[BlueGuardian][BLE] Hardware selection stopped at browser support check.', support.reason);
        dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'unsupported', error: support.reason } });
        return;
      }

      diagnosticStage = 'Chrome BLE device chooser';
      const request = await requestBluetoothDevice(pickerMode);
      if (request.ok === false) {
        // The browser commonly reports an intentionally closed picker as a
        // cancelled selection. Keep the legacy state but make the UI message
        // distinguish cancellation from an actual permission denial.
        const isPermissionFailure = /permission|denied|notallowed/i.test(request.error);
        dispatch({
          type: 'SET_SCAN_STATE',
          payload: { state: isPermissionFailure ? 'permission-denied' : 'error', error: request.error },
        });
        return;
      }

      // Keep the native handle in memory for optional advertisement watching after
      // the user explicitly authorizes this device. Never put it in IndexedDB/API data.
      authorizedDeviceRefs.current.set(request.device.id, request.device);
      console.info('[BlueGuardian][BLE] User selected a physical BLE peripheral.', {
        nameReportedByChooser: request.device.name ?? '(name not advertised)',
        gattReferenceAvailable: Boolean(request.device.gatt),
      });

      // Keep the selected observation even if GATT connection/service access fails.
      // A selectable BLE advertisement is still useful information to the owner.
      diagnosticStage = 'GATT connection and service discovery';
      const conn = await connectAndDiscover(request.device);
      const std = conn.ok
        ? await readStandardCharacteristics(conn.gatt)
        : {};
      const services = conn.ok ? conn.services : [];
      const deviceName = resolveBluetoothDisplayName(
        request.device.name,
        std.deviceName,
        std.manufacturer,
      );
      const inferredType = inferDeviceType(deviceName, std.manufacturer, services);
      const connected = conn.ok;
      console.info('[BlueGuardian][BLE] GATT inspection stage completed.', {
        gattConnected: connected,
        serviceCount: services.length,
        warningCount: conn.ok ? (conn.warnings?.length ?? 0) : 1,
        failureReason: conn.ok === false ? conn.error : undefined,
        manufacturerAvailable: Boolean(std.manufacturer),
        gattNameAvailable: Boolean(std.deviceName),
      });

      // Web Bluetooth cannot expose a universal device class, hardware address,
      // or RSSI for every peripheral. Leave unavailable values unset rather than fabricating them.
      const dev: BluetoothDevice = {
        id: request.device.id,
        name: deviceName,
        type: inferredType,
        address: undefined,
        rssi: undefined,
        trusted: false,
        trustScore: 0,
        riskLevel: 'high',
        connectionStatus: connected ? 'connected' : 'unknown',
        firstSeen: new Date(),
        lastSeen: new Date(),
        isKnown: false,
        manufacturer: std.manufacturer,
        services,
        discoverySource: 'REAL',
        gattConnected: connected,
        connectionHealth: connected ? 'GOOD' : 'UNAVAILABLE',
      };

      // Preserve the existing local security-assessment flow.
      diagnosticStage = 'security assessment and result registration';
      const assessment = assessDeviceSecurity(dev);
      dev.trustScore = assessment.trustScore;
      dev.riskLevel = assessment.trustRiskLevel;
      const guardedDevice = applySecurityPolicy(dev);

      if (connected) {
        request.device.addEventListener?.('gattserverdisconnected', () => {
          dispatch({ type: 'MARK_DISCONNECTED', payload: guardedDevice.id });
        }, { once: true });
      }

      dispatch({ type: 'ADD_DEVICE', payload: guardedDevice });
      dispatch({
        type: 'SET_SCAN_STATE',
        payload: {
          state: 'complete',
          devicesFound: 1,
          error: conn.ok === false
            ? `The real device was selected but GATT connection failed: ${conn.error}`
            : conn.warnings?.length
              ? conn.warnings.join(' ')
              : undefined,
        },
      });

      void localDatabase.saveDevice(guardedDevice).catch((error: unknown) => {
        console.warn('Device is available for this session but was not saved locally.', error);
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Scan failed';
      console.error('[BlueGuardian][BLE] Scan pipeline failed.', { stage: diagnosticStage, message }, error);
      dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'error', error: `${diagnosticStage}: ${message}` } });
    } finally {
      clearInterval(interval);
    }
  };


  const registerClassicObservation = (observation: NativeClassicObservation, pairedOverride?: boolean) => {
    const address = String(observation.address || observation.id || '').trim();
    if (!address) return;

    const observedAt = new Date(
      typeof observation.observedAt === 'number' ? observation.observedAt : Date.now(),
    );
    const deviceName = resolveBluetoothDisplayName(observation.name);
    const paired = pairedOverride ?? Boolean(observation.paired);
    const device: BluetoothDevice = {
      // A transport-specific stable key keeps Phase 4 classic records separate
      // from BLE observations until the explicit Phase 5 combined/dedup pass.
      id: 'android-classic:' + address.toLowerCase(),
      name: deviceName,
      type: inferDeviceType(deviceName),
      address,
      rssi: typeof observation.rssi === 'number' ? observation.rssi : undefined,
      trusted: false,
      trustScore: 0,
      riskLevel: 'high',
      // Pairing is not a reliable indication of live connection state.
      connectionStatus: 'unknown',
      firstSeen: observedAt,
      lastSeen: observedAt,
      // Android pairing must not silently grant BlueGuardian trust.
      isKnown: false,
      services: [],
      discoverySource: 'REAL',
      discoveryTransport: observation.transport,
      paired,
      gattConnected: false,
      connectionHealth: 'UNAVAILABLE',
    };

    const assessment = assessDeviceSecurity(device);
    device.trustScore = assessment.trustScore;
    device.riskLevel = assessment.trustRiskLevel;
    const guardedDevice = applySecurityPolicy(device);
    dispatch({ type: 'ADD_DEVICE', payload: guardedDevice });
    void localDatabase.saveDevice(guardedDevice).catch((error: unknown) => {
      console.warn('Classic Bluetooth observation could not be saved locally.', error);
    });
  };

  const scanClassicDevices = async (): Promise<void> => {
    if (!isNativeAndroidApp()) {
      dispatch({
        type: 'SET_SCAN_STATE',
        payload: { state: 'unsupported', source: 'REAL', transport: 'ANDROID_CLASSIC_SCAN', error: 'Classic Bluetooth discovery is only available inside the BlueGuardian Android APK.' },
      });
      return;
    }

    dispatch({
      type: 'SET_SCAN_STATE',
      payload: { state: 'scanning', elapsedMs: 0, devicesFound: 0, source: 'REAL', transport: 'ANDROID_CLASSIC_SCAN', error: undefined },
    });
    const startedAt = Date.now();
    const interval = setInterval(() => {
      dispatch({ type: 'SET_SCAN_STATE', payload: { elapsedMs: Date.now() - startedAt } });
    }, 200);
    let diagnosticStage = 'Android classic Bluetooth discovery';

    try {
      const result = await scanNativeAndroidClassic((observation) => {
        registerClassicObservation(observation);
      }, 12000);

      if (!result.ok) {
        const permissionFailure = /permission|denied|not allowed/i.test(result.error);
        dispatch({
          type: 'SET_SCAN_STATE',
          payload: {
            state: permissionFailure ? 'permission-denied' : 'error',
            source: 'REAL',
            transport: 'ANDROID_CLASSIC_SCAN',
            error: result.error,
          },
        });
        return;
      }

      dispatch({
        type: 'SET_SCAN_STATE',
        payload: {
          state: 'complete',
          source: 'REAL',
          transport: 'ANDROID_CLASSIC_SCAN',
          devicesFound: result.devicesFound,
          error: result.message,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Classic Bluetooth discovery failed.';
      console.error('[BlueGuardian][Classic] Discovery pipeline failed.', { stage: diagnosticStage, message }, error);
      dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'error', source: 'REAL', transport: 'ANDROID_CLASSIC_SCAN', error: message } });
    } finally {
      clearInterval(interval);
    }
  };

  const loadPairedDevices = async (): Promise<number> => {
    if (!isNativeAndroidApp()) {
      dispatch({
        type: 'SET_SCAN_STATE',
        payload: { state: 'unsupported', source: 'REAL', transport: 'ANDROID_PAIRED_DEVICES', error: 'Paired-device listing is only available inside the BlueGuardian Android APK.' },
      });
      return 0;
    }

    dispatch({
      type: 'SET_SCAN_STATE',
      payload: { state: 'idle', elapsedMs: 0, devicesFound: 0, source: 'REAL', transport: 'ANDROID_PAIRED_DEVICES', error: undefined },
    });
    try {
      const pairedDevices = await listNativeAndroidPairedDevices();
      pairedDevices.forEach((observation) => registerClassicObservation(observation, true));
      dispatch({
        type: 'SET_SCAN_STATE',
        payload: {
          state: 'complete',
          source: 'REAL',
          transport: 'ANDROID_PAIRED_DEVICES',
          devicesFound: pairedDevices.length,
          error: pairedDevices.length === 0
            ? 'Android reports no paired classic Bluetooth devices. Pair a device in Android Settings first.'
            : undefined,
        },
      });
      return pairedDevices.length;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not load paired Bluetooth devices.';
      const permissionFailure = /permission|denied|not allowed/i.test(message);
      dispatch({
        type: 'SET_SCAN_STATE',
        payload: {
          state: permissionFailure ? 'permission-denied' : 'error',
          source: 'REAL',
          transport: 'ANDROID_PAIRED_DEVICES',
          error: message,
        },
      });
      return 0;
    }
  };

  // Backwards-compatible entry point: existing components still follow the
  // Simulation Mode toggle. New controls can use the explicit methods below.
  const scanDevices = (): Promise<void> =>
    runScan(state.simulationMode ? 'simulated' : 'real');

  const scanSimulatedDevices = (): Promise<void> => runScan('simulated');
  const scanRealDevices = (pickerMode: BluetoothPickerMode = 'all'): Promise<void> => runScan('real', pickerMode);

  const startWatchingPermittedBleDevices = async (): Promise<{ ok: boolean; message: string; watchedCount: number }> => {
    // Avoid duplicate advertisement listeners when the control is clicked repeatedly.
    if (advertisementWatchRef.current) {
      return { ok: true, message: 'Advertisement watching is already active.', watchedCount: authorizedDeviceRefs.current.size };
    }

    const granted = await getPreviouslyGrantedBluetoothDevices();
    if (granted.ok === false) {
      return { ok: false, message: granted.error, watchedCount: 0 };
    }

    for (const device of granted.devices) authorizedDeviceRefs.current.set(device.id, device);
    const authorized = Array.from(authorizedDeviceRefs.current.values());
    if (authorized.length === 0) {
      return {
        ok: false,
        message: 'No BLE devices have been authorized for this website yet. Click Find all BLE devices and select a device first.',
        watchedCount: 0,
      };
    }

    const result = await watchBluetoothAdvertisements(authorized, (observation) => {
      // Advertisement watching is a progressive enhancement. Record only actual
      // packets observed now; do not fabricate presence or RSSI for silent devices.
      const nowMs = observation.observedAt.getTime();
      const lastUpdate = lastAdvertisementUiUpdateRef.current.get(observation.id) ?? 0;
      if (nowMs - lastUpdate < 1200) return;
      lastAdvertisementUiUpdateRef.current.set(observation.id, nowMs);

      const displayName = resolveBluetoothDisplayName(observation.name);
      const services = observation.uuids.map(uuid => ({ uuid, characteristics: [] }));
      const device: BluetoothDevice = {
        id: observation.id,
        name: displayName,
        type: inferDeviceType(displayName, undefined, services),
        address: undefined,
        rssi: observation.rssi,
        trusted: false,
        trustScore: 0,
        riskLevel: 'high',
        connectionStatus: 'unknown',
        firstSeen: observation.observedAt,
        lastSeen: observation.observedAt,
        isKnown: false,
        services,
        discoverySource: 'REAL',
        gattConnected: false,
        connectionHealth: 'UNAVAILABLE',
      };
      const assessment = assessDeviceSecurity(device);
      device.trustScore = assessment.trustScore;
      device.riskLevel = assessment.trustRiskLevel;
      dispatch({ type: 'ADD_DEVICE', payload: applySecurityPolicy(device) });
      void localDatabase.saveDevice(applySecurityPolicy(device)).catch((error: unknown) => {
        console.warn('BLE advertisement was observed, but its local record could not be saved.', error);
      });
    });

    if (result.ok === false) {
      return { ok: false, message: result.error, watchedCount: 0 };
    }

    advertisementWatchRef.current = result.stop;
    return {
      ok: true,
      watchedCount: result.watchedCount,
      message: `Watching advertisements from ${result.watchedCount} previously authorized BLE device(s). This does not discover new or unapproved devices.`,
    };
  };

  const stopWatchingPermittedBleDevices = () => {
    advertisementWatchRef.current?.();
    advertisementWatchRef.current = null;
  };

  const addMockDevices = () => {
    const mocks = generateSimulatedDevices(4);
    mocks.forEach((device) => dispatch({ type: 'ADD_DEVICE', payload: device }));
    console.info('[BlueGuardian][BLE] Added simulated sample records to this session only.', { simulatedCount: mocks.length });
  };

  const clearSimulatedDevices = () => {
    dispatch({ type: 'CLEAR_SIMULATED_DEVICES' });
    console.info('[BlueGuardian][BLE] Cleared simulated records from the current session. Real records were not changed.');
  };

  return (
    <DeviceContext.Provider value={{ state, dispatch, scanDevices, scanSimulatedDevices, scanRealDevices, scanClassicDevices, loadPairedDevices, addMockDevices, clearSimulatedDevices, startWatchingPermittedBleDevices, stopWatchingPermittedBleDevices, backendReady }}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useBluetoothDevices() {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useBluetoothDevices must be used within DeviceProvider');
  return ctx;
}