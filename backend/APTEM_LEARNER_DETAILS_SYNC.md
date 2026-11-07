# Aptem learner details reconciliation

This change reconciles existing LMS learners with the imported Aptem identity,
programme state and programme dates. It never creates learners, login accounts, invitations,
activities, training plans or meetings.

## Confirmed source contract

The separate [API-for-aptem importer](https://github.com/aiteamKBC/API-for-aptem/blob/main/api/views.py)
deliberately splits the learner population:

- `LMS.Aptem_users`: `Active` / `OnBreak`, full subscriptions.
- `LMS.non_active_users`: other non-null programme states, full subscriptions.

Both sources must be read. An absent record in the first table is not evidence
of withdrawal. The importer removes records which leave each filtered result,
so a learner moving between categories must be found by Aptem ID in the other
table. A duplicate ID across the two imports is reported rather than resolved
by source order.

The [importer's scheduler](https://github.com/aiteamKBC/API-for-aptem/blob/main/api/scheduler.py)
specifies a six-hour interval. Its
[cron installation script](https://github.com/aiteamKBC/API-for-aptem/blob/main/setup_cron.sh)
also specifies `0 */6 * * *`. This verifies the source-code configuration;
the installed server schedule and its recent successful runs were not inspected.

The Coach Caseload reads `Learner.learners`, including its own name and
`programme_status`. Updating an import table alone does not refresh those
delivery records or the enrolment/account names.

## Update policy

`learner_api.aptem_learner_sync` plans only changes to:

- `Created_users.Username` and `Programme_status`;
- `Learner.learners.full_name`, `programme_status`, `lifecycle_status`;
- an existing learner login's `Display_name`.

The requested date extension also reconciles `Created_users.Start_date` /
`End_date` and `Learner.learners.start_date` / `end_date` with imported
`Start-Date` / `End-Date`. This applies to every matched local learner regardless
of programme status, including Active and Withdrawn. Date reconciliation is
independent of name/status availability.

Missing or omitted imported dates never clear existing dates. Invalid dates,
reversed/zero-length windows, or a partial source window that conflicts with a
preserved local date produce review counts instead of a guessed write.
Equivalent calendar dates are compared as dates, without converting through the
workstation time zone or rewriting a correct textual date just for formatting.
The distinct `Learner_start_date` / `Learner_end_date` header overrides are not
changed: they anchor reviews and have a separate established business contract.

The command updates timestamps only on records which actually change. Its ORM
writes use the existing audit registration. Matching uses a strict positive
bigint Aptem ID, then the exact `enrolment_id` and learner account subject link.
When the enrolment Aptem ID is absent, a single existing profile's Aptem ID can
supply the bridge only through its exact `enrolment_id`. An invalid supplied
enrolment ID is never hidden by that fallback. Neither identity field is
backfilled or rewritten. Matching does not fall back to names or shared email
addresses. Conflicting profile IDs, duplicate import/enrolment/profile/account
links (including direct-versus-profile ID claims) and missing source records
are reported without guessing a match.

Explicit withdrawal maps to `Withdrawn`, break aliases to `On break`, completion
to `Completed`, and EPA to the existing imported `EnteredEpa` label. Names
follow the imported name without clearing an existing name when the source is
blank. Unknown or missing statuses are reported; a valid name can still sync.

The agreed LMS activation rules remain authoritative:

- Aptem `Active` cannot activate an uninvited or unready LMS learner.
- Aptem onboarding/readiness does not rerun or reset local onboarding.
- An external later stage cannot release a local pre-start learner.
- A break cannot reopen a withdrawn/completed/EPA/non-starter record.
- An external active state cannot reopen a local withdrawal or break.
- EPA cannot regress a completed learner.

These intentional differences are counted as `preserved.local_lifecycle`.
They are distinct from missing/ambiguous information in `review`.

The command locks the existing target records and source rows during an apply,
updates the permitted fields in one database transaction, and queues the
existing Coach Dashboard outbox boundary when that feature is enabled. Dashboard
cache invalidation is registered after commit. Existing caseload response TTLs
and the legacy dashboard snapshot refresh still apply; this is not a promise
that every already-open browser updates immediately.

Multi-learner writes group identical field sets into batches of at most 200
rows, retaining each row's own values in parameterized CASE expressions. The
existing audited queryset `update` path records before/after values. A row with
no imported end date cannot accidentally acquire another row's end date or have
its existing value cleared.

## Running and scheduling

Run from `backend`, using the established backend interpreter and environment.
Verify the actual database/branch first. No `.env` changes are required by this
implementation.

```powershell
# Compare all locally existing linked learners; no writes.
python manage.py sync_aptem_learner_details --all

# Apply all unambiguous, supported changes. Never creates missing learners.
python manage.py sync_aptem_learner_details --apply --all

# A scoped check/apply; the example ID is synthetic.
python manage.py sync_aptem_learner_details --aptem-id 10001
python manage.py sync_aptem_learner_details --apply --aptem-id 10001

# One supervised worker, checking the imported tables every 15 minutes.
python manage.py sync_aptem_learner_details --apply --all --watch --interval-seconds 900
```

Deploy the worker only from reviewed merged main through the established LMS
deployment process. Run one supervised instance. No watcher was installed or
left running during development. The fifteen-minute poll reads the local
mirrors; it does not repeat the Aptem activity import or replace the upstream
six-hour job. An existing scheduler can instead invoke the one-shot command
after both import categories finish successfully.

One-shot apply exits nonzero with a `Partial sync` message if valid changes
commit while unresolved records remain. Its JSON report distinguishes the
committed changes and review counts. The watcher logs that condition and retries
on its next poll. A database error rolls back the whole write cycle. Empty
source tables never imply mass withdrawal. Watch mode requires explicit apply
scope and a polling interval of at least sixty seconds.

The command is included in `config.management_safety.reconciliation_command`,
so management-command startup cannot begin curriculum warmers/schema writers.
That helper is also called by a listed Teams file, which triggers the Teams
regression gate for this task despite no intended meeting behavior changes.

## Validation and remaining release gates

Validation on 7 November 2026:

- Frontend Teams baseline: `npm --prefix frontend run test:teams` — **147 passed**
  across nine files, with existing API doubles.
- Backend feature and applicable isolated checks: **77 passed**, using
  `config.settings_sqlite_test`, `django.test.runner.DiscoverRunner`, exclusively
  SQLite aliases, process-local cache and a guard denying external network IO.
  Selected labels were `learner_api.tests_aptem_learner_sync`,
  `learner_api.tests_aptem_status`, `learner_api.tests_status_profile_sync`,
  `learner_api.tests_account_identity_sync`,
  `coach_api.test_dashboard_hidden_learners_no_db`,
  `coach_api.test_reconciliation_safety_no_db.ReconciliationStartupTests`,
  `curriculum_api.tests.TeamsMultiDayRecurrenceTests`,
  `curriculum_api.tests.TeamsAttendanceRosterTests`, and `coach_api.tests_errors`.
- Direct runtime checks:
  `.\.venv\Scripts\python.exe -m unittest curriculum_api.test_session_sync_runtime_no_db`
  from `backend` — **32 passed**.
  This suite requires its direct unittest runner. Initially combining it with
  `manage.py test` caused six startup-guard assertions to fail because the suite
  intentionally detects `test` in `sys.argv`; its separate run passed without
  changing tests or product behavior.
- Expanded PostgreSQL Teams gate: **170 passed** on a verified empty, disposable
  local PostgreSQL database, with the existing guarded
  `curriculum_api.run_local_teams_tests` runner plus the feature labels above.
  The exact final invocation from `backend` was
  `.\.venv\Scripts\python.exe ..\.qa-tmp\ticket4-maher-20261107\run-postgres-gate.py`.
  The initial attempt stopped before test execution because migration
  `0025_legacy_quiz_retake_grants` needs the externally managed
  `Learner.subject_activity_attempts` parent. The task-local harness supplied
  that table's schema-only fixture, verified against the existing catalog,
  including its real columns, primary/foreign keys, defaults and checks. It
  preserved the original runner's cluster/network protections and every
  migration/assertion/suite. No production data was copied into this fixture.
  The final run completed all 170 tests and destroyed its own test database.
  This tests PostgreSQL requests/transactions, not production migration history.
- No frontend product code changed; frontend type checking/build/lint are not
  required for this backend-only change.
- Live Teams and live browser validation: **NOT RUN**. The automated Teams
  baseline does not verify live Microsoft availability or permissions.

## Applied data reconciliation

Database comparisons/applications are separate from tests: the actual LMS and
source branch identities were verified before scoped data writes. Production
application source was not edited. Direct host selection was process-local;
environment files were not modified. No merge or server deployment was performed;
the periodic worker was not installed or left running.

The first scoped application corrected two existing learners: one break status
and one name. The subsequent all-local-learners comparison applied changes to
48 additional existing learners, including 29 programme statuses, seven names,
stale delivery-profile fields and eight existing account display names. Overall,
50 learners received a correction in this session.

At that stage, the full comparison counted 699 local records: 616 have an enrolment Aptem ID,
614 were found in the two source tables and need no further supported updates,
two linked records are missing from the imported sources, and 83 have no Aptem
ID. Forty-two local lifecycle states were intentionally preserved under the
agreed activation policy. These counts describe the checked snapshot.

The batch ran inside a repeatable-read transaction. Before/after server-side
fingerprints verified unchanged non-target enrolment/profile/account fields,
login security state, historical progress, unlinked learners and imported
source names/statuses. Protected local activation states were compared
independently. A repeat read found zero additional changes to apply. No source
row was inferred to be withdrawn merely because it was missing.

The workstation could not reach the configured remote cache endpoint and used
the existing process-local fallback. Remote cache invalidation and live browser
rendering were therefore not confirmed. Existing caseload cache expiry (up to
five minutes for a paginated response) and dashboard refresh behavior still
apply.

## Date extension: applied checks and outcome

The date follow-up covered the same existing local learner population and added
no learners, profiles or accounts. The first application corrected programme
dates for 610 learners with direct enrolment Aptem IDs. A subsequent comparison
found 13 additional existing profile-ID bridges: six have imported source rows
and seven do not. Five of those six needed date corrections; one was already
aligned. This is an existing identity link, not a match inferred from email.

In total, programme dates were corrected for **615 existing learners** across
all statuses: 613 enrolment start dates, 448 enrolment end dates, 575 profile
start dates and 444 profile end dates. The profile-linked batch also corrected
one existing learner's name and account display name under the original name
sync policy. Eighty-seven missing imported end dates left existing local ends
unchanged.

The final command comparison counted 699 local records, 629 with a trusted
direct/profile Aptem identity and 620 matched to the imports. All 620 matched
records were unchanged on repeat. Nine linked records are absent from both
imports, and 70 local learners have no trusted Aptem identity. The separate
`without_aptem_id` count remains 83 because 13 use the existing profile bridge
without backfilling the enrolment ID. Forty-two deliberate local lifecycle
differences remain preserved. These counts describe the checked snapshot.

An independent read-only SQL comparison against the verified LMS branch found
zero remaining supplied-date differences in all four date fields across the
620 matched records. Before/after fingerprints verified unrelated enrolment /
profile fields (including activation states, learner-specific review anchors,
plans and hours), account identity/security, historical progress, unaffected
records, missing-source end dates, row counts and imported source data. The
direct-ID batch preserved all names and whole login records; the profile-ID
batch permitted only its one planned name/display-name correction alongside
dates. Both applications used repeatable-read transactions. No production
schema, Aptem identity fields or environment files changed.

Date follow-up validation:

- SQLite feature/consumer regression selection: **84 passed**, using the isolated
  settings, local cache and external-network guard. The selection adds
  `learner_api.tests_aptem_schedule` and `learner_api.tests_learner_date_sync`
  to the relevant identity/status feature labels. The exact invocation from
  `backend` was
  `.\.venv\Scripts\python.exe ..\.qa-tmp\ticket4-maher-20261107\run-date-feature-sqlite.py`.
- Verified local PostgreSQL feature selection: **88 passed** using
  `.\.venv\Scripts\python.exe ..\.qa-tmp\ticket4-maher-20261107\run-date-feature-postgres.py`
  from `backend`. This contains the same 84 cases plus four real database tests
  of active/inactive date synchronization, partial-date preservation, existing
  profile identity fallback and rollback after grouped writes. Fixtures verify
  the actual local database, cluster directory and network boundary before
  writing synthetic records. The test database was destroyed after success.
- The existing `test_activation_copies_header_dates_into_new_profile` initially
  failed independently with the new reconciliation modules absent from the
  process: its mock setup did not isolate `replace_free_courses`. A focused mock
  and a matching call assertion were added; all existing date/identity assertions
  remain. Production activation logic was not changed.
- Teams baseline / expanded Teams checks for this follow-up: **NOT REQUIRED**.
  The extension changes only this updater, its feature tests and documentation;
  no listed Teams file or function/type/API imported by one is changed. The
  earlier 147/170 Teams results above belong to the original startup-safety
  change and were not rerun for this data/date extension.
- Live Teams and live browser verification remain **NOT RUN**. The periodic
  worker still requires normal review, merge and deployment before activation.

Source/runtime schedule verification, [PR review](https://github.com/aiteamKBC/LMS_v2/pull/608),
merged-main deployment and activation of the polling worker remain release
work. The nine missing imported records remain visible as review counts; the
70 learners without a trusted identity are reported without being matched by
name/email or imported automatically. Neither the worker nor the upstream
schedule's successful live execution has been verified.
