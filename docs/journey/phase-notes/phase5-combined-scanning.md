# Phase 5: Combined BLE and Classic Bluetooth Discovery

Date: 2026-10-16

## Branch and scope

This work is isolated on \`android/phase5-combined-scanning-20261016\`, branched from the repaired Phase 4 source. The existing \`main\` and production branches are not modified.

Phase 5 provides a single Android action and results view that runs:

1. A bounded foreground BLE advertisement scan.
2. A bounded foreground classic Bluetooth inquiry after the BLE pass finishes.
3. A combined result list with provenance labels and best-effort deduplication using normalized Android-reported addresses.

The two transports intentionally run sequentially. This avoids overlapping runtime-permission prompts and avoids asking Android's adapter to start classic inquiry while another classic discovery session is active. It is one combined user workflow, not simultaneous radio scanning.

## Implementation

- Added \`scanCombinedDevices\` to the existing device context, with BLE and classic errors handled independently.
- Added the Phase 5 combined scan action on the existing Devices page; the existing BLE, classic-only, paired-device, and simulated-data actions remain separate.
- Added \`NativeCombinedResultsModal\` to show current transport stage, unique results, device provenance, signal strength when Android reports it, and explicit failures.
- Added \`discoveryTransports\` so the same combined record can show BLE, CLASSIC, or BLE + CLASSIC.
- Combined records use a namespaced identity based on the normalized Android-reported address. Reducer merging preserves both transports without creating a second card.
- Added regression coverage that adds two observations with the same combined identity and asserts a single record with both transports.
- Updated CI branch filters and build metadata for Phase 5.

## Semantics and limitations

- Address-based deduplication works only when Android reports a matching identity. BLE privacy/random addresses may differ from a classic address, so a physical device can still produce separate records.
- The scans run in the foreground only. This phase adds no background service or persistent notification.
- Discovery does not connect to a device, verify GATT services beyond advertised BLE service UUIDs, pair a device, or grant BlueGuardian trust.
- Paired-device inventory remains a separate system view, not proof of live connection or proximity.
- Demo/simulated records remain separate from actual observations.
- The two scan windows are bounded; a combined action usually takes longer than one individual scan.

## CI acceptance gate

1. TypeScript and Vite production build pass.
2. Existing frontend regression tests, including the combined-source deduplication case, pass.
3. Capacitor project generation and native plugin copy pass.
4. Android debug APK compiles with Android API 36.
5. The APK and build manifest are uploaded as CI artifacts.

## Physical-device acceptance gate

After installing the Phase 5 APK on the target Android handset, confirm:

1. Tapping Combined scan opens one results dialog and visibly progresses from BLE to classic.
2. Real BLE advertisements appear with BLE provenance.
3. A discoverable classic device can appear with CLASSIC provenance.
4. If both callbacks report the same address, they merge into one card with BLE + CLASSIC provenance.
5. If a scan transport fails, the other pass still runs and the UI reports a partial outcome rather than claiming both succeeded.
6. A completed scan with zero results remains distinct from a startup error.
7. Detection and pairing never imply an active BlueGuardian connection or trusted status.

Passing CI proves build integration and reducer logic, not physical radio behavior. Phase 4's repair should still be checked on the user's handset, because a cloud build cannot validate the handset's Bluetooth service, permission state, or discoverability conditions.
