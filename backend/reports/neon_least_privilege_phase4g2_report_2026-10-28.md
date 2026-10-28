# Phase 4G.2 - Secure Benchmark Infrastructure Execution

Date: 2026-10-28 (Africa/Cairo)

Verdict: **PARTIALLY IMPLEMENTED**

## 1. Neon branch identity and lifetime

Authoritative Neon metadata verified:

- Project: `LMS` / `green-term-97168878`
- Branch: `lms_ideal_test` / `br-orange-shadow-abm8uwwe`
- Parent: `br-raspy-sky-abvs8lq9`
- State: ready; non-primary, non-default, non-protected
- Database: `neondb`
- Existing endpoint: `ep-dawn-block-ab5vob3x`, type `read_write`
- Expiry: `2026-10-28T13:01:57Z` = 15:01:57 Africa/Cairo
- The branch expiration was not extended.

Final authoritative check at 11:15:16 Africa/Cairo showed approximately
3 hours 46 minutes remaining.

The last metadata check reported `written_data_bytes=0` and no
`phase4g_%@example.invalid` account or Learner row.

## 2. Benchmark Reader creation

`lms_benchmark_reader` was created with a separate randomly generated secret.
The DSN is stored only as a current-user encrypted Generic Credential in
Windows Credential Manager at
`LMS_v2/phase4g2/lms_benchmark_reader`; it was not printed, written to a
repository file, committed, or pushed.

Role flags and defaults:

- LOGIN, connection limit 4
- NOSUPERUSER, NOINHERIT, NOCREATEDB, NOCREATEROLE, NOREPLICATION,
  NOBYPASSRLS
- `default_transaction_read_only=on`
- statement timeout 30s, lock timeout 2s, idle-transaction timeout 15s
- locked `search_path=pg_catalog`

`PUBLIC` database TEMPORARY was revoked on this test branch. PUBLIC EXECUTE on
`"Coach".refresh_learner_absence_counts(integer,text)` was also revoked before
granting Reader schema usage.

## 3. Actual effective database permissions

The new credential was used for live positive and negative checks, rather than
relying only on catalog inspection.

- Required SELECT: accepted.
- Application INSERT/UPDATE/DELETE/TRUNCATE relations: 0.
- Sequence USAGE grants: 0.
- Schema/database CREATE: rejected.
- TEMP TABLE: rejected.
- CREATE ROLE: rejected.
- SET ROLE to `neondb_owner`: rejected.
- Identified Coach mutator: rejected.
- Role memberships: 0.
- Owned objects: 0.
- RLS bypass: false.
- Unsafe callable SECURITY DEFINER/volatile mutators in Reader-usable schemas:
  none found after the Coach revoke.

The Reader has explicit schema USAGE and relation-level SELECT only for the
Phase 4G manifest. No `SELECT ON ALL TABLES`, default privileges, future-object
grant, application DML, sequence grant or object ownership was added.

## 4. Read-only compute

**BLOCKED / NOT CREATED.** The Neon connector advertises endpoint creation but
the execution service returned `Tool create_postgres_endpoint not found` on
both attempts. No browser/app surface was available for an authenticated Neon
Console fallback. No new endpoint or unapproved resource was created, and the
existing read-write endpoint was preserved unchanged.

The implemented runtime therefore connects the Reader to the existing endpoint
and enforces read-only transactions through both the role default and libpq
`options=-c default_transaction_read_only=on`. This is database-role isolation,
not a substitute for an independent read-only compute.

## 5. Django benchmark isolation

Implemented:

- benchmark-only credential loading from Windows Credential Manager;
- `default` and `enrolment` aliases built only from the Reader DSN;
- owner and legacy fallback variables rejected/suppressed in benchmark mode;
- exact project branch, endpoint, database, host and role pins;
- direct psycopg, psycopg classmethod, async psycopg and optional psycopg2
  guards, including live current-user/branch/database/read-only verification;
- external integrations, background jobs and database writes remain disabled;
- normal Django authentication, session resolution, role checks and
  object-level authorization remain enabled.

The live Django startup check returned exactly aliases `default` and
`enrolment`, both as `lms_benchmark_reader`, on branch
`br-orange-shadow-abm8uwwe`, endpoint `ep-dawn-block-ab5vob3x`, database
`neondb`, with `transaction_read_only=on`. No owner/fallback variable was
loaded.

### Verification-launcher safety incident

One invocation of the new verification helper was launched without benchmark
environment variables before the helper was made self-contained. Django loaded
the ordinary development `.env` and issued one read-only identity SELECT to the
parent `lms-ideal-architecture` endpoint. No write, migration, fixture, HTTP
request or benchmark ran. The helper was immediately changed to remove every
owner/fallback input in its own process and set the exact benchmark mode before
`django.setup()`. The corrected invocation then reached only `lms_ideal_test`
with the Reader identity. This incident is a scope violation and is recorded
here rather than hidden.

## 6. Network isolation

**PARTIAL.** The existing Python process guard blocks non-loopback/non-allowlist
DNS and sockets, requests, urllib, httpx, SMTP and direct PostgreSQL connection
paths. Tests prove Graph/Azure/generic HTTPS and unauthorised PostgreSQL targets
are rejected before connection. The exact benchmark PostgreSQL destination is
the only remote allowlist entry.

No Docker or Podman is installed, WSL has no usable distribution, and there is
no repository container/network-namespace profile. System-wide Windows Firewall
changes were intentionally not made. Consequently there is no independent
kernel/container egress boundary against native extensions or a separately
spawned process; that boundary remains incomplete.

## 7. Fixture Provisioner readiness

`lms_fixture_provisioner` exists with the same non-privileged flags, connection
limit 1, no memberships, no ownership, and zero application SELECT/DML/sequence
capability. Its password is NULL and it cannot currently be used.

Trigger and dependency inspection confirmed:

- attendance-key validation on progress INSERT/UPDATE;
- Engagement reward trigger on progress INSERT;
- one reward policy, 31 enabled reward configurations and 364 reward sessions;
- a broad FK closure across Learner, login, enrolment, Coach, curriculum and
  chat tables.

The exact 364-row provision/receipt/containment/cleanup procedure is prepared in
`phase4g2_fixture_provisioning_runbook_2026-10-28.md`. No `benchmark_admin`
schema, SECURITY DEFINER function, EXECUTE grant, provisioner credential or
fixture row was created. Those capabilities still require the separately
approved implementation/review gate specified by Phase 4G.1.

## 8. Validation results

Passed:

- `python manage.py test config.test_test_isolation_no_db config.tests_test_branch_guard --verbosity=1`
  - 41/41 passed.
- `python manage.py test login.test_selectors_no_db login.tests_learner_progress_gate learner_api.test_curriculum_lookup_permissions_no_db --verbosity=1`
  - 56/56 passed.
- `python -B reports/verify_phase4g2_runtime.py`
  - Django startup and both database aliases verified on the Reader/test branch.
- AST parsing of six changed Python entry points
  - 6/6 passed.
- Live Reader SQL checks
  - SELECT allowed; INSERT, UPDATE, DELETE, CREATE, TEMP, CREATE ROLE, SET ROLE
    and the identified mutator rejected.
- Catalog re-audit
  - no membership, ownership, app DML, sequence usage, PUBLIC TEMP, unsafe
    Coach PUBLIC EXECUTE or synthetic fixture residue.

The first `py_compile` attempt did not complete because Windows denied replacing
an existing `__pycache__` file; AST parsing was used instead and passed. This
was a filesystem cache issue, not a Python syntax failure.

Not run:

- authenticated Learner HTTP benchmark (no test-owned identity);
- fixture provisioning or cleanup;
- frontend tests (no frontend file changed);
- Teams baseline and expanded Teams checks (not required; no Teams file edited);
- live Teams/Azure/Graph operations.

## 9. Remaining blockers

1. Independent Neon read-only compute is absent.
2. Independent OS/container egress isolation is absent; only the in-process
   guard is verified.
3. SECURITY DEFINER fixture functions and their exact narrow EXECUTE grants are
   deliberately not implemented without the required separate approval.
4. No valid test-owned Learner identity exists.
5. The branch expires at 15:01:57 Africa/Cairo and was not extended.
6. The verification-launcher parent-branch read incident must be considered in
   security review even though it was read-only and the launcher is now
   fail-closed.

## 10. Phase 4G provisioning readiness

**Not ready for synthetic Learner provisioning.** The Reader and Django runtime
isolation are implemented and verified, and the controlled fixture runbook is
prepared, but the provisioner has intentionally received no executable
capability. Read-only compute and an independent network boundary also remain
unresolved. Do not create the 364-row fixture or run authenticated benchmarks
until those blockers and the separate fixture-function approval are resolved.

## Safety record

- Migrations: none.
- Existing Learner changes: none.
- Synthetic rows: none.
- Production writes: none.
- Teams/Azure/Graph calls: none.
- Branch extension: none.
- Git branch/worktree creation or switch: none.
- Commit/push: none.
- `AGENTS.md`: not modified by Phase 4G.2; its pre-existing worktree change was
  preserved.
