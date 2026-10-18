# BlueGuardian

BlueGuardian is a local-first Bluetooth security monitoring dashboard for evaluating nearby devices, tracking trust posture, and surfacing suspicious or high-risk connections.

## What it includes

- Device discovery and trust scoring
- Threat analysis and security event timeline
- Local persistence using IndexedDB
- Security policy controls
- ML-driven classification placeholder layer for future model integration
- **Secure Share (Phase 7):** phone-to-phone encrypted link over Bluetooth LE L2CAP. It pairs with a Noise XX handshake and a 6-digit comparison code, scores trust continuously with BTGuard (FULL / RESTRICTED / ISOLATED), rotates keys and runs automated recovery, and moves files into a quarantine. See [docs/SECURE_LINK.md](docs/SECURE_LINK.md)
- Release hardening: backend host allowlist, sample data compiled out of release builds, no backups, cleartext disabled, optional certificate pinning and a signed release APK

## Get the APK

Push this source to a branch named `android/phase7-<anything>`. GitHub Actions then builds and uploads `blueguardian-android-debug-<sha>`, which contains `app-debug.apk`. If signing secrets are configured, it also uploads a signed release APK.

## Prerequisites

Use Node 24 for consistent local execution.

```bash
nvm install 24
nvm use 24
```

The repository also includes a pinned runtime file at [.nvmrc](.nvmrc).

## Run locally

```bash
npm install
npm run test
npm run build
npm run dev
```

## Validation flow

This project is configured to validate with the currently installed Node 24 runtime.

```bash
bash .run-local-first-validation.sh
```

That script runs the test suite and production build together to catch regressions before shipping.

## Project layout

- `src/` — React app and device/threat/security logic
- `src/services/` — local persistence and security helpers
- `src/context/` — app-wide state management
- `src/utils/` — scoring and detection logic
- `backend/` — backend service scaffolding
- `android/` — Android project scaffolding
