# BlueGuardian Original Vision Roadmap

This branch is an isolated research/implementation workspace. Production deployment settings and the `main` branch are intentionally left unchanged.

## Original vision
Build an intelligent Bluetooth and IoT security framework that combines device trust assessment, explainable threat detection, native Android BLE observation, and privacy-preserving community-assisted lost-device recovery.

## Non-negotiable safety boundaries
- Never test against or modify a production database. Use a disposable test database.
- Never put tokens, MongoDB URIs, or credentials into source control, issues, logs, or chat.
- Do not merge this branch into `main` or deploy it until the release checklist passes.
- Do not claim passive background scanning, global Bluetooth identity, a trained ML model, or owner notifications without a tested implementation and evidence.
- The server derives identity from verified authentication, never from client-supplied owner IDs.
- Community observations must minimize data, require participant consent, enforce retention, and avoid collecting location unless explicitly necessary and consented to.

## Phase gates
1. **Baseline and backup**: preserve `main`, compare source to verification documents, establish an auditable inventory.
2. **Recovery domain correctness**: owner-scoped data, privacy budget, explicit state transitions, idempotent observations, bounded retention and request limits.
3. **Participant identity**: production OIDC/JWKS token verification, issuer/audience/expiry/algorithm validation, subject-to-owner mapping, participant scopes and consent.
4. **Community protocol**: native Android BLE scan, rotating/pseudonymous observation IDs where technically feasible, authenticated report endpoint, server-side matching, abuse limits, deletion and retention design.
5. **Owner alerts**: opt-in notifications, deduplication, verified delivery, anti-spam controls.
6. **Validated intelligence**: labeled dataset, baseline metrics, compare interpretable rules to a trained model, report precision/recall/F1 and false-positive rate.
7. **Release verification**: unit/integration tests, isolated live-Mongo tests, web build, Android APK build and physical-device verification, security review, explicit deployment approval.

## Baseline defects requiring resolution
- `backend/src/app.ts` currently mounts `/api/devices`, `/api/threats`, `/api/actions`, and `/api/events`, while `docs/FINAL_VERIFICATION.md` claims those routes are unmounted. Source and verification must be reconciled before any route exposure decisions.
- `backend/src/routes/recovery.ts` owner observation handler performs `Device.findOne({ deviceId })` and then checks `ownerId` in application code. Replace with an owner-scoped query (`{ ownerId, deviceId }`) to avoid querying a cross-owner record at all.
- Encounter payload currently accepts coordinates and address. Community recovery should default to no location collection; remove location fields from the community API contract unless a documented consented use case is approved.
- `backend/src/auth.ts` intentionally returns 503 for protected routes in production because a production identity verifier is absent. Keep this fail-closed until OIDC/JWKS verification is actually implemented and tested.
- The ML component is a deterministic development classifier. Keep it labeled as a heuristic assessment until a trained model is evaluated using a versioned labeled dataset.

## Regression and release checklist
- [ ] Preserve an immutable backup ref before starting a milestone.
- [ ] Unit tests cover validation, owner isolation, duplicate reports, rate limits, and privacy minimization.
- [ ] Integration tests run only against a disposable `blueguardian_test` database.
- [ ] No secret values appear in diffs or logs.
- [ ] Build and tests are rerun on the branch head.
- [ ] Production routes and CORS are verified against a staging deployment, never by changing production settings in this milestone.
- [ ] Android scanning is validated on actual supported hardware.
- [ ] Merge/deployment only after explicit review and approval.


## Current branch progress (2026-10-15)

- Backup ref `backup/pre-original-vision-2026-10-15` was created at the original `main` commit `fad8eea87437339e636fac47da2f2cbe47f993c9`. GitHub comparison confirms that backup and `main` are identical.
- Work branch `research/community-recovery-phase-1` was created from that same base. It is 10 commits ahead of `main`; `main` has not been modified.
- The recovery encounter POST now queries by both authenticated `ownerId` and `deviceId`. A regression test checks cross-owner reporting is rejected and the owner filter is part of the database lookup.
- The legacy unscoped `/api/devices`, `/api/threats`, `/api/actions`, and `/api/events` routers are unmounted in the work branch, matching the intended fail-closed baseline. Tests assert those paths return 404.
- Browser CORS now requires an exact `BLUEGUARDIAN_CORS_ORIGINS` allowlist; `backend/.env.example` documents the setting, and a regression test checks both allowed and rejected origins.
- The branch tests have been authored/updated but have **not yet been executed** in this environment. Do not count them as passing until `npm test` and `npm run build` complete successfully in the backend's isolated working copy.
- No participant submission endpoint, production OIDC/JWKS verifier, Android community scanner, server-side match pipeline, or notification service has been added yet. Those require the subsequent gated phases above.
- No Render configuration, production environment variables, running service, production database, or `main` branch was changed by this work.
