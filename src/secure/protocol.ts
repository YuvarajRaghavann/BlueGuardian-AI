/**
 * Secure Link wire format.
 *
 * Outer frame (one per native L2CAP frame):   [kind:1][body]
 *   kind 0x01..0x03  Noise XX handshake messages 1..3 (body = Noise message)
 *   kind 0x10        transport message (body = ChaCha20-Poly1305 ciphertext)
 *
 * Inner record (plaintext of a transport message): [type:1][body]
 *   type 0x01  control message, UTF-8 JSON (see ControlMessage)
 *   type 0x02  file chunk: [transferId:16][index:u32 BE][bytes]
 */
import { concatBytes, fromHex, fromUtf8, readU32be, toHex, u32be, utf8 } from './crypto/bytes';

export const FRAME_HS1 = 0x01;
export const FRAME_HS2 = 0x02;
export const FRAME_HS3 = 0x03;
export const FRAME_DATA = 0x10;
export const RECORD_CONTROL = 0x01;
export const RECORD_CHUNK = 0x02;
export const PROTOCOL_VERSION = 1;
export const PROLOGUE = utf8('BlueGuardian-SecureLink-v1');

export interface FileManifest {
  /** Random 16-byte transfer id (hex). */
  id: string;
  name: string;
  size: number;
  /** SHA-256 of the whole file (hex). Also the resume key. */
  sha256: string;
  mime: string;
  chunkSize: number;
  chunks: number;
  createdAt: number;
}

export type ControlMessage =
  | { t: 'verified' }
  | { t: 'verify_rejected'; reason: string }
  | { t: 'recover_challenge'; c: string }
  | { t: 'recover_response'; r: string }
  | { t: 'ping'; id: number; ts: number }
  | { t: 'pong'; id: number; ts: number }
  | { t: 'chat'; id: string; text: string }
  | { t: 'rekey' }
  | { t: 'trust'; level: string; score: number }
  | { t: 'isolated'; reason: string }
  | { t: 'file_offer'; manifest: FileManifest }
  | { t: 'file_accept'; id: string; resumeFrom: number }
  | { t: 'file_reject'; id: string; reason: string }
  | { t: 'file_done'; id: string }
  | { t: 'file_result'; id: string; ok: boolean; reason?: string }
  | { t: 'file_cancel'; id: string; reason: string }
  | { t: 'bye'; reason: string };

export interface HandshakePayload1 { v: number; commit: string }
export interface HandshakePayload2 { v: number; name: string; nr: string }
export interface HandshakePayload3 { v: number; name: string; ni: string }

export function frame(kind: number, body: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(kind), body);
}

export function encodeControl(message: ControlMessage): Uint8Array {
  return concatBytes(Uint8Array.of(RECORD_CONTROL), utf8(JSON.stringify(message)));
}

export function encodeChunk(transferId: string, index: number, data: Uint8Array): Uint8Array {
  const id = fromHex(transferId);
  if (id.length !== 16) throw new Error('Transfer id must be 16 bytes.');
  return concatBytes(Uint8Array.of(RECORD_CHUNK), id, u32be(index), data);
}

export type DecodedRecord =
  | { type: 'control'; message: ControlMessage }
  | { type: 'chunk'; transferId: string; index: number; data: Uint8Array };

export function decodeRecord(record: Uint8Array): DecodedRecord {
  if (record.length < 1) throw new Error('Empty record.');
  if (record[0] === RECORD_CONTROL) {
    const parsed: unknown = JSON.parse(fromUtf8(record.subarray(1)));
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { t?: unknown }).t !== 'string') {
      throw new Error('Malformed control message.');
    }
    return { type: 'control', message: parsed as ControlMessage };
  }
  if (record[0] === RECORD_CHUNK) {
    if (record.length < 21) throw new Error('Truncated file chunk.');
    return {
      type: 'chunk',
      transferId: toHex(record.subarray(1, 17)),
      index: readU32be(record, 17),
      data: record.subarray(21),
    };
  }
  throw new Error(`Unknown record type ${record[0]}.`);
}

export function encodeJson(value: unknown): Uint8Array {
  return utf8(JSON.stringify(value));
}

export function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(fromUtf8(bytes)) as T;
}
