import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';

const captured = vi.hoisted(() => ({
  deviceFind: [] as Array<Record<string, unknown>>,
  deviceFindOne: [] as Array<Record<string, unknown>>,
  threatFind: [] as Array<Record<string, unknown>>,
  actionFind: [] as Array<Record<string, unknown>>,
  eventFind: [] as Array<Record<string, unknown>>,
  createdDevices: [] as Array<Record<string, unknown>>,
}));

type FakeQuery = { sort: (_sort?: unknown) => FakeQuery; limit: (count: number) => Promise<unknown[]> };
function queryWithRows(rows: unknown[] = []): FakeQuery {
  const query: FakeQuery = {
    sort: (_sort?: unknown) => query,
    limit: async (count: number) => rows.slice(0, count),
  };
  return query;
}

vi.mock('./models/Device', () => {
  class FakeDevice {
    [key: string]: any;
    constructor(values: Record<string, unknown>) { Object.assign(this, values); }
    async save() { captured.createdDevices.push({ ...this }); return this; }
    toObject() { return { ...this }; }
    async deleteOne() { return this; }
    static find(filter: Record<string, unknown>) {
      captured.deviceFind.push(filter);
      return queryWithRows([]);
    }
    static async findOne(filter: Record<string, unknown>) {
      captured.deviceFindOne.push(filter);
      return null;
    }
    static async findOneAndUpdate(filter: Record<string, unknown>) {
      captured.deviceFindOne.push(filter);
      return null;
    }
  }
  return { default: FakeDevice };
});

vi.mock('./models/ThreatAssessment', () => {
  class FakeThreatAssessment {
    [key: string]: any;
    constructor(values: Record<string, unknown>) { Object.assign(this, values); }
    async save() { return this; }
    static find(filter: Record<string, unknown>) { captured.threatFind.push(filter); return queryWithRows([]); }
    static findOne() { return { sort: async () => null }; }
  }
  return { default: FakeThreatAssessment };
});

vi.mock('./models/SecurityAction', () => {
  class FakeSecurityAction {
    [key: string]: any;
    constructor(values: Record<string, unknown>) { Object.assign(this, values); }
    async save() { return this; }
    static find(filter: Record<string, unknown>) { captured.actionFind.push(filter); return queryWithRows([]); }
  }
  return { default: FakeSecurityAction };
});

vi.mock('./models/AuditEvent', () => {
  class FakeAuditEvent {
    [key: string]: any;
    constructor(values: Record<string, unknown>) { Object.assign(this, values); }
    async save() { return this; }
    static find(filter: Record<string, unknown>) { captured.eventFind.push(filter); return queryWithRows([]); }
  }
  return { default: FakeAuditEvent };
});

vi.mock('./models/RecoveryEncounter', () => {
  class FakeRecoveryEncounter {
    [key: string]: any;
    constructor(values: Record<string, unknown>) { Object.assign(this, values); }
    async save() { return this; }
    static find() { return queryWithRows([]); }
    static async findOne() { return null; }
  }
  return { default: FakeRecoveryEncounter };
});

import app from './app';

describe('owner-scoped API regression', () => {
  let origin: string;
  let server: ReturnType<typeof app.listen>;
  const environmentKeys = ['NODE_ENV', 'BLUEGUARDIAN_AUTH_MODE', 'BLUEGUARDIAN_OWNER_TOKEN', 'BLUEGUARDIAN_OWNER_ID'] as const;
  const originals = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]])) as Record<typeof environmentKeys[number], string | undefined>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.BLUEGUARDIAN_AUTH_MODE = 'required';
    process.env.BLUEGUARDIAN_OWNER_TOKEN = 'test-owner-token';
    process.env.BLUEGUARDIAN_OWNER_ID = 'owner-alpha';
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const key of environmentKeys) {
      const value = originals[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    captured.deviceFind.length = 0;
    captured.deviceFindOne.length = 0;
    captured.threatFind.length = 0;
    captured.actionFind.length = 0;
    captured.eventFind.length = 0;
    captured.createdDevices.length = 0;
  });

  const headers = { Authorization: 'Bearer test-owner-token' };

  it("preserves existing list endpoints while filtering every user’s records by ownerId", async () => {
    const responses = await Promise.all([
      fetch(`${origin}/api/devices`, { headers }),
      fetch(`${origin}/api/threats`, { headers }),
      fetch(`${origin}/api/actions`, { headers }),
      fetch(`${origin}/api/events`, { headers }),
      fetch(`${origin}/api/recovery/devices`, { headers }),
    ]);

    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(captured.deviceFind).toContainEqual({ ownerId: 'owner-alpha' });
    expect(captured.threatFind).toContainEqual({ ownerId: 'owner-alpha' });
    expect(captured.actionFind).toContainEqual({ ownerId: 'owner-alpha' });
    expect(captured.eventFind).toContainEqual({ ownerId: 'owner-alpha' });
  });

  it('derives ownership from authentication instead of trusting a client-supplied ownerId', async () => {
    const response = await fetch(`${origin}/api/devices`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'local-device-123',
        deviceIdentifier: 'browser-identifier-123',
        name: 'Test headphones',
        discoverySource: 'REAL',
        ownerId: 'attacker-chosen-owner',
      }),
    });

    expect(response.status).toBe(201);
    expect(captured.createdDevices).toHaveLength(1);
    expect(captured.createdDevices[0]).toMatchObject({ ownerId: 'owner-alpha', deviceId: 'local-device-123' });
    expect(captured.createdDevices[0]).not.toHaveProperty('ownerId', 'attacker-chosen-owner');
  });

  it('uses the authenticated owner in device detail queries', async () => {
    const response = await fetch(`${origin}/api/devices/some-device`, { headers });
    expect(response.status).toBe(404);
    expect(captured.deviceFindOne).toContainEqual({ ownerId: 'owner-alpha', deviceId: 'some-device' });
  });

  it('continues to reject unauthenticated calls after retaining the legacy endpoints', async () => {
    const response = await fetch(`${origin}/api/devices`);
    expect(response.status).toBe(401);
  });
});
