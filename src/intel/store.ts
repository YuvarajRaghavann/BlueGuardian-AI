/** App-wide evidence engine, persisted on this phone. */
import { useEffect, useState } from 'react';
import { IntelEngine, type IntelSnapshot } from './engine';
import { compactSnapshot } from './persist';

const KEY = 'blueguardian.intel.v1';

function load(): IntelSnapshot | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as IntelSnapshot) : null;
  } catch {
    return null;
  }
}

function save(snapshot: IntelSnapshot): void {
  try {
    globalThis.localStorage?.setItem(KEY, compactSnapshot(snapshot));
  } catch {
    // quota: the engine keeps working in memory
  }
}

export const intel = new IntelEngine(load(), save);

/** Re-renders when the engine learns from a new scan. */
export function useIntel(): IntelEngine {
  const [, setVersion] = useState(0);
  useEffect(() => intel.subscribe(() => setVersion((v) => v + 1)), []);
  return intel;
}
