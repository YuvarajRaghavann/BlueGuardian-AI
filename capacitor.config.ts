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
  // Dark background while the web app loads, so there is no white flash after the splash.
  backgroundColor: '#0e1424',
  android: {
    allowMixedContent: false,
  },
};

export default config;
