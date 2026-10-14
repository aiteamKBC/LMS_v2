# KBC Learn mobile client

This Expo/React Native client uses the maintained LMS at `https://lms.kentbusinesscollege.org`. Learners sign in with their existing LMS account and choose from their current effective course assignments. The server remains authoritative for identity, access gates, course/component IDs, grading, saved progress and learning time.

The learning catalogue contains published audio, video and supported choice quizzes only. Choice quizzes support single-choice, true/false and multiple-answer questions. Courses without eligible mobile material remain visible with an empty state. Assignments, document-only reading and live-session activities are excluded from the learning catalogue. Existing meeting/calendar handoffs remain separate. Shared mobile rewards remain limited to their existing PMP policy; wider course access does not enable rewards for other courses.

## Develop and check

The learner home screen has two primary actions. **Song of the week** opens an eligible song from the exact selected module and week, using authored song metadata or established legacy labels/IDs. It never falls back to another course/week. **Authorised absence** offers the next reportable lecture, monthly coaching meeting, or progress review from the learner's canonical absence register. Dates are UK time and a request requires explicit confirmation.

The authenticated `mobile/absence-reports/` facade delegates to the maintained absence handler: meeting requests remain pending coach approval; lecture recording/alternative recovery follows existing LMS policy. The native form supports recording plans and eligible alternative sessions. Evidence uploads and coach catch-up booking use the full LMS form. Saved approval does not credit attendance or hours. Recent reports are shown after refreshing, including when an earlier submission response timed out. No absence is submitted by merely opening the screen.

Use a Node version supported by the lockfile's React Native engine range (`^20.19.4 || ^22.13.0 || ^24.3.0 || >=25.0.0`). From this directory:

```text
npm ci
npm run check:native-media
npm run typecheck
npm test
npm run export:web
npm run export:native
```

`npm start` starts Expo development tools. `npm run web` starts the web development server on port 8081; `npm run preview` serves an exported `dist` directory on loopback port 8082. Web rendering/export checks do not verify native cookie sessions or phone playback. The API origin is fixed in `src/lms-client.mjs`; the client does not require an API key or a separate learner database.

The tests use synthetic accounts, media and transport fixtures. Backend security, canonical save/readback and PostgreSQL tests are documented in [the backend test README](../backend/mobile_integration_tests/README.md).

## Build the Android internal candidate

Install the Java and Android toolchain required by the pinned Expo/React Native Gradle plugins, configure `JAVA_HOME`, and supply the Android SDK path through `ANDROID_HOME` or the ignored `android/local.properties`. Native dependencies are installed by `npm ci`; the checked-in Gradle wrapper is under `android/`.

Set `KBC_ANDROID_SIGNING_STORE_FILE` to the absolute path of the existing development keystore held outside this repository, then run from `android/` on Windows:

```powershell
.\gradlew.bat :app:assembleRelease
```

The output is `android/app/build/outputs/apk/release/app-release.apk`. The current build configuration uses development signing even for this release task: it produces an **internal test candidate**, not a production-signed store release. Updating an installed candidate requires its matching signing key. Keystores, local SDK paths, environment files, dependencies and build outputs are excluded from source control.

For a Windows checkout using a short drive alias or shared dependency junction, `KBC_DEPENDENCY_ROOT` identifies the physical directory containing the reused `node_modules`, and `KBC_CANDIDATE_PHYSICAL_ROOT` identifies the candidate's physical root. The existing autolinking scripts normalize these paths onto the build checkout. Leave both unset for an ordinary checkout with its own dependencies; do not copy a developer's absolute paths into tracked files.

## Native authenticated media transport

`npm ci` runs `scripts/patch-native-media-cookies.cjs` automatically. The reviewed patch is pinned to `expo-audio`/`expo-video` 57.0.5 and React Native 0.86.3, and checks the complete source hashes before changing the Android media clients. They use `JavaNetCookieJar(ForwardingCookieHandler())`, the same per-URL Android cookie store used by React Native networking, so protected LMS media can reuse the learner's native session. Session values are never exposed to JavaScript or copied into a global `Cookie` header. A copy of the global OkHttp provider alone is insufficient because this React Native version initializes a separate networking client.

The script also supplies Expo Audio's explicit React Android dependency. It fails on unexpected versions/source or on shared package junctions, validates all target files before writing, and is safe to rerun. If sharing the rest of `node_modules`, keep private copies of `expo-audio` and `expo-video` inside this checkout first. Run `npm run patch:native-media` after preparing those copies, then `npm run check:native-media` before the native build. The Node contract tests exercise the exact patch, idempotence, source/version drift and refusal to modify shared dependencies; they do not replace authenticated playback checks on an Android device.

The LMS facade must be deployed and enabled for learner sign-in and course access. Physical device installation, learner sign-in, media playback, saved-progress readback and account switching remain separate acceptance checks from compilation and automated tests.
