import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeBleObservation {
  id: string;
  address?: string;
  name?: string;
  rssi?: number;
  serviceUuids?: string[];
  /** company id (4 hex chars) -> payload hex */
  manufacturerData?: Record<string, string>;
  /** service UUID -> payload hex */
  serviceData?: Record<string, string>;
  /** Advertised transmit power (dBm at 0 m), when the device includes it. */
  txPower?: number;
  rawAdvert?: string;
  addressType?: 'public' | 'random';
  connectable?: boolean;
  observedAt: number;
}

export interface NativeClassicObservation {
  id: string;
  address: string;
  name?: string;
  rssi?: number;
  transport: 'CLASSIC' | 'PAIRED';
  paired?: boolean;
  deviceClass?: number;
  majorClass?: number;
  observedAt: number;
}

interface NativeClassicScanState {
  state: 'scanning' | 'complete' | 'error';
  devicesFound?: number;
  durationMs?: number;
  message?: string;
}

export type NativeClassicScanOutcome =
  | { ok: true; devicesFound: number; durationMs: number; message?: string; warning?: string }
  | { ok: false; error: string };

interface NativeBleScanState {
  state: 'scanning' | 'complete' | 'error';
  devicesFound?: number;
  durationMs?: number;
  message?: string;
  code?: number;
}

interface BlueGuardianBluetoothPlugin {
  startBleScan(options: { durationMs: number }): Promise<{ started: boolean; durationMs: number; warning?: string }>;
  stopBleScan(): Promise<{ stopped: boolean }>;
  startClassicDiscovery(options: { durationMs: number }): Promise<{ started: boolean; durationMs: number; warning?: string }>;
  stopClassicDiscovery(): Promise<{ stopped: boolean }>;
  listPairedDevices(): Promise<{ devices: NativeClassicObservation[]; count: number }>;
  addListener(eventName: 'deviceFound', listenerFunc: (event: NativeBleObservation) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'scanState', listenerFunc: (event: NativeBleScanState) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'classicDeviceFound', listenerFunc: (event: NativeClassicObservation) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'classicScanState', listenerFunc: (event: NativeClassicScanState) => void): Promise<PluginListenerHandle>;
}

const nativeBluetooth = registerPlugin<BlueGuardianBluetoothPlugin>('BlueGuardianBluetooth');

export function isNativeAndroidApp(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export type NativeBleScanOutcome =
  | { ok: true; devicesFound: number; durationMs: number; message?: string; warning?: string }
  | { ok: false; error: string };

export async function scanNativeAndroidBle(
  onObservation: (observation: NativeBleObservation) => void,
  requestedDurationMs = 12000,
  /** Called once Android has accepted the scan (after any permission prompt). */
  onStarted?: () => void,
): Promise<NativeBleScanOutcome> {
  if (!isNativeAndroidApp()) {
    return { ok: false, error: 'Native Android Bluetooth scanning is only available inside the BlueGuardian APK.' };
  }

  const durationMs = Math.min(30000, Math.max(3000, Math.round(requestedDurationMs)));
  const observedIds = new Set<string>();
  let deviceListener: PluginListenerHandle | undefined;
  let stateListener: PluginListenerHandle | undefined;
  let safetyTimeout: ReturnType<typeof setTimeout> | undefined;
  let startupTimeout: ReturnType<typeof setTimeout> | undefined;
  let resolveCompletion: (state: NativeBleScanState) => void = () => undefined;
  const completion = new Promise<NativeBleScanState>((resolve) => {
    resolveCompletion = resolve;
  });

  try {
    deviceListener = await nativeBluetooth.addListener('deviceFound', (observation) => {
      const identity = String(observation.address || observation.id || '').trim();
      if (!identity) return;
      observedIds.add(identity);
      onObservation({
        ...observation,
        id: identity,
        serviceUuids: Array.isArray(observation.serviceUuids) ? observation.serviceUuids : [],
        observedAt: typeof observation.observedAt === 'number' ? observation.observedAt : Date.now(),
      });
    });

    stateListener = await nativeBluetooth.addListener('scanState', (state) => {
      if (state.state === 'complete' || state.state === 'error') resolveCompletion(state);
    });

    // Guard the startup call as well as the scan window. A native permission/bridge
    // call that never settles must not leave the Devices page spinning forever.
    const started = await Promise.race([
      nativeBluetooth.startBleScan({ durationMs }),
      new Promise<never>((_resolve, reject) => {
        startupTimeout = setTimeout(() => {
          reject(new Error(
            'Android BLE scanner did not acknowledge the scan within 10 seconds. Check Nearby Devices permission and native plugin registration.',
          ));
        }, 10000);
      }),
    ]);
    if (startupTimeout) {
      clearTimeout(startupTimeout);
      startupTimeout = undefined;
    }
    onStarted?.();
    const actualDurationMs = Math.min(30000, Math.max(3000, started.durationMs || durationMs));
    const timeout = new Promise<NativeBleScanState>((resolve) => {
      safetyTimeout = setTimeout(() => resolve({
        state: 'complete',
        devicesFound: observedIds.size,
        durationMs: actualDurationMs,
        message: 'The safety timeout ended the scan window because Android did not send a final scanner event.',
      }), actualDurationMs + 2500);
    });
    const finalState = await Promise.race([completion, timeout]);

    if (finalState.state === 'error') {
      return { ok: false, error: finalState.message || 'The Android BLE scanner reported an error.' };
    }

    const devicesFound = typeof finalState.devicesFound === 'number' ? finalState.devicesFound : observedIds.size;
    return {
      ok: true,
      devicesFound,
      durationMs: actualDurationMs,
      warning: started.warning,
      message: devicesFound === 0
        ? 'No BLE advertisements were received during this scan window. Keep the target nearby, ensure it is advertising, and retry.'
        : finalState.message,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown native Bluetooth error.';
    return { ok: false, error: message };
  } finally {
    if (safetyTimeout) clearTimeout(safetyTimeout);
    if (startupTimeout) clearTimeout(startupTimeout);

    // Cleanup is best-effort and deliberately non-blocking. If the native
    // bridge itself is unresponsive, awaiting stop/remove here would hide the
    // startup timeout and leave the app stuck in its scanning state anyway.
    try {
      void nativeBluetooth.stopBleScan().catch(() => undefined);
    } catch {
      // Ignore synchronous bridge errors during cleanup.
    }
    try {
      const removal = deviceListener?.remove();
      if (removal) void removal.catch(() => undefined);
    } catch {
      // Cleanup must not mask the scan result.
    }
    try {
      const removal = stateListener?.remove();
      if (removal) void removal.catch(() => undefined);
    } catch {
      // Cleanup must not mask the scan result.
    }
  }
}

/**
 * Runs Android classic discovery while BlueGuardian is foregrounded.
 * Classic discovery is intentionally separate from the BLE scan in Phase 4.
 */
export async function scanNativeAndroidClassic(
  onObservation: (observation: NativeClassicObservation) => void,
  requestedDurationMs = 12000,
): Promise<NativeClassicScanOutcome> {
  if (!isNativeAndroidApp()) {
    return { ok: false, error: 'Classic Bluetooth discovery is only available inside the BlueGuardian Android APK.' };
  }

  const durationMs = Math.min(30000, Math.max(3000, Math.round(requestedDurationMs)));
  const observedIds = new Set<string>();
  const observedNames = new Map<string, string>();
  let deviceListener: PluginListenerHandle | undefined;
  let stateListener: PluginListenerHandle | undefined;
  let safetyTimeout: ReturnType<typeof setTimeout> | undefined;
  let startupTimeout: ReturnType<typeof setTimeout> | undefined;
  let resolveCompletion: (state: NativeClassicScanState) => void = () => undefined;
  const completion = new Promise<NativeClassicScanState>((resolve) => {
    resolveCompletion = resolve;
  });

  try {
    deviceListener = await nativeBluetooth.addListener('classicDeviceFound', (observation) => {
      const address = String(observation.address || observation.id || '').trim();
      if (!address) return;
      const identity = address.toLowerCase();
      const name = typeof observation.name === 'string' ? observation.name.trim() : '';
      // Android re-sends a device once its name resolves; let that update through.
      if (observedIds.has(identity) && (!name || observedNames.get(identity) === name)) return;
      observedIds.add(identity);
      if (name) observedNames.set(identity, name);
      onObservation({
        ...observation,
        id: address,
        address,
        transport: 'CLASSIC',
        observedAt: typeof observation.observedAt === 'number' ? observation.observedAt : Date.now(),
      });
    });

    stateListener = await nativeBluetooth.addListener('classicScanState', (state) => {
      if (state.state === 'complete' || state.state === 'error') resolveCompletion(state);
    });

    const started = await Promise.race([
      nativeBluetooth.startClassicDiscovery({ durationMs }),
      new Promise<never>((_resolve, reject) => {
        startupTimeout = setTimeout(() => {
          reject(new Error('Classic Bluetooth discovery did not start within 10 seconds. Check Nearby Devices permission and native plugin registration.'));
        }, 10000);
      }),
    ]);
    if (startupTimeout) {
      clearTimeout(startupTimeout);
      startupTimeout = undefined;
    }

    const actualDurationMs = Math.min(30000, Math.max(3000, started.durationMs || durationMs));
    const timeout = new Promise<NativeClassicScanState>((resolve) => {
      safetyTimeout = setTimeout(() => resolve({
        state: 'complete',
        devicesFound: observedIds.size,
        durationMs: actualDurationMs,
        message: 'The safety timeout ended the classic discovery window because Android did not send a final event.',
      }), actualDurationMs + 2500);
    });
    const finalState = await Promise.race([completion, timeout]);

    if (finalState.state === 'error') {
      return { ok: false, error: finalState.message || 'Android classic Bluetooth discovery failed.' };
    }

    const devicesFound = Math.max(
      observedIds.size,
      typeof finalState.devicesFound === 'number' ? finalState.devicesFound : 0,
    );
    return {
      ok: true,
      devicesFound,
      durationMs: actualDurationMs,
      warning: started.warning,
      message: finalState.message || (devicesFound === 0
        ? 'No classic Bluetooth devices were discovered. The other device must be discoverable during the scan.'
        : undefined),
    };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown classic Bluetooth error.' };
  } finally {
    if (safetyTimeout) clearTimeout(safetyTimeout);
    if (startupTimeout) clearTimeout(startupTimeout);
    try {
      void nativeBluetooth.stopClassicDiscovery().catch(() => undefined);
    } catch {
      // Cleanup must not mask the scan result.
    }
    try {
      const removal = deviceListener?.remove();
      if (removal) void removal.catch(() => undefined);
    } catch {
      // Cleanup must not mask the scan result.
    }
    try {
      const removal = stateListener?.remove();
      if (removal) void removal.catch(() => undefined);
    } catch {
      // Cleanup must not mask the scan result.
    }
  }
}

/** Returns Android's system bonded-device registry; this is not a live scan or connection check. */
export async function listNativeAndroidPairedDevices(): Promise<NativeClassicObservation[]> {
  if (!isNativeAndroidApp()) {
    throw new Error('Paired Bluetooth devices are only available inside the BlueGuardian Android APK.');
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      nativeBluetooth.listPairedDevices(),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(
          'Android did not return the paired-device list. Check Nearby Devices permission and native plugin registration.',
        )), 10000);
      }),
    ]);
    return (Array.isArray(result.devices) ? result.devices : []).map((device) => ({
      ...device,
      id: String(device.address || device.id || '').trim(),
      address: String(device.address || device.id || '').trim(),
      transport: 'PAIRED' as const,
      paired: true,
      observedAt: typeof device.observedAt === 'number' ? device.observedAt : Date.now(),
    })).filter((device) => Boolean(device.address));
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

