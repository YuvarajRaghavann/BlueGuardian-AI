/**
 * Firebase Authentication REST client for BlueGuardian.
 *
 * The Firebase web API key and project ID are client configuration, not secrets.
 * ID and refresh tokens are kept in JavaScript memory only; reload requires sign-in.
 */
const FIREBASE_API_KEY = 'AIzaSyD8D6PorYO8175H8kv6nvV1SfhFBWvYeFiA';
const FIREBASE_PROJECT_ID = 'blueguardian-ai-auth';
const IDENTITY_TOOLKIT_URL = 'https://identitytoolkit.googleapis.com/v1';
const SECURE_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';

export interface FirebaseClientSession {
  email: string;
  localId: string;
  idToken: string;
}

interface FirebaseIdentityResponse {
  email: string;
  localId: string;
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}

interface FirebaseRefreshResponse {
  id_token: string;
  refresh_token: string;
  expires_in: string;
  user_id: string;
  user_email?: string;
}

interface FirebaseErrorResponse {
  error?: {
    message?: string;
  };
}

interface InMemoryFirebaseSession extends FirebaseClientSession {
  refreshToken: string;
  expiresAt: number;
}

let activeSession: InMemoryFirebaseSession | null = null;

function firebaseErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'EMAIL_EXISTS':
      return 'An account already exists for this email. Sign in instead.';
    case 'OPERATION_NOT_ALLOWED':
      return 'Email/password sign-in is disabled. Enable it in Firebase Console → Authentication → Sign-in method.';
    case 'INVALID_LOGIN_CREDENTIALS':
    case 'EMAIL_NOT_FOUND':
    case 'INVALID_PASSWORD':
      return 'The email or password is incorrect.';
    case 'WEAK_PASSWORD':
      return 'Choose a password with at least 6 characters.';
    case 'INVALID_EMAIL':
      return 'Enter a valid email address.';
    case 'TOO_MANY_ATTEMPTS_TRY_LATER':
      return 'Firebase temporarily blocked sign-in attempts. Wait a little and try again.';
    case 'API_KEY_INVALID':
    case 'INVALID_API_KEY':
      return 'The Firebase web API key is invalid. Check the BlueGuardian Firebase web app configuration.';
    case 'USER_DISABLED':
      return 'This Firebase account is disabled.';
    default:
      return 'Firebase authentication failed. Check your sign-in method and try again.';
  }
}

async function readFirebaseResponse<T>(response: Response): Promise<T> {
  let data: T | FirebaseErrorResponse;
  try {
    data = await response.json() as T | FirebaseErrorResponse;
  } catch {
    throw new Error('Firebase returned an unreadable authentication response.');
  }

  if (!response.ok) {
    const errorBody = data as FirebaseErrorResponse;
    throw new Error(firebaseErrorMessage(errorBody.error?.message));
  }
  return data as T;
}

async function authenticateWithPassword(path: 'signUp' | 'signInWithPassword', emailInput: string, password: string): Promise<FirebaseClientSession> {
  const email = emailInput.trim().toLowerCase();
  if (!email) throw new Error('Enter your email address.');
  if (!password) throw new Error('Enter your password.');
  if (path === 'signUp' && password.length < 6) throw new Error('Choose a password with at least 6 characters.');

  const response = await fetch(`${IDENTITY_TOOLKIT_URL}/accounts:${path}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    cache: 'no-store',
  });
  const data = await readFirebaseResponse<FirebaseIdentityResponse>(response);

  if (!data.idToken || !data.refreshToken || !data.localId || !data.email) {
    throw new Error('Firebase authentication response was missing required session fields.');
  }

  activeSession = {
    email: data.email,
    localId: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Math.max(1, Number(data.expiresIn) || 3600) * 1000,
  };

  return {
    email: activeSession.email,
    localId: activeSession.localId,
    idToken: activeSession.idToken,
  };
}

export function signInWithEmailPassword(email: string, password: string): Promise<FirebaseClientSession> {
  return authenticateWithPassword('signInWithPassword', email, password);
}

export function createFirebaseAccount(email: string, password: string): Promise<FirebaseClientSession> {
  return authenticateWithPassword('signUp', email, password);
}

export function hasFirebaseSession(): boolean {
  return activeSession !== null;
}

/** Returns an ID token, refreshing it in memory when it is close to expiry. */
export async function getFreshFirebaseIdToken(): Promise<string | null> {
  if (!activeSession) return null;
  if (activeSession.expiresAt > Date.now() + 60_000) return activeSession.idToken;

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: activeSession.refreshToken,
  });
  let response: Response;
  try {
    response = await fetch(`${SECURE_TOKEN_URL}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Unable to refresh the Firebase session. Check your network and sign in again if needed.');
  }

  let data: FirebaseRefreshResponse;
  try {
    data = await readFirebaseResponse<FirebaseRefreshResponse>(response);
  } catch {
    activeSession = null;
    throw new Error('The Firebase session expired. Please sign in again.');
  }

  if (!data.id_token || !data.refresh_token || !data.expires_in || !data.user_id) {
    activeSession = null;
    throw new Error('Firebase could not refresh the session. Please sign in again.');
  }

  activeSession = {
    email: data.user_email || activeSession.email,
    localId: data.user_id,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Math.max(1, Number(data.expires_in) || 3600) * 1000,
  };
  return activeSession.idToken;
}

export function signOutFirebase(): void {
  activeSession = null;
}

/** Test utility; never exposes a live credential. */
export function resetFirebaseAuthForTests(): void {
  activeSession = null;
}
