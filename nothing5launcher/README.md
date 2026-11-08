# Nothing 5 Launcher — Cloud Build

An independent Android home-screen launcher for CMF Phone 1, inspired by the visual language and user-facing home-screen ideas of Nothing OS 5.0. It is not an official Nothing product and does not modify the device firmware.

## Current build scope

- Android HOME activity and launcher chooser support
- Installed app discovery and launch
- Dark minimalist home surface, clock, date and battery indicator
- App index with search
- Long-press application information
- Native Android status/navigation bars retained
- No root or special system privileges

## Build

Run `./gradlew :app:assembleDebug` from this directory. The GitHub Actions workflow in the parent repository builds this project with Android SDK Platform 36 and uploads the debug APK as an artifact.

## Device limitations

Nothing's official OS 5.0 feature set is built on Android 17. CMF Phone 1 is excluded from the official OS 5.0 rollout. This launcher runs on Android 16 and can recreate launcher-level visuals and interactions, but cannot replace privileged system components such as the status bar, notification shade, Quick Settings, Recents, lock screen, system Settings, Camera, Essential Space, or system-level performance/memory management. Those require Nothing firmware or privileged/system-signed integration.

## Planned follow-on modules

Wallpaper-aware tinting, transparent native widgets, selectable clockfaces, folders and batch icon placement, a timer widget, an Away Time dashboard, sticker/Collector-style widgets, custom gesture actions, accessibility testing and performance tuning.


Cloud CI uses Android SDK Platform 36; this build is for the CMF Phone 1 Android 16 baseline.
