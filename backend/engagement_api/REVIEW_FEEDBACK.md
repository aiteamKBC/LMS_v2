# Imported Review feedback

`feedback._sync_review_feedback_deliveries` delegates to `review_feedback`.
The previous implementation read only `"Learner".reviews`, required exact
`Completed` status and matched only two exact type labels.

## Eligibility and identity

- MCM Feedback accepts the central `MCM` family: Monthly Coaching Meeting,
  Monthly Coaching and MCM.
- Progress Review Feedback accepts `PR` and `PR_SKILLS_RADAR`: Progress Review
  and Progress Review (+ Skills Radar). Their Review templates, signatures and
  completion rules remain separate. Standalone Skills Radar and other Reviews
  do not qualify. Classification trims surrounding whitespace and case-folds;
  it never matches substrings.
- Aptem completion uses the existing status normalizer (including Complete and
  Finished), source metadata fallback, or a valid completion date. Local LMS
  completion uses the linked ImportedReviewInstance's completed status.
- Link by source_review_id = reviews.id and check Profile identity. Legacy
  instances without source_review_id use the existing exact imported event key
  resolver. Ambiguous/unlinked cases produce counts and a warning, never a
  guessed association.
- Review rows and overlays use LearnerProfile IDs. Feedback recipients use
  Created_users/enrolment IDs. The existing verified identity bridge translates
  between them, including apprenticeship/commercial records.

Each source's state/date stays separate. The earliest known completion,
including the original `reopenCompletedAt`, must be on or after the matching
Feedback template's `published_at`. Reopening never creates a second delivery.
If completion is known but its date is missing/invalid, eligibility cannot be
proved: report `undated` and wait for reliable evidence. Neither `updated_at`
nor observation time substitutes for a completion date. Date-only imports use
business-zone midnight; explicit offsets retain their actual instant.

The existing database UNIQUE constraint on
`Feedback.feedback_review_deliveries.source_review_id`, together with ORM
`get_or_create`, is the durable once-per-Review marker. Concurrent detection,
retry or a subsequent Aptem completion cannot deliver the form a second time
or replace its pinned template/response. Existing deliveries are not rewritten.

## Discovery and retry timing

`review_feedback_signals` registers after Django app loading. A completed LMS
overlay save registers reconciliation after that save's transaction commits.
Rollback produces no Feedback. The existing learner Feedback release flags are
respected. A failed database callback emits a pending warning; committed Review
state remains available for reconciliation.

The learner Feedback list reconciles both persisted sources when opened. There
is no direct live Aptem request or assumed webhook. The codebase contains
readers of the imported rows but no identified writer for the Aptem status/date
import, so this change does not install an import hook or periodic job. Aptem
changes become eligible only after the import reaches `Learner.reviews`, then
the next Feedback page read or explicitly scheduled/scoped command discovers
them. Post-commit callbacks alone are not a guaranteed background delivery
system; the durable Review rows plus reconciliation are the recovery path.

For an import pipeline or recovery run, after verifying the target environment:

```powershell
# From backend; IDs are enrolment/Created_users IDs, not Profile IDs.
.\.venv\Scripts\python.exe manage.py sync_review_feedback --learner-id=71 --learner-id=72
```

The command prints counts only (`created`, `existing`, `incomplete`,
`historical`, `undated`, `future`, `unlinked`, `identityConflicts`). It requires
explicit learner IDs and never sends notifications, invitations or mail.
No new SQL migration is required; the existing reviewed Feedback Review schema
and its unique source_review_id constraint must already be installed. Do not
rerun older form-type constraint migrations over newer schema releases.

## Local checks

`tests_review_feedback` covers both sources, aliases/exclusions, metadata,
business dates, different identity namespaces, legacy ambiguity, history,
reopening, retries, concurrent creation and commit/rollback. Source reads are
mocked. ORM race checks create only a temporary local SQLite database, guarded
to refuse any non-SQLite test configuration. No live database or external
service is used. SQLite proves these ORM/constraint cases, not live PostgreSQL
availability or the external Aptem import schedule.

## Verification record — 2026-10-29

Changed files: `review_feedback.py`, `review_feedback_signals.py`,
`management/commands/sync_review_feedback.py`, `apps.py`, `feedback.py`,
`tests_review_feedback.py`, `tests.py`, and this document. The former
SQL-shape-only publish-boundary test in `tests.py` moved to the new suite as
behavioral checks covering before/equal/after publication, both sources and
reopened history. Existing response, permission and visibility tests remain.

From `backend`, feature checks **PASS — 111 tests**:

```powershell
.\.venv\Scripts\python.exe manage.py test engagement_api.tests_review_feedback engagement_api.tests.FeedbackValidationTests engagement_api.tests_event_feedback engagement_api.tests_feedback_visibility engagement_api.tests_module_feedback --settings=config.settings_sqlite_test --noinput
```

Expanded shared-consumer checks **FAIL — 335 tests; one booking test failed in
two subcases**. It sends `scheduledDate=2099-11-19` and expects source rejection
409, but the unchanged MCM booking-window validation returns 400 first. No
booking rule or assertion was modified. This run used only SQLite and an
in-process cache; exact command:

```powershell
.\.venv\Scripts\python.exe -c "import os, sys; sys.argv=['manage.py', 'test']; os.environ['DJANGO_SETTINGS_MODULE']='config.settings_sqlite_test'; from django.conf import settings; assert all(c['ENGINE']=='django.db.backends.sqlite3' for c in settings.DATABASES.values()); from django.test.utils import override_settings; isolated_cache=override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}); isolated_cache.enable(); import django; django.setup(); from django.core.management import call_command; call_command('test', 'engagement_api.tests_review_feedback', 'engagement_api.tests', 'engagement_api.tests_event_feedback', 'engagement_api.tests_feedback_visibility', 'engagement_api.tests_module_feedback', 'engagement_api.tests_feedback_analytics', 'engagement_api.tests_feedback_question_scoring', 'coach_api.test_review_categories_no_db', 'coach_api.test_review_source_selection_no_db', 'coach_api.test_review_source_separation.ReviewSourceSeparationTests', 'learner_api.tests_review_history', interactive=False)"
```

Additional PDF regression **BLOCKED by environment**: one attempted test errors
with `ModuleNotFoundError: reportlab`. The dependency is declared in
`backend/requirements.txt`; no dependencies were changed or installed.

```powershell
.\.venv\Scripts\python.exe manage.py test coach_api.tests_migrated_completion.MigratedReviewCompletionTests.test_pdf_uses_saved_answers_signatures_and_lms_provenance --settings=config.settings_sqlite_test --noinput
```

`git diff --check`: PASS. Frontend checks, Teams baseline and expanded Teams
checks: NOT REQUIRED (no Teams file or imported Teams API/function was changed).
Live Teams/Aptem validation: NOT RUN. No application/production database writes,
schema changes, release-flag changes, commit, push or deployment were performed.
Review/deployment remain pending; the expanded failure and PDF prerequisite
remain outstanding rather than being reported as a fully green regression run.
