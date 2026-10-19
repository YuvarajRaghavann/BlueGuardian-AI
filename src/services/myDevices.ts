/**
 * Bridge to the native BlueGuardianDevices plugin: paired/connected devices,
 * pair & connect, "find it" signal meter, last-seen time and place, sharing.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativeAndroidApp } from './nativeBluetoothService';

export interface LastSeenRecord {
  address: string;
  name?: string;
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
  lastSeenAt?: number;
  lastSeenSource?: 'connected' | 'disconnected' | 'nearby' | 'app' | string;
  lastRssi?: number;
  location?: {
    lat: number;
    lng: number;
    accuracy: number;
    fixAt: number;
    savedAt: number;
    source: string;
  };
}

export interface KnownDevice {
  address: string;
  name?: string;
  type: 'CLASSIC' | 'LE' | 'DUAL' | 'UNKNOWN';
  category: 'audio' | 'wearable' | 'phone' | 'computer' | 'input' | 'health' | 'other';
  paired: boolean;
  connected: boolean;
  profiles: string[];
  lastSeen?: LastSeenRecord;
}

export interface ConnectOutcome {
  result: 'connected' | 'pairing' | 'requested' | 'settings';
  message: string;
}

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number;
  fixAt: number;
}

interface DevicesPlugin {
  listKnownDevices(): Promise<{ devices: KnownDevice[] }>;
  getLastSeen(): Promise<{ entries: Record<string, LastSeenRecord> }>;
  forgetLastSeen(options: { address: string }): Promise<void>;
  connect(options: { address: string }): Promise<ConnectOutcome>;
  openBluetoothSettings(): Promise<void>;
  startProximity(options: { address: string; name?: string; durationMs?: number }): Promise<{ started: boolean; connected: boolean }>;
  stopProximity(): Promise<void>;
  requestBluetooth(): Promise<{ granted: boolean }>;
  bluetoothStatus(): Promise<{ granted: boolean }>;
  locationStatus(): Promise<{ location: boolean; background: boolean }>;
  requestLocation(): Promise<{ location: boolean; background: boolean }>;
  requestBackgroundLocation(): Promise<{ location: boolean; background: boolean }>;
  getLocation(): Promise<LocationFix>;
  saveCurrentLocationFor(options: { address: string; name?: string; source?: string }): Promise<LocationFix>;
  share(options: { text: string; title?: string }): Promise<void>;
  openMap(options: { lat: number; lng: number; label?: string }): Promise<void>;
  addListener(event: 'presence', fn: (e: { address: string; name?: string; connected: boolean; at: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'proximity', fn: (e: { rssi: number; via: 'BLE' | 'CLASSIC'; address: string; at: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'proximityState', fn: (e: { stopped: boolean }) => void): Promise<PluginListenerHandle>;
}

export const myDevices = registerPlugin<DevicesPlugin>('BlueGuardianDevices');

export function myDevicesSupported(): boolean {
  return isNativeAndroidApp();
}

export function mapsLink(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function deviceLabel(device: Pick<KnownDevice, 'name' | 'address'>): string {
  return device.name?.trim() || `Bluetooth device ${device.address.slice(-5)}`;
}

export function timeAgo(ms: number | undefined, now = Date.now()): string {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** The single best "where was it" answer for a device. */
export function lastPlace(record?: LastSeenRecord): { lat: number; lng: number; accuracy: number; at: number } | null {
  if (!record?.location) return null;
  const { lat, lng, accuracy, fixAt, savedAt } = record.location;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, accuracy, at: savedAt || fixAt };
}

/** Message for the Android share sheet (WhatsApp, SMS, …). */
export function buildShareText(device: Pick<KnownDevice, 'name' | 'address'>, record: LastSeenRecord | undefined, contact?: string): string {
  const name = deviceLabel(device);
  const place = lastPlace(record);
  const when = record?.lastDisconnectedAt ?? record?.lastSeenAt;
  const lines = [`I lost my ${name}.`];
  if (place) {
    lines.push(`It was last with my phone ${when ? new Date(when).toLocaleString() : ''} near this spot (±${Math.max(5, Math.round(place.accuracy))} m):`.replace('  ', ' '));
    lines.push(mapsLink(place.lat, place.lng));
  } else if (when) {
    lines.push(`It was last connected to my phone on ${new Date(when).toLocaleString()}.`);
  }
  lines.push(contact?.trim() ? `If you find it, please contact me: ${contact.trim()}` : 'If you find it, please let me know. Thank you!');
  return lines.join('\n');
}

/** Rough distance band from RSSI, for a hot/cold meter (not a measurement). */
export function proximityBand(rssi: number | null): { label: string; level: number } {
  if (rssi === null) return { label: 'No signal yet', level: 0 };
  if (rssi >= -55) return { label: 'Very close (within ~1 m)', level: 4 };
  if (rssi >= -67) return { label: 'Close (a few metres)', level: 3 };
  if (rssi >= -80) return { label: 'In this area', level: 2 };
  return { label: 'Far / behind walls', level: 1 };
}
