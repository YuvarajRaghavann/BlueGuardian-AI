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
  const secureLinkSource = path.join(nativeSourceDir, 'BlueGuardianSecureLinkPlugin.java');
  const extraNativeSources = ['BlueGuardianDevicesPlugin.java', 'BlueGuardianPresenceReceiver.java'];
  for (const file of extraNativeSources) {
    if (!fs.existsSync(path.join(nativeSourceDir, file))) throw new Error(`Native source ${file} is missing from native/android.`);
  }
  const activitySource = path.join(nativeSourceDir, 'MainActivity.java');
  if (!fs.existsSync(pluginSource) || !fs.existsSync(activitySource) || !fs.existsSync(secureLinkSource)) {
    throw new Error('Native Bluetooth source files are missing from native/android.');
  }
  if (!fs.existsSync(androidManifestPath)) {
    throw new Error('Generated AndroidManifest.xml was not found.');
  }

  fs.mkdirSync(nativePackageDir, { recursive: true });
  fs.copyFileSync(pluginSource, path.join(nativePackageDir, 'BlueGuardianBluetoothPlugin.java'));
  fs.copyFileSync(activitySource, path.join(nativePackageDir, 'MainActivity.java'));
  fs.copyFileSync(secureLinkSource, path.join(nativePackageDir, 'BlueGuardianSecureLinkPlugin.java'));
  for (const file of extraNativeSources) fs.copyFileSync(path.join(nativeSourceDir, file), path.join(nativePackageDir, file));

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
    '<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />',
    '<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />',
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
  xml = hardenApplicationTag(xml);
  // Records connect/disconnect time (and place, when allowed) even when the app is closed.
  if (!xml.includes('BlueGuardianPresenceReceiver')) {
    const receiver = [
      '        <receiver android:name=".BlueGuardianPresenceReceiver" android:exported="true">',
      '            <intent-filter>',
      '                <action android:name="android.bluetooth.device.action.ACL_CONNECTED" />',
      '                <action android:name="android.bluetooth.device.action.ACL_DISCONNECTED" />',
      '            </intent-filter>',
      '        </receiver>',
    ].join('\n');
    xml = xml.replace('</application>', receiver + '\n    </application>');
  }
  fs.writeFileSync(androidManifestPath, xml);
  writeNetworkSecurityConfig();

  return 'Native foreground BLE and classic Bluetooth discovery plugin installed; Android permissions and optional Bluetooth hardware features configured. Classic discovery requests Nearby Devices plus location permission as required by Android; GPS coordinates are not collected by this feature.';
}
/**
 * Release hardening applied to every build:
 *  - android:allowBackup="false" so keys/peer records are never copied off the phone
 *  - a network security config that forbids cleartext and trusts only system CAs,
 *    with optional certificate pins (BACKEND_CERT_PINS="sha256/AAA...=,sha256/BBB...=")
 */
function hardenApplicationTag(xml) {
  const match = xml.match(/<application\b[^>]*>/);
  if (!match) throw new Error('Cannot harden manifest: <application> tag is missing.');
  let tag = match[0];
  const setAttr = (name, value) => {
    const re = new RegExp(`\\s${name}="[^"]*"`);
    tag = re.test(tag) ? tag.replace(re, ` ${name}="${value}"`) : tag.replace('<application', `<application ${name}="${value}"`);
  };
  setAttr('android:allowBackup', 'false');
  setAttr('android:usesCleartextTraffic', 'false');
  setAttr('android:networkSecurityConfig', '@xml/network_security_config');
  return xml.replace(match[0], tag);
}

function writeNetworkSecurityConfig() {
  const xmlDir = path.join(root, 'android', 'app', 'src', 'main', 'res', 'xml');
  fs.mkdirSync(xmlDir, { recursive: true });
  const backendHost = (() => {
    try {
      return new URL(process.env.VITE_API_BASE || 'https://blueguardian-backend-phase6.onrender.com/api').hostname;
    } catch {
      return '';
    }
  })();
  const pins = (process.env.BACKEND_CERT_PINS || '').split(',').map((p) => p.trim()).filter(Boolean);
  const pinBlock = pins.length && backendHost
    ? [
        '  <domain-config cleartextTrafficPermitted="false">',
        `    <domain includeSubdomains="false">${backendHost}</domain>`,
        '    <pin-set expiration="2027-12-31">',
        ...pins.map((p) => `      <pin digest="SHA-256">${p.replace(/^sha256\//, '')}</pin>`),
        '    </pin-set>',
        '  </domain-config>',
      ]
    : [];
  const config = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<network-security-config>',
    '  <base-config cleartextTrafficPermitted="false">',
    '    <trust-anchors>',
    '      <certificates src="system" />',
    '    </trust-anchors>',
    '  </base-config>',
    ...pinBlock,
    '</network-security-config>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), config);
  hardeningNotes.push(pins.length
    ? `Network security config: cleartext off, system CAs only, ${pins.length} certificate pin(s) for ${backendHost}.`
    : 'Network security config: cleartext off, system CAs only (set BACKEND_CERT_PINS to add certificate pinning).');
}

/**
 * Branding: BlueGuardian launcher icons (legacy + adaptive), splash screen and
 * colours, copied from native/android/res (rendered by branding/render_icons.py from branding/logo-source.png).
 */
function copyDir(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyDir(src, dst);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

function installBranding() {
  const brandRes = path.join(nativeSourceDir, 'res');
  const appRes = path.join(root, 'android', 'app', 'src', 'main', 'res');
  if (!fs.existsSync(brandRes) || !fs.existsSync(appRes)) return 'Branding: skipped (resources missing).';

  // Default Capacitor splash bitmaps would win over our drawable, so remove every variant first.
  const removed = [];
  for (const dir of fs.readdirSync(appRes)) {
    const candidate = path.join(appRes, dir, 'splash.png');
    if (dir.startsWith('drawable') && fs.existsSync(candidate)) {
      fs.rmSync(candidate);
      removed.push(dir);
    }
  }
  copyDir(brandRes, appRes);

  const write = (rel, text) => {
    const file = path.join(appRes, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write('drawable/splash.xml', [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<layer-list xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <item android:drawable="@color/bg_splash" />',
    '    <item><bitmap android:gravity="center" android:src="@drawable/splash_logo" /></item>',
    '</layer-list>',
    '',
  ].join('\n'));
  write('values/bg_brand_colors.xml', [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<resources>',
    '    <color name="bg_splash">#0E1424</color>',
    '</resources>',
    '',
  ].join('\n'));
  write('values/ic_launcher_background.xml', [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<resources>',
    '    <color name="ic_launcher_background">#0057E7</color>',
    '</resources>',
    '',
  ].join('\n'));
  const adaptive = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <background android:drawable="@mipmap/ic_launcher_background" />',
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />',
    '</adaptive-icon>',
    '',
  ].join('\n');
  write('mipmap-anydpi-v26/ic_launcher.xml', adaptive);
  write('mipmap-anydpi-v26/ic_launcher_round.xml', adaptive);
  return `Branding: launcher icons, adaptive icon and splash installed (replaced splash in ${removed.length} folder(s)).`;
}

const hardeningNotes = ['Manifest hardening: allowBackup=false, usesCleartextTraffic=false, network security config attached.'];
const nativePluginNote = installNativeBluetoothPlugin();
const brandingNote = installBranding();

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
  'BlueGuardian Phase 7 Secure Link build (BTGuard continuous trust binding)',
  `Commit: ${process.env.GITHUB_SHA ?? 'local'}`,
  `Node: ${process.version}`,
  `Capacitor core: ${capacitorCore.version}`,
  `Capacitor Android: ${capacitorAndroid.version}`,
  `Capacitor CLI: ${cli.version}`,
  'Android compile/target SDK intended: 36 / 36',
  'Scope: React/Vite UI, Firebase email/password sign-in, memory-only Firebase ID/refresh-token handling, native foreground BLE/classic/combined discovery, native Android recovery device selection, runtime-configurable HTTPS backend endpoint in Settings (defaulted to the dedicated Phase 6 Render backend; override if needed), owner-scoped backend devices/threats/actions/events/recovery calls, and backend/frontend/Android CI validation. The backend is deployed separately and is not packaged inside the APK.',
  'Classic discovery requires Nearby Devices and Android location permission on supported OS versions; this feature does not collect GPS coordinates.',
  'Combined mode scans BLE first and then classic Bluetooth to avoid concurrent permission prompts and adapter discovery sessions. Device merging uses normalized Android-reported address when available; randomized BLE addresses may remain separate.',
  'The default Phase 6 backend URL is configured at build time as https://blueguardian-backend-phase6.onrender.com/api and can be overridden in Settings. The server CORS allowlist must include the Capacitor WebView origin https://localhost. No owner token or secret is baked into this APK.',
  nativePluginNote,
  'Secure Link: BLE advertising + L2CAP CoC transport (Android 10+) with GATT transport fallback (Android 8+), Noise_XX_25519_ChaChaPoly_SHA256 channel with 6-digit comparison codes, BTGuard trust engine, encrypted file transfer into app-private quarantine, Android Keystore wrapping for identity and peer secrets.',
  ...hardeningNotes,
  brandingNote,
  ...notes,
  '',
].join('\n');
fs.writeFileSync(buildInfoPath, manifest);
console.log(manifest);
