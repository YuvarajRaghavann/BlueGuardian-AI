import { describe, expect, it } from 'vitest';
import { classifyAdvert, isGenericName } from './advert';
import { IntelEngine, standingOf, type ScanObservation } from './engine';

const MIN = 60_000;
const airtagSeparated = { manufacturerData: { '004c': '1219' + '00'.repeat(25) } };
const airtagNearOwner = { manufacturerData: { '004c': '1202' + '0000' } };
const fastPair = (i: number) => ({ serviceData: { '0000fe2c-0000-1000-8000-00805f9b34fb': '00' + i.toString(16).padStart(4, '0') } });

function scanAt(engine: IntelEngine, at: number, observations: ScanObservation[], location?: { lat: number; lng: number }) {
  return engine.ingestScan({ at, observations, location: location ? { ...location, accuracy: 10 } : null });
}

describe('advertisement identification', () => {
  it('recognises trackers from their payload, not their name', () => {
    expect(classifyAdvert(airtagSeparated)).toMatchObject({ family: 'apple_findmy', isTracker: true, separated: true });
    expect(classifyAdvert(airtagNearOwner)).toMatchObject({ family: 'apple_findmy', separated: false });
    expect(classifyAdvert({ serviceData: { '0000fd5a-0000-1000-8000-00805f9b34fb': '01' } }).family).toBe('samsung_smarttag');
    expect(classifyAdvert({ serviceUuids: ['0000feed-0000-1000-8000-00805f9b34fb'] }).family).toBe('tile');
    expect(classifyAdvert({ serviceData: { '0000feaa-0000-1000-8000-00805f9b34fb': '41aa' } }).family).toBe('google_findmy');
    expect(classifyAdvert({ serviceData: { '0000feaa-0000-1000-8000-00805f9b34fb': '10aa' } }).family).toBe('unknown');
    expect(classifyAdvert(fastPair(1)).isPairingPopup).toBe(true);
    expect(classifyAdvert({ name: 'AirTag' }).isTracker).toBe(false);
  });

  it('treats very common names as generic', () => {
    expect(isGenericName('TWS')).toBe(true);
    expect(isGenericName('CAR AUDIO')).toBe(true);
    expect(isGenericName('boAt Rockerz 255')).toBe(false);
  });
});

describe('tracker following you', () => {
  const tag: ScanObservation = { address: 'AA:BB:CC:00:11:22', transport: 'BLE', rssi: -60, advert: airtagSeparated };

  it('raises a strong alert when the same separated tracker is seen at places far apart', () => {
    const e = new IntelEngine();
    const t0 = 1_000_000_000_000;
    scanAt(e, t0, [tag], { lat: 12.9716, lng: 77.5946 });
    scanAt(e, t0 + 20 * MIN, [tag], { lat: 12.9800, lng: 77.6000 });
    const raised = scanAt(e, t0 + 45 * MIN, [tag], { lat: 12.9900, lng: 77.6100 });
    expect(raised[0]).toMatchObject({ kind: 'tracker_following', severity: 'high', strength: 'strong' });
  });

  it('stays quiet for a tracker that never moves (a neighbour\'s tag)', () => {
    const e = new IntelEngine();
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 6; i++) scanAt(e, t0 + i * 15 * MIN, [tag], { lat: 12.9716, lng: 77.5946 + i * 0.00001 });
    expect(e.activeFindings(t0 + 90 * MIN)).toHaveLength(0);
  });

  it('stays quiet when the tracker\'s owner is nearby', () => {
    const e = new IntelEngine();
    const t0 = 1_000_000_000_000;
    const near = { ...tag, advert: airtagNearOwner };
    scanAt(e, t0, [near], { lat: 12.97, lng: 77.59 });
    scanAt(e, t0 + 20 * MIN, [near], { lat: 12.98, lng: 77.60 });
    scanAt(e, t0 + 45 * MIN, [near], { lat: 12.99, lng: 77.61 });
    expect(e.activeFindings(t0 + 45 * MIN)).toHaveLength(0);
  });

  it('needs at least 30 minutes, and never flags your own paired or marked tag', () => {
    const e = new IntelEngine();
    const t0 = 1_000_000_000_000;
    scanAt(e, t0, [tag], { lat: 12.97, lng: 77.59 });
    scanAt(e, t0 + 5 * MIN, [tag], { lat: 12.98, lng: 77.60 });
    scanAt(e, t0 + 10 * MIN, [tag], { lat: 12.99, lng: 77.61 });
    expect(e.activeFindings(t0 + 10 * MIN)).toHaveLength(0);
    e.markMine(tag.address);
    scanAt(e, t0 + 50 * MIN, [tag], { lat: 13.00, lng: 77.62 });
    expect(e.activeFindings(t0 + 50 * MIN)).toHaveLength(0);
  });

  it('gives only a moderate alert without location data', () => {
    const e = new IntelEngine();
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 4; i++) scanAt(e, t0 + i * 15 * MIN, [tag]);
    expect(e.activeFindings(t0 + 45 * MIN)[0]).toMatchObject({ severity: 'medium', strength: 'moderate' });
  });
});

describe('pairing-popup spam', () => {
  it('learns your normal level and flags a burst far above it', () => {
    const e = new IntelEngine();
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 8; i++) {
      const raised = scanAt(e, t0 + i * MIN, [
        { address: `00:00:00:00:00:0${i % 3}`, transport: 'BLE', advert: fastPair(i) },
        { address: '11:11:11:11:11:11', transport: 'BLE' },
      ]);
      expect(raised).toHaveLength(0);
    }
    const burst: ScanObservation[] = Array.from({ length: 25 }, (_, i) => ({
      address: `66:55:44:33:22:${i.toString(16).padStart(2, '0')}`, transport: 'BLE', advert: fastPair(i),
    }));
    const raised = scanAt(e, t0 + 10 * MIN, burst);
    expect(raised[0]).toMatchObject({ kind: 'popup_spam', severity: 'high' });
    // The attack does not become the new normal.
    expect(e.snapshot.env.popup.mean).toBeLessThan(2);
  });

  it('does not flag a few genuine Fast Pair devices', () => {
    const e = new IntelEngine();
    const obs: ScanObservation[] = Array.from({ length: 4 }, (_, i) => ({ address: `22:00:00:00:00:0${i}`, transport: 'BLE', advert: fastPair(i) }));
    expect(scanAt(e, 1_000_000_000_000, obs)).toHaveLength(0);
  });
});

describe('look-alikes and standing', () => {
  it('flags an unpaired device copying a distinctive paired name, but not generic names', () => {
    const e = new IntelEngine();
    const t = 1_000_000_000_000;
    scanAt(e, t, [
      { address: 'B5:60:99:3A:6A:C1', name: 'boAt Rockerz 255', transport: 'PAIRED', paired: true },
      { address: '41:42:0F:93:F5:96', name: 'TWS', transport: 'PAIRED', paired: true },
    ]);
    const raised = scanAt(e, t + MIN, [
      { address: '99:99:99:99:99:99', name: 'boAt Rockerz 255', transport: 'CLASSIC' },
      { address: '88:88:88:88:88:88', name: 'TWS', transport: 'CLASSIC' },
    ]);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ kind: 'lookalike', severity: 'low' });
  });

  it('reports standing from real history instead of a made-up score', () => {
    const e = new IntelEngine();
    const t = 1_000_000_000_000;
    expect(standingOf(undefined, false, false).standing).toBe('new');
    for (let d = 0; d < 3; d++) scanAt(e, t + d * 86_400_000, [{ address: 'CC:CC:CC:CC:CC:CC', transport: 'BLE', name: 'Neighbour TV' }]);
    expect(standingOf(e.profile('CC:CC:CC:CC:CC:CC'), false, false)).toMatchObject({ standing: 'familiar' });
    expect(standingOf(undefined, true, false).standing).toBe('yours');
  });

  it('never raises anything for ordinary devices', () => {
    const e = new IntelEngine();
    const t = 1_000_000_000_000;
    const raised = scanAt(e, t, [
      { address: 'SN:62:4G', name: 'SN6 24G', transport: 'BLE', rssi: -70 },
      { address: 'SD:00:01', name: 'SoundDrum 1', transport: 'CLASSIC' },
      { address: 'CA:R0:00', name: 'CAR AUDIO', transport: 'CLASSIC' },
    ]);
    expect(raised).toHaveLength(0);
  });
});
