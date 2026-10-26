# Security policy

BlueGuardian is a security app, so we take reports seriously.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: **Security → Advisories → Report a vulnerability** on this repository. Include what you found, how to reproduce it, and its impact. You'll get an acknowledgement as soon as possible, and credit when it's fixed if you'd like it.

## Supported versions

Only the latest build from `main` is supported.

## Security model in brief

| Area | Protection |
| --- | --- |
| Device checks | Verdicts come from what devices broadcast (maker IDs, names, device class); nothing is sent off the phone. |
| Secure Share | Noise XX (X25519, ChaCha20-Poly1305, SHA-256), 6-digit code verification, key pinning, key rotation every 500 messages or 2 minutes, continuous trust scoring with automatic isolation. |
| Received files | App-private quarantine, SHA-256 and file-type verification, executables blocked, never opened automatically. |
| Keys and secrets | Encrypted with the Android Keystore (StrongBox when available); app backups disabled. |
| Network | HTTPS only, system certificate authorities only, optional certificate pinning, server host allowlist in release builds. |
| Server | Firebase ID tokens verified against Google's keys; every query scoped to the signed-in user; Helmet headers; CORS allowlist; rate limits on recovery writes. |
| Community recovery | Hashed name fingerprints instead of addresses; helpers never learn about matches; location only with opt-in. |
| Evidence | Hash-chained, tamper-evident security log for Secure Share. |

## Known limits

- The BTGuard behaviour model was trained on simulated sessions and tuned for real phones; field validation is ongoing.
- Community matches are leads based on a device's advertised name and must be confirmed by the owner.
- Debug APKs from CI are signed with a temporary key; use a signed release build for distribution.
- Never commit `backend/.env` or real credentials.
