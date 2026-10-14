import type { SecurityPolicy } from '../types';

const SECURITY_POLICY_KEY = 'blueguardian.security-policy.v1';

export function loadSecurityPolicy(defaults: SecurityPolicy): SecurityPolicy {
  try {
    const stored = globalThis.localStorage?.getItem(SECURITY_POLICY_KEY);
    if (!stored) return defaults;

    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return defaults;

    const policy = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof SecurityPolicy>) {
      const value = (parsed as Partial<SecurityPolicy>)[key];
      if (typeof value === 'boolean') policy[key] = value;
    }
    return policy;
  } catch {
    return defaults;
  }
}

export function saveSecurityPolicy(policy: SecurityPolicy): boolean {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(SECURITY_POLICY_KEY, JSON.stringify(policy));
    return true;
  } catch {
    return false;
  }
}