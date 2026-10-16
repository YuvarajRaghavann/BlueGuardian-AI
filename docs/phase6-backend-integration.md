# Phase 6: UI/Backend Integration and Final Verification

Date: 2026-10-16

## Branch and scope

Phase 6 is isolated on \`android/phase6-backend-integration-20261016\`, based on the Phase 5 combined-discovery source. No changes are made to \`main\` or production.

This phase connects the existing React/Capacitor UI to the existing owner-scoped HTTP API, makes the API base configurable for an installed Android APK, improves owner-session wiring, surfaces backend audit events, and extends CI to run backend tests/build as well as frontend tests/build and Android compilation.

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
- The Events page now reads owner-scoped server audit events when the owner registry is connected, while retaining browser-local/demo fallback when not connected. It does not represent these events as system-wide Android telemetry.
- The backend environment example documents that Capacitor Android WebView calls use the \`https://localhost\` origin and that the actual backend deployment must allow it via \`BLUEGUARDIAN_CORS_ORIGINS\`.
- Added tests for API URL normalization, HTTPS requirements, endpoint persistence/reset, change notifications, and actual health requests through the configured endpoint.
- Android CI now also runs the backend regression suite and TypeScript build.

## Configure the installed APK

1. Deploy the Node backend to a reachable HTTPS host, configure its MongoDB connection, and set `FIREBASE_PROJECT_ID=blueguardian-ai-auth` in the hosting environment. Keep `NODE_ENV=production` and `BLUEGUARDIAN_AUTH_MODE=required`.
2. Include \`https://localhost\` in the deployed backend's \`BLUEGUARDIAN_CORS_ORIGINS\` allowlist for Capacitor Android WebView fetch requests. Include the actual browser frontend origin(s) too if the web app is hosted separately.
3. Install the Phase 6 APK and open **Settings → Backend endpoint**.
4. Enter the actual backend URL. BlueGuardian appends \`/api\` automatically if you omit it, then select **Save and test backend**.
5. In Firebase Console, enable **Authentication → Sign-in method → Email/Password**. Open **Device Recovery** and use **Create account** or **Sign in**. The app requests a Firebase ID token and sends it to the backend, which verifies it before any owner-scoped record can be accessed.
6. Confirm Settings reports API health and database status. Test a real device observation, owner-scoped assessment, a security action, and the Events page against your own non-production data.

Do not substitute an example URL, publish a token in source control, or use a third-party proxy for protected owner API calls.

## Security boundaries and limitations

- Remote API URLs are configuration, not secrets. Owner tokens remain separate and memory-only.
- HTTPS is required for remote URLs. Plain HTTP is allowed only for browser-local development, not the packaged Android application.
- \`/api/health\` reports service/database health, not owner authorization. A healthy health endpoint does not prove that protected API routes are ready.
- Production protected APIs verify Firebase ID tokens when `FIREBASE_PROJECT_ID` is configured. If the project ID is missing or Google's signing keys cannot be checked, the backend fails closed with a service error. Invalid or expired tokens are rejected. The static owner token remains only a non-production development fallback.
- CORS is not authentication. Set the server allowlist to the actual client origins; do not wildcard protected traffic as a substitute.
- Device/threat/action synchronization happens only when an owner token is established and the owner-scoped device registry loads successfully. If the endpoint is missing or unavailable, the UI retains local data and reports the connection problem.
- Bluetooth discovery remains foreground-only. Phase 6 does not add native GATT connection, background scan service, automatic device trust, community location collection, or recovery-notification delivery.
- No backend deployment hostname is known/configured by this branch; none is baked into the APK. No live remote backend, live MongoDB, or physical phone end-to-end test is claimed by CI alone.

## Automated acceptance gate

CI must pass:

1. Frontend TypeScript/Vite production build.
2. Frontend Vitest regression suite, including runtime API-base tests.
3. Backend Vitest suite and backend TypeScript build.
4. Capacitor Android generation/sync and API 36 setup.
5. Gradle Android debug APK compilation and artifact upload.

CI confirms source integration and compile/test results. It does not replace handset Bluetooth testing or deployment-specific CORS, database, authentication, and network verification.
