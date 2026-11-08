# EPA Feedback

Implemented on 2026-11-07 on the existing `feedback-ahmed-ali` branch.
Scope: a new learner-only feedback type, using the existing review deliveries,
learner form/response routes, permissions, version history and reporting.

## Eligibility

Staff create and publish a `post_epa_review` form, displayed as **EPA Feedback**.
A source row qualifies only when its complete `review_name` is Gateway Review
(surrounding whitespace/case ignored) and the review is completed. Its
`review_type` is not the selector. Similar names such as Gateway Review 1 or
Pre Gateway Review do not match.

EPA requires an explicit Completed source status (including its existing source
metadata fallback), or the verified linked LMS overlay's completed status.
A populated completion date on an AwaitingSignature, In Progress, Scheduled or
Not Scheduled source does not by itself send EPA feedback. The existing source
identity bridge and cross-learner/legacy ambiguity checks still apply.

The earliest reliable completion, including original completion before a reopen,
must be on or after this EPA template's first `published_at` and not in the
future. Undated completions are reported, never replaced with observation time.
Existing historical completions are not backfilled.

The existing unique source-review delivery key enforces once per review. New
form versions, retries and reopening/recompletion preserve the original form,
completion instant and response. Gateway names select EPA before PR/MCM types;
they do not fall back to those forms if no EPA template is published, and do not
create employer deliveries. Existing deliveries/history are not reassigned.

## Discovery and UI

LMS imported-review completions reconcile after commit. Completion scheduling
cannot exclude a source solely by its template family, because EPA is selected
by the persisted name. The worker verifies identity/name/type and published
templates; unrelated completed reviews still create no feedback assignments.
The central migrated-review families, calendars, bookings, signatures and Teams
behavior were not changed.

For Aptem changes, the source must first reach `Learner.reviews`. The existing
learner feedback read or explicitly scoped `sync_review_feedback --learner-id`
command then reconciles it. No new periodic job or direct Aptem webhook was added.

EPA is available in Form Builder, fixed-question spreadsheet import, scoring,
staff recipients/versions, feedback analytics/classification and the learner's
EPA filter. It opens via the existing owned review-delivery route. Start,
submission, read-only staff/admin preview and Back preserve `category=epa`.

## Schema and release

- Migration: `migrations/0012_epa_review_feedback.py`, after public-lecture `0011`.
- Manual equivalent: [2026-11-07_epa_review_feedback.sql](../sql/2026-11-07_epa_review_feedback.sql).
- This adds the allowed form type to the existing form check and migration state;
  no new table or historical assignment/data update is needed. Every previously
  supported type, including employer PR and module forms, remains allowed.
- Manual SQL runs inside a transaction with timeouts and read-only verification.
  A later normal Django migration can repeat it; do not fake migration records.
- No change has been applied to the application database or deployed to the site.
  After review/merge, verify the target database and backup/restore point, apply
  the migration, build the frontend and deploy/restart using the repository policy.
  Then create/publish the EPA form before the eligible review completes.
- Rollback retains the additive allowed type and existing feedback history; no
  destructive reverse operation is performed. Do not rerun older type-check SQL.

## Verification

Backend (from `backend`; inspected SQLite-only settings, mocked external I/O,
disposable SQLite files for ORM/concurrency cases):

```powershell
.\.venv\Scripts\python.exe manage.py test engagement_api.tests_epa_feedback_schema engagement_api.tests_feedback_visibility engagement_api.tests_review_feedback engagement_api.tests_employer_feedback engagement_api.tests.FeedbackValidationTests engagement_api.tests_module_feedback engagement_api.tests_event_feedback engagement_api.tests_post_lecture_bank engagement_api.tests_public_lecture_feedback engagement_api.tests_feedback_question_scoring engagement_api.tests_feedback_analytics --settings=config.settings_sqlite_test --noinput
```

PASS: 274 tests. Covers exact-name matching independent of source type, explicit
completion, local/source parity, metadata, launch dates, reopening/history,
learner identity, independent sources, no employer delivery, version pinning,
shared MCM/PR/module/event/public-lecture paths and reporting.

Real PostgreSQL schema check (from repository root):

```powershell
.\backend\.venv\Scripts\python.exe backend/scripts/validate_epa_feedback_postgres.py
```

PASS: five checks: migration execution, old types/history preserved, EPA allowed,
unknown types rejected, repeated migration/manual SQL preserve history. The
script initializes a fresh temporary PostgreSQL 18 cluster, chooses a loopback
port and verifies directory/role/address/database before writing. It loads no
Django or application environment configuration, stops/removes its own cluster,
and never accesses the application database. Windows sandbox token restrictions
required execution outside the sandbox. This validates DDL against synthetic
fixtures, not the state of the production database.

Frontend (from repository root):

```powershell
npm.cmd --prefix frontend test -- --run --maxWorkers=1 src/pages/learner/feedback/page.test.tsx src/pages/learner/feedback/form/page.test.tsx src/features/feedback/FormBuilder.test.tsx src/features/feedback/FormBuilder.fixedImport.test.tsx src/features/feedback/FeedbackDashboard.test.tsx src/features/feedback/FeedbackInsights.test.tsx src/pages/employer/EmployerFeedbackPage.test.tsx src/api/feedback.test.ts src/api/employerFeedback.test.ts src/router/__tests__/learnerFeedbackFlag.test.tsx src/lib/__tests__/routeAccess.test.ts
npm.cmd --prefix frontend run type-check
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
git diff --check
```

PASS: 150 tests across 11 files; type-check, lint and production build PASS.
The build completes with dependency eval/chunk/plugin timing warnings.
Headless installed Chrome/Playwright opened the static production build with all
API responses mocked and external requests blocked: EPA filter → owned delivery
→ submit PASS. Desktop queue and initial 390px mobile form screenshots were
inspected; no horizontal overflow on the mobile form. Live authentication,
learner responses, mail, invitations or external storage were not exercised.

Teams baseline / expanded backend Teams checks: NOT REQUIRED (no listed Teams
file or imported function/response changed). Live Teams: NOT RUN.
