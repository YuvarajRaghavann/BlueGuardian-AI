# BlueGuardian web workflow

## 1. Dashboard, device and threat workflow

1. The Dashboard and Devices use the same browser-local state.
2. With Simulation mode enabled, BlueGuardian generates marked demo records and runs the deterministic development assessment.
3. With Simulation mode disabled, the button opens the browser's Web Bluetooth chooser for one supported device. The user grants permission and the app attempts to inspect permitted GATT services.
4. The app persists supported device records, assessments, threat statuses and user actions in IndexedDB.
5. Trust, Mark unknown, Block, Unblock and Forget update BlueGuardian's local policy/state. These actions are not OS-level Bluetooth enforcement.
6. Scan requests, selected-device observations, assessment summaries, security actions and threat status changes are recorded in the local activity store.
7. Threat statuses can be investigated, resolved, dismissed and reopened. Status changes are persisted with the threat data and added to the local activity feed.
8. Dashboard, Threat Detection, Activity, Analytics and Settings read the same browser-local context/storage boundaries. Local records do not automatically synchronize to another browser or account.

## 2. Recovery workflow

1. The owner opens Device Recovery and signs in through the configured OIDC provider (production), or enters the local development owner token (development only).
2. Browser OIDC uses Authorization Code + PKCE S256. The access token is held in React memory and is not written into localStorage or IndexedDB.
3. The browser sends the access token as a bearer token to the recovery API.
4. The backend verifies the token signature using the configured JWKS, requires supported RS256/ES256, validates issuer/audience/expiry/subject, and maps the verified subject to the recovery owner ID.
5. The owner registers a device using the browser-scoped identifier. The backend stores the owner-scoped record in MongoDB.
6. The owner moves the case through valid states: lost, searching, found, recovered. A recovered case must be explicitly reopened as lost before continuing.
7. The current Web Bluetooth observation flow is manual: the owner selects a device in their browser and the server records receipt time. It does not imply a community observation, location or RSSI measurement.
8. Successful recovery actions also create a browser-local activity item. This is not a shared/server-side audit log.

## 3. Recovery lifecycle

- `lost` -> `searching`, `found`, or `recovered`
- `searching` -> `lost`, `found`, or `recovered`
- `found` -> `lost`, `searching`, or `recovered`
- `recovered` -> `lost` (explicit reopening)

Same-state retries are idempotent. Invalid status values return HTTP 400; invalid transitions return HTTP 409.

## 4. Product boundaries

- Local browser history is private to that browser profile.
- The development threat engine is heuristic-based. A risk score is an assessment indicator, not proof that an attack occurred.
- Web Bluetooth is user-mediated and browser-limited; it does not passively scan every nearby device.
- Community participant reporting, privacy-preserving cross-device matching and owner notifications remain future implementation work.
- OIDC source code is present, but a production provider, client, issuer, API audience, callback URI, backend JWKS setting, CORS origin and hosted end-to-end sign-in must still be configured/verified.
- Production protected routes intentionally fail closed if the OIDC verifier is not configured.

## 5. Web acceptance checklist

- [ ] Simulation scan produces only clearly marked demo devices/events.
- [ ] Real-device selection only reports a completed observation when a supported browser selection and GATT inspection succeed.
- [ ] Refresh/reopen restores local devices, threat statuses, actions and workflow activity from IndexedDB.
- [ ] Threat resolution/reopening changes saved status and appears in the event feed.
- [ ] Browser-local Block/Trust actions state that they do not enforce system-level protections.
- [ ] Owner recovery registration survives API/browser refresh and only returns the verified owner's records.
- [ ] Valid recovery state transitions persist; invalid transitions return HTTP 409.
- [ ] OIDC invalid signature, wrong issuer/audience, expired token, missing config and owner isolation tests pass.
- [ ] Live MongoDB integration is run only against the dedicated disposable `blueguardian_test` database.
- [ ] Hosted login, CORS, MongoDB and notification behaviour are verified in staging before any production release.
