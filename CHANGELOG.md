# Changelog

Notable changes to BlueGuardian, newest first. Each release corresponds to a phase of the [project journey](docs/journey/JOURNEY.md).

## Phase 8 — Hardening, redesign and publishing · 2026-10-26 to 2026-10-27

### Added
- Bluetooth LE and classic discovery run together; a full scan takes about 12 s instead of 20 s.
- Paired and connected devices appear as soon as the Around tab opens; connection and pairing state update live.
- Secure Share: send several files at once, **Accept all**, cancel search, clearer Send / Receive flow.
- Community recovery redesign: Lost → Searching → Found → Recovered tracker, guided report, sighting timeline, **Ask the community** from a lost device.
- Shared UI kit and standardised wording across the app.
- New Bluetooth-shield logo across launcher, splash, Play Store icon, favicon and app; `branding/render_icons.py`.
- CI also builds and tests on every push to `main`.
- Public documentation: README, Technical Guide, Feature Map, Getting Started, Journey, Security and Contributing guides.

### Fixed
- Most nearby devices were hidden on Android 12+ because location permission was never requested for scans.
- Classic discovery refused to start when another search was running, and missed names that resolved late.
- "Around you" counted devices with rotating addresses two or three times.
- Pair and connect returned before pairing finished; earbuds could show "Connected" without audio.
- Secure Share: the receiving phone couldn't find the sender on Android 12+; the trust engine isolated and revoked peers during large transfers.
- Find my devices: slow indoor location and hours-old cached places saved as "last seen".
- Community recovery: helper sightings almost never matched an owner's report; now matched by name as well as exact fingerprint.

## Phase 7 — Secure Share, BTGuard and Find my devices · 2026-10-18 to 2026-10-19
- Secure Share: Bluetooth LE L2CAP channel, Noise XX handshake with 6-digit code, encrypted resumable transfers, quarantine, Android Keystore.
- BTGuard continuous trust binding (FULL / RESTRICTED / ISOLATED) with automated recovery.
- Find my devices: last-seen place on disconnect, signal meter, sharing.
- Evidence engine: trackers following you, popup spam, look-alikes; accountable trust scores with history.
- Guardian check: instant Safe / Caution / Unsafe verdict before connecting. New logo, fonts and animated welcome.

## Final UX and reliability · 2026-10-17
- Visual system, motion and Android Back navigation.
- In-app connection approval and policy settings that change decisions.
- Privacy-preserving community recovery with consent-based location and owner confirmation.
- Evidence-based threat classification and a leakage-aware training pipeline.

## Phase 6 — Server integration · 2026-10-16 to 2026-10-17
- Express + MongoDB server with Firebase authentication, owner-scoped data, device/threat/action/event/recovery APIs and tests; deployed on Render.

## Phase 5 — Combined scanning · 2026-10-16
- One action returns merged, de-duplicated BLE and classic results.

## Phase 4 — Classic discovery · 2026-10-16
- Classic Bluetooth inquiry with clear permission and adapter errors.

## Phase 3 — Native BLE scanning · 2026-10-16
- First Java plugin: foreground BLE scanning streamed to the app; startup and cleanup repairs.

## Phase 2 — Android cloud build · 2026-10-15
- Capacitor Android shell built entirely in GitHub Actions.

## Phase 1 — Web dashboard · 2026-10-14
- React dashboard: Web Bluetooth discovery, trust scoring, threat analysis, timeline, policies, IndexedDB storage, ML placeholder.
