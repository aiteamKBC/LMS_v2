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

## Consumer integration remains outstanding

The actual Aptem Review importer has not been located in this repository.
After its final COMMIT it must start a bounded queue drain; it must also recover
pending work on startup even when a batch contains no new changes. An importer
that stays stopped cannot provide prompt processing without another agreed wakeup.
There is no automatic queue consumer in this change.

The agreed Aptem eligibility gate is a valid completion date AND a completed
status. The observed source status is `Completed`. `AwaitingSignature` with a
date is a change to evaluate, not permission to assign feedback. The existing
MCM/PR reconciliation service is broader (a date can be completion evidence), so
calling it alone does not implement that stricter gate. Integrate the gate while
preserving the reviewed LMS completion path, trusted identity mapping, template
publication boundary, supported review types, and historical deliveries.

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
