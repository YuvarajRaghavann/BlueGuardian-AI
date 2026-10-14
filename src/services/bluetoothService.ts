/**
 * Web Bluetooth wrapper.
 * Provides a thin, typed façade around navigator.bluetooth.
 * All methods are safe – they never throw; they return Result objects.
 */
export type BluetoothSupport = {
  supported: boolean;
  reason?: string;
};

export type RequestDeviceResult =
  | { ok: true; device: BluetoothDeviceInfo }
  | { ok: false; error: string };

export interface BluetoothDeviceInfo {
  id: string;
  name?: string;
  gatt?: any; // BluetoothRemoteGATTServer not globally typed
  uuids?: string[];
  addEventListener?: (
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) => void;
}

// Minimal shape for characteristic properties (subset of BluetoothCharacteristicProperties)
type BluetoothCharacteristicProperties = {
  broadcast: boolean;
  read: boolean;
  writeWithoutResponse: boolean;
  write: boolean;
  notify: boolean;
  indicate: boolean;
  authenticatedSignedWrites: boolean;
  reliableWrite: boolean;
  writableAuxiliaries: boolean;
};

export interface GattCharacteristicInfo {
  uuid: string;
  name?: string;
  properties: BluetoothCharacteristicProperties;
}

export interface GattServiceInfo {
  uuid: string;
  name?: string;
  characteristics: GattCharacteristicInfo[];
}

/**
 * Checks whether the current browser implements the Web Bluetooth API
 * and whether the platform reports Bluetooth as available.
 */
export async function isBluetoothSupported(): Promise<BluetoothSupport> {
  if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
    return { supported: false, reason: 'Web Bluetooth API not exposed by browser' };
  }
  return { supported: true };
}

/**
 * Requests a single device from the user (pairing dialog).
 * The caller supplies optional filters – here we ask for any device.
 */
export async function requestBluetoothDevice(): Promise<RequestDeviceResult> {
  const support = await isBluetoothSupported();
  if (!support.supported) {
    return { ok: false, error: support.reason ?? 'Bluetooth not supported' };
  }

  try {
    // @ts-ignore – navigator.bluetooth exists only in supporting browsers
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['battery_service', 'device_information', 'generic_access'],
    });
    return {
      ok: true,
      device: {
        id: device.id,
        name: device.name ?? undefined,
        gatt: device.gatt ?? undefined,
        uuids: device.uuids ?? [],
        addEventListener: device.addEventListener?.bind(device),
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('User cancelled') || msg.includes('Cancelled')) {
      return { ok: false, error: 'User cancelled the device selection' };
    }
    if (msg.includes('Permission')) {
      return { ok: false, error: 'Permission denied for Bluetooth access' };
    }
    return { ok: false, error: `Bluetooth request failed: ${msg}` };
  }
}

/**
 * Starts a continuous scan using requestDevice with a short timeout.
 * Because Web Bluetooth does not expose a passive scanner, we emulate
 * repeated requestDevice calls. This is only for demo / development.
 * Real background scanning needs a native wrapper (Android, iOS, etc.).
 */
export async function startSimulatedScan(
  onDevice: (info: BluetoothDeviceInfo) => void,
  options: { intervalMs?: number; maxAttempts?: number } = {}
): Promise<{ stop: () => void }> {
  const { intervalMs = 3000, maxAttempts = 10 } = options;
  let attempts = 0;
  let stopped = false;

  async function loop() {
    while (!stopped && attempts < maxAttempts) {
      attempts++;
      const res = await requestBluetoothDevice();
      if (res.ok) onDevice(res.device);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  loop();
  return { stop: () => { stopped = true; } };
}

/**
 * Returns a simple status string for UI usage.
 */
export async function getBluetoothStatus(): Promise<string> {
  const support = await isBluetoothSupported();
  if (!support.supported) return 'unsupported';
  return 'unknown';
}

/**
 * Connect to the GATT server of a device returned by requestBluetoothDevice
 * and discover primary services & characteristics.
 */
export async function connectAndDiscover(deviceInfo: BluetoothDeviceInfo): Promise<
  | { ok: true; gatt: any; services: GattServiceInfo[] }
  | { ok: false; error: string }
> {
  if (!deviceInfo.gatt) return { ok: false, error: 'No GATT reference' };
  try {
    const server = await deviceInfo.gatt.connect();
    const primaryServices = await server.getPrimaryServices();
    const services: GattServiceInfo[] = await Promise.all(
      primaryServices.map(async (s: any) => {
        const chars = await s.getCharacteristics();
        return {
          uuid: s.uuid,
          name: knownServiceName(s.uuid),
          characteristics: chars.map((c: any) => ({
            uuid: c.uuid,
            name: knownCharacteristicName(c.uuid),
            properties: c.properties,
          })),
        };
      })
    );
    return { ok: true, gatt: server, services };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'GATT connect failed' };
  }
}

/**
 * Read common standard characteristics (Battery, Device Information) if present.
 */
export async function readStandardCharacteristics(gatt: any): Promise<{
  batteryLevel?: number;
  manufacturer?: string;
}> {
  const result: { batteryLevel?: number; manufacturer?: string } = {};
  try {
    const bat = await gatt.getPrimaryService('battery_service');
    const lvl = await bat.getCharacteristic('battery_level');
    const val = await lvl.readValue();
    result.batteryLevel = val.getUint8(0);
  } catch {}
  try {
    const info = await gatt.getPrimaryService('device_information');
    const man = await info.getCharacteristic('manufacturer_name_string');
    const val = await man.readValue();
    result.manufacturer = new TextDecoder().decode(val);
  } catch {}
  return result;
}

/* ---- small lookup tables for friendly names ---- */
function knownServiceName(uuid: string): string | undefined {
  const map: Record<string, string> = {
    '00001800-0000-1000-8000-00805f9b34fb': 'Generic Access',
    '00001801-0000-1000-8000-00805f9b34fb': 'Generic Attribute',
    '0000180f-0000-1000-8000-00805f9b34fb': 'Battery Service',
    '0000180a-0000-1000-8000-00805f9b34fb': 'Device Information',
    '00001812-0000-1000-8000-00805f9b34fb': 'Human Interface Device',
  };
  return map[uuid.toLowerCase()];
}

function knownCharacteristicName(uuid: string): string | undefined {
  const map: Record<string, string> = {
    '00002a19-0000-1000-8000-00805f9b34fb': 'Battery Level',
    '00002a29-0000-1000-8000-00805f9b34fb': 'Manufacturer Name String',
    '00002a00-0000-1000-8000-00805f9b34fb': 'Device Name',
  };
  return map[uuid.toLowerCase()];
}