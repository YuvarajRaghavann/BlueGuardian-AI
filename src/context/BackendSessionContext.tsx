import React, { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { setOwnerSessionToken } from '../services/api';

interface BackendSessionValue {
  /** Owner token exists only in React/module memory. It is never persisted by this context. */
  ownerToken: string;
  setOwnerToken: (token: string) => void;
  signOutOwner: () => void;
}

const BackendSessionContext = createContext<BackendSessionValue | null>(null);

export function BackendSessionProvider({ children }: { children: ReactNode }) {
  const [ownerToken, setOwnerTokenState] = useState('');

  const setOwnerToken = useCallback((token: string) => {
    setOwnerTokenState(token);
    setOwnerSessionToken(token);
  }, []);

  const signOutOwner = useCallback(() => {
    setOwnerTokenState('');
    setOwnerSessionToken('');
  }, []);

  return (
    <BackendSessionContext.Provider value={{ ownerToken, setOwnerToken, signOutOwner }}>
      {children}
    </BackendSessionContext.Provider>
  );
}

export function useBackendSession(): BackendSessionValue {
  const context = useContext(BackendSessionContext);
  if (!context) throw new Error('useBackendSession must be used within BackendSessionProvider');
  return context;
}
