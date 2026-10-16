# Phase 4: Classic Bluetooth Discovery

Date: 2026-10-16

## Workflow checkpoint

This branch starts from Phase 3 repaired source commit `590fce85187545fd114d12d07e8c8960efd4332a`. The Phase 3 CI build passed the Vite production build, the existing frontend regression tests, Android Capacitor sync, and Android debug APK compilation. This Phase 4 branch is isolated from `main` and production.

## Included in Phase 4

- Native classic Bluetooth discovery via Android `BluetoothAdapter.startDiscovery()`.
- Broadcast handling for discovery-started, device-found, and discovery-finished events.
- A bounded foreground discovery window, explicit stop, permission/state errors, and lifecycle cleanup.
- Runtime permission handling for Android 12+ Nearby Devices permissions and legacy location permission where required for discovery.
- Separate listing of devices in Android's bonded/paired device registry.
- A distinct classic-discovery results dialog with real names when Android provides them, address, RSSI when provided, paired flag, scan status, and honest empty/error messaging.
- Integration into the existing device state, security assessment, and local persistence path.
- Separate provenance values for BLE, live classic discovery, and the system paired inventory.
- Classic scanning is not combined with BLE in this phase. Combined scan behavior remains Phase 5.

## Semantics and safety

- Discovery does not establish a Bluetooth connection.
- A device returned by Android's paired registry is not automatically trusted by BlueGuardian.
- Paired state does not prove that the device is currently connected or nearby.
- Classic discovery only returns devices that are discoverable/respond to inquiry during the scan. BLE-only advertisers may not appear.
- The plugin refuses to cancel a different app's already-running classic discovery session.
- Scanning is foreground-only. No background scanning, foreground service, persistent notification, pairing mutation, or native GATT connection was added in Phase 4.
- The original BLE result path remains separate and the existing web app remains the fallback.

## Validation gate

CI must pass:
1. Vite/TypeScript production build.
2. Existing frontend regression tests.
3. Capacitor sync and native plugin copy.
4. Android debug APK compilation for API 36.

After the APK exists, physical-device acceptance should confirm:
1. The classic scan opens its own dialog and stops after the scan window.
2. A test device in classic discoverable/pairing mode is listed with only the fields Android reports.
3. BLE-only devices are not falsely represented as classic discoveries.
4. Android's paired-device registry loads in a separate view.
5. Permission denial, Bluetooth-off, empty results, and an existing discovery session report clear outcomes.
6. Discovered/paired devices remain marked unconnected unless a later approved phase implements and verifies connection handling.

Passing CI proves build integration, not real-radio hardware behavior. Phase 5 should not begin until Phase 4's source/build acceptance passes and the classic discovery behavior has been reviewed.
