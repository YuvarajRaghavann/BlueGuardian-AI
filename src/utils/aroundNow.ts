import type { BluetoothDevice } from '../types';

const seenAt = (d: BluetoothDevice) => new Date(d.lastSeen).getTime();

/**
 * Devices that are around you now: everything heard during the most recent scan.
 * BLE phones, watches and earbuds rotate their address every few minutes, so a wider
 * window would count the same device two or three times. When the scan start time is
 * unknown (after an app restart) the last two minutes before the newest sighting are used.
 */
export function devicesAroundNow(devices: BluetoothDevice[], scanStartedAt?: number): BluetoothDevice[] {
  if (devices.length === 0) return [];
  if (typeof scanStartedAt === 'number') return devices.filter((d) => seenAt(d) >= scanStartedAt - 2000);
  const newest = Math.max(...devices.map(seenAt));
  return devices.filter((d) => newest - seenAt(d) <= 120_000);
}

export function lastScanTime(devices: BluetoothDevice[], scanStartedAt?: number): number | null {
  if (typeof scanStartedAt === 'number') return scanStartedAt;
  return devices.length ? Math.max(...devices.map(seenAt)) : null;
}
