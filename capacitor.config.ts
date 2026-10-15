import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Phase 2 build target: package the existing React/Vite interface as an Android app.
 * Native Bluetooth integration is intentionally a later phase; this shell build
 * verifies that the current web UI can be packaged without Android Studio on the PC.
 */
const config: CapacitorConfig = {
  appId: 'com.blueguardian.hybrid',
  appName: 'BlueGuardian',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
