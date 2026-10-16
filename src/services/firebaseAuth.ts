/**
 * Firebase Authentication REST client for BlueGuardian.
 *
 * The Firebase web API key and project ID are client configuration, not secrets.
 * ID and refresh tokens are kept in JavaScript memory only; reload requires sign-in.
 */
const FIREBASE_API_KEY = 'AIzaSyD8D6PorYO8175H8kv6nvVl5hfBWvYeFiA';
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

function extractFirebaseErrorCode(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const normalized = message.trim().toUpperCase();

  // Google Identity Toolkit sometimes returns a human-readable detail instead
  // of a symbolic Firebase code (for example, "API key not valid...").
  if (/API KEY NOT VALID|INVALID API KEY|API_KEY_INVALID|INVALID_API_KEY/.test(normalized)) {
    return 'API_KEY_INVALID';
  }
  if (/API_KEY_HTTP_REFERRER_BLOCKED|HTTP.?REFERRER.{0,50}BLOCKED/.test(normalized)) {
    return 'API_KEY_HTTP_REFERRER_BLOCKED';
  }
  if (/API_KEY_SERVICE_BLOCKED|REQUESTS TO THIS API.{0,100}BLOCKED|API.{0,40}RESTRICTION.{0,40}BLOCKED/.test(normalized)) {
    return 'API_KEY_SERVICE_BLOCKED';
  }
  if (/CONFIGURATION_NOT_FOUND|CONFIGURATION NOT FOUND/.test(normalized)) {
    return 'CONFIGURATION_NOT_FOUND';
  }

  const knownCodes = [
    'INVALID_LOGIN_CREDENTIALS',
    'OPERATION_NOT_ALLOWED',
    'TOO_MANY_ATTEMPTS_TRY_LATER',
    'EMAIL_NOT_FOUND',
    'INVALID_PASSWORD',
    'EMAIL_EXISTS',
    'WEAK_PASSWORD',
    'INVALID_EMAIL',
    'USER_DISABLED',
    'QUOTA_EXCEEDED',
  ];
  return knownCodes.find(code =>
    new RegExp(`(^|[^A-Z0-9_])${code}([^A-Z0-9_]|$)`).test(normalized),
  );
}

function firebaseErrorMessage(message: string | undefined): string {
  const code = extractFirebaseErrorCode(message);
  let friendly: string;

  switch (code) {
    case 'EMAIL_EXISTS':
      friendly = 'An account already exists for this email. Sign in instead.';
      break;
    case 'OPERATION_NOT_ALLOWED':
      friendly = 'Email/password sign-in is disabled. Enable it in Firebase Console → Authentication → Sign-in method.';
      break;
    case 'INVALID_LOGIN_CREDENTIALS':
    case 'EMAIL_NOT_FOUND':
    case 'INVALID_PASSWORD':
      friendly = 'The email or password is incorrect. If you added this user in Firebase Console, use the exact password set there or request a password reset.';
      break;
    case 'WEAK_PASSWORD':
      friendly = 'Choose a password with at least 6 characters.';
      break;
    case 'INVALID_EMAIL':
      friendly = 'Enter a valid email address.';
      break;
    case 'TOO_MANY_ATTEMPTS_TRY_LATER':
      friendly = 'Firebase temporarily blocked sign-in attempts. Wait a little before trying again.';
      break;
    case 'API_KEY_INVALID':
    case 'INVALID_API_KEY':
      friendly = 'The Firebase web API key was rejected. Check that BlueGuardian uses the Web API key from project blueguardian-ai-auth.';
      break;
    case 'API_KEY_HTTP_REFERRER_BLOCKED':
      friendly = 'The Firebase API key has an HTTP-referrer restriction that blocks this app. Review the key restrictions in Google Cloud Console.';
      break;
    case 'API_KEY_SERVICE_BLOCKED':
      friendly = 'The Firebase API key is restricted from using Identity Toolkit or Secure Token. Review its API restrictions in Google Cloud Console.';
      break;
    case 'CONFIGURATION_NOT_FOUND':
      friendly = 'Firebase could not find a valid email/password authentication configuration for this project. Check the project ID and enabled provider.';
      break;
    case 'USER_DISABLED':
      friendly = 'This Firebase account is disabled.';
      break;
    case 'QUOTA_EXCEEDED':
      friendly = 'Firebase Authentication quota was exceeded. Check project quotas and try again later.';
      break;
    default:
      friendly = 'Firebase rejected the authentication request. Check the error code below and the Firebase project/API-key configuration.';
  }

  // Keep the server error category visible so a future failure is diagnosable
  // without exposing credentials, tokens, or the raw response payload.
  return code ? `${friendly} (Firebase code: ${code})` : `${friendly} (Firebase code unavailable)`;
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

/**
 * Ask Firebase to send its password-reset email. The UI does not reveal whether
 * an email is registered, avoiding unnecessary account-enumeration signals.
 */
export async function sendFirebasePasswordResetEmail(emailInput: string): Promise<string> {
  const email = emailInput.trim().toLowerCase();
  if (!email) throw new Error('Enter your email address first.');

  let response: Response;
  try {
    response = await fetch(`${IDENTITY_TOOLKIT_URL}/accounts:sendOobCode?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Cannot reach Firebase Authentication. Check the phone internet connection and Firebase API-key restrictions.');
  }

  const data = await readFirebaseResponse<{ email?: string }>(response);
  return data.email || email;
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
