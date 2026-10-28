/**
 * Short, human maker names for devices that advertise without a name.
 *
 * iPhones never put their name in an advertisement, and most new Android phones,
 * watches and earbuds don't either. Their Bluetooth SIG company identifier
 * (Assigned Numbers) still says who made them, so "Apple Bluetooth device" can be
 * shown instead of hiding the device until a name lookup succeeds.
 */
import companiesJson from './data/companies.json';

const COMPANIES = companiesJson as Record<string, string>;

/** Well-known makers, by SIG company identifier, with the name people use. */
const SHORT: Record<number, string> = {
  6: 'Microsoft',
  8: 'Motorola',
  76: 'Apple',
  87: 'JBL',
  117: 'Samsung',
  135: 'Garmin',
  158: 'Bose',
  204: 'Beats',
  224: 'Google',
  301: 'Sony',
  343: 'Huami',
  398: 'Google',
  474: 'Logitech',
  637: 'Huawei',
  911: 'Xiaomi',
  1172: 'Sennheiser',
  1839: 'OnePlus',
  1946: 'Oppo',
  1993: 'Skullcandy',
  2212: 'Realme',
  3266: 'Anker',
  3275: 'Nothing',
  3281: 'boAt',
};

/** "Samsung Electronics Co. Ltd." -> "Samsung Electronics". */
export function shortCompanyName(full: string): string {
  return full
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[,.]?\s*\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|gmbh|ag|a\/s|ab|s\.?a|b\.?v|plc|technologies|technology|international)\b\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[,.\s]+$/, '')
    .trim()
    .split(' ')
    .slice(0, 2)
    .join(' ');
}

/** Maker from the advertisement's manufacturer data (company id hex -> payload). */
export function vendorFromAdvert(manufacturerData?: Record<string, string>): string | undefined {
  for (const key of Object.keys(manufacturerData ?? {})) {
    const id = parseInt(key, 16);
    if (!Number.isFinite(id)) continue;
    if (SHORT[id]) return SHORT[id];
    const full = COMPANIES[String(id)];
    if (full) return shortCompanyName(full);
  }
  return undefined;
}

/** What a classic Class-of-Device major class says the device is. */
export function classLabel(majorClass?: number): string | undefined {
  switch (majorClass) {
    case 0x0100: return 'Computer';
    case 0x0200: return 'Phone';
    case 0x0300: return 'Network device';
    case 0x0400: return 'Audio device';
    case 0x0500: return 'Keyboard or mouse';
    case 0x0600: return 'Camera or printer';
    case 0x0700: return 'Wearable';
    case 0x0800: return 'Toy';
    case 0x0900: return 'Health device';
    default: return undefined;
  }
}
