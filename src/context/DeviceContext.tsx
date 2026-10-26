import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { BluetoothDevice, BluetoothScanState, DeviceType, SecurityPolicy } from '../types';
import { generateSimulatedDevices } from '../services/bluetoothSimulator';
import { SIMULATOR_ENABLED } from '../config/buildFlags';
import { isBluetoothSupported, requestBluetoothDevice, connectAndDiscover, readStandardCharacteristics, normalizeBluetoothName, resolveBluetoothDisplayName, getPreviouslyGrantedBluetoothDevices, watchBluetoothAdvertisements, type BluetoothPickerMode, type BluetoothDeviceInfo } from '../services/bluetoothService';
import { assessDeviceSecurity } from '../utils/securityAssessment';
import { calculateTrustScore } from '../utils/trustScore';
import { evaluateSecureBluetoothProfile } from '../utils/connectionPolicy';
import { localDatabase } from '../services/localDatabase';
import { applySecurityActionToDevice } from '../services/securityActionService';
import { api } from '../services/api';
import { useOwnerToken } from '../services/ownerSession';
import { API_BASE_CHANGED_EVENT } from '../services/apiBase';
import { loadSecurityPolicy } from '../services/localSettings';
import { myDevices, type KnownDevice } from '../services/myDevices';
import { intel } from '../intel/store';
import { classifyAdvert } from '../intel/advert';
import type { ScanObservation } from '../intel/engine';
import { isNativeAndroidApp, scanNativeAndroidBle, scanNativeAndroidClassic, listNativeAndroidPairedDevices, type NativeBleObservation, type NativeClassicObservation } from '../services/nativeBluetoothService';

const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  confirmBlock: true,
  confirmTrust: true,
  showLowConfidenceWarnings: true,
  showSimulatedEvents: true,
  requireConnectionApproval: true,
  blockUnknownFileTransfers: true,
  enforceFastPairApproval: true,
  enableRssiGuard: true,
  restrictWearablesToAudio: true,
};

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
  | { type: 'CLEAR_SIMULATED_DEVICES' }
  /** Live link change reported by Android (connect/disconnect/pairing) for every record with this address. */
  | { type: 'SET_LINK_STATE'; payload: { address: string; connected?: boolean; paired?: boolean } };

function applySecurityPolicy(device: BluetoothDevice): BluetoothDevice {
  const normalizedDevice: BluetoothDevice = {
    ...device,
    name: resolveBluetoothDisplayName(device.name, undefined, device.manufacturer),
  };

  // Recompute derived values instead of inheriting scores caused by the old
  // circular rule (unknown -> high risk -> low trust -> blocked).
  const baselineTrust = calculateTrustScore(normalizedDevice);
  const scoredDevice: BluetoothDevice = normalizedDevice.blocked
    ? { ...normalizedDevice, riskLevel: 'high' }
    : { ...normalizedDevice, trustScore: baselineTrust.score, riskLevel: baselineTrust.riskLevel };

  const policy = loadSecurityPolicy(DEFAULT_SECURITY_POLICY);
  const profile = evaluateSecureBluetoothProfile(scoredDevice, {
    rssi: scoredDevice.rssi,
    fileName: scoredDevice.name,
    deviceType: scoredDevice.type,
  }, policy);

  if (scoredDevice.blocked || profile.connectionDecision === 'BLOCK') {
    return { ...scoredDevice, blocked: true, approvalRequired: false, riskLevel: 'high' };
  }

  // Approval is a connection gate, not evidence of maliciousness.
  return {
    ...scoredDevice,
    approvalRequired: profile.connectionDecision === 'REQUIRE_APPROVAL',
  };
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

      const existingTransports = existing.discoveryTransports ?? (
        existing.discoveryTransport === 'BLE' || existing.discoveryTransport === 'CLASSIC'
          ? [existing.discoveryTransport]
          : []
      );
      const incomingTransports = incoming.discoveryTransports ?? (
        incoming.discoveryTransport === 'BLE' || incoming.discoveryTransport === 'CLASSIC'
          ? [incoming.discoveryTransport]
          : []
      );
      const mergedTransports = Array.from(new Set([...existingTransports, ...incomingTransports]));

      const refreshed = applySecurityPolicy({
        ...existing,
        ...(shouldUpgradeName ? { name: incoming.name } : {}),
        ...(existing.type === 'unknown' && incoming.type !== 'unknown' ? { type: incoming.type } : {}),
        manufacturer: existing.manufacturer ?? incoming.manufacturer,
        services: incoming.services.length > 0 ? incoming.services : existing.services,
        discoveryTransport: incoming.discoveryTransport ?? existing.discoveryTransport,
        discoveryTransports: mergedTransports.length > 0 ? mergedTransports : existing.discoveryTransports,
        paired: incoming.paired ?? existing.paired,
        family: incoming.family ?? existing.family,
        familyLabel: incoming.familyLabel ?? existing.familyLabel,
        tracker: incoming.tracker ?? existing.tracker,
        txPower: incoming.txPower ?? existing.txPower,
        manufacturerData: incoming.manufacturerData ?? existing.manufacturerData,
        rawAdvert: incoming.rawAdvert ?? existing.rawAdvert,
        addressType: incoming.addressType ?? existing.addressType,
        deviceClass: incoming.deviceClass ?? existing.deviceClass,
        majorClass: incoming.majorClass ?? existing.majorClass,
        connectable: incoming.connectable ?? existing.connectable,
        separated: incoming.separated ?? existing.separated,
        popupAdvertiser: incoming.popupAdvertiser ?? existing.popupAdvertiser,
        rssi: typeof incoming.rssi === 'number' ? incoming.rssi : existing.rssi,
        lastSeen: incoming.lastSeen,
        ...(shouldRefreshConnection ? {
          // A scan sighting ("unknown") must not erase a live "connected" state read from Android.
          connectionStatus: incoming.connectionStatus === 'unknown' && existing.connectionStatus === 'connected'
            ? existing.connectionStatus
            : incoming.connectionStatus,
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
    case 'SET_LINK_STATE': {
      const target = action.payload.address.trim().toLowerCase();
      if (!target) return state;
      let changed = false;
      const devices = state.devices.map((device) => {
        if ((device.address ?? '').trim().toLowerCase() !== target) return device;
        changed = true;
        return {
          ...device,
          ...(typeof action.payload.connected === 'boolean'
            ? { connectionStatus: action.payload.connected ? 'connected' as const : 'disconnected' as const }
            : {}),
          ...(typeof action.payload.paired === 'boolean' ? { paired: action.payload.paired } : {}),
          lastSeen: new Date(),
        };
      });
      return changed ? { ...state, devices } : state;
    }
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
  /** Runs BLE then classic discovery under one combined result set, deduplicated by reported address. */
  scanCombinedDevices: () => Promise<void>;
  /** Loads system-bonded devices separately; this is not a live scan or connection. */
  loadPairedDevices: () => Promise<number>;
  /** Re-reads Android's paired + currently connected devices (like the system Bluetooth screen). */
  refreshKnownDevices: () => Promise<void>;
  addMockDevices: () => void;
  /** Remove only in-memory simulated/demo records; physical observations are untouched. */
  clearSimulatedDevices: () => void;
  /** Listen for advertisements from previously authorized BLE devices only. */
  startWatchingPermittedBleDevices: () => Promise<{ ok: boolean; message: string; watchedCount: number }>;
  stopWatchingPermittedBleDevices: () => void;
  canConnectSelectedDevice: (deviceId: string) => boolean;
  connectSelectedDevice: (deviceId: string) => Promise<{ ok: boolean; message: string }>;
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
  const [apiBaseRevision, setApiBaseRevision] = React.useState(0);
  const backendReady = Boolean(ownerToken && registryReadyToken === ownerToken);

  useEffect(() => {
    const onApiBaseChanged = () => setApiBaseRevision((revision) => revision + 1);
    window.addEventListener(API_BASE_CHANGED_EVENT, onApiBaseChanged);
    return () => window.removeEventListener(API_BASE_CHANGED_EVENT, onApiBaseChanged);
  }, []);

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
          payload: devices
            .filter(device => device.discoverySource !== 'SIMULATED')
            // Earlier builds blocked devices automatically from guessed risk. Only owner blocks stay.
            .map(device => (device.blocked && !device.blockedByUser ? { ...device, blocked: false, riskLevel: 'low' as const } : device))
            // A "connected" flag saved in an earlier session is stale; Android's live list refreshes it.
            .map(device => (device.connectionStatus === 'connected' ? { ...device, connectionStatus: 'unknown' as const, gattConnected: false } : device)),
        });
      } catch (error: unknown) {
        console.warn('Could not load local devices; continuing for this session.', error);
      }
    };
    void loadPhysicalDevices();
    return () => { cancelled = true; };
  }, []);

  // Persist at most about once a second; a scan changes the list many times per second.
  useEffect(() => {
    const physicalDevices = state.devices.filter(device => device.discoverySource !== 'SIMULATED');
    if (physicalDevices.length === 0) return;
    const timer = setTimeout(() => {
      void localDatabase.saveDevices(physicalDevices).catch((error: unknown) => {
        console.warn('Physical device state could not be persisted locally; the in-memory session remains active.', error);
      });
    }, 1200);
    return () => clearTimeout(timer);
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
  }, [ownerToken, apiBaseRevision]);

  /**
   * Run one scan mode explicitly. Keeping simulation and real scans separate
   * prevents a demo workflow from accidentally opening the browser Bluetooth
   * picker. All existing persistence and security-assessment behavior is kept.
   */
  const runScan = async (mode: 'simulated' | 'real', pickerMode: BluetoothPickerMode = 'all'): Promise<void> => {
    if (mode === 'simulated' && !SIMULATOR_ENABLED) {
      // Release builds never generate sample devices, so fake threats cannot mix with real scans.
      dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'error', source: 'SIMULATED', error: 'Sample devices are turned off in this release build.' } });
      return;
    }
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

      // The chooser grants visibility, not a GATT connection. Keep the native handle
      // in memory only and apply the separate in-app approval gate before connecting.
      authorizedDeviceRefs.current.set(request.device.id, request.device);
      const previousDevice = state.devices.find((item) => item.id === request.device.id);
      const previewDevice = applySecurityPolicy({
        ...(previousDevice ?? {}),
        id: request.device.id,
        name: resolveBluetoothDisplayName(request.device.name, undefined, previousDevice?.manufacturer),
        type: previousDevice?.type ?? inferDeviceType(request.device.name ?? '', previousDevice?.manufacturer, []),
        trusted: previousDevice?.trusted ?? false,
        blocked: previousDevice?.blocked ?? false,
        trustScore: previousDevice?.trustScore ?? 0,
        riskLevel: previousDevice?.riskLevel ?? 'high',
        connectionStatus: previousDevice?.connectionStatus ?? 'unknown',
        firstSeen: previousDevice?.firstSeen ?? new Date(),
        lastSeen: new Date(),
        isKnown: previousDevice?.isKnown ?? false,
        manufacturer: previousDevice?.manufacturer,
        services: previousDevice?.services ?? [],
        discoverySource: 'REAL',
        discoveryTransport: 'BLE',
        gattConnected: false,
        connectionHealth: 'UNAVAILABLE',
      });
      if (previewDevice.blocked || previewDevice.approvalRequired) {
        dispatch({ type: 'ADD_DEVICE', payload: previewDevice });
        void localDatabase.saveDevice(previewDevice).catch((error: unknown) => {
          console.warn('Selected BLE device could not be saved locally.', error);
        });
        dispatch({
          type: 'SET_SCAN_STATE',
          payload: { state: 'complete', source: 'REAL', transport: 'WEB_BLE_SELECTION', devicesFound: 1 },
        });
        return;
      }

      console.info('[BlueGuardian][BLE] User selected a physical BLE peripheral.', {
        nameReportedByChooser: request.device.name ?? '(name not advertised)',
        gattReferenceAvailable: Boolean(request.device.gatt),
      });

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
        trusted: previousDevice?.trusted ?? false,
        blocked: previousDevice?.blocked ?? false,
        trustScore: previousDevice?.trustScore ?? 0,
        riskLevel: previousDevice?.riskLevel ?? 'high',
        connectionStatus: connected ? 'connected' : 'unknown',
        firstSeen: previousDevice?.firstSeen ?? new Date(),
        lastSeen: new Date(),
        isKnown: previousDevice?.isKnown ?? false,
        manufacturer: std.manufacturer ?? previousDevice?.manufacturer,
        services: conn.ok ? services : (previousDevice?.services ?? []),
        discoverySource: 'REAL',
        discoveryTransport: 'BLE',
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

  const registerCombinedObservation = (
    observation: NativeBleObservation | NativeClassicObservation,
    transport: 'BLE' | 'CLASSIC',
    transportHistory: Map<string, Set<'BLE' | 'CLASSIC'>>,
  ) => {
    const address = String(observation.address || observation.id || '').trim();
    if (!address) return;

    const observedAt = new Date(
      typeof observation.observedAt === 'number' ? observation.observedAt : Date.now(),
    );
    const deviceName = resolveBluetoothDisplayName(observation.name);
    const identityKey = address.toLowerCase();
    const seenTransports = transportHistory.get(identityKey) ?? new Set<'BLE' | 'CLASSIC'>();
    seenTransports.add(transport);
    transportHistory.set(identityKey, seenTransports);
    const serviceUuids = transport === 'BLE' && 'serviceUuids' in observation && Array.isArray(observation.serviceUuids)
      ? observation.serviceUuids
      : [];
    const services: BluetoothDevice['services'] = serviceUuids.map((uuid) => ({
      uuid,
      characteristics: [],
    }));
    const paired = transport === 'CLASSIC' && 'paired' in observation ? observation.paired : undefined;
    const advertInfo = transport === 'BLE' && 'manufacturerData' in observation
      ? classifyAdvert({
        name: observation.name,
        serviceUuids,
        manufacturerData: observation.manufacturerData,
        serviceData: observation.serviceData,
      })
      : null;
    const device: BluetoothDevice = {
      // In a combined pass, BLE and classic reports sharing the same normalized
      // Android address merge into one record. BLE privacy/random addresses can
      // differ from a device's classic address, so identity is not guaranteed across radios.
      id: 'android-combined:' + address.toLowerCase(),
      name: deviceName,
      type: inferDeviceType(deviceName, undefined, services),
      address,
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
      discoveryTransport: 'COMBINED',
      discoveryTransports: Array.from(seenTransports),
      paired,
      ...('txPower' in observation && typeof observation.txPower === 'number' ? { txPower: observation.txPower } : {}),
      ...(transport === 'BLE' && 'manufacturerData' in observation ? {
        manufacturerData: observation.manufacturerData,
        rawAdvert: observation.rawAdvert,
        addressType: observation.addressType,
        connectable: observation.connectable,
      } : {}),
      ...('majorClass' in observation && typeof observation.majorClass === 'number'
        ? { majorClass: observation.majorClass, deviceClass: observation.deviceClass } : {}),
      ...(advertInfo ? { separated: advertInfo.separated, popupAdvertiser: advertInfo.isPairingPopup } : {}),
      ...(advertInfo && advertInfo.family !== 'unknown'
        ? { family: advertInfo.family, familyLabel: advertInfo.label, tracker: advertInfo.isTracker }
        : {}),
      gattConnected: false,
      connectionHealth: 'UNAVAILABLE',
    };

    const assessment = assessDeviceSecurity(device);
    device.trustScore = assessment.trustScore;
    device.riskLevel = assessment.trustRiskLevel;
    const guardedDevice = applySecurityPolicy(device);
    dispatch({ type: 'ADD_DEVICE', payload: guardedDevice });
  };

  /**
   * Paired and currently-connected devices reported by Android itself. Connected
   * earbuds/speakers stop advertising, so scans alone never list them.
   */
  const registerKnownDevice = (known: KnownDevice) => {
    const address = String(known.address || '').trim();
    if (!address) return;
    // Paired-but-disconnected devices are not "nearby now": keep the time Android last saw them.
    const nativeSeen = known.lastSeen?.lastSeenAt ?? known.lastSeen?.lastDisconnectedAt ?? known.lastSeen?.lastConnectedAt;
    const previous = state.devices.find((d) => d.id === 'android-combined:' + address.toLowerCase());
    const now = known.connected
      ? new Date()
      : new Date(nativeSeen ?? (previous ? new Date(previous.lastSeen).getTime() : Date.now() - 6 * 3_600_000));
    const deviceName = resolveBluetoothDisplayName(known.name);
    const transports: Array<'BLE' | 'CLASSIC'> = known.type === 'LE' ? ['BLE'] : known.type === 'DUAL' ? ['BLE', 'CLASSIC'] : ['CLASSIC'];
    const device: BluetoothDevice = {
      id: 'android-combined:' + address.toLowerCase(),
      name: deviceName,
      type: known.category === 'audio' ? inferDeviceType(deviceName || 'headphones') : inferDeviceType(deviceName),
      address,
      rssi: undefined,
      trusted: false,
      trustScore: 0,
      riskLevel: 'high',
      connectionStatus: known.connected ? 'connected' : 'disconnected',
      firstSeen: now,
      lastSeen: now,
      isKnown: false,
      services: [],
      discoverySource: 'REAL',
      discoveryTransport: 'COMBINED',
      discoveryTransports: transports,
      paired: known.paired,
      ...(typeof known.majorClass === 'number' ? { majorClass: known.majorClass, deviceClass: known.deviceClass } : {}),
      gattConnected: false,
      connectionHealth: 'UNAVAILABLE',
    };
    const assessment = assessDeviceSecurity(device);
    device.trustScore = assessment.trustScore;
    device.riskLevel = assessment.trustRiskLevel;
    const guardedDevice = applySecurityPolicy(device);
    dispatch({ type: 'ADD_DEVICE', payload: guardedDevice });
  };

  const refreshKnownDevices = async (): Promise<void> => {
    if (!isNativeAndroidApp()) return;
    try {
      const { devices: known } = await myDevices.listKnownDevices();
      known.forEach(registerKnownDevice);
    } catch {
      // Permission not granted yet or Bluetooth off; the next scan reports the reason.
    }
  };

  // Keep connection/pairing state live, the way Android's own Bluetooth screen does.
  useEffect(() => {
    if (!isNativeAndroidApp()) return;
    const handles: Array<Promise<{ remove: () => Promise<void> }>> = [];
    try {
      handles.push(myDevices.addListener('presence', (event) => {
        if (event?.address) dispatch({ type: 'SET_LINK_STATE', payload: { address: event.address, connected: Boolean(event.connected) } });
      }));
      handles.push(myDevices.addListener('bond', (event) => {
        if (event?.address) dispatch({ type: 'SET_LINK_STATE', payload: { address: event.address, paired: Boolean(event.paired) } });
      }));
    } catch {
      // Native plugin unavailable (web build).
    }
    return () => {
      handles.forEach((handle) => { void handle.then((h) => h.remove()).catch(() => undefined); });
    };
  }, []);

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

  const scanCombinedDevices = async (): Promise<void> => {
    if (!isNativeAndroidApp()) {
      dispatch({
        type: 'SET_SCAN_STATE',
        payload: {
          state: 'unsupported',
          source: 'REAL',
          transport: 'ANDROID_COMBINED_SCAN',
          error: 'Combined BLE and classic discovery is only available inside the BlueGuardian Android APK.',
        },
      });
      return;
    }

    const startedAt = Date.now();
    const observedIdentities = new Set<string>();
    // Every real scan is fed to the evidence engine, which learns your normal surroundings.
    const scanObservations: ScanObservation[] = [];
    const locationPromise = (async () => {
      try {
        const status = await myDevices.locationStatus();
        if (!status.location) return null;
        const fix = await myDevices.getLocation();
        return { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy };
      } catch {
        return null;
      }
    })();
    const combinedTransportHistory = new Map<string, Set<'BLE' | 'CLASSIC'>>();
    const messages: string[] = [];
    let bleError: string | undefined;
    let classicError: string | undefined;

    dispatch({
      type: 'SET_SCAN_STATE',
      payload: {
        state: 'scanning',
        elapsedMs: 0,
        devicesFound: 0,
        source: 'REAL',
        transport: 'ANDROID_COMBINED_SCAN',
        scanStage: 'BLE',
        startedAt,
        error: undefined,
      },
    });

    const interval = setInterval(() => {
      dispatch({ type: 'SET_SCAN_STATE', payload: { elapsedMs: Date.now() - startedAt } });
    }, 200);

    try {
      // 1) BLE starts first and settles every permission prompt (Nearby devices + location).
      // 2) As soon as it is scanning, classic discovery runs alongside it, the way Android's
      //    own Bluetooth screen does, and paired / connected devices are read from Android.
      //    Both radios get a full 12 s window: classic inquiry needs ~10 s plus name lookups.
      // Each device is processed at most every 2.5 s; the radio repeats adverts ~1/s, and
      // re-rendering and re-saving on every one made long scans sluggish.
      const lastHandled = new Map<string, number>();
      const throttled = (identity: string) => {
        const now = Date.now();
        const last = lastHandled.get(identity) ?? 0;
        if (now - last < 2500) return true;
        lastHandled.set(identity, now);
        return false;
      };

      let markBleStarted: () => void = () => undefined;
      const bleStarted = new Promise<void>((resolve) => { markBleStarted = resolve; });
      const blePromise = scanNativeAndroidBle((observation) => {
        const identity = String(observation.address || observation.id || '').trim().toLowerCase();
        if (!identity) return;
        observedIdentities.add(identity);
        scanObservations.push({
          address: identity,
          name: observation.name,
          rssi: observation.rssi,
          transport: 'BLE',
          advert: {
            serviceUuids: observation.serviceUuids,
            manufacturerData: observation.manufacturerData,
            serviceData: observation.serviceData,
          },
        });
        if (!throttled('ble:' + identity)) registerCombinedObservation(observation, 'BLE', combinedTransportHistory);
      }, 12000, markBleStarted).finally(markBleStarted);

      await bleStarted;

      const knownPromise = myDevices.listKnownDevices().then(({ devices: known }) => {
        for (const item of known) {
          observedIdentities.add(item.address.toLowerCase());
          registerKnownDevice(item);
          scanObservations.push({ address: item.address, name: item.name, transport: 'PAIRED', paired: item.paired, connected: item.connected });
        }
      }).catch((error: unknown) => {
        messages.push(error instanceof Error ? error.message : 'Couldn’t read paired devices.');
      });

      dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'scanning', transport: 'ANDROID_COMBINED_SCAN', scanStage: 'CLASSIC' } });
      const classicPromise = scanNativeAndroidClassic((observation) => {
        const identity = String(observation.address || observation.id || '').trim().toLowerCase();
        if (!identity) return;
        observedIdentities.add(identity);
        scanObservations.push({ address: identity, name: observation.name, rssi: observation.rssi, transport: 'CLASSIC', paired: observation.paired });
        // Classic results arrive once per device (again only when its name resolves), so no throttle.
        registerCombinedObservation(observation, 'CLASSIC', combinedTransportHistory);
      }, 12000);

      const [bleResult, classicResult] = await Promise.all([
        blePromise.catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : 'Bluetooth scan failed.' })),
        classicPromise.catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : 'Nearby search failed.' })),
        knownPromise,
      ]);
      if (bleResult.ok === false) bleError = bleResult.error;
      else if (bleResult.warning) messages.push(bleResult.warning);
      if (classicResult.ok === false) classicError = classicResult.error;
      else if (classicResult.warning && !messages.includes(classicResult.warning)) messages.push(classicResult.warning);

      void locationPromise.then((location) => {
        try {
          intel.ingestScan({ at: Date.now(), observations: scanObservations, location });
        } catch (error: unknown) {
          console.warn('[BlueGuardian][Intel] Scan analysis failed.', error);
        }
      });

      if (bleError && bleError !== classicError) messages.push(bleError);
      if (classicError) messages.push(classicError);
      const bothFailed = Boolean(bleError && classicError);
      const permissionFailure = bothFailed && /permission|denied|not allowed/i.test(bleError + ' ' + classicError);

      dispatch({
        type: 'SET_SCAN_STATE',
        payload: {
          state: bothFailed ? (permissionFailure ? 'permission-denied' : 'error') : 'complete',
          source: 'REAL',
          transport: 'ANDROID_COMBINED_SCAN',
          scanStage: undefined,
          devicesFound: observedIdentities.size,
          error: messages.length > 0
            ? messages.join(' ')
            : observedIdentities.size === 0
              ? 'No devices found. Check that Bluetooth is on and the device is nearby.'
              : undefined,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Combined Bluetooth discovery failed.';
      console.error('[BlueGuardian][Combined] Discovery pipeline failed.', message, error);
      dispatch({
        type: 'SET_SCAN_STATE',
        payload: {
          state: 'error',
          source: 'REAL',
          transport: 'ANDROID_COMBINED_SCAN',
          scanStage: undefined,
          devicesFound: observedIdentities.size,
          error: message,
        },
      });
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
            ? 'Android reports no paired Bluetooth devices. Pair a device in Android Settings first.'
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
  const canConnectSelectedDevice = (deviceId: string): boolean =>
    authorizedDeviceRefs.current.has(deviceId);

  const connectSelectedDevice = async (deviceId: string): Promise<{ ok: boolean; message: string }> => {
    const nativeDevice = authorizedDeviceRefs.current.get(deviceId);
    const existing = state.devices.find((device) => device.id === deviceId);
    if (!nativeDevice || !existing) {
      return { ok: false, message: 'This browser session no longer has an authorized BLE handle. Scan and select the device again.' };
    }
    if (existing.blocked) return { ok: false, message: 'This device is blocked by owner policy. Unblock it explicitly before connecting.' };

    try {
      const connection = await connectAndDiscover(nativeDevice);
      const standard = connection.ok ? await readStandardCharacteristics(connection.gatt) : {};
      const updated = applySecurityPolicy({
        ...existing,
        name: resolveBluetoothDisplayName(nativeDevice.name, standard.deviceName, standard.manufacturer ?? existing.manufacturer),
        type: inferDeviceType(nativeDevice.name ?? existing.name, standard.manufacturer ?? existing.manufacturer, connection.ok ? connection.services : existing.services),
        manufacturer: standard.manufacturer ?? existing.manufacturer,
        services: connection.ok ? connection.services : existing.services,
        connectionStatus: connection.ok ? 'connected' : 'unknown',
        gattConnected: connection.ok,
        connectionHealth: connection.ok ? 'GOOD' : 'UNAVAILABLE',
        lastSeen: new Date(),
        discoverySource: 'REAL',
        discoveryTransport: 'BLE',
      });
      dispatch({ type: 'UPDATE_DEVICE', payload: updated });
      void localDatabase.saveDevice(updated).catch((error: unknown) => {
        console.warn('Connected BLE device could not be saved locally.', error);
      });
      if (connection.ok) {
        nativeDevice.addEventListener?.('gattserverdisconnected', () => {
          dispatch({ type: 'MARK_DISCONNECTED', payload: deviceId });
        }, { once: true });
      }
      return connection.ok
        ? { ok: true, message: 'Connection approved. GATT services were inspected successfully.' }
        : { ok: false, message: `Connection was not established: ${connection.error}` };
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : 'Bluetooth connection failed.' };
    }
  };

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
    <DeviceContext.Provider value={{ state, dispatch, scanDevices, scanSimulatedDevices, scanRealDevices, scanClassicDevices, scanCombinedDevices, loadPairedDevices, refreshKnownDevices, addMockDevices, clearSimulatedDevices, startWatchingPermittedBleDevices, stopWatchingPermittedBleDevices, canConnectSelectedDevice, connectSelectedDevice, backendReady }}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useBluetoothDevices() {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useBluetoothDevices must be used within DeviceProvider');
  return ctx;
}