/**
 * Community recovery address key, computed on the helper's phone so the server never
 * receives the raw Bluetooth addresses of bystanders' devices. Must match
 * addressHashOf() in backend/src/services/recoveryService.ts.
 */
import { toHex, utf8 } from '../secure/crypto/bytes';
import { sha256 } from '../secure/crypto/sha256';

const MAC = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/;

export function recoveryAddressHash(address?: string | null): string | undefined {
  const mac = String(address ?? '').trim().toUpperCase();
  if (!MAC.test(mac)) return undefined;
  return toHex(sha256(utf8(`blueguardian-recovery-address-v1:${mac}`)));
}

/**
 * Only stable addresses can ever match a report: classic MACs and public/static LE
 * addresses. Resolvable private addresses (top bits 01) rotate every ~15 minutes and
 * non-resolvable ones (00) on every advertisement, so hashing them is pointless.
 */
export function isStableAddress(address: string, addressType?: 'public' | 'random', classic = false): boolean {
  if (classic || addressType === 'public') return true;
  if (addressType !== 'random') return true; // unknown type (paired/classic lists): assume stable
  const top = parseInt(address.slice(0, 2), 16) >> 6;
  return top === 3; // static random address
}
