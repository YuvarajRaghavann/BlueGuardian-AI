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
  /** Found by Android's discovery LE inquiry: an LE device whose name discovery resolved. */
  leOnly?: boolean;
  observedAt: number;
}

/** Result of a short, non-bonding GATT read of a nameless device (GAP name, appearance, maker, model). */
export interface NativeNameLookup {
  address: string;
  ok: boolean;
  name?: string;
  appearance?: number;
  manufacturer?: string;
  model?: string;
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
  startBleScan(options: { durationMs: number }): Promise<{ started: boolean; durationMs: number; warning?: string; startDelayMs?: number; reused?: boolean }>;
  stopBleScan(): Promise<{ stopped: boolean }>;
  startClassicDiscovery(options: { durationMs: number }): Promise<{ started: boolean; durationMs: number; warning?: string }>;
  stopClassicDiscovery(): Promise<{ stopped: boolean }>;
  listPairedDevices(): Promise<{ devices: NativeClassicObservation[]; count: number }>;
  resolveNames(options: { addresses: string[]; timeoutMs?: number }): Promise<{ resolved: number }>;
  addListener(eventName: 'nameResolved', listenerFunc: (event: NativeNameLookup) => void): Promise<PluginListenerHandle>;
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
    // (Permission prompts can legitimately take a while, so allow 30 s.)
    const started = await Promise.race([
      nativeBluetooth.startBleScan({ durationMs }),
      new Promise<never>((_resolve, reject) => {
        startupTimeout = setTimeout(() => {
          reject(new Error(
            'Android BLE scanner did not acknowledge the scan within 30 seconds. Check Nearby Devices permission and native plugin registration.',
          ));
        }, 30000);
      }),
    ]);
    if (startupTimeout) {
      clearTimeout(startupTimeout);
      startupTimeout = undefined;
    }
    onStarted?.();
    const actualDurationMs = Math.min(30000, Math.max(3000, started.durationMs || durationMs));
    // Android limits apps to 5 scan starts per 30 s; the plugin waits for a free slot
    // instead of running a scan that would silently return nothing.
    const startDelayMs = Math.max(0, Math.min(31000, Number(started.startDelayMs) || 0));
    const timeout = new Promise<NativeBleScanState>((resolve) => {
      safetyTimeout = setTimeout(() => resolve({
        state: 'complete',
        devicesFound: observedIds.size,
        durationMs: actualDurationMs,
        message: 'The safety timeout ended the scan window because Android did not send a final scanner event.',
      }), actualDurationMs + startDelayMs + 2500);
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

/**
 * Identify nameless devices: a short connection WITHOUT pairing that reads the
 * GAP Device Name (where iPhones and most new Android phones keep their name),
 * Appearance and Device Information maker/model, then disconnects.
 * Results stream through onResult as each device answers.
 */
export async function resolveNativeDeviceNames(
  addresses: string[],
  onResult: (lookup: NativeNameLookup) => void,
  timeoutMs = 5000,
): Promise<number> {
  if (!isNativeAndroidApp() || addresses.length === 0) return 0;
  const wanted = new Set(addresses.map((a) => a.toUpperCase()));
  let listener: PluginListenerHandle | undefined;
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    listener = await nativeBluetooth.addListener('nameResolved', (event) => {
      const address = String(event?.address ?? '').toUpperCase();
      if (!wanted.has(address)) return;
      onResult({ ...event, address });
    });
    const budget = Math.min(addresses.length, 12) * (timeoutMs + 400) + 3000;
    const result = await Promise.race([
      nativeBluetooth.resolveNames({ addresses, timeoutMs }),
      new Promise<{ resolved: number }>((resolve) => { guard = setTimeout(() => resolve({ resolved: 0 }), budget); }),
    ]);
    return result.resolved;
  } catch {
    return 0;
  } finally {
    if (guard) clearTimeout(guard);
    try {
      const removal = listener?.remove();
      if (removal) void removal.catch(() => undefined);
    } catch {
      // ignore
    }
  }
}

/** One device heard by any radio during {@link scanEverythingNearby}. */
export interface NearbyDevice {
  address: string;
  name?: string;
  rssi?: number;
  serviceUuids: string[];
  manufacturerData?: Record<string, string>;
  serviceData?: Record<string, string>;
  txPower?: number;
  rawAdvert?: string;
  addressType?: 'public' | 'random';
  connectable?: boolean;
  transports: Array<'BLE' | 'CLASSIC' | 'PAIRED'>;
  paired: boolean;
  majorClass?: number;
  deviceClass?: number;
  /** Maker/model read from the device itself during name lookup. */
  maker?: string;
  model?: string;
  lastSeen: number;
}

export interface NearbyScanResult {
  devices: NearbyDevice[];
  errors: string[];
  warning?: string;
}

/**
 * Everything Android's own Bluetooth screen would show, and more: a BLE scan and a
 * classic inquiry running together (old phones, car kits, speakers, earbuds in pairing
 * mode only answer the inquiry), the system's paired list, and optionally a name lookup
 * for nameless devices nearby. Used by Find (report + help others) and confirm-nearby.
 */
export async function scanEverythingNearby(options: {
  durationMs?: number;
  includePaired?: boolean;
  resolveNames?: boolean;
  onUpdate?: (devices: NearbyDevice[]) => void;
} = {}): Promise<NearbyScanResult> {
  const durationMs = options.durationMs ?? 12000;
  const map = new Map<string, NearbyDevice>();
  const errors: string[] = [];
  let warning: string | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const emit = () => {
    if (!options.onUpdate || pending) return;
    pending = setTimeout(() => { pending = undefined; options.onUpdate?.(Array.from(map.values())); }, 250);
  };
  const upsert = (address: string, patch: Partial<NearbyDevice>, transport: 'BLE' | 'CLASSIC' | 'PAIRED') => {
    const key = address.trim().toUpperCase();
    if (!key) return;
    const prev = map.get(key);
    const name = patch.name?.trim() || prev?.name;
    map.set(key, {
      ...prev,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      address: key,
      name: name || undefined,
      serviceUuids: Array.from(new Set([...(prev?.serviceUuids ?? []), ...(patch.serviceUuids ?? [])])),
      transports: Array.from(new Set([...(prev?.transports ?? []), transport])),
      paired: Boolean(prev?.paired || patch.paired),
      rssi: typeof patch.rssi === 'number' ? patch.rssi : prev?.rssi,
      lastSeen: Date.now(),
    });
    emit();
  };

  let markStarted: () => void = () => undefined;
  const bleStarted = new Promise<void>((resolve) => { markStarted = resolve; });
  const ble = scanNativeAndroidBle((o) => {
    upsert(o.address || o.id, {
      name: o.name, rssi: o.rssi, serviceUuids: o.serviceUuids ?? [], manufacturerData: o.manufacturerData,
      serviceData: o.serviceData, txPower: o.txPower, rawAdvert: o.rawAdvert, addressType: o.addressType, connectable: o.connectable,
    }, 'BLE');
  }, durationMs, markStarted).finally(markStarted);
  // Classic inquiry after BLE has settled the permission prompt, then both run together.
  await bleStarted;
  const classic = scanNativeAndroidClassic((o) => {
    upsert(o.address, { name: o.name, rssi: o.rssi, paired: o.paired, majorClass: o.majorClass, deviceClass: o.deviceClass }, o.leOnly ? 'BLE' : 'CLASSIC');
  }, durationMs);
  const paired = options.includePaired === false ? Promise.resolve() : listNativeAndroidPairedDevices().then((list) => {
    for (const d of list) {
      const key = d.address.toUpperCase();
      // Paired devices are "yours"; mark them, but only list them as nearby when a radio heard them.
      const prev = map.get(key);
      if (prev) map.set(key, { ...prev, paired: true, name: prev.name || d.name, transports: Array.from(new Set([...prev.transports, 'PAIRED' as const])) });
      else map.set(key, { address: key, name: d.name, serviceUuids: [], transports: ['PAIRED'], paired: true, lastSeen: 0 });
    }
    emit();
  }).catch(() => undefined);

  const [bleResult, classicResult] = await Promise.all([ble, classic, paired]);
  if (!bleResult.ok) errors.push(bleResult.error);
  else warning = bleResult.warning;
  if (!classicResult.ok) errors.push(classicResult.error);
  else warning = warning ?? classicResult.warning;

  if (options.resolveNames !== false) {
    const nameless = Array.from(map.values())
      .filter((d) => !d.name && d.transports.includes('BLE') && d.connectable !== false && (d.rssi ?? -127) >= -85)
      .sort((a, b) => (b.rssi ?? -127) - (a.rssi ?? -127))
      .slice(0, 8)
      .map((d) => d.address);
    if (nameless.length) {
      await resolveNativeDeviceNames(nameless, (r) => {
        const prev = map.get(r.address);
        if (!prev || !r.ok) return;
        map.set(r.address, { ...prev, name: prev.name || r.name || undefined, maker: r.manufacturer ?? prev.maker, model: r.model ?? prev.model });
        emit();
      });
    }
  }
  if (pending) { clearTimeout(pending); pending = undefined; }
  const devices = Array.from(map.values());
  options.onUpdate?.(devices);
  return { devices, errors, warning };
}
