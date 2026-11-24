# Imported Review change capture

Migration `0015_review_feedback_outbox` installs a producer on
`"Learner".reviews`. It does not start a scheduler, invoke the feedback service,
scan existing reviews, change eligibility, or send notifications.

An insert with a non-null `completed_date` queues that source ID. An update
queues it only if `status` or `completed_date` actually differs, including NULL
transitions. `UPDATE OF` avoids unrelated updates and `WHEN ... IS DISTINCT
FROM` avoids no-op changes. Both triggers are AFTER ROW triggers. Queue writes
commit or roll back with the source write; queue failure also fails that write.

`"Feedback".review_feedback_outbox` contains one row per `reviews.id` (not
`aptem_review_id`, learner Profile ID, or Enrolment ID). Relevant changes increment
`requested_version` without overwriting `processed_version`. The partial index
selects rows where `processed_version < requested_version`. It stores no review
payload, learner name, or email. There is deliberately no cascading foreign key:
the future consumer must handle a removed source as an explicit terminal result.

The function is SECURITY DEFINER with a fixed `pg_catalog, pg_temp` search path
and qualified table names. Its owner must retain insert/update rights on the
outbox. PUBLIC has no direct outbox access or function-execution grant. Source
writers need no extra queue permissions; this is covered by the PostgreSQL tests.
Do not drop the function-owning role after installation. Grant a future consumer
only the queue privileges it requires after verifying its actual connection role.

## Local consumer; production integration remains outstanding

`process_review_feedback_outbox` now implements one explicit bounded pass. It is
**local-test-only**: before opening a connection it requires both database aliases
to target `127.0.0.1`, the database `review_feedback_consumer_test`, and a marked
data directory under `.local-runtime/review-feedback-consumer-tests/`. It then
checks the real database name, address and server data directory. Cached targets
are checked too. Application/Neon targets are rejected without connecting.

It defaults to read-only preview. `--apply` can write only after those sandbox
checks; it does not relax them. No environment release flag enables production,
and no HTTP endpoint, AppConfig, ASGI/WSGI wrapper or scheduler calls this command.
Do not remove the sandbox gate as an operational workaround.

The options are `--expected-data-directory` (required), `--dry-run` (default),
`--apply`, `--limit` (default/hard maximum 20), `--max-queries` (default 500,
hard maximum 1000), `--max-seconds` (default 20, maximum 30), and `--max-errors`
(default 3, maximum 20). Invalid limits fail before database access.

There is exactly one bounded pending-list read per invocation. Each selected
source gets at most one attempt; there is no sleep, polling, or automatic retry.
Each review has its own transaction. A transaction advisory lock serializes
consumers without locking outbox rows while the service runs, so the source
trigger can capture a concurrent newer update. The acknowledgement uses only
the captured version, never the latest version at the end.

The query meter covers SQL execution through Django, connection initialization
SQL, and driver transaction starts. `queries` is the work count. Each review
reserves six commands for settling the service's two delivery savepoints and
outer transaction, including a uniqueness-race rollback. Work stops before
consuming that reserve; necessary COMMIT/ROLLBACK and savepoint cleanup is never
denied. Cleanup is reported in `cleanupQueries`; `totalQueries` includes both and
is tested against `--max-queries`. Driver transaction commands are also shown in
`transactionCommands`. This is an
application SQL budget, not a measurement of Neon compute billing or TLS cost.
Budget exhaustion rolls back the current review and leaves it pending; earlier
committed reviews stay committed. Reports contain aggregate counts only.

Missing/ambiguous identities, undated completions and future dates stay pending
and are reported as blocked. A missing source is acknowledged explicitly.
Unsupported/unpublished types or genuinely incomplete source states can be
acknowledged and await a new source event. Learner and employer work is committed
with the acknowledgement together. A missing employer account is the existing
durable pending delivery, not a reason to omit the learner assignment. A database
failure rolls back that review; three failures stop the default pass. Command
exit is nonzero for failed/blocked work or an exhausted budget.

There is **no persisted retry counter, backoff scheduler, or retry across runs**
in this change; the current queue schema is untouched. An operator may explicitly
run another pass. A future production importer integration must define bounded
retry timing and blocked-work handling before enabling automatic invocations.

The actual Aptem Review importer has not been located in this repository.
After its final COMMIT it must start a bounded queue drain; it must also recover
pending work on startup even when a batch contains no new changes. An importer
that stays stopped cannot provide prompt processing without another agreed wakeup.
There is no automatic or production-enabled queue consumer in this change.

The new consumer opts into `require_aptem_completed=True` on the existing
reconciliation service. Its entry gate is exactly the typed source condition
`status = 'Completed' AND completed_date IS NOT NULL`. JSON/metadata cannot
supply either value, status is not trimmed or normalized, and a completed local
overlay cannot bypass this queue-specific gate. Conflicting metadata does not
override populated typed columns. `AwaitingSignature` with a date does not qualify.
Existing callers leave this option false, preserving their own LMS/source
completion paths. The consumer never deletes or rewrites historical deliveries
when source fields become incomplete. Trusted identity mapping,
template publication boundaries, supported types and pinned history still apply.
The consumer also skips the employer pass entirely for MCM/EPA; the existing
public service defaults to including the employer pass for all other callers.

A consumer must atomically claim/serialize work, remember the version it actually
evaluated, and acknowledge only that version. It must NOT acknowledge whatever
`requested_version` happens to be at the end, nor delete by source ID alone: a
newer update could otherwise be lost. Test retry/backoff, crashes, independent
learner/employer results and concurrent consumers before enabling one. Existing
unique delivery constraints remain the safeguard against duplicate assignments.

Non-eligible source states can acknowledge their evaluated version and wait for
the next change. Transient processing failures must leave pending work visible.
Identity conflicts and blocked work need explicit reporting. A future consumer
must define retention for acknowledged rows without deleting concurrent work.

This trigger observes the two typed columns, not JSON metadata, review-name/type
corrections, form publication, or identity-link changes. Verify the import contract
and provide targeted reconciliation for those separate changes as required. No
historical backfill is performed by installation or reapplication.

## Validation and operations

From the repository root, using installed PostgreSQL binaries:

```powershell
backend/.venv/Scripts/python.exe backend/engagement_api/run_review_feedback_outbox_tests.py --pg-bin '<PostgreSQL bin directory>'
```

The runner creates and verifies a fresh loopback-only cluster, runs the actual
migration under a role that does not own the source table, and stops the cluster.
It never loads `.env` or Django settings. It covers ten rows/two updates,
unchanged and unrelated updates, inserts, NULL transitions, signature-to-completed
changes, commit visibility, rollback, queue-write failure, concurrent source
writers, version acknowledgements, privileges, reapplication and disable/re-enable.
Artifacts go under ignored `.local-runtime/review-feedback-outbox-tests/`.

For the real service/consumer integration tests, also from the repository root:

```powershell
backend/.venv/Scripts/python.exe backend/engagement_api/run_review_feedback_consumer_tests.py --pg-bin '<PostgreSQL bin directory>'
```

This runner creates a separate, fresh loopback cluster, verifies its identity,
uses model column types/single-field uniqueness for synthetic fixture tables,
and runs the actual producer SQL, consumer, ORM service, identity resolution and
employer link resolver. It does not apply application migrations or load `.env`.
External PostgreSQL/application network access is blocked in the child. Only
framework-internal loopback event-loop self-pipes are allowed on Windows.
The cluster is stopped in `finally`, including on failure. Synthetic reports
and logs are under ignored `.local-runtime/review-feedback-consumer-tests/`.
Fixtures are not a claim to reproduce every production FK/constraint or live
integration. No production source records, forms, answers or assignments are used.

Existing feedback checks use only the verified SQLite test settings:

```powershell
cd backend
.venv/Scripts/python.exe manage.py test engagement_api.tests_review_feedback engagement_api.tests_review_feedback_reconciliation --settings=config.settings_sqlite_test --noinput
```

Install through the normal reviewed migration process. If explicitly authorized
to install its SQL directly, run the exact tested `SQL` in one transaction against
the verified target, retain pre-change schema definitions, and record that Django
migration history was not advanced. A later normal migration can reapply the SQL;
it must run with ownership rights on the previously created objects. Never fake
unrelated migrations or silently overwrite another installation's objects.

The migration's reverse operation (`DISABLE_SQL`) replaces only its own capture
function with a no-op. This stops new queue writes while preserving the source
table and every queued request, and works without owning the source table. Forward
reapplication restores capture. Changes made while capture is disabled require
separately scoped recovery. Full removal/retention and consumer deployment are
separate operations. Do not claim live end-to-end feedback validation from schema
verification or the producer tests alone.
