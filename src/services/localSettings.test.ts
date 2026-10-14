import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SecurityPolicy } from '../types';
import { loadSecurityPolicy, saveSecurityPolicy } from './localSettings';

const defaults: SecurityPolicy = {
  confirmBlock: true,
  confirmTrust: true,
  showLowConfidenceWarnings: true,
  showSimulatedEvents: true,
  requireConnectionApproval: true,
  blockUnknownFileTransfers: true,
  enforceFastPairApproval: true,
  enableRssiGuard: true,
  restrictWearablesToAudio: true,
};

class TestStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('local security policy settings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('persists and restores the small policy object', () => {
    vi.stubGlobal('localStorage', new TestStorage());
    const updated = { ...defaults, confirmBlock: false, showSimulatedEvents: false };

    expect(saveSecurityPolicy(updated)).toBe(true);
    expect(loadSecurityPolicy(defaults)).toEqual(updated);
  });

  it('falls back safely when localStorage is unavailable or invalid', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{invalid json',
      setItem: () => { throw new Error('storage disabled'); },
    });

    expect(loadSecurityPolicy(defaults)).toEqual(defaults);
    expect(saveSecurityPolicy(defaults)).toBe(false);

    vi.stubGlobal('localStorage', undefined);
    expect(loadSecurityPolicy(defaults)).toEqual(defaults);
    expect(saveSecurityPolicy(defaults)).toBe(false);
  });
});