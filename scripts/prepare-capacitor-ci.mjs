import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const variablesPath = path.join(root, 'android', 'variables.gradle');
const appGradlePath = path.join(root, 'android', 'app', 'build.gradle');
const gradleKtsPath = path.join(root, 'android', 'app', 'build.gradle.kts');
const buildInfoPath = path.join(root, 'android-build-info.txt');

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
  'BlueGuardian Phase 2 Capacitor shell build',
  `Commit: ${process.env.GITHUB_SHA ?? 'local'}`,
  `Node: ${process.version}`,
  `Capacitor core: ${capacitorCore.version}`,
  `Capacitor Android: ${capacitorAndroid.version}`,
  `Capacitor CLI: ${cli.version}`,
  'Android compile/target SDK intended: 36 / 36',
  'Scope: React/Vite web UI shell only; native BLE/classic scanner integration is a later phase.',
  ...notes,
  '',
].join('\n');
fs.writeFileSync(buildInfoPath, manifest);
console.log(manifest);
