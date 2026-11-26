# Saved student speaking durations

Saved-data calculations with a background phase in the existing session worker.
No application API, dashboard, trigger, additional scheduler, Microsoft call or
change to transcript/attendance evidence is installed by this feature.

## Install and run

Verify the actual PostgreSQL endpoint/branch and database first. A database name
alone does not identify a Neon branch. Keep a private schema backup and the
previous source state; never put connection credentials or learner exports in Git.
Use an operator connection. PostgreSQL 14 or newer is required.

Set the session guard to the verified database name, then run the complete
`2026-11-24_session_student_speaking.sql` file **once**. Installation creates new
objects and commits, but does not calculate or save any results. It deliberately
fails if those objects already exist instead of overwriting someone else's work.

Then apply `2026-11-24_session_student_speaking_percentage.sql` **once**. Existing
installations apply only this second file. It adds/backfills `speaking_percentage`
and replaces the save function so future snapshots include percentages. It checks
the previous function against the reviewed baseline and preserves its ACL. It does
not recalculate speaking seconds, attribution, timestamps or run audit records.

```sql
SELECT set_config('lms.speaking_expected_database', '<verified database name>', false);
```

Preview uses saved data only and does not write. It can be run in a read-only
transaction after installation. Aggregate output avoids exposing learner names:

```sql
SELECT match_status, reason, count(*) AS result_rows,
       count(DISTINCT occurrence_id) AS sessions
FROM curriculum.preview_session_student_speaking()
GROUP BY match_status, reason;
```

Save all currently available sessions, or pass one occurrence ID to save just that
session. Each occurrence is atomic with its learner rows and audit record; an
exception aborts the caller's transaction. No original source rows are written.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT set_config('lms.speaking_expected_database', '<verified database name>', true);
SELECT outcome, count(*) AS sessions, sum(learner_rows) AS learner_results
FROM curriculum.save_session_student_speaking()
GROUP BY outcome;
COMMIT;
```

The same call processes new sessions on a later manual run. Already saved
occurrences return `already_saved`, including occurrences with zero matches.
For automatic execution, install the jobs SQL and deploy the worker integration
described below. Without that deployment, execution remains manual. Concurrent callers
use per-occurrence advisory locks and unique constraints; SQLSTATE `40001` means
the whole transaction must be retried. The retry skips the saved occurrences.

## Automatic background processing

Apply `2026-11-24_session_student_speaking_jobs.sql` once after the two earlier SQL
files, using the same verified target and database guard. It adds
`curriculum.live_session_speaking_jobs` and the operator-only
`curriculum.process_new_session_student_speaking(text[],integer)` function.
Then deploy the reviewed worker change from merged main. Applying SQL alone does
not activate automatic processing. No environment variable or new timer is needed.

The existing `process_session_results` worker runs this phase after its archive
work, even when there are no Graph jobs or a session sync failed. It makes one
bounded database call (plus transaction setup) per pass, passing through any
explicit series scope. Discovery excludes occurrences with existing snapshots
before reading any cues; each calculation calls the save function with **one**
occurrence ID. At most the existing worker limit (default 10, clamped 1–100) jobs
are discovered and processed per pass. Idle passes still make a discovery query;
they do not recalculate the historical sessions or download transcripts.

A new job waits until every currently saved transcript artifact has a ready,
non-empty archive, the attendance report ID is saved, and a scoped saved learner
register exists. Invalid timing is also deferred. There is no proof from Microsoft
that no further artifact will ever arrive: snapshots describe the currently saved
input and remain unchanged if later parts appear, consistent with the once-only
policy. Sessions without a saved learner register remain retryable, not falsely
marked complete.

Speaking work uses its own repeatable-read transaction and receipt rows with
`FOR UPDATE SKIP LOCKED`. Errors roll back partial calculations in a savepoint and
persist only a fixed reason or SQLSTATE. Retry delays start at five minutes and
double up to six hours. There is no busy retry loop, and a speaking failure never
changes a Graph/archive verdict or causes a new invitation/download. A crash or
outer transaction error rolls the pass back for a later worker pass. Global
database/SQL-installation failures are reported in sanitized backend logs.

Operational inspection (no learner identities):

```sql
SELECT state, count(*) AS jobs, max(attempts) AS maximum_attempts,
       min(next_attempt_at) AS next_attempt
FROM curriculum.live_session_speaking_jobs GROUP BY state;
SELECT last_error, count(*) FROM curriculum.live_session_speaking_jobs
WHERE state='retry' GROUP BY last_error;
```

Automatic calculation stops by reverting the worker integration through the
reviewed main deployment workflow. Keep saved results and receipts. No destructive
rollback runs automatically; removing new functions/tables is a separately
reviewed operation.

## Results and limits

- `curriculum.live_session_student_speaking`: one positive duration per
  occurrence/module/learner, with seconds, source speaker names, cue count,
  attribution status and calculation time. A missing row is **not zero speech**.
- `speaking_percentage` is `100 * speaking_seconds / sum(student speaking_seconds)`
  within the same occurrence **and module**, rounded to two decimal places. Its
  value is between 0 and 100 and cannot be null. Tutors, unknown/unresolved voices
  and other modules/sessions are excluded from the denominator. Only attributed
  students are represented; this is not a percentage of the entire recording.
  Independently rounded percentages can total 99.99 or 100.01 rather than 100.
- `curriculum.live_session_speaking_runs`: one immutable run per occurrence,
  containing source artifact IDs/times/digests, result count, unresolved speakers
  with reasons, and excluded assigned tutors. No transcript text is copied.
- Durations are estimates from transcript cue boundaries, not audio analysis or
  attendance hours. Absolute intervals use the saved artifact start, matching
  existing transcript-to-recording offsets. Overlaps/duplicates are merged across
  parts and speaker aliases for the same learner. `cue_count` counts source cues
  and may include duplicate cues; it is not the number of distinct speech turns.
- Candidate membership comes from the saved learner register, including explicitly
  linked shared modules. Today's training plan does not replace historical scope.
- A transcript name must map to an attendance name. A single participant identity
  and a single scoped learner are required. Distinct participants using the same
  name remain unresolved even if their attendance rows were individually reviewed:
  the transcript label cannot distinguish whose utterance it was.
- Existing active reviewed attendance links/aliases take precedence; revoked rules
  block fallback. Exact full names can suggest one learner when the attendance
  email is not already known to belong to a different learner. No fuzzy matching.
- `unique_name` and `reviewed_attendance` both depend on name attribution from the
  transcript; neither is proof of who actually spoke or of account ownership.
- Assigned module tutor emails/names identify exclusions. A tutor/student name
  conflict is unresolved. Teams presenter/organizer roles alone do not exclude a
  student. Other non-students are not added to the learner results.
- Invalid/missing cue timing or a missing artifact start returns
  `blocked_invalid_source` and creates no run marker. Valid speech with uncertain
  identities is saved in the audit JSON and is not assigned by guesswork.
- Snapshots do not change when later transcript parts, corrected text, roster
  changes or identity reviews arrive. They describe the saved input at calculation
  time. Recalculation is a separate, explicitly scoped operation.

## Verification and rollback

Check run counts, child counts, positive seconds, unique keys and the unresolved
reason summary after saving. Repeating the save call must add no rows for an
unchanged set of occurrences. Compare existing evidence with its pre-run state.

For manual-only use, stop calling the procedure. For automatic use, revert the
worker integration through a reviewed deployment as described above. Before
removing the feature, export its new result/audit tables privately and review
dependencies. Only the feature's new tables and functions named in its SQL files
belong to this change; never drop source artifacts, attendance or learners.
No destructive rollback is executed automatically.

To roll back only the percentage addition, restore the previous save function
from the private schema backup and remove only `speaking_percentage`, as a separate
reviewed database change. All pre-existing durations and audit records are retained.

## Regression tests

`tests/test_session_student_speaking.py` runs real SQL against a fresh synthetic
database in a dedicated local PostgreSQL cluster. It never reads `.env`. The runner
checks the actual `data_directory` and an exact private purpose marker before it
creates a test database. It rejects an unverified server even on localhost.

```powershell
backend/.venv/Scripts/python.exe -B backend/sql/tests/test_session_student_speaking.py --cluster-root <verified synthetic cluster directory>
```

No Teams trigger-list file or shared application API is changed, so the Teams
baseline and expanded Teams checks are not required. Live Teams is not tested.

### Validation on 24 November 2026

The initial SQL, percentage addition and jobs SQL were applied to the verified
existing database. An idle jobs pass returned `processed=0, completed=0, retrying=0`;
all 208 saved runs and 919 learner/session results were unchanged (full row
digests checked). The single measured pass took approximately 66 ms including the
client round trip; this is not a load test. No new live lecture or external Teams
operation was created for validation. Automatic production activation still
requires review/merge/deployment of the worker code.

Final feature checks:

- `backend/.venv/Scripts/python.exe -B backend/sql/tests/test_session_student_speaking.py --cluster-root <verified synthetic cluster directory>`:
  PASS, 46 tests, including actual Django/PostgreSQL integration, partial archive
  deferral, independent retries, rollback, concurrency and no recalculation of old
  snapshots. The runner verifies the local cluster before any writes.
- `backend/.venv/Scripts/python.exe -B backend/curriculum_api/test_session_speaking_no_db.py`:
  PASS, 7 tests; mocked database and worker control flow.
- `backend/.venv/Scripts/python.exe -B -c "import sys,runpy; sys.path.insert(0,'backend'); runpy.run_path('backend/curriculum_api/test_session_results_no_db.py',run_name='__main__')"`:
  PASS, 159 tests; mocked session/archive/access behavior. An earlier direct-file
  invocation lacked the backend import path and produced 10 `config` import
  errors; adding the correct import path resolved these without code/test changes.
- `backend/.venv/Scripts/python.exe -B backend/curriculum_api/test_session_media_no_db.py`:
  PASS, 11 tests.
- `backend/.venv/Scripts/python.exe -B backend/curriculum_api/test_session_sync_runtime_no_db.py`:
  PASS, 32 tests.
- `git diff --check`: PASS. No frontend or Teams trigger-list file changed, and
  no shared Teams response/function contract changed. Frontend/Teams baseline and
  expanded Teams checks: NOT REQUIRED. Live Teams: NOT RUN.
