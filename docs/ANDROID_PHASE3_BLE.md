# BlueGuardian Android Phase 3: Native BLE Discovery

## Scope
- Uses the existing React/Vite interface inside the Capacitor Android shell.
- Adds a local Capacitor Java plugin that calls Android's BluetoothLeScanner.
- Scans only in the foreground, for a bounded window (12 seconds by default).
- Uses the Nearby Devices permission on Android 12+ and the legacy location permission for BLE scan access on Android 6–11.
- Reports only actual Android scan observations: reported name when available, RSSI, address exposed by Android, advertised service UUIDs, timestamp and connectability when the Android API provides it.
- Keeps simulated examples separate from real device observations.
- Keeps the browser Web Bluetooth code path for normal web use.

## Not included yet
- Classic Bluetooth discovery.
- Combined BLE + classic discovery.
- GATT connection / service reads from the native scanner path.
- Background scanning or persistent monitoring.
- Interference with Android's normal system pairing / audio connection.

## Remote build workflow
The GitHub Actions workflow regenerates the Android project with Capacitor 8, applies API 36 and copies the committed plugin files into the generated project before running `assembleDebug`.

## Manual test checklist
1. Install the new debug APK on a physical Android 16 phone.
2. Open Devices and press **Scan nearby BLE devices**.
3. Grant Nearby Devices permission when Android prompts.
4. Check whether a known advertising BLE peripheral appears with an observed timestamp/RSSI where reported.
5. Turn Bluetooth off and repeat; BlueGuardian must show a clear error.
6. Deny permission and repeat; BlueGuardian must report the permission failure.
7. Run a simulated scan; the UI must label those records as simulated.
8. Confirm Chrome/web mode continues to use the original Web Bluetooth chooser.
9. Confirm the scan stops automatically or when the app is paused.
10. Do not treat a missing AirPods entry as proof of a scanner bug: AirPods may not advertise a name or usable data in the state being tested.
