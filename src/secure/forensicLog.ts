/**
 * Tamper-evident forensic log (port of btguard/forensics.py): every entry
 * commits to the SHA-256 of the previous entry, so editing or deleting a
 * record breaks the chain. Persisted per device; capped, with an anchor hash
 * so the retained tail still verifies.
 */
import { toHex, utf8 } from './crypto/bytes';
import { sha256 } from './crypto/sha256';

export interface ForensicEntry {
  seq: number;
  t: number;
  event: string;
  peer: string;
  data: Record<string, unknown>;
  prev: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);

/** Deterministic JSON (sorted keys) so hashes are reproducible in Python too. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(', ') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ': ' + canonicalJson(obj[k])).join(', ') + '}';
}

function entryHash(body: Omit<ForensicEntry, 'hash'>): string {
  return toHex(sha256(utf8(canonicalJson(body))));
}

export interface ForensicStorage {
  load(): { anchor: string; entries: ForensicEntry[] } | null;
  save(snapshot: { anchor: string; entries: ForensicEntry[] }): void;
}

export class ForensicLog {
  private entries: ForensicEntry[] = [];
  private anchor = GENESIS;
  private nextSeq = 0;
  private readonly storage?: ForensicStorage;
  private readonly maxEntries: number;
  private readonly listeners = new Set<(entry: ForensicEntry) => void>();

  constructor(options: { storage?: ForensicStorage; maxEntries?: number } = {}) {
    this.storage = options.storage;
    this.maxEntries = options.maxEntries ?? 500;
    const snapshot = this.storage?.load();
    if (snapshot && ForensicLog.verifyEntries(snapshot.entries, snapshot.anchor)) {
      this.entries = snapshot.entries;
      this.anchor = snapshot.anchor;
      this.nextSeq = snapshot.entries.length ? snapshot.entries[snapshot.entries.length - 1].seq + 1 : 0;
    } else if (snapshot) {
      // Stored log failed verification: keep evidence of that fact instead of silently resetting.
      this.add('forensic_log_reset', 'local', { reason: 'stored log failed hash-chain verification' });
    }
  }

  add(event: string, peer: string, data: Record<string, unknown> = {}, t = Date.now()): ForensicEntry {
    const prev = this.entries.length ? this.entries[this.entries.length - 1].hash : this.anchor;
    const body = { seq: this.nextSeq++, t, event, peer, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>, prev };
    const entry: ForensicEntry = { ...body, hash: entryHash(body) };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      const dropped = this.entries.splice(0, this.entries.length - this.maxEntries);
      this.anchor = dropped[dropped.length - 1].hash;
    }
    try {
      this.storage?.save({ anchor: this.anchor, entries: this.entries });
    } catch {
      // Storage is best-effort; the in-memory chain stays valid.
    }
    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  list(): ForensicEntry[] {
    return [...this.entries];
  }

  subscribe(listener: (entry: ForensicEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  verify(): boolean {
    return ForensicLog.verifyEntries(this.entries, this.anchor);
  }

  exportJson(): string {
    return JSON.stringify({ anchor: this.anchor, entries: this.entries }, null, 2);
  }

  static verifyEntries(entries: ForensicEntry[], anchor = GENESIS): boolean {
    let prev = anchor;
    for (const e of entries) {
      if (e.prev !== prev) return false;
      const { hash, ...body } = e;
      if (entryHash(body) !== hash) return false;
      prev = hash;
    }
    return true;
  }
}

export function localStorageForensicStorage(key = 'blueguardian.forensic-log.v1'): ForensicStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        return raw ? (JSON.parse(raw) as { anchor: string; entries: ForensicEntry[] }) : null;
      } catch {
        return null;
      }
    },
    save(snapshot) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(snapshot));
      } catch {
        // Quota or private mode: keep running with the in-memory log.
      }
    },
  };
}
