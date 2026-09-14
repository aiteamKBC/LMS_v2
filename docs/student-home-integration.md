# Student home and previous-record signing

The Django/React LMS now has a personalised student landing page at
`/learner/home` and `/workspace/learner`. Local preview:
<http://localhost:3000/workspace/learner> (requires an existing session).
Learner sign-in and `/learner` lead to the landing page; the Dashboard action
opens `/workspace/learner/dashboard`, with the sidebar and internal navigation.
Staff and administrator learner previews also open the landing page and retain
the selected learner in `/workspace/learner/:kind/:id/dashboard`.
This is a local repository change, not a deployed Lovable or production
release. No learner records were changed while implementing or testing it.

## Identity and signing

- The authoritative classification field is `enrolment."Created_users".aptem_id`
  (`EnrolmentUser.aptem_id`). The authenticated login account's `subject_id`
  selects the record. Null, empty and whitespace-only values mean a new learner.
  A missing record/field or failed lookup is an error, never a new classification.
- `GET /login_api/learner-entry/` returns private, non-cacheable access status.
  Query parameters, browser storage and the session's historical-record hint do
  not select the learner or prove completion. Existing profile write restrictions
  prevent learners from changing their Aptem ID.
- As confirmed by the owner, the required document is the existing **Previous
  learning record**, covering required months through **31 August 2026**, version
  **`old-otjh-transition-v1`**. Review/signing uses `/old-otjh/months` and the existing
  individual/bulk monthly signing service. No new agreement wording or signature
  provider was introduced.
- The existing service uses `Audit.learner_transitions.required_months`, verified
  learner signoffs in `Audit.monthly_audit_signoffs`, the exact audit version and
  `otjh-transition:<Created_users id>` programme key. Signature evidence and
  server timestamps remain in the existing storage. A coach's signature alone
  does not satisfy learner completion. Existing valid signatures are reused.
- Existing unsigned learners get a mandatory, keyboard-accessible dialog before
  protected content mounts. Document review, signing, support and sign-out remain
  available. Cancellation, a failed save or a fabricated browser completion event
  cannot unlock access. A fresh server verification after completion returns the
  learner to Student Home. Focus, route changes and periodic checks also detect
  signing completed in another tab.
- Existing server API enforcement protects learning APIs and batch subrequests.
  Failed identity/signature reads fail closed. New learners have no signature
  requirement through this flow; unrelated enrolment/programme restrictions remain.
- The existing `OLD_OTJH_ENABLED` flag controls the signing requirement. It is
  enabled in the inspected local configuration. Deployment must retain that flag
  and the existing API authentication configuration. No settings or database
  migrations were changed by this integration.

## Connected content and destinations

Name, progress, attendance, weekly module/deadline counts and upcoming activity
come from the authenticated learner's existing APIs. Loading, failure and empty
states are explicit. Student Home has no demonstration learner or event fallback.

| Control | Existing destination |
| --- | --- |
| Continue Learning | `/learner/my-learning` |
| Monthly Submission | `/learner/monthly-submission` |
| Dashboard / My Progress: View all | `/workspace/learner/dashboard` (selected learner path in staff previews) |
| Attend or Report Absence | `/learner/attendance` |
| Book for Monthly Coaching Session | `/learner/monthly-coaching` |
| Upcoming: View all | `/learner/calendar` |

The landing header is a plain purple band, with no logo, navbar, search,
notifications or account menu. Internal navigation is available after opening
Dashboard. Landing actions, event links and retry buttons have visible colour
changes on hover and keyboard focus.

Upcoming keeps three fixed rows: the nearest lecture, nearest incomplete
assignment deadline, and nearest Progress Review (`source: progress-review`).
Each category is selected independently, including reviews further ahead than
the next few lectures. Checkpoints, monthly coaching and student support do not
replace an assignment or review. Past and inactive events are excluded using
UK dates/times; a booked review uses its scheduled date/time, otherwise its
planned target date is labelled as needing booking. Missing categories retain
their row with no invented date, and a source failure offers retry.

The Dashboard account menu offers **Previous learning record** only when
`GET /audit_api/old-otjh/workspace-link/` confirms an existing record. Learners
always get `/old-otjh/months`; the server rejects supplied learner identities.
Staff previews resolve the selected enrolment ID through the existing record
permissions and open that learner's months with `?workspace=learner`, preserving
the selection across month navigation without the staff directory or sidebar.
New learners receive no link and return home from direct monthly-record URLs.
Learner calls to staff directories remain forbidden server-side.

## Visual assets

Reference project:
<https://lovable.dev/projects/4be72778-57e9-4ba3-95ae-5b21f2852583>.
Its current implementation is a flattened page image and demonstration hotspots.
The earlier source names `src/assets/kent-canterbury.jpg`, but its binary could not
be recovered through the available source connector.

`frontend/public/assets/student-home/approved-reference.png` preserves the
reference. `ReferenceIcon.tsx` renders only the five original shield icons and
the gold laurel from bounded image windows, masking their backgrounds with SVG
filters. Action icons inherit the link colour so hover and focus remain visible.
`canterbury-background.png` was reconstructed from that reference using image
generation to remove the baked-in interface and restore obscured scenery. It is
not represented as the original separate background asset.

The shield, text, progress ring, cards and all controls are real HTML/CSS/SVG.
Desktop composition, purple/gold colours and serif typography follow the
reference, with responsive layouts for smaller screens. Shield ornamentation,
some shapes/type and reconstructed scenery remain approximate. Exact asset-level
matching would need recoverable original background/shield artwork.

## Verification

### My Progress card

The landing uses `overview-week/:kind/:id/?section=home`. Its `homeProgress`
payload is read-only and protected by the existing learner-self/staff permission.
It shares the assigned activities and delivery dates already loaded for Upcoming.

- OTJ Progress uses **all assigned activity hours**, including future activities,
  for Total Planned. Explicit legacy/Builder links prevent duplicate hours.
  Missing planned hours yield an unavailable percentage and a visible note.
- Completed (Actual) combines the accepted historical ledger with current
  recorded activity hours, retaining earned time if curriculum activities are
  later archived or replaced. Assignment submissions are counted once: pending
  review in Submitted, accepted/partially accepted in Actual. Drafts and returned
  work do not contribute assignment hours. Imported submissions are already
  represented in the historical ledger.
- Activities and assignments use scheduled delivery dates from the recorded
  programme Start Date through Sunday of the current **Europe/London** week.
  Lectures use the learner's attendance register over that same period;
  present/late count as attended, scheduled sessions count in the denominator.
- Modules cover the whole assigned programme. Empty assigned modules remain in
  the denominator and cannot be marked complete. Export-linked modules merge by
  identity, not title.
- Missing start dates/attendance do not become zeroes. Undated activities are
  excluded from period counts with a note, but remain in whole-plan totals.
  Future start dates show `Starts …` with zero period counts.

The ring distinguishes Actual (gold) and Submitted (purple), with hours shown
beside their labels. It refreshes on the existing 30-second/focus/invalidation
cycle. The four detail rows link to the learner's learning, submissions and
attendance screens.

Focused verification: `learner_api.tests_home_progress`,
`learner_api.tests_overview_week`, `learner_api.tests_dashboard_metrics`, and
the frontend home tests. A read-only call against Ayman's current enrolment
also confirmed the payload; it did not change learner records or submit work.

- Django: `old_otjh.tests_entry old_otjh.tests` — **99 passed**, using SQLite test
  settings and mocked repositories; no production signing. Coverage includes
  classification, failed lookups, exact version selection, record ownership,
  protected direct/batch API calls, CSRF, failed saves, duplicates/concurrent
  completion and retained signature evidence.
- Vitest: the nine focused entry, routing, home, existing signing and auth test
  files — **105 passed** in the final focused run.
- Targeted ESLint passed; production Vite build passed.
- `scripts/student-home-smoke.mjs` passed at 1920×1080, 1280×800, 1024×768,
  390×844 and 320×740.
  It checks authenticated identity, all five action hit targets, horizontal
  overflow, blocked direct navigation, Escape resistance and keyboard focus.
  All API responses in this browser test are isolated fixtures. Screenshots are
  in `frontend/test-results/student-home/`; their sample name/progress are test
  fixtures only.
- Full-project TypeScript checking is separate from Vite's successful build;
  12 existing errors in admin/users, curriculum, video-watch tests and user
  directory files prevent a clean project-wide result.
- `git diff --check` passed. No commit, push, pull or PR was created.

A real learner/provider end-to-end signing operation was not performed. The
existing persistence service is covered by focused tests; production database
connectivity and deployment remain outside this local verification.
