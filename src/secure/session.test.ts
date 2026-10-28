import { describe, expect, it } from 'vitest';
import { concatBytes, randomBytes, utf8 } from './crypto/bytes';
import { generateKeyPair, type KeyPair } from './crypto/x25519';
import { ForensicLog } from './forensicLog';
import { MemoryQuarantineSink } from './memorySink';
import { MemoryPeerDirectory } from './peerStore';
import { FRAME_DATA } from './protocol';
import { SecureSession, type FileSource, type TransferProgress, type VerifyInfo } from './session';
import { TrustEngine } from './trustEngine';

interface Side {
  name: string;
  identity: KeyPair;
  peers: MemoryPeerDirectory;
  engine: TrustEngine;
  log: ForensicLog;
  sink: MemoryQuarantineSink;
}

function makeSide(name: string): Side {
  return {
    name,
    identity: generateKeyPair(),
    peers: new MemoryPeerDirectory(),
    engine: new TrustEngine(),
    log: new ForensicLog(),
    sink: new MemoryQuarantineSink(),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i++) await flush();
}

function connect(a: Side, b: Side, opts: { autoAccept?: boolean; rekeyEveryMessages?: number } = {}) {
  const wireAtoB: Uint8Array[] = [];
  const events = { aVerify: null as VerifyInfo | null, bVerify: null as VerifyInfo | null, aTransfers: [] as TransferProgress[], bTransfers: [] as TransferProgress[], aNotices: [] as string[], bNotices: [] as string[], bChats: [] as string[] };
  let sa: SecureSession;
  let sb: SecureSession;
  const deliver = (to: () => SecureSession, f: Uint8Array) => { setTimeout(() => { void to().receiveFrame(f); }, 0); };
  sa = new SecureSession({
    role: 'initiator', identity: a.identity, localName: a.name, peers: a.peers, engine: a.engine, log: a.log, sink: a.sink,
    rekeyEveryMessages: opts.rekeyEveryMessages,
    transport: { send: async (f) => { wireAtoB.push(f); deliver(() => sb, f); }, close: async () => undefined },
    events: {
      onVerify: (v) => { events.aVerify = v; },
      onTransfer: (p) => { events.aTransfers.push(p); },
      onNotice: (t) => { events.aNotices.push(t); },
    },
  });
  sb = new SecureSession({
    role: 'responder', identity: b.identity, localName: b.name, peers: b.peers, engine: b.engine, log: b.log, sink: b.sink,
    rekeyEveryMessages: opts.rekeyEveryMessages,
    transport: { send: async (f) => { deliver(() => sa, f); }, close: async () => undefined },
    events: {
      onVerify: (v) => { events.bVerify = v; },
      onChat: (m) => { events.bChats.push(m.text); },
      onOffer: (m) => { if (opts.autoAccept !== false) void sb.respondToOffer(m.id, true); },
      onTransfer: (p) => { events.bTransfers.push(p); },
      onNotice: (t) => { events.bNotices.push(t); },
    },
  });
  return { sa, sb, wireAtoB, events, inject: (f: Uint8Array) => sb.receiveFrame(f) };
}

async function pairFresh(a: Side, b: Side, opts = {}) {
  const link = connect(a, b, opts);
  await link.sa.start();
  await settle();
  if (link.sa.phase === 'verifying') await link.sa.confirmVerification(true);
  if (link.sb.phase === 'verifying') await link.sb.confirmVerification(true);
  await settle();
  return link;
}

function memoryFile(name: string, data: Uint8Array): FileSource {
  return { name, size: data.length, read: async (offset, length) => data.slice(offset, offset + length) };
}

const PNG_HEADER = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

describe('Secure Link pairing', () => {
  it('shows the same 6-digit code on both phones and pins each other after confirmation', async () => {
    const a = makeSide('Phone A');
    const b = makeSide('Phone B');
    const link = connect(a, b);
    await link.sa.start();
    await settle();
    expect(link.events.aVerify?.sas).toMatch(/^\d{6}$/);
    expect(link.events.aVerify?.sas).toBe(link.events.bVerify?.sas);
    expect(link.events.aVerify?.known).toBe(false);
    expect(link.events.bVerify?.peerName).toBe('Phone A');
    await link.sa.confirmVerification(true);
    await link.sb.confirmVerification(true);
    await settle();
    expect(link.sa.phase).toBe('active');
    expect(link.sb.phase).toBe('active');
    expect(a.peers.list()).toHaveLength(1);
    expect(b.peers.list()[0].name).toBe('Phone A');
    expect(a.peers.list()[0].recoverySecret).toBe(b.peers.list()[0].recoverySecret);
  });

  it('reconnects a pinned peer without asking again', async () => {
    const a = makeSide('A');
    const b = makeSide('B');
    await pairFresh(a, b);
    const link = connect(a, b);
    await link.sa.start();
    await settle();
    expect(link.events.aVerify?.known).toBe(true);
    expect(link.sa.phase).toBe('active');
    expect(link.sb.phase).toBe('active');
  });

  it('closes both sides when the user says the codes do not match', async () => {
    const link = connect(makeSide('A'), makeSide('B'));
    await link.sa.start();
    await settle();
    await link.sb.confirmVerification(false);
    await settle();
    expect(link.sa.phase).toBe('closed');
    expect(link.sb.phase).toBe('closed');
  });

  it('gives a man in the middle different codes on each side', async () => {
    const a = makeSide('A');
    const b = makeSide('B');
    const m1 = makeSide('A');
    const m2 = makeSide('B');
    const left = connect(a, m2);   // A believes it talks to B
    const right = connect(m1, b);  // B believes it talks to A
    await left.sa.start();
    await right.sa.start();
    await settle();
    expect(left.events.aVerify?.sas).not.toBe(right.events.bVerify?.sas);
  });
});

describe('Secure Link transport', () => {
  it('delivers chat, drops tampered and replayed frames, and keeps working', async () => {
    const link = await pairFresh(makeSide('A'), makeSide('B'));
    await link.sa.sendChat('hello');
    await settle();
    expect(link.events.bChats).toEqual(['hello']);
    const lastData = [...link.wireAtoB].reverse().find((f) => f[0] === FRAME_DATA) as Uint8Array;
    await link.inject(lastData); // replay
    const tampered = lastData.slice();
    tampered[tampered.length - 1] ^= 0xff;
    await link.inject(tampered);
    await link.inject(concatBytes(Uint8Array.of(FRAME_DATA), randomBytes(40)));
    await link.sa.sendChat('still here');
    await settle();
    expect(link.events.bChats).toEqual(['hello', 'still here']);
  });

  it('rotates keys on schedule without losing messages', async () => {
    const link = await pairFresh(makeSide('A'), makeSide('B'), { rekeyEveryMessages: 3 });
    for (let i = 0; i < 20; i++) await link.sa.sendChat(`m${i}`);
    await settle(60);
    expect(link.events.bChats).toHaveLength(20);
    expect(link.events.bChats[19]).toBe('m19');
  });
});

describe('Secure file transfer', () => {
  it('moves a file into quarantine and verifies its hash and type', async () => {
    const a = makeSide('A');
    const b = makeSide('B');
    const link = await pairFresh(a, b);
    const data = concatBytes(PNG_HEADER, randomBytes(50_000));
    const result = await link.sa.sendFile(memoryFile('photo.png', data));
    await settle();
    expect(result.state).toBe('done');
    const stored = [...b.sink.files.values()][0];
    expect(stored.name).toBe('photo.png');
    expect(stored.kind).toBe('png');
    expect(stored.data).toEqual(data);
  });

  it('blocks executables at offer time and disguised executables after receipt', async () => {
    const b = makeSide('B');
    const link = await pairFresh(makeSide('A'), b);
    await expect(link.sa.sendFile(memoryFile('app.apk', randomBytes(100)))).rejects.toThrow('blocked');
    const elf = concatBytes(Uint8Array.of(0x7f, 0x45, 0x4c, 0x46), randomBytes(2000));
    const result = await link.sa.sendFile(memoryFile('cat.jpg', elf));
    expect(result.state).toBe('failed');
    expect(result.reason).toContain('executable');
    expect(b.sink.files.size).toBe(0);
    expect(b.sink.partial.size).toBe(0);
  });

  it('lets the receiver decline a transfer', async () => {
    const link = connect(makeSide('A'), makeSide('B'), { autoAccept: false });
    await link.sa.start();
    await settle();
    await link.sa.confirmVerification(true);
    await link.sb.confirmVerification(true);
    await settle();
    const pending = link.sa.sendFile(memoryFile('notes.txt', utf8('hello world')));
    await settle();
    const offer = link.events.bTransfers.find((t) => t.state === 'awaiting_approval') as TransferProgress;
    await link.sb.respondToOffer(offer.id, false);
    const result = await pending;
    expect(result.state).toBe('rejected');
  });

  it('resumes an interrupted transfer from the last stored chunk', async () => {
    const a = makeSide('A');
    const b = makeSide('B');
    const data = concatBytes(PNG_HEADER, randomBytes(16384 * 6));
    // Simulate a previous partial transfer: 3 chunks already in quarantine.
    const link = await pairFresh(a, b);
    const { sha256 } = await import('./crypto/sha256');
    const { toHex } = await import('./crypto/bytes');
    b.sink.partial.set(toHex(sha256(data)), data.slice(0, 16384 * 3));
    const result = await link.sa.sendFile(memoryFile('big.png', data));
    expect(result.state).toBe('done');
    expect(result.resumedFrom).toBe(16384 * 3);
    expect([...b.sink.files.values()][0].data).toEqual(data);
  });
});

describe('Continuous trust binding', () => {
  it('isolates a flooding link, revokes the pairing, and re-pairs on probation', async () => {
    const a = makeSide('A');
    const b = makeSide('B');
    const link = await pairFresh(a, b);
    let decision = await link.sb.tick();
    expect(decision?.level).toBe('FULL');
    const levels: string[] = [];
    for (let w = 0; w < 10 && !link.sb.isClosed; w++) {
      for (let i = 0; i < 40; i++) await link.inject(concatBytes(Uint8Array.of(FRAME_DATA), randomBytes(60)));
      decision = await link.sb.tick();
      if (decision) levels.push(decision.level);
    }
    await settle();
    expect(levels).toContain('ISOLATED');
    expect(b.peers.list()[0].status).toBe('revoked');
    expect(link.sb.phase).toBe('closed');
    expect(link.sa.phase).toBe('closed');
    expect(b.log.list().some((e) => e.event === 'recovery')).toBe(true);
    expect(b.log.verify()).toBe(true);

    // Out-of-band re-pair: codes compared again + recovery-secret proof.
    const again = connect(a, b);
    await again.sa.start();
    await settle();
    expect(again.events.bVerify?.repair).toBe(true);
    await again.sa.confirmVerification(true);
    await again.sb.confirmVerification(true);
    await settle();
    expect(again.sb.phase).toBe('active');
    expect(b.peers.list()[0].status).toBe('trusted');
    expect(b.peers.list()[0].keyEpoch).toBe(1);
    const probation = await again.sb.tick();
    expect(probation?.level).toBe('RESTRICTED');
    expect(b.engine.authorize(again.sb.peerId as string, 'file_receive')).toBe(false);
    expect(b.engine.authorize(again.sb.peerId as string, 'chat')).toBe(true);
  });

  it('refuses a re-pair when the other phone cannot prove the recovery secret', async () => {
    const a = makeSide('A');
    const b = makeSide('B');
    await pairFresh(a, b);
    const record = b.peers.list()[0];
    await b.peers.upsert({ ...record, status: 'revoked' });
    const aRecord = a.peers.list()[0];
    await a.peers.upsert({ ...aRecord, recoverySecret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
    const link = connect(a, b);
    await link.sa.start();
    await settle();
    await link.sa.confirmVerification(true);
    await link.sb.confirmVerification(true);
    await settle();
    expect(link.sb.phase).toBe('closed');
    expect(b.peers.list()[0].status).toBe('revoked');
  });

  it('keeps both phones’ recovery secrets in sync, so a second re-pair still proves itself', async () => {
    const a = makeSide('A');
    const b = makeSide('B');
    await pairFresh(a, b);
    for (let round = 1; round <= 2; round++) {
      const record = b.peers.list()[0];
      await b.peers.upsert({ ...record, status: 'revoked' });
      const link = connect(a, b);
      await link.sa.start();
      await settle();
      expect(link.events.bVerify?.repair).toBe(true);
      await link.sa.confirmVerification(true);
      await link.sb.confirmVerification(true);
      await settle();
      expect(link.sb.phase).toBe('active');
      expect(b.peers.list()[0].status).toBe('trusted');
      expect(a.peers.list()[0].recoverySecret).toBe(b.peers.list()[0].recoverySecret);
      await link.sa.close('done', true);
      await settle();
    }
  });

  it('keeps a quiet, normal link at FULL', async () => {
    const link = await pairFresh(makeSide('A'), makeSide('B'));
    for (let w = 0; w < 20; w++) {
      await link.sa.sendChat('hi');
      await settle(3);
      const d = await link.sb.tick();
      expect(d?.level).toBe('FULL');
    }
  });
});
