/**
 * Guardian check: an instant, pre-connection safety verdict for any Bluetooth
 * device, computed from what the device itself broadcasts — no history needed.
 *
 * Every check uses a published standard or a documented attack:
 *  - Identity: the Bluetooth SIG company identifier inside the advertisement
 *    (Assigned Numbers, 4,000+ registered makers) is compared with the brand the
 *    name claims. A device named "AirPods" that does not broadcast Apple's ID
 *    (0x004C) is an impersonation.
 *  - Disguise: hidden Unicode (zero-width / bidi) and mixed-script look-alike
 *    letters in names, used to spoof trusted device names.
 *  - Capability: Class of Device, GATT services and GAP Appearance reveal
 *    keyboards / HID devices, which can inject keystrokes once paired
 *    (e.g. CVE-2023-45866); an "earbuds" name on a keyboard is a disguise.
 *  - Attack signatures and tracking from the evidence engine (popup spam,
 *    trackers following you, look-alikes of your devices).
 *  - Address privacy (LE Privacy resolvable addresses), connection mode
 *    (broadcast-only devices cannot connect to you), pairing mode flags.
 *  - Behaviour history (Beta-reputation trust) as one input, not the gate.
 *  - Optional deep inspection: a non-bonding GATT read of Device Information
 *    and a probe of whether protected data requires pairing.
 */
import companiesJson from './data/companies.json';
import servicesJson from './data/services.json';
import appearanceJson from './data/appearance.json';
import type { Finding, TrustOpinion } from './engine';
import { fuseChecks, physicalChecks, type BtguardScore } from './btguardScan';

const COMPANIES = companiesJson as Record<string, string>;
const SERVICES = servicesJson as Record<string, string>;
const APPEARANCE = appearanceJson as Record<string, string>;

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';
export type Verdict = 'safe' | 'clear' | 'caution' | 'unsafe';

export interface GuardianCheck {
  id: string;
  status: CheckStatus;
  title: string;
  detail: string;
}

export interface GattInspection {
  connected: boolean;
  timedOut?: boolean;
  services: string[];
  info: { manufacturer?: string; model?: string; firmware?: string };
  protectedReads: number;
  openReads: number;
  at: number;
}

export interface GuardianInput {
  name?: string;
  address?: string;
  paired?: boolean;
  trusted?: boolean;
  blockedByUser?: boolean;
  mine?: boolean;
  manufacturerData?: Record<string, string>;
  serviceUuids?: string[];
  rawAdvert?: string;
  addressType?: 'public' | 'random';
  deviceClass?: number;
  majorClass?: number;
  connectable?: boolean;
  tracker?: boolean;
  separated?: boolean | null;
  popupAdvertiser?: boolean;
  findings?: Finding[];
  spamActive?: boolean;
  opinion?: TrustOpinion;
  scans?: number;
  inspection?: GattInspection;
  /** Radio physics (BTGuard method 2). */
  rssi?: number;
  txPower?: number;
  rssiSd?: number;
  rssiSamples?: number;
}

export interface GuardianResult {
  verdict: Verdict;
  summary: string;
  checks: GuardianCheck[];
  maker?: string;
  identityVerified: boolean;
  /** BTGuard three-method fusion behind the verdict (protocol, radio physics, behaviour). */
  btguard: BtguardScore;
}

// ---------------------------------------------------------------- parsing

export interface ParsedAdvert {
  flags?: number;
  appearance?: number;
  companyIds: number[];
  services16: string[];
}

/** Parse raw AD structures (Core Spec Vol 3, Part C, §11). */
export function parseAdvert(hex?: string): ParsedAdvert {
  const out: ParsedAdvert = { companyIds: [], services16: [] };
  if (!hex) return out;
  const b: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < b.length;) {
    const len = b[i];
    if (!len || i + len >= b.length) break;
    const type = b[i + 1];
    const data = b.slice(i + 2, i + 1 + len);
    if (type === 0x01 && data.length) out.flags = data[0];
    else if (type === 0x19 && data.length >= 2) out.appearance = data[0] | (data[1] << 8);
    else if (type === 0xff && data.length >= 2) out.companyIds.push(data[0] | (data[1] << 8));
    else if ((type === 0x02 || type === 0x03) && data.length >= 2) {
      for (let j = 0; j + 1 < data.length; j += 2) out.services16.push(((data[j + 1] << 8) | data[j]).toString(16).padStart(4, '0'));
    } else if (type === 0x16 && data.length >= 2) {
      out.services16.push(((data[1] << 8) | data[0]).toString(16).padStart(4, '0'));
    }
    i += len + 1;
  }
  return out;
}

const short16 = (uuid: string): string => {
  const u = uuid.toLowerCase();
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(u);
  return m ? m[1] : u;
};

export function companyName(id: number): string | undefined {
  return COMPANIES[String(id)];
}

export function serviceName(uuid: string): string | undefined {
  return SERVICES[short16(uuid)];
}

const hexId = (id: number) => '0x' + id.toString(16).toUpperCase().padStart(4, '0');

// ---------------------------------------------------------------- brands

interface Brand { name: string; pattern: RegExp; ids: number[]; strict?: boolean }

/** Brand names in device names, mapped to their Bluetooth SIG company identifiers. */
export const BRANDS: Brand[] = [
  { name: 'Apple', pattern: /\b(airpods?|iphone|ipad|macbook|apple|airtag)\b/i, ids: [76], strict: true },
  { name: 'Beats', pattern: /\b(beats|powerbeats|studio buds)\b/i, ids: [204, 76] },
  { name: 'Samsung', pattern: /\b(galaxy|samsung)\b/i, ids: [117] },
  { name: 'Google', pattern: /\b(pixel)\b/i, ids: [224, 398] },
  { name: 'Sony', pattern: /\b(sony|wh-?1000|wf-?1000|linkbuds)/i, ids: [301, 86] },
  { name: 'Bose', pattern: /\bbose\b/i, ids: [158] },
  { name: 'JBL / Harman', pattern: /\b(jbl|harman|akg)\b/i, ids: [87, 1882] },
  { name: 'Xiaomi', pattern: /\b(xiaomi|redmi|mi band)\b/i, ids: [911, 343] },
  { name: 'Huawei', pattern: /\b(huawei|freebuds)\b/i, ids: [637] },
  { name: 'OnePlus', pattern: /\boneplus\b/i, ids: [1839] },
  { name: 'Oppo', pattern: /\b(oppo|enco)\b/i, ids: [1946] },
  { name: 'Realme', pattern: /\brealme\b/i, ids: [2212] },
  { name: 'Sennheiser', pattern: /\bsennheiser\b/i, ids: [1172] },
  { name: 'Nothing', pattern: /\b(nothing (ear|phone|headphone)|cmf (buds|watch))\b/i, ids: [3275] },
  { name: 'Microsoft', pattern: /\b(microsoft|surface|xbox)\b/i, ids: [6] },
  { name: 'Garmin', pattern: /\bgarmin\b/i, ids: [135] },
  { name: 'Logitech', pattern: /\b(logitech|mx master|mx keys)\b/i, ids: [474] },
  { name: 'Marshall', pattern: /\bmarshall\b/i, ids: [1626] },
  { name: 'Skullcandy', pattern: /\bskullcandy\b/i, ids: [1993] },
  { name: 'Anker', pattern: /\b(anker|soundcore)\b/i, ids: [3266] },
  { name: 'boAt', pattern: /\b(boat|rockerz|airdopes)\b/i, ids: [3281] },
  { name: 'Amazfit', pattern: /\bamazfit\b/i, ids: [343] },
  { name: 'Bang & Olufsen', pattern: /\b(beoplay|bang ?& ?olufsen)\b/i, ids: [259] },
  { name: 'Motorola', pattern: /\b(motorola|moto [a-z0-9])/i, ids: [8] },
];

export function claimedBrand(name?: string): Brand | undefined {
  if (!name) return undefined;
  return BRANDS.find((b) => b.pattern.test(name));
}

// ---------------------------------------------------------------- disguise

const HIDDEN = /[​-‏‪-‮⁠-⁤﻿­]/;
const LATIN = /[A-Za-z]/;
const CONFUSABLE = /[Ͱ-ϿЀ-ӿ]/; // Greek and Cyrillic look-alikes

export function nameDisguise(name?: string): string | null {
  if (!name) return null;
  if (HIDDEN.test(name)) return 'Its name contains hidden characters, a trick used to copy trusted device names.';
  for (const word of name.split(/\s+/)) {
    if (LATIN.test(word) && CONFUSABLE.test(word)) {
      return `"${word}" mixes Latin with Greek or Cyrillic look-alike letters, a trick used to impersonate devices.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- assess

const MAJOR_PERIPHERAL = 0x0500;
const MAJOR_AUDIO = 0x0400;
const AUDIO_NAME = /\b(buds?|pods?|tws|earbuds?|ear|headphones?|headset|speaker|sound|audio|neckband|rockerz|airdopes)\b/i;

export function assessDevice(input: GuardianInput): GuardianResult {
  const checks: GuardianCheck[] = [];
  const add = (c: GuardianCheck) => checks.push(c);
  const parsed = parseAdvert(input.rawAdvert);
  const companies = Array.from(new Set([
    ...Object.keys(input.manufacturerData ?? {}).map((k) => parseInt(k, 16)).filter((n) => Number.isFinite(n)),
    ...parsed.companyIds,
  ]));
  const services = Array.from(new Set([...(input.serviceUuids ?? []).map(short16), ...parsed.services16]));
  const hasAdvert = Boolean(input.rawAdvert) || companies.length > 0 || services.length > 0;
  const appearanceCategory = typeof parsed.appearance === 'number' ? parsed.appearance >> 6 : undefined;
  const findings = input.findings ?? [];
  let identityVerified = false;
  let maker: string | undefined;

  // 1. Owner decisions
  if (input.blockedByUser) add({ id: 'owner', status: 'fail', title: 'You blocked this device', detail: 'BlueGuardian will not connect to it until you unblock it.' });
  else if (input.paired) add({ id: 'owner', status: 'pass', title: 'Paired with this phone', detail: 'You approved this device before.' });
  else if (input.trusted) add({ id: 'owner', status: 'pass', title: 'Trusted by you', detail: 'You marked this device as trusted.' });

  // 2. Identity: company identifier vs claimed brand
  const brand = claimedBrand(input.name);
  const makers = companies.map((id) => ({ id, name: companyName(id) })).filter((c) => c.name) as Array<{ id: number; name: string }>;
  const inspectedMaker = input.inspection?.info.manufacturer;
  if (brand) {
    const match = makers.find((m) => brand.ids.includes(m.id));
    // Device Information maker string matches if it names the brand or the SIG-registered company behind it.
    const makerWords = [
      ...brand.name.toLowerCase().split(/[ /&]+/),
      ...brand.ids.map((id) => (companyName(id) ?? '').toLowerCase().split(/[\s,.]+/)[0]),
    ].filter((w) => w.length > 2);
    const inspectedMatch = inspectedMaker ? brand.pattern.test(inspectedMaker) || makerWords.some((w) => inspectedMaker.toLowerCase().includes(w)) : false;
    if (match || inspectedMatch) {
      identityVerified = true;
      maker = match?.name ?? inspectedMaker;
      add({ id: 'identity', status: 'pass', title: `Verified ${brand.name} device`, detail: match ? `Broadcasts ${brand.name}'s registered Bluetooth ID (${hexId(match.id)}, ${match.name}).` : `Its Device Information reports "${inspectedMaker}".` });
    } else if (brand.strict && hasAdvert && !input.paired) {
      add({ id: 'identity', status: 'fail', title: `Not a real ${brand.name} device`, detail: `Its name claims ${brand.name} but doesn't broadcast ${brand.name}'s registered Bluetooth ID (${hexId(brand.ids[0])}). Genuine ${brand.name} devices always do.` });
    } else if (makers.length && !input.paired) {
      add({ id: 'identity', status: 'warn', title: `Name says ${brand.name}, ID says ${makers[0].name}`, detail: `The broadcast maker ID (${hexId(makers[0].id)}) doesn't belong to ${brand.name}. It may use another company's chip, or it may be a copy.` });
      maker = makers[0].name;
    } else if (inspectedMaker && !input.paired) {
      add({ id: 'identity', status: 'warn', title: `Name says ${brand.name}, device says "${inspectedMaker}"`, detail: 'Its Device Information names a different maker.' });
    } else {
      add({ id: 'identity', status: 'info', title: `Claims to be ${brand.name}`, detail: "It doesn't broadcast a maker ID, so the brand can't be confirmed before connecting." });
    }
  } else if (makers.length) {
    identityVerified = true;
    maker = makers[0].name;
    add({ id: 'identity', status: 'pass', title: `Made by ${makers[0].name}`, detail: `Broadcasts a maker ID registered with the Bluetooth SIG (${hexId(makers[0].id)}).` });
  } else if (inspectedMaker) {
    maker = inspectedMaker;
    add({ id: 'identity', status: 'pass', title: `Reports maker "${inspectedMaker}"`, detail: 'Read from its Device Information service without pairing.' });
  } else {
    add({ id: 'identity', status: 'info', title: 'Maker not broadcast', detail: 'Many simple devices don\'t include a maker ID. Run a deep check for more detail.' });
  }

  // 3. Disguised names and copies of your devices
  const disguise = nameDisguise(input.name);
  const lookalike = findings.find((f) => f.kind === 'lookalike');
  if (disguise) add({ id: 'name', status: 'fail', title: 'Disguised name', detail: disguise });
  else if (lookalike) add({ id: 'name', status: 'fail', title: 'Copies the name of your device', detail: lookalike.summary });
  else if (input.name) add({ id: 'name', status: 'pass', title: 'Name is genuine text', detail: 'No hidden characters or look-alike letters.' });

  // 4. Capability: input devices (keystroke injection risk) and disguises
  const isInput = input.majorClass === MAJOR_PERIPHERAL || services.includes('1812') || appearanceCategory === 15
    || (input.inspection?.services ?? []).some((s) => short16(s) === '1812');
  const namedAudio = AUDIO_NAME.test(input.name ?? '');
  const isAudio = input.majorClass === MAJOR_AUDIO || appearanceCategory === 33 || appearanceCategory === 37 || namedAudio;
  if (isInput && namedAudio && !input.paired && !input.trusted) {
    add({ id: 'capability', status: 'fail', title: 'Audio name, keyboard inside', detail: 'It calls itself an audio device but declares itself a keyboard or input device. Disguised keyboards can type commands on your phone once paired.' });
  } else if (isInput && !input.paired && !input.trusted) {
    add({ id: 'capability', status: 'warn', title: 'Keyboard or input device', detail: 'Once paired it can type and click on your phone. Only pair keyboards and mice you own.' });
  } else if (isInput) {
    add({ id: 'capability', status: 'pass', title: 'Your input device', detail: 'Keyboard or mouse you have already approved.' });
  } else if (typeof input.majorClass === 'number' || hasAdvert || input.inspection) {
    const what = isAudio ? 'an audio device' : appearanceCategory !== undefined && APPEARANCE[String(appearanceCategory)] ? `a ${APPEARANCE[String(appearanceCategory)].toLowerCase()}` : 'a regular device';
    add({ id: 'capability', status: 'pass', title: 'No keyboard control', detail: `Declares itself as ${what}; it can't type on your phone.` });
  }

  // 5. Attack signatures
  if (input.popupAdvertiser && input.spamActive) {
    add({ id: 'attack', status: 'fail', title: 'Part of a popup spam attack', detail: 'It sends fake pairing popups during a burst far above your normal. Don\'t accept any popups.' });
  } else if (input.popupAdvertiser) {
    add({ id: 'attack', status: 'info', title: 'Sends pairing popups', detail: 'Normal for Fast Pair and AirPods-style devices. Accept only if it\'s yours.' });
  }

  // 6. Tracking
  const following = findings.find((f) => f.kind === 'tracker_following');
  if (following) add({ id: 'tracking', status: 'fail', title: following.title, detail: following.summary });
  else if (input.tracker && !input.paired && !input.mine && input.separated) {
    add({ id: 'tracking', status: 'warn', title: 'Tracker away from its owner', detail: 'BlueGuardian will alert you if it keeps appearing near you in different places.' });
  } else if (input.tracker && !input.mine && !input.paired) {
    add({ id: 'tracking', status: 'pass', title: "Tracker with its owner nearby", detail: "It reports that its owner's phone is close, so it isn't tracking you." });
  }

  // 7. Behaviour over time (one input, not the gate)
  const o = input.opinion;
  if (o) {
    if (o.level === 'untrusted') add({ id: 'history', status: 'fail', title: 'Bad track record', detail: 'Earlier scans recorded warning signs for this device.' });
    else if (o.level === 'uncertain') add({ id: 'history', status: 'warn', title: 'Mixed track record', detail: 'Earlier scans recorded some warning signs.' });
    else if (o.level === 'trusted' || o.level === 'likely_safe') add({ id: 'history', status: 'pass', title: 'Good track record', detail: `Behaved consistently across ${input.scans ?? 0} scans.` });
    else add({ id: 'history', status: 'info', title: 'No history yet', detail: 'The checks above don\'t need history.' });
  }

  // 8. Connection mode and address privacy (informational)
  if (input.connectable === false) add({ id: 'mode', status: 'pass', title: 'Broadcast-only', detail: "It can't connect to your phone." });
  else if (typeof parsed.flags === 'number' && (parsed.flags & 0x03)) add({ id: 'mode', status: 'info', title: 'Ready to pair', detail: 'It is in pairing mode right now.' });
  if (input.addressType === 'random' && input.address) {
    const top = parseInt(input.address.slice(0, 2), 16) >> 6;
    if (top === 1) add({ id: 'address', status: 'pass', title: 'Private address', detail: 'Uses a rotating Bluetooth LE Privacy address, so it can\'t be tracked by its address.' });
    else if (top === 0) add({ id: 'address', status: 'info', title: 'Disposable address', detail: 'A non-resolvable random address, common for beacons, trackers and broadcast-only devices.' });
    else add({ id: 'address', status: 'info', title: 'Static random address', detail: 'Same address each time it powers on.' });
  }

  // 9. Deep inspection results
  const insp = input.inspection;
  if (insp) {
    if (!insp.connected) add({ id: 'deep', status: 'info', title: 'Deep check: no answer', detail: 'It didn\'t accept a connection for inspection.' });
    else if (insp.protectedReads > 0) add({ id: 'deep', status: 'pass', title: 'Protects its data', detail: 'It refused to share protected data until paired, as secure devices should.' });
    else if (insp.openReads > 0) add({ id: 'deep', status: 'info', title: 'Shares data without pairing', detail: 'Normal for simple gadgets; don\'t store anything private on it.' });
  }

  // 10. Radio physics (BTGuard method 2): signal vs advertised transmit power, stability.
  for (const c of physicalChecks({ rssi: input.rssi, txPower: input.txPower, rssiSd: input.rssiSd, rssiSamples: input.rssiSamples, paired: input.paired })) add(c);

  // BTGuard fusion of the three methods. Unsafe needs corroboration: hard evidence or two
  // methods agreeing; a lone weak signal is at most Caution.
  const btguard = fuseChecks(checks);
  const fails = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');
  const verdict: Verdict = fails.length && btguard.corroborated ? 'unsafe' : fails.length || warns.length ? 'caution'
    : input.paired || input.trusted || identityVerified || o?.level === 'trusted' || o?.level === 'likely_safe' ? 'safe' : 'clear';
  const summary = fails[0]?.title ?? warns[0]?.title
    ?? (input.paired ? 'Paired with this phone' : identityVerified && maker ? `Verified: ${maker}` : 'No risks found');

  return { verdict, summary, checks, maker, identityVerified, btguard };
}

export const VERDICT_STYLE: Record<Verdict, { label: string; color: string; rank: number }> = {
  safe: { label: 'Safe', color: 'var(--success)', rank: 0 },
  clear: { label: 'Looks safe', color: '#a7e8a0', rank: 1 },
  caution: { label: 'Caution', color: 'var(--warning)', rank: 2 },
  unsafe: { label: 'Unsafe', color: 'var(--danger)', rank: 3 },
};
