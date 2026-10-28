# Changelog

Notable changes to BlueGuardian, newest first. Each release corresponds to a phase of the [project journey](docs/journey/JOURNEY.md).

## Phase 9 — Field fixes before the presentation · 2026-10-28

### Scanning: every device shows up
- **Android's scan throttle no longer hides devices.** Android silently returns *nothing* to an app that starts more than 5 scans in 30 s (Around + Find + Share each start one). Scans now reuse a running scan and wait for a free slot instead of running blind; the limit is shared across the app.
- **Legacy + extended scanning together:** a plain legacy scan (most reliable for names in scan responses on every chipset) plus a Bluetooth 5 extended-advertising scan where supported.
- **Nameless devices are shown, not hidden.** iPhones and most new Android phones, watches and earbuds advertise without a name. They now appear labelled by maker from their Bluetooth SIG company ID ("Apple Bluetooth device"), and the app then **asks them their name** with a short, non-bonding GATT read (Device Name, Appearance, maker, model), strongest signal first.
- Classic discovery keeps LE devices whose names Android's inquiry resolved; old Bluetooth 2.x/3.x devices are found by classic inquiry running alongside the BLE scan.

### Community recovery
- Report and Help-others use the full scan (BLE + classic together + name lookup) instead of a short BLE-only pass, and list nameless devices too.
- **Address matching:** helpers send a one-way salted hash of each stable Bluetooth address (never the address). Lost devices are matched by address (strong lead), exact name + services, or name, so nameless and generically named devices can be found. Backend: `recoveryAddressHash`, up to 60 observations per submission, falls back gracefully on older servers.

### Secure Share: stable links on Android 8+
- **GATT transport** (write-without-response + notifications, MTU 517): Secure Share now works on Android 8 and 9, and automatically falls back to it when a phone's L2CAP channel can't open.
- While a link is live the host stops advertising and nothing scans; the link runs at high connection priority and RSSI is read from the connection itself (the old background scan competed with transfers and caused drops).
- **Auto-reconnect:** after a radio drop the host stays visible with the same code and the sender finds and reconnects to it; the pinned peer is re-verified automatically and transfers resume from the last chunk.
- **BTGuard false isolations fixed:** soft evidence from one method can pause sharing but never revoke a pairing (corroboration); a soft dip must persist two windows; frames already in flight for a cancelled transfer and pings queued behind file chunks no longer count as attacks; windows where Android throttled the WebView are skipped; the sender waits for trust to return instead of cancelling a transfer.
- **"Re-pair proof failed" fixed:** both phones now adopt the new recovery secret when either side re-pairs, so the next re-pair can still prove itself.

### BTGuard verdict for scanned devices
- The Guardian verdict is now the BTGuard three-method fusion used for the secure link: protocol & identity, radio physics (received signal vs advertised transmit power, signal stability), and behaviour over time, fused into one score (`src/intel/btguardScan.ts`). **Unsafe needs hard evidence or two methods agreeing.** The device sheet shows the score and each method.

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
