import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const variablesPath = path.join(root, 'android', 'variables.gradle');
const appGradlePath = path.join(root, 'android', 'app', 'build.gradle');
const gradleKtsPath = path.join(root, 'android', 'app', 'build.gradle.kts');
const buildInfoPath = path.join(root, 'android-build-info.txt');

const nativeSourceDir = path.join(root, 'native', 'android');
const androidManifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const nativePackageDir = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'blueguardian', 'hybrid');

function setGradleValue(text, key, value) {
  // Capacitor Android templates commonly declare SDK values in variables.gradle.
  const patterns = [
    new RegExp(`(${key}\\s*=\\s*)\\d+`, 'g'),
    new RegExp(`(${key}\\s+)(\\d+)`, 'g'),
  ];
  let next = text;
  let changed = false;
  for (const pattern of patterns) {
    if (pattern.test(next)) {
      next = next.replace(pattern, (_whole, prefix) => `${prefix}${value}`);
      changed = true;
      break;
    }
  }
  return { text: next, changed };
}

if (!fs.existsSync(path.join(root, 'android', 'app'))) {
  throw new Error('Capacitor Android platform is missing. Run `npx cap add android` before this script.');
}

function installNativeBluetoothPlugin() {
  const pluginSource = path.join(nativeSourceDir, 'BlueGuardianBluetoothPlugin.java');
  const activitySource = path.join(nativeSourceDir, 'MainActivity.java');
  if (!fs.existsSync(pluginSource) || !fs.existsSync(activitySource)) {
    throw new Error('Native Bluetooth source files are missing from native/android.');
  }
  if (!fs.existsSync(androidManifestPath)) {
    throw new Error('Generated AndroidManifest.xml was not found.');
  }

  fs.mkdirSync(nativePackageDir, { recursive: true });
  fs.copyFileSync(pluginSource, path.join(nativePackageDir, 'BlueGuardianBluetoothPlugin.java'));
  fs.copyFileSync(activitySource, path.join(nativePackageDir, 'MainActivity.java'));

  let xml = fs.readFileSync(androidManifestPath, 'utf8');
  // Android's classic BluetoothAdapter.startDiscovery() permission contract
  // includes location unless BLUETOOTH_SCAN is explicitly marked neverForLocation.
  // This project avoids that flag because it can filter some Bluetooth advertisers.
  // Request location only when the user explicitly starts classic discovery; no
  // GPS coordinates are collected by this Bluetooth-discovery feature.
  xml = xml.split('\n').map((line) => {
    const isLocationPermission =
      line.includes('android:name="android.permission.ACCESS_COARSE_LOCATION"')
      || line.includes('android:name="android.permission.ACCESS_FINE_LOCATION"');
    return isLocationPermission
      ? line.replace(/\s+android:maxSdkVersion="30"/g, '')
      : line;
  }).join('\n');

  const requiredEntries = [
    '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
    '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
    '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    '<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />',
    '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
    '<uses-feature android:name="android.hardware.bluetooth" android:required="false" />',
    '<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />',
  ];

  const missingEntries = requiredEntries.filter((entry) => {
    const nameMatch = entry.match(/android:name="([^"]+)"/);
    return nameMatch ? !xml.includes('android:name="' + nameMatch[1] + '"') : true;
  });
  if (missingEntries.length > 0) {
    const applicationIndex = xml.indexOf('<application');
    if (applicationIndex < 0) {
      throw new Error('Cannot safely add Bluetooth declarations: <application> tag is missing.');
    }
    xml = xml.slice(0, applicationIndex) + '    ' + missingEntries.join('\n    ') + '\n    ' + xml.slice(applicationIndex);
  }

  if (!xml.includes('<application')) {
    throw new Error('Cannot safely add Bluetooth declarations: <application> tag is missing.');
  }
  fs.writeFileSync(androidManifestPath, xml);

  return 'Native foreground BLE and classic Bluetooth discovery plugin installed; Android permissions and optional Bluetooth hardware features configured. Classic discovery requests Nearby Devices plus location permission as required by Android; GPS coordinates are not collected by this feature.';
}
const nativePluginNote = installNativeBluetoothPlugin();

let notes = [];
if (fs.existsSync(variablesPath)) {
  let content = fs.readFileSync(variablesPath, 'utf8');
  for (const [key, value] of [['compileSdkVersion', 36], ['targetSdkVersion', 36]]) {
    const result = setGradleValue(content, key, value);
    content = result.text;
    notes.push(`${key}: ${result.changed ? `set to ${value}` : 'not found in variables.gradle; checking generated Gradle configuration'}`);
  }
  fs.writeFileSync(variablesPath, content);
}

// Some Android plugin templates declare SDK values directly in app/build.gradle.
for (const gradlePath of [appGradlePath, gradleKtsPath]) {
  if (!fs.existsSync(gradlePath)) continue;
  let content = fs.readFileSync(gradlePath, 'utf8');
  for (const [key, value] of [['compileSdk', 36], ['targetSdk', 36]]) {
    const result = setGradleValue(content, key, value);
    content = result.text;
    notes.push(`${path.relative(root, gradlePath)} ${key}: ${result.changed ? `set to ${value}` : 'uses shared or alternative configuration'}`);
  }
  fs.writeFileSync(gradlePath, content);
}

const capacitorCore = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@capacitor', 'core', 'package.json'), 'utf8'));
const capacitorAndroid = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@capacitor', 'android', 'package.json'), 'utf8'));
const cli = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@capacitor', 'cli', 'package.json'), 'utf8'));
const manifest = [
  'BlueGuardian Phase 6 backend integration build',
  `Commit: ${process.env.GITHUB_SHA ?? 'local'}`,
  `Node: ${process.version}`,
  `Capacitor core: ${capacitorCore.version}`,
  `Capacitor Android: ${capacitorAndroid.version}`,
  `Capacitor CLI: ${cli.version}`,
  'Android compile/target SDK intended: 36 / 36',
  'Scope: React/Vite UI, Firebase email/password sign-in, memory-only Firebase ID/refresh-token handling, native foreground BLE/classic/combined discovery, native Android recovery device selection, runtime-configurable HTTPS backend endpoint in Settings, owner-scoped backend devices/threats/actions/events/recovery calls, and backend/frontend/Android CI validation. The backend is not packaged inside the APK; deploy the Phase 6 backend separately and configure its URL in Settings.',
  'Classic discovery requires Nearby Devices and Android location permission on supported OS versions; this feature does not collect GPS coordinates.',
  'Combined mode scans BLE first and then classic Bluetooth to avoid concurrent permission prompts and adapter discovery sessions. Device merging uses normalized Android-reported address when available; randomized BLE addresses may remain separate.',
  'The default Phase 6 backend URL is configured at build time as https://blueguardian-backend-phase6.onrender.com/api and can be overridden in Settings. The server CORS allowlist must include the Capacitor WebView origin https://localhost. No owner token or secret is baked into this APK.',
  nativePluginNote,
  ...notes,
  '',
].join('\n');
fs.writeFileSync(buildInfoPath, manifest);
console.log(manifest);
