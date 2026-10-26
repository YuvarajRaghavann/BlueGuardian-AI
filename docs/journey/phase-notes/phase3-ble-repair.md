# Phase 3 BLE Discovery Repair

Date: 2026-10-16

## Source and artifact inspected

The uploaded ZIP contained only `android/app/build/outputs/apk/debug/app-debug.apk` and `android-build-info.txt`. The build manifest identified source commit `8a18bd4d93c488bd5bc2a1f73926b28ce845ee76`, Capacitor 8.4.0, and intended Android API 36. The APK itself contains the native `BlueGuardianBluetoothPlugin` class and web bundle.

This repair branch is based on that exact source commit; it does not replace the original web app or alter the production branch.

## Confirmed Phase 3 gaps

1. Android native BLE scanning used `BluetoothLeScanner` events and added observations to application state, but no native-specific result dialog was opened. The empty state incorrectly instructed Android users to select a device in Chrome's browser chooser. This made scan results difficult to understand and left no explicit dialog for the empty/error outcome.
2. The TypeScript service waited for `nativeBluetooth.startBleScan()` before starting its safety timeout. If the native call never settled during bridge/permission setup, the screen could remain in its scanning state indefinitely.
3. The native plugin in this artifact exposes scan start/stop and observation events only. It does not expose a `BluetoothGatt.connectGatt` connection method. Therefore Phase 3's APK can perform discovery, but cannot establish a native GATT connection just because an item was detected.

## Changes in this branch

- `src/services/nativeBluetoothService.ts`: added a 10-second timeout around native scan startup, with a diagnostic message, and reliably clears its timer.
- `src/components/NativeBleResultsModal.tsx`: added an accessible results dialog showing real observations, RSSI when provided, advertised service UUID count, scan status, and an explicit no-results/error state. Choosing a result opens the existing device details modal.
- `src/pages/Devices.tsx`: opens the native results dialog when Android scanning starts, streams current-scan observations into it, and corrects Android-specific empty-state instructions.
- `scripts/prepare-capacitor-ci.mjs`: labels build metadata as a Phase 3 discovery-repair build and states the feature scope accurately.

## Out of scope

This repair does not implement classic Bluetooth discovery, combined scans, native GATT connection/service/characteristic interaction, continuous/background scanning, or broad backend functionality. These remain separate workflow stages. No source changes have been made to the original `main` or production branch.

## Validation gate

The Android CI workflow runs the Vite/TypeScript production build, frontend tests, Capacitor sync, and Gradle debug APK build. Passing CI validates packaging and regressions, but cannot validate radio discovery on a physical phone. Phase 3 should only be marked hardware-verified after the repaired APK shows at least one known BLE advertiser and reports permission/error/empty outcomes accurately.
