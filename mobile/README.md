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

Expo SDK 57 normally uses bundled Android AARs for these packages, which bypass patched local source. `package.json` therefore explicitly includes both `expo-audio` and `expo-video` in `expo.autolinking.android.buildFromSource`. The patch/check command rejects missing or incomplete configuration, and Gradle's `preBuild` runs that check even if the npm install lifecycle was skipped. Dependency versions remain pinned. See [Expo's prebuilt module guidance](https://docs.expo.dev/guides/prebuilt-expo-modules/).

After building, verify the actual APK before distributing it, from this directory:

```text
python scripts/verify-native-media-apk.py android/app/build/outputs/apk/release/app-release.apk --report native-media-apk-receipt.json
python -m unittest discover -s tests -p test_native_media_apk.py
```

The APK check inspects the compiled audio and video client methods for the cookie-handler construction and attachment. Source tests, a successful build, or unrelated cookie classes elsewhere in the APK cannot establish that the media clients use the patched code. Keep generated receipts outside source control. This static check establishes the packaged transport; physical Android sign-in, protected audio/video playback and logout/account switching still require device acceptance.

The LMS facade must be deployed and enabled for learner sign-in and course access. Physical device installation, learner sign-in, media playback, saved-progress readback and account switching remain separate acceptance checks from compilation and automated tests.

## Prepare the iPhone version

The iPhone build uses the same `App.tsx` entry point, learner and coach screens, colours, and maintained LMS APIs as Android. It does not create a second set of learner records. The current pinned native dependencies require **iOS 16.4 or newer**. Its bundle identifier is `com.kentbusinesscollege.learn`, its home-screen name is **KBC Learn**, and its initial iOS build number is `1`. Confirm that KBC can register this identifier when setting up its Apple account. Android's package, version code and checked-in native project are independent and remain unchanged.

From `mobile/`, these checks work on Windows as well as macOS:

```text
npm ci
npm run check:native-media
npm run typecheck
npm test
npm run export:ios
npx expo config --type introspect --json
```

An iOS JavaScript/Hermes export and config introspection are preparation checks, **not an Xcode build or an installable iPhone app**. The pinned Expo CLI does not run iOS prebuild on Windows. Native generation, CocoaPods, compilation and simulator/device checks require macOS, locally or through EAS Build. The native `ios/` directory is generated from the reviewed config and excluded from Git and EAS uploads; do not run a clean prebuild across both platforms because Android has maintained native changes. On a Mac use `npx expo prebuild --platform ios`, then `npx expo run:ios` for local simulator testing.

The existing KBC crest remains the source icon and splash image. Expo's pinned iOS icon generator produces the opaque 1024-pixel default icon; no replacement branding is used. Review the generated asset catalogue, final aggregated privacy manifest, microphone/speech permission text and background-audio behaviour in the native archive before submission. Complete Apple's privacy and export-compliance declarations from the actual app and services; no unverified declaration or signing identity is supplied here.

### Build and distribute after account setup

Before distributing the app to iPhones, an authorized KBC representative must [enrol the legal organization with Apple](https://developer.apple.com/help/account/membership/program-enrollment/) and complete its verification, agreements and membership. A KBC-controlled Expo/EAS project is also needed for cloud builds. Do not put Apple passwords, signing keys, service-account files or personal access tokens in this repository.

Once the accounts exist, use the EAS CLI from this `mobile/` directory. Link it to KBC's actual Expo project and commit the returned project identity through review; do not invent an owner, project ID, team ID or App Store Connect app ID. Inspect the build archive before uploading. The repository-root `.easignore` includes mobile source only and excludes runtime data, environment files, credentials, dependencies and build outputs. The maintained Android source is retained; iOS is generated separately by EAS.

```text
eas build:inspect --platform ios --profile ios-testflight --stage archive --output ../ios-archive-check
eas build --platform ios --profile ios-simulator
eas build --platform ios --profile ios-testflight
```

`ios-simulator` builds a Release simulator app, which cannot be installed on a physical iPhone. `ios-testflight` builds a signed store-distribution candidate after Apple signing is configured. Neither profile submits automatically. Versions are controlled in source: increment `ios.buildNumber` for each subsequent uploaded build and commit it before building. A clean committed checkout is required. Upload only the reviewed, tested iOS build to the matching App Store Connect app, then use [TestFlight](https://developer.apple.com/testflight/) for acceptance before an App Store release. No Apple enrollment, cloud build, submission or tester invitation is performed by adding these files.

### iPhone acceptance and notification boundary

Verify existing LMS login (including session expiry/logout and switching accounts); current learner assignments and coach caseload permissions; protected audio/video and YouTube playback; pause/background timing; MCQ submission with saved LMS progress; measured hours and shared points; coach material previews; and authorized private/class chats using designated test accounts. Confirm safe-area layout, keyboard, dictation permissions and background audio on actual supported iPhones. Synthetic transport tests and browser previews do not establish native playback or live LMS write/readback.

The current server sends phone alerts through Android FCM only. iPhone shows a clear Apple-setup status instead of a non-working Connect button. In-app reminders remain available and account-level notification preferences remain editable for other connected devices. The iPhone client does not request an APNs token or send one to the Android registration endpoint. Apple signing alone will not enable iPhone phone alerts: an authorized APNs/provider integration, matching credentials, scoped registration, logout/revocation handling and real foreground/background delivery tests are required in a later release. No `remote-notification` background mode is added. The notification plugin can add the Apple push entitlement during generation, but that is not evidence of delivery readiness.
