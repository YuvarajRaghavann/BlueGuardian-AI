import { useEffect, useState } from 'react';

/**
 * Reads the optional owner token used by the authenticated device registry.
 * The Bluetooth-only UI remains usable when no owner token has been configured.
 */
const OWNER_TOKEN_KEY = 'blueguardian.ownerToken';
const OWNER_TOKEN_EVENT = 'blueguardian:owner-token-changed';

function readOwnerToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(OWNER_TOKEN_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function setOwnerToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token?.trim()) window.sessionStorage.setItem(OWNER_TOKEN_KEY, token.trim());
    else window.sessionStorage.removeItem(OWNER_TOKEN_KEY);
    window.dispatchEvent(new Event(OWNER_TOKEN_EVENT));
  } catch (error) {
    console.warn('Owner token could not be saved to this browser session.', error);
  }
}

export function useOwnerToken(): string | null {
  const [token, setToken] = useState<string | null>(() => readOwnerToken());

  useEffect(() => {
    const refresh = () => setToken(readOwnerToken());
    window.addEventListener(OWNER_TOKEN_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(OWNER_TOKEN_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return token;
}
