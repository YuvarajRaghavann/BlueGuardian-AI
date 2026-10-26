/**
 * Pinned peers and this phone's identity key.
 *
 * Secrets (identity private key, per-peer recovery secrets) are stored only
 * after being wrapped by an AES-256-GCM key that lives in the Android Keystore
 * (StrongBox when the phone has one). In a desktop browser (development) the
 * wrapper is a no-op and the UI says so.
 */
import { fromBase64, toBase64, toHex } from './crypto/bytes';
import { sha256 } from './crypto/sha256';
import { generateKeyPair, x25519PublicKey, type KeyPair } from './crypto/x25519';

export interface PeerRecord {
  id: string;
  name: string;
  /** Pinned Noise static public key (base64). */
  staticKey: string;
  /** Secret derived at pairing; proves identity during out-of-band re-pair (base64). */
  recoverySecret: string;
  status: 'trusted' | 'revoked';
  pairedAt: number;
  lastSeen: number;
  keyEpoch: number;
  lastTrust?: number;
  revokedReason?: string;
}

export interface PeerDirectory {
  get(id: string): PeerRecord | undefined;
  list(): PeerRecord[];
  upsert(record: PeerRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Wraps secrets with a hardware-backed key when available. */
export interface SecretWrapper {
  readonly hardwareBacked: boolean;
  readonly strongBox: boolean;
  wrap(plaintext: Uint8Array): Promise<string>;
  unwrap(blob: string): Promise<Uint8Array>;
}

export const plainWrapper: SecretWrapper = {
  hardwareBacked: false,
  strongBox: false,
  async wrap(plaintext) {
    return 'plain:' + toBase64(plaintext);
  },
  async unwrap(blob) {
    if (!blob.startsWith('plain:')) throw new Error('This secret was wrapped by the Android Keystore and cannot be read here.');
    return fromBase64(blob.slice(6));
  },
};

export function peerIdForKey(staticKey: Uint8Array): string {
  return toHex(sha256(staticKey)).slice(0, 16);
}

/** Short, human-comparable fingerprint (e.g. "3F2A-91C0-77DE"). */
export function fingerprint(staticKey: Uint8Array): string {
  const hex = toHex(sha256(staticKey)).slice(0, 12).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function safeLocalStorage(): KeyValueStore {
  const memory = new Map<string, string>();
  return {
    getItem(key) {
      try {
        const v = globalThis.localStorage?.getItem(key);
        return v ?? memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      memory.set(key, value);
      try { globalThis.localStorage?.setItem(key, value); } catch { /* memory fallback */ }
    },
    removeItem(key) {
      memory.delete(key);
      try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ }
    },
  };
}

const IDENTITY_KEY = 'blueguardian.secure-identity.v1';
const PEERS_KEY = 'blueguardian.secure-peers.v1';

export async function loadOrCreateIdentity(store: KeyValueStore, wrapper: SecretWrapper): Promise<KeyPair & { created: boolean }> {
  const raw = store.getItem(IDENTITY_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { wrapped: string; publicKey: string };
      const privateKey = await wrapper.unwrap(parsed.wrapped);
      const publicKey = x25519PublicKey(privateKey);
      if (toBase64(publicKey) === parsed.publicKey) return { privateKey, publicKey, created: false };
    } catch {
      // fall through: create a new identity (old pairings will need re-pairing)
    }
  }
  const pair = generateKeyPair();
  store.setItem(IDENTITY_KEY, JSON.stringify({ wrapped: await wrapper.wrap(pair.privateKey), publicKey: toBase64(pair.publicKey) }));
  return { ...pair, created: true };
}

export function resetIdentity(store: KeyValueStore): void {
  store.removeItem(IDENTITY_KEY);
  store.removeItem(PEERS_KEY);
}

interface StoredPeer extends Omit<PeerRecord, 'recoverySecret'> {
  wrappedRecoverySecret: string;
}

export class PersistentPeerDirectory implements PeerDirectory {
  private readonly peers = new Map<string, PeerRecord>();
  private readonly store: KeyValueStore;
  private readonly wrapper: SecretWrapper;
  private readonly listeners = new Set<() => void>();

  private constructor(store: KeyValueStore, wrapper: SecretWrapper) {
    this.store = store;
    this.wrapper = wrapper;
  }

  static async open(store: KeyValueStore, wrapper: SecretWrapper): Promise<PersistentPeerDirectory> {
    const dir = new PersistentPeerDirectory(store, wrapper);
    try {
      const raw = store.getItem(PEERS_KEY);
      const stored = raw ? (JSON.parse(raw) as StoredPeer[]) : [];
      for (const s of stored) {
        try {
          const secret = await wrapper.unwrap(s.wrappedRecoverySecret);
          const { wrappedRecoverySecret: _ignored, ...rest } = s;
          void _ignored;
          dir.peers.set(s.id, { ...rest, recoverySecret: toBase64(secret) });
        } catch {
          // A peer whose secret cannot be unwrapped must be re-paired.
        }
      }
    } catch {
      // Corrupt store: start empty.
    }
    return dir;
  }

  get(id: string): PeerRecord | undefined {
    const p = this.peers.get(id);
    return p ? { ...p } : undefined;
  }

  list(): PeerRecord[] {
    return [...this.peers.values()].map((p) => ({ ...p })).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  async upsert(record: PeerRecord): Promise<void> {
    this.peers.set(record.id, { ...record });
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    this.peers.delete(id);
    await this.persist();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async persist(): Promise<void> {
    const out: StoredPeer[] = [];
    for (const p of this.peers.values()) {
      const { recoverySecret, ...rest } = p;
      out.push({ ...rest, wrappedRecoverySecret: await this.wrapper.wrap(fromBase64(recoverySecret)) });
    }
    this.store.setItem(PEERS_KEY, JSON.stringify(out));
    for (const l of this.listeners) l();
  }
}

export class MemoryPeerDirectory implements PeerDirectory {
  private readonly peers = new Map<string, PeerRecord>();
  get(id: string) { const p = this.peers.get(id); return p ? { ...p } : undefined; }
  list() { return [...this.peers.values()]; }
  async upsert(record: PeerRecord) { this.peers.set(record.id, { ...record }); }
  async remove(id: string) { this.peers.delete(id); }
}
