# Feature Map — where to find each feature

Find the feature, then open the file for the layer you need: what you **see**, the **logic**, or the **Android / server** code. Paths are from the repository root. For how each part works, see the [Technical Guide](TECHNICAL_GUIDE.md).

> **Tip:** text you see on a screen can usually be found with GitHub search (press `/` in the repository) or `git grep "exact words"`. That lands you in the screen file; its imports lead to the logic.

## App shell and navigation

| Feature | Screen | Logic and state | Android / server |
| --- | --- | --- | --- |
| Bottom tabs, header, More menu | [`src/layouts/DashboardLayout.tsx`](../../src/layouts/DashboardLayout.tsx) | [`src/App.tsx`](../../src/App.tsx) (routes) | — |
| Android Back button | [`src/components/AndroidBackNavigation.tsx`](../../src/components/AndroidBackNavigation.tsx) | [`src/ui/backStack.ts`](../../src/ui/backStack.ts) | [`native/android/MainActivity.java`](../../native/android/MainActivity.java) |
| Launch splash | [`src/components/LaunchSplash.tsx`](../../src/components/LaunchSplash.tsx) | — | `native/android/res/drawable-*/splash_logo.png` |
| Welcome, permissions, first sign-in | [`src/pages/Welcome.tsx`](../../src/pages/Welcome.tsx) | [`src/services/accountSession.ts`](../../src/services/accountSession.ts) | `BlueGuardianDevicesPlugin.java` (`requestBluetooth`, `requestLocation`) |
| Design kit, colours, fonts | [`src/ui/kit.tsx`](../../src/ui/kit.tsx), [`src/index.css`](../../src/index.css) | — | — |
| Logo and app icons | [`src/ui/Logo.tsx`](../../src/ui/Logo.tsx) | [`branding/render_icons.py`](../../branding/render_icons.py) | `native/android/res/` |

## Nearby devices and safety

| Feature | Screen | Logic and state | Android / server |
| --- | --- | --- | --- |
| Home summary and radar | [`src/pages/Dashboard.tsx`](../../src/pages/Dashboard.tsx), [`src/ui/Radar.tsx`](../../src/ui/Radar.tsx) | [`src/utils/aroundNow.ts`](../../src/utils/aroundNow.ts) | — |
| Around tab (list, filters) | [`src/pages/AroundYou.tsx`](../../src/pages/AroundYou.tsx), [`src/components/DeviceCard.tsx`](../../src/components/DeviceCard.tsx) | [`src/context/DeviceContext.tsx`](../../src/context/DeviceContext.tsx) (`scanCombinedDevices`) | [`BlueGuardianBluetoothPlugin.java`](../../native/android/BlueGuardianBluetoothPlugin.java) |
| BLE scan / classic discovery | — | [`src/services/nativeBluetoothService.ts`](../../src/services/nativeBluetoothService.ts) | `BlueGuardianBluetoothPlugin.java` (`startBleScan`, `startClassicDiscovery`) |
| Paired and connected list | — | [`src/services/myDevices.ts`](../../src/services/myDevices.ts) (`listKnownDevices`) | [`BlueGuardianDevicesPlugin.java`](../../native/android/BlueGuardianDevicesPlugin.java) |
| Browser (Web Bluetooth) mode | — | [`src/services/bluetoothService.ts`](../../src/services/bluetoothService.ts) | — |
| Device detail sheet | [`src/components/DeviceDetailModal.tsx`](../../src/components/DeviceDetailModal.tsx) | [`src/context/SecurityContext.tsx`](../../src/context/SecurityContext.tsx) (trust, block, forget) | `/api/devices`, `/api/actions` |
| Guardian verdict | [`src/components/GuardianPanel.tsx`](../../src/components/GuardianPanel.tsx) | [`src/intel/guardian.ts`](../../src/intel/guardian.ts), [`guardianStore.ts`](../../src/intel/guardianStore.ts), [`advert.ts`](../../src/intel/advert.ts) | — |
| Maker, service and appearance databases | — | [`src/intel/data/`](../../src/intel/data) | — |
| Deep check (no pairing) | [`src/components/GuardianPanel.tsx`](../../src/components/GuardianPanel.tsx) | [`src/intel/guardianStore.ts`](../../src/intel/guardianStore.ts) | `BlueGuardianDevicesPlugin.java` (`inspectGatt`) |
| Trust score and history | [`src/ui/TrustDial.tsx`](../../src/ui/TrustDial.tsx), [`src/ui/TrustHistory.tsx`](../../src/ui/TrustHistory.tsx) | [`src/intel/engine.ts`](../../src/intel/engine.ts) (`TRUST`) | — |
| Distance estimate | [`src/components/DeviceCard.tsx`](../../src/components/DeviceCard.tsx) | [`src/intel/distance.ts`](../../src/intel/distance.ts) | — |
| Alerts (trackers, popup spam, look-alikes) | [`src/pages/Threats.tsx`](../../src/pages/Threats.tsx), [`src/components/ThreatDetailModal.tsx`](../../src/components/ThreatDetailModal.tsx) | [`src/intel/engine.ts`](../../src/intel/engine.ts), [`src/context/ThreatContext.tsx`](../../src/context/ThreatContext.tsx) | `/api/threats` |
| Insights | [`src/pages/Analytics.tsx`](../../src/pages/Analytics.tsx) | [`src/intel/engine.ts`](../../src/intel/engine.ts) | — |
| Device risk model (development) | — | [`src/ml/`](../../src/ml) | [`ml-training/`](../../ml-training) |

## Connecting

| Feature | Screen | Logic and state | Android / server |
| --- | --- | --- | --- |
| Pair and connect | [`src/components/NativeConnectPanel.tsx`](../../src/components/NativeConnectPanel.tsx) | [`src/services/myDevices.ts`](../../src/services/myDevices.ts) (`connect`) | `BlueGuardianDevicesPlugin.java` (`connect`) |
| Live connect / disconnect / pairing status | every device list | `DeviceContext.tsx` (`SET_LINK_STATE`) | `BlueGuardianDevicesPlugin.java` (`presence`, `bond` events) |
| Connection approval policy | [`src/pages/Settings.tsx`](../../src/pages/Settings.tsx) | [`src/utils/connectionPolicy.ts`](../../src/utils/connectionPolicy.ts) | — |

## Find and recover

| Feature | Screen | Logic and state | Android / server |
| --- | --- | --- | --- |
| Find tab, last-seen place | [`src/pages/Recovery.tsx`](../../src/pages/Recovery.tsx) | [`src/services/myDevices.ts`](../../src/services/myDevices.ts) | [`BlueGuardianPresenceReceiver.java`](../../native/android/BlueGuardianPresenceReceiver.java) |
| Find it (signal meter, beep) | `Recovery.tsx` (`FindItSheet`) | `myDevices.ts` (`proximityBand`) | `BlueGuardianDevicesPlugin.java` (`startProximity`) |
| Share location, open map | `Recovery.tsx` | `myDevices.ts` (`buildShareText`) | `BlueGuardianDevicesPlugin.java` (`share`, `openMap`) |
| Community: report, cases, sightings, help others | [`src/pages/RecoveryCloud.tsx`](../../src/pages/RecoveryCloud.tsx) | [`src/services/api.ts`](../../src/services/api.ts) (`api.recovery`) | [`backend/src/routes/recovery.ts`](../../backend/src/routes/recovery.ts) |
| Fingerprint hashing and validation | — | — | [`backend/src/services/recoveryService.ts`](../../backend/src/services/recoveryService.ts) |
| Lost devices and sightings data | — | — | [`backend/src/models/Device.ts`](../../backend/src/models/Device.ts), [`RecoveryEncounter.ts`](../../backend/src/models/RecoveryEncounter.ts) |

## Secure Share

| Feature | Screen | Logic and state | Android / server |
| --- | --- | --- | --- |
| Secure Share screen | [`src/pages/SecureShare.tsx`](../../src/pages/SecureShare.tsx) | [`src/context/SecureLinkContext.tsx`](../../src/context/SecureLinkContext.tsx) | [`BlueGuardianSecureLinkPlugin.java`](../../native/android/BlueGuardianSecureLinkPlugin.java) |
| Handshake and encryption | — | [`src/secure/noise.ts`](../../src/secure/noise.ts), [`src/secure/crypto/`](../../src/secure/crypto) | — |
| Wire protocol | — | [`src/secure/protocol.ts`](../../src/secure/protocol.ts) | — |
| Transfers, resume, quarantine checks | `SecureShare.tsx` | [`src/secure/session.ts`](../../src/secure/session.ts), [`fileTypes.ts`](../../src/secure/fileTypes.ts) | `BlueGuardianSecureLinkPlugin.java` (`quarantine*`) |
| Continuous link trust (BTGuard) | Secure Share → Details | [`src/secure/trustEngine.ts`](../../src/secure/trustEngine.ts), [`trustModel.json`](../../src/secure/trustModel.json) | [`btguard/`](../../btguard) (reference + training) |
| Paired phones and security log | Secure Share → Details | [`src/secure/peerStore.ts`](../../src/secure/peerStore.ts), [`forensicLog.ts`](../../src/secure/forensicLog.ts) | Android Keystore (`wrapSecret`) |

## Account, settings and data

| Feature | Screen | Logic and state | Android / server |
| --- | --- | --- | --- |
| Account and sign-in | `RecoveryCloud.tsx`, `Welcome.tsx` | [`src/services/firebaseAuth.ts`](../../src/services/firebaseAuth.ts), [`accountSession.ts`](../../src/services/accountSession.ts) | [`backend/src/auth.ts`](../../backend/src/auth.ts) |
| Settings, permissions, server address | [`src/pages/Settings.tsx`](../../src/pages/Settings.tsx), [`src/components/SettingsExtras.tsx`](../../src/components/SettingsExtras.tsx) | [`src/services/apiBase.ts`](../../src/services/apiBase.ts), [`localSettings.ts`](../../src/services/localSettings.ts) | `/api/health` |
| Activity | [`src/pages/Events.tsx`](../../src/pages/Events.tsx), [`SecurityTimeline.tsx`](../../src/components/SecurityTimeline.tsx), [`SecurityAuditLog.tsx`](../../src/components/SecurityAuditLog.tsx) | [`src/context/SecurityContext.tsx`](../../src/context/SecurityContext.tsx) | `/api/events`, `/api/actions` |
| On-phone storage | — | [`src/services/localDatabase.ts`](../../src/services/localDatabase.ts), [`src/intel/persist.ts`](../../src/intel/persist.ts) | — |
| Server app and routes | — | — | [`backend/src/app.ts`](../../backend/src/app.ts), [`backend/src/routes/`](../../backend/src/routes) |

## Build and release

| Feature | Where |
| --- | --- |
| Android permissions, manifest, plugin install | [`scripts/prepare-capacitor-ci.mjs`](../../scripts/prepare-capacitor-ci.mjs) |
| APK build and tests (CI) | [`.github/workflows/build-android-shell.yml`](../../.github/workflows/build-android-shell.yml) |
| Capacitor app id and name | [`capacitor.config.ts`](../../capacitor.config.ts) |
| Server deployment | [`render.yaml`](../../render.yaml) |
| Release-only build flags | [`src/config/buildFlags.ts`](../../src/config/buildFlags.ts) |
