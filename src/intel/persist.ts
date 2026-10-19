/** Keeps the stored intel snapshot within the WebView storage quota. */
import type { IntelSnapshot } from './engine';

export const BUDGET = 2_500_000; // characters; stays well under the WebView's ~5 MB localStorage quota

/**
 * Shrink a snapshot that is too large to store: drop sighting detail and history
 * first from devices that are not yours, then the oldest such devices entirely.
 * Paired devices and devices with alerts are always kept.
 */
export function compactSnapshot(snapshot: IntelSnapshot, budget = BUDGET): string {
  let json = JSON.stringify(snapshot);
  if (json.length <= budget) return json;
  const copy: IntelSnapshot = JSON.parse(json) as IntelSnapshot;
  const flagged = new Set(copy.findings.map((f) => f.deviceAddress).filter(Boolean));
  const others = Object.values(copy.profiles)
    .filter((p) => !p.paired && !flagged.has(p.address))
    .sort((a, b) => a.lastSeen - b.lastSeen);
  for (const p of others) {
    p.sightings = p.sightings.slice(-5);
    if (p.trust) { p.trust.history = p.trust.history.slice(-10); p.trust.ledger = p.trust.ledger.slice(-8); }
  }
  json = JSON.stringify(copy);
  for (let i = 0; json.length > budget && i < others.length; i += 25) {
    for (const p of others.slice(i, i + 25)) delete copy.profiles[p.address];
    json = JSON.stringify(copy);
  }
  return json;
}

