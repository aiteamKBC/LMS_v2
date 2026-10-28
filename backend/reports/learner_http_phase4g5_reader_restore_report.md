# Phase 4G.5 - Restore Secure Benchmark Access

## A. Verdict

**RESTORED AND VERIFIED**

The least-privilege `lms_benchmark_reader` was restored on the refreshed
`lms_ideal_test` branch, its stale local credential was replaced securely, and
the real benchmark-only Django runtime connected through the Reader on both
database aliases. No synthetic identity, fixture, migration, application data,
or benchmark request was created.

This verdict applies to Reader restoration and Django isolation only. The
authenticated synthetic Learner benchmark remains blocked by the explicit
fixture/`SECURITY DEFINER` approval gate and the infrastructure limitations in
section I.

## B. Branch Verification

Authoritative Neon metadata was checked before the database change and again
after verification:

| Item | Verified value |
| --- | --- |
| Project | `green-term-97168878` |
| Target branch | `lms_ideal_test` / `br-orange-shadow-abm8uwwe` |
| Parent | `lms-ideal-architecture` / `br-raspy-sky-abvs8lq9` |
| Reset source | LSN `1F/C6433540`, timestamp `2026-10-28T08:53:53Z` |
| Last reset | `2026-10-28T08:54:00Z` |
| Endpoint | `ep-dawn-block-ab5vob3x`, direct read-write compute |
| Database | `neondb` |
| Target state | `ready`, non-primary, non-default, non-protected |
| Expiration | `2026-11-25T09:54:00Z` |
| Remaining at final metadata check | 672.71 hours (about 28 days) |

The Reader was absent before execution. No process whose command line matched
the benchmark runtime, `LMS_IDEAL_TEST`, or the benchmark settings module was
running during preflight.

## C. Reader Creation

The reviewed SQL in
`backend/reports/recreate_lms_benchmark_reader_after_reset_not_executed_2026-10-28.sql`
was inspected and applied in one transaction through an owner connection that
was pinned to the exact branch, endpoint, database, and `neondb_owner` identity.
The execution helper refused an existing Reader or any identity mismatch.

The SQL created only `lms_benchmark_reader` and its required grants. It did not
grant DML, sequence privileges, schema `CREATE`, object ownership, role
membership, `CREATEDB`, `CREATEROLE`, superuser, replication, or `BYPASSRLS`.
All 88 manifest relations existed and were successfully queried by the Reader.

The reviewed hardening also revoked database `TEMPORARY` and the known unsafe
write-function `EXECUTE` grant from `PUBLIC` on this test database. These are
test-branch object ACL changes, not alterations or memberships on an existing
named role. They were required because PostgreSQL has no per-role deny that can
override a `PUBLIC` grant. Parent and Production ACLs were not touched.

Neon metadata records the new role as a password-authenticated, unprotected
branch-local role created at `2026-10-28T09:05:39Z`.

## D. Credential Rotation

- A new 48-byte URL-safe random password was generated in process memory.
- The stale Generic Credential at
  `LMS_v2/phase4g2/lms_benchmark_reader` was replaced only after live Reader
  verification passed.
- Windows Credential Manager contains the expected target and Reader username.
- No password or connection string was printed, logged, added to `.env`, placed
  in this report, or committed to source control.
- No Production environment variable was changed.

## E. Effective Permissions

Live connection evidence as the Reader:

| Control | Result |
| --- | --- |
| Identity | `lms_benchmark_reader` / `neondb` / exact branch and endpoint |
| Transaction mode | `transaction_read_only=on` |
| Direct relation `SELECT` grants | 88 |
| Schema `USAGE` grants | 9 |
| Database | `CONNECT=true`, `TEMP=false` |
| DML or `TRUNCATE` grants | 0 |
| Sequence privileges | 0 |
| Schema `CREATE` grants | 0 |
| Role memberships | 0 |
| Owned application relations | 0 |
| Superuser / `CREATEDB` / `CREATEROLE` | false / false / false |
| Inherit / replication / `BYPASSRLS` | false / false / false |
| Connection limit | 4 |
| Unsafe function execution | denied |

Rollback-safe negative attempts confirmed rejection of `INSERT`, `UPDATE`,
`DELETE`, ordinary `CREATE TABLE`, `CREATE TEMP TABLE`, `CREATE ROLE`, and
`SET ROLE neondb_owner`. Every one of the 88 required reads succeeded.

## F. Django Runtime Verification

`python -B reports/verify_phase4g2_runtime.py` completed successfully using the
Credential Manager entry:

- aliases were exactly `default` and `enrolment`;
- both aliases used `lms_benchmark_reader`;
- both used direct host `ep-dawn-block-ab5vob3x.eu-west-2.aws.neon.tech`;
- live database identity matched the branch, endpoint, and database;
- `transaction_read_only` was `on`;
- `LMS_IDEAL_TEST` owner input was absent from the Django process;
- no `DATABASE_URL`, legacy database URL, or enrolment URL fallback was loaded.

`django.setup()` and the database identity query completed without a startup
write. Benchmark isolation tests verified that Azure Storage, Graph/Teams,
external HTTP, SMTP, Redis fallback, raw sockets, and raw PostgreSQL bypasses
remain blocked. No server, worker, scheduler, cache service, or external
integration was started. Authentication middleware and object-level permission
behavior remained covered by the focused authentication/permission suites; no
existing Learner was impersonated.

## G. Security Test Results

| Check | Result |
| --- | --- |
| Live restoration helper | PASS - exact identity, 88 reads, all privilege and negative checks passed |
| Live Django benchmark verifier | PASS - both aliases Reader-only; owner/fallback inputs absent |
| `python manage.py test config.test_test_isolation_no_db config.tests_test_branch_guard --verbosity=1` | PASS - 44/44 in 30.817s |
| `python manage.py test login.test_selectors_no_db login.tests_learner_progress_gate learner_api.test_curriculum_lookup_permissions_no_db --verbosity=1` | PASS - 56/56 in 0.122s |
| Credential retrieval | PASS - used by the live Django verifier; target exists in Credential Manager |
| Anonymous and cross-learner gates | PASS in the focused permission suite, including the safe no-session 401 contract |
| Fixture residue | PASS - zero `phase4g_` enrolment, learner, account, plan-module, and progress rows |

The tests use application-level network guards and test doubles. They do not
claim independent host firewall/container egress enforcement or live external
service availability.

## H. Fixture Compatibility

The fixture SQL was reviewed but not executed.

Schema compatibility evidence:

- 16/16 core tables and identity sequences exist.
- 92/92 required insert, relationship, and containment columns exist.
- 76/76 referenced application/dependency relations exist.
- `benchmark_admin`, `lms_fixture_owner`, and
  `lms_fixture_provisioner` are absent, as expected after reset.
- The progress table still has the two relevant enabled triggers:
  `trg_link_progress_kbc_attendance` (before insert/update) and
  `shared_reward_progress_outbox` (after insert).

One reset incompatibility was corrected in the unexecuted plan: it previously
used `ALTER ROLE lms_fixture_provisioner`, but that branch-local role no longer
exists. The plan now uses `CREATE ROLE` with the same least-privilege flags. No
role or function was created by this task.

Planned relationships and scope remain exact:

- one enrolment row linked to one canonical learner;
- one learner login account whose subject ID is the enrolment ID;
- one hashed, expiring login session;
- one module, one week, one component, and 357 progress entries;
- provisioning: 364 application inserts, one receipt insert, and one scoped
  enrolment-link update;
- cleanup: the exact 364 application deletes, one receipt delete, and one
  scoped unlink update, guarded by receipt equality, row locks, FK discovery,
  side-effect checks, and exact row counts;
- the receipt binds the namespace, target identity, seven singleton IDs, and
  all ordered progress IDs; it contains no plaintext token or credential;
- the planned provisioner has only `CONNECT`, schema `USAGE`, and execute on the
  two fixed-search-path functions; direct table/sequence access belongs only to
  the planned no-login owner.

The 357 rows meaningfully exercise high-cardinality progress loading,
aggregation, mapping, and serialization. They are deliberately all tied to one
component and contain no submitted activity, source-attempt diversity, quiz
history, evidence, attendance, reward, or review data. They therefore model the
volume-sensitive progress path, not the full distribution of real Learner
workloads. Any later benchmark conclusions must state this limitation.

## I. Remaining Blockers

1. The corrected fixture plan, its two `SECURITY DEFINER` functions, exact write
   scope, and receipt-bound cleanup still require separate explicit approval.
2. No synthetic Learner or test-owned authenticated session exists.
3. The benchmark still uses a Reader on the existing read-write compute with
   transaction-level read-only enforcement; no dedicated read-only compute has
   been approved or created.
4. Network isolation remains application/process-level. No independent
   container boundary or host firewall allowlist was added.
5. Trigger containment is structurally compatible but cannot be proven until
   the separately approved fixture transaction is executed and its assertions
   pass.

## J. Next Execution Step

After explicit approval of the corrected unexecuted fixture/security plan and
the acknowledged infrastructure boundaries:

1. recheck branch identity and expiration;
2. create the single-purpose provisioner/owner/functions exactly as reviewed;
3. generate a separate provisioner credential in memory;
4. provision the receipt-bound synthetic learner atomically and verify zero
   unexpected trigger output;
5. authenticate only as that test-owned learner;
6. run the focused HTTP benchmark through the Reader-only Django runtime; and
7. execute receipt-bound cleanup and verify zero residue.

No part of that next step was executed here.

## K. Changed Files and Database Objects

Files added or changed by this phase:

- `backend/reports/restore_phase4g5_reader.py` - one-shot, target-pinned
  restoration and live privilege verifier.
- `backend/reports/phase4g4_fixture_security_definer_not_executed_2026-10-28.sql`
  - unexecuted post-reset correction from `ALTER ROLE` to `CREATE ROLE`.
- `backend/reports/learner_http_phase4g5_reader_restore_report.md` - this report.

Database changes on `lms_ideal_test` only:

- created login role `lms_benchmark_reader`;
- granted `CONNECT`, nine schema `USAGE` privileges, and 88 explicit `SELECT`
  privileges;
- applied the five role defaults/limits shown in section E;
- revoked test-database `PUBLIC TEMPORARY` and `PUBLIC EXECUTE` on
  `"Coach".refresh_learner_absence_counts(integer,text)`.

No schema, table, sequence, function, fixture role, or application row was
created or changed. The Credential Manager entry was replaced locally.

## L. Safety Confirmation

- Production was not accessed or modified.
- The parent `lms-ideal-architecture` branch was not written or changed.
- No Neon branch was reset, recreated, renamed, or extended.
- No endpoint was created or updated.
- No migration was run.
- No synthetic learner, fixture receipt, provisioner role, owner role, schema,
  or `SECURITY DEFINER` function was created.
- No existing Learner was queried by identity, modified, or impersonated.
- No Azure, Graph, Teams, SMTP, Redis, or other external operation was made.
- No application business logic, frontend code, API contract, or `AGENTS.md`
  was changed.
- No Git branch/worktree, commit, push, or deployment was performed.
- Pre-existing contributor worktree changes were preserved.

Teams baseline: **NOT REQUIRED** - no Teams-trigger file was edited.
Expanded Teams checks: **NOT REQUIRED** - no Teams behavior changed.
