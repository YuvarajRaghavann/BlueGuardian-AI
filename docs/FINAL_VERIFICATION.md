# Final verification

## Current automated verification

Frontend project directory: `E:\BlueGuardian-Final` (the same mounted project is `/mnt/e/BlueGuardian-Final` in WSL). Backend verification was run in the configured WSL working copy `~/BlueGuardian-work/backend`.

| Area | Command | Result |
| --- | --- | --- |
| Frontend tests | In `E:\BlueGuardian-Final`: `npm test -- --run` | Freshly verified: 7 files passed, 30 tests passed (Windows Node). |
| Frontend tests in WSL | In `/mnt/e/BlueGuardian-Final`: `npm test -- --run` | Failed before tests started: Vitest/Rolldown could not load a native binding from the shared `node_modules` (`@rolldown/binding-wasm32-wasi` missing). No dependency reinstall was performed. |
| Frontend production build | In `E:\BlueGuardian-Final`: `npm run build` | Freshly verified: TypeScript and Vite production build completed. Advisory only: main JavaScript bundle is 599.00 kB (>500 kB). |
| Frontend lint (latest recorded; not run for this build verification) | In `E:\BlueGuardian-Final`: `npm run lint` | Exit code 0; 13 warnings remain; no lint errors. |
| Tailwind | Root `npm ls tailwindcss --depth=0` | Pass: `tailwindcss@3.4.19`. |
| Backend tests | WSL `~/BlueGuardian-work/backend`: `npm test` | Reused the latest recorded successful result because no backend source changes followed that run: 4 files passed, 1 guarded live-Mongo suite skipped; 27 passed, 4 skipped (31 total). Not freshly rerun for this verification. |
| Backend TypeScript build | WSL `~/BlueGuardian-work/backend`: `npm run build` | Reused the latest recorded successful result because no backend source changes followed that run: `tsc` passed. Not freshly rerun for this verification. |
| Backend tests in `E:\BlueGuardian-Final\backend` | `npm test` | Failed in this separate Windows dependency tree: 4 suites could not import `express`/`mongoose`; 11 tests from the standalone database-error suite passed. No dependencies were reinstalled. |
| Backend TypeScript build in `E:\BlueGuardian-Final\backend` | `npm run build` | Failed: TypeScript could not resolve backend modules/types including `express`, `cors`, `helmet`, `morgan`, and `mongoose`. Use the confirmed WSL backend working copy for backend validation. |
| Backend dependency audit | Not run in this task | No audit remediation was performed. Targeted native-binding installation emitted an npm summary of 7 vulnerabilities for its resolved install tree. |
| Root dependency audit | Most recent recorded root `npm audit --json` | 7 findings: 5 high, 2 moderate. Findings include Tailwind 3.4.19 and transitive packages `braces`, `chokidar`, `fast-glob`, `micromatch`, `postcss-nested`, and `postcss-selector-parser`. No `npm audit fix --force` or major Tailwind upgrade was run. |

## Recovery verification scope and limits

The latest post-hardening backend route tests cover registration and list persistence between HTTP requests using an in-memory model adapter, owner-only retrieval, rejection of client-supplied owner identity, unauthorized requests, strict encounter validation, owner observation submission, sightings retrieval, state transitions to recovered, rejection of invalid state values, missing/invalid tokens, safe database errors, and repeated authenticated GETs with an ETag returning a 200 JSON body and `Cache-Control: no-store`.

Live probes in this verification confirmed `/api/health` returned 200 with `database: connected` from ports 4000 and 5173 and unauthenticated Recovery reads returned 401 on both, verifying the Vite proxy. The owner additionally confirmed the following end-to-end checks against the WSL backend and Atlas: registering `kkk`, reading it back, retaining it after backend restart, HTTP 200 with device JSON and `Cache-Control: private, no-store, no-cache, must-revalidate`, rejection of an incorrect owner token with 401, and successful device loading with the configured development owner token. These Atlas/restart checks are user-confirmed; they were not repeated during this read-only verification run.

- The guarded live-Mongo integration suite remains skipped (4 tests); its restart-persistence, cross-owner database behavior, TTL/index behavior, and TTL expiry assertions were not rerun in this task. Owner confirms device persistence across backend restart in the active Atlas environment.
- `backend/scripts/run-recovery-mongo-integration.mjs` and `backend/src/recovery.mongo.integration.test.ts` now provide a live-database route/persistence suite. `npm run test:recovery:mongo` accepts only a local host and database exactly named `blueguardian_test`, drops only that database, and verifies service-restart persistence, owner isolation, duplicate handling, invalid input, TTL index/expiry, and a 503 when MongoDB is unavailable. This suite was not run against a live server here.
- Static bearer-token authentication is development-only. Recovery authorization returns 503 in production pending OIDC/JWKS verification and per-subject owner mapping; no production identity provider is configured.
- Encounter submission is owner-only; a shared participant token is not accepted, so community reporting remains disabled rather than weakly authenticated.
- No real browser observation, Android observation, community match, notification delivery, or hardware recovery was performed.

The owner recovery UI calls the real API, holds the manually entered bearer token only in page memory, retrieves owner-authorized records, and sends a presence report only after a matching Web Bluetooth picker selection. No coordinates, RSSI, confidence, or client timestamp are fabricated. Recovery GET responses are explicitly non-cacheable, frontend requests use `cache: no-store`, and conditional validators are ignored by the Recovery router. The owner confirms the currently used WSL backend returns the expected no-store header. The Windows-hosted backend process probed separately in this verification returned 401 for unauthenticated requests and did not return cache headers on those responses; that process may not be the WSL service or may not have loaded the current source. Use the WSL backend on port 4000 for browser verification.

## Web application integration status

- Recovery is the only user-facing workflow that persists owner-scoped device and encounter state through Mongo-backed recovery routes. Its operations report API failures; a failed follow-up refresh does not present an already-completed mutation as though the mutation failed.
- The dashboard, Devices, Threats, Events, and Security Action history continue to use browser state/IndexedDB. Their data is not synchronized across browsers or accounts. The legacy backend `/api/devices`, `/api/threats`, `/api/actions`, and `/api/events` routes are disabled (404) because their Mongo queries/mutations were not owner-scoped; the frontend does not use them as a substitute for browser-local data.
- The unauthenticated `/api/health` response is displayed by Settings. Settings separately checks IndexedDB access, persists supported browser UI preferences, and marks OS-level Bluetooth enforcement controls unavailable. Threat analysis is identified as a deterministic development assessment, not a production-trained detector.
- Dashboard connection status uses current browser-session connection evidence; saved device observations are restored as unknown rather than falsely shown as connected. RSSI-based proximity filtering excludes records with no browser-reported RSSI. Simulated events respect the show/hide preference and remain marked simulated.
- Topbar labels no longer imply an authenticated administrator, active notifications, or always-on monitoring. Events and dashboard activity are explicitly described as browser-local/demo rather than system-wide security telemetry.
- No production token or OIDC provider is configured. The current development static token is not production identity.
- Backend CORS uses exact origins from `BLUEGUARDIAN_CORS_ORIGINS` (comma-separated); an empty or unset setting emits no CORS allow-origin header. No production origins have been selected or configured. CORS is not an authentication mechanism.

## Backend route security review

The active Express app mounts only `/api/health` and `/api/recovery`. The review found that legacy data handlers were authenticated by a development token but did not constrain MongoDB queries to the authenticated owner: `/api/devices` had global lists and device-ID-only reads/updates (including patchable `ownerId`); `/api/threats`, `/api/actions`, and `/api/events` queried or wrote records without owner identity. These legacy route modules are now unmounted and tests verify their prior GET/POST surfaces (plus device assessment and PATCH paths) return 404. Existing models and MongoDB records were not deleted or migrated.

| Active routes | Identity and query/write scope |
| --- | --- |
| `GET /api/health` | Public operational status only; no user-owned record query. |
| `GET /api/recovery/devices` | Owner bearer token maps to server-configured owner ID; device query filters by that ID. |
| `POST /api/recovery/devices` | Uses owner ID from auth context; registration lookup scoped to owner and device identifier; ignores client-supplied owner ID. |
| `GET /api/recovery/devices/:deviceId` | Device and encounter queries scoped by authenticated owner and device ID. |
| `PATCH /api/recovery/devices/:deviceId` | Finds device by authenticated owner and device ID before saving state. |
| `GET /api/recovery/devices/:deviceId/encounters` | Confirms owner-scoped device, then filters encounters by owner and device. |
| `POST /api/recovery/devices/:deviceId/encounters` | Checks the device's stored owner against the authenticated owner; encounter and deduplication queries/writes include owner and device. Non-owner gets 404. |
| `/api/devices`, `/api/threats`, `/api/actions`, `/api/events` | Unmounted and unavailable (404) until owner-scoped persistence and route tests are implemented. |

Authentication rejects missing and incorrect owner tokens with 401; production protected routes still fail closed because OIDC/JWKS identity verification is not implemented. Recovery responses retain the no-store policy. Route tests use mocked/in-memory models to verify recovery cross-owner denial. The real-Mongo suite contains owner-switch isolation checks, but all four live-Mongo tests were skipped in this run; database-level cross-owner and TTL/index behavior are therefore not verified here.

The app now accepts exact allowed CORS origins from `BLUEGUARDIAN_CORS_ORIGINS`, as a comma-separated environment setting. No production origin was invented or configured. With no allowlist, cross-origin browser calls receive no allow-origin header. Set the deployment's actual frontend origins after they are chosen; this does not replace authentication.

These route-unmounting and CORS changes are verified by the backend test suite and TypeScript build, but do not affect an already-running Node process until it is restarted. Restart the backend from `~/BlueGuardian-work/backend` before relying on the 404 behavior or new CORS policy in a live instance. No live legacy-route/CORS probe was performed during this security review.

## Final build verification (2026-10-14)

Frontend verification was freshly run with Windows Node from `E:\BlueGuardian-Final`: `npm test -- --run` passed (7 files, 30 tests), and `npm run build` passed (TypeScript plus Vite production build). Vite emitted only the known bundle-size advisory (599.00 kB minified JavaScript chunk exceeds 500 kB); this is not a build failure. Backend test/build results above are reused from the successful post-hardening run in `~/BlueGuardian-work/backend` because no backend source changes followed those checks; they were not rerun tonight. The 4 live-Mongo tests remain skipped and do not count as passing.

## Android build attempt

The original `android/gradle/wrapper/gradle-wrapper.properties` referenced `file:///tmp/gradle-8.14.4-bin.zip`, which is a WSL-style path and not a usable Windows distribution location. It was changed to the official Gradle 8.14.4 distribution URL.

Verification attempts:

1. `android`: `.\gradlew.bat :app:assembleDebug`
   - Blocked: download from `https://services.gradle.org/distributions/gradle-8.14.4-bin.zip` timed out while connecting (wrapper network timeout is 10 seconds).
2. Cached Gradle 8.14.3 invoked directly with `:app:assembleDebug --offline`
   - Blocked: Android Gradle Plugin `com.android.application:8.9.2` was not available in the local dependency cache.

The Android Activity was updated to request Android 12+ scan/connect permissions (or pre-12 fine-location permission), report denial, and stop foreground scans on pause. Sensitive address/RSSI logging was removed from the BLE scanner. No new Android APK was verified, so these native source changes are not build-verified; no Android runtime permission or BLE hardware behavior is claimed as tested.

## Application behavior corrected

- Recovery registration, owner status changes, encounter submission, and owner retrieval now use `/api/recovery` rather than fabricated local results.
- Real browser observations contain only the selected device's origin-scoped browser identifier/name and server receive timestamp; they do not imply global identity or location.
- Owner authorization fails closed if required backend auth configuration is missing; production requests remain disabled until a production identity verifier is implemented.
- Encounter history declares a MongoDB 30-day TTL retention index and report-idempotency index. Their existence and expiry behavior are asserted by the prepared real-Mongo suite but have not been observed on a live database in this environment. Registered device records are retained.
- Dashboard no longer displays a static sample recovery card or substitutes mock events as live recent activity. Existing demo events remain explicitly labeled.

## Restart and repeat Recovery verification

The confirmed backend instance runs from the WSL working copy; do not start a second backend on the same port. To restart it, stop its current terminal process and run:

```bash
cd ~/BlueGuardian-work/backend
npm run dev
```

The frontend project is the original mounted project, not a separate copy:

```bash
cd /mnt/e/BlueGuardian-Final
npm run dev
```

Then open `http://localhost:5173`, navigate to **Device Recovery**, enter the configured development owner token (never put it in a command or share it), and select **Load my registered devices**. Verify `kkk` appears with its persisted state. In browser DevTools → Network, verify the proxied `GET /api/recovery/devices` has status 200, a JSON body, and `Cache-Control: private, no-store, no-cache, must-revalidate`; an intentionally incorrect token should yield 401. Do not use a public website or third-party proxy to test this protected endpoint.

The shared Windows/WSL frontend `node_modules` currently does not run Vitest under WSL because the WSL Rolldown native binding is missing. Windows Node tests and build passed. Do not reinstall dependencies just to address this unless WSL-native frontend test execution is required; if it is, use an isolated Linux install/cache rather than replacing the shared Windows dependency tree or modifying lockfiles.

## Correct verification working directories

- WSL backend (matching the running service): `~/BlueGuardian-work/backend`.
- Frontend source (original project): `/mnt/e/BlueGuardian-Final` in WSL or `E:\BlueGuardian-Final` under Windows Node.
- The backend at `/mnt/e/BlueGuardian-Final/backend` is a separate path from the confirmed WSL backend working copy. Its Windows `node_modules` was unavailable/incomplete during this check, so its tests/build are not represented as passing here.
- Settings queries `/api/health` and displays the returned service/database state.
- Device scanning and deterministic threat assessments remain local-first and are not synchronized to backend storage; this is an identified, unimplemented product integration.

## Outstanding work checklist

- Configure an isolated `blueguardian_test` MongoDB URI and run the guarded live-Mongo suite from the WSL backend working copy; 4 integration tests remain skipped in this run.
- After the test run passes, verify the declared 30-day encounter TTL index in the intended deployment database.
- Implement OIDC access-token validation (issuer, audience, JWKS signature, expiry, allowed algorithms), map verified `sub` to owner identity, and define scopes/consent before enabling participant reporting.
- Select the actual trusted deployment frontend origins, set `BLUEGUARDIAN_CORS_ORIGINS`, and verify preflight/browser behavior in that deployment.
- If legacy Devices, Threats, Actions, or Events APIs are needed again, implement owner-scoped identity, storage queries, and authorization tests before mounting them.
- Define and verify privacy-preserving BLE identity/matching before claiming community-assisted recovery.
- Complete Gradle dependency access, build the Android app, and verify runtime permissions/scanning on supported hardware.
- Design and test notification delivery and consent before claiming owner alerts.
- Define owner-scoped schemas/queries and verified identity before connecting browser-local Devices, Threats, Events, or Action history to backend persistence.
- Resolve the seven root dependency advisories through targeted, compatibility-tested upgrades; avoid force-upgrading Tailwind.
- Split the frontend bundle if the existing 589.84 kB chunk-size advisory needs to be addressed.
