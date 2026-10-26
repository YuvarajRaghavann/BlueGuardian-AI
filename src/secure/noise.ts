/**
 * Noise_XX_25519_ChaChaPoly_SHA256 (Noise Protocol Framework rev 34).
 *
 *   -> e
 *   <- e, ee, s, es
 *   -> s, se
 *
 * Gives mutual authentication of static (identity) keys and forward secrecy,
 * independent of how weakly the Bluetooth link itself was paired.
 * Transport messages use strictly increasing 64-bit counters as nonces, so a
 * replayed, reordered or tampered frame fails authentication and is rejected.
 */
import { aeadDecrypt, aeadEncrypt } from './crypto/chacha20poly1305';
import { concatBytes, equalBytes, utf8 } from './crypto/bytes';
import { noiseHkdf, sha256 } from './crypto/sha256';
import { generateKeyPair, x25519, type KeyPair } from './crypto/x25519';

export const NOISE_PROTOCOL_NAME = 'Noise_XX_25519_ChaChaPoly_SHA256';
export const MAX_NOISE_MESSAGE = 65535;
const DHLEN = 32;
const MAX_NONCE = Number.MAX_SAFE_INTEGER; // well below 2^64-1; we rekey long before

function nonceBytes(n: number): Uint8Array {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, n >>> 0, true);
  view.setUint32(8, Math.floor(n / 0x100000000), true);
  return nonce;
}

export class CipherState {
  private k: Uint8Array | null = null;
  private n = 0;

  initializeKey(key: Uint8Array | null): void {
    this.k = key ? key.slice() : null;
    this.n = 0;
  }

  hasKey(): boolean {
    return this.k !== null;
  }

  /** Messages sent/received with the current key (used to schedule rekeys). */
  get counter(): number {
    return this.n;
  }

  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (!this.k) return plaintext;
    if (this.n >= MAX_NONCE) throw new Error('Nonce exhausted; the session must be rekeyed.');
    const out = aeadEncrypt(this.k, nonceBytes(this.n), plaintext, ad);
    this.n += 1;
    return out;
  }

  /** Throws AuthenticationError on failure; the nonce is not advanced in that case. */
  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (!this.k) return ciphertext;
    if (this.n >= MAX_NONCE) throw new Error('Nonce exhausted; the session must be rekeyed.');
    const out = aeadDecrypt(this.k, nonceBytes(this.n), ciphertext, ad);
    this.n += 1;
    return out;
  }

  /** Noise Rekey(): k = ENCRYPT(k, 2^64-1, empty, zeros)[0:32]. Counter keeps running. */
  rekey(): void {
    if (!this.k) return;
    const maxNonce = new Uint8Array(12).fill(0xff, 4);
    const next = aeadEncrypt(this.k, maxNonce, new Uint8Array(32), new Uint8Array(0)).slice(0, 32);
    this.k.fill(0);
    this.k = next;
  }

  destroy(): void {
    if (this.k) this.k.fill(0);
    this.k = null;
  }
}

class SymmetricState {
  readonly cipher = new CipherState();
  ck: Uint8Array;
  h: Uint8Array;

  constructor(protocolName: string) {
    const name = utf8(protocolName);
    if (name.length <= 32) {
      this.h = new Uint8Array(32);
      this.h.set(name);
    } else {
      this.h = sha256(name);
    }
    this.ck = this.h.slice();
  }

  mixKey(input: Uint8Array): void {
    const [ck, tempK] = noiseHkdf(this.ck, input, 2);
    this.ck = ck;
    this.cipher.initializeKey(tempK);
  }

  mixHash(data: Uint8Array): void {
    this.h = sha256(this.h, data);
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.cipher.encryptWithAd(this.h, plaintext);
    this.mixHash(ciphertext);
    return ciphertext;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.cipher.decryptWithAd(this.h, ciphertext);
    this.mixHash(ciphertext);
    return plaintext;
  }

  split(): [CipherState, CipherState] {
    const [k1, k2] = noiseHkdf(this.ck, new Uint8Array(0), 2);
    const c1 = new CipherState();
    const c2 = new CipherState();
    c1.initializeKey(k1);
    c2.initializeKey(k2);
    return [c1, c2];
  }
}

export interface TransportKeys {
  send: CipherState;
  receive: CipherState;
  /** Final handshake hash; channel binding value for SAS codes and recovery secrets. */
  handshakeHash: Uint8Array;
  remoteStaticKey: Uint8Array;
}

/**
 * One XX handshake. Call writeMessage/readMessage in turn; after the third
 * message isComplete() is true and split() returns the transport ciphers.
 */
export class XXHandshake {
  private readonly ss: SymmetricState;
  private readonly s: KeyPair;
  private e: KeyPair | null = null;
  private re: Uint8Array | null = null;
  private rs: Uint8Array | null = null;
  private step = 0;
  private readonly initiator: boolean;
  private readonly ephemeralFactory: () => KeyPair;

  constructor(options: {
    initiator: boolean;
    staticKeyPair: KeyPair;
    prologue?: Uint8Array;
    /** Testing hook for deterministic vectors. */
    ephemeralFactory?: () => KeyPair;
  }) {
    this.initiator = options.initiator;
    this.s = options.staticKeyPair;
    this.ephemeralFactory = options.ephemeralFactory ?? generateKeyPair;
    this.ss = new SymmetricState(NOISE_PROTOCOL_NAME);
    this.ss.mixHash(options.prologue ?? new Uint8Array(0));
  }

  get isInitiator(): boolean {
    return this.initiator;
  }

  /** Whether it is this side's turn to write the next handshake message. */
  get myTurn(): boolean {
    return this.initiator ? this.step % 2 === 0 : this.step % 2 === 1;
  }

  isComplete(): boolean {
    return this.step >= 3;
  }

  get remoteStaticKey(): Uint8Array | null {
    return this.rs ? this.rs.slice() : null;
  }

  get handshakeHash(): Uint8Array {
    return this.ss.h.slice();
  }

  writeMessage(payload: Uint8Array = new Uint8Array(0)): Uint8Array {
    if (!this.myTurn || this.isComplete()) throw new Error('Handshake message written out of order.');
    const parts: Uint8Array[] = [];
    if (this.step === 0) {
      this.e = this.ephemeralFactory();
      this.ss.mixHash(this.e.publicKey);
      parts.push(this.e.publicKey);
    } else if (this.step === 1) {
      this.e = this.ephemeralFactory();
      this.ss.mixHash(this.e.publicKey);
      parts.push(this.e.publicKey);
      this.ss.mixKey(x25519(this.e.privateKey, this.need(this.re)));
      parts.push(this.ss.encryptAndHash(this.s.publicKey));
      this.ss.mixKey(x25519(this.s.privateKey, this.need(this.re)));
    } else {
      parts.push(this.ss.encryptAndHash(this.s.publicKey));
      this.ss.mixKey(x25519(this.s.privateKey, this.need(this.re)));
    }
    parts.push(this.ss.encryptAndHash(payload));
    this.step += 1;
    const message = concatBytes(...parts);
    if (message.length > MAX_NOISE_MESSAGE) throw new Error('Handshake payload is too large.');
    return message;
  }

  readMessage(message: Uint8Array): Uint8Array {
    if (this.myTurn || this.isComplete()) throw new Error('Handshake message received out of order.');
    let offset = 0;
    const take = (length: number): Uint8Array => {
      if (offset + length > message.length) throw new Error('Handshake message is truncated.');
      const out = message.subarray(offset, offset + length);
      offset += length;
      return out;
    };
    if (this.step === 0) {
      this.re = take(DHLEN).slice();
      this.ss.mixHash(this.re);
    } else if (this.step === 1) {
      this.re = take(DHLEN).slice();
      this.ss.mixHash(this.re);
      this.ss.mixKey(x25519(this.need(this.e).privateKey, this.re));
      this.rs = this.ss.decryptAndHash(take(DHLEN + 16)).slice();
      this.ss.mixKey(x25519(this.need(this.e).privateKey, this.rs));
    } else {
      this.rs = this.ss.decryptAndHash(take(DHLEN + 16)).slice();
      this.ss.mixKey(x25519(this.need(this.e).privateKey, this.rs));
    }
    const payload = this.ss.decryptAndHash(message.subarray(offset));
    this.step += 1;
    return payload;
  }

  split(): TransportKeys {
    if (!this.isComplete() || !this.rs) throw new Error('Handshake is not complete.');
    const [c1, c2] = this.ss.split();
    if (this.e) this.e.privateKey.fill(0);
    return {
      send: this.initiator ? c1 : c2,
      receive: this.initiator ? c2 : c1,
      handshakeHash: this.ss.h.slice(),
      remoteStaticKey: this.rs.slice(),
    };
  }

  private need<T>(value: T | null): T {
    if (value === null) throw new Error('Handshake state is missing a key.');
    return value;
  }
}

export function sameKey(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  return !!a && !!b && equalBytes(a, b);
}
