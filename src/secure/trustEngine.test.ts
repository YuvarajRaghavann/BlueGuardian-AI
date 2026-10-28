import { describe, expect, it } from 'vitest';
import { detectKind, checkContentPolicy, checkOfferPolicy, sanitizeFileName } from './fileTypes';
import { ForensicLog } from './forensicLog';
import { TrustEngine, type LinkObservation } from './trustEngine';

function obs(over: Partial<LinkObservation> = {}): LinkObservation {
  return {
    t: 0, encrypted: true, authenticated: true, secureConnections: true, keySizeBytes: 32,
    rssiDbm: null, csDistanceM: null, cfoKhz: null, pktRate: 2, pairAttempts: 0, errorRate: 0, rttJitterMs: 8,
    ...over,
  };
}

describe('BTGuard trust engine (TypeScript port)', () => {
  it('stays FULL on normal traffic, including busy file transfers', () => {
    const engine = new TrustEngine();
    for (let i = 0; i < 60; i++) {
      const d = engine.process('p', obs({ pktRate: i % 2 ? 60 : 2, rttJitterMs: i % 2 ? 25 : 8 }));
      expect(d.level).toBe('FULL');
    }
  });

  it('pauses sharing on one persistent soft signal but never revokes the pairing for it', () => {
    const engine = new TrustEngine();
    const seen: string[] = [];
    const actions: string[] = [];
    for (let i = 0; i < 30; i++) {
      const d = engine.process('p', obs({ rttJitterMs: 50 }));
      seen.push(d.level);
      actions.push(...d.actions.map((a) => a.type));
      if (i === 0) {
        expect(d.reasons.join(' ')).toContain('round-trip jitter');
        expect(d.corroborated).toBe(false);
      }
    }
    // One noisy window changes nothing; a persistent one pauses file sharing.
    expect(seen[0]).toBe('FULL');
    expect(seen[1]).toBe('RESTRICTED');
    expect(actions).toContain('rotate_keys');
    expect(seen).not.toContain('ISOLATED');
    expect(actions).not.toContain('recover');
    expect(engine.authorize('p', 'chat')).toBe(true);
    expect(engine.authorize('p', 'file_send')).toBe(false);
  });

  it('ignores a single bad window (a WebView hiccup or a hand over the antenna)', () => {
    const engine = new TrustEngine();
    expect(engine.process('p', obs({ rttJitterMs: 400 })).level).toBe('FULL');
    for (let i = 0; i < 5; i++) expect(engine.process('p', obs()).level).toBe('FULL');
  });

  it('isolates at once on hard evidence (repeated authentication failures) and recovers the link', () => {
    const engine = new TrustEngine();
    const d = engine.process('p', obs({ pktRate: 40, errorRate: 1, errorCount: 40 }));
    expect(d.corroborated).toBe(true);
    expect(d.level).toBe('ISOLATED');
    expect(d.actions.map((a) => a.type)).toContain('recover');
    expect(engine.authorize('p', 'chat')).toBe(false);
  });

  it('isolates when two independent methods agree (behaviour + signal)', () => {
    const engine = new TrustEngine();
    engine.process('p', obs({ rssiDbm: -50 }));
    const levels: string[] = [];
    for (let i = 0; i < 8; i++) {
      levels.push(engine.process('p', obs({ rttJitterMs: 80, rssiDbm: i % 2 ? -50 : -95 })).level);
    }
    expect(levels).toContain('ISOLATED');
  });

  it('caps trust when the crypto layer is broken (downgrade)', () => {
    const engine = new TrustEngine();
    const d = engine.process('p', obs({ keySizeBytes: 7 }));
    expect(d.instantTrust).toBeLessThanOrEqual(30);
    expect(d.reasons[0]).toContain('downgrade');
  });

  it('flags Channel Sounding distance that disagrees with RSSI (relay)', () => {
    const engine = new TrustEngine();
    const d = engine.process('p', obs({ csDistanceM: 1, rssiDbm: -95 }));
    expect(d.risks.distance).toBeGreaterThan(0.3);
    expect(d.reasons.join(' ')).toContain('possible relay');
  });

  it('regains trust slowly, one level at a time', () => {
    const engine = new TrustEngine(undefined, { autoRecover: false });
    for (let i = 0; i < 6; i++) engine.process('p', obs({ pktRate: 10, errorRate: 0.5, errorCount: 5 }));
    expect(engine.get('p')?.level).toBe('ISOLATED');
    const levels: string[] = [];
    for (let i = 0; i < 40; i++) levels.push(engine.process('p', obs()).level);
    expect(levels[0]).toBe('ISOLATED');
    expect(levels.indexOf('RESTRICTED')).toBeGreaterThan(0);
    expect(levels.indexOf('FULL')).toBeGreaterThan(levels.indexOf('RESTRICTED'));
  });
});

describe('Forensic log', () => {
  it('detects edits to any entry', () => {
    const log = new ForensicLog();
    log.add('paired', 'p', { a: 1 });
    log.add('recovery', 'p', { steps: ['x'] });
    expect(log.verify()).toBe(true);
    const entries = log.list();
    entries[0] = { ...entries[0], data: { a: 2 } };
    expect(ForensicLog.verifyEntries(entries)).toBe(false);
  });

  it('keeps verifying after old entries are trimmed', () => {
    const log = new ForensicLog({ maxEntries: 5 });
    for (let i = 0; i < 12; i++) log.add('e', 'p', { i });
    expect(log.list()).toHaveLength(5);
    expect(log.verify()).toBe(true);
  });
});

describe('File-type policy', () => {
  it('detects real types from magic bytes', () => {
    expect(detectKind(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(detectKind(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(detectKind(Uint8Array.of(0x50, 0x4b, 0x03, 0x04))).toBe('zip');
    expect(detectKind(Uint8Array.of(0x7f, 0x45, 0x4c, 0x46))).toBe('elf');
    expect(detectKind(new TextEncoder().encode('dex\n035'))).toBe('dex');
    expect(detectKind(new TextEncoder().encode('just some notes'))).toBe('text');
  });

  it('blocks installers and mismatched names', () => {
    expect(checkOfferPolicy('update.apk', 10).ok).toBe(false);
    expect(checkOfferPolicy('photo.jpg', 200 * 1024 * 1024).ok).toBe(false);
    expect(checkOfferPolicy('photo.jpg', 10).ok).toBe(true);
    expect(checkContentPolicy('invoice.pdf', Uint8Array.of(0x50, 0x4b, 0x03, 0x04)).ok).toBe(false);
    expect(checkContentPolicy('report.docx', Uint8Array.of(0x50, 0x4b, 0x03, 0x04)).ok).toBe(true);
  });

  it('sanitizes path tricks in names', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('..\\..\\evil.jpg')).toBe('evil.jpg');
    expect(sanitizeFileName('.hidden.txt')).toBe('hidden.txt');
  });
});
