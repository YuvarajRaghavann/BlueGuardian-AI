import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFirebaseAccount,
  getFreshFirebaseIdToken,
  hasFirebaseSession,
  sendFirebasePasswordResetEmail,
  signInWithEmailPassword,
  signOutFirebase,
} from './firebaseAuth';

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => data,
  } as Response;
}

describe('Firebase Auth REST client', () => {
  afterEach(() => {
    signOutFirebase();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('signs in with email/password and keeps tokens only in memory', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      email: 'owner@example.com',
      localId: 'firebase-uid-1',
      idToken: 'signed-id-token',
      refreshToken: 'refresh-token',
      expiresIn: '3600',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const session = await signInWithEmailPassword(' Owner@Example.com ', 'correct-password');

    expect(session).toEqual({
      email: 'owner@example.com',
      localId: 'firebase-uid-1',
      idToken: 'signed-id-token',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/accounts:signInWithPassword?key=');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      email: 'owner@example.com',
      password: 'correct-password',
      returnSecureToken: true,
    });
    expect(hasFirebaseSession()).toBe(true);
    expect(await getFreshFirebaseIdToken()).toBe('signed-id-token');
  });

  it('creates an account through Firebase sign-up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      email: 'new@example.com',
      localId: 'firebase-uid-2',
      idToken: 'new-id-token',
      refreshToken: 'new-refresh-token',
      expiresIn: '3600',
    })));

    const session = await createFirebaseAccount('new@example.com', 'long-enough-password');
    expect(session.localId).toBe('firebase-uid-2');
    expect(session.idToken).toBe('new-id-token');
  });

  it('refreshes an expiring ID token without persistent storage', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        email: 'owner@example.com',
        localId: 'firebase-uid-1',
        idToken: 'short-lived-token',
        refreshToken: 'refresh-token',
        expiresIn: '1',
      }))
      .mockResolvedValueOnce(jsonResponse({
        id_token: 'refreshed-id-token',
        refresh_token: 'refreshed-refresh-token',
        expires_in: '3600',
        user_id: 'firebase-uid-1',
      }));
    vi.stubGlobal('fetch', fetchMock);

    await signInWithEmailPassword('owner@example.com', 'correct-password');
    expect(await getFreshFirebaseIdToken()).toBe('refreshed-id-token');
    expect(String(fetchMock.mock.calls[1][0])).toContain('securetoken.googleapis.com');
    expect(String(fetchMock.mock.calls[1][1].body)).toContain('grant_type=refresh_token');
  });

  it('maps a disabled provider to an actionable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { message: 'OPERATION_NOT_ALLOWED' },
    }, false)));

    await expect(signInWithEmailPassword('owner@example.com', 'correct-password'))
      .rejects.toThrow(/Enable it in Firebase Console/);
  });

  it('requests a Firebase password reset without storing credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ email: 'owner@example.com' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendFirebasePasswordResetEmail(' Owner@Example.com ')).resolves.toBe('owner@example.com');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/accounts:sendOobCode?key=');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      requestType: 'PASSWORD_RESET',
      email: 'owner@example.com',
    });
  });

  it('exposes safe Firebase error codes for API-key diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { message: 'API_KEY_SERVICE_BLOCKED : Requests to this API are blocked.' },
    }, false)));

    await expect(signInWithEmailPassword('owner@example.com', 'correct-password'))
      .rejects.toThrow(/Identity Toolkit or Secure Token.*Firebase code: API_KEY_SERVICE_BLOCKED/);
  });

  it('clears the in-memory session on sign out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      email: 'owner@example.com',
      localId: 'firebase-uid-1',
      idToken: 'signed-id-token',
      refreshToken: 'refresh-token',
      expiresIn: '3600',
    })));
    await signInWithEmailPassword('owner@example.com', 'correct-password');
    signOutFirebase();
    expect(hasFirebaseSession()).toBe(false);
    expect(await getFreshFirebaseIdToken()).toBeNull();
  });
});
