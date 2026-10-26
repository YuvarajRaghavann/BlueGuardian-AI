/**
 * SHA-256 (FIPS 180-4), HMAC-SHA-256 (RFC 2104) and the HKDF used by Noise.
 * Synchronous and incremental, so large files can be hashed chunk by chunk.
 */
import { concatBytes } from './bytes';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private block = new Uint8Array(64);
  private blockLength = 0;
  private totalLength = 0;
  private w = new Uint32Array(64);
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('SHA-256 instance already finalized.');
    let offset = 0;
    this.totalLength += data.length;
    if (this.blockLength > 0) {
      const take = Math.min(64 - this.blockLength, data.length);
      this.block.set(data.subarray(0, take), this.blockLength);
      this.blockLength += take;
      offset = take;
      if (this.blockLength === 64) {
        this.compress(this.block, 0);
        this.blockLength = 0;
      }
    }
    while (offset + 64 <= data.length) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < data.length) {
      this.block.set(data.subarray(offset), 0);
      this.blockLength = data.length - offset;
    }
    return this;
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error('SHA-256 instance already finalized.');
    this.finished = true;
    const bitLength = this.totalLength * 8;
    const padLength = this.blockLength < 56 ? 56 - this.blockLength : 120 - this.blockLength;
    const tail = new Uint8Array(padLength + 8);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(padLength, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(padLength + 4, bitLength >>> 0, false);
    // Feed padding through the block logic without touching totalLength.
    let offset = 0;
    while (offset < tail.length) {
      const take = Math.min(64 - this.blockLength, tail.length - offset);
      this.block.set(tail.subarray(offset, offset + take), this.blockLength);
      this.blockLength += take;
      offset += take;
      if (this.blockLength === 64) {
        this.compress(this.block, 0);
        this.blockLength = 0;
      }
    }
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outView.setUint32(i * 4, this.h[i], false);
    return out;
  }

  private compress(data: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = this.h[0], b = this.h[1], c = this.h[2], d = this.h[3];
    let e = this.h[4], f = this.h[5], g = this.h[6], h = this.h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    this.h[0] = (this.h[0] + a) >>> 0; this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0; this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0; this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0; this.h[7] = (this.h[7] + h) >>> 0;
  }
}

export function sha256(...parts: Uint8Array[]): Uint8Array {
  const hash = new Sha256();
  for (const part of parts) hash.update(part);
  return hash.digest();
}

export function hmacSha256(key: Uint8Array, ...parts: Uint8Array[]): Uint8Array {
  const k = key.length > 64 ? sha256(key) : key;
  const padded = new Uint8Array(64);
  padded.set(k);
  const ipad = padded.map((b) => b ^ 0x36);
  const opad = padded.map((b) => b ^ 0x5c);
  const inner = new Sha256().update(ipad);
  for (const part of parts) inner.update(part);
  return sha256(opad, inner.digest());
}

/** Noise HKDF (Noise spec section 4.3): returns 2 or 3 32-byte outputs. */
export function noiseHkdf(chainingKey: Uint8Array, inputKeyMaterial: Uint8Array, outputs: 2 | 3): Uint8Array[] {
  const tempKey = hmacSha256(chainingKey, inputKeyMaterial);
  const out1 = hmacSha256(tempKey, Uint8Array.of(1));
  const out2 = hmacSha256(tempKey, out1, Uint8Array.of(2));
  if (outputs === 2) return [out1, out2];
  const out3 = hmacSha256(tempKey, out2, Uint8Array.of(3));
  return [out1, out2, out3];
}

/** RFC 5869 HKDF-SHA-256 for app-level key derivation (recovery secrets, labels). */
export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const prk = hmacSha256(salt.length ? salt : new Uint8Array(32), ikm);
  const blocks: Uint8Array[] = [];
  let previous: Uint8Array = new Uint8Array(0);
  for (let i = 1; blocks.length * 32 < length; i++) {
    previous = hmacSha256(prk, previous, info, Uint8Array.of(i));
    blocks.push(previous);
  }
  return concatBytes(...blocks).slice(0, length);
}
