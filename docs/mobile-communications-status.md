# Android chat and reminder release

This change adds native Android cohort group chat, private same-cohort messages, and assigned learner–coach conversations. The coach account has its own mobile inbox. Existing LMS course selection, learning and legacy chat are preserved.

## Notification behaviour

Six categories have independent in-app and phone choices: cohort messages, private messages, meetings, attendance, assignments and tasks. Phone delivery is opt-in and also needs Android permission. Preferences apply across the account's registered phones. Current login sessions, cohort membership and coach assignment are rechecked for reads, sends and delivery.

The scheduler reads current LMS records. Meeting/session reminders run the previous UK calendar day, 15 minutes before, and 15 minutes after when attendance is not confirmed. Approved absence, cancellation and confirmed attendance suppress applicable reminders. Assignment/task alerts run two and one days before the due date. Assignments use the saved end-of-week deadline where configured, otherwise the 21st of the scheduled month; ambiguous/undated assignments are skipped. Submitted assignments and completed tasks are suppressed. Task reminders cover dated learner-owned actions in saved coaching summaries.

Push payloads contain generic wording and opaque routing/account IDs, never message text or learner names. Delivery checks expire after ten minutes. Transient provider failures retry within that eligibility window; uncertain sends after process interruption are retained for review rather than blindly resent. Provider/network delivery is not an exactly-once guarantee. Conversation reads poll every 12 seconds while the app is active.

## Validation on 13 October 2026

- Native tests: 201 passed, including chat navigation, retry identity, coach routes and independent preferences.
- TypeScript: passed.
- Communications policy/API/worker/provider tests: 51 passed using synthetic identities and mocked transport.
- Fresh loopback PostgreSQL: initial migration, actual enrolment/profile bridge, apprenticeship/commercial access, forbidden cohort/withdrawn learner/former coach, concurrent idempotency, rate limit and dispatch claim passed.
- Existing LMS facade/rewards/install regression suites: 99 + 27 + 5 passed on isolated databases after incorporating PR 368.
- Live read-only source checks passed for existing learner records. No synthetic messages, invitations or pushes were sent to learners.
- Chat and notification choices visually inspected at 390 px phone width using isolated synthetic preview data.
- Teams baseline: not required; no Teams-list file changed. Live Microsoft invitations/attendance were not exercised.

## Deployment and rollback

Apply through GitHub branch review, merge main, then the verified server checkout. Deploy only the reviewed merged revision. Preserve existing team source hashes and the previous frontend/APK. Build the frontend successfully before restarting LMS services.

The migration adds only mobile_comms tables; it does not alter existing learner or legacy chat tables. Run the reviewed initial migration on the verified default LMS database. Keep a fresh production restore point and the deployment receipt outside this public repository.

Enable KBC_MOBILE_COMMS_ENABLED and KBC_MOBILE_PUSH_ENABLED through protected runtime configuration. Keep the Firebase sender credential outside GitHub and the APK. Install the supplied systemd service/timer and check its first execution. The timer runs one reconciliation/dispatch cycle, then waits one minute after it finishes; the command also holds a non-overlapping lock.

Rollback first stops/disables the new timer and turns off communications/push flags, restores the previous frontend and APK, and deploys a reviewed revert through GitHub. Preserve chat data and tables; do not drop them or restore the entire database over subsequent legitimate LMS work as a routine rollback.

## Physical Android acceptance still required

Install/update the internal candidate, sign in as two current cohort learners and their assigned coach, enable selected phone alerts, and check foreground/background/closed-app delivery and taps. Verify disabling a category, logout/account switching, rescheduling, submission and attendance suppression using an agreed pilot record. Automated tests and Firebase validation-only requests do not prove delivery on a physical phone. This is an internally signed candidate, not a Google Play release.
