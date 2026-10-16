import { useEffect, useState } from 'react';

const OWNER_TOKEN_EVENT = 'blueguardian:owner-token-changed';

// Owner credentials intentionally live only in JavaScript memory. The app does
// not persist bearer tokens in localStorage or sessionStorage.
let currentOwnerToken: string | null = null;

export function setOwnerToken(token: string | null): void {
  currentOwnerToken = token?.trim() || null;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OWNER_TOKEN_EVENT));
  }
}

export function useOwnerToken(): string | null {
  const [token, setToken] = useState<string | null>(() => currentOwnerToken);

  useEffect(() => {
    const refresh = () => setToken(currentOwnerToken);
    window.addEventListener(OWNER_TOKEN_EVENT, refresh);
    return () => window.removeEventListener(OWNER_TOKEN_EVENT, refresh);
  }, []);

  return token;
}
