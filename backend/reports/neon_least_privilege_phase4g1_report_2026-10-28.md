# Phase 4G.1 - Neon Least-Privilege Database Isolation & Secure Benchmark Architecture

Date: 2026-10-28  
Git branch: `fix/api-endpoints`  
Verdict: **DESIGN READY WITH CONDITIONS**

This is a read-only security audit and implementation design. No SQL in this
report was executed. The exact target is `lms_ideal_test`; the hyphenated name
`lms-ideal-test` is not the branch that was inspected.

## A. Security Verdict

The least-privilege design is ready for a separately approved implementation,
subject to four conditions:

1. Extend or recreate the expiring `lms_ideal_test` branch, then re-verify its
   project, branch, endpoint and database identifiers before any role work.
2. Create the roles with SQL on that branch, not through the Neon Console, API
   or CLI. Neon-created roles inherit `neon_superuser`; SQL-created roles do
   not. See [Neon roles](https://neon.com/docs/manage/roles) and
   [database access](https://neon.com/docs/manage/database-access).
3. Attach Django to a new Neon **read-only compute** for this exact branch and
   use only `lms_benchmark_reader` credentials. The current compute is
   read-write. A read-only compute is an independent database-write boundary,
   not a substitute for PostgreSQL grants. See
   [Neon read replicas](https://neon.com/docs/introduction/read-replicas).
4. Implement the fixture capability as locked, reviewed, security-definer
   provisioning/cleanup procedures. Do not give the provisioner general table
   DML: table grants cannot restrict it to synthetic rows, and the progress
   trigger has additional `Engagement` reads/writes.

Until those conditions are met, authenticated benchmarks remain blocked. The
design is not approval to create roles, grant privileges or provision data.

## B. Current Privilege Findings

### Verified target

| Item | Verified value |
|---|---|
| Neon project | `LMS` (`green-term-97168878`) |
| Branch | `lms_ideal_test` (`br-orange-shadow-abm8uwwe`) |
| Parent | `lms-ideal-architecture` (`br-raspy-sky-abvs8lq9`) |
| Branch state | ready; non-primary, non-default, non-protected |
| Branch origin | parent-data |
| Branch writes | `written_data_bytes=0` at final metadata read |
| Expiry | 2026-10-28 13:01:57 UTC (15:01:57 Cairo) |
| Current compute | `ep-dawn-block-ab5vob3x`; read-write |
| Configured hostname | pooled hostname label; existing benchmark setup normalises it to the matching direct hostname |
| Database | `neondb`, owner `neondb_owner` |
| PostgreSQL | 18.6 |
| Runtime identity | `neondb_owner` |
| Server transaction mode | `transaction_read_only=on` during inspection |

The database identity query independently returned the same Neon branch and
endpoint IDs through `neon.branch_id` and `neon.endpoint_id`. No production or
parent-branch connection was made.

### Effective privilege paths

`neondb_owner` is not PostgreSQL `SUPERUSER`, but that fact is misleading in
isolation. Its direct flags include `CREATEDB`, `CREATEROLE`, `REPLICATION` and
`BYPASSRLS`; it is a login role with unlimited connections and `INHERIT`.

It directly inherits `neon_superuser`, which in turn supplies
`pg_read_all_data`, `pg_write_all_data`, `pg_monitor`, `pg_maintain`,
`pg_signal_backend`, `pg_signal_autovacuum_worker` and
`pg_create_subscription`. It also directly belongs to several application
reader/auth roles. Thus it can write through inherited privileges even if an
individual table has no explicit grant.

Ownership is a second independent path. `neondb_owner` owns the database,
nearly every application schema, and every inspected application object in
the ten core schemas. For example:

| Schema | objects owned / inspected | writable ordinary tables |
|---|---:|---:|
| `Learner` | 138 / 138 | 90 |
| `curriculum` | 123 / 123 | 92 |
| `enrolment` | 51 / 51 | 29 |
| `login` | 27 / 27 | 16 |
| `Coach` | 45 / 45 | 25 |
| `Audit` | 33 / 33 | 25 |
| `Last_audit` | 24 / 24 | 19 |
| `Manual_audit` | 35 / 35 | 29 |
| `fetching_evidence` | 50 / 50 | 33 |
| `structured_manual_activities` | 46 / 46 | 28 |

Database ACLs currently give `PUBLIC` `CONNECT` and `TEMPORARY`; the current
owner has `CONNECT`, `CREATE` and `TEMPORARY`. `PUBLIC` did not have table DML
in the inspected application schemas, and did not have `CREATE` on those
schemas. The public `TEMPORARY` grant is nevertheless incompatible with a
strict no-temp Reader and must be handled on the test branch.

No inspected core application table has RLS enabled: all ten schema counts
were zero. Therefore `NOBYPASSRLS` is necessary but does not create row-level
isolation where no policy exists. Learner ownership remains enforced by the
real Django authentication, canonical identity and object-permission paths.

Default ACL inspection found only `cloud_admin` defaults for `neon_superuser`
objects in `public`; it found no default application grants that should be
copied to the new roles. One security-definer function exists:
`public.refresh_kbc_combined_attendance()`. Its ACL is owner-only, its search
path is locked, and the Reader will receive no `public` schema usage.

One directly callable volatile mutator is exposed through default PUBLIC
function execution in a schema needed by learner reads:
`"Coach".refresh_learner_absence_counts(integer,text)`. The future branch-local
implementation must revoke PUBLIC execution on that exact function and grant
it back only to identified operational roles. Trigger-returning functions are
not directly callable, but their side effects still matter during fixture
inserts.

The eight proposed fixture tables are all owned by `neondb_owner`, have no RLS,
and currently expose SELECT/INSERT/UPDATE/DELETE to that owner. Each identity
column has its own sequence (`Created_users_id_seq`, `learners_id_seq`,
`Login_accounts_id_seq`, `Login_sessions_id_seq` and the four
`learner_training_plan_*`/`learner_progress_entries` sequences). The inspected
FK graph includes account-to-session, enrolment-to-profile, profile-to-plan,
plan module-to-week-to-component and progress-to-profile/component edges. The
progress table also has two active user triggers: attendance-key validation and
`Engagement.shared_reward_queue_progress()`. The latter reads reward session,
configuration and policy tables and can insert reward outbox/saved-progress
rows. This is the concrete reason the login Provisioner must not receive a
simple eight-table DML grant.

## C. Neon Branch and Role Isolation Findings

Neon roles belong to a branch. A role created with SQL on `lms_ideal_test` is
not retroactively created on its parent or sibling branches. However, when a
new child branch is created, database roles and grants are copied with the
branch state. Neon documents that passwords are normally copied too; protected
parent branches generate new passwords for matching roles on the child. See
[protected branches](https://neon.com/docs/guides/protected-branches) and
[branching](https://neon.com/docs/introduction/branching).

Both the target and its parent are currently non-protected. Consequently, the
existing inherited `neondb_owner` credential may be reusable against the
parent if an attacker changes only the hostname. The current Python guard
rejects that swap, but the credential itself is not a branch-exclusive
security boundary.

Safeguards for implementation:

- Create both new roles by SQL only on the exact test branch and set unique,
  branch-specific secrets through a secret channel; never copy the existing
  owner secret.
- Create a read-only compute on the exact branch and pin its compute ID,
  branch ID, database and direct hostname in startup verification.
- Place only the Reader URL in the Django benchmark process. Keep the
  Provisioner URL in a separate, one-shot process/environment.
- Reject pooled/direct hostname substitutions unless the control-plane mapping
  proves both resolve to the authorised compute. Prefer the direct read-only
  hostname for deterministic identity.
- Do not support `DATABASE_URL` or any legacy alias fallback in benchmark
  mode. Never load production credential variables in that process.
- Treat descendants of the test branch as a credential-propagation risk;
  expire/rotate the two passwords before branching or immediately rotate them
  on a descendant.
- Protect sensitive long-lived parent/production branches as a separate
  project-control improvement. This report did not change protection state.

PostgreSQL guarantees role flags, membership, object ownership and grants.
Neon guarantees branch/compute identity and a read-only compute's storage
write boundary. Django guards and environment selection are defence-in-depth,
not replacements for either.

## D. Proposed Role Architecture

### `lms_benchmark_reader`

- SQL-created `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
  `NOINHERIT`, `NOREPLICATION`, `NOBYPASSRLS`, connection limit 4.
- Zero memberships and no ability to `SET ROLE` to any application, owner,
  Neon or predefined PostgreSQL role.
- `CONNECT` only to `neondb`; no database `CREATE` or `TEMPORARY`.
- `USAGE` only on schemas needed by the approved safe GET endpoint set.
- `SELECT` only on the explicit relation manifest below; no sequence grants,
  DML, `TRUNCATE`, ownership or schema creation.
- `default_transaction_read_only=on`, bounded statement/lock/idle timeouts and
  a fixed search path.
- Connect only through the new Neon read-only compute.

Static source tracing of the Phase 4G safe GET set justifies the initial read
manifest. It covers authentication/canonical identity, learner plan/progress,
curriculum catalogue/quizzes/live-session projection, audit/hour projection,
evidence metadata and review summaries. It intentionally does not grant all
tables in any schema:

| Schema | initial SELECT manifest |
|---|---|
| `login` | `Login_accounts`, `Login_sessions` |
| `enrolment` | `Created_users`, `Extended_ILR`, `Enrolment_Reviews` |
| `Learner` | `learners`, `learner_training_plan_modules`, `learner_training_plan_weeks`, `learner_training_plan_components`, `learner_progress_entries`, `learner_activity_sources`, `learner_activity_reporting_segments`, `learner_journal_rows`, `learner_progress_historical_components`, `learner_progress_ksbs`, `learner_quiz_answers`, `learner_quiz_chosen_answers`, `learner_quiz_correct_answers`, `learner_source_course_memberships`, `learner_monthly_targets`, `learner_activity_documents`, `Evidence`, `evidence_files`, `learning_reflection_submissions`, `reviews`, `review_sections`, `review_documents`, `progress_review_source_snapshots` |
| `curriculum` | `programmes`, `cohorts`, `groups`, `modules`, `weeks`, `components`, `historical_components`, `ksb_definitions`, `ksb_mappings`, `quizzes`, `quiz_questions`, `quiz_answers`, `quiz_component_links`, `quiz_course_links`, `record_revisions`, `source_courses`, `source_activities`, `source_materials`, `live_sessions`, `live_session_occurrences`, `live_session_attendance`, `review_types`, `review_templates`, `review_sections`, `review_fields`, `review_instances`, `review_instance_answers`, `review_instance_signatures`, `review_occurrence_overrides` |
| `Audit` | `learner_match`, `contract_document_archive`, `ilr_learning_deliveries`, `learner_evidence_overrides` |
| `Last_audit` | `learners`, `activities`, `activity_actual_hours`, `activity_planned_hours`, `activity_results`, `groups`, `group_learners`, `group_activities`, `learner_assignments`, `learner_attendance`, `attendance_module_exclusions`, `bank_holidays_england_wales` |
| `fetching_evidence` | `aptem_cv_contracts_probe`, `evidence_items`, `learner_evidence` |
| `structured_manual_activities` | `activity_ksbs`, `learner_activity_ksbs`, `learner_journal_row_ksbs`, `manual_activity_hours_revision` |
| `Coach` | `coach_calendar_event`, `coach_calendar_event_learner_link`, `coach_imported_review_instance`, `coach_migrated_review_document`, `coach_migrated_review_revision`, `coach_migrated_review_signature`, `coach_migrated_review_template`, `review_source_reconciliation` |

Before promotion, run the approved endpoints once with SQL statement tracing
on the synthetic identity. A missing relation is added only when a captured
query and source caller prove it is required; an unused relation is removed.
This is privilege tightening, not permission to use `SELECT ON ALL TABLES`.

### `lms_fixture_provisioner`

- SQL-created with the same non-privileged role flags, connection limit 1 and
  a distinct secret.
- No membership, ownership, schema creation, table DML, sequence use or
  function execution by default.
- `CONNECT` and `USAGE` only on a dedicated `benchmark_admin` schema.
- `EXECUTE` only on two reviewed security-definer functions:
  `provision_phase4g_fixture(...)` and `cleanup_phase4g_fixture(...)`.
- The functions validate `phase4g_<uuid>` namespace, reserved
  `@example.invalid` identity, exact branch/endpoint/database, exact row count
  (364), and return/consume an immutable receipt of IDs. They use fully
  qualified identifiers, a locked `pg_catalog` search path, a branch-level
  advisory lock, one transaction, fixed safe values and reverse-order exact-ID
  cleanup. They reject unknown dependencies instead of broadening cleanup.

The procedure owner may perform the exact inserts/deletes; the login role
cannot. This is preferable to direct DML because the eight fixture tables have
no RLS and include cyclic identity relationships. The progress insert also
fires `Engagement.shared_reward_queue_progress()`, which reads reward/session
tables and may write reward outboxes. Granting all trigger dependencies to the
login role would materially widen it. The procedure must assert zero reward,
attendance, audit, invitation, reset and read-model side effects before commit.

## E. Authentication Compatibility Assessment

Real authentication can operate read-only with a provisioned synthetic
`LoginSession`:

- Middleware resolves the cookie hash from `login.Login_sessions`, joins the
  active `LoginAccount`, then applies role and canonical learner identity.
- Learner requests do not enter the staff role-refresh mutation path.
- `touch_session` writes `Last_seen_at`/`Expires_at` only after the five-minute
  heartbeat threshold. Provision the one-hour synthetic session with
  `Last_seen_at=Expires_at` and complete the benchmark before expiry; the
  heartbeat returns without an update.
- Ordinary login is excluded because it updates/creates account, session and
  audit state. No last-login, token-refresh or audit insert is needed for the
  synthetic session path.
- If a hidden write is reached, the Reader grants, server read-only default and
  read-only compute cause it to fail closed. Such a failure is evidence to fix
  the benchmark path, not a reason to grant DML.

This preserves cookie validation, active-account checks, canonical identity,
role checks and object-level permissions. It is not an authentication bypass
and does not require production authentication changes or an in-memory fake
session backend.

## F. Database Alias Isolation

The existing benchmark settings expose only `default` and `enrolment`; both
derive from `LMS_IDEAL_TEST`, point to the same verified database and enforce
server-side read-only transaction defaults. Direct synchronous, class-level
psycopg and asynchronous connection paths are guarded.

Proposed runtime configuration:

```text
LMS_BENCHMARK_READER_URL = unique lms_benchmark_reader URL for the exact
                           read-only compute on lms_ideal_test

DATABASES.default   = parsed LMS_BENCHMARK_READER_URL
DATABASES.enrolment = an independent copy of the same parsed settings

Both aliases:
  branch id  = br-orange-shadow-abm8uwwe
  database   = neondb
  role       = lms_benchmark_reader
  endpoint   = the future read-only compute ID (not the current read-write ID)
  options    = default_transaction_read_only=on plus bounded timeouts
```

Fail startup unless both aliases have identical authorised identity, neither
contains `neondb_owner`/Provisioner credentials, and a live identity query
matches every pinned value. Reject `DATABASE_URL`, alternate aliases, pooled
fallback, parent/production endpoints and missing metadata.

The one-shot provisioning process reads a separate
`LMS_FIXTURE_PROVISIONER_URL`; Django must not read, inherit or log that
variable. Remove it from the environment before the localhost benchmark server
starts.

## G. Network Egress Proposal

The strongest practical design is a dedicated benchmark container/network
namespace with deny-all outbound traffic plus:

1. loopback/local benchmark traffic;
2. DNS through a controlled resolver; and
3. TCP 5432 only through a hostname-aware egress proxy/tunnel that validates
   the exact Neon read-only hostname and TLS server name.

Do not allow general TCP 443. Do not allow wildcard `*.neon.tech`. Block Graph,
Azure, SMTP, Redis and every unrelated API by default. Run the one-shot
Provisioner in a different short-lived container/profile; its credential and
read-write destination never enter the Django container.

If container isolation is unavailable, use Windows Defender Firewall
program-specific outbound rules for the exact benchmark Python executable,
default-deny that program, allow loopback, and use an FQDN dynamic keyword or
local allowlisting proxy for the exact Neon host. Microsoft documents FQDN
dynamic keywords, IPv4/IPv6 and DNS/DoH limitations; a DNS race remains, so
this is weaker than a controlled proxy/container. See
[FQDN dynamic keywords](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/dynamic-keywords)
and [Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure).

Never pin one resolved IP: Neon endpoint addresses can rotate, and separate
branches may share network infrastructure. Hostname + TLS identity + pinned
control-plane IDs form the destination identity.

## H. SQL Plan (review only; do not execute)

### Preconditions

Run every statement through an owner connection whose control-plane target was
re-verified immediately beforehand. Abort unless this read-only assertion
returns the expected values:

```sql
SELECT current_database(), current_user,
       current_setting('neon.branch_id', true) AS branch_id,
       current_setting('neon.endpoint_id', true) AS endpoint_id;
-- expected database=neondb, branch=br-orange-shadow-abm8uwwe;
-- endpoint must be the explicitly approved endpoint for the operation.
```

The following role DDL is branch-local Neon database state, but will be copied
to future descendants of this branch. The future Neon read-only compute and
branch protection/IP policy are control-plane operations, not SQL.

### Role creation and hardening

```sql
BEGIN;

CREATE ROLE lms_benchmark_reader
  LOGIN PASSWORD NULL
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;

CREATE ROLE lms_fixture_provisioner
  LOGIN PASSWORD NULL
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;

ALTER ROLE lms_benchmark_reader SET default_transaction_read_only = on;
ALTER ROLE lms_benchmark_reader SET statement_timeout = '30s';
ALTER ROLE lms_benchmark_reader SET lock_timeout = '2s';
ALTER ROLE lms_benchmark_reader SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE lms_benchmark_reader SET search_path = pg_catalog;

ALTER ROLE lms_fixture_provisioner SET statement_timeout = '30s';
ALTER ROLE lms_fixture_provisioner SET lock_timeout = '2s';
ALTER ROLE lms_fixture_provisioner SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE lms_fixture_provisioner SET search_path = pg_catalog;

REVOKE ALL ON DATABASE neondb FROM lms_benchmark_reader, lms_fixture_provisioner;
GRANT CONNECT ON DATABASE neondb TO lms_benchmark_reader, lms_fixture_provisioner;

-- Required because TEMP is currently inherited from PUBLIC. This is a
-- test-branch-wide change: review existing consumers, then explicitly grant it
-- back only to roles that genuinely require temporary tables.
REVOKE TEMPORARY ON DATABASE neondb FROM PUBLIC;

COMMIT;
```

Set unique passwords out of band only after the grants and validation pass;
`PASSWORD NULL` deliberately prevents premature login. Do not place a password
literal in a migration, report, shell history or Git.

### Reader object grants

```sql
BEGIN;

GRANT USAGE ON SCHEMA login, enrolment, "Learner", curriculum, "Audit",
  "Last_audit", fetching_evidence, structured_manual_activities, "Coach"
  TO lms_benchmark_reader;

GRANT SELECT ON login."Login_accounts", login."Login_sessions"
  TO lms_benchmark_reader;
GRANT SELECT ON enrolment."Created_users", enrolment."Extended_ILR",
  enrolment."Enrolment_Reviews" TO lms_benchmark_reader;

GRANT SELECT ON
  "Learner".learners,
  "Learner".learner_training_plan_modules,
  "Learner".learner_training_plan_weeks,
  "Learner".learner_training_plan_components,
  "Learner".learner_progress_entries,
  "Learner".learner_activity_sources,
  "Learner".learner_activity_reporting_segments,
  "Learner".learner_journal_rows,
  "Learner".learner_progress_historical_components,
  "Learner".learner_progress_ksbs,
  "Learner".learner_quiz_answers,
  "Learner".learner_quiz_chosen_answers,
  "Learner".learner_quiz_correct_answers,
  "Learner".learner_source_course_memberships,
  "Learner".learner_monthly_targets,
  "Learner".learner_activity_documents,
  "Learner"."Evidence", "Learner".evidence_files,
  "Learner".learning_reflection_submissions,
  "Learner".reviews, "Learner".review_sections,
  "Learner".review_documents,
  "Learner".progress_review_source_snapshots
  TO lms_benchmark_reader;

GRANT SELECT ON
  curriculum.programmes, curriculum.cohorts, curriculum.groups,
  curriculum.modules, curriculum.weeks, curriculum.components,
  curriculum.historical_components, curriculum.ksb_definitions,
  curriculum.ksb_mappings, curriculum.quizzes,
  curriculum.quiz_questions, curriculum.quiz_answers,
  curriculum.quiz_component_links, curriculum.quiz_course_links,
  curriculum.record_revisions, curriculum.source_courses,
  curriculum.source_activities, curriculum.source_materials,
  curriculum.live_sessions, curriculum.live_session_occurrences,
  curriculum.live_session_attendance, curriculum.review_types,
  curriculum.review_templates, curriculum.review_sections,
  curriculum.review_fields, curriculum.review_instances,
  curriculum.review_instance_answers, curriculum.review_instance_signatures,
  curriculum.review_occurrence_overrides
  TO lms_benchmark_reader;

GRANT SELECT ON
  "Audit".learner_match, "Audit".contract_document_archive,
  "Audit".ilr_learning_deliveries, "Audit".learner_evidence_overrides,
  "Last_audit".learners, "Last_audit".activities,
  "Last_audit".activity_actual_hours, "Last_audit".activity_planned_hours,
  "Last_audit".activity_results, "Last_audit".groups,
  "Last_audit".group_learners, "Last_audit".group_activities,
  "Last_audit".learner_assignments, "Last_audit".learner_attendance,
  "Last_audit".attendance_module_exclusions,
  "Last_audit".bank_holidays_england_wales,
  fetching_evidence.aptem_cv_contracts_probe,
  fetching_evidence.evidence_items, fetching_evidence.learner_evidence,
  structured_manual_activities.activity_ksbs,
  structured_manual_activities.learner_activity_ksbs,
  structured_manual_activities.learner_journal_row_ksbs,
  structured_manual_activities.manual_activity_hours_revision,
  "Coach".coach_calendar_event,
  "Coach".coach_calendar_event_learner_link,
  "Coach".coach_imported_review_instance,
  "Coach".coach_migrated_review_document,
  "Coach".coach_migrated_review_revision,
  "Coach".coach_migrated_review_signature,
  "Coach".coach_migrated_review_template,
  "Coach".review_source_reconciliation
  TO lms_benchmark_reader;

-- Remove the PUBLIC path before granting Coach schema usage to the Reader.
REVOKE EXECUTE ON FUNCTION
  "Coach".refresh_learner_absence_counts(integer,text) FROM PUBLIC;

COMMIT;
```

No sequence privileges are granted to the Reader. Do not add default
privileges or schema-wide future-object grants.

### Provisioner capability

Create `benchmark_admin` owned by the existing branch owner, revoke all from
PUBLIC, and create fixed security-definer provisioning/cleanup functions with
`SET search_path = pg_catalog`. Their reviewed body must implement exactly the
364-row manifest from Phase 4G and use fully qualified names. The login role
receives only:

```sql
BEGIN;
GRANT USAGE ON SCHEMA benchmark_admin TO lms_fixture_provisioner;
REVOKE ALL ON ALL TABLES IN SCHEMA benchmark_admin FROM lms_fixture_provisioner;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA benchmark_admin FROM lms_fixture_provisioner;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA benchmark_admin FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  benchmark_admin.provision_phase4g_fixture(text,text,timestamptz)
  TO lms_fixture_provisioner;
GRANT EXECUTE ON FUNCTION
  benchmark_admin.cleanup_phase4g_fixture(jsonb)
  TO lms_fixture_provisioner;
COMMIT;
```

Do not substitute direct table grants for the functions. If review rejects
security-definer functions, the alternative is dedicated disposable-branch
ownership and branch deletion after the run, not a general DML login.

### Verification queries

```sql
-- Direct flags.
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
       rolcanlogin, rolreplication, rolbypassrls, rolconnlimit
FROM pg_roles
WHERE rolname IN ('lms_benchmark_reader','lms_fixture_provisioner');

-- Must return zero rows, including recursive membership review.
SELECT pg_get_userbyid(member) AS member, pg_get_userbyid(roleid) AS role_name
FROM pg_auth_members
WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN
  ('lms_benchmark_reader','lms_fixture_provisioner'));

-- Reader must have no write or sequence privileges.
SET ROLE lms_benchmark_reader;
SELECT n.nspname, c.relname, c.relkind
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT LIKE 'pg_%'
  AND (has_table_privilege(current_user,c.oid,'INSERT')
    OR has_table_privilege(current_user,c.oid,'UPDATE')
    OR has_table_privilege(current_user,c.oid,'DELETE')
    OR has_table_privilege(current_user,c.oid,'TRUNCATE')
    OR (c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE')));
RESET ROLE;

-- Neither role may create in any application schema or the database.
SELECT r.rolname, n.nspname,
       has_schema_privilege(r.rolname,n.oid,'CREATE') AS can_create
FROM pg_roles r CROSS JOIN pg_namespace n
WHERE r.rolname IN ('lms_benchmark_reader','lms_fixture_provisioner')
  AND n.nspname NOT LIKE 'pg_%'
ORDER BY 1,2;

-- Review PUBLIC/default ACLs and every security-definer/callable mutator.
SELECT * FROM pg_default_acl;
SELECT n.nspname,p.proname,p.prosecdef,p.provolatile,p.proacl,p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prosecdef OR (p.provolatile='v' AND p.prorettype <> 'trigger'::regtype)
ORDER BY 1,2;
```

Expected results: both roles have only the specified flags; membership query
is empty; Reader write/sequence query is empty; schema `CREATE` is false;
Reader cannot execute any callable mutator in a schema it can use; Provisioner
can execute only the two benchmark functions.

### Rollback

Only after confirming no active benchmark/provisioning session and cleaning an
exact fixture receipt:

```sql
BEGIN;
REVOKE ALL PRIVILEGES ON DATABASE neondb
  FROM lms_benchmark_reader, lms_fixture_provisioner;
REVOKE ALL PRIVILEGES ON SCHEMA benchmark_admin
  FROM lms_benchmark_reader, lms_fixture_provisioner;
DROP ROLE lms_benchmark_reader;
DROP ROLE lms_fixture_provisioner;
-- Drop benchmark_admin functions/schema only after dependency inspection.
COMMIT;
```

Dropping a role does not clean fixture data. Cleanup must happen first through
the receipt-bound function. Do not use `DROP ... CASCADE`.

## I. Security Test Plan

### Reader

- Connect to the new read-only compute; assert database, branch, endpoint and
  role identity before any request.
- Positive: SELECT each manifest relation needed by a representative safe GET;
  run real synthetic-session authentication and owner Learner endpoints.
- Negative: cross-Learner request remains 404/forbidden; employer/anonymous
  remains denied; staff/admin contracts stay covered by isolated tests.
- Negative SQL: INSERT, UPDATE, DELETE and TRUNCATE an approved table; CREATE
  TABLE/TEMP TABLE/SCHEMA; nextval on a fixture sequence; SET ROLE to
  `neondb_owner`, `neon_superuser`, `pg_write_all_data` and Provisioner; all
  must fail.
- Attempt the identified Coach mutator and all security-definer functions; all
  must fail.
- Assert `default_transaction_read_only=on`, no ownership, no memberships and
  no RLS bypass. Test an RLS-protected canary only if one is deliberately
  created; do not claim current application tables are row-isolated by RLS.
- Run the safe endpoint set and compare a before/after database snapshot:
  zero application changes, session heartbeat updates, audit rows, outbox rows
  and sequence advances attributable to the Reader.

### Provisioner

- Direct SELECT/DML/sequence access outside its two functions must fail.
- Invalid namespace, non-reserved email, wrong branch/endpoint, duplicate run,
  wrong row count and altered cleanup receipt must fail before mutation.
- Provision exactly 364 rows, validate relationships and exact IDs, and prove
  no reward/attendance/audit/invitation/reset/read-model side effect before
  commit.
- Try to target an existing Learner or replace an ID in the receipt; procedure
  must reject it. Cleanup deletes only receipt IDs in reverse dependency order
  and verifies zero residue.
- Crash/retry tests must be atomic and idempotent. Unknown dependent rows stop
  cleanup for inspection; they never authorize cascade or wildcard deletion.
- Wrong endpoint simulation uses a fake/local endpoint identity and must fail
  closed; never connect to production to prove denial.

### Network

- In the isolated profile, localhost and the exact read-only Neon destination
  succeed.
- Controlled fake destinations representing production/other Neon branches,
  Graph/Azure, SMTP, Redis and generic HTTPS fail with firewall/proxy evidence.
- Test IPv4 and IPv6 paths, DNS refresh/rotation and TLS name mismatch.
- Verify the same Python executable outside benchmark mode retains normal local
  development policy; no global firewall mutation is required.

## J. Risks and Blockers

1. The branch was scheduled to expire on 2026-10-28. Any recreated branch has
   new identifiers and invalidates this report's pin until re-verified.
2. The current endpoint is read-write; a read-only compute does not yet exist.
3. The current owner credential is over-privileged and may be reusable against
   its non-protected parent. It must never enter benchmark runtime.
4. No core application table currently uses RLS. Reader SELECT grants expose
   the granted rows at SQL level; API object isolation remains Django-enforced.
5. The initial Reader manifest is source-derived. Final privilege tightening
   requires authenticated query capture against only the safe GET set.
6. Revoking database TEMP from PUBLIC and Coach mutator execution from PUBLIC
   are branch-wide changes. Existing test-branch consumers must be enumerated
   and explicitly re-granted only when justified.
7. The exact provisioning procedures still require a separate code/SQL review.
   Direct fixture DML is intentionally not approved by this design.
8. Trigger inspection disproved the assumption that eight table grants alone
   are sufficient: progress inserts traverse `Engagement` objects and may
   enqueue reward rows.
9. OS/container egress policy has been designed but not implemented or tested.

## K. Next Implementation Step

After explicit approval, perform one narrow infrastructure task on a renewed,
re-verified `lms_ideal_test` branch:

1. create a Neon read-only compute;
2. execute the reviewed role hardening/Reader grant SQL with passwords still
   disabled;
3. implement and review the two receipt-bound fixture functions;
4. set unique secrets out of band;
5. run the SQL privilege-negative tests and endpoint query trace; and
6. remove any unused SELECT grant before provisioning the 364-row fixture.

Do not start the HTTP benchmark until the Reader, Provisioner and independent
egress boundaries all pass.

## L. Safety Confirmation

- Roles created or altered: **NONE**.
- `GRANT`, `REVOKE` or `ALTER ROLE` executed: **NONE**.
- Database records modified: **NONE**.
- Schema, ownership, migration or index changes: **NONE**.
- Synthetic fixtures created: **NONE**.
- Network/firewall/container changes: **NONE**.
- Production or parent branch access: **NONE**.
- External integration calls: **NONE**.
- Production application/frontend/API contract changes: **NONE**.
- Teams files edited: **NONE**; Teams baseline and expanded checks are **NOT REQUIRED**.
- Commit or push: **NONE**.
- Existing worktree changes, including the pre-existing `AGENTS.md` change:
  **preserved**.

