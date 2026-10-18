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
  /** Beta-reputation trust state (see trust section below). Missing on profiles from older builds. */
  trust?: TrustState;
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

  /** Owner decisions are evidence too, and appear in the ledger. */
  recordDecision(address: string, decision: 'trust' | 'untrust' | 'block' | 'unblock', name?: string, now = Date.now()): void {
    const key = address.toUpperCase();
    const p: DeviceProfile = this.snap.profiles[key] ?? {
      address: key, name, family: 'unknown', tracker: false, separated: null, paired: false,
      firstSeen: now, lastSeen: now, scans: 0, days: [], rssi: emptyRunning(), sightings: [],
    };
    const t = p.trust ?? newTrust(now);
    p.trust = t;
    const W = TRUST.weights;
    if (decision === 'trust' && !t.credited.user_trust) {
      t.credited.user_trust = now;
      addEvidence(t, now, 'user_trust', W.user_trust, 'You marked it as trusted');
    } else if (decision === 'untrust') {
      delete t.credited.user_trust;
      addEvidence(t, now, 'user_untrust', W.user_untrust, 'You removed your trust');
    } else if (decision === 'block') {
      addEvidence(t, now, 'user_block', W.user_block, 'You blocked it');
    }
    this.snap.profiles[key] = p;
    this.commit();
  }

  /** "Trusted" also needs your consent: pairing or an explicit Trust. Otherwise the best level is "Likely safe". */
  trustOf(address?: string, now = Date.now()): TrustOpinion {
    const t = address ? this.snap.profiles[address.toUpperCase()]?.trust : undefined;
    const o = trustOpinion(t, now);
    if (o.level === 'trusted' && !(t?.credited.paired || t?.credited.user_trust)) return { ...o, level: 'likely_safe' };
    return o;
  }

  markMine(address: string): void {
    const key = address.toUpperCase();
    const prof = this.snap.profiles[key];
    if (prof) {
      prof.trust = prof.trust ?? newTrust(Date.now());
      addEvidence(prof.trust, Date.now(), 'user_mine', TRUST.weights.user_mine, 'You said this tracker is yours');
    }
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
      const trust = p.trust ?? newTrust(now);
      p.trust = trust;
      const W = TRUST.weights;
      let identityChanged = false;
      if (o.name && p.name && norm(o.name) !== norm(p.name) && p.scans > 0) {
        identityChanged = true;
        addEvidence(trust, now, 'identity_change', W.identity_change, `Name changed from “${p.name}” to “${o.name}”`);
      }
      if (advert && advert.family !== 'unknown' && p.family !== 'unknown' && p.family !== advert.family) {
        identityChanged = true;
        addEvidence(trust, now, 'identity_change', W.identity_change, `Advertised type changed (${p.family} → ${advert.family})`);
      }
      if (o.name) p.name = o.name;
      if (advert && advert.family !== 'unknown') {
        p.family = advert.family;
        p.tracker = advert.isTracker;
        p.separated = advert.separated;
      }
      if (o.paired && !trust.credited.paired) {
        trust.credited.paired = now;
        addEvidence(trust, now, 'paired', W.paired, 'Paired with this phone (keys exchanged with your approval)');
      }
      if (o.connected && !sameDay(trust.credited.connected, now)) {
        trust.credited.connected = now;
        addEvidence(trust, now, 'connected', W.connected, 'Connected to your phone today');
      }
      let anomalous = false;
      if (typeof o.rssi === 'number' && p.rssi.n >= TRUST.signalMinSamples) {
        const z = (o.rssi - p.rssi.mean) / Math.max(3, sd(p.rssi));
        if (Math.abs(z) > TRUST.signalAnomalyZ) {
          anomalous = true;
          addEvidence(trust, now, 'signal_anomaly', W.signal_anomaly, `Signal ${o.rssi} dBm is far from its usual ${p.rssi.mean.toFixed(0)} dBm (z = ${z.toFixed(1)})`);
        }
      }
      if (!identityChanged && !anomalous) {
        const today = sameDay(trust.credited.consistentDay, now) ? (trust.credited.consistentAmount ?? 0) : 0;
        const credit = Math.min(W.consistent, W.consistentDailyCap - today);
        if (credit > 1e-9) {
          trust.credited.consistentDay = now;
          trust.credited.consistentAmount = today + credit;
          addEvidence(trust, now, 'consistent', credit, 'Seen again, behaving as before');
        }
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
      // A finding is negative evidence for the device it concerns (at most once a day per finding).
      const target = f.deviceAddress ? this.snap.profiles[f.deviceAddress] : undefined;
      if (target) {
        const t = target.trust ?? newTrust(now);
        target.trust = t;
        const key = 'finding:' + f.id;
        if (!sameDay(t.credited[key], now)) {
          t.credited[key] = now;
          const kind = f.severity === 'high' ? 'finding_high' : f.severity === 'medium' ? 'finding_medium' : 'finding_low';
          addEvidence(t, now, kind, TRUST.weights[kind], f.title);
        }
      }
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

// ----------------------------------------------------------------------------
// Trust score: Beta Reputation System / Subjective Logic (Jøsang & Ismail 2002;
// Jøsang 2016). Positive evidence r and negative evidence s from real
// observations form a Beta(r+1, s+1)-style opinion:
//   belief b = r/(r+s+W)   disbelief d = s/(r+s+W)   uncertainty u = W/(r+s+W)
//   trust  P = b + a·u   (a = 0.5 base rate, W = 2 non-informative prior)
// Evidence fades with a 14-day half-life, so trust must keep being earned and
// old mistakes are forgiven slowly. Every change is written to a ledger.
// ----------------------------------------------------------------------------

export interface Evidence {
  at: number;
  kind: EvidenceKind;
  /** Positive = adds to r (good evidence), negative = adds to s (bad evidence). */
  delta: number;
  note: string;
}

export type EvidenceKind =
  | 'paired' | 'user_trust' | 'user_untrust' | 'user_block' | 'user_mine'
  | 'consistent' | 'connected' | 'identity_change' | 'signal_anomaly'
  | 'finding_high' | 'finding_medium' | 'finding_low';

export interface TrustState {
  r: number;
  s: number;
  at: number;
  ledger: Evidence[];
  history: Array<{ at: number; p: number; c: number }>;
  /** Last time each once-per-period credit was given. */
  credited: Record<string, number>;
}

export const TRUST = {
  W: 2,
  baseRate: 0.5,
  halfLifeMs: 14 * 86_400_000,
  weights: {
    paired: 3,
    user_trust: 5,
    user_untrust: -2,
    user_block: -10,
    user_mine: 2,
    consistent: 0.3,
    consistentDailyCap: 1,
    connected: 0.5,
    identity_change: -1.5,
    signal_anomaly: -0.4,
    finding_high: -5,
    finding_medium: -2,
    finding_low: -0.75,
  },
  signalAnomalyZ: 4,
  signalMinSamples: 8,
  maxLedger: 40,
  maxHistory: 120,
};

export type TrustLevel = 'unverified' | 'trusted' | 'likely_safe' | 'uncertain' | 'untrusted';

export interface TrustOpinion {
  belief: number;
  disbelief: number;
  uncertainty: number;
  /** Projected trust probability 0..1 (shown as 0–100). */
  p: number;
  /** 1 − uncertainty: how much evidence backs the score. */
  confidence: number;
  level: TrustLevel;
  positive: number;
  negative: number;
}

export function newTrust(now: number): TrustState {
  return { r: 0, s: 0, at: now, ledger: [], history: [], credited: {} };
}

function decayed(t: TrustState, now: number): { r: number; s: number } {
  const f = Math.pow(0.5, Math.max(0, now - t.at) / TRUST.halfLifeMs);
  return { r: t.r * f, s: t.s * f };
}

export function opinionFrom(r: number, s: number): TrustOpinion {
  const total = r + s + TRUST.W;
  const belief = r / total;
  const disbelief = s / total;
  const uncertainty = TRUST.W / total;
  const p = belief + TRUST.baseRate * uncertainty;
  const confidence = 1 - uncertainty;
  const level: TrustLevel = confidence < 0.35 ? 'unverified'
    : p >= 0.8 ? 'trusted'
      : p >= 0.6 ? 'likely_safe'
        : p >= 0.4 ? 'uncertain' : 'untrusted';
  return { belief, disbelief, uncertainty, p, confidence, level, positive: r, negative: s };
}

export function trustOpinion(t: TrustState | undefined, now = Date.now()): TrustOpinion {
  if (!t) return opinionFrom(0, 0);
  const { r, s } = decayed(t, now);
  return opinionFrom(r, s);
}

/** Apply one piece of evidence: decay to now, add, log it, record a history point. */
export function addEvidence(t: TrustState, now: number, kind: EvidenceKind, delta: number, note: string): void {
  const { r, s } = decayed(t, now);
  t.r = r + Math.max(0, delta);
  t.s = s + Math.max(0, -delta);
  t.at = now;
  t.ledger = [...t.ledger, { at: now, kind, delta, note }].slice(-TRUST.maxLedger);
  const o = opinionFrom(t.r, t.s);
  const last = t.history[t.history.length - 1];
  const point = { at: now, p: Math.round(o.p * 1000) / 1000, c: Math.round(o.confidence * 1000) / 1000 };
  if (last && now - last.at < 60_000) t.history[t.history.length - 1] = point;
  else t.history = [...t.history, point].slice(-TRUST.maxHistory);
}

const sameDay = (a: number | undefined, b: number) => a !== undefined && dayKey(a) === dayKey(b);

export type Standing = 'yours' | 'familiar' | 'new';

/** What we actually know about a device, from its real history on this phone. */
export function standingOf(profile: DeviceProfile | undefined, paired: boolean, trusted: boolean): { standing: Standing; detail: string } {
  if (paired || trusted) return { standing: 'yours', detail: paired ? 'Paired with this phone' : 'Trusted by you' };
  if (!profile) return { standing: 'new', detail: 'First time seen' };
  const days = profile.days.length;
  if (days >= 3 || profile.scans >= 10) return { standing: 'familiar', detail: `Seen in ${profile.scans} scans over ${days} day${days === 1 ? '' : 's'}` };
  return { standing: 'new', detail: profile.scans <= 1 ? 'First time seen' : `Seen in ${profile.scans} scans` };
}
