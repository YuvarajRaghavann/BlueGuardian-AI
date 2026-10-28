/**
 * BTGuard for scanned devices: the same three-method fusion the Secure Share link
 * uses (src/secure/trustEngine.ts, btguard/engine.py), applied BEFORE you connect.
 *
 *   Method 1  protocol & identity  -> what the device broadcasts about itself: SIG
 *                                     company ID vs claimed brand, disguised names,
 *                                     keyboard capability, pairing mode, open GATT data
 *   Method 2  radio physics        -> received signal vs the power it says it transmits
 *                                     (a relay/amplifier shows up as an impossible signal),
 *                                     signal stability across scans, address type
 *   Method 3  behaviour over time  -> trackers following you between places, pairing-popup
 *                                     spam bursts, Beta-reputation history
 *
 * Fusion (identical to the link engine):  combined = 1 − (1−p)(1−φ)(1−0.9·β),
 * trust = 100·(1 − combined).  Corroboration: a device is only called Unsafe on hard
 * evidence (a single decisive finding) or when two independent methods agree; one
 * weak signal on its own can only ever lead to Caution.
 */
import type { CheckStatus, GuardianCheck } from './guardian';

export type BtguardMethod = 'protocol' | 'physical' | 'behaviour';

export interface BtguardMethodScore {
  risk: number;
  /** Titles of the checks that contributed, strongest first. */
  reasons: string[];
}

export interface BtguardScore {
  trust: number;
  methods: Record<BtguardMethod, BtguardMethodScore>;
  /** Hard evidence, or two methods agreeing. Without it a device can't be called Unsafe. */
  corroborated: boolean;
  hard: boolean;
}

export const BTGUARD_ML_WEIGHT = 0.9;
export const HARD_RISK = 0.85;
export const SOFT_RISK = 0.3;

/** Which method each Guardian check belongs to, and how much risk each outcome carries. */
const CHECK_RISK: Record<string, { method: BtguardMethod; risk: Partial<Record<CheckStatus, number>> }> = {
  owner: { method: 'protocol', risk: { fail: 1 } },
  identity: { method: 'protocol', risk: { fail: 0.95, warn: 0.45 } },
  name: { method: 'protocol', risk: { fail: 0.9 } },
  capability: { method: 'protocol', risk: { fail: 0.9, warn: 0.4 } },
  mode: { method: 'protocol', risk: { info: 0.08 } },
  deep: { method: 'protocol', risk: { info: 0.15 } },
  address: { method: 'physical', risk: { info: 0.05 } },
  physical: { method: 'physical', risk: { fail: 0.9, warn: 0.5, info: 0.15 } },
  stability: { method: 'physical', risk: { warn: 0.35, info: 0.1 } },
  attack: { method: 'behaviour', risk: { fail: 0.95, info: 0.08 } },
  tracking: { method: 'behaviour', risk: { fail: 0.9, warn: 0.45 } },
  history: { method: 'behaviour', risk: { fail: 0.85, warn: 0.35 } },
};

export function fuseChecks(checks: GuardianCheck[]): BtguardScore {
  const methods: Record<BtguardMethod, BtguardMethodScore> = {
    protocol: { risk: 0, reasons: [] },
    physical: { risk: 0, reasons: [] },
    behaviour: { risk: 0, reasons: [] },
  };
  let hard = false;
  for (const check of checks) {
    const rule = CHECK_RISK[check.id];
    const risk = rule?.risk[check.status];
    if (!rule || !risk) continue;
    const m = methods[rule.method];
    // Several findings in one method combine like independent evidence.
    m.risk = 1 - (1 - m.risk) * (1 - risk);
    m.reasons.push(check.title);
    if (risk >= HARD_RISK && (check.status === 'fail')) hard = true;
  }
  const combined = 1 - (1 - methods.protocol.risk) * (1 - methods.physical.risk) * (1 - BTGUARD_ML_WEIGHT * methods.behaviour.risk);
  const agreeing = (Object.values(methods) as BtguardMethodScore[]).filter((m) => m.risk >= SOFT_RISK).length;
  return {
    trust: Math.round(100 * (1 - combined)),
    methods,
    corroborated: hard || agreeing >= 2,
    hard,
  };
}

/**
 * Method 2 checks from the radio itself. Received power can't exceed what a device
 * transmits; a signal far stronger than its advertised Tx power means a relay or an
 * amplified/spoofed advertisement. Large swings across scans of a device that hasn't
 * moved are noted, never decisive (bodies and walls cause them too).
 */
export function physicalChecks(input: { rssi?: number; txPower?: number; rssiSd?: number; rssiSamples?: number; paired?: boolean }): GuardianCheck[] {
  const out: GuardianCheck[] = [];
  const { rssi, txPower } = input;
  const txValid = typeof txPower === 'number' && txPower > -40 && txPower < 30;
  if (typeof rssi === 'number' && rssi < 0 && txValid) {
    if (rssi > (txPower as number) + 8 && !input.paired) {
      out.push({
        id: 'physical',
        status: 'warn',
        title: 'Signal stronger than it transmits',
        detail: `Received at ${rssi} dBm but it says it transmits at ${txPower} dBm. That's not physically possible without a relay or amplifier, a sign of a spoofed or relayed device.`,
      });
    } else {
      out.push({
        id: 'physical',
        status: 'pass',
        title: 'Signal matches its transmit power',
        detail: `Received at ${rssi} dBm from a device transmitting at ${txPower} dBm: consistent with a real device at that distance.`,
      });
    }
  }
  if (typeof input.rssiSd === 'number' && (input.rssiSamples ?? 0) >= 5) {
    if (input.rssiSd > 15 && !input.paired) {
      out.push({ id: 'stability', status: 'info', title: 'Signal jumps between scans', detail: `Its signal varies by about ±${Math.round(input.rssiSd)} dB between scans. Usually movement or walls; a relay can look the same.` });
    } else if (input.rssiSd <= 8) {
      out.push({ id: 'stability', status: 'pass', title: 'Steady signal', detail: `Its signal has been steady across ${input.rssiSamples} sightings.` });
    }
  }
  return out;
}

export const METHOD_LABEL: Record<BtguardMethod, string> = {
  protocol: 'Protocol & identity',
  physical: 'Radio physics',
  behaviour: 'Behaviour over time',
};
