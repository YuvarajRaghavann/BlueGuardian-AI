# BlueGuardian Phase 2: Cloud-built Android shell

## Purpose

This phase packages the existing React/Vite UI into a Capacitor Android shell using a GitHub-hosted runner. Android Studio is not required on the user's low-RAM PC. This is a Phase 2 proof of packaging, not yet the real native Bluetooth release.

## Branch safety

The publishing helper creates a new branch named `android/phase2-cloud-build-<timestamp>`, commits the backed-up project's current tracked modifications plus safe source/docs files, and pushes only that branch. It never pushes to `main` and refuses to stage environment files, APKs, Gradle caches, build output, dependency folders, or dissertation artifacts.

## What the workflow does

1. Checks out the dedicated phase branch.
2. Uses the repository's Node pin, JDK 21, and an Android 16/API 36 SDK.
3. Installs the exact locked web dependencies and pinned Capacitor 8.4.0 build packages.
4. Runs the existing production web build.
5. Generates the Capacitor Android shell in the hosted runner.
6. Sets API 36 values in generated Gradle configuration when that template exposes them there.
7. Builds `assembleDebug` on GitHub Actions and uploads `app-debug.apk` plus `android-build-info.txt` as a 14-day artifact.

## What this does not do yet

- It does not integrate the native Kotlin BLE/classic scanning plugin.
- It does not deploy the backend or make production API changes.
- It does not create a signed release APK or Play Store bundle.
- It uses staging application ID `com.blueguardian.hybrid` so it does not pretend to be a signed update to the existing `com.blueguardian` native APK.
- The generated debug APK is not a production release and must be tested on a physical Android device.

## How to get the APK

After the helper reports a successful `git push`, open the repository's Actions tab and select **Build BlueGuardian Android Shell** for the new `android/phase2-cloud-build-*` branch. When it finishes successfully, download the artifact named `blueguardian-android-debug-<commit>`. The ZIP contains the debug APK and build manifest.

If the workflow is disabled by repository policy, enable GitHub Actions for this private repository or stop and use a separately approved build runner. Do not upload source code to a third-party build service without reviewing its privacy terms.
