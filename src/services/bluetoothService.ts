/**
 * Web Bluetooth wrapper.
 * Provides a thin, typed façade around navigator.bluetooth.
 * All methods are safe – they never throw; they return Result objects.
 */
export type BluetoothSupport = {
  supported: boolean;
  reason?: string;
};

export interface BluetoothEnvironmentDiagnostics {
  secureContext: boolean;
  webBluetoothApi: boolean;
  requestDeviceApi: boolean;
  grantedDeviceListApi: boolean;
  advertisementWatchApi: boolean;
  bluetoothAvailability: 'available' | 'unavailable' | 'unknown';
  availabilityNote?: string;
}

/** Browser capability check used by the Devices troubleshooting panel. */
export async function diagnoseBluetoothEnvironment(): Promise<BluetoothEnvironmentDiagnostics> {
  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  const browserBluetooth = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { bluetooth?: any }).bluetooth;
  let bluetoothAvailability: BluetoothEnvironmentDiagnostics['bluetoothAvailability'] = 'unknown';
  let availabilityNote: string | undefined;

  if (!secureContext) {
    availabilityNote = 'Web Bluetooth requires a secure context (HTTPS, or localhost for development).';
  } else if (!browserBluetooth || typeof browserBluetooth.requestDevice !== 'function') {
    availabilityNote = 'This browser does not expose the Web Bluetooth requestDevice API.';
  }

  if (browserBluetooth && typeof browserBluetooth.getAvailability === 'function') {
    try {
      const available = await browserBluetooth.getAvailability();
      bluetoothAvailability = available ? 'available' : 'unavailable';
      if (!available) availabilityNote = 'The browser reports that Bluetooth is currently unavailable or turned off.';
    } catch (error: unknown) {
      availabilityNote = error instanceof Error ? error.message : 'Bluetooth availability could not be checked.';
    }
  }

  return {
    secureContext,
    webBluetoothApi: Boolean(browserBluetooth),
    requestDeviceApi: Boolean(browserBluetooth && typeof browserBluetooth.requestDevice === 'function'),
    grantedDeviceListApi: Boolean(browserBluetooth && typeof browserBluetooth.getDevices === 'function'),
    advertisementWatchApi: (() => {
      const bluetoothDeviceConstructor = typeof window !== 'undefined' ? (window as any).BluetoothDevice : undefined;
      return Boolean(bluetoothDeviceConstructor?.prototype && typeof bluetoothDeviceConstructor.prototype.watchAdvertisements === 'function');
    })(),
    bluetoothAvailability,
    availabilityNote,
  };
}

/**
 * `known` filters the browser-owned chooser to recognizable advertised names.
 * `all` preserves the original broad chooser for uncommon/anonymous BLE devices.
 * The browser controls the native chooser UI; the web app can only filter its entries.
 */
export type BluetoothPickerMode = 'known' | 'all';

/**
 * Normalize a name received from Web Bluetooth/GATT or legacy records. Chrome can
 * show a native placeholder containing an identifier when a peripheral does not
 * advertise a local name; that placeholder must not be displayed as the device name.
 */
export function normalizeBluetoothName(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96);

  if (!cleaned) return undefined;
  if (/^(?:unknown|unknown bluetooth device|unknown or unsupported device(?:\s*\([^)]*\))?|name not found|device not found|not found|n\/?a|bluetooth device(?:\s*\(name unavailable\))?|.+\s+bluetooth device)$/i.test(cleaned)) {
    return undefined;
  }
  if (/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(cleaned)) return undefined;
  if (/^device\s+(?:[0-9a-f]{4,}|(?:[0-9a-f]{2}[:-]){2,}[0-9a-f]{2})$/i.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

/** Prefer the peripheral's own advertised/GATT name. Never invent a model name. */
export function resolveBluetoothDisplayName(
  advertisedName?: string | null,
  gattDeviceName?: string | null,
  manufacturer?: string | null,
): string {
  const advertised = normalizeBluetoothName(advertisedName);
  if (advertised) return advertised;

  const gattName = normalizeBluetoothName(gattDeviceName);
  if (gattName) return gattName;

  const maker = normalizeBluetoothName(manufacturer);
  if (maker) return `${maker} Bluetooth device`;

  return 'Bluetooth device (name unavailable)';
}

const KNOWN_DEVICE_NAME_PREFIXES = [
  // Earbuds, headphones, and audio accessories
  'OnePlus', 'Nord Buds', 'Buds', 'Earbud', 'Earphone', 'Headphone', 'AirPods',
  'Galaxy Buds', 'Pixel Buds', 'Nothing Ear', 'JBL', 'Sony', 'Bose', 'Beats', 'Sennheiser',
  'Soundcore', 'Anker', 'Jabra', 'Marshall', 'Skullcandy', 'Tribit', 'Edifier',
  // Common audio brands and product names
  'boAt', 'Boat', 'Noise', 'Boult', 'Mivi', 'Zebronics', 'pTron', 'PTron', 'Portronics',
  'CrossBeats', 'Wings', 'Fire-Boltt', 'Fire Boltt', 'DIZO', 'Oppo Enco', 'Vivo TWS',
  'Redmi Buds', 'Realme Buds', 'Xiaomi', 'Huawei', 'HONOR',
  // Wearables
  'Apple Watch', 'Galaxy Watch', 'Pixel Watch', 'Fitbit', 'Garmin',
  // Phones and tablets
  'iPhone', 'iPad', 'Galaxy', 'Pixel', 'Redmi', 'OPPO', 'Oppo', 'Vivo', 'vivo', 'realme', 'Motorola', 'Nothing Phone',
  // Named computers and common maker boards
  'DESKTOP-', 'LAPTOP-', 'MacBook', 'Surface', 'ThinkPad', 'Dell', 'HP-', 'Lenovo', 'ASUS', 'Acer',
  'ESP32', 'ESP8266', 'Raspberry Pi', 'Smart Bulb', 'Smart Plug',
] as const;

export type RequestDeviceResult =
  | { ok: true; device: BluetoothDeviceInfo }
  | { ok: false; error: string };

export interface BluetoothDeviceInfo {
  id: string;
  name?: string;
  address?: string;
  rssi?: number;
  transport?: 'BLE' | 'CLASSIC' | 'PAIRED' | 'WEB';
  source?: 'native' | 'web';
  paired?: boolean;
  gatt?: any; // BluetoothRemoteGATTServer not globally typed
  /** Native handle is kept only in memory for optional advertisement watching. Never persist it. */
  nativeDevice?: any;
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
    return { supported: false, reason: 'Web Bluetooth API not exposed by this browser.' };
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return { supported: false, reason: 'Web Bluetooth requires HTTPS or localhost. Open the app at localhost or a trusted HTTPS origin.' };
  }
  const bluetooth = (navigator as Navigator & { bluetooth?: any }).bluetooth;
  if (!bluetooth || typeof bluetooth.requestDevice !== 'function') {
    return { supported: false, reason: 'This browser does not expose navigator.bluetooth.requestDevice().' };
  }
  return { supported: true };
}

/**
 * Requests one device from the browser-owned Bluetooth chooser.
 * `known` narrows the native chooser to recognizable advertised-name prefixes.
 * `all` is the recommended default when users want any nearby BLE device Chrome exposes.
 */
export async function requestBluetoothDevice(
  mode: BluetoothPickerMode = 'all',
): Promise<RequestDeviceResult> {
  const support = await isBluetoothSupported();
  if (!support.supported) {
    console.warn('[BlueGuardian][BLE] Browser support check failed:', support.reason);
    return { ok: false, error: support.reason ?? 'Bluetooth not supported' };
  }

  console.info('[BlueGuardian][BLE] Opening browser BLE chooser.', { pickerMode: mode });
  try {
    // The browser owns the native chooser. In `known` mode, restrict its list
    // to advertised name prefixes instead of showing anonymous MAC-like entries.
    // Keep `all` as the default for existing callers such as Recovery.
    const pickerOptions = mode === 'known'
      ? {
          filters: KNOWN_DEVICE_NAME_PREFIXES.map(namePrefix => ({ namePrefix })),
          optionalServices: ['battery_service', 'device_information', 'generic_access'],
        }
      : {
          acceptAllDevices: true,
          optionalServices: ['battery_service', 'device_information', 'generic_access'],
        };

    // @ts-ignore – navigator.bluetooth exists only in supporting browsers
    const device = await navigator.bluetooth.requestDevice(pickerOptions);
    console.info('[BlueGuardian][BLE] Chooser returned a selected peripheral.', {
      nameReported: Boolean(device.name),
      advertisedName: device.name ?? '(not provided)',
      gattAvailable: Boolean(device.gatt),
      advertisedServiceCount: Array.isArray(device.uuids) ? device.uuids.length : 0,
    });
    return {
      ok: true,
      device: {
        id: device.id,
        name: device.name ?? undefined,
        gatt: device.gatt ?? undefined,
        nativeDevice: device,
        uuids: device.uuids ?? [],
        addEventListener: device.addEventListener?.bind(device),
      },
    };
  } catch (err: unknown) {
    const errorName = err instanceof DOMException ? err.name : '';
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.warn('[BlueGuardian][BLE] Browser chooser did not return a device.', { errorName, message: msg });
    if (errorName === 'NotFoundError') {
      return {
        ok: false,
        error: 'Chrome returned no device. The chooser may have been closed, or no compatible BLE advertisement was available. Retry with the device in pairing/discoverable mode and select All BLE devices.',
      };
    }
    if (/cancel|abort|dismiss/i.test(msg)) {
      return { ok: false, error: 'Bluetooth device selection was cancelled before a device was returned.' };
    }
    if (/permission|notallowed/i.test(`${errorName} ${msg}`)) {
      return { ok: false, error: 'Bluetooth permission was denied. Check Chrome site permissions and Windows Bluetooth settings.' };
    }
    return { ok: false, error: `Bluetooth chooser failed (${errorName || 'unknown error'}): ${msg}` };
  }
}



/** One advertisement observed from a device the user has already authorized. */
export interface BluetoothAdvertisementObservation {
  id: string;
  name?: string;
  rssi?: number;
  uuids: string[];
  observedAt: Date;
}

export type GrantedBluetoothDevicesResult =
  | { ok: true; devices: BluetoothDeviceInfo[] }
  | { ok: false; error: string };

export type BluetoothAdvertisementWatchResult =
  | { ok: true; watchedCount: number; stop: () => void }
  | { ok: false; error: string };

/**
 * Returns only BLE devices for which this website was granted access before.
 * This is not a scan of all nearby devices and does not include classic Bluetooth.
 */
export async function getPreviouslyGrantedBluetoothDevices(): Promise<GrantedBluetoothDevicesResult> {
  if (typeof navigator === 'undefined') {
    return { ok: false, error: 'Bluetooth is not available outside a browser.' };
  }

  const bluetooth = (navigator as Navigator & { bluetooth?: any }).bluetooth;
  if (!bluetooth || typeof bluetooth.getDevices !== 'function') {
    return {
      ok: false,
      error: 'This browser does not support listing previously authorized BLE devices. Use Find all BLE devices to grant access first.',
    };
  }

  try {
    const devices: any[] = await bluetooth.getDevices();
    return {
      ok: true,
      devices: devices.map((device) => ({
        id: String(device.id),
        name: device.name ?? undefined,
        gatt: device.gatt ?? undefined,
        nativeDevice: device,
        uuids: device.uuids ?? [],
        addEventListener: device.addEventListener?.bind(device),
      })),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unable to read Bluetooth permissions.';
    return { ok: false, error: message };
  }
}

/**
 * Watches advertisements only for already-authorized devices. Browser support is
 * experimental/limited; it cannot discover previously unknown devices like a native scanner.
 */
export async function watchBluetoothAdvertisements(
  devices: BluetoothDeviceInfo[],
  onAdvertisement: (observation: BluetoothAdvertisementObservation) => void,
): Promise<BluetoothAdvertisementWatchResult> {
  const active: Array<{ device: any; listener: EventListener }> = [];
  const errors: string[] = [];

  for (const info of devices) {
    const device = info.nativeDevice as any;
    if (!device || typeof device.watchAdvertisements !== 'function' || typeof device.addEventListener !== 'function') {
      continue;
    }

    const listener: EventListener = (event: Event) => {
      const advertisement = event as Event & {
        name?: string | null;
        rssi?: number;
        uuids?: string[];
      };
      onAdvertisement({
        id: String(device.id ?? info.id),
        name: advertisement.name ?? device.name ?? info.name,
        rssi: typeof advertisement.rssi === 'number' ? advertisement.rssi : undefined,
        uuids: Array.isArray(advertisement.uuids) ? advertisement.uuids : [],
        observedAt: new Date(),
      });
    };

    device.addEventListener('advertisementreceived', listener);
    try {
      await device.watchAdvertisements();
      active.push({ device, listener });
    } catch (error: unknown) {
      device.removeEventListener?.('advertisementreceived', listener);
      const message = error instanceof Error ? error.message : 'watchAdvertisements failed';
      errors.push(`${info.name ?? info.id}: ${message}`);
    }
  }

  if (active.length === 0) {
    const detail = errors.length ? ` ${errors.slice(0, 2).join('; ')}` : '';
    return {
      ok: false,
      error: `No previously authorized device could be watched. This browser or device may not support advertisement watching.${detail}`,
    };
  }

  let stopped = false;
  return {
    ok: true,
    watchedCount: active.length,
    stop: () => {
      if (stopped) return;
      stopped = true;
      for (const { device, listener } of active) {
        device.removeEventListener?.('advertisementreceived', listener);
        try {
          device.unwatchAdvertisements?.();
        } catch {
          // The browser may have already stopped the watch.
        }
      }
    },
  };
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
  | { ok: true; gatt: any; services: GattServiceInfo[]; warnings?: string[] }
  | { ok: false; error: string }
> {
  if (!deviceInfo.gatt) return { ok: false, error: 'The selected peripheral did not expose a GATT server.' };
  try {
    const server = await deviceInfo.gatt.connect();
    const warnings: string[] = [];

    // Distinguish a connected peripheral with no readable services from a true
    // GATT connection failure. Some phones and audio accessories expose little or
    // no GATT information to web pages; keep the hardware observation regardless.
    let primaryServices: any[] = [];
    try {
      primaryServices = await server.getPrimaryServices();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Primary service discovery was denied.';
      warnings.push(`Primary GATT services unavailable: ${message}`);
    }

    const services: GattServiceInfo[] = await Promise.all(
      primaryServices.map(async (service: any) => {
        let characteristics: any[] = [];
        try {
          characteristics = await service.getCharacteristics();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Characteristic discovery was denied.';
          warnings.push(`Characteristics unavailable for service ${service.uuid}: ${message}`);
        }
        return {
          uuid: service.uuid,
          name: knownServiceName(service.uuid),
          characteristics: characteristics.map((characteristic: any) => ({
            uuid: characteristic.uuid,
            name: knownCharacteristicName(characteristic.uuid),
            properties: characteristic.properties,
          })),
        };
      })
    );
    if (services.length === 0 && warnings.length === 0) {
      warnings.push('The peripheral connected, but it exposed no primary GATT services to this browser session.');
    }
    return { ok: true, gatt: server, services, warnings: warnings.length ? warnings : undefined };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'GATT connection failed.';
    console.warn('[BlueGuardian][BLE] GATT connection failed after selection.', { message });
    return { ok: false, error: message };
  }
}

/**
 * Read standard BLE characteristics where the device and browser permit it.
 * The Generic Access Device Name is often more useful than a blank advertised name,
 * but many devices do not expose it and Web Bluetooth cannot invent one.
 */
export async function readStandardCharacteristics(gatt: any): Promise<{
  batteryLevel?: number;
  manufacturer?: string;
  deviceName?: string;
}> {
  const result: { batteryLevel?: number; manufacturer?: string; deviceName?: string } = {};
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
    result.manufacturer = new TextDecoder().decode(val).trim() || undefined;
  } catch {}
  try {
    const genericAccess = await gatt.getPrimaryService('generic_access');
    const deviceName = await genericAccess.getCharacteristic('device_name');
    const val = await deviceName.readValue();
    result.deviceName = new TextDecoder().decode(val).trim() || undefined;
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