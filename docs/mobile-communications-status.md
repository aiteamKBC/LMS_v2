# Mobile communications implementation status

Work in progress; not a release. The new application is not yet in INSTALLED_APPS or the production URL configuration. Do not enable or deploy this feature from this draft.

## Implemented foundation

- Additive tables for cohort and private conversations, retry-safe text messages, read cursors, notification preferences, devices, notifications and delivery records. Existing legacy chat tables are untouched.
- API handlers derive identity from the LMS session and verify current cohort membership or coach assignment for every conversation access. No demo bootstrap or client-selected sender.
- Independent in-app and push preferences for cohort messages, private messages, meetings, attendance, assignments and tasks. Push defaults off.
- Pure reminder policy: previous UK calendar day, 15 minutes before, 15 minutes after when attendance is unconfirmed; assignment/task two-day and one-day reminders. Cancellation, authorised absence, attendance and submission suppress the applicable reminders when supplied by a current server-side source.
- FCM HTTP v1 transport with generic lock-screen wording, opaque IDs, Android channels, bounded TTL and classified delivery failures. Credentials are external runtime files, never repository content.

## Validation

`python -m django test mobile_comms --settings=mobile_comms.test_settings --noinput`: 34 tests passed on 13 October 2026. The dedicated settings use an in-memory SQLite database and bypass application startup hooks. Tests use synthetic identities and mocked external transport; they do not prove production database behavior or real phone delivery.

Teams baseline and expanded Teams tests: not required for this draft; no Teams files changed. Live Teams testing: not run.

## Required before release

1. Complete canonical identity tests, concurrent-send limiting and delivery worker authorization, including expired/revoked sessions and preference changes. Validate the migration on isolated PostgreSQL.
2. Connect reminder generation and last-moment eligibility checks to actual LMS calendar, attendance, assignment submission and task sources. The current pure policy is not a running scheduler.
3. Add the Android Messages inbox, learner/cohort/private routes, coach sign-in/inbox, notification preferences and notification inbox. Register native FCM tokens, unregister on sign-out, handle token refresh, account switching and notification taps. Replace overlapping local reminders to avoid duplicate alerts.
4. Add app/routes/configuration and a reviewed scheduler with delivery retries and monitoring. No live sender or scheduler has been enabled.
5. Test the complete final change, review the PR, merge current main, verify backup/restore and migration targets, and deploy through the agreed main pull, frontend build and service restart flow. Preserve any team modifications.
6. Build a new Android APK and verify foreground/background/closed-app notifications and chat on physical phones. The previously installed APK cannot gain these features from a backend change alone.

The Firebase account and private credential provisioning are tracked outside this public repository. Their validation-only check sent no messages. No learner accounts have been reactivated and no test chats have been sent to real learners.
