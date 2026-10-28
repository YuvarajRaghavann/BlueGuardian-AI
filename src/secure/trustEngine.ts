/**
 * BTGuard continuous trust binding, ported from btguard/engine.py.
 *
 *   Method 1  crypto state     -> is the channel encrypted and authenticated?
 *   Method 2  physics          -> Channel Sounding distance vs RSSI, RF fingerprint,
 *                                 RSSI jumps (only what the phone actually exposes)
 *   Method 3  behaviour model  -> small explainable logistic regression (trustModel.json)
 *
 * The three risks are fused into one trust score every window. Trust is quick
 * to lose and slow to regain; the level (FULL / RESTRICTED / ISOLATED) decides
 * what the peer may do, and a drop triggers key rotation or full recovery.
 *
 * Corroboration (field-tested on real phones): a single soft signal (a jittery
 * WebView, a hand over the antenna) is noise far more often than an attack. So
 *  - soft evidence from ONE method can pause file sharing (RESTRICTED) but never
 *    revoke a pairing; isolation needs hard evidence (broken crypto, repeated
 *    authentication failures, RF-fingerprint / distance mismatch) or two
 *    independent methods agreeing;
 *  - a soft dip must persist for `confirmWindows` consecutive windows before it
 *    moves the score; corroborated evidence acts at once.
 */
import modelJson from './trustModel.json';

export type TrustLevel = 'ISOLATED' | 'RESTRICTED' | 'FULL';
export type Capability = 'chat' | 'file_send' | 'file_receive';

const LEVEL_RANK: Record<TrustLevel, number> = { ISOLATED: 0, RESTRICTED: 1, FULL: 2 };
const RANK_LEVEL: TrustLevel[] = ['ISOLATED', 'RESTRICTED', 'FULL'];

/** Graduated capability: a suspicious peer loses file transfer first, not everything. */
export const CAPABILITIES: Record<TrustLevel, readonly Capability[]> = {
  FULL: ['chat', 'file_send', 'file_receive'],
  RESTRICTED: ['chat'],
  ISOLATED: [],
};

export interface LinkObservation {
  t: number;
  encrypted: boolean;
  authenticated: boolean;
  /** True when the session uses the Noise channel (forward secret, mutual auth). */
  secureConnections: boolean;
  keySizeBytes: number;
  rssiDbm: number | null;
  /** Bluetooth 6.x Channel Sounding distance; null on phones that do not expose it. */
  csDistanceM: number | null;
  /** Carrier frequency offset; null unless a controller/SDR exposes it. */
  cfoKhz: number | null;
  pktRate: number;
  pairAttempts: number;
  errorRate: number;
  rttJitterMs: number;
  /** Absolute number of failed-authentication / malformed frames this window (hard evidence when repeated). */
  errorCount?: number;
}

export interface TrustConfig {
  mlWeight: number;
  cryptoHard: number;
  cryptoCap: number;
  alphaDown: number;
  alphaUp: number;
  initialTrust: number;
  downThresholds: [number, number];
  upThresholds: [number, number];
  rssiSigmaDb: number;
  refRssiDbm: number;
  pathLossN: number;
  rssiJumpDb: number;
  probationTrust: number;
  autoRecover: boolean;
  /** Without hard evidence, instant trust never goes below this (RESTRICTED band, not ISOLATED). */
  softFloor: number;
  /** This many bad frames in one window is hard evidence of tampering or injection. */
  hardErrorCount: number;
  /** Consecutive low windows needed before a soft-evidence downgrade takes effect. */
  confirmWindows: number;
}

export const DEFAULT_TRUST_CONFIG: TrustConfig = {
  mlWeight: 0.9,
  cryptoHard: 0.9,
  cryptoCap: 30,
  alphaDown: 0.6,
  alphaUp: 0.08,
  initialTrust: 80,
  downThresholds: [40, 70],
  upThresholds: [45, 75],
  rssiSigmaDb: 4,
  refRssiDbm: -59,
  pathLossN: 2,
  rssiJumpDb: 18,
  probationTrust: 55,
  autoRecover: true,
  softFloor: 50,
  hardErrorCount: 3,
  confirmWindows: 2,
};

export interface TrustModel {
  features: string[];
  mu: number[];
  sd: number[];
  w: number[];
  b: number;
  trainedOn?: string;
}

export const DEFAULT_TRUST_MODEL: TrustModel = modelJson as TrustModel;

export function featurize(o: LinkObservation): number[] {
  return [Math.log1p(Math.max(0, o.pktRate)), o.pairAttempts, o.errorRate, o.rttJitterMs];
}

const FEATURE_LABELS: Record<string, string> = {
  log_pkt_rate: 'frame rate',
  pair_attempts: 'connection attempts',
  error_rate: 'authentication failures',
  rtt_jitter_ms: 'round-trip jitter',
};

function zScores(model: TrustModel, x: number[]): number[] {
  return x.map((v, i) => Math.max(-6, Math.min(6, (v - model.mu[i]) / model.sd[i])));
}

export function modelProbability(model: TrustModel, x: number[]): number {
  const z = zScores(model, x);
  let s = model.b;
  for (let i = 0; i < z.length; i++) s += z[i] * model.w[i];
  return 1 / (1 + Math.exp(-s));
}

/** Per-feature contributions to the malicious score, largest first. */
export function explain(model: TrustModel, x: number[]): Array<{ feature: string; z: number; contribution: number }> {
  const z = zScores(model, x);
  return z
    .map((zi, i) => ({ feature: model.features[i], z: zi, contribution: zi * model.w[i] }))
    .sort((a, b) => b.contribution - a.contribution);
}

const clip = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

export function cryptoRisk(o: LinkObservation): { risk: number; reasons: string[] } {
  let risk = 0;
  const reasons: string[] = [];
  if (!o.encrypted) { risk = Math.max(risk, 1); reasons.push('link is not encrypted'); }
  if (o.keySizeBytes < 16) { risk = Math.max(risk, 0.95); reasons.push(`encryption key only ${o.keySizeBytes} bytes (<16): downgrade attempt`); }
  if (!o.secureConnections) { risk = Math.max(risk, 0.85); reasons.push('no forward-secret key exchange in use'); }
  if (!o.authenticated) { risk = Math.max(risk, 0.5); reasons.push('peer identity not verified yet (no MITM protection)'); }
  return { risk, reasons };
}

export interface PeerTrustState {
  peerId: string;
  trust: number;
  level: TrustLevel;
  state: 'ACTIVE' | 'AWAITING_REPAIR';
  cfoMu: number | null;
  cfoSd: number | null;
  rssiBaseline: number | null;
  windows: number;
  /** Consecutive windows whose score pointed to a lower level. */
  lowWindows: number;
}

export interface TrustDecision {
  t: number;
  peerId: string;
  trust: number;
  instantTrust: number;
  level: TrustLevel;
  capabilities: readonly Capability[];
  risks: { crypto: number; proximity: number; distance: number; fingerprint: number; rssiJump: number; ml: number; mlProbability: number; combined: number };
  reasons: string[];
  actions: TrustAction[];
  /** True when the score rests on hard evidence (or two methods agreeing), not one noisy signal. */
  corroborated?: boolean;
}

export type TrustAction =
  | { type: 'level_change'; from: TrustLevel; to: TrustLevel }
  | { type: 'rotate_keys'; reason: string }
  | { type: 'recover'; steps: string[] };

export class TrustEngine {
  readonly config: TrustConfig;
  readonly model: TrustModel;
  private readonly peers = new Map<string, PeerTrustState>();

  constructor(model: TrustModel = DEFAULT_TRUST_MODEL, config: Partial<TrustConfig> = {}) {
    this.model = model;
    this.config = { ...DEFAULT_TRUST_CONFIG, ...config };
  }

  /** Start scoring a peer. Re-paired peers begin on probation (RESTRICTED). */
  enroll(peerId: string, options: { probation?: boolean; cfoSamples?: number[] } = {}): PeerTrustState {
    const samples = options.cfoSamples ?? [];
    let cfoMu: number | null = null;
    let cfoSd: number | null = null;
    if (samples.length >= 5) {
      cfoMu = samples.reduce((a, b) => a + b, 0) / samples.length;
      const variance = samples.reduce((a, b) => a + (b - (cfoMu as number)) ** 2, 0) / samples.length;
      cfoSd = Math.max(Math.sqrt(variance) * 1.2, 0.8);
    }
    const state: PeerTrustState = {
      peerId,
      trust: options.probation ? this.config.probationTrust : this.config.initialTrust,
      level: options.probation ? 'RESTRICTED' : 'FULL',
      state: 'ACTIVE',
      cfoMu,
      cfoSd,
      rssiBaseline: null,
      windows: 0,
      lowWindows: 0,
    };
    this.peers.set(peerId, state);
    return state;
  }

  get(peerId: string): PeerTrustState | undefined {
    return this.peers.get(peerId);
  }

  authorize(peerId: string, capability: Capability): boolean {
    const st = this.peers.get(peerId);
    return !!st && st.state === 'ACTIVE' && CAPABILITIES[st.level].includes(capability);
  }

  proximityRisk(o: LinkObservation, st: PeerTrustState) {
    const c = this.config;
    const reasons: string[] = [];
    let distance = 0;
    let fingerprint = 0;
    let rssiJump = 0;
    if (o.csDistanceM !== null && o.rssiDbm !== null) {
      const expected = c.refRssiDbm - 10 * c.pathLossN * Math.log10(Math.max(o.csDistanceM, 0.1));
      const z = Math.abs(o.rssiDbm - expected) / c.rssiSigmaDb;
      distance = clip((z - 2.5) / 3);
      if (distance > 0.3) {
        const implied = 10 ** ((c.refRssiDbm - o.rssiDbm) / (10 * c.pathLossN));
        reasons.push(`Channel Sounding distance ${o.csDistanceM.toFixed(1)} m disagrees with signal-implied ~${implied.toFixed(1)} m (possible relay)`);
      }
    }
    if (o.cfoKhz !== null && st.cfoMu !== null && st.cfoSd !== null) {
      const zf = Math.abs(o.cfoKhz - st.cfoMu) / st.cfoSd;
      fingerprint = clip((zf - 3) / 4);
      if (fingerprint > 0.3) {
        reasons.push(`RF fingerprint mismatch: CFO ${o.cfoKhz.toFixed(1)} kHz vs enrolled ${st.cfoMu.toFixed(1)} kHz (possible clone)`);
      }
    }
    if (o.rssiDbm !== null) {
      if (st.rssiBaseline !== null) {
        const jump = Math.abs(o.rssiDbm - st.rssiBaseline);
        // Weak signal on its own (people move phones), so it is capped at 0.4.
        rssiJump = 0.4 * clip((jump - c.rssiJumpDb) / 12);
        if (rssiJump > 0.15) {
          reasons.push(`signal strength jumped ${jump.toFixed(0)} dB in one window (possible relay or device swap)`);
        }
        st.rssiBaseline = 0.8 * st.rssiBaseline + 0.2 * o.rssiDbm;
      } else {
        st.rssiBaseline = o.rssiDbm;
      }
    }
    return { risk: Math.max(distance, fingerprint, rssiJump), distance, fingerprint, rssiJump, reasons };
  }

  process(peerId: string, o: LinkObservation): TrustDecision {
    const st = this.peers.get(peerId) ?? this.enroll(peerId);
    const c = this.config;
    if (st.state === 'AWAITING_REPAIR') {
      return {
        t: o.t, peerId, trust: st.trust, instantTrust: 0, level: 'ISOLATED', capabilities: [],
        risks: { crypto: 0, proximity: 0, distance: 0, fingerprint: 0, rssiJump: 0, ml: 0, mlProbability: 0, combined: 1 },
        reasons: ['bond revoked; waiting for out-of-band re-pair'], actions: [],
      };
    }
    st.windows += 1;
    const crypto = cryptoRisk(o);
    const prox = this.proximityRisk(o, st);
    const x = featurize(o);
    const pMl = modelProbability(this.model, x);
    const ml = clip((pMl - 0.15) / 0.85); // dead zone: ignore low-confidence noise
    const mlReasons: string[] = [];
    if (ml > 0.2) {
      for (const item of explain(this.model, x).slice(0, 2)) {
        if (item.contribution > 0.2) {
          const label = FEATURE_LABELS[item.feature] ?? item.feature;
          mlReasons.push(`behaviour: ${label} is ${item.z >= 0 ? '+' : ''}${item.z.toFixed(1)} sd from normal (model score ${pMl.toFixed(2)})`);
        }
      }
    }
    const combined = 1 - (1 - crypto.risk) * (1 - prox.risk) * (1 - c.mlWeight * ml);
    let inst = 100 * (1 - combined);
    if (crypto.risk >= c.cryptoHard) inst = Math.min(inst, c.cryptoCap);

    // Corroboration: hard evidence, or two independent methods agreeing.
    const errorCount = typeof o.errorCount === 'number' ? o.errorCount : Math.round(o.errorRate * o.pktRate);
    const hard = crypto.risk >= c.cryptoHard || errorCount >= c.hardErrorCount || prox.distance > 0.6 || prox.fingerprint > 0.6;
    const softMethods = (prox.risk >= 0.3 ? 1 : 0) + (ml >= 0.5 ? 1 : 0);
    const corroborated = hard || softMethods >= 2;
    if (!corroborated) inst = Math.max(inst, c.softFloor);

    // A soft dip must persist for confirmWindows consecutive windows before it moves the
    // smoothed trust at all; corroborated evidence acts at once.
    const windowBad = inst < c.downThresholds[1];
    st.lowWindows = windowBad ? st.lowWindows + 1 : 0;
    if (corroborated || !windowBad || st.lowWindows >= c.confirmWindows) {
      const alpha = inst < st.trust ? c.alphaDown : c.alphaUp;
      st.trust = alpha * inst + (1 - alpha) * st.trust;
    }

    const actions: TrustAction[] = [];
    const next = this.nextLevel(st);
    if (next !== st.level) {
      const from = st.level;
      actions.push({ type: 'level_change', from, to: next });
      st.level = next;
      if (LEVEL_RANK[next] < LEVEL_RANK[from] && next === 'RESTRICTED') {
        actions.push({ type: 'rotate_keys', reason: 'trust dropped below FULL' });
      }
      if (next === 'ISOLATED' && c.autoRecover) {
        st.state = 'AWAITING_REPAIR';
        actions.push({ type: 'recover', steps: ['session keys rotated', 'pairing revoked', 'out-of-band re-pair required'] });
      }
    }
    return {
      t: o.t,
      peerId,
      trust: st.trust,
      instantTrust: inst,
      level: st.level,
      capabilities: CAPABILITIES[st.level],
      risks: { crypto: crypto.risk, proximity: prox.risk, distance: prox.distance, fingerprint: prox.fingerprint, rssiJump: prox.rssiJump, ml, mlProbability: pMl, combined },
      reasons: [...crypto.reasons, ...prox.reasons, ...mlReasons, ...(hard && errorCount >= c.hardErrorCount ? [`${errorCount} frames failed authentication or were malformed in one window`] : [])],
      actions,
      corroborated,
    };
  }

  /** Called after a successful out-of-band re-pair: probation at RESTRICTED. */
  completeRepair(peerId: string): PeerTrustState {
    return this.enroll(peerId, { probation: true });
  }

  forget(peerId: string): void {
    this.peers.delete(peerId);
  }

  private nextLevel(st: PeerTrustState): TrustLevel {
    const c = this.config;
    const t = st.trust;
    const down: TrustLevel = t < c.downThresholds[0] ? 'ISOLATED' : t < c.downThresholds[1] ? 'RESTRICTED' : 'FULL';
    const up: TrustLevel = t < c.upThresholds[0] ? 'ISOLATED' : t < c.upThresholds[1] ? 'RESTRICTED' : 'FULL';
    const current = LEVEL_RANK[st.level];
    if (LEVEL_RANK[down] < current) return down; // losing trust is immediate (once confirmed above)
    if (LEVEL_RANK[up] > current) return RANK_LEVEL[current + 1]; // regain one step at a time
    return st.level;
  }
}
