/**
 * X25519 (RFC 7748) Diffie-Hellman using a Montgomery ladder over BigInt.
 * Used for Noise ephemeral and static keys. Portable to every Android WebView,
 * including versions whose WebCrypto lacks X25519.
 */
import { randomBytes } from './bytes';

const P = (1n << 255n) - 19n;
const A24 = 121665n;

function mod(a: bigint): bigint {
  const r = a % P;
  return r >= 0n ? r : r + P;
}

function powMod(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b);
    b = mod(b * b);
    e >>= 1n;
  }
  return result;
}

function decodeLittleEndian(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

function encodeLittleEndian(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function decodeScalar(k: Uint8Array): bigint {
  const s = k.slice(0, 32);
  s[0] &= 248;
  s[31] &= 127;
  s[31] |= 64;
  return decodeLittleEndian(s);
}

function decodeU(u: Uint8Array): bigint {
  const c = u.slice(0, 32);
  c[31] &= 127;
  return decodeLittleEndian(c) % P;
}

export function x25519(scalar: Uint8Array, uCoordinate: Uint8Array): Uint8Array {
  if (scalar.length !== 32 || uCoordinate.length !== 32) throw new Error('X25519 inputs must be 32 bytes.');
  const k = decodeScalar(scalar);
  const x1 = decodeU(uCoordinate);
  let x2 = 1n, z2 = 0n, x3 = x1, z3 = 1n;
  let swap = 0n;
  for (let t = 254n; t >= 0n; t--) {
    const kt = (k >> t) & 1n;
    swap ^= kt;
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
    swap = kt;
    const a = mod(x2 + z2);
    const aa = mod(a * a);
    const b = mod(x2 - z2);
    const bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = mod(d * a);
    const cb = mod(c * b);
    const s1 = mod(da + cb);
    x3 = mod(s1 * s1);
    const s2 = mod(da - cb);
    z3 = mod(x1 * mod(s2 * s2));
    x2 = mod(aa * bb);
    z2 = mod(e * mod(aa + A24 * e));
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
  const result = encodeLittleEndian(mod(x2 * powMod(z2, P - 2n)));
  // Reject low-order peer points (all-zero shared secret), per RFC 7748 section 6.1.
  let acc = 0;
  for (const b of result) acc |= b;
  if (acc === 0) throw new Error('X25519 produced an all-zero shared secret (invalid peer key).');
  return result;
}

const BASE_POINT = (() => {
  const u = new Uint8Array(32);
  u[0] = 9;
  return u;
})();

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function x25519PublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519(privateKey, BASE_POINT);
}

export function generateKeyPair(): KeyPair {
  const privateKey = randomBytes(32);
  return { privateKey, publicKey: x25519PublicKey(privateKey) };
}
