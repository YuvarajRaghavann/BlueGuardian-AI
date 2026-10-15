# BlueGuardian AI

BlueGuardian is a local-first Bluetooth security assessment web app with an owner recovery workflow. It combines browser-supported device selection, explainable development risk assessments, browser-local device/action history, and a MongoDB-backed owner recovery API.

## What the web app currently does

- **Dashboard and Devices:** shows known device records, trust posture, risk assessments and browser activity.
- **Bluetooth selection:** in real mode, Web Bluetooth opens the browser's chooser for one supported device and inspects GATT information the user has permission to access. It does not passively scan every nearby device.
- **Simulation mode:** generates demo device records so the UI and assessment workflow can be explored without a nearby Bluetooth device. Demo records/events must remain marked as simulated.
- **Threat Detection:** presents explainable deterministic development assessments and supports investigate, resolve, dismiss and reopen workflows.
- **Local security actions:** trust, mark unknown, block, unblock and forget update BlueGuardian's local state. They do not enforce an OS-level Bluetooth firewall or guarantee that the operating system disconnects a device.
- **Activity and Analytics:** records browser-local scans, observations, assessment events, user actions and threat-status changes. Local data persists in IndexedDB in that browser profile.
- **Device Recovery:** uses an authenticated backend API for owner-scoped registrations, encounter history and lifecycle transitions. When OIDC is configured, the recovery page uses authorization code with PKCE and the backend verifies the signed access token.

## Important current limitations

- The current threat assessment engine is a **development heuristic**, not a trained and accuracy-validated ML model.
- Web Bluetooth is user-mediated and browser-limited. It does not provide universal passive scanning, reliable background discovery or OS-level Bluetooth blocking.
- Browser-local device/threat/action data is not synchronized across accounts or browsers.
- Recovery's browser observation is manually selected by the owner. It is not a community sighting.
- Community participant reporting, server-side community matching and owner notification delivery are not implemented yet.
- Production recovery remains fail-closed until the OIDC values are configured in the frontend and backend. Do not place a static owner token in a frontend build.

## Run the frontend locally

Use Node 24, as pinned in [.nvmrc](.nvmrc).

```bash
npm ci
npm test
npm run build
npm run dev
```

Open the Vite URL printed in the terminal, normally `http://localhost:5173`.

For a no-hardware walkthrough, open **Devices**, enable **Simulation mode**, then run a simulation scan. For supported hardware testing, disable simulation mode and choose **Select Bluetooth device**. The real-device flow depends on browser support, Bluetooth permissions and device GATT capabilities.

## Run the backend locally

Use a separate terminal:

```bash
cd backend
npm ci
```

Copy `backend/.env.example` to `backend/.env`, then set a working `MONGODB_URI` and a long random development owner token. Start MongoDB locally first, or configure a valid MongoDB Atlas URI with correct credentials and network access.

```bash
npm run dev
```

The Vite development proxy forwards `/api` to `http://localhost:4000`. The **Device Recovery** page then uses the development owner token. It is kept in page memory only.

## Production OIDC configuration

Configure these values in the hosting environments, not in committed source files.

**Frontend build environment** (for example, Vercel):
- `VITE_API_BASE`: full backend API base URL, including `/api`.
- `VITE_OIDC_ISSUER`: the exact issuer identifier from the identity provider's discovery metadata.
- `VITE_OIDC_CLIENT_ID`: a public SPA client ID configured for Authorization Code + PKCE (S256).
- `VITE_OIDC_AUDIENCE`: the API audience that the identity provider must put in the access token.
- `VITE_OIDC_REDIRECT_URI`: the exact deployed URL ending in `/recovery), registered as a callback URI.
- `VITE_OIDC_SCOPES`: provider-supported scopes required by the app and API.

**Backend service environment** (for example, Render):
- `MONGODB_URI`: database connection URI.
- `BLUEGUARDIAN_CORS_ORIGINS`: comma-separated exact frontend origins, without path segments.
- `BLUEGUARDIAN_OIDC_ISSUER`: same issuer as the frontend setting.
- `BLUEGUARDIAN_OIDC_AUDIENCE`: expected API audience.
- `BLUEGUARDIAN_OIDC_JWKS_URI`: trusted provider JWKS endpoint using HTTPS.

The backend accepts only RS256 or ES256 access-token signatures, validates issuer, audience, expiry and subject, and scopes recovery records to the verified subject. The provider must actually issue access tokens with the configured API audience. If OIDC configuration is absent or signing-key verification is unavailable, production protected routes reject requests. A static development token is not production identity.

No live identity provider, domain, CORS origin or production secret is configured by these example files. Complete the settings in a staging deployment and verify the flow before promoting changes.

## Validate the repository

```bash
npm test
npm run build
cd backend
npm test
npm run build
```

The GitHub Actions workflow runs frontend and backend tests/builds on the research branch without a deployment step. Four guarded live-Mongo integration tests are skipped in normal CI because they require a dedicated disposable `blueguardian_test` database. Never run the destructive integration suite against production or shared data.

## Repository layout

- `src/pages/`: web application screens.
- `src/context/`: browser-local device, threat and security-action state.
- `src/services/localDatabase.ts`: IndexedDB persistence.
- `src/services/oidcClient.ts`: browser OIDC Authorization Code + PKCE client.
- `backend/src/`: Express API, authentication and recovery data access.
- `android/`: a separate native prototype; the web workflow does not depend on it yet.
- `docs/WEB_WORKFLOW.md`: detailed web workflow and acceptance checklist.
- `docs/ORIGINAL_VISION_ROADMAP.md`: original vision gaps and release gates.
