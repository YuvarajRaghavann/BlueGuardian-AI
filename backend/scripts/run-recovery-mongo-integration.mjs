import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uri = process.env.MONGODB_TEST_URI;

if (!uri) {
  console.error('Set MONGODB_TEST_URI to a disposable local MongoDB database named exactly blueguardian_test.');
  process.exit(2);
}

const match = uri.match(/^mongodb(?:\+srv)?:\/\/([^/]+)\/([^?]+)(?:\?.*)?$/i);
if (!match) {
  console.error('MONGODB_TEST_URI must include a host and database name.');
  process.exit(2);
}

const [, authority, databaseName] = match;
const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
const hostname = (hostPort.startsWith('[') ? hostPort.slice(1, hostPort.indexOf(']')) : hostPort.split(':')[0]).toLowerCase();
if (!['localhost', '127.0.0.1', '::1'].includes(hostname) || databaseName !== 'blueguardian_test') {
  console.error('Refusing integration tests: only the local database named exactly blueguardian_test is allowed.');
  process.exit(2);
}

const vitest = path.join(backendRoot, 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(process.execPath, [vitest, 'run', 'src/recovery.mongo.integration.test.ts'], {
  cwd: backendRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    RUN_MONGO_INTEGRATION: '1',
    MONGODB_URI: uri,
    BLUEGUARDIAN_AUTH_MODE: 'required',
    BLUEGUARDIAN_OWNER_ID: 'mongo-test-owner-a',
    BLUEGUARDIAN_OWNER_TOKEN: 'mongo-test-owner-token-a',
    BLUEGUARDIAN_PARTICIPANT_TOKEN: '',
  },
});

if (result.error) {
  console.error('Unable to start the MongoDB integration test runner.');
  process.exit(1);
}

process.exit(result.status ?? 1);
