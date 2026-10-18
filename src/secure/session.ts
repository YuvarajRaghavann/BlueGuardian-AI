/**
 * SecureSession: one encrypted, continuously trust-scored link to one peer.
 *
 *  1. Noise XX handshake with a commit/reveal nonce exchange, so the 6-digit
 *     comparison code cannot be ground by a man in the middle.
 *  2. Users compare the code once; the peer's static key is then pinned and
 *     later reconnections are verified automatically.
 *  3. Every second the BTGuard trust engine scores the link. Losing trust
 *     removes file transfer first (RESTRICTED), rotates keys, and at ISOLATED
 *     revokes the pairing and closes the link until an out-of-band re-pair.
 *  4. Files move as an authenticated manifest plus encrypted chunks into an
 *     app-private quarantine, are hash- and type-checked, and are never opened
 *     automatically. Interrupted transfers resume.
 *
 * Transport-agnostic: the Android L2CAP plugin and the unit tests both plug in
 * through FrameTransport.
 */
import { concatBytes, equalBytes, fromBase64, randomBytes, toBase64, toHex, utf8 } from './crypto/bytes';
import { hkdfSha256, hmacSha256, sha256, Sha256 } from './crypto/sha256';
import type { KeyPair } from './crypto/x25519';
import { checkContentPolicy, checkOfferPolicy, CHUNK_SIZE, MAX_FILE_BYTES, mimeForName, sanitizeFileName } from './fileTypes';
import type { ForensicLog } from './forensicLog';
import { XXHandshake, type CipherState } from './noise';
import { peerIdForKey, fingerprint, type PeerDirectory, type PeerRecord } from './peerStore';
import {
  decodeJson, decodeRecord, encodeChunk, encodeControl, encodeJson, frame,
  FRAME_DATA, FRAME_HS1, FRAME_HS2, FRAME_HS3, PROLOGUE, PROTOCOL_VERSION,
  type ControlMessage, type DecodedRecord, type FileManifest, type HandshakePayload1, type HandshakePayload2, type HandshakePayload3,
} from './protocol';
import { TrustEngine, type LinkObservation, type TrustDecision } from './trustEngine';

export interface FrameTransport {
  send(frame: Uint8Array): Promise<void>;
  close(reason: string): Promise<void>;
}

export interface FileSource {
  name: string;
  size: number;
  type?: string;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface QuarantineSink {
  /** Create or reopen the partial file for this manifest; returns bytes already stored (resume). */
  open(manifest: FileManifest): Promise<{ existingBytes: number }>;
  write(key: string, offset: number, data: Uint8Array): Promise<void>;
  /** Hash the stored file on disk and return its first bytes for type checking. */
  finalize(key: string): Promise<{ sha256: string; size: number; head: Uint8Array }>;
  discard(key: string): Promise<void>;
  /** Record a verified file in the quarantine list. */
  accept(key: string, info: { name: string; mime: string; kind: string; size: number; from: string }): Promise<void>;
}

export type SessionPhase = 'handshaking' | 'verifying' | 'active' | 'closed';

export interface VerifyInfo {
  sas: string;
  peerId: string;
  peerName: string;
  peerFingerprint: string;
  /** Peer already pinned and trusted: verified automatically. */
  known: boolean;
  /** A record exists but is revoked (awaiting out-of-band re-pair). */
  repair: boolean;
}

export interface TransferProgress {
  id: string;
  direction: 'send' | 'receive';
  name: string;
  size: number;
  bytes: number;
  state: 'offered' | 'awaiting_approval' | 'transferring' | 'verifying' | 'done' | 'failed' | 'rejected' | 'cancelled';
  reason?: string;
  resumedFrom?: number;
  kind?: string;
}

export interface ChatMessage {
  id: string;
  from: 'me' | 'peer';
  text: string;
  at: number;
}

export interface SessionEvents {
  onPhase?(phase: SessionPhase, detail?: string): void;
  onVerify?(info: VerifyInfo): void;
  onTrust?(decision: TrustDecision): void;
  onChat?(message: ChatMessage): void;
  onOffer?(manifest: FileManifest, resumeFromBytes: number): void;
  onTransfer?(progress: TransferProgress): void;
  onNotice?(text: string, tone: 'info' | 'warning' | 'danger' | 'success'): void;
}

export interface SessionOptions {
  role: 'initiator' | 'responder';
  identity: KeyPair;
  localName: string;
  transport: FrameTransport;
  peers: PeerDirectory;
  engine: TrustEngine;
  log: ForensicLog;
  sink: QuarantineSink;
  events?: SessionEvents;
  now?: () => number;
  /** Rekey after this many messages in one direction (default 500). */
  rekeyEveryMessages?: number;
  /** Rekey after this long (default 120 s). */
  rekeyEveryMs?: number;
  maxFileBytes?: number;
  /** Frames per second treated as a protocol violation (flood). */
  maxFramesPerSecond?: number;
}

interface OutgoingTransfer {
  manifest: FileManifest;
  source: FileSource;
  resolveAccept: (resumeFrom: number | null, reason?: string) => void;
  resolveResult: (ok: boolean, reason?: string) => void;
  cancelled: string | null;
}

interface IncomingTransfer {
  manifest: FileManifest;
  key: string;
  nextIndex: number;
  bytes: number;
  approved: boolean;
  done: boolean;
}

function sasFromHash(h: Uint8Array, ni: Uint8Array, nr: Uint8Array): string {
  const mac = hmacSha256(h, utf8('blueguardian-sas'), ni, nr);
  const n = ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

export class SecureSession {
  phase: SessionPhase = 'handshaking';
  peerId: string | null = null;
  peerName = 'Unknown device';
  verifyInfo: VerifyInfo | null = null;
  lastDecision: TrustDecision | null = null;

  private readonly o: SessionOptions;
  private readonly hs: XXHandshake;
  private send: CipherState | null = null;
  private recv: CipherState | null = null;
  private handshakeHash: Uint8Array | null = null;
  private remoteStatic: Uint8Array | null = null;
  private ni: Uint8Array | null = null;
  private nr: Uint8Array | null = null;
  private niCommit: Uint8Array | null = null;
  private localVerified = false;
  private remoteVerified = false;
  private repairMode = false;
  private recoveryChallenge: Uint8Array | null = null;
  private recoveryProofOk = false;
  private remoteRecoveryAnswered = false;
  private inbox: Promise<void> = Promise.resolve();
  private lastRekeyAt = 0;
  private sentSinceRekey = 0;
  private pingId = 0;
  private readonly outgoing = new Map<string, OutgoingTransfer>();
  private readonly incoming = new Map<string, IncomingTransfer>();
  // telemetry for the current window
  private framesIn = 0;
  private authFailures = 0;
  private protocolErrors = 0;
  private pairAttempts = 0;
  private rtts: number[] = [];
  private rssi: number | null = null;
  private closed = false;

  constructor(options: SessionOptions) {
    this.o = options;
    this.hs = new XXHandshake({ initiator: options.role === 'initiator', staticKeyPair: options.identity, prologue: PROLOGUE });
  }

  private now(): number {
    return this.o.now ? this.o.now() : Date.now();
  }

  private setPhase(phase: SessionPhase, detail?: string): void {
    this.phase = phase;
    this.o.events?.onPhase?.(phase, detail);
  }

  private notice(text: string, tone: 'info' | 'warning' | 'danger' | 'success' = 'info'): void {
    this.o.events?.onNotice?.(text, tone);
  }

  // ---------------------------------------------------------------- handshake
  async start(): Promise<void> {
    if (this.o.role !== 'initiator') return;
    this.ni = randomBytes(32);
    this.niCommit = sha256(this.ni);
    const payload: HandshakePayload1 = { v: PROTOCOL_VERSION, commit: toBase64(this.niCommit) };
    await this.o.transport.send(frame(FRAME_HS1, this.hs.writeMessage(encodeJson(payload))));
  }

  /** Feed one received frame. Frames are processed strictly in order. */
  receiveFrame(data: Uint8Array): Promise<void> {
    this.inbox = this.inbox.then(() => this.handleFrame(data)).catch((error: unknown) => {
      this.notice(error instanceof Error ? error.message : 'Secure link error.', 'danger');
    });
    return this.inbox;
  }

  /** Native layer reports extra connection attempts while this session is live. */
  notePairAttempt(): void {
    this.pairAttempts += 1;
  }

  setPeerRssi(rssi: number | null): void {
    this.rssi = rssi;
  }

  private async handleFrame(data: Uint8Array): Promise<void> {
    if (this.closed || data.length === 0) return;
    const kind = data[0];
    const body = data.subarray(1);
    if (kind === FRAME_DATA) {
      await this.handleTransport(body);
      return;
    }
    try {
      await this.handleHandshake(kind, body);
    } catch (error) {
      this.pairAttempts += 1;
      this.o.log.add('handshake_failed', this.peerId ?? 'unknown', { reason: error instanceof Error ? error.message : String(error) });
      await this.close('handshake failed', false);
      throw new Error('Secure handshake failed. The other phone may be running a different version or the link was tampered with.');
    }
  }

  private async handleHandshake(kind: number, body: Uint8Array): Promise<void> {
    if (this.o.role === 'responder' && kind === FRAME_HS1) {
      const p1 = decodeJson<HandshakePayload1>(this.hs.readMessage(body));
      if (p1.v !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version.');
      this.niCommit = fromBase64(p1.commit);
      if (this.niCommit.length !== 32) throw new Error('Bad commitment.');
      this.nr = randomBytes(32);
      const p2: HandshakePayload2 = { v: PROTOCOL_VERSION, name: this.o.localName, nr: toBase64(this.nr) };
      await this.o.transport.send(frame(FRAME_HS2, this.hs.writeMessage(encodeJson(p2))));
      return;
    }
    if (this.o.role === 'initiator' && kind === FRAME_HS2) {
      const p2 = decodeJson<HandshakePayload2>(this.hs.readMessage(body));
      this.nr = fromBase64(p2.nr);
      this.peerName = (p2.name || 'Unknown device').slice(0, 60);
      const p3: HandshakePayload3 = { v: PROTOCOL_VERSION, name: this.o.localName, ni: toBase64(this.need(this.ni)) };
      await this.o.transport.send(frame(FRAME_HS3, this.hs.writeMessage(encodeJson(p3))));
      await this.completeHandshake();
      return;
    }
    if (this.o.role === 'responder' && kind === FRAME_HS3) {
      const p3 = decodeJson<HandshakePayload3>(this.hs.readMessage(body));
      this.ni = fromBase64(p3.ni);
      if (!equalBytes(sha256(this.ni), this.need(this.niCommit))) throw new Error('Nonce does not match its commitment.');
      this.peerName = (p3.name || 'Unknown device').slice(0, 60);
      await this.completeHandshake();
      return;
    }
    throw new Error('Unexpected handshake message.');
  }

  private async completeHandshake(): Promise<void> {
    const keys = this.hs.split();
    this.send = keys.send;
    this.recv = keys.receive;
    this.handshakeHash = keys.handshakeHash;
    this.remoteStatic = keys.remoteStaticKey;
    this.peerId = peerIdForKey(keys.remoteStaticKey);
    this.lastRekeyAt = this.now();
    const record = this.o.peers.get(this.peerId);
    const known = !!record && record.status === 'trusted' && record.staticKey === toBase64(keys.remoteStaticKey);
    this.repairMode = !!record && record.status === 'revoked';
    this.verifyInfo = {
      sas: sasFromHash(keys.handshakeHash, this.need(this.ni), this.need(this.nr)),
      peerId: this.peerId,
      peerName: this.peerName,
      peerFingerprint: fingerprint(keys.remoteStaticKey),
      known,
      repair: this.repairMode,
    };
    this.o.log.add('handshake_complete', this.peerId, { peerName: this.peerName, known, repair: this.repairMode, fingerprint: this.verifyInfo.peerFingerprint });
    this.setPhase('verifying');
    this.o.events?.onVerify?.(this.verifyInfo);
    if (known) await this.confirmVerification(true);
  }

  /** User compared the 6-digit codes (or the peer was already pinned). */
  async confirmVerification(match: boolean): Promise<void> {
    if (this.phase !== 'verifying' || this.localVerified) return;
    if (!match) {
      this.o.log.add('verification_rejected', this.peerId ?? 'unknown', { reason: 'codes did not match' });
      await this.sendControl({ t: 'verify_rejected', reason: 'codes did not match' });
      await this.close('verification codes did not match', true);
      this.notice('Codes did not match. The connection was closed; someone may be intercepting it.', 'danger');
      return;
    }
    this.localVerified = true;
    await this.sendControl({ t: 'verified' });
    if (this.repairMode) {
      this.recoveryChallenge = randomBytes(32);
      await this.sendControl({ t: 'recover_challenge', c: toBase64(this.recoveryChallenge) });
    }
    await this.maybeActivate();
  }

  private recoveryAnswer(challenge: Uint8Array, secret: Uint8Array): Uint8Array {
    return hmacSha256(secret, utf8('blueguardian-repair'), challenge, this.need(this.handshakeHash));
  }

  private async maybeActivate(): Promise<void> {
    if (!this.localVerified || !this.remoteVerified || this.phase !== 'verifying') return;
    if (this.repairMode && !this.recoveryProofOk) return;
    const peerId = this.need(this.peerId);
    const existing = this.o.peers.get(peerId);
    const secret = hkdfSha256(this.need(this.handshakeHash), utf8('blueguardian-recovery'), concatBytes(this.need(this.ni), this.need(this.nr)), 32);
    const now = this.now();
    const fresh = !existing;
    const record: PeerRecord = {
      id: peerId,
      name: this.peerName,
      staticKey: toBase64(this.need(this.remoteStatic)),
      recoverySecret: existing && !this.repairMode ? existing.recoverySecret : toBase64(secret),
      status: 'trusted',
      pairedAt: existing && !this.repairMode ? existing.pairedAt : now,
      lastSeen: now,
      keyEpoch: (existing?.keyEpoch ?? 0) + (this.repairMode ? 1 : 0),
      lastTrust: existing?.lastTrust,
    };
    await this.o.peers.upsert(record);
    if (this.repairMode) {
      this.o.engine.completeRepair(peerId);
      this.o.log.add('repaired', peerId, { keyEpoch: record.keyEpoch, probationTrust: this.o.engine.config.probationTrust });
      this.notice(`${this.peerName} re-paired. It starts on probation (chat only) and earns file access back.`, 'success');
    } else {
      const known = this.o.engine.get(peerId);
      if (!known || known.state !== 'ACTIVE') this.o.engine.enroll(peerId);
      this.o.log.add(fresh ? 'paired' : 'reconnected', peerId, { name: this.peerName });
    }
    this.setPhase('active');
  }

  // ---------------------------------------------------------------- transport
  private async sendControl(message: ControlMessage): Promise<void> {
    await this.sendRecord(encodeControl(message));
  }

  private async sendRecord(record: Uint8Array): Promise<void> {
    if (this.closed || !this.send) throw new Error('The secure link is closed.');
    const ciphertext = this.send.encryptWithAd(new Uint8Array(0), record);
    this.sentSinceRekey += 1;
    await this.o.transport.send(frame(FRAME_DATA, ciphertext));
    await this.maybeScheduledRekey();
  }

  private async maybeScheduledRekey(): Promise<void> {
    const everyN = this.o.rekeyEveryMessages ?? 500;
    const everyMs = this.o.rekeyEveryMs ?? 120_000;
    if (this.sentSinceRekey >= everyN || this.now() - this.lastRekeyAt >= everyMs) {
      await this.rotateSendKey('scheduled');
    }
  }

  private async rotateSendKey(reason: string): Promise<void> {
    if (!this.send || this.closed) return;
    // The peer rotates its receive key right after decrypting this message.
    const ciphertext = this.send.encryptWithAd(new Uint8Array(0), encodeControl({ t: 'rekey' }));
    // Rotate before awaiting, so no concurrent message can be encrypted with the old key after 'rekey'.
    const sent = this.o.transport.send(frame(FRAME_DATA, ciphertext));
    this.send.rekey();
    await sent;
    this.sentSinceRekey = 0;
    this.lastRekeyAt = this.now();
    if (reason !== 'scheduled') this.o.log.add('keys_rotated', this.peerId ?? 'unknown', { reason });
  }

  private async handleTransport(body: Uint8Array): Promise<void> {
    if (!this.recv) {
      this.protocolErrors += 1;
      return;
    }
    let record: Uint8Array;
    try {
      record = this.recv.decryptWithAd(new Uint8Array(0), body);
    } catch {
      // Tampered, replayed, injected or out-of-order frame: dropped, counted, never processed.
      this.authFailures += 1;
      return;
    }
    this.framesIn += 1;
    let decoded: DecodedRecord;
    try {
      decoded = decodeRecord(record);
    } catch {
      this.protocolErrors += 1;
      return;
    }
    if (decoded.type === 'chunk') {
      await this.handleChunk(decoded.transferId, decoded.index, decoded.data);
      return;
    }
    await this.handleControl(decoded.message);
  }

  private async handleControl(m: ControlMessage): Promise<void> {
    const peer = this.peerId ?? 'unknown';
    switch (m.t) {
      case 'rekey':
        this.recv?.rekey();
        return;
      case 'verified':
        this.remoteVerified = true;
        await this.maybeActivate();
        return;
      case 'verify_rejected':
        this.o.log.add('verification_rejected_by_peer', peer, { reason: m.reason });
        this.notice('The other phone reported that the codes did not match. Connection closed.', 'danger');
        await this.close('peer rejected verification', false);
        return;
      case 'recover_challenge': {
        const record = this.peerId ? this.o.peers.get(this.peerId) : undefined;
        if (!record) {
          await this.sendControl({ t: 'recover_response', r: '' });
          return;
        }
        const answer = this.recoveryAnswer(fromBase64(m.c), fromBase64(record.recoverySecret));
        await this.sendControl({ t: 'recover_response', r: toBase64(answer) });
        return;
      }
      case 'recover_response': {
        if (!this.repairMode || !this.recoveryChallenge || this.remoteRecoveryAnswered) {
          this.protocolErrors += 1;
          return;
        }
        this.remoteRecoveryAnswered = true;
        const record = this.o.peers.get(this.need(this.peerId));
        const expected = record ? this.recoveryAnswer(this.recoveryChallenge, fromBase64(record.recoverySecret)) : null;
        if (!expected || !m.r || !equalBytes(expected, fromBase64(m.r))) {
          this.o.log.add('repair_failed', peer, { reason: 'recovery proof did not verify' });
          this.notice('Re-pair failed: the other phone could not prove it is the device you paired before. Remove it and pair as a new device only if you are sure.', 'danger');
          await this.close('re-pair proof failed', true);
          return;
        }
        this.recoveryProofOk = true;
        await this.maybeActivate();
        return;
      }
      case 'ping':
        if (this.phase === 'active') await this.sendControl({ t: 'pong', id: m.id, ts: m.ts });
        return;
      case 'pong': {
        const rtt = this.now() - m.ts;
        if (rtt >= 0 && rtt < 60_000) this.rtts.push(rtt);
        return;
      }
      case 'trust':
        return; // informational: the peer's view of us
      case 'isolated':
        this.o.log.add('peer_isolated_us', peer, { reason: m.reason });
        this.notice(`${this.peerName} isolated this link (${m.reason}).`, 'warning');
        await this.close('isolated by peer', false);
        return;
      case 'chat':
        if (this.phase !== 'active') { this.protocolErrors += 1; return; }
        if (!this.o.engine.authorize(peer, 'chat')) return;
        this.o.events?.onChat?.({ id: String(m.id).slice(0, 40), from: 'peer', text: String(m.text).slice(0, 4000), at: this.now() });
        return;
      case 'file_offer':
        await this.handleOffer(m.manifest);
        return;
      case 'file_accept': {
        const t = this.outgoing.get(m.id);
        if (t) t.resolveAccept(Math.max(0, Math.floor(Number(m.resumeFrom) || 0)));
        return;
      }
      case 'file_reject': {
        const t = this.outgoing.get(m.id);
        if (t) t.resolveAccept(null, m.reason);
        return;
      }
      case 'file_cancel': {
        const out = this.outgoing.get(m.id);
        if (out) { out.cancelled = m.reason; out.resolveAccept(null, m.reason); out.resolveResult(false, m.reason); }
        const inc = this.incoming.get(m.id);
        if (inc) {
          this.incoming.delete(m.id);
          this.emitTransfer(inc, 'receive', 'cancelled', m.reason);
        }
        return;
      }
      case 'file_done':
        await this.finishIncoming(m.id);
        return;
      case 'file_result': {
        const t = this.outgoing.get(m.id);
        if (t) t.resolveResult(m.ok, m.reason);
        return;
      }
      case 'bye':
        await this.close(m.reason || 'peer closed the link', false);
        return;
      default:
        this.protocolErrors += 1;
    }
  }

  // ------------------------------------------------------------------- chat
  async sendChat(text: string): Promise<ChatMessage> {
    const peer = this.need(this.peerId);
    if (this.phase !== 'active') throw new Error('The link is not verified yet.');
    if (!this.o.engine.authorize(peer, 'chat')) throw new Error('Chat is disabled while this device is isolated.');
    const message: ChatMessage = { id: toHex(randomBytes(8)), from: 'me', text: text.slice(0, 4000), at: this.now() };
    await this.sendControl({ t: 'chat', id: message.id, text: message.text });
    return message;
  }

  // ------------------------------------------------------------ file: sender
  async sendFile(source: FileSource, onHashProgress?: (fraction: number) => void): Promise<TransferProgress> {
    const peer = this.need(this.peerId);
    if (this.phase !== 'active') throw new Error('The link is not verified yet.');
    if (!this.o.engine.authorize(peer, 'file_send')) {
      throw new Error('File sharing is paused: this device is not at FULL trust right now.');
    }
    const name = sanitizeFileName(source.name);
    const policy = checkOfferPolicy(name, source.size, this.o.maxFileBytes ?? MAX_FILE_BYTES);
    if (!policy.ok) throw new Error(`This file can't be sent: ${policy.reason}.`);

    const hasher = new Sha256();
    for (let offset = 0; offset < source.size; offset += 1024 * 1024) {
      hasher.update(await source.read(offset, Math.min(1024 * 1024, source.size - offset)));
      onHashProgress?.(Math.min(1, (offset + 1024 * 1024) / Math.max(1, source.size)));
    }
    const manifest: FileManifest = {
      id: toHex(randomBytes(16)),
      name,
      size: source.size,
      sha256: toHex(hasher.digest()),
      mime: source.type || mimeForName(name),
      chunkSize: CHUNK_SIZE,
      chunks: Math.ceil(source.size / CHUNK_SIZE),
      createdAt: this.now(),
    };
    const progress: TransferProgress = { id: manifest.id, direction: 'send', name, size: manifest.size, bytes: 0, state: 'offered' };
    this.o.events?.onTransfer?.({ ...progress });

    let resolveAccept: OutgoingTransfer['resolveAccept'] = () => undefined;
    let resolveResult: OutgoingTransfer['resolveResult'] = () => undefined;
    const accepted = new Promise<{ resumeFrom: number | null; reason?: string }>((resolve) => {
      resolveAccept = (resumeFrom, reason) => resolve({ resumeFrom, reason });
    });
    const result = new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      resolveResult = (ok, reason) => resolve({ ok, reason });
    });
    const transfer: OutgoingTransfer = { manifest, source, resolveAccept, resolveResult, cancelled: null };
    this.outgoing.set(manifest.id, transfer);
    this.o.log.add('file_offered', peer, { id: manifest.id, name, size: manifest.size, sha256: manifest.sha256 });

    try {
      await this.sendControl({ t: 'file_offer', manifest });
      const answer = await accepted;
      if (answer.resumeFrom === null) {
        progress.state = transfer.cancelled ? 'cancelled' : 'rejected';
        progress.reason = answer.reason;
        this.o.events?.onTransfer?.({ ...progress });
        return progress;
      }
      const start = Math.min(answer.resumeFrom, manifest.chunks);
      progress.state = 'transferring';
      progress.resumedFrom = start > 0 ? start * CHUNK_SIZE : undefined;
      progress.bytes = Math.min(manifest.size, start * CHUNK_SIZE);
      this.o.events?.onTransfer?.({ ...progress });
      for (let index = start; index < manifest.chunks; index++) {
        if (transfer.cancelled || this.closed) throw new Error(transfer.cancelled ?? 'link closed');
        if (!this.o.engine.authorize(peer, 'file_send')) {
          await this.sendControl({ t: 'file_cancel', id: manifest.id, reason: 'sender paused: trust dropped below FULL' });
          throw new Error('paused because trust dropped below FULL; send again later to resume');
        }
        const offset = index * CHUNK_SIZE;
        const data = await source.read(offset, Math.min(CHUNK_SIZE, manifest.size - offset));
        await this.sendRecord(encodeChunk(manifest.id, index, data));
        progress.bytes = offset + data.length;
        this.o.events?.onTransfer?.({ ...progress });
      }
      await this.sendControl({ t: 'file_done', id: manifest.id });
      progress.state = 'verifying';
      this.o.events?.onTransfer?.({ ...progress });
      const verdict = await result;
      progress.state = verdict.ok ? 'done' : 'failed';
      progress.reason = verdict.reason;
      this.o.log.add(verdict.ok ? 'file_sent' : 'file_send_failed', peer, { id: manifest.id, reason: verdict.reason ?? null });
    } catch (error) {
      progress.state = transfer.cancelled ? 'cancelled' : 'failed';
      progress.reason = error instanceof Error ? error.message : String(error);
    } finally {
      this.outgoing.delete(manifest.id);
    }
    this.o.events?.onTransfer?.({ ...progress });
    return progress;
  }

  // ---------------------------------------------------------- file: receiver
  private validManifest(m: FileManifest): string | null {
    if (!m || typeof m !== 'object') return 'malformed manifest';
    if (typeof m.id !== 'string' || !/^[0-9a-f]{32}$/.test(m.id)) return 'bad transfer id';
    if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) return 'bad file hash';
    if (m.chunkSize !== CHUNK_SIZE) return 'unsupported chunk size';
    if (!Number.isInteger(m.size) || m.chunks !== Math.ceil(m.size / CHUNK_SIZE)) return 'chunk count does not match size';
    if (m.name !== sanitizeFileName(m.name)) return 'unsafe file name';
    return null;
  }

  private async handleOffer(manifest: FileManifest): Promise<void> {
    const peer = this.need(this.peerId);
    const malformed = this.validManifest(manifest);
    if (malformed) {
      this.protocolErrors += 1;
      await this.sendControl({ t: 'file_reject', id: String(manifest?.id ?? ''), reason: malformed });
      return;
    }
    if (this.phase !== 'active' || !this.o.engine.authorize(peer, 'file_receive')) {
      await this.sendControl({ t: 'file_reject', id: manifest.id, reason: 'receiver has file transfer disabled for this device right now' });
      this.notice(`Blocked a file from ${this.peerName}: it is not at FULL trust.`, 'warning');
      return;
    }
    const policy = checkOfferPolicy(manifest.name, manifest.size, this.o.maxFileBytes ?? MAX_FILE_BYTES);
    if (!policy.ok) {
      await this.sendControl({ t: 'file_reject', id: manifest.id, reason: policy.reason ?? 'blocked by policy' });
      this.o.log.add('file_blocked', peer, { name: manifest.name, reason: policy.reason ?? null });
      this.notice(`Blocked "${manifest.name}" from ${this.peerName}: ${policy.reason}.`, 'warning');
      return;
    }
    const opened = await this.o.sink.open(manifest);
    const transfer: IncomingTransfer = {
      manifest,
      key: manifest.sha256,
      nextIndex: Math.min(manifest.chunks, Math.floor(opened.existingBytes / CHUNK_SIZE)),
      bytes: 0,
      approved: false,
      done: false,
    };
    transfer.bytes = Math.min(manifest.size, transfer.nextIndex * CHUNK_SIZE);
    this.incoming.set(manifest.id, transfer);
    this.emitTransfer(transfer, 'receive', 'awaiting_approval');
    this.o.events?.onOffer?.(manifest, transfer.bytes);
  }

  /** Explicit per-transfer approval by the user. */
  async respondToOffer(id: string, accept: boolean, reason = 'declined by the receiver'): Promise<void> {
    const t = this.incoming.get(id);
    if (!t || t.approved) return;
    if (!accept) {
      this.incoming.delete(id);
      await this.sendControl({ t: 'file_reject', id, reason });
      this.emitTransfer(t, 'receive', 'rejected', reason);
      return;
    }
    t.approved = true;
    this.o.log.add('file_accepted', this.peerId ?? 'unknown', { id, name: t.manifest.name, resumeFromChunk: t.nextIndex });
    await this.sendControl({ t: 'file_accept', id, resumeFrom: t.nextIndex });
    this.emitTransfer(t, 'receive', 'transferring');
  }

  private emitTransfer(t: IncomingTransfer, direction: 'receive', state: TransferProgress['state'], reason?: string, kind?: string): void {
    this.o.events?.onTransfer?.({
      id: t.manifest.id, direction, name: t.manifest.name, size: t.manifest.size, bytes: t.bytes, state, reason, kind,
    });
  }

  private async handleChunk(id: string, index: number, data: Uint8Array): Promise<void> {
    const t = this.incoming.get(id);
    const peer = this.peerId ?? 'unknown';
    if (!t || !t.approved || t.done) { this.protocolErrors += 1; return; }
    if (!this.o.engine.authorize(peer, 'file_receive')) {
      this.incoming.delete(id);
      await this.sendControl({ t: 'file_cancel', id, reason: 'receiver paused: trust dropped below FULL' });
      this.emitTransfer(t, 'receive', 'cancelled', 'paused because trust dropped; the partial file is kept so it can resume');
      return;
    }
    const expectedLength = Math.min(CHUNK_SIZE, t.manifest.size - index * CHUNK_SIZE);
    if (index !== t.nextIndex || data.length !== expectedLength) {
      this.protocolErrors += 1;
      this.incoming.delete(id);
      await this.sendControl({ t: 'file_cancel', id, reason: 'chunk out of order or wrong size' });
      this.emitTransfer(t, 'receive', 'failed', 'chunk out of order or wrong size');
      return;
    }
    await this.o.sink.write(t.key, index * CHUNK_SIZE, data);
    t.nextIndex += 1;
    t.bytes = Math.min(t.manifest.size, t.nextIndex * CHUNK_SIZE);
    this.emitTransfer(t, 'receive', 'transferring');
  }

  private async finishIncoming(id: string): Promise<void> {
    const t = this.incoming.get(id);
    if (!t || !t.approved) { this.protocolErrors += 1; return; }
    t.done = true;
    this.incoming.delete(id);
    const peer = this.peerId ?? 'unknown';
    this.emitTransfer(t, 'receive', 'verifying');
    let failure: string | null = null;
    let kind: string | undefined;
    if (t.nextIndex !== t.manifest.chunks) failure = 'transfer ended early';
    let stored: { sha256: string; size: number; head: Uint8Array } | null = null;
    if (!failure) {
      stored = await this.o.sink.finalize(t.key);
      if (stored.size !== t.manifest.size) failure = 'size on disk does not match the manifest';
      else if (stored.sha256 !== t.manifest.sha256) failure = 'SHA-256 does not match the manifest';
    }
    if (!failure && stored) {
      const verdict = checkContentPolicy(t.manifest.name, stored.head);
      kind = verdict.kind;
      if (!verdict.ok) failure = verdict.reason ?? 'blocked by content policy';
      else {
        await this.o.sink.accept(t.key, { name: t.manifest.name, mime: verdict.mime, kind: verdict.kind, size: stored.size, from: this.peerName });
      }
    }
    if (failure) {
      await this.o.sink.discard(t.key);
      this.o.log.add('file_rejected_after_receive', peer, { name: t.manifest.name, reason: failure });
      await this.sendControl({ t: 'file_result', id, ok: false, reason: failure });
      this.emitTransfer(t, 'receive', 'failed', failure, kind);
      return;
    }
    this.o.log.add('file_received', peer, { name: t.manifest.name, size: t.manifest.size, sha256: t.manifest.sha256, kind: kind ?? null });
    await this.sendControl({ t: 'file_result', id, ok: true });
    this.emitTransfer(t, 'receive', 'done', undefined, kind);
  }

  // ------------------------------------------------------- continuous trust
  /** Call once per second. Sends a ping, scores the last window, applies actions. */
  async tick(): Promise<TrustDecision | null> {
    if (this.closed || this.phase !== 'active' || !this.peerId) return null;
    const peer = this.peerId;
    const maxFps = this.o.maxFramesPerSecond ?? 600;
    if (this.framesIn > maxFps) this.protocolErrors += Math.ceil(this.framesIn / maxFps);
    const totalIn = this.framesIn + this.authFailures + this.protocolErrors;
    const mean = this.rtts.length ? this.rtts.reduce((a, b) => a + b, 0) / this.rtts.length : 0;
    const jitter = this.rtts.length > 1
      ? Math.sqrt(this.rtts.reduce((a, b) => a + (b - mean) ** 2, 0) / this.rtts.length)
      : this.rtts.length === 1 ? Math.abs(this.rtts[0] - mean) : 0;
    const observation: LinkObservation = {
      t: this.now(),
      encrypted: !!this.send,
      authenticated: this.localVerified && this.remoteVerified,
      secureConnections: true,
      keySizeBytes: 32,
      rssiDbm: this.rssi,
      csDistanceM: null,
      cfoKhz: null,
      pktRate: totalIn,
      pairAttempts: this.pairAttempts,
      errorRate: totalIn ? (this.authFailures + this.protocolErrors) / totalIn : 0,
      rttJitterMs: jitter,
    };
    this.framesIn = 0;
    this.authFailures = 0;
    this.protocolErrors = 0;
    this.pairAttempts = 0;
    this.rtts = this.rtts.slice(-1);

    const decision = this.o.engine.process(peer, observation);
    this.lastDecision = decision;
    this.o.events?.onTrust?.(decision);
    for (const action of decision.actions) {
      if (action.type === 'level_change') {
        this.o.log.add('trust_level_change', peer, { from: action.from, to: action.to, trust: Math.round(decision.trust), reasons: decision.reasons, telemetry: observation });
        this.notice(`${this.peerName}: trust ${action.from} → ${action.to}${decision.reasons[0] ? ` (${decision.reasons[0]})` : ''}`, action.to === 'FULL' ? 'success' : 'warning');
      } else if (action.type === 'rotate_keys') {
        await this.rotateSendKey(action.reason);
      } else if (action.type === 'recover') {
        await this.recover(decision);
        return decision;
      }
    }
    try {
      await this.sendControl({ t: 'ping', id: ++this.pingId, ts: this.now() });
    } catch {
      // link may have dropped between checks
    }
    return decision;
  }

  /** Automated recovery: rotate keys, revoke the pairing, close, log, require re-pair. */
  private async recover(decision: TrustDecision): Promise<void> {
    const peer = this.need(this.peerId);
    const record = this.o.peers.get(peer);
    try {
      await this.rotateSendKey('isolation');
      await this.sendControl({ t: 'isolated', reason: decision.reasons[0] ?? 'trust score too low' });
    } catch {
      // best effort
    }
    if (record) {
      await this.o.peers.upsert({ ...record, status: 'revoked', revokedReason: decision.reasons[0] ?? 'trust score too low', lastTrust: decision.trust });
    }
    this.o.log.add('recovery', peer, {
      steps: ['session keys rotated', 'pairing revoked', 'link closed', 'out-of-band re-pair required'],
      trust: Math.round(decision.trust),
      reasons: decision.reasons,
    });
    this.notice(`${this.peerName} was isolated: ${decision.reasons[0] ?? 'trust too low'}. Re-pair it face to face to restore access.`, 'danger');
    await this.close('isolated by trust engine', false);
  }

  async close(reason: string, notifyPeer = true): Promise<void> {
    if (this.closed) return;
    if (notifyPeer && this.send) {
      try { await this.sendControl({ t: 'bye', reason }); } catch { /* ignore */ }
    }
    this.closed = true;
    for (const t of this.outgoing.values()) { t.cancelled = reason; t.resolveAccept(null, reason); t.resolveResult(false, reason); }
    for (const t of this.incoming.values()) this.emitTransfer(t, 'receive', 'cancelled', reason);
    this.incoming.clear();
    if (this.peerId) {
      const record = this.o.peers.get(this.peerId);
      if (record && record.status === 'trusted') {
        await this.o.peers.upsert({ ...record, lastSeen: this.now(), lastTrust: this.lastDecision?.trust ?? record.lastTrust });
      }
    }
    this.send?.destroy();
    this.recv?.destroy();
    this.setPhase('closed', reason);
    try { await this.o.transport.close(reason); } catch { /* ignore */ }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private need<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new Error('Secure session state is incomplete.');
    return value;
  }
}

