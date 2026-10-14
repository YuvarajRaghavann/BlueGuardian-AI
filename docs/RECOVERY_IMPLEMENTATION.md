# Recovery implementation

## User-facing data flow

The Recovery page now uses the backend as its source of truth; it does not create a local success-shaped fallback.

1. The owner enters a backend bearer token in the Recovery page. It is held in component memory only and is not written to local or session storage.
2. `Select real device` invokes the browser's Web Bluetooth chooser from a user gesture. The browser-provided name and origin-scoped `BluetoothDevice.id` can be registered; no MAC address or universal hardware identity is assumed.
3. `Register as lost` calls `POST /api/recovery/devices`. The server derives `ownerId` from the authenticated server configuration; request-supplied owner IDs are ignored.
4. The registered-device list and recovery summary are loaded from owner-authorized backend endpoints.
5. `Verify present with Bluetooth` asks the browser to select a device again and submits only when its browser-scoped identifier exactly matches the selected registration. It sends no coordinates, RSSI, confidence score, or client timestamp because Web Bluetooth does not expose those values for this flow.
6. The API server stamps an accepted encounter with its own receive time. The owner can retrieve the report history and explicitly mark a case lost or recovered. Changing recovery state does not delete sightings.

The browser ID is origin-scoped, can change with browser/profile/permission context, and is not a globally comparable BLE identity. A successful owner-device picker observation is not a community sighting and does not establish a cryptographic hardware identity.

## API endpoints

Mounted under `/api/recovery` in `backend/src/app.ts`:

| Method and path | Authorization | Behavior |
| --- | --- | --- |
| `GET /api/recovery/devices` | Owner | List the authenticated owner's devices. |
| `POST /api/recovery/devices` | Owner | Register or refresh an owner-scoped device. |
| `GET /api/recovery/devices/:deviceId` | Owner | Return owner-authorized recovery summary and latest observation. |
| `PATCH /api/recovery/devices/:deviceId` | Owner | Persist `lost`, `searching`, `found`, or `recovered` state. Invalid states return 400. |
| `GET /api/recovery/devices/:deviceId/encounters` | Owner | Retrieve sightings after confirming device ownership. |
| `POST /api/recovery/devices/:deviceId/encounters` | Owner | Validate and persist an owner browser observation; currently limited to 10 requests per IP per minute in a single backend process. |

Encounter source must be exactly `REAL` or `SIMULATED`. Simulated reports must set `simulated: true`; real reports cannot be test fixtures. Optional coordinates are range-validated, but are not required and are not generated. Confidence is optional because the supported browser observation does not provide a defensible confidence metric. An encounter does not automatically mark a device found or recovered.

## Persistence, errors, and retention

- Device and encounter records use the existing Mongoose models and MongoDB connection.
- The owner identity comes from backend configuration, never from a client owner ID. Owner lookups scope both device and encounter queries to that server-derived identity.
- Missing authentication configuration and attempts to disable authentication in production fail closed with 503. Invalid authorization returns 401, non-owner device reads return 404, and invalid state or encounter bodies return 400.
- Recovery responses are marked `private, no-store, no-cache, must-revalidate`; Recovery API requests use the browser `no-store` cache mode. Recovery routes discard conditional `If-None-Match` and `If-Modified-Since` validators so a stale ETag cannot turn an authenticated GET into a bodyless 304 response.
- Device registration is persisted by `POST /api/recovery/devices` using `Device.save()`; the owner list is read from MongoDB with `Device.find({ ownerId })`. The Recovery UI does not store registrations in browser-local state as a substitute for backend success. Its in-memory list is updated only after a successful registration response.
- The encounter schema declares a MongoDB TTL index for 30 days after `createdAt`; device registration and recovery state are retained. Production setup must verify/create this index, and TTL deletion is performed asynchronously by MongoDB.
- Encounter idempotency uses a server-generated SHA-256 digest over normalized owner/device/report fields and a one-minute server-time bucket. A duplicate returns the prior report with HTTP 200; a unique index protects concurrent duplicate inserts. Client timestamps are ignored.
- API route tests use an in-memory model adapter to verify authorization, route behavior, state persistence across requests, encounter persistence, and response privacy. This does **not** substitute for a live MongoDB integration test.

Backend configuration is described by `backend/.env.example`. The static owner token and configured owner subject work only as a single-owner development integration. In `NODE_ENV=production`, recovery authentication returns 503 unconditionally; adding static token values does not enable production access. This is deliberately not described as production-ready authentication.

## Authenticated list caching fix

The frontend sends `GET /api/recovery/devices` through the Vite `/api` proxy to `http://localhost:4000`; the proxy target is declared in `vite.config.ts`. Express automatically generated ETags, and Recovery responses previously had no explicit cache policy. A browser revalidation could therefore produce `304 Not Modified`, which has no JSON body; the API client's JSON handler rejects non-2xx responses, so the Recovery page could not update its device list from that response. The page's `finally` block does clear its busy state, but the resulting error and empty list could look like a stalled or unsuccessful load.

The frontend now opts out of HTTP caching for all authenticated Recovery API operations. The backend also sends no-store cache headers and ignores conditional validators on the Recovery router, including for authentication and database error responses. The backend route test repeats an authenticated list request with the first response's ETag and verifies that the second response is 200 with a JSON body rather than 304. API client tests verify successful empty lists and visible 401/503 error details. A successful empty list is presented separately from the not-yet-loaded state.

Live probes in this debugging task confirmed `GET /api/health` returned 200 with database status `connected` through both ports 4000 and 5173; unauthenticated GETs returned 401 through both ports, confirming the Vite proxy reaches the backend. A read-only authenticated request to the running backend returned 200 with one owner device, including exactly one record named `kkk` in `lost` state. This confirms that record is currently readable from the Mongo-backed recovery route; persistence across a backend restart was not tested. The running backend process still returned ETags without `Cache-Control` after the source fix, so it must be restarted to load the new middleware. A client-side conditional request against that process returned 200 during this check; the reported browser 304 was not independently reproduced against the live process.

The minimal production integration for this Express/Mongoose architecture is an OIDC access-token verifier: configure the chosen issuer URL and API audience; verify JWT signature against the issuer's published JWKS plus issuer, audience, expiry, and allowed algorithm; map the verified subject (`sub`) to the owner ID; and require explicit participant scopes before enabling any observer/report route. Device/encounter queries must continue to use only that verified subject. The frontend should use the provider's authorization-code flow with PKCE and pass short-lived access tokens in memory; it must never ship a client secret or embed a backend owner token in `VITE_*` build variables. Provider, issuer/audience, subject-to-account mapping, participant consent/scope model, token refresh, and account recovery decisions remain unselected/unimplemented. No credentials or provider settings have been fabricated.

## MongoDB integration test setup

`backend/npm run test:recovery:mongo` runs the real Mongoose models and Express routes against a disposable local MongoDB server. The runner accepts `MONGODB_TEST_URI` only when its host is `localhost`, `127.0.0.1`, or `::1` and its database path is exactly `blueguardian_test`. It refuses remote hosts and other database names, never prints the URI, drops only that test database, rebuilds model indexes, and verifies persistence after disconnect/reconnect, owner isolation, duplicate handling, invalid coordinates, the 30-day TTL index and expiry, and a 503 response during database disconnection.

Reproducible local sequence (from `backend/`):

1. Install/run a MongoDB Community Server locally using the official MongoDB instructions for the host OS; do not point this test at a production or shared instance.
2. Confirm the local test service is listening on `127.0.0.1:27017`.
3. In PowerShell, set `$env:MONGODB_TEST_URI='mongodb://127.0.0.1:27017/blueguardian_test'`.
4. Run `npm run test:recovery:mongo`.
5. Remove the shell variable with `Remove-Item Env:MONGODB_TEST_URI`.

The guarded real-Mongo integration suite was not run in this task. The read-only live API check establishes that the current `kkk` record is stored and retrievable through the connected Mongo-backed service, but does not verify persistence across service restart, TTL index behavior, or the full integration suite.

## Platform capabilities and non-claims

- Web Bluetooth requires a supported browser, user gesture, and permission. It selects an individual device; it does not provide passive continuous scanning or background community discovery.
- Android scanning is a separate native capability. The Android source requests API-appropriate runtime Bluetooth permissions, stops foreground scanning when the activity pauses, and avoids logging device addresses. The code was not build-verified in this environment and has not been exercised on a device.
- Generic advertisements, browser device IDs, and owner-supplied names do not prove a particular lost-device identity.
- No background recovery, community-assisted cross-client matching, location reporting, push notification, or real-hardware encounter is claimed.

## Other web data and API boundaries

- `GET /api/health` is public and is used by Settings to display the backend/database health result. It contains service status only, not private recovery information.
- The general `/api/devices`, `/api/threats`, `/api/actions`, and `/api/events` route groups require owner authentication for reads and writes. The matching frontend API client methods require an explicit owner bearer token. These generic backend data models are not owner-scoped, so the current frontend pages do not use them to synchronize user data; production auth remains disabled. Do not enable multi-user use of those records until verified identity is mapped to owner-scoped persistence and queries.
- Dashboard, Devices, Threats, Events, and Security Action history remain browser-local. Device, assessment, and action records use IndexedDB, with UI settings in local storage; no cross-browser/account sync is implied. Settings reports actual health-check and IndexedDB access results and marks Bluetooth OS enforcement unavailable.
- The Dashboard and Threats pages label their risk output as app-local/development assessment, not confirmed system-wide threats or OS-level protection. Restored GATT state is unknown until observed again in the current browser session; proximity filters omit devices without a reported RSSI. The Events page's demo fallback is explicitly marked `SIMULATED`, and the simulated-event preference filters it in the Events and Dashboard timelines.
- API base URL is `VITE_API_BASE` when configured, otherwise `/api`; trailing slashes are normalized before route paths are appended. Do not place owner tokens, backend secrets, or client secrets in `VITE_*` build variables.

## Verification coverage

Automated frontend coverage includes Recovery API client tests for explicit bearer authorization and refusing an empty owner token, protected generic API headers/error propagation, simulation filtering, and restored-device connection state. Backend tests cover auth acceptance/denial and fail-closed configuration, registration validation, browser observations without invented location/confidence, malformed source/location/simulation flags, owner isolation, registration/list/read/state routes, encounter persistence through the route adapter, invalid requests, and empty encounter summaries. Database error tests cover MongoDB network/server-selection failures and buffered operations before connection as service-unavailable cases.

Latest verification for the authenticated Recovery caching fix:

- Frontend `npm test -- --run`: 30 tests passed across 7 files.
- Frontend `npm run build`: TypeScript project check and Vite production build passed. Vite emitted its existing advisory for a 599.00 kB minified JavaScript chunk (500 kB advisory threshold).
- Backend `npm test`: 25 tests passed; 4 guarded live-Mongo tests skipped across the suite. The new conditional authenticated device-list test confirms a repeated request with the prior ETag returns 200 with a JSON body and `Cache-Control: no-store`.
- Backend `npm run build`: TypeScript build passed.

The first test/build attempts could not start because installed Windows executables/native bindings were missing. The missing platform-specific Rolldown bindings were installed without changing package manifests or lockfiles; no `npm audit fix` was run. The backend install printed a dependency audit summary of 7 vulnerabilities; no audit or dependency remediation was performed as part of this fix. The guarded live-Mongo suite remains necessary to verify restart persistence, indexes, TTL behavior, and database-disconnect handling.

Dashboard sample recovery cards and unlabelled sample event fallbacks have been removed; explicit demo surfaces remain marked as simulated. Changes in this web-flow update did not attempt MongoDB setup or Android/Gradle validation.

## Outstanding requirements

- Run the guarded MongoDB integration suite against a dedicated local MongoDB test instance and capture its actual results.
- Verify the encounter TTL index exists in the production database.
- Integrate production OIDC access-token verification before deploying protected recovery routes.
- Define a privacy-preserving, verified cross-client BLE identifier/matching mechanism before implementing community reports.
- Add real notification delivery only after consent, privacy, and delivery configuration are designed.
- Define owner-scoped schemas/queries and verified identity before syncing the browser-local Devices, Threats, Events, or Action history to backend persistence.
- Complete Android Gradle dependency resolution and test Android runtime permissions/scanning on supported hardware.
- Keep browser discovery and Android background scanning separate; neither constitutes verified recovery until tested with the actual devices and lifecycle conditions.
