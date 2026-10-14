# BlueGuardian

BlueGuardian is a local-first Bluetooth security monitoring dashboard for evaluating nearby devices, tracking trust posture, and surfacing suspicious or high-risk connections.

## What it includes

- Device discovery and trust scoring
- Threat analysis and security event timeline
- Local persistence using IndexedDB
- Security policy controls
- ML-driven classification placeholder layer for future model integration

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
