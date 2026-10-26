# Contributing

Thanks for your interest in BlueGuardian. The source is published under an **all rights reserved** license, so code contributions can only be accepted with the copyright holder's agreement. Bug reports, ideas and questions are very welcome through [issues](../../issues).

## Reporting bugs

Use the **Bug report** issue template and include your phone model, Android version, the app build (commit) and the steps to reproduce. For security problems, follow [SECURITY.md](SECURITY.md) instead.

## Working on the code (with permission)

1. Read the [Technical Guide](docs/guide/TECHNICAL_GUIDE.md) and find your area in the [Feature Map](docs/guide/FEATURE_MAP.md).
2. Branch from `main`. Use `android/phase<N>-<topic>-<yyyymmdd>` for app work (these branches build an APK in CI) and `feature/<topic>` for everything else.
3. Keep changes focused. Run the checks before opening a pull request:

   ```bash
   npm test && npm run build
   cd backend && npm run test:ci
   cd btguard && python -m unittest tests.test_btguard -v
   ```

4. Open a pull request using the template. CI must pass.

## Conventions

- **Security logic lives in TypeScript** (`src/`); Java plugins only call Android APIs and move bytes.
- **Never claim more than the evidence shows.** Unknown is not "risky", a lead is not a confirmation, and nothing is "Trusted" without the user's consent.
- **Plain language in the UI.** Sentence case, short titles, buttons as a verb plus an object, no engineering terms on main screens. Use the components in `src/ui/kit.tsx`.
- **Privacy by default.** No new data leaves the phone without a clear user action and opt-in.
- Commit messages describe the user-visible effect in the first line.
