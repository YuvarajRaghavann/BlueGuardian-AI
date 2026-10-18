/**
 * Identify what a BLE advertisement is from its raw payload — not from its name.
 *
 * Signatures (public, documented formats):
 *  - Apple Find My "offline finding": company 0x004C, type 0x12. Length 0x19 = the
 *    accessory is SEPARATED from its owner (full rotating key); 0x02 = owner nearby.
 *    (Heinrich et al., "AirGuard", WiSec 2022; Apple/Google DULT draft.)
 *  - Apple Proximity Pairing / Nearby Action popups: company 0x004C, type 0x07 / 0x0F.
 *  - Samsung SmartTag: service data 0xFD5A.      - Tile: service 0xFEED / 0xFEEC.
 *  - Google Find My Device network: service data 0xFEAA, frame 0x40 / 0x41.
 *  - DULT (IETF draft, Apple+Google) non-owner service: 0xFCB2.
 *  - Chipolo: 0xFE33.     - Google Fast Pair popup: service data 0xFE2C.
 *  - Microsoft Swift Pair popup: company 0x0006, first byte 0x03.
 */

export type DeviceFamily =
  | 'apple_findmy'
  | 'samsung_smarttag'
  | 'tile'
  | 'google_findmy'
  | 'chipolo'
  | 'dult_tracker'
  | 'apple_popup'
  | 'fast_pair'
  | 'swift_pair'
  | 'unknown';

export interface RawAdvert {
  name?: string;
  serviceUuids?: string[];
  /** company id (hex, 4 chars, lowercase) -> payload hex (bytes after the company id) */
  manufacturerData?: Record<string, string>;
  /** service UUID (full 128-bit, lowercase) -> payload hex */
  serviceData?: Record<string, string>;
}

export interface AdvertInfo {
  family: DeviceFamily;
  isTracker: boolean;
  /** For Find My trackers: true = away from its owner; false = owner nearby; null = unknown. */
  separated: boolean | null;
  /** Advert type used by "pairing popup" spam attacks. */
  isPairingPopup: boolean;
  label: string;
}

const short = (uuid: string): string => {
  const u = uuid.toLowerCase();
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(u);
  return m ? m[1] : u;
};

function bytes(hex: string | undefined): number[] {
  if (!hex) return [];
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

const LABELS: Record<DeviceFamily, string> = {
  apple_findmy: 'Apple Find My tracker',
  samsung_smarttag: 'Samsung SmartTag',
  tile: 'Tile tracker',
  google_findmy: 'Google Find My tag',
  chipolo: 'Chipolo tracker',
  dult_tracker: 'Location tracker',
  apple_popup: 'Apple pairing popup',
  fast_pair: 'Fast Pair popup',
  swift_pair: 'Swift Pair popup',
  unknown: 'Bluetooth device',
};

const TRACKERS: ReadonlySet<DeviceFamily> = new Set(['apple_findmy', 'samsung_smarttag', 'tile', 'google_findmy', 'chipolo', 'dult_tracker']);

function info(family: DeviceFamily, separated: boolean | null = null): AdvertInfo {
  return {
    family,
    isTracker: TRACKERS.has(family),
    separated,
    isPairingPopup: family === 'apple_popup' || family === 'fast_pair' || family === 'swift_pair',
    label: LABELS[family],
  };
}

export function classifyAdvert(advert: RawAdvert): AdvertInfo {
  const mfg = advert.manufacturerData ?? {};
  const svcData: Record<string, string> = {};
  for (const [k, v] of Object.entries(advert.serviceData ?? {})) svcData[short(k)] = v;
  const uuids = new Set((advert.serviceUuids ?? []).map(short));

  const apple = bytes(mfg['004c']);
  if (apple.length >= 2) {
    // Apple packs several TLVs; scan them.
    for (let i = 0; i + 1 < apple.length;) {
      const type = apple[i];
      const len = apple[i + 1];
      if (type === 0x12) return info('apple_findmy', len >= 0x19 ? true : len <= 0x02 ? false : null);
      if (type === 0x07 || type === 0x0f) return info('apple_popup');
      i += 2 + len;
    }
  }
  if ('fd5a' in svcData) return info('samsung_smarttag');
  if (uuids.has('feed') || uuids.has('feec') || 'feed' in svcData || 'feec' in svcData) return info('tile');
  if ('fcb2' in svcData || uuids.has('fcb2')) return info('dult_tracker');
  if ('feaa' in svcData) {
    const frame = bytes(svcData['feaa'])[0];
    if (frame === 0x40 || frame === 0x41) return info('google_findmy');
  }
  if ('fe33' in svcData || uuids.has('fe33')) return info('chipolo');
  if ('fe2c' in svcData) return info('fast_pair');
  const ms = bytes(mfg['0006']);
  if (ms[0] === 0x03) return info('swift_pair');
  return info('unknown');
}

/** Names too common to identify one device ("TWS", "BT Speaker"…). */
export function isGenericName(name?: string): boolean {
  const n = (name ?? '').trim().toLowerCase();
  if (n.length < 4) return true;
  return /^(tws|bt|ble|bluetooth|earbuds?|headset|headphones?|speaker|audio|car ?audio|car ?kit|wireless|music|i\d+|unknown|n\/a|tv|watch|band|mouse|keyboard)( ?[-_ ]?\w{0,4})?$/.test(n);
}
