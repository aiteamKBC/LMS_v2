# Progress Review – Employer Feedback

Implementation date: 2026-11-03. Current branch: `feedback-ahmed-ali`.
Review/merge and production deployment remain pending.

## Agreed behavior

- Staff create and publish an independent `post_progress_review_employer` form.
  Its questions and responses are separate from the learner's existing PR form.
- PR and PR (+ Skills Radar) completions use the existing verified enrolment /
  LearnerProfile identity bridge and earliest completion rules. MCM, standalone
  Skills Radar, incomplete/undated reviews and historical completions are excluded.
- Each template's first `published_at` is its own launch boundary. Publishing an
  employer form does not backfill reviews completed before it. A student delivery
  does not suppress an eligible employer delivery, or vice versa.
- One employer assignment per source review is enforced by the database UNIQUE
  constraint and `get_or_create`. Retries and reopening/recompleting a review
  preserve the original template, respondent and answers.
- Employer submissions appear at `/employers/:employerId/feedback`; the new
  sidebar item leads to this queue. Each entry names the learner and review.
  Start/Continue/View opens `/employers/:employerId/feedback/:deliveryId`.
  Required questions, draft saving, autosave, photo answers and submission rules
  use the existing feedback validation/presentation code.

## Employer identity and pending work

`enrolment.Created_users.Employer_id` is the primary reference to
`enrolment.Employers.id`. The `Employer` text is a display label. When no explicit
ID exists, the normalized `Employer_email` may resolve exactly one employer
profile; ambiguous emails are never guessed. An invalid explicit ID cannot fall
back to a different employer by email. A matching active employer login account
must exist. The new service never creates accounts or sends invitations/email.

Missing profiles/accounts create durable pending assignments in
`Feedback.feedback_employer_review_deliveries`. Staff see them under Assigned
employers with `Pending link`, the employer contact and related learner/review.
Completion of the learner's own assignment is independent. Pending assignments
retain their original form even if a new version is published before resolution.
The scoped reconciliation command reports employer counters, including
`employerPending`.

Pending resolution runs after committed review completion, on learner feedback
reconciliation, on the employer queue, or via the existing explicitly scoped
`sync_review_feedback --learner-id=...` management command. Employer queue reads
also discover imported completions for learners linked by `Employer_id` or a
candidate `Employer_email`; resolution still requires a unique verified account.
No periodic job or direct Aptem webhook was introduced. Once a recipient is
resolved it is pinned; a later employment change cannot transfer old answers.

Every employer API checks the authenticated account and assigned employer ID.
Request-body learner/employer IDs or names cannot select the respondent. Staff
and admins may preview but cannot submit or upload as the employer. Learners
cannot read or modify employer answers/photos, including their own related PR.
CSRF remains required for writes. Private photos use the same owner check.

## Migration and release

`migrations/0010_employer_review_feedback.py` adds the separate employer delivery
table, nullable response FK and unique response index. It updates the general
response index predicate to exclude employer responses, and preserves every
existing supported form type in the form-type check. No review/response history
is inserted, reassigned or deleted by the migration. Reverse data operations
are intentionally no-ops so rollback does not delete feedback history.

For manual SQL execution, use
[`../sql/2026-11-03_employer_review_feedback.sql`](../sql/2026-11-03_employer_review_feedback.sql).
Its schema body matches the migration exactly, wrapped in a transaction with
timeouts and followed by read-only verification queries. It does not mark the
Django migration applied: subsequently run the normal migration mechanism,
without `--fake`; the schema operations are safe to repeat. This file has not
been executed on an application database by the agent.

The schema has **not been changed on the application database**. Only read-only
column metadata was inspected to verify the existing employer contact fields.
SQLite regression tests verify ORM uniqueness/concurrent recognition and the
migration graph/state; they do not prove the PostgreSQL DDL runs successfully.
PostgreSQL execution is **NOT RUN**: there is no verified disposable PostgreSQL
target locally, and the installed Docker CLI has no running daemon. A real
PostgreSQL migration check remains a release prerequisite.

Before release: review/merge the scoped change, confirm the intended database
and a backup/restore point, test/apply the migration using the established
deployment mechanism, build the frontend and restart the backend together.
Use migration `0010_employer_review_feedback` rather than rerunning older SQL
files that replace the supported form-type constraint. The employer template
must then be created and published before new reviews complete.

Rollback: retain the previous main revision/build; roll application code back
through the reviewed deployment process and leave the additive schema/data in
place. No destructive reverse migration or history rewrite is needed.

## Verification

Backend (from `backend`, SQLite-only settings checked before execution; all
external I/O mocked, concurrency fixtures use temporary local SQLite files):

```powershell
.\.venv\Scripts\python.exe manage.py test engagement_api.tests_employer_feedback engagement_api.tests_feedback_visibility engagement_api.tests_review_feedback engagement_api.tests.FeedbackValidationTests engagement_api.tests_module_feedback engagement_api.tests_event_feedback engagement_api.tests_post_lecture_bank engagement_api.tests_feedback_question_scoring engagement_api.tests_feedback_analytics --settings=config.settings_sqlite_test --noinput
```

PASS: 240 tests. Covers separate assignment paths, launch boundaries, missing
accounts, email ambiguity, source identity conflicts, pending retries/version
pinning, concurrent completions, role/record ownership, forged identity, private
photos, CSRF, migration state, shared learner/event/module flows and analytics.

Frontend (from repository root):

```powershell
npm.cmd --prefix frontend test -- --run --maxWorkers=1 src/pages/employer/EmployerFeedbackPage.test.tsx src/pages/employer/employerPortalNav.test.tsx src/api/employerFeedback.test.ts src/api/feedback.test.ts src/features/feedback/FormBuilder.test.tsx src/features/feedback/FormBuilder.fixedImport.test.tsx src/pages/learner/feedback/page.test.tsx src/pages/learner/feedback/form/page.test.tsx src/pages/employer/employerDashboardData.test.ts src/features/feedback/FeedbackDashboard.test.tsx src/features/feedback/FeedbackInsights.test.tsx src/lib/__tests__/routeAccess.test.ts
npm.cmd --prefix frontend run type-check
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
git diff --check
```

PASS: 160 tests across 12 files on the final frontend state. TypeScript, lint,
production build and `git diff --check` also PASS. The production build emits
dependency eval/chunk/plugin timing warnings but completes successfully.

Browser review: the production build was served locally as static files and
opened with headless installed Chrome through Playwright. Every API request was
intercepted with synthetic fixtures and external requests were blocked. Queue
to Start to Submit passed. Desktop and final 390px mobile screenshots were
inspected; the mobile form had no horizontal overflow. This validates the UI
with mocked transport, not live database/authentication behavior.

Teams baseline and expanded backend Teams checks: NOT REQUIRED; no listed Teams
file, imported function or response contract was changed. Live Teams: NOT RUN.
No real learner/employer answers, notifications, invitations or external storage
were created by these checks.
