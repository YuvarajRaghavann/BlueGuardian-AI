import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';

const store = vi.hoisted(() => ({
  devices: [] as Array<Record<string, any>>,
  encounters: [] as Array<Record<string, any>>,
  deviceFindError: undefined as unknown,
  deviceFindOneFilters: [] as Array<Record<string, any>>,
}));

function matchesFilter(record: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return Array.isArray(expected) && expected.some((part) => matchesFilter(record, part));
    }
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$exists' in expected) return Boolean(expected.$exists) === (record[key] !== undefined);
      if ('$in' in expected) return Array.isArray(expected.$in) && expected.$in.includes(record[key]);
      if ('$ne' in expected) return record[key] !== expected.$ne;
    }
    return record[key] === expected;
  });
}

vi.mock('./models/Device', () => {
  class FakeDevice {
    [key: string]: any;

    constructor(values: Record<string, any>) {
      Object.assign(this, values);
    }

    async save() {
      const index = store.devices.findIndex(device => device.deviceId === this.deviceId);
      if (index < 0) store.devices.push(this);
      else store.devices[index] = this;
      return this;
    }

    toObject() {
      return { ...this };
    }

    static find(filter: Record<string, any>) {
      const rows = store.devices.filter(device => matchesFilter(device, filter));
      const query = {
        sort: () => query,
        limit: async (count: number) => {
          if (store.deviceFindError) throw store.deviceFindError;
          return rows.slice(0, count);
        },
      };
      return query;
    }

    static async findOne(filter: Record<string, any>) {
      store.deviceFindOneFilters.push({ ...filter });
      const found = store.devices.find(device => matchesFilter(device, filter));
      return found ? Object.assign(Object.create(FakeDevice.prototype), found) : null;
    }
  }

  return { default: FakeDevice };
});

vi.mock('./models/RecoveryEncounter', () => {
  class FakeEncounter {
    [key: string]: any;

    constructor(values: Record<string, any>) {
      Object.assign(this, values);
    }

    async save() {
      if (this.deduplicationKey && store.encounters.some(encounter =>
        encounter.ownerId === this.ownerId &&
        encounter.deviceId === this.deviceId &&
        encounter.deduplicationKey === this.deduplicationKey
      )) {
        throw Object.assign(new Error('Duplicate encounter key.'), { code: 11000 });
      }
      this.createdAt = new Date();
      store.encounters.push(this);
      return this;
    }

    toObject() {
      return { ...this };
    }

    static find(filter: Record<string, any>) {
      const rows = store.encounters.filter(encounter => matchesFilter(encounter, filter));
      const query = {
        sort: () => query,
        limit: async (count: number) => rows.slice(0, count),
      };
      return query;
    }

    static async findOne(filter: Record<string, any>) {
      const found = store.encounters.find(encounter => matchesFilter(encounter, filter));
      return found ? Object.assign(Object.create(FakeEncounter.prototype), found) : null;
    }
  }

  return { default: FakeEncounter };
});

import app from './app';

describe('recovery API integration', () => {
  let origin: string;
  let server: ReturnType<typeof app.listen>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.FIREBASE_PROJECT_ID; // These integration tests intentionally exercise the local development-token path.
    process.env.BLUEGUARDIAN_AUTH_MODE = 'required';
    process.env.BLUEGUARDIAN_OWNER_TOKEN = 'blueguardian-owner-token';
    process.env.BLUEGUARDIAN_PARTICIPANT_TOKEN = 'blueguardian-participant-token';
    process.env.BLUEGUARDIAN_OWNER_ID = 'test-owner';
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    store.devices.length = 0;
    store.encounters.length = 0;
    store.deviceFindError = undefined;
    store.deviceFindOneFilters.length = 0;
  });

  const ownerHeaders = { Authorization: 'Bearer blueguardian-owner-token' };

  it('accepts a community BLE candidate without exposing matching owner or device identity', async () => {
    const { createHash } = await import('node:crypto');
    const fingerprintHash = createHash('sha256')
      .update(JSON.stringify({ name: 'owner earbuds', serviceUuids: ['0000feed-0000-1000-8000-00805f9b34fb'] }))
      .digest('hex');
    store.devices.push({
      deviceId: 'owner-lost-device',
      deviceIdentifier: 'private-address',
      ownerId: 'test-owner',
      name: 'Owner earbuds',
      discoverySource: 'REAL',
      recoveryEnabled: true,
      recoveryState: 'lost',
      recoveryFingerprintHash: fingerprintHash,
    });
    const response = await fetch(`${origin}/api/recovery/community/sightings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer blueguardian-participant-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ observations: [{ name: 'Owner earbuds', serviceUuids: ['0000feed-0000-1000-8000-00805f9b34fb'] }], shareLocation: false }),
    });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ accepted: true, observationsReceived: 1 });
    expect(JSON.stringify(body)).not.toContain('owner-lost-device');
    expect(body).not.toHaveProperty('reportsRecorded');
    expect(store.encounters[0]).toMatchObject({
      deviceId: 'owner-lost-device',
      ownerId: 'test-owner',
      source: 'REAL',
      simulated: false,
      confidence: 0.45,
    });
    expect(store.encounters[0].location).toBeUndefined();
    expect(store.devices[0].recoveryState).toBe('lost');
  });


  it('matches a community sighting by advertised name when its service UUIDs differ from the registration', async () => {
    const registered = await fetch(`${origin}/api/recovery/devices`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'AA:BB:CC:DD:EE:01',
        deviceIdentifier: 'AA:BB:CC:DD:EE:01',
        deviceName: 'My buds',
        recoveryState: 'lost',
        recoveryFingerprint: { name: 'Nord Buds 2', serviceUuids: ['0000fe2c-0000-1000-8000-00805f9b34fb'] },
      }),
    });
    expect(registered.status).toBe(201);
    // A helper's classic-discovery sighting carries the name but no service UUIDs.
    const response = await fetch(`${origin}/api/recovery/community/sightings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer blueguardian-participant-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ observations: [{ name: '  nord   BUDS 2 ', serviceUuids: [] }], shareLocation: false }),
    });
    expect(response.status).toBe(202);
    expect(store.encounters).toHaveLength(1);
    expect(store.encounters[0]).toMatchObject({ deviceId: 'AA:BB:CC:DD:EE:01', confidence: 0.2 });
  });

  it('stores coordinates only when a community participant explicitly opts in', async () => {
    const { createHash } = await import('node:crypto');
    const fingerprintHash = createHash('sha256')
      .update(JSON.stringify({ name: 'owner earbuds', serviceUuids: ['0000feed-0000-1000-8000-00805f9b34fb'] }))
      .digest('hex');
    store.devices.push({
      deviceId: 'owner-location-test',
      deviceIdentifier: 'private-address',
      ownerId: 'test-owner',
      name: 'Owner earbuds',
      discoverySource: 'REAL',
      recoveryEnabled: true,
      recoveryState: 'searching',
      recoveryFingerprintHash: fingerprintHash,
    });
    const response = await fetch(`${origin}/api/recovery/community/sightings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer blueguardian-participant-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observations: [{ name: 'Owner earbuds', serviceUuids: ['0000feed-0000-1000-8000-00805f9b34fb'] }],
        shareLocation: true,
        location: { lat: 12.9716, lng: 77.5946 },
      }),
    });
    expect(response.status).toBe(202);
    expect(store.encounters[0].location).toEqual({ lat: 12.9716, lng: 77.5946 });
  });

  it('rejects community reports that try to attach a location without opt-in', async () => {
    const response = await fetch(`${origin}/api/recovery/community/sightings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer blueguardian-participant-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observations: [{ name: 'Owner earbuds', serviceUuids: ['0000feed-0000-1000-8000-00805f9b34fb'] }],
        shareLocation: false,
        location: { lat: 12.9, lng: 80.2 },
      }),
    });
    expect(response.status).toBe(400);
  });

  it('persists registrations, ignores client owner IDs, and returns owner-authorized records', async () => {
    const registration = await fetch(`${origin}/api/recovery/devices`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'browser-device-1',
        deviceIdentifier: 'browser-device-1',
        deviceName: 'Owner earbuds',
        ownerId: 'untrusted-client-owner',
        discoverySource: 'REAL',
        recoveryState: 'lost',
      }),
    });

    expect(registration.status).toBe(201);
    expect(store.devices[0].ownerId).toBe('test-owner');
    expect(store.devices[0].ownerId).not.toBe('untrusted-client-owner');

    const list = await fetch(`${origin}/api/recovery/devices`, { headers: ownerHeaders });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject([{ deviceId: 'browser-device-1', recoveryState: 'lost' }]);

    store.devices.push({ ...store.devices[0], deviceId: 'another-owner-device', ownerId: 'different-owner' });
    const unauthorizedRead = await fetch(`${origin}/api/recovery/devices/another-owner-device`, { headers: ownerHeaders });
    expect(unauthorizedRead.status).toBe(404);
    const unauthorizedEncounter = await fetch(`${origin}/api/recovery/devices/another-owner-device/encounters`, { headers: ownerHeaders });
    expect(unauthorizedEncounter.status).toBe(404);
  });

  it('queries by owner and device together when submitting an observation', async () => {
    store.devices.push({
      deviceId: 'another-owner-device',
      deviceIdentifier: 'another-owner-device',
      ownerId: 'different-owner',
      name: 'Private device',
      discoverySource: 'REAL',
      recoveryState: 'lost',
    });

    const response = await fetch(`${origin}/api/recovery/devices/another-owner-device/encounters`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'REAL', simulated: false, isTestFixture: false }),
    });

    expect(response.status).toBe(404);
    expect(store.deviceFindOneFilters).toContainEqual({
      ownerId: 'test-owner',
      deviceId: 'another-owner-device',
      $or: [{ recoveryEnabled: true }, { recoveryEnabled: { $exists: false } }],
    });
    expect(store.encounters).toHaveLength(0);
  });

  it('rejects unauthenticated registration and invalid encounter payloads', async () => {
    const denied = await fetch(`${origin}/api/recovery/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName: 'Not authorized', deviceIdentifier: 'device-x' }),
    });
    expect(denied.status).toBe(401);

    store.devices.push({
      deviceId: 'device-x',
      deviceIdentifier: 'device-x',
      ownerId: 'test-owner',
      name: 'Test device',
      discoverySource: 'REAL',
      recoveryState: 'lost',
    });
    const participantDenied = await fetch(`${origin}/api/recovery/devices/device-x/encounters`, {
      method: 'POST',
      headers: { Authorization: 'Bearer blueguardian-participant-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'REAL' }),
    });
    expect(participantDenied.status).toBe(401);

    const invalid = await fetch(`${origin}/api/recovery/devices/device-x/encounters`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'UNKNOWN' }),
    });
    expect(invalid.status).toBe(400);
  });

  it('rejects missing and invalid owner bearer tokens without logging token values', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const missing = await fetch(`${origin}/api/recovery/devices`);
      const invalid = await fetch(`${origin}/api/recovery/devices`, {
        headers: { Authorization: 'Bearer invalid-owner-token' },
      });

      expect(missing.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(missing.headers.get('cache-control')).toContain('no-store');
      expect(invalid.headers.get('cache-control')).toContain('no-store');
      expect(warn).toHaveBeenCalledWith('[auth] rejected protected request category=missing_bearer_token role=owner');
      expect(warn).toHaveBeenCalledWith('[auth] rejected protected request category=invalid_owner_token role=owner');
      expect(warn.mock.calls.flat().join(' ')).not.toContain('invalid-owner-token');
    } finally {
      warn.mockRestore();
    }
  });

  it('returns an uncached response body for conditional authenticated device-list requests', async () => {
    const first = await fetch(`${origin}/api/recovery/devices`, { headers: ownerHeaders });
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toContain('no-store');
    expect(await first.json()).toEqual([]);

    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const conditional = await fetch(`${origin}/api/recovery/devices`, {
      headers: { ...ownerHeaders, 'If-None-Match': etag! },
    });

    expect(conditional.status).toBe(200);
    expect(conditional.headers.get('cache-control')).toContain('no-store');
    expect(await conditional.json()).toEqual([]);
  });

  it('returns a safe service-unavailable response and logs recovery storage failure category', async () => {
    store.deviceFindError = Object.assign(new Error('server selection timed out'), {
      name: 'MongoServerSelectionError',
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await fetch(`${origin}/api/recovery/devices`, { headers: ownerHeaders });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'Database storage is unavailable. Retry after the connection is restored.',
      });
      expect(error).toHaveBeenCalledWith(expect.stringMatching(
        /^\[api\] request failed category=database_unavailable method=GET route=\/devices dbState=\d errorName=MongoServerSelectionError$/,
      ));
      expect(error.mock.calls.flat().join(' ')).not.toContain('server selection timed out');
    } finally {
      error.mockRestore();
    }
  });

  it('stores an actual owner browser observation, returns sightings, and persists recovered state', async () => {
    store.devices.push({
      deviceId: 'device-y',
      deviceIdentifier: 'device-y',
      ownerId: 'test-owner',
      name: 'Test device',
      discoverySource: 'REAL',
      recoveryState: 'lost',
    });

    const submitted = await fetch(`${origin}/api/recovery/devices/device-y/encounters`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'REAL',
        simulated: false,
        isTestFixture: false,
        description: 'Selected in the Web Bluetooth device picker.',
      }),
    });
    expect(submitted.status).toBe(201);
    expect(await submitted.json()).not.toHaveProperty('ownerId');
    expect(store.encounters).toHaveLength(1);
    expect(store.encounters[0].location).toBeUndefined();
    expect(store.encounters[0].confidence).toBeUndefined();

    const duplicate = await fetch(`${origin}/api/recovery/devices/device-y/encounters`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'REAL',
        simulated: false,
        isTestFixture: false,
        description: 'Selected in the Web Bluetooth device picker.',
      }),
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ duplicate: true });
    expect(store.encounters).toHaveLength(1);

    const sightings = await fetch(`${origin}/api/recovery/devices/device-y/encounters`, { headers: ownerHeaders });
    expect(sightings.status).toBe(200);
    expect(await sightings.json()).toMatchObject([{ source: 'REAL', simulated: false }]);

    const stateUpdate = await fetch(`${origin}/api/recovery/devices/device-y`, {
      method: 'PATCH',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'recovered' }),
    });
    expect(stateUpdate.status).toBe(200);

    const invalidState = await fetch(`${origin}/api/recovery/devices/device-y`, {
      method: 'PATCH',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(invalidState.status).toBe(400);

    const summary = await fetch(`${origin}/api/recovery/devices/device-y`, { headers: ownerHeaders });
    expect(await summary.json()).toMatchObject({
      recoveryState: 'recovered',
      encounterCount: 1,
      lastKnownLocation: null,
    });
  });
});
