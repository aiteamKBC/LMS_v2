# Imported Review Feedback discovery — 19 November 2026

## Cause and supported types

The repository previously had a post-commit `ImportedReviewInstance.post_save`
hook, learner Feedback page reconciliation, employer reconciliation, and an
explicit learner-ID command. None discovers a committed external SQL/bulk import
without a subsequent caller. The actual writer of `Learner.reviews` was not found
in this workspace; its location cannot be established from the supplied files.
The learner-details GitHub workflow and Advanced Admin PDF synchronization are
not that writer. Django `post_save` is not an integration point for SQL/bulk writes.

The supplied 428/137/53/51 figures and form 54 are a reference snapshot, not live
measurements performed for this change. No implementation uses those constants.

The shared service continues to select MCM, PR (including Skills Radar variants),
EPA by the full Gateway Review name, and independent employer PR. Other Feedback
types, recipients-dialog defaults and email/notification delivery are unchanged.
Completed-before-publication exclusions, actual/earliest completion, reopening,
business timezone, identity conflicts, unique source IDs and pinned forms remain
in the authoritative service. No response/history rewrites or migrations were added.

## Local implementation

- `review_feedback_reconciliation.py`: page through distinct imported Profile IDs
  in batches of 100 (configurable 1–1000 for the command), translate through the
  existing trusted Profile → Enrolment bridge, and call `sync_review_feedback`.
  Discovery has no parallel status/type/date definition and no persistent
  watermark that could miss updates to older rows or late dates. An uncommitted
  caller transaction is rejected. Failures and ambiguous links are counted;
  other profiles continue and failed sources remain available next sweep.
- `review_feedback_scheduler.py`: real ASGI/WSGI HTTP wrappers start a daemon
  thread after fork, using the project's existing scheduler pattern. First sweep
  follows a normal HTTP request plus 60 seconds; subsequent sweeps start 300
  seconds after the previous pass. ASGI health-only traffic does not start it. No
  management/test import starts a thread. A running server is required, and
  time spent processing a sweep adds to detection latency. Source volume and
  production sweep duration have not been benchmarked.
- Each scheduled profile uses a short transaction and
  `pg_try_advisory_xact_lock(hashtextextended(...))`. Busy profiles are skipped
  for that pass, and claims release on commit, rollback or process/connection
  loss. No session lock is held across pooled transactions. ORM uniqueness still
  prevents duplicates from the other paths, including an Aptem/LMS completion race.
- `review_feedback.py`: opt-in `dry_run` uses the same eligibility decisions,
  reports `wouldCreate` and `employerWouldCreate`, and performs no assignment or
  employer-link writes. The default service behavior is retained.
- `sync_review_feedback`: explicit `--discover`, bounded batch size, `--dry-run`
  and exact `--source-review-id` scope. Source IDs require exactly one enrolment
  learner ID; IDs are not interchangeable with Profile IDs. Discovery prints
  partial counts and exits unsuccessfully if any profile failed.

The external importer can optionally invoke the scoped command **after its own
commit** for faster detection, but no external importer was edited or linked here.
Scheduled committed-source discovery is the integrated recovery path without
that optional hook. There are no new services, queues, schema tables or emails.
No `.env`, deployment configuration, production checkout, staging area or Git
commit was changed.

## Existing-case recovery plan (not executed)

1. Verify the intended database/environment and produce a fresh read-only roster
   of candidate source Review IDs, their trusted Enrolment IDs, completion evidence,
   matching form publication, overlays/reopening dates, and existing learner/employer
   deliveries. Recompute the scope; do not assume the original 51 still qualify.
   Keep learner-identifying rosters outside the public repository and logs.
2. Preview each verified learner's exact source IDs using the same service. Example
   IDs below are synthetic; from `backend`:

   ```powershell
   .\.venv\Scripts\python.exe manage.py sync_review_feedback --learner-id=71 --source-review-id=9001 --source-review-id=9002 --dry-run
   ```

   Review `wouldCreate` and `employerWouldCreate` separately, together with
   historical/undated/future/conflict counts and existing pending employer links.
   A dry-run does not predict how many new employer assignments will have valid
   accounts; normal creation may preserve them as pending. It does not mutate
   existing pending links. With multiple learners, run one exact source-ID group
   per verified learner. A broad optional preview is `--discover --dry-run`.
3. Actual live reconciliation needs the separate explicit instruction required by
   the task. Then rerun only the approved groups without `--dry-run`. Retry failed
   groups; unique source IDs preserve original forms and prior responses.
4. Verify persisted deliveries and their owners/form IDs, unchanged responses,
   once-per-source counts and pending employer results. Repeat the preview to
   confirm newly processed groups report existing rather than would-create.

**Release consequence:** activating the automatic sweep also processes currently
eligible outstanding imports. It cannot exclude the old incident rows while
preserving the same eligibility rules. Review the preview and authorize that
effect before activating a reviewed deployment; the operational opt-out is
`REVIEW_FEEDBACK_SCHEDULE=false`. No live preview, recovery or activation was run
in this task, and no settings file was changed to apply an opt-out.

## Validation and limits

All Django runs explicitly used `config.settings_sqlite_test`, which forces and
verifies SQLite aliases. Existing source/identity/external APIs were mocked.
Transaction/race tests created disposable local SQLite files only; no application
database, Aptem, Teams, mail or storage was accessed for validation.

From `backend`:

```powershell
.\.venv\Scripts\python.exe manage.py test engagement_api.tests_review_feedback_reconciliation engagement_api.tests_review_feedback config.test_health_no_db config.test_load_metric_no_db config.tests_asgi_disconnect coach_api.test_dashboard_snapshot_scheduler_no_db --settings=config.settings_sqlite_test --noinput
```

**PASS: 98 tests.** Covers committed new/imported-updated rows, late dates, SQL
batch updates/re-imports, rollback, post-failure retry, supported types including
independent employer PR, authoritative exclusions, publication/date/timezone and
reopening rules, original template retention, ORM uniqueness/concurrent workers,
trusted ID translation, dry-run, profile claim requests and transaction commit
failures, runtime loop retry, real entrypoint wiring, HTTP/websocket pass-through,
health/load-metric and existing dashboard scheduler behavior. PostgreSQL lock SQL
is mocked here; actual PostgreSQL/transaction-pooler behavior and production
import/sweep latency have not been tested live.

The wider command adds `engagement_api.tests_employer_feedback` and
`engagement_api.tests_feedback_visibility` to the above set:

```powershell
.\.venv\Scripts\python.exe manage.py test engagement_api.tests_review_feedback_reconciliation engagement_api.tests_review_feedback engagement_api.tests_employer_feedback engagement_api.tests_feedback_visibility config.test_health_no_db config.test_load_metric_no_db config.tests_asgi_disconnect coach_api.test_dashboard_snapshot_scheduler_no_db --settings=config.settings_sqlite_test --noinput
```

**FAIL: 146 tests, 144 passed, one failure and one error.** Two unrelated existing
Employer tests fail:

- `test_migration_state_resolves_the_new_delivery_and_response_relation`: the
  SQLite settings disable curriculum migrations while learner migration
  dependencies reference them (`0087_free_course_compatible_fields` or another
  missing curriculum node depending on migration loader traversal).
- `test_shared_response_validation_preserves_independent_employer_identity`:
  the existing quality-ticket path queries FeedbackAnswer without a mock in a
  SimpleTestCase, so Django correctly refuses database access.

Both were reproduced independently after executing the unchanged HEAD version
of `review_feedback.py` in memory, with the same two test labels and SQLite
settings. No files were stashed/reverted and no tests, mocks, assertions or global
settings were weakened to force a pass. These failures remain outstanding.

`git diff --check`: PASS. Frontend checks: NOT REQUIRED (no frontend changes).
Teams baseline and expanded Teams checks: NOT REQUIRED; no listed Teams file
or a contract consumed by one changed. Live Teams: NOT RUN. Required review and
deployment through merged main remain outstanding; no claim of full-suite or
production readiness is made.
