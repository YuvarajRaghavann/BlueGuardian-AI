/**
 * Bridge to the native BlueGuardianSecureLink plugin (Android).
 * The plugin only moves opaque encrypted frames, wraps secrets with the
 * Android Keystore, and stores received files in an app-private quarantine.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { fromBase64, toBase64 } from '../secure/crypto/bytes';
import type { SecretWrapper } from '../secure/peerStore';
import type { FileManifest } from '../secure/protocol';
import type { QuarantineSink } from '../secure/session';
import { isNativeAndroidApp } from './nativeBluetoothService';

export interface SecureLinkCapabilities {
  sdk: number;
  l2cap: boolean;
  bluetoothEnabled: boolean;
  advertising: boolean;
  strongBox: boolean;
  channelSounding: boolean;
}

export interface DiscoveredHost {
  address: string;
  rssi: number;
  psm: number;
  code: string;
  observedAt: number;
}

export interface LinkStateEvent {
  state: 'connected' | 'closed' | 'error';
  role?: 'host' | 'client';
  address?: string;
  message?: string;
}

export interface QuarantineEntry {
  key: string;
  name: string;
  mime: string;
  kind: string;
  size: number;
  from: string;
  receivedAt: number;
}

interface SecureLinkPlugin {
  getCapabilities(): Promise<SecureLinkCapabilities>;
  startHosting(options: { code: string }): Promise<{ psm: number; code: string }>;
  stopHosting(): Promise<void>;
  discoverHosts(options: { durationMs: number }): Promise<{ durationMs: number }>;
  stopDiscovery(): Promise<void>;
  connect(options: { address: string; psm: number }): Promise<{ connected: boolean }>;
  send(options: { data: string }): Promise<void>;
  disconnect(): Promise<void>;
  keystoreInfo(): Promise<{ available: boolean; strongBox?: boolean; message?: string }>;
  wrapSecret(options: { data: string }): Promise<{ blob: string }>;
  unwrapSecret(options: { blob: string }): Promise<{ data: string }>;
  quarantineOpen(options: { key: string; name: string; size: number }): Promise<{ existingBytes: number }>;
  quarantineWrite(options: { key: string; offset: number; data: string }): Promise<void>;
  quarantineFinalize(options: { key: string }): Promise<{ sha256: string; size: number; head: string }>;
  quarantineDiscard(options: { key: string }): Promise<void>;
  quarantineAccept(options: { key: string; name: string; mime: string; kind: string; size: number; from: string }): Promise<void>;
  quarantineList(): Promise<{ files: QuarantineEntry[] }>;
  quarantineExport(options: { key: string }): Promise<{ location: string }>;
  addListener(event: 'hostFound', fn: (host: DiscoveredHost) => void): Promise<PluginListenerHandle>;
  addListener(event: 'discoveryState', fn: (state: { state: string; message?: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'linkState', fn: (state: LinkStateEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'linkFrame', fn: (frame: { data: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'linkAttempt', fn: (attempt: { address: string; observedAt: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'peerRssi', fn: (event: { rssi: number; observedAt: number }) => void): Promise<PluginListenerHandle>;
}

export const secureLinkPlugin = registerPlugin<SecureLinkPlugin>('BlueGuardianSecureLink');

export function isSecureLinkSupported(): boolean {
  return isNativeAndroidApp();
}

export async function getSecureLinkCapabilities(): Promise<SecureLinkCapabilities | null> {
  if (!isSecureLinkSupported()) return null;
  try {
    return await secureLinkPlugin.getCapabilities();
  } catch {
    return null;
  }
}

export async function createKeystoreWrapper(): Promise<SecretWrapper> {
  const info = await secureLinkPlugin.keystoreInfo();
  if (!info.available) throw new Error(info.message || 'The Android Keystore is not available on this phone.');
  return {
    hardwareBacked: true,
    strongBox: !!info.strongBox,
    async wrap(plaintext) {
      return (await secureLinkPlugin.wrapSecret({ data: toBase64(plaintext) })).blob;
    },
    async unwrap(blob) {
      return fromBase64((await secureLinkPlugin.unwrapSecret({ blob })).data);
    },
  };
}

export class NativeQuarantineSink implements QuarantineSink {
  async open(manifest: FileManifest): Promise<{ existingBytes: number }> {
    return secureLinkPlugin.quarantineOpen({ key: manifest.sha256, name: manifest.name, size: manifest.size });
  }

  async write(key: string, offset: number, data: Uint8Array): Promise<void> {
    await secureLinkPlugin.quarantineWrite({ key, offset, data: toBase64(data) });
  }

  async finalize(key: string): Promise<{ sha256: string; size: number; head: Uint8Array }> {
    const result = await secureLinkPlugin.quarantineFinalize({ key });
    return { sha256: result.sha256, size: result.size, head: fromBase64(result.head) };
  }

  async discard(key: string): Promise<void> {
    await secureLinkPlugin.quarantineDiscard({ key });
  }

  async accept(key: string, info: { name: string; mime: string; kind: string; size: number; from: string }): Promise<void> {
    await secureLinkPlugin.quarantineAccept({ key, ...info });
  }

  async list(): Promise<QuarantineEntry[]> {
    const { files } = await secureLinkPlugin.quarantineList();
    return [...files].sort((a, b) => b.receivedAt - a.receivedAt);
  }

  async exportToDownloads(key: string): Promise<string> {
    return (await secureLinkPlugin.quarantineExport({ key })).location;
  }

  async remove(key: string): Promise<void> {
    await secureLinkPlugin.quarantineDiscard({ key });
  }
}

/** Random 4-digit code shown on the hosting phone so the other phone picks the right one. */
export function newHostCode(): string {
  const n = new Uint16Array(1);
  globalThis.crypto.getRandomValues(n);
  return String(n[0] % 10000).padStart(4, '0');
}
