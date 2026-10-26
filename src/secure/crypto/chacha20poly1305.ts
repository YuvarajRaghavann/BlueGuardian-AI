/**
 * ChaCha20-Poly1305 AEAD (RFC 8439). Encrypts and authenticates every
 * secure-link message. Tag failures throw, so tampered frames are dropped.
 */
import { equalBytes } from './bytes';

function rotl(v: number, c: number): number {
  return ((v << c) | (v >>> (32 - c))) >>> 0;
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl(s[b] ^ s[c], 7);
}

function readU32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function chachaBlock(key: Uint8Array, counter: number, nonce: Uint8Array, out: Uint8Array): void {
  const state = new Uint32Array(16);
  state[0] = 0x61707865; state[1] = 0x3320646e; state[2] = 0x79622d32; state[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) state[4 + i] = readU32le(key, i * 4);
  state[12] = counter >>> 0;
  state[13] = readU32le(nonce, 0);
  state[14] = readU32le(nonce, 4);
  state[15] = readU32le(nonce, 8);
  const working = state.slice();
  for (let i = 0; i < 10; i++) {
    quarterRound(working, 0, 4, 8, 12); quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14); quarterRound(working, 3, 7, 11, 15);
    quarterRound(working, 0, 5, 10, 15); quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13); quarterRound(working, 3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) {
    const v = (working[i] + state[i]) >>> 0;
    out[i * 4] = v & 0xff;
    out[i * 4 + 1] = (v >>> 8) & 0xff;
    out[i * 4 + 2] = (v >>> 16) & 0xff;
    out[i * 4 + 3] = (v >>> 24) & 0xff;
  }
}

export function chacha20(key: Uint8Array, nonce: Uint8Array, initialCounter: number, input: Uint8Array): Uint8Array {
  if (key.length !== 32 || nonce.length !== 12) throw new Error('ChaCha20 needs a 32-byte key and 12-byte nonce.');
  const out = new Uint8Array(input.length);
  const block = new Uint8Array(64);
  let counter = initialCounter;
  for (let offset = 0; offset < input.length; offset += 64) {
    chachaBlock(key, counter++, nonce, block);
    const end = Math.min(64, input.length - offset);
    for (let i = 0; i < end; i++) out[offset + i] = input[offset + i] ^ block[i];
  }
  return out;
}

const P1305 = (1n << 130n) - 5n;

function leToBigInt(bytes: Uint8Array, start: number, end: number): bigint {
  let n = 0n;
  for (let i = end - 1; i >= start; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

export function poly1305(key: Uint8Array, message: Uint8Array): Uint8Array {
  const rBytes = key.slice(0, 16);
  rBytes[3] &= 15; rBytes[7] &= 15; rBytes[11] &= 15; rBytes[15] &= 15;
  rBytes[4] &= 252; rBytes[8] &= 252; rBytes[12] &= 252;
  const r = leToBigInt(rBytes, 0, 16);
  const s = leToBigInt(key, 16, 32);
  let acc = 0n;
  for (let offset = 0; offset < message.length; offset += 16) {
    const end = Math.min(offset + 16, message.length);
    const n = leToBigInt(message, offset, end) | (1n << BigInt((end - offset) * 8));
    acc = ((acc + n) * r) % P1305;
  }
  acc = (acc + s) & ((1n << 128n) - 1n);
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    tag[i] = Number(acc & 0xffn);
    acc >>= 8n;
  }
  return tag;
}

function pad16(length: number): number {
  return (16 - (length % 16)) % 16;
}

function macData(aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const total = aad.length + pad16(aad.length) + ciphertext.length + pad16(ciphertext.length) + 16;
  const data = new Uint8Array(total);
  data.set(aad, 0);
  const ctOffset = aad.length + pad16(aad.length);
  data.set(ciphertext, ctOffset);
  const view = new DataView(data.buffer);
  const lenOffset = ctOffset + ciphertext.length + pad16(ciphertext.length);
  view.setUint32(lenOffset, aad.length >>> 0, true);
  view.setUint32(lenOffset + 4, Math.floor(aad.length / 0x100000000), true);
  view.setUint32(lenOffset + 8, ciphertext.length >>> 0, true);
  view.setUint32(lenOffset + 12, Math.floor(ciphertext.length / 0x100000000), true);
  return data;
}

export function aeadEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array = new Uint8Array(0)): Uint8Array {
  const polyKey = new Uint8Array(64);
  chachaBlock(key, 0, nonce, polyKey);
  const ciphertext = chacha20(key, nonce, 1, plaintext);
  const tag = poly1305(polyKey.subarray(0, 32), macData(aad, ciphertext));
  const out = new Uint8Array(ciphertext.length + 16);
  out.set(ciphertext, 0);
  out.set(tag, ciphertext.length);
  return out;
}

export class AuthenticationError extends Error {
  constructor(message = 'Message authentication failed (tampered, replayed or wrong key).') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export function aeadDecrypt(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (sealed.length < 16) throw new AuthenticationError('Ciphertext is shorter than the authentication tag.');
  const ciphertext = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const polyKey = new Uint8Array(64);
  chachaBlock(key, 0, nonce, polyKey);
  const expected = poly1305(polyKey.subarray(0, 32), macData(aad, ciphertext));
  if (!equalBytes(expected, tag)) throw new AuthenticationError();
  return chacha20(key, nonce, 1, ciphertext);
}
