/**
 * BlueGuardian evidence engine.
 *
 * Nothing is called a threat unless a concrete, documented attack pattern is
 * observed in real scans. Every scan updates an on-device baseline (online
 * statistics per device and for your surroundings), so detection adapts to
 * where you actually are instead of using fixed made-up scores.
 *
 * Detectors
 *  1. Tracker following you (unwanted-tracking detection as in AirGuard and the
 *     Apple/Google DULT draft): a tracker that is away from its owner, seen
 *     repeatedly over ≥30 min, at ≥2 places ≥300 m apart.
 *  2. Pairing-popup spam (Flipper-style BLE spam): far more pairing-popup
 *     advertisers in one scan than your learned normal (mean + 4σ, min 10).
 *  3. Look-alike of your device: an unpaired device using the exact, non-generic
 *     name of a device you paired.
 */
import { classifyAdvert, isGenericName, type DeviceFamily, type RawAdvert } from './advert';

export interface ScanObservation {
  address: string;
  name?: string;
  rssi?: number;
  transport: 'BLE' | 'CLASSIC' | 'PAIRED';
  paired?: boolean;
  connected?: boolean;
  advert?: RawAdvert;
}

export interface ScanInput {
  at: number;
  observations: ScanObservation[];
  location?: { lat: number; lng: number; accuracy: number } | null;
}

interface Sighting { at: number; rssi?: number; lat?: number; lng?: number; acc?: number }
interface Running { n: number; mean: number; m2: number }

export interface DeviceProfile {
  address: string;
  name?: string;
  family: DeviceFamily;
  tracker: boolean;
  separated: boolean | null;
  paired: boolean;
  firstSeen: number;
  lastSeen: number;
  scans: number;
  days: string[];
  rssi: Running;
  sightings: Sighting[];
}

export type FindingKind = 'tracker_following' | 'popup_spam' | 'lookalike';

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: 'high' | 'medium' | 'low';
  strength: 'strong' | 'moderate';
  deviceAddress?: string;
  deviceName: string;
  title: string;
  summary: string;
  evidence: string[];
  action: string;
  detectedAt: number;
  updatedAt: number;
}

export interface IntelSnapshot {
  version: 1;
  profiles: Record<string, DeviceProfile>;
  env: { scans: number; popup: Running; total: Running };
  findings: Finding[];
  mine: string[];
  dismissed: string[];
}

export const CONFIG = {
  followWindowMs: 12 * 3600_000,
  followMinSightings: 3,
  followMinSpanMs: 30 * 60_000,
  followMinPlaces: 2,
  followMinDistanceM: 300,
  placeRadiusM: 150,
  spamMinCount: 10,
  spamSigma: 4,
  spamMinBaselineScans: 5,
  findingTtlMs: 24 * 3600_000,
  maxProfiles: 500,
  maxSightings: 60,
};

const emptyRunning = (): Running => ({ n: 0, mean: 0, m2: 0 });

function push(r: Running, x: number): void {
  r.n += 1;
  const d = x - r.mean;
  r.mean += d / r.n;
  r.m2 += d * (x - r.mean);
}

export function sd(r: Running): number {
  return r.n > 1 ? Math.sqrt(r.m2 / (r.n - 1)) : 0;
}

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const norm = (name?: string) => (name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function minutes(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 90 ? `${(m / 60).toFixed(1)} h` : `${m} min`;
}

export function emptySnapshot(): IntelSnapshot {
  return { version: 1, profiles: {}, env: { scans: 0, popup: emptyRunning(), total: emptyRunning() }, findings: [], mine: [], dismissed: [] };
}

/** Group located sightings into places (greedy, radius CONFIG.placeRadiusM). */
export function clusterPlaces(points: Array<{ lat: number; lng: number }>): Array<{ lat: number; lng: number; count: number }> {
  const places: Array<{ lat: number; lng: number; count: number }> = [];
  for (const p of points) {
    const hit = places.find((c) => distanceM(c, p) <= CONFIG.placeRadiusM);
    if (hit) {
      hit.lat = (hit.lat * hit.count + p.lat) / (hit.count + 1);
      hit.lng = (hit.lng * hit.count + p.lng) / (hit.count + 1);
      hit.count += 1;
    } else {
      places.push({ lat: p.lat, lng: p.lng, count: 1 });
    }
  }
  return places;
}

export function detectFollowing(profile: DeviceProfile, now: number, owned: boolean): Omit<Finding, 'detectedAt' | 'updatedAt'> | null {
  if (!profile.tracker || profile.paired || owned) return null;
  if (profile.separated === false) return null; // owner is next to it: someone else's own tag
  const recent = profile.sightings.filter((s) => now - s.at <= CONFIG.followWindowMs);
  if (recent.length < CONFIG.followMinSightings) return null;
  const span = recent[recent.length - 1].at - recent[0].at;
  if (span < CONFIG.followMinSpanMs) return null;
  const located = recent.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number') as Array<Sighting & { lat: number; lng: number }>;
  const places = clusterPlaces(located);
  let maxDist = 0;
  for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) maxDist = Math.max(maxDist, distanceM(places[i], places[j]));
  const label = profile.name || 'Unknown tracker';
  const base = {
    id: `follow:${profile.address}`,
    kind: 'tracker_following' as const,
    deviceAddress: profile.address,
    deviceName: label,
  };
  if (places.length >= CONFIG.followMinPlaces && maxDist >= CONFIG.followMinDistanceM) {
    return {
      ...base,
      severity: 'high',
      strength: 'strong',
      title: 'A tracker is moving with you',
      summary: `Seen ${recent.length} times over ${minutes(span)} at ${places.length} places up to ${(maxDist / 1000).toFixed(1)} km apart.`,
      evidence: [
        `${recent.length} sightings in ${minutes(span)}`,
        `${places.length} different places, ${Math.round(maxDist)} m apart`,
        profile.separated ? 'Its owner is not nearby (separated mode)' : 'Owner status not broadcast',
      ],
      action: 'Use Find it to locate it. Check bags, pockets and your vehicle. If you find one that isn\'t yours, contact the police.',
    };
  }
  if (located.length === 0) {
    return {
      ...base,
      severity: 'medium',
      strength: 'moderate',
      title: 'Unknown tracker staying near you',
      summary: `Seen ${recent.length} times over ${minutes(span)}. Turn on location memory to check if it moves with you.`,
      evidence: [`${recent.length} sightings in ${minutes(span)}`, 'No location data yet'],
      action: 'Scan again after you move to a different place to confirm.',
    };
  }
  return null; // only ever seen in one place: a nearby stationary tag (neighbour, office)
}

export class IntelEngine {
  private snap: IntelSnapshot;
  private readonly save: (s: IntelSnapshot) => void;
  private readonly listeners = new Set<() => void>();

  constructor(initial?: IntelSnapshot | null, save: (s: IntelSnapshot) => void = () => undefined) {
    this.snap = initial && initial.version === 1 ? initial : emptySnapshot();
    this.save = save;
  }

  get snapshot(): IntelSnapshot {
    return this.snap;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private commit(): void {
    this.snap = { ...this.snap };
    try { this.save(this.snap); } catch { /* storage full: keep in memory */ }
    for (const fn of this.listeners) fn();
  }

  profile(address: string): DeviceProfile | undefined {
    return this.snap.profiles[address.toUpperCase()];
  }

  activeFindings(now = Date.now()): Finding[] {
    return this.snap.findings
      .filter((f) => now - f.updatedAt <= CONFIG.findingTtlMs && !this.snap.dismissed.includes(f.id))
      .sort((a, b) => (b.severity === 'high' ? 2 : b.severity === 'medium' ? 1 : 0) - (a.severity === 'high' ? 2 : a.severity === 'medium' ? 1 : 0));
  }

  findingsFor(address?: string): Finding[] {
    if (!address) return [];
    const key = address.toUpperCase();
    return this.activeFindings().filter((f) => f.deviceAddress === key);
  }

  markMine(address: string): void {
    const key = address.toUpperCase();
    if (!this.snap.mine.includes(key)) this.snap.mine = [...this.snap.mine, key];
    this.snap.findings = this.snap.findings.filter((f) => f.deviceAddress !== key);
    this.commit();
  }

  dismiss(findingId: string): void {
    if (!this.snap.dismissed.includes(findingId)) this.snap.dismissed = [...this.snap.dismissed.slice(-200), findingId];
    this.commit();
  }

  /** Learn from one real scan and re-run the detectors. Returns findings raised or updated by this scan. */
  ingestScan(scan: ScanInput): Finding[] {
    const now = scan.at;
    const loc = scan.location ?? null;
    const byAddress = new Map<string, ScanObservation>();
    for (const o of scan.observations) {
      const key = o.address.toUpperCase();
      const prev = byAddress.get(key);
      byAddress.set(key, prev ? { ...prev, ...o, advert: o.advert ?? prev.advert, rssi: o.rssi ?? prev.rssi, name: o.name || prev.name, paired: o.paired || prev.paired } : o);
    }

    let popupCount = 0;
    const touched: DeviceProfile[] = [];
    for (const [key, o] of byAddress) {
      const advert = o.advert ? classifyAdvert({ ...o.advert, name: o.name }) : null;
      if (advert?.isPairingPopup) popupCount += 1;
      const p: DeviceProfile = this.snap.profiles[key] ?? {
        address: key, family: 'unknown', tracker: false, separated: null, paired: false,
        firstSeen: now, lastSeen: now, scans: 0, days: [], rssi: emptyRunning(), sightings: [],
      };
      if (o.name) p.name = o.name;
      if (advert && advert.family !== 'unknown') {
        p.family = advert.family;
        p.tracker = advert.isTracker;
        p.separated = advert.separated;
      }
      p.paired = Boolean(o.paired);
      p.lastSeen = now;
      p.scans += 1;
      const day = dayKey(now);
      if (!p.days.includes(day)) p.days = [...p.days.slice(-29), day];
      if (typeof o.rssi === 'number') push(p.rssi, o.rssi);
      const s: Sighting = { at: now };
      if (typeof o.rssi === 'number') s.rssi = o.rssi;
      if (loc) { s.lat = loc.lat; s.lng = loc.lng; s.acc = loc.accuracy; }
      p.sightings = [...p.sightings, s].slice(-CONFIG.maxSightings);
      this.snap.profiles[key] = p;
      touched.push(p);
    }

    const raised: Finding[] = [];
    const upsert = (f: Omit<Finding, 'detectedAt' | 'updatedAt'>) => {
      const existing = this.snap.findings.find((x) => x.id === f.id);
      const full: Finding = { ...f, detectedAt: existing?.detectedAt ?? now, updatedAt: now };
      this.snap.findings = [...this.snap.findings.filter((x) => x.id !== f.id), full];
      raised.push(full);
    };

    // 1. Trackers following you
    for (const p of touched) {
      const f = detectFollowing(p, now, this.snap.mine.includes(p.address));
      if (f) upsert(f);
    }

    // 2. Pairing-popup spam, against your learned baseline
    const env = this.snap.env;
    const learned = env.scans >= CONFIG.spamMinBaselineScans;
    const threshold = Math.max(CONFIG.spamMinCount, learned ? env.popup.mean + CONFIG.spamSigma * Math.max(1, sd(env.popup)) : 0);
    const spam = popupCount >= threshold;
    if (spam) {
      upsert({
        id: `spam:${dayKey(now)}`,
        kind: 'popup_spam',
        severity: 'high',
        strength: 'strong',
        deviceName: `${popupCount} fake pairing devices`,
        title: 'Bluetooth popup spam nearby',
        summary: `${popupCount} devices are sending pairing popups at once. Your normal is ${learned ? env.popup.mean.toFixed(1) : 'about 0–2'}.`,
        evidence: [`${popupCount} pairing-popup advertisers in one scan`, learned ? `Learned normal: ${env.popup.mean.toFixed(1)} ± ${sd(env.popup).toFixed(1)}` : 'Above the fixed safety limit of 10'],
        action: 'Don\'t accept any pairing popups. Turn Bluetooth off for a few minutes or move away.',
      });
    } else {
      // Learn only from normal scans, so an attack never becomes the new normal.
      push(env.popup, popupCount);
    }
    push(env.total, byAddress.size);
    env.scans += 1;

    // 3. Look-alikes of your paired devices
    const pairedNames = new Map<string, DeviceProfile>();
    for (const p of Object.values(this.snap.profiles)) {
      if (p.paired && p.name && !isGenericName(p.name)) pairedNames.set(norm(p.name), p);
    }
    for (const [key, o] of byAddress) {
      if (o.paired || !o.name) continue;
      const original = pairedNames.get(norm(o.name));
      if (!original || original.address === key) continue;
      upsert({
        id: `lookalike:${key}`,
        kind: 'lookalike',
        severity: 'low',
        strength: 'moderate',
        deviceAddress: key,
        deviceName: o.name,
        title: `Another device is named “${o.name}”`,
        summary: 'Same name as a device you paired, but a different device. It may be an identical model — or an impersonation.',
        evidence: [`Your device: ${original.address}`, `This one: ${key}, not paired`],
        action: 'Only connect to the one in your paired list.',
      });
    }

    this.prune(now);
    this.commit();
    return raised;
  }

  private prune(now: number): void {
    this.snap.findings = this.snap.findings.filter((f) => now - f.updatedAt <= CONFIG.findingTtlMs * 7);
    const entries = Object.values(this.snap.profiles);
    if (entries.length > CONFIG.maxProfiles) {
      entries.sort((a, b) => (b.paired ? 1 : 0) - (a.paired ? 1 : 0) || b.lastSeen - a.lastSeen);
      this.snap.profiles = Object.fromEntries(entries.slice(0, CONFIG.maxProfiles).map((p) => [p.address, p]));
    }
  }
}

export type Standing = 'yours' | 'familiar' | 'new';

/** What we actually know about a device, from its real history on this phone. */
export function standingOf(profile: DeviceProfile | undefined, paired: boolean, trusted: boolean): { standing: Standing; detail: string } {
  if (paired || trusted) return { standing: 'yours', detail: paired ? 'Paired with this phone' : 'Trusted by you' };
  if (!profile) return { standing: 'new', detail: 'First time seen' };
  const days = profile.days.length;
  if (days >= 3 || profile.scans >= 10) return { standing: 'familiar', detail: `Seen in ${profile.scans} scans over ${days} day${days === 1 ? '' : 's'}` };
  return { standing: 'new', detail: profile.scans <= 1 ? 'First time seen' : `Seen in ${profile.scans} scans` };
}
