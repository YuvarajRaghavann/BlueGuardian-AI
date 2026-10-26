# Phase 6: UI/Backend Integration and Final Verification

Date: 2026-10-16

## Branch and scope

Phase 6 is isolated on \`android/phase6-backend-integration-20261016\`, based on the Phase 5 combined-discovery source. No changes are made to \`main\` or production.

This phase connects the React/Capacitor UI to the owner-scoped HTTP API, adds Firebase email/password sign-in and server-side ID-token verification, provides native Android foreground Bluetooth selection inside Device Recovery, makes the API base configurable in the installed APK, surfaces backend audit events, and validates frontend, backend, and Android builds in CI.

The backend is **not packaged inside the APK**. A reachable backend deployment, an HTTPS URL, database configuration, and appropriate server-side authentication/CORS configuration are still required for real remote persistence.

## Implementation

- Replaced the API client's fixed module-load-time base URL with a runtime configuration service.
- Added **Settings → Backend endpoint**, which stores a non-secret API base URL on this device, appends \`/api\` when omitted, tests \`/api/health\`, and reports clear configuration/connectivity states.
- Packaged Android builds do not silently send requests to their own WebView origin when no backend URL is configured. Settings reports that configuration is required.
- API calls use \`cache: no-store\` and resolve the endpoint at request time, so changing the endpoint does not require rebuilding the APK.
- Endpoint changes trigger the owner device registry to reload, which in turn allows the existing owner-scoped device/threat/action integrations to retry against the new endpoint.
- Added Firebase email/password sign-in and account creation to Device Recovery using the Firebase Identity Toolkit REST API, keeping ID and refresh tokens in JavaScript memory only.
- Authenticated API calls refresh a Firebase ID token in memory as it nears expiry, without persisting tokens to localStorage or sessionStorage.
- The backend verifies Firebase ID-token signatures against Google's rotating public JWKs and validates issuer, audience, subject, issue time, authentication time, and expiry. No Firebase service-account private key is required.
- The owner ID for Firebase-authenticated requests is derived from the verified token subject, so records remain scoped to the authenticated Firebase user.
- Device Recovery now uses the existing native Android BLE and classic Bluetooth plugin in the installed APK: it merges the paired-device list with nearby BLE scan results for selection, while browser builds retain the Web Bluetooth picker. Presence checks use a foreground BLE/classic scan. This does not add background scanning or location collection.
- The Events page now reads owner-scoped server audit events when the owner registry is connected, while retaining browser-local/demo fallback when not connected. It does not represent these events as system-wide Android telemetry.
- The backend environment example documents that Capacitor Android WebView calls use the \`https://localhost\` origin and that the actual backend deployment must allow it via \`BLUEGUARDIAN_CORS_ORIGINS\`.
- Added tests for API URL normalization, HTTPS requirements, endpoint persistence/reset, change notifications, and actual health requests through the configured endpoint.
- Android CI now also runs the backend regression suite and TypeScript build.

## Deploy a separate Phase 6 backend to Render

The existing Render service `blueguardian-backend` is attached to `main`; leave it unchanged. This branch contains a `render.yaml` Blueprint for a separate `blueguardian-backend-phase6` test service.

1. In Render, create a **New → Blueprint Instance** connected to this repository and select branch `android/phase6-backend-integration-20261016`. Let Render read the branch's `render.yaml`.
2. Supply `MONGODB_URI` in Render's secret environment settings. Use the same valid Atlas connection string that worked locally, but never put it in Git or the APK. The Blueprint sets `NODE_ENV=production`, `BLUEGUARDIAN_AUTH_MODE=required`, `FIREBASE_PROJECT_ID=blueguardian-ai-auth`, Node `24.21.0`, and `BLUEGUARDIAN_CORS_ORIGINS=https://localhost`.
3. Deploy the Blueprint. Render assigns the test service a public HTTPS URL. Open `https://YOUR-PHASE6-URL/api/health`; require `{"status":"ok","database":"connected"}` before testing authentication. If the health check fails, review Render deploy/runtime logs and the Atlas network access list.
4. In Firebase Console, enable **Authentication → Sign-in method → Email/Password** (your screenshot showed it enabled already).
5. In the Phase 6 APK, open **Settings → Backend endpoint** and enter the test service's HTTPS origin, e.g. `https://YOUR-PHASE6-URL`. Do not enter a MongoDB URI. BlueGuardian appends `/api`; choose **Save and test backend**.
6. Open **Device Recovery**, choose **Create account** for a new test user or **Sign in** for an existing Firebase user. Successful Firebase sign-in followed by a successful backend request should load the user's owner-scoped records; a new account is expected to start with an empty list.
7. Tap **Find native Android devices**, allow Android Nearby Devices (and any version-dependent permission requested by the app), keep a BLE device advertising or choose an already-paired device, and select it from the result list. Register it as lost and verify it appears under **My recovery cases**. Try **Verify present with Bluetooth** only while the device is nearby/discoverable.
8. The first recovery registration and presence request are real end-to-end tests only after the Phase 6 Render service is deployed with those settings. CI validates code and APK compilation, but it cannot replace testing Bluetooth permission prompts and a physical BLE device on your phone.

## Configure the installed APK

The API endpoint and database are separate: the APK receives only the backend's HTTPS URL, while the MongoDB URI stays in Render's environment. The backend must allow the Capacitor Android WebView origin `https://localhost` in `BLUEGUARDIAN_CORS_ORIGINS`; add the exact browser frontend origin too if testing the hosted web app.

## Security boundaries and limitations

- Remote API URLs are configuration, not secrets. Owner tokens remain separate and memory-only.
- HTTPS is required for remote URLs. Plain HTTP is allowed only for browser-local development, not the packaged Android application.
- \`/api/health\` reports service/database health, not owner authorization. A healthy health endpoint does not prove that protected API routes are ready.
- Production protected APIs verify Firebase ID tokens when `FIREBASE_PROJECT_ID` is configured. If the project ID is missing or Google's signing keys cannot be checked, the backend fails closed with a service error. Invalid or expired tokens are rejected. The static owner token remains only a non-production development fallback.
- CORS is not authentication. Set the server allowlist to the actual client origins; do not wildcard protected traffic as a substitute.
- Device/threat/action synchronization happens only when an owner token is established and the owner-scoped device registry loads successfully. If the endpoint is missing or unavailable, the UI retains local data and reports the connection problem.
- Bluetooth discovery remains foreground-only. Phase 6 does not add native GATT connection, background scan service, automatic device trust, community location collection, or recovery-notification delivery.
- The existing `blueguardian-backend.onrender.com` service is deployed from `main`; it is not assumed to contain this Phase 6 code. Do not change the existing service while testing this branch. No Phase 6 Render URL is baked into the APK. No live Phase 6 Render/Firebase end-to-end test or physical phone test is claimed by CI alone.

## Automated acceptance gate

CI must pass:

1. Frontend TypeScript/Vite production build.
2. Frontend Vitest regression suite, including runtime API-base tests.
3. Backend Vitest suite and backend TypeScript build.
4. Capacitor Android generation/sync and API 36 setup.
5. Gradle Android debug APK compilation and artifact upload.

CI confirms source integration and compile/test results. It does not replace handset Bluetooth testing or deployment-specific CORS, database, authentication, and network verification.
