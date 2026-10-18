# BTGuard integration

BTGuard is integrated as a conservative TypeScript trust-policy layer under `src/ml/btguard.ts`.

## What works in the current BlueGuardian environment
- Fuses owner trust/block state and connection-health observations.
- Accepts optional controller telemetry for Secure Connections, encryption, authentication, key size, Channel Sounding distance, RSSI, CFO, and link-behaviour counters.
- Maintains an in-memory per-device trust snapshot, decays trust faster than it recovers, and maps trust to FULL / RESTRICTED / ISOLATED capabilities.
- Does not re-score an identical device observation on repeated UI renders.
- Exposes explicit telemetry coverage and explanations so missing sensor inputs are visible.

## Integration boundary
The current Android plugin reports discovery observations (identity/name/RSSI/transport/time), not negotiated pairing security, Channel Sounding distance, CFO, or packet timing counters. These fields must be supplied by a compatible controller/firmware integration before those checks can run. Missing data is not treated as an attack and no Channel Sounding or cryptographic protection is claimed by this app-only layer.

This implementation does not itself revoke Android bonds, rotate Bluetooth controller keys, enforce GATT permissions, or perform out-of-band re-pairing. Those operations require privileged/native Bluetooth stack support and a real owner-verification flow. The capability list is an app policy recommendation and must be enforced by the relevant connection/action boundary before it is a security control.

## Validation
Run `npm test -- --run` and `npm run build`. The tests cover missing telemetry, capability restriction, owner blocks, weak reported cryptographic state, stable re-render handling, and asymmetric trust smoothing.
