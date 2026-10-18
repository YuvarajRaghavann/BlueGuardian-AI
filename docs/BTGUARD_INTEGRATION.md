# BTGuard implementation and deployment plan

## Delivered in this branch
- Evidence-fusion policy engine and stateful per-device trust registry.
- Explainable FULL / RESTRICTED / ISOLATED recommendations.
- Security-assessment integration and a dedicated BTGuard page in app navigation.
- Unit tests for owner blocks, telemetry gaps, reported weak cryptographic state, stable repeated observations, and faster trust reduction than recovery.
- Optional typed telemetry inputs for encryption/authentication/key size, Channel Sounding distance, RSSI, CFO, packet rate, pairing attempts, error rate and packet timing jitter.

## Trust fusion and policy
BTGuard starts from owner trust and available device-health observations. It lowers trust on adverse connection evidence, cryptographic state explicitly reported as weak, and configured behaviour-counter thresholds. An absent field remains unknown; it is not treated as proof of attack and is never silently synthesized.

FULL recommends the broad app capability set; RESTRICTED recommends limited capabilities; ISOLATED recommends none, especially when owner-blocked. These recommendations become enforcement only when the connection/action layer checks them before every privileged operation.

## Hardware and firmware integration
A compatible native adapter should publish timestamped, device-bound observations with provenance, validity and hardware-support metadata. Do not infer secure pairing or encryption from discovery or a successful GATT connection. Do not compare raw RSSI with Channel Sounding using an uncalibrated universal formula. Calibrate per antenna, enclosure, environment and device class.

For Channel Sounding-capable hardware, implement distance verification in firmware/controller integration, reject stale or incomplete exchanges, bind ranging sessions to authenticated peer/session state, and evaluate relay/replay scenarios in a controlled RF lab. Availability and security behavior depend on controller, stack, firmware and peer support.

Secure boot, signed firmware, hardware-backed key storage, secure key rotation and bond lifecycle control belong in firmware/native stack or managed-device integration. A regular Android app cannot promise these capabilities through the public discovery API.

## ML lifecycle
The current TypeScript engine is a deterministic policy/heuristic layer, not a trained TinyML model. Build production ML from a labelled lab dataset with device-family splits, held-out attack sessions, reproducible feature extraction, calibration, false-positive reporting and model-version metadata. Start with an interpretable Decision Tree or Random Forest baseline; export to TFLite Micro only after target-device latency/RAM/flash measurements.

Avoid duplicated sessions across train and test. Report macro-F1, per-class recall, false-positive rate, detection latency, CPU/RAM/flash footprint and battery impact. Tune thresholds to the launch domain.

## Recovery and response
1. Confirm owner identity through an independent authenticated channel.
2. Mark the lost device as actively sought and record time/source/provenance of sightings.
3. Validate sightings with an enrolled device identity and freshness checks.
4. Ask for owner confirmation before changing trust or bond state.
5. Revoke app-level trust and clear app-managed authorization when the owner confirms loss or compromise.
6. Use supported native APIs or system settings for bond removal and re-pairing; do not claim silent controller key rotation.
7. Keep an append-only local audit record of sightings, trust changes, approvals and recovery actions.

Community reports should be opt-in, minimize location data, authenticate reporters, rate-limit submissions, and avoid exposing owner identity or exact location to other users.

## Federated learning and privacy
Federated learning is a future extension, not part of the current runtime. Before adding it, define consent, client eligibility, secure aggregation, model-poisoning defenses, minimum cohort size, update signing, rollback and privacy review. Never upload raw Bluetooth traffic by default.

## Validation checklist
- Run npm ci, npm test, npm run build and npm run lint on the feature branch.
- Test real Android scanning on supported phones and ensure simulated devices never enter security claims.
- Test missing, stale, malformed and conflicting telemetry.
- Exercise trust drops and recovery across multiple observations.
- Verify every privileged app operation enforces BTGuard policy at the action boundary.
- Validate native BLE bridge, permission denial, adapter-off state and lifecycle cleanup.
- Evaluate attack scenarios only on team-owned devices in a controlled lab.
