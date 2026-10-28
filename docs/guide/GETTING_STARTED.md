# Getting Started

Everything you need to install, run, build and deploy BlueGuardian. For how it works inside, see the [Technical Guide](TECHNICAL_GUIDE.md).

- [Install the app on a phone](#install-the-app-on-a-phone)
- [Run the app locally](#run-the-app-locally)
- [Run the server locally](#run-the-server-locally)
- [Build the APK](#build-the-apk)
- [Deploy the server](#deploy-the-server)
- [Configuration reference](#configuration-reference)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

## Install the app on a phone

**Requirements:** Android 8 or newer (Secure Share works on Android 8+; Android 10+ phones use a faster channel).

1. Open the latest successful run of **[Build BlueGuardian Android Shell](https://github.com/YuvarajRaghavann/BlueGuardian-AI/actions/workflows/build-android-shell.yml)**.
2. Under **Artifacts**, download `blueguardian-android-debug-<commit>`.
3. Unzip it and copy `app-debug.apk` to the phone (USB, Drive, or any messaging app).
4. **Uninstall any earlier debug build first.** Each CI debug build is signed with a new key, so Android refuses to install over an old one ("App not installed").
5. Tap the APK, allow "Install unknown apps" for the app you opened it from, and install.
6. On first launch allow **Nearby devices** and **Location**, and keep the phone's Location switch on. Android hides most Bluetooth devices from apps without location access.
7. For "last seen" places while the app is closed, allow location **all the time** (Find tab → Allow).

## Run the app locally

```bash
nvm install 24 && nvm use 24     # Node 24, pinned in .nvmrc
npm install
npm run dev                      # http://localhost:5173
```

In a desktop browser the app runs with Web Bluetooth (Chrome/Edge): you can pick a device in the browser's chooser and see the interface, but native features — background scanning, classic discovery, pairing, Secure Share, Find my devices — need the Android APK.

Set `VITE_ENABLE_SIMULATOR=true` to include sample devices in a build for demos; release builds never include them.

## Run the server locally

The server is only needed for accounts and community recovery.

```bash
cd backend
cp .env.example .env     # set MONGODB_URI; keep FIREBASE_PROJECT_ID for Firebase sign-in
npm install
npm run dev              # http://localhost:4000/api/health
```

You need a MongoDB instance (local `mongodb://127.0.0.1:27017/blueguardian` or MongoDB Atlas). Point the app at your server in **Settings → Advanced → Server**.

## Build the APK

Builds run in GitHub Actions — no Android Studio needed.

- **Automatically:** push to `main` or to a branch named `android/phase*`.
- **By hand:** Actions → *Build BlueGuardian Android Shell* → **Run workflow**.

The workflow runs the backend tests, the BTGuard tests and the frontend tests, builds the web app, generates the Android project with Capacitor, applies [`scripts/prepare-capacitor-ci.mjs`](../../scripts/prepare-capacitor-ci.mjs) (plugins, permissions, icons, hardening) and compiles with Gradle against Android SDK 36.

### Signed release APK

Add these repository secrets (Settings → Secrets and variables → Actions) and the same workflow also uploads `blueguardian-android-release-<commit>`, a signed release APK that installs over previous releases:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Your keystore file, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

Keep the keystore safe: every future update must be signed with the same key.

### Building on your own machine (optional)

With Android SDK 36 and JDK 21 installed:

```bash
npm ci
npm install --no-save @capacitor/core@8.4.0 @capacitor/cli@8.4.0 @capacitor/android@8.4.0
VITE_API_BASE=https://your-server.example.com/api npm run build
npx cap add android && npx cap sync android
node scripts/prepare-capacitor-ci.mjs
cd android && ./gradlew assembleDebug
```

## Deploy the server

The server is described by [`render.yaml`](../../render.yaml) for [Render](https://render.com).

1. Create a Render **Blueprint** (or Web Service) from this repository; it uses the `backend/` folder.
2. Set `MONGODB_URI` in the service's environment (it is deliberately not in the file).
3. Choose the branch to deploy (normally `main`) and keep **Auto-Deploy** on.
4. Check `https://<your-service>.onrender.com/api/health` returns `ok`.

The CORS allowlist must include the Android WebView origin `https://localhost` (`BLUEGUARDIAN_CORS_ORIGINS`, already set in `render.yaml`).

## Configuration reference

**App build (environment variables at `npm run build`)**

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE` | Default server URL baked into the build |
| `VITE_API_ALLOWED_HOSTS` | Extra server hosts users may switch to in Settings |
| `VITE_ENABLE_SIMULATOR` | `true` to include sample devices (demo builds only) |
| `BACKEND_CERT_PINS` | Optional `sha256/…` certificate pins for the server (read by the CI prepare script) |

**Server (`backend/.env`, see [`backend/.env.example`](../../backend/.env.example))**

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 4000) |
| `MONGODB_URI` | MongoDB connection string |
| `FIREBASE_PROJECT_ID` | Firebase project whose ID tokens are accepted |
| `BLUEGUARDIAN_AUTH_MODE` | `required` (protected routes need a valid token) |
| `BLUEGUARDIAN_CORS_ORIGINS` | Comma-separated allowed origins; include `https://localhost` for the app |
| `BLUEGUARDIAN_OWNER_TOKEN`, `BLUEGUARDIAN_OWNER_ID` | Local-development fallback only, never production |

## Tests

```bash
npm test                         # app unit tests (Vitest)
cd backend && npm run test:ci    # server tests + TypeScript build
cd btguard && python -m unittest tests.test_btguard -v   # BTGuard trust engine
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Few or no devices appear | Allow Location for BlueGuardian and turn on the Location switch; Android hides scan results without them. |
| "App not installed" | Uninstall the older debug build first (different signing key). |
| Paired earbuds won't reconnect from the app | Android 12+ only allows this from its own Bluetooth settings; tap **Open Bluetooth settings**. |
| Secure Share can't find the other phone | Both phones need Location on; the other phone must be on the **Receive** screen and close by. |
| Community tab says the server is offline | Check **Settings → Advanced → Server**; on Render's free plan the first request after idling can take ~50 s. |
| Earbuds not found by Find it | Take them out of the case; closed cases don't transmit. |
