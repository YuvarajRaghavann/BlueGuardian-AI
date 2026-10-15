import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import app from './app';

const disabledLegacyPaths = [
  '/api/devices',
  '/api/threats',
  '/api/actions',
  '/api/events',
];

const protectedPaths = ['/api/recovery/devices'];

const authEnvironmentKeys = [
  'NODE_ENV',
  'BLUEGUARDIAN_AUTH_MODE',
  'BLUEGUARDIAN_OWNER_TOKEN',
  'BLUEGUARDIAN_OWNER_ID',
] as const;

const originalAuthEnvironment = Object.fromEntries(
  authEnvironmentKeys.map(key => [key, process.env[key]]),
) as Record<typeof authEnvironmentKeys[number], string | undefined>;

function restoreAuthEnvironment() {
  for (const key of authEnvironmentKeys) {
    const value = originalAuthEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('protected API routes', () => {
  let origin: string;
  let server: ReturnType<typeof app.listen>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.BLUEGUARDIAN_AUTH_MODE = 'required';
    process.env.BLUEGUARDIAN_OWNER_TOKEN = 'blueguardian-owner-token';
    process.env.BLUEGUARDIAN_OWNER_ID = 'test-owner';

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    restoreAuthEnvironment();
  });

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.BLUEGUARDIAN_AUTH_MODE = 'required';
    process.env.BLUEGUARDIAN_OWNER_TOKEN = 'blueguardian-owner-token';
    process.env.BLUEGUARDIAN_OWNER_ID = 'test-owner';
  });

  it('keeps legacy unscoped APIs unmounted and protects recovery APIs', async () => {
    const legacyResponses = await Promise.all(
      disabledLegacyPaths.map(path => fetch(`${origin}${path}`)),
    );
    const recovery = await fetch(`${origin}/api/recovery/devices`);

    expect(legacyResponses.map(response => response.status)).toEqual(
      disabledLegacyPaths.map(() => 404),
    );
    expect(recovery.status).toBe(401);
  });

  it('keeps legacy routes unavailable and fails closed on production recovery APIs', async () => {
    process.env.NODE_ENV = 'production';
    const legacyResponses = await Promise.all(
      disabledLegacyPaths.map(path => fetch(`${origin}${path}`, {
        headers: { Authorization: 'Bearer blueguardian-owner-token' },
      })),
    );
    const recovery = await fetch(`${origin}/api/recovery/devices`, {
      headers: { Authorization: 'Bearer blueguardian-owner-token' },
    });
    const health = await fetch(`${origin}/api/health`);

    expect(legacyResponses.map(response => response.status)).toEqual(
      disabledLegacyPaths.map(() => 404),
    );
    expect(recovery.status).toBe(503);
    expect(health.status).toBe(200);
  });

  it('fails closed when recovery authentication is disabled or missing in development', async () => {
    process.env.NODE_ENV = 'development';
    process.env.BLUEGUARDIAN_AUTH_MODE = 'disabled';
    const disabled = await fetch(`${origin}/api/recovery/devices`);

    process.env.BLUEGUARDIAN_AUTH_MODE = 'required';
    delete process.env.BLUEGUARDIAN_OWNER_TOKEN;
    const missingConfig = await fetch(`${origin}/api/recovery/devices`, {
      headers: { Authorization: 'Bearer supplied-token' },
    });

    expect(disabled.status).toBe(503);
    expect(missingConfig.status).toBe(503);
  });
});