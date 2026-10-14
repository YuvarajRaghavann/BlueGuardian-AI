import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import app from './app.js';
import Device from './models/Device.js';
import RecoveryEncounter from './models/RecoveryEncounter.js';

const mongoIntegrationEnabled = process.env.RUN_MONGO_INTEGRATION === '1' && Boolean(process.env.MONGODB_TEST_URI);
process.env.NODE_ENV = 'test';
process.env.BLUEGUARDIAN_AUTH_MODE = 'required';
process.env.BLUEGUARDIAN_OWNER_ID = 'mongo-test-owner-a';
process.env.BLUEGUARDIAN_OWNER_TOKEN = 'mongo-test-owner-token-a';
process.env.BLUEGUARDIAN_PARTICIPANT_TOKEN = '';

const ownerA = { Authorization: 'Bearer mongo-test-owner-token-a' };
const ownerB = { Authorization: 'Bearer mongo-test-owner-token-b' };
let server: ReturnType<typeof app.listen>;
let origin: string;

async function startServer() {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
}

async function stopServer() {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe.skipIf(!mongoIntegrationEnabled)('recovery persistence against MongoDB', () => {
  beforeAll(async () => {
    mongoose.set('bufferCommands', false);
    Device.schema.set('bufferCommands', false);
    RecoveryEncounter.schema.set('bufferCommands', false);

    process.env.MONGODB_URI = process.env.MONGODB_TEST_URI;
    const { connectDB } = await import('./config/db.js');
    await connectDB();
    await mongoose.connection.db!.dropDatabase();
    await Device.syncIndexes();
    await RecoveryEncounter.syncIndexes();
    await startServer();
  }, 30_000);

  afterAll(async () => {
    await stopServer();
    await mongoose.disconnect();
  }, 30_000);

  it('persists owner registrations, case state, and sightings across an API service restart', async () => {
    const registered = await fetch(`${origin}/api/recovery/devices`, {
      method: 'POST',
      headers: { ...ownerA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'mongo-browser-device-a',
        deviceIdentifier: 'mongo-browser-device-a',
        deviceName: 'Mongo integration device',
        discoverySource: 'REAL',
        recoveryState: 'lost',
        ownerId: 'client-owner-must-be-ignored',
      }),
    });
    expect(registered.status).toBe(201);
    expect(await Device.countDocuments({ ownerId: 'mongo-test-owner-a' })).toBe(1);
    expect(await Device.countDocuments({ ownerId: 'client-owner-must-be-ignored' })).toBe(0);

    const state = await fetch(`${origin}/api/recovery/devices/mongo-browser-device-a`, {
      method: 'PATCH',
      headers: { ...ownerA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'recovered' }),
    });
    expect(state.status).toBe(200);

    const observationBody = JSON.stringify({
      source: 'REAL',
      simulated: false,
      isTestFixture: false,
      description: 'MongoDB integration observation.',
    });
    const firstReport = await fetch(`${origin}/api/recovery/devices/mongo-browser-device-a/encounters`, {
      method: 'POST',
      headers: { ...ownerA, 'Content-Type': 'application/json' },
      body: observationBody,
    });
    expect(firstReport.status).toBe(201);

    const duplicateReport = await fetch(`${origin}/api/recovery/devices/mongo-browser-device-a/encounters`, {
      method: 'POST',
      headers: { ...ownerA, 'Content-Type': 'application/json' },
      body: observationBody,
    });
    expect(duplicateReport.status).toBe(200);
    expect(await RecoveryEncounter.countDocuments({ deviceId: 'mongo-browser-device-a' })).toBe(1);

    await stopServer();
    await mongoose.disconnect();
    const { connectDB } = await import('./config/db.js');
    await connectDB();
    await startServer();

    const deviceList = await fetch(`${origin}/api/recovery/devices`, { headers: ownerA });
    expect(await deviceList.json()).toMatchObject([{ deviceId: 'mongo-browser-device-a', recoveryState: 'recovered' }]);

    const encounters = await fetch(`${origin}/api/recovery/devices/mongo-browser-device-a/encounters`, { headers: ownerA });
    expect(encounters.status).toBe(200);
    expect(await encounters.json()).toMatchObject([{ source: 'REAL', simulated: false }]);

    process.env.BLUEGUARDIAN_OWNER_ID = 'mongo-test-owner-b';
    process.env.BLUEGUARDIAN_OWNER_TOKEN = 'mongo-test-owner-token-b';
    const crossOwnerRead = await fetch(`${origin}/api/recovery/devices/mongo-browser-device-a/encounters`, { headers: ownerB });
    expect(crossOwnerRead.status).toBe(404);
    process.env.BLUEGUARDIAN_OWNER_ID = 'mongo-test-owner-a';
    process.env.BLUEGUARDIAN_OWNER_TOKEN = 'mongo-test-owner-token-a';
  }, 60_000);

  it('rejects invalid coordinates and exposes the configured encounter TTL index', async () => {
    const invalid = await fetch(`${origin}/api/recovery/devices/mongo-browser-device-a/encounters`, {
      method: 'POST',
      headers: { ...ownerA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'REAL',
        simulated: false,
        location: { lat: 100, lng: 0 },
      }),
    });
    expect(invalid.status).toBe(400);
    expect(await RecoveryEncounter.countDocuments({ deviceId: 'mongo-browser-device-a' })).toBe(1);

    const indexes = await RecoveryEncounter.collection.indexes();
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: { createdAt: 1 },
        expireAfterSeconds: 60 * 60 * 24 * 30,
      }),
    ]));
  });

  it('expires old encounter records using MongoDB TTL processing', async () => {
    const expiredId = new mongoose.Types.ObjectId();
    await RecoveryEncounter.collection.insertOne({
      _id: expiredId,
      deviceId: 'ttl-expiry-test',
      ownerId: 'mongo-test-owner-a',
      source: 'REAL',
      observedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      simulated: false,
      isTestFixture: false,
    });

    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline) {
      const remaining = await RecoveryEncounter.collection.countDocuments({ _id: expiredId });
      if (remaining === 0) return;
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    expect(await RecoveryEncounter.collection.countDocuments({ _id: expiredId })).toBe(0);
  }, 90_000);

  it('returns a useful unavailable response when MongoDB is disconnected', async () => {
    await mongoose.disconnect();
    const response = await fetch(`${origin}/api/recovery/devices`, { headers: ownerA });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'Recovery storage is unavailable. Retry after the database connection is restored.',
    });

    const { connectDB } = await import('./config/db.js');
    await connectDB();
  }, 30_000);
});
