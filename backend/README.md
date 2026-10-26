# BlueGuardian server

Express + MongoDB API used for **accounts** and **community recovery**. Everything else in BlueGuardian runs on the phone.

## Run it

```bash
cp .env.example .env   # set MONGODB_URI (local MongoDB or Atlas)
npm install
npm run dev            # http://localhost:4000/api/health
npm run test:ci        # tests + TypeScript build
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/server.ts` | Starts the HTTP server after connecting to MongoDB (`src/config/db.ts`) |
| `src/app.ts` | Express app: Helmet, CORS allowlist, 256 KB body limit, routes, error handler |
| `src/auth.ts` | Verifies Firebase ID tokens (Google public keys) and sets the owner ID |
| `src/routes/` | `health`, `devices`, `threats`, `actions`, `events`, `recovery` |
| `src/services/recoveryService.ts` | Recovery validation and fingerprint hashing |
| `src/services/assessment.ts` | Server-side device assessment |
| `src/models/` | Mongoose models: `Device`, `RecoveryEncounter`, `ThreatAssessment`, `SecurityAction`, `AuditEvent` |
| `src/middleware/` | Async handler and error handler |
| `scripts/run-recovery-mongo-integration.mjs` | Guarded integration tests against a disposable local database |

## Security rules

- Every protected route requires a valid Firebase ID token (`BLUEGUARDIAN_AUTH_MODE=required`).
- Every query is filtered by the signed-in user's ID inside the database query itself.
- Community sightings never reveal whether anything matched, never change a device's state, and store location only with opt-in.
- Recovery writes are rate-limited to 10 per minute per client.

Endpoints and data model: [Technical Guide § Accounts, server and data](../docs/guide/TECHNICAL_GUIDE.md#8-accounts-server-and-data). Deployment: [Getting Started](../docs/guide/GETTING_STARTED.md#deploy-the-server).
