# Phase 7 — Secure Link (BTGuard continuous trust binding)

BlueGuardian can now open its own encrypted, continuously verified channel between two phones and share files over it. This is the "build your own secure channel on top of Bluetooth" plan, with the BTGuard trust engine running live on every session.

## What the user sees

1. **Phone A:** Secure Share → **Receive on this phone**. The phone advertises over Bluetooth LE and shows a 4-digit code.
2. **Phone B:** Secure Share → **Connect to a phone**, then tap the entry with the same 4-digit code.
3. Both phones show a **6-digit code**. If the codes match, tap **Codes match** on both. Each phone then pins the other phone's key, so later reconnections are verified automatically.
4. You can then chat and send files. Incoming files need explicit approval. They land in quarantine, are hash- and type-checked, and are never opened automatically. **Save to Downloads** copies a file to `Download/BlueGuardian/`.
5. A trust score (0–100) updates every second:
   - **FULL:** chat and files allowed.
   - **RESTRICTED:** chat only, and the keys rotate mid-session.
   - **ISOLATED:** the link is closed and the pairing is revoked. To restore it, re-pair face to face. The other phone must also prove it holds the secret from the first pairing, and it then starts on probation at RESTRICTED.

## Architecture

| Layer | Where | What |
|---|---|---|
| Transport | `native/android/BlueGuardianSecureLinkPlugin.java` | BLE advertising (service data carries the L2CAP PSM and the 4-digit code), **insecure L2CAP CoC** (Android 10+), length-prefixed frames, connection attempts refused while a session is live, peer RSSI monitor |
| Key storage | same plugin | AES-256-GCM key in the **Android Keystore** (StrongBox where available) wraps the identity private key and the per-peer recovery secrets |
| Quarantine | same plugin | `filesDir/quarantine`: sequential writes, SHA-256 computed on disk, MediaStore export only on user action |
| Handshake | `src/secure/noise.ts` | **Noise_XX_25519_ChaChaPoly_SHA256**: mutual authentication and forward secrecy, independent of Bluetooth pairing |
| Comparison code | `src/secure/session.ts` | Commit/reveal nonces (initiator commits in message 1, reveals in message 3), so a man in the middle cannot grind the 6-digit code |
| Transport crypto | `src/secure/crypto/*` | X25519, ChaCha20-Poly1305, SHA-256/HMAC/HKDF in pure TypeScript (works on any WebView). Strict 64-bit counters reject replayed or reordered frames. Rekey every 500 messages or 120 s, and on trust drop |
| Trust engine | `src/secure/trustEngine.ts` | BTGuard port. Fuses (1) crypto state, (2) physics (Channel Sounding vs RSSI, CFO fingerprint, RSSI jumps) and (3) a 4-weight logistic model (`trustModel.json`). Quick to lose trust, slow to regain it, with hysteresis and explainable reasons |
| File transfer | `src/secure/session.ts`, `fileTypes.ts` | Authenticated manifest (name, size, SHA-256), 16 KB encrypted chunks, resume from the last stored chunk, blocked extensions, magic-byte type sniffing, name/content mismatch rejection, 100 MB limit |
| Forensics | `src/secure/forensicLog.ts` | SHA-256 hash-chained event log, verified on load, exportable |
| UI | `src/pages/SecureShare.tsx`, `src/context/SecureLinkContext.tsx` | Route `/secure-share` |

### Behaviour model features (per 1-second window)

`log_pkt_rate`, `pair_attempts` (refused connections and failed handshakes), `error_rate` (frames that failed authentication), `rtt_jitter_ms` (from encrypted pings). The weights are exported by `python -m btguard export-app-model --out ../src/secure/trustModel.json`. They were trained on the **BTGuard app-session simulator**, so they are design assumptions, not field data. Capture real two-phone sessions and retrain before quoting any accuracy.

## Release hardening in this phase

- **Backend URL allowlist.** In release native builds, Settings only accepts hosts from `VITE_API_BASE` plus `VITE_API_ALLOWED_HOSTS` (comma-separated, `*.example.com` allowed). A stored URL that is not on the list stops being used, so tokens cannot be redirected.
- **Sample devices and demo events are compiled out** of release builds (`src/config/buildFlags.ts`). Set `VITE_ENABLE_SIMULATOR=true` only for demo builds.
- **Manifest:** `allowBackup="false"` and `usesCleartextTraffic="false"`, plus a network security config that trusts system CAs only. Set `BACKEND_CERT_PINS="sha256/…=,sha256/…="` in CI to add certificate pinning, and always include a backup pin.
- **Signed, non-debuggable release APK.** Add the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, and CI also builds `blueguardian-release.apk`. The debug APK is still produced for testing.
- **Still to do in the Firebase console:** restrict the web API key to the app and enable App Check.

## Testing

```
npm test                                   # includes src/secure/*.test.ts
cd btguard && python -m unittest tests.test_btguard -v
```

`src/secure/session.test.ts` covers:
- the pairing code
- automatic reconnection
- a man in the middle getting different codes
- tamper, replay and injection rejection
- scheduled rekey
- file transfer, rejection, decline and resume
- isolation, then recovery and probation re-pair
- failed recovery proof

The Noise implementation was also checked byte-for-byte against an independent Python implementation built on the `cryptography` library.

### Two-phone field test

1. Install the APK on two Android 10+ phones. Grant Nearby Devices.
2. Pair, send a photo, and check that it appears in Quarantine and saves to Downloads.
3. Walk out of range in the middle of a transfer, reconnect, and send the same file again. It should resume.
4. Export the forensic log from both phones. Use those sessions to retrain the model.

## Honest limits

- Android does not let an app change how the system Bluetooth stack pairs. This design does not rely on it: the link is "insecure" L2CAP, and all security comes from the Noise layer.
- Channel Sounding and CFO are not exposed to apps on most phones, so the physics layer currently uses RSSI only. The code paths for Channel Sounding and CFO are in place for hardware that exposes them.
- Some phones cannot advertise. Those phones can still **connect** to a phone that is hosting.
- Throughput is limited by BLE (typically 50–300 KB/s). Wi-Fi Direct for large files is a next step.
