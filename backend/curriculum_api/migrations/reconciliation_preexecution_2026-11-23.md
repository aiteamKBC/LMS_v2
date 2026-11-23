# Final pre-execution validation ? 2026-11-23

**PASS for all 26 planned operations at their intended execution mode. No
migrations or migration-history records were persisted.** Branch remained dev;
only Neon Development (`neondb`, `br-raspy-sky-abvs8lq9`) was accessed.

This report supersedes the earlier write/rollback-testing limitation in
`migration_reconciliation.md` for this existing Development schema. It does not
claim to supply an empty-database bootstrap or authorize persistent execution.

## PostgreSQL evidence

Actual server: PostgreSQL 18.6. The four early schema operations passed in a
combined rollback transaction. 0030 initially encountered a deadlock (40P01);
an isolated retry reached its lock timeout (55P03). A separate session was idle
in transaction holding AccessShareLock on Learner.subject_activity_attempts.
No session was cancelled or terminated. Once a subsequent read-only check showed
that lock had been released, the isolated 0030 retry passed fully.

The successful 0030 test dropped the four legacy NOT NULL requirements, installed
the conditional identity check and index, inserted a canonical-only attempt with
an explicit UUID and NULL legacy IDs, and rejected an incomplete legacy attempt
with the exact expected check constraint. Both probes used savepoints and rolled
back. Existing legacy attempts remained valid. No existing sequence was advanced
by a fixture; no live HTTP/Teams/email/storage actions occurred.

All six replacement validators passed both against the installed database and
after the rehearsed operations. They execute catalog SELECTs only, retain current
video capture and QR RESTRICT behavior, and preserve writable canonical metadata.
They do not recreate bridges, mirroring, generated metadata or removed records.

Every rehearsal used autocommit=false, identity verification before writes,
bounded lock/statement timeouts, and unconditional rollback/close in finally.
Fresh read-only connections independently confirmed full schema restoration,
unchanged real migration-history fingerprints, and preserved data after both
failed and successful attempts. No reverse migrations were used.

## Django graph and recorder

- Installed Django 6.0.7: 29 migration/register tests passed this session.
- Actual Development history is dependency-consistent; graph conflicts are zero.
- The target ancestry is exactly the reviewed 26 steps. No additional ancestors
  or operations are introduced by either new graph-only merge.
- Real Django MigrationExecutor/MigrationRecorder methods were also exercised
  against a transaction-local PostgreSQL TEMP django_migrations table copied from
  the live history. pg_class.relpersistence='t' was asserted before recorder use.
  The temporary table had its own temporary identity sequence; public history and
  its sequence were never written.
- Each of the 26 commands had exactly one forward migration at its turn. The six
  replacements recorded both old and new names: exactly **32** additional names
  in the TEMP table. check_replacements() and consistency checks passed; the final
  learner_api 0030 plan was empty. Public history fingerprints remained identical
  during the test and on an independent connection after rollback.
- The first temporary-recorder harness attempt needed Django's timezone loader
  registered on the injected psycopg connection. It failed before recording and
  rolled back; the corrected reproducible runner passed. No business logic changed.

## Preservation

Before/after verification confirmed:

- 790 historical mappings: 488 initial + 289 additional + 13 remaining.
- 205,737 accepted seconds; 298 active accepted records; 127 soft-deleted historical records.
- 388 assignments, 8,944 progress rows and 230 attempts.
- Exact fingerprints retained for assignments, progress, attempts and all three
  quiz-answer tables; attendance and module rows also retained their pre-test
  fingerprints after rollback.
- Zero duplicate/orphan ownership findings. All historical ledger JSON still
  matches preserved mappings. No hours/completion rule or access policy changed.
- 43 unresolved Teams provenance rows remain unchanged (42 absent, one present).

Normal config.settings was inspected with connections blocked: default and
enrolment both resolve to the approved Development endpoint/database; business
timezone is Europe/London and curriculum migrations are enabled.

## Per-operation result

PASS means schema compatibility/rehearsal or recording eligibility passed, not
that a migration has been applied. E = actual schema operation, V = validation
execution, R = history-only recording after verified installed equivalence.

| Step | App | Migration | Mode | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | learner_api | `0025_legacy_quiz_retake_grants` | E | PASS | Real DDL succeeded; empty grant table and all five key/check constraints validated. |
| 2 | curriculum_api | `0072_module_scoped_live_attendance` | E | PASS | Real uniqueness replacement succeeded; existing rows preserved. |
| 3 | curriculum_api | `0073_live_register_session_date` | E | PASS | Real backfill/functions/triggers succeeded; zero date mismatches; live correction trigger probe passed. |
| 4 | curriculum_api | `0072_course_type` | R | PASS | Installed type/default/check match the approved course schema. |
| 5 | curriculum_api | `0074_merge_course_type_and_module_attendance` | R | PASS | Empty operations; dependencies resolved. |
| 6 | curriculum_api | `0075_teams_organization_calendar_connection` | R | PASS | Installed columns/nullability/defaults, composite PK and status check match. |
| 7 | curriculum_api | `0076_module_hours_targets` | R | PASS | All three installed tables, keys, checks, defaults and audit sequence default match. |
| 8 | curriculum_api | `0077_curriculum_video_import` | R | PASS | All 18 columns, UUID PK, fingerprint uniqueness and valid/ready indexes match. |
| 9 | curriculum_api | `0092_reconcile_development_video_capture` | V | PASS | Frozen video table/index/trigger/function validation passed before and during rehearsal. |
| 10 | curriculum_api | `0079_course_pricing` | E | PASS | Real DDL succeeded; defaults preserve existing modules; zero-price sale rejected by the expected constraint. |
| 11 | curriculum_api | `0093_baseline_independent_free_course_storage` | V | PASS | Independent course contract passed; retired bridges absent. |
| 12 | curriculum_api | `0079_qr_attendance` | R | PASS | Installed columns/identity, eight RESTRICT FKs, unique key, source check and index match. |
| 13 | curriculum_api | `0081_merge_free_courses_qr_attendance` | R | PASS | Empty operations; dependencies resolved. |
| 14 | learner_api | `0026_free_course_relations` | R | PASS | Installed validated canonical learner/course/component FKs retain required RESTRICT actions. |
| 15 | curriculum_api | `0095_baseline_attendance_provenance` | V | PASS | Evidence schema validated; no provenance backfill; 43 unresolved rows preserved. |
| 16 | curriculum_api | `0082_web_week_points` | R | PASS | Installed column types/nullability, PK and positive revision check match. |
| 17 | curriculum_api | `0083_merge_web_points_qr_attendance` | R | PASS | Empty operations; dependencies resolved. |
| 18 | curriculum_api | `0084_parallel_attendance_source` | R | PASS | Five columns/defaults, expanded basis check, source FK/pair check and valid unique index match. |
| 19 | curriculum_api | `0096_preserve_qr_delete_restrict` | V | PASS | RESTRICT FK and unchanged cleanup trigger/function validated. |
| 20 | curriculum_api | `0094_baseline_completed_free_course_cutover` | V | PASS | Canonical weeks/components/learner constraints validated; no copy/delete/rebuild. |
| 21 | curriculum_api | `0086_merge_independent_free_course_storage` | R | PASS | Empty operations; dependencies resolved. |
| 22 | curriculum_api | `0097_baseline_free_course_metadata` | V | PASS | Writable metadata, intentional generated active_display_order, constraints/indexes validated. |
| 23 | learner_api | `0027_free_course_progress_state` | R | PASS | Status varchar(20)/default/check, deleted_at, nullable completed_at without default and all three valid indexes match. |
| 24 | learner_api | `0028_source_lms_alias_profile_aptem_integrity` | R | PASS | Removed alias table remains absent; approved replacement has validated composite ownership FK with RESTRICT actions. |
| 25 | learner_api | `0029_free_course_historical_bridges` | R | PASS | Three bridge shapes/PKs and both attempt identity/component constraints match; no reconstruction needed. |
| 26 | learner_api | `0030_canonical_free_course_attempts` | E | PASS | Isolated real DDL and canonical insert passed; incomplete legacy attempt rejected; all rolled back. |

## Commands actually executed

From repository root:

```powershell
backend/.venv/Scripts/python.exe -B backend/scripts/validate_migration_reconciliation.py --development
backend/.venv/Scripts/python.exe -B backend/scripts/rehearse_free_course_reconciliation.py --rollback-development
backend/.venv/Scripts/python.exe -B backend/scripts/rehearse_free_course_reconciliation.py --rollback-development --operation 0030_canonical_free_course_attempts
backend/.venv/Scripts/python.exe -B backend/scripts/rehearse_free_course_reconciliation.py --rollback-development --recorder-only
git diff --check
```

The combined rehearsal reported 0030 BLOCKED; the isolated command was run twice,
first BLOCKED by a lock and then PASS once the blocking session released it.
The final recorder-only run passed. Additional SELECT-only catalog checks compared
all recording-only objects against their original migration operations and
confirmed valid/ready indexes. No R operation was run against real history.

## Exact future persistent execution commands ? not executed

Persistent execution requires a verified Development restore point, the same
verified default/enrolment aliases, and a clear lock window. Restore-point
availability was not independently verified in this task. Do not use an
unrestricted migrate or target either new merge leaf. Do not combine this
sequence into one long transaction: use Django's per-migration transactions.

Use the backend working directory, config.settings, DJANGO_USE_SQLITE=false and
CURRICULUM_WARM=0. Apply bounded connection lock/statement timeouts. Recheck the
Development identity immediately before execution. Run **one pair at a time**:
inspect --plan, require exactly its one forward migration, then run the second
command only when persistent execution has been authorized. Stop on any failure,
changed schema or extra ancestor. --fake applies only to R rows below.

### 1. learner_api.0025_legacy_quiz_retake_grants (E)

```powershell
.venv/Scripts/python.exe -B manage.py migrate learner_api 0025_legacy_quiz_retake_grants --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate learner_api 0025_legacy_quiz_retake_grants --database=default --settings=config.settings
```

### 2. curriculum_api.0072_module_scoped_live_attendance (E)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0072_module_scoped_live_attendance --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0072_module_scoped_live_attendance --database=default --settings=config.settings
```

### 3. curriculum_api.0073_live_register_session_date (E)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0073_live_register_session_date --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0073_live_register_session_date --database=default --settings=config.settings
```

### 4. curriculum_api.0072_course_type (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0072_course_type --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0072_course_type --database=default --settings=config.settings --fake
```

### 5. curriculum_api.0074_merge_course_type_and_module_attendance (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0074_merge_course_type_and_module_attendance --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0074_merge_course_type_and_module_attendance --database=default --settings=config.settings --fake
```

### 6. curriculum_api.0075_teams_organization_calendar_connection (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0075_teams_organization_calendar_connection --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0075_teams_organization_calendar_connection --database=default --settings=config.settings --fake
```

### 7. curriculum_api.0076_module_hours_targets (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0076_module_hours_targets --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0076_module_hours_targets --database=default --settings=config.settings --fake
```

### 8. curriculum_api.0077_curriculum_video_import (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0077_curriculum_video_import --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0077_curriculum_video_import --database=default --settings=config.settings --fake
```

### 9. curriculum_api.0092_reconcile_development_video_capture (V)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0092_reconcile_development_video_capture --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0092_reconcile_development_video_capture --database=default --settings=config.settings
```

### 10. curriculum_api.0079_course_pricing (E)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0079_course_pricing --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0079_course_pricing --database=default --settings=config.settings
```

### 11. curriculum_api.0093_baseline_independent_free_course_storage (V)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0093_baseline_independent_free_course_storage --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0093_baseline_independent_free_course_storage --database=default --settings=config.settings
```

### 12. curriculum_api.0079_qr_attendance (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0079_qr_attendance --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0079_qr_attendance --database=default --settings=config.settings --fake
```

### 13. curriculum_api.0081_merge_free_courses_qr_attendance (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0081_merge_free_courses_qr_attendance --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0081_merge_free_courses_qr_attendance --database=default --settings=config.settings --fake
```

### 14. learner_api.0026_free_course_relations (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate learner_api 0026_free_course_relations --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate learner_api 0026_free_course_relations --database=default --settings=config.settings --fake
```

### 15. curriculum_api.0095_baseline_attendance_provenance (V)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0095_baseline_attendance_provenance --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0095_baseline_attendance_provenance --database=default --settings=config.settings
```

### 16. curriculum_api.0082_web_week_points (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0082_web_week_points --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0082_web_week_points --database=default --settings=config.settings --fake
```

### 17. curriculum_api.0083_merge_web_points_qr_attendance (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0083_merge_web_points_qr_attendance --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0083_merge_web_points_qr_attendance --database=default --settings=config.settings --fake
```

### 18. curriculum_api.0084_parallel_attendance_source (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0084_parallel_attendance_source --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0084_parallel_attendance_source --database=default --settings=config.settings --fake
```

### 19. curriculum_api.0096_preserve_qr_delete_restrict (V)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0096_preserve_qr_delete_restrict --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0096_preserve_qr_delete_restrict --database=default --settings=config.settings
```

### 20. curriculum_api.0094_baseline_completed_free_course_cutover (V)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0094_baseline_completed_free_course_cutover --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0094_baseline_completed_free_course_cutover --database=default --settings=config.settings
```

### 21. curriculum_api.0086_merge_independent_free_course_storage (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0086_merge_independent_free_course_storage --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0086_merge_independent_free_course_storage --database=default --settings=config.settings --fake
```

### 22. curriculum_api.0097_baseline_free_course_metadata (V)

```powershell
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0097_baseline_free_course_metadata --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate curriculum_api 0097_baseline_free_course_metadata --database=default --settings=config.settings
```

### 23. learner_api.0027_free_course_progress_state (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate learner_api 0027_free_course_progress_state --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate learner_api 0027_free_course_progress_state --database=default --settings=config.settings --fake
```

### 24. learner_api.0028_source_lms_alias_profile_aptem_integrity (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate learner_api 0028_source_lms_alias_profile_aptem_integrity --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate learner_api 0028_source_lms_alias_profile_aptem_integrity --database=default --settings=config.settings --fake
```

### 25. learner_api.0029_free_course_historical_bridges (R)

```powershell
.venv/Scripts/python.exe -B manage.py migrate learner_api 0029_free_course_historical_bridges --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate learner_api 0029_free_course_historical_bridges --database=default --settings=config.settings --fake
```

### 26. learner_api.0030_canonical_free_course_attempts (E)

```powershell
.venv/Scripts/python.exe -B manage.py migrate learner_api 0030_canonical_free_course_attempts --database=default --settings=config.settings --plan
.venv/Scripts/python.exe -B manage.py migrate learner_api 0030_canonical_free_course_attempts --database=default --settings=config.settings
```

## Remaining execution conditions

No schema-compatibility or migration-graph blocker remains for the existing
Development architecture. Actual execution is still pending and was not
performed. Recheck for concurrent readers before 0030; observed lock contention
makes a quiet window necessary. Do not terminate other sessions automatically.
Verify a Development restore point and rerun the read-only preflight immediately
before authorized execution. The 43 historical provenance gaps need evidence-led
follow-up; they do not block this preservation-only reconciliation.

Files added for this validation: scripts/rehearse_free_course_reconciliation.py
and this report. Feature context updated. No historical migration, application
business logic, Frontend, Teams integration or policy file was changed.
