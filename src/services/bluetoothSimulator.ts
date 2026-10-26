import type { BluetoothDevice, DeviceType } from '../types';
import { calculateTrustScore } from '../utils/trustScore';

const MANUFACTURERS: Record<DeviceType, string[]> = {
  smartphone: ['Samsung', 'Google', 'Apple', 'OnePlus', 'Xiaomi'],
  earbuds: ['CMF', 'Sony', 'Apple', 'Samsung', 'Jabra'],
  headphones: ['Sony', 'Bose', 'Sennheiser', 'Audio-Technica'],
  smartwatch: ['Samsung', 'Apple', 'Garmin', 'Fitbit'],
  laptop: ['Dell', 'Apple', 'Lenovo', 'HP'],
  iot: ['Generic', 'Espressif', 'Nordic'],
  unknown: ['Generic'],
};

const DEVICE_NAMES: Record<DeviceType, string[]> = {
  smartphone: ['Galaxy S24', 'Pixel 8', 'iPhone 15', 'OnePlus 12'],
  earbuds: ['CMF Buds 2', 'WF-1000XM5', 'AirPods Pro', 'Galaxy Buds2'],
  headphones: ['WH-1000XM5', 'QC45', 'Momentum 4'],
  smartwatch: ['Galaxy Watch 6', 'Apple Watch Series 9', 'Venu 3'],
  laptop: ['XPS 15', 'MacBook Pro 14', 'ThinkPad X1'],
  iot: ['ESP32 Sensor', 'Nordic Thingy', 'Generic IoT'],
  unknown: ['BLE Peripheral', 'Wireless Sensor', 'Bluetooth Accessory'],
};

function randItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomMac(): string {
  return Array.from({ length: 6 }, () => randInt(0, 255).toString(16).padStart(2, '0')).join(':').toUpperCase();
}

function randomServices(): { uuid: string; name?: string; characteristics: any[] }[] {
  const common = [
    { uuid: '00001800-0000-1000-8000-00805f9b34fb', name: 'Generic Access', characteristics: [] },
    { uuid: '00001801-0000-1000-8000-00805f9b34fb', name: 'Generic Attribute', characteristics: [] },
    { uuid: '0000180f-0000-1000-8000-00805f9b34fb', name: 'Battery Service', characteristics: [] },
    { uuid: '00001812-0000-1000-8000-00805f9b34fb', name: 'Human Interface Device', characteristics: [] },
  ];
  const count = randInt(1, common.length);
  return common.slice(0, count);
}

export function generateSimulatedDevices(count = 8): BluetoothDevice[] {
  const types: DeviceType[] = ['smartphone', 'earbuds', 'headphones', 'smartwatch', 'laptop', 'iot', 'unknown'];
  const devices: BluetoothDevice[] = [];

  for (let i = 0; i < count; i++) {
    const type = randItem(types);
    const manufacturer = randItem(MANUFACTURERS[type]);
    const name = `${manufacturer} ${randItem(DEVICE_NAMES[type])}`;
    const now = new Date();
    const firstSeen = new Date(now.getTime() - randInt(0, 7 * 24 * 60 * 60 * 1000));
    const rssi = -randInt(30, 95);
    const isKnown = Math.random() > 0.5;
    const baseDevice: Omit<BluetoothDevice, 'trustScore' | 'riskLevel' | 'trusted'> = {
      id: `sim-${Date.now()}-${i}`,
      name,
      type,
      address: type !== 'unknown' ? randomMac() : undefined,
      rssi,
      connectionStatus: isKnown ? (Math.random() > 0.3 ? 'connected' : 'disconnected') : 'unknown',
      firstSeen,
      lastSeen: now,
      isKnown,
      manufacturer,
      services: randomServices(),
      discoverySource: 'SIMULATED',
    };

    const assessment = calculateTrustScore({ ...baseDevice, trusted: isKnown, trustScore: 0, riskLevel: 'high' });
    const device: BluetoothDevice = {
      ...baseDevice,
      trusted: isKnown,
      trustScore: assessment.score,
      riskLevel: assessment.riskLevel,
    };
    devices.push(device);
  }
  return devices;
}

/**
 * Generates a single new simulated device (used for incremental scan results).
 */
export function generateOneSimulatedDevice(): BluetoothDevice {
  return generateSimulatedDevices(1)[0];
}