# Development reconciliation, 2026-11-23

Local implementation only. Nothing in this document has been applied. Use only
the approved Neon Development branch `br-raspy-sky-abvs8lq9`, database `neondb`.
Do not use this plan on Production or run an unrestricted `migrate`.

## Design and changed files

Six single-node replacements retain each original dependency list. Historical
migration files are unchanged. These are intentional supersessions of retired
operations, not assertions that the historical implementation was executed.

| New curriculum_api migration | Replaces | Database behavior | Django state |
| --- | --- | --- | --- |
| `0092_reconcile_development_video_capture` | `0078_curriculum_video_changes` | Validate event table, indexes, enabled source triggers and installed status-aware function fingerprint | Original `CurriculumVideoChange` CreateModel, state only |
| `0093_baseline_independent_free_course_storage` | `0080_free_course_storage` | Validate independent courses; reject retired bridge columns/functions/views | None |
| `0094_baseline_completed_free_course_cutover` | `0082_independent_free_course_storage` | Validate independent weeks/components and learner assignment/progress constraints; reject retired bridges | None |
| `0095_baseline_attendance_provenance` | `0082_qr_learner_attendance_resolution` | Validate installed evidence columns, constraints and index; no backfill | Original five AddField operations, state only |
| `0096_preserve_qr_delete_restrict` | `0085_qr_attendance_delete_cleanup` | Validate RESTRICT FK and unchanged enabled cleanup trigger/function | None |
| `0097_baseline_free_course_metadata` | `0087_free_course_compatible_fields` | Validate writable metadata, constraints, indexes and generated active_display_order; reject retired bridges | None |

Each file contains its own frozen catalog queries and expected results. There
are no runtime schema-helper imports, data writes, DDL, network calls, copying,
deleted-record reconstruction or reverse operations. Exact catalog comparisons
deliberately stop on drift, including benign definition/index changes; review
such drift rather than weakening a validator. PostgreSQL catalog formatting and
NOT NULL constraint representation are version-sensitive. These contracts target
the installed Development architecture, not arbitrary PostgreSQL versions.

Two graph-only files have empty operations:

- `curriculum_api/0098_merge_reconciled_curriculum_heads`: parents
  `0085_drop_modules_weeks_number`, `0091_curriculum_video_source`,
  `0091_module_week_boundary_mode`.
- `engagement_api/0015_merge_engagement_heads`: parents
  `0013_rename_learner_id_to_enrolment_id`, `0014_feedback_email_ticket_close`.

Do not target these merge leaves in this reconciliation. Their presence resolves
loader conflicts; applying them would schedule unrelated unrecorded ancestors.
Neither leaf is in the plan for learner_api 0030.

Supporting files: `curriculum_api/test_migration_reconciliation_no_db.py`,
`scripts/validate_migration_reconciliation.py`, and the corrected fixture in
`curriculum_api/tests_parallel_attendance_register.py`. The fixture now mocks
the existing module -> group ID -> group-name query, including inactive/null
group exclusions. Existing assertions remain; runtime logic is unchanged.

## What actual Django behavior required us to correct

Verified against installed Django **6.0.7** source and real disk-loaded migration
classes, graph, project state, executor methods and SQL collection:

1. Single-node replacements have no partially-applied subset. With their old
   name absent, Django chooses the replacement. With the old name recorded,
   Django considers the replacement applied and **does not run its validator**.
   Therefore run the explicit read-only preflight even for existing histories.
2. Successful execution records both the original and replacement names.
   `check_replacements()` can backfill the replacement name when its original
   is already recorded. Recording only the new name is insufficient: the loader
   derives replacement status from the original. Never manually insert names.
3. A RunPython nested inside SeparateDatabaseAndState executes during Django SQL
   collection. The initial local test exposed this. Validators are now top-level
   RunPython operations; separate state-only operations preserve the original
   model definitions. SQL previews contain comments and no DDL or validation I/O.
   Consequently `sqlmigrate` is not a substitute for the catalog preflight.
4. Replacement numbering need not follow graph order. Each replacement keeps
   the original dependencies; neither graph merge is a prerequisite for 0030.
5. Validators are deliberately irreversible. An automated backwards migration
   must not pretend to undo an externally installed architecture.

The tests cover 64 combinations of original replacement statuses for selection;
those combinations are not all valid complete histories. Actual Development
history separately passes Django's consistency check. The 26-step sequence below
also passes the real executor planner one target at a time, with recorder I/O
mocked. Successful/failed executor validation and original/new recording are
tested with synthetic cursors and recorder doubles, never a Neon executor.

## Fresh-install limit

An empty migration history loads and renders without graph/state conflicts.
An empty physical database **cannot be bootstrapped by this reconciliation**:
the guards fail closed, and earlier existing migrations also depend on externally
provisioned unmanaged schemas. Pre-provisioning the current schema alone does
not make replaying all older migrations safe. A separately approved canonical
schema bootstrap plus matching initial migration history is required for a new
installation. No historical bridge is used as a fallback. Full PostgreSQL fresh
installation and transactional write execution were NOT tested in this session.
This is an explicit readiness limit, not a claimed fresh-install success.

## Read-only preflight (safe now)

From repository root:

```powershell
backend/.venv/Scripts/python.exe -B backend/scripts/validate_migration_reconciliation.py --development
backend/.venv/Scripts/python.exe -B backend/scripts/validate_free_course_hours_no_db.py --read-only
backend/.venv/Scripts/python.exe -B backend/scripts/validate_free_course_hours_no_db.py
```

The first command blocks all Django DB connections and test network access.
Its explicit Development phase connects through the existing allowlisted helper,
asserts branch/database identity, enforces read-only REPEATABLE READ, uses only
catalog/data SELECTs and always rolls back/closes. It never invokes an executor
against Neon, records migration history, or provisions a test database.

Before future execution, obtain a Development restore point and maintenance
window. Confirm the application `default` and `enrolment` aliases both address
that exact Development database with PostgreSQL and the normal migration modules
enabled. The test runner intentionally uses SQLite settings with connections
blocked; those settings must never be used for reconciliation commands. Disable
startup warmers and verify other configured aliases are not accessed. Recheck
all recording-only schemas against their original migration requirements, not
only the six replacement validators. Stop on any changed classification.

## Exact future sequence — NOT executed or authorized by this session

Use normal `config.settings`, verified Development aliases and the backend
working directory. For **each row**, first run:

```text
.venv/Scripts/python.exe -B manage.py migrate APP FULL_NAME --database=default --plan
```

Proceed only when that plan contains exactly the single forward migration in the
row. Then use the same command without `--plan`, adding `--fake` **only** for R
rows. This table specifies every APP/FULL_NAME and flag; do not combine targets
or bulk-fake the dependency chain. Stop on an error and rebuild the remaining
plan before continuing.

- **E**: real schema/data execution, no `--fake`.
- **V**: execute SELECT-only validator and state transition, no `--fake`.
  Django itself writes original + replacement migration-history records.
- **R**: installed equivalent or graph-only operation; history recording with
  `--fake` only after its schema postconditions and dependencies are verified.

| Step | App | Full migration name | Mode |
| --- | --- | --- | --- |
| 1 | learner_api | 0025_legacy_quiz_retake_grants | E |
| 2 | curriculum_api | 0072_module_scoped_live_attendance | E |
| 3 | curriculum_api | 0073_live_register_session_date | E |
| 4 | curriculum_api | 0072_course_type | R |
| 5 | curriculum_api | 0074_merge_course_type_and_module_attendance | R |
| 6 | curriculum_api | 0075_teams_organization_calendar_connection | R |
| 7 | curriculum_api | 0076_module_hours_targets | R |
| 8 | curriculum_api | 0077_curriculum_video_import | R |
| 9 | curriculum_api | 0092_reconcile_development_video_capture | V |
| 10 | curriculum_api | 0079_course_pricing | E |
| 11 | curriculum_api | 0093_baseline_independent_free_course_storage | V |
| 12 | curriculum_api | 0079_qr_attendance | R |
| 13 | curriculum_api | 0081_merge_free_courses_qr_attendance | R |
| 14 | learner_api | 0026_free_course_relations | R |
| 15 | curriculum_api | 0095_baseline_attendance_provenance | V |
| 16 | curriculum_api | 0082_web_week_points | R |
| 17 | curriculum_api | 0083_merge_web_points_qr_attendance | R |
| 18 | curriculum_api | 0084_parallel_attendance_source | R |
| 19 | curriculum_api | 0096_preserve_qr_delete_restrict | V |
| 20 | curriculum_api | 0094_baseline_completed_free_course_cutover | V |
| 21 | curriculum_api | 0086_merge_independent_free_course_storage | R |
| 22 | curriculum_api | 0097_baseline_free_course_metadata | V |
| 23 | learner_api | 0027_free_course_progress_state | R |
| 24 | learner_api | 0028_source_lms_alias_profile_aptem_integrity | R |
| 25 | learner_api | 0029_free_course_historical_bridges | R |
| 26 | learner_api | 0030_canonical_free_course_attempts | E |

The five E operations are:

- 0025: add the missing legacy quiz retake grant table/keys/checks; no grants issued.
- 0072 scoped attendance: replace the two-column register uniqueness with
  occurrence/learner/module uniqueness; preserves existing rows.
- 0073: add session_date, backfill from occurrence UTC timestamps in the configured
  business timezone, and install the two date-maintenance functions/triggers.
  This is a real backfill and locking operation; never classify it as a no-op.
- 0079 pricing: add is_for_sale/price/currency to normal modules with defaults and
  checks. It does not install Free Course mirroring.
- 0030: allow null legacy attempt identifiers for canonical attempts, add the
  conditional identity constraint and learner/component/submitted_at index.

0029's bridge types and both validated attempt constraints match Development;
source_activity_fk is already nullable. All 230 existing attempts satisfy 0030's
condition at verification time. The four legacy columns still require relaxation.
Do not execute 0029 merely to record already installed bridges.

## Preservation, provenance and rollback

Read-only verification: 790 mappings (488 + 289 + 13); 298 active accepted records;
205,737 accepted seconds; 127 historical soft-deleted ledger records; 388
assignments; 8,944 progress records; 230 attempts. Assignment/progress/attempt and
quiz answer fingerprints are equal before/after validation in the same read-only
snapshot. No duplicate/orphan findings; no catalogue cleanup or recalculation.

The 43 missing Teams provenance rows remain 42 absent and one present. The prior
audit found retained raw reports for all 43, but no explicit attendance identity
links. One present row has a unique current-email/raw-report match; that does not
prove historical identity by itself. The 42 absent rows have no matching raw
participant. Do not infer historical absence or copy current identities into
these fields. The baseline intentionally preserves these unresolved values;
repair requires a separately reviewed evidence manifest. It is not a blocker
for the Free Course schema validators.

Do not reverse the replacements or invoke their original reverse operations.
Each future migration is atomic, but the full sequence is not one transaction.
If a step fails, inspect committed history and resume only after a new plan.
V steps have no physical rollback; retain their recorded reconciliation rather
than automatically removing names and enabling retired replay. Correct any
mistaken history entries only through a separately reviewed, dependency-aware
repair. Preserve added tables/columns if rolling back application code. After
canonical attempts exist, restoring NOT NULL on legacy fields may be impossible
without destroying history; use forward repair or the Development restore point.

## Verification and readiness

- Reconciliation/register suite: 29 tests passed, including real disk-loader,
  executor, model-state, replacement selection, fail-closed and SQL-preview tests.
- Six live catalog validators passed; actual history is dependency-consistent;
  all 26 future steps have singleton plans under simulated successful recording.
- Existing Free Course no-DB suite: 106 tests passed.
- Read-only Free Course SQL suite: 17 tests passed.
- `git diff --check`: passed; pre-existing unrelated changes preserved.
- Teams baseline/expanded Teams checks: NOT REQUIRED; no listed runtime file or
  shared Teams contract changed. Historical QR tests retain their original
  CASCADE-source assertions; new tests independently require replacement RESTRICT.
- No Frontend change, live submission, migration application, history write,
  Production access, commit, push or deployment.

Locally implemented and ready for review. Development execution remains pending
fresh preflight, restore-point/alias verification and explicit write authorization.
An empty-database bootstrap and actual PostgreSQL write/rollback integration are
not validated or supplied by this scoped reconciliation.
