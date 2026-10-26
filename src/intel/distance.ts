/**
 * Rough distance from signal strength (log-distance path-loss model):
 *   d = 10 ^ ((P1m − RSSI) / (10 · n))
 * P1m = advertised Tx power − 41 dB when the device sends it, else −59 dBm (typical phone/earbud);
 * n = 2.2 (indoor). Bodies and walls add ±50% or more, so this is shown as "about".
 */
export function estimateDistanceM(rssi: number | undefined, txPower?: number): number | null {
  if (typeof rssi !== 'number' || rssi >= 0) return null;
  const p1m = typeof txPower === 'number' && txPower > -40 && txPower < 30 ? txPower - 41 : -59;
  const d = Math.pow(10, (p1m - rssi) / (10 * 2.2));
  return Math.max(0.1, Math.min(60, d));
}

export function formatDistance(d: number | null): string {
  if (d === null) return 'Distance unknown';
  if (d < 1) return 'Under 1 m';
  if (d < 10) return `About ${Math.round(d)} m`;
  return `About ${Math.round(d / 5) * 5} m`;
}
