import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireAuth } from './auth';
import {
  buildAuthorizedRecoveryRecord,
  normalizeRecoveryState,
  validateEncounterInput,
  validateRegistrationInput,
} from './services/recoveryService';

const originalEnv = { ...process.env };

describe('recovery auth and validation', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.BLUEGUARDIAN_AUTH_MODE = 'required';
    process.env.BLUEGUARDIAN_OWNER_TOKEN = 'blueguardian-owner-token';
    process.env.BLUEGUARDIAN_PARTICIPANT_TOKEN = 'blueguardian-participant-token';
    process.env.BLUEGUARDIAN_OWNER_ID = 'test-owner';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.BLUEGUARDIAN_AUTH_MODE = originalEnv.BLUEGUARDIAN_AUTH_MODE;
    process.env.BLUEGUARDIAN_OWNER_TOKEN = originalEnv.BLUEGUARDIAN_OWNER_TOKEN;
    process.env.BLUEGUARDIAN_PARTICIPANT_TOKEN = originalEnv.BLUEGUARDIAN_PARTICIPANT_TOKEN;
    process.env.BLUEGUARDIAN_OWNER_ID = originalEnv.BLUEGUARDIAN_OWNER_ID;
  });

  it('allows owner authentication when the bearer token matches the configured owner token', () => {
    const req = { headers: { authorization: 'Bearer blueguardian-owner-token' } } as any;
    const res: any = {
      status: (code: number) => ({ json: (payload: any) => ({ code, payload }) }),
    };
    let nextCalled = false;

    requireAuth('owner')(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.auth?.ownerId).toBe('test-owner');
    expect(req.auth?.role).toBe('owner');
  });

  it('rejects missing owner authorization headers', () => {
    const req = { headers: {} } as any;
    let statusCode = 0;
    let payload: any;
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (body: any) => {
            payload = body;
            return { code, payload };
          },
        };
      },
    };
    let nextCalled = false;

    requireAuth('owner')(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(401);
    expect(payload?.error).toContain('Authorization');
  });

  it('fails closed in production even when a static owner token is configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.BLUEGUARDIAN_AUTH_MODE = 'required';
    let statusCode = 0;
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return { json: () => undefined };
      },
    };
    let nextCalled = false;

    requireAuth('owner')({ headers: { authorization: 'Bearer blueguardian-owner-token' } } as any, res, () => { nextCalled = true; });

    expect(statusCode).toBe(503);
    expect(nextCalled).toBe(false);
  });

  it('reports missing server owner configuration instead of misclassifying it as bad client credentials', () => {
    process.env.NODE_ENV = 'development';
    process.env.BLUEGUARDIAN_AUTH_MODE = 'required';
    delete process.env.BLUEGUARDIAN_OWNER_TOKEN;
    let statusCode = 0;
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return { json: () => undefined };
      },
    };
    let nextCalled = false;

    requireAuth('owner')({ headers: { authorization: 'Bearer arbitrary-token' } } as any, res, () => { nextCalled = true; });

    expect(statusCode).toBe(503);
    expect(nextCalled).toBe(false);
  });

  it('validates registration input and preserves a lost-device state', () => {
    const payload = validateRegistrationInput({
      deviceName: 'My CMF Buds',
      deviceIdentifier: 'cmf-buds-01',
      status: 'lost',
    });

    expect(payload.deviceName).toBe('My CMF Buds');
    expect(payload.deviceIdentifier).toBe('cmf-buds-01');
    expect(normalizeRecoveryState(payload.recoveryState)).toBe('lost');
  });

  it('rejects invalid registration states instead of silently resetting them', () => {
    expect(() => validateRegistrationInput({
      deviceName: 'My earbuds',
      deviceIdentifier: 'browser-device',
      recoveryState: 'archived',
    })).toThrow('Recovery state must be lost, searching, found, or recovered.');
  });

  it('accepts browser observations without inventing location or confidence data', () => {
    expect(validateEncounterInput({
      deviceId: 'cmf-buds-01',
      source: 'REAL',
      simulated: false,
      isTestFixture: false,
    })).toMatchObject({
      deviceId: 'cmf-buds-01',
      source: 'REAL',
      confidence: undefined,
      location: undefined,
      simulated: false,
    });
  });

  it('rejects malformed coordinates instead of storing them', () => {
    expect(() => validateEncounterInput({
      deviceId: 'cmf-buds-01',
      source: 'REAL',
      location: { lat: 123, lng: 0 },
    })).toThrow('Encounter location must contain valid latitude and longitude coordinates.');
  });

  it('rejects source values outside the supported real and simulated modes', () => {
    expect(() => validateEncounterInput({
      deviceId: 'cmf-buds-01',
      source: 'UNKNOWN',
    })).toThrow('Encounter source must be REAL or SIMULATED.');
  });

  it('requires simulated records to be explicitly marked', () => {
    expect(() => validateEncounterInput({
      deviceId: 'cmf-buds-01',
      source: 'SIMULATED',
      simulated: false,
    })).toThrow('Simulated encounters must be explicitly marked as simulated.');
  });

  it('builds an owner-safe summary even when encounters are empty', () => {
    const record = buildAuthorizedRecoveryRecord({
      deviceId: 'cmf-buds-01',
      deviceIdentifier: 'cmf-buds-01',
      ownerId: 'test-owner',
      name: 'My CMF Buds',
      recoveryState: 'searching',
      lastSeen: new Date('2026-01-01T00:00:00Z'),
      registeredAt: new Date('2025-12-31T00:00:00Z'),
    }, []);

    expect(record.deviceId).toBe('cmf-buds-01');
    expect(record.encounterCount).toBe(0);
    expect(record.recoveryState).toBe('searching');
    expect(record.lastKnownLocation).toBeNull();
  });
});
