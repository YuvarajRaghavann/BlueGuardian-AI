/**
 * BlueGuardian account (optional). Signing in enables community recovery and
 * cloud backup; everything else works without an account.
 *
 * "Stay signed in": the Firebase refresh credential is encrypted with an
 * AES-256-GCM key held in the Android Keystore (StrongBox when available)
 * before it is stored. Nothing readable is written to disk, and in a desktop
 * browser the session stays in memory only.
 */
import { useEffect, useState } from 'react';
import {
  createFirebaseAccount, currentFirebaseEmail, exportRefreshCredential, onFirebaseSessionChange,
  restoreFirebaseSession, signInWithEmailPassword, signOutFirebase,
} from './firebaseAuth';
import { setOwnerToken } from './ownerSession';
import { isNativeAndroidApp } from './nativeBluetoothService';
import { secureLinkPlugin } from './secureLinkNative';
import { fromBase64, toBase64, utf8, fromUtf8 } from '../secure/crypto/bytes';

const STORE_KEY = 'blueguardian.account.v1';
const ONBOARDED_KEY = 'blueguardian.onboarded.v1';

export type AccountStatus = 'restoring' | 'signed-in' | 'offline' | 'guest';

let status: AccountStatus = 'guest';
let email: string | null = null;
const listeners = new Set<() => void>();

function set(next: AccountStatus, nextEmail: string | null) {
  status = next;
  email = nextEmail;
  for (const l of listeners) l();
}

function read(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch { /* storage unavailable */ }
}

export function isOnboarded(): boolean {
  return read(ONBOARDED_KEY) === '1';
}
export function markOnboarded(): void {
  write(ONBOARDED_KEY, '1');
}

async function persist(): Promise<void> {
  const cred = exportRefreshCredential();
  if (!cred || !isNativeAndroidApp()) return;
  try {
    const { blob } = await secureLinkPlugin.wrapSecret({ data: toBase64(utf8(cred.refreshToken)) });
    write(STORE_KEY, JSON.stringify({ email: cred.email, blob }));
  } catch {
    // Keystore unavailable: stay signed in for this run only.
  }
}

let persisting = false;
onFirebaseSessionChange(() => {
  const current = currentFirebaseEmail();
  if (current) {
    if (!persisting) {
      persisting = true;
      void persist().finally(() => { persisting = false; });
    }
  } else if (status === 'signed-in') {
    write(STORE_KEY, null);
    setOwnerToken(null);
    set('guest', null);
  }
});

/** Called once at startup. */
export async function restoreAccount(): Promise<void> {
  const raw = read(STORE_KEY);
  if (!raw || !isNativeAndroidApp()) return;
  let saved: { email: string; blob: string };
  try { saved = JSON.parse(raw) as { email: string; blob: string }; } catch { write(STORE_KEY, null); return; }
  set('restoring', saved.email);
  try {
    const { data } = await secureLinkPlugin.unwrapSecret({ blob: saved.blob });
    const session = await restoreFirebaseSession(saved.email, fromUtf8(fromBase64(data)));
    setOwnerToken(session.idToken);
    set('signed-in', session.email);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/expired|sign in again|Keystore|unlock/i.test(message)) {
      write(STORE_KEY, null);
      set('guest', null);
    } else {
      // Probably offline: keep the saved credential and retry when the network returns.
      set('offline', saved.email);
      const retry = () => { window.removeEventListener('online', retry); void restoreAccount(); };
      window.addEventListener('online', retry);
    }
  }
}

export async function signIn(mode: 'sign-in' | 'sign-up', emailInput: string, password: string): Promise<string> {
  const session = mode === 'sign-in'
    ? await signInWithEmailPassword(emailInput, password)
    : await createFirebaseAccount(emailInput, password);
  setOwnerToken(session.idToken);
  set('signed-in', session.email);
  await persist();
  return session.email;
}

export function signOut(): void {
  write(STORE_KEY, null);
  signOutFirebase();
  setOwnerToken(null);
  set('guest', null);
}

export function useAccount(): { status: AccountStatus; email: string | null } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((v) => v + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return { status, email };
}
