/** In-memory quarantine for browser development and tests (the APK uses app-private storage). */
import { concatBytes, toHex } from './crypto/bytes';
import { sha256 } from './crypto/sha256';
import type { FileManifest } from './protocol';
import type { QuarantineSink } from './session';

export interface QuarantinedFile {
  key: string;
  name: string;
  mime: string;
  kind: string;
  size: number;
  from: string;
  receivedAt: number;
}

export class MemoryQuarantineSink implements QuarantineSink {
  readonly partial = new Map<string, Uint8Array>();
  readonly files = new Map<string, QuarantinedFile & { data: Uint8Array }>();

  async open(manifest: FileManifest): Promise<{ existingBytes: number }> {
    const existing = this.partial.get(manifest.sha256);
    return { existingBytes: existing ? existing.length : 0 };
  }

  async write(key: string, offset: number, data: Uint8Array): Promise<void> {
    const current = this.partial.get(key) ?? new Uint8Array(0);
    if (offset !== current.length) throw new Error('Quarantine writes must be sequential.');
    this.partial.set(key, concatBytes(current, data));
  }

  async finalize(key: string): Promise<{ sha256: string; size: number; head: Uint8Array }> {
    const data = this.partial.get(key) ?? new Uint8Array(0);
    return { sha256: toHex(sha256(data)), size: data.length, head: data.slice(0, 64) };
  }

  async discard(key: string): Promise<void> {
    this.partial.delete(key);
  }

  async accept(key: string, info: { name: string; mime: string; kind: string; size: number; from: string }): Promise<void> {
    const data = this.partial.get(key) ?? new Uint8Array(0);
    this.partial.delete(key);
    this.files.set(key, { key, ...info, receivedAt: Date.now(), data });
  }
}
