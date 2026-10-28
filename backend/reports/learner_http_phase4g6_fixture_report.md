# Phase 4G.6 - Secure Synthetic Learner Provisioning

Date: 2026-10-28 12:46 Africa/Cairo

## A. Verdict

**PARTIALLY IMPLEMENTED**

The branch-local least-privilege fixture infrastructure was created and
verified. The synthetic Learner was **not** created. Provisioning found
pre-existing orphaned Engagement rows whose `progress_id` values overlap the
next IDs that PostgreSQL would assign to the planned 357 progress rows. Treating
those historical rows as fixture-owned would make the receipt and cleanup
unsafe, so every provisioning attempt rolled back.

A fail-closed collision guard is now installed in the provisioning function and
was exercised successfully before any insert or sequence consumption. Because
there is no fixture, the acceptance requirements for 364 application rows,
authentication, receipt ownership, and rollback-only cleanup rehearsal are not
met.

## B. Environment

Authoritative Neon metadata and an exact database connection guard confirmed:

| Item | Verified value |
|---|---|
| Project | `green-term-97168878` |
| Branch | `lms_ideal_test` / `br-orange-shadow-abm8uwwe` |
| Parent reference | `br-raspy-sky-abvs8lq9` |
| Reset source | parent LSN `1F/C6433540`, timestamp `2026-10-28T08:53:53Z` |
| Database | `neondb` |
| Endpoint | `ep-dawn-block-ab5vob3x`, direct, read-write |
| Connected role | `neondb_owner` for fixture administration only |
| Branch state | ready, non-primary, non-default, unprotected |
| Expiration | `2026-11-25T09:54:00Z` |

The live SQL guard returned the exact database, branch, and endpoint IDs above.
No SQL connection was made to the parent or Production. No conflicting fixture
receipt, namespace, advisory lock, or benchmark process was found during
preflight.

## C. Database Objects

Created on `lms_ideal_test` only:

- `lms_fixture_owner`: `NOLOGIN`, `NOINHERIT`, no superuser, `CREATEDB`,
  `CREATEROLE`, replication, or `BYPASSRLS` capability.
- `lms_fixture_provisioner`: restricted `LOGIN`, connection limit 1,
  `NOINHERIT`, no privileged flags, bounded session timeouts, and fixed
  `search_path=pg_catalog`.
- `benchmark_admin` schema and `fixture_receipts` table.
- `benchmark_admin.provision_phase4g_fixture(text,text,timestamptz)` and
  `benchmark_admin.cleanup_phase4g_fixture(jsonb)`.

Effective-permission verification:

- Provisioner direct application DML grants: **0**.
- Provisioner application-schema `CREATE`: **0**; database `TEMP`: **false**.
- Provisioner callable application routines: exactly the two approved fixture
  functions.
- Function owner: `lms_fixture_owner`; both are `SECURITY DEFINER` with
  `search_path=pg_catalog`.
- PUBLIC function execution: **false** for both functions.
- Fixture owner ownership of pre-existing application objects: **0**.
- Fixture roles are not members of privileged roles and cannot `SET ROLE` to
  `neondb_owner`. Neon records two inverse administrative edges in which
  `neondb_owner` administers the fixture roles; both have `inherit=false` and
  `set=false` and grant no privileges to the fixture roles.
- The provisioner credential was generated separately, rotated after the final
  function update, and stored only in Windows Credential Manager at
  `LMS_v2/phase4g6/lms_fixture_provisioner`. No credential, DSN, or token was
  printed or written to the repository.

The SQL plan was validated against the current database before execution: 76
dependency relations, 91 referenced writable columns after excluding the
generated column, 8 sequences, 16 outbound foreign keys, 62 inbound dependency
foreign keys, and 3 target-table triggers. Trigger functions were verified as
security-invoker functions. Existing triggers and constraints remained enabled.

## D. Fixture Inventory

No synthetic fixture is active.

| Object | Expected | Committed |
|---|---:|---:|
| Created_users | 1 | 0 |
| Learner profile | 1 | 0 |
| Login account | 1 | 0 |
| Login session | 1 | 0 |
| Training Plan module | 1 | 0 |
| Training Plan week | 1 | 0 |
| Training Plan component | 1 | 0 |
| Progress entries | 357 | 0 |
| **Application total** | **364** | **0** |
| Receipt | 1 | 0 |

All failed attempts were atomic and rolled back. Two attempts reached progress
insertion before containment detected the historical collision. PostgreSQL
sequences are non-transactional, so the progress sequence advanced by 714 even
though no application row committed. It was deliberately not reset.

The final guard test proved fail-closed behavior:

- sequence before: `939437`;
- expected collision exception: received;
- sequence after: `939437`;
- receipt count after: `0`.

The stale synthetic-session Credential Manager entry created during a failed
attempt was deleted. No fixture-handle credential exists. The restricted
provisioner credential remains for an explicitly approved remediation and retry.

## E. Authentication Readiness

**NOT VERIFIED.** There is no synthetic LoginAccount or LoginSession to validate
through real middleware, and no `force_login` or authentication bypass was used.
No raw session token is retained.

The benchmark runtime itself remains isolated: both `default` and `enrolment`
resolve to `lms_benchmark_reader` on the exact test endpoint, transactions are
read-only, owner environment variables are absent, and there is no
`DATABASE_URL` fallback.

Reader verification returned 88 table-level SELECT grants, 0 table DML grants,
0 sequence privileges, 0 application-schema CREATE privileges, and no TEMP
privilege. A remaining prerequisite is that the Reader currently has neither
table-level nor column-level SELECT on
`"Learner".progress_transfer_requests.enrolment_id`, while the canonical
identity read adapter declares that column as required. The task explicitly
prohibited changing the Reader, so no grant was added.

## F. Trigger Verification

No fixture-owned trigger side effect committed. The target triggers and their
transitive Engagement paths were inspected before provisioning.

The blocking database state is:

| Evidence | Value |
|---|---:|
| Maximum committed progress ID | 938723 |
| Progress sequence `last_value` | 939437 |
| Maximum saved-reward `progress_id` | 940754 |
| Saved-reward rows | 1796 |
| Saved-reward rows with no matching progress row | 666 |
| Reward-outbox rows with no matching progress row | 4 |

Therefore the planned ID interval intersects historical trigger rows. The
installed guard checks the prospective 357-ID interval against progress,
reward-outbox, and saved-reward rows before any application insert. A live call
confirmed that it rejects the collision without advancing the sequence.

No existing Engagement row was updated or deleted, and triggers were not
disabled.

## G. Cleanup Safety

The cleanup function is installed but was not run against an active fixture.

Completed checks:

- static review of exact-ID deletion order and receipt equality checks;
- catalog inspection of all 62 inbound foreign-key dependencies;
- exact expected counts and a post-delete residue assertion in the function;
- invalid receipt rejection: PASS;
- wrong-role execution rejection: PASS;
- provisioner role-escalation rejection: PASS;
- direct application insert rejection: PASS;
- wrong-target guard and immutable Neon branch/endpoint context: PASS;
- no sequence reset, `TRUNCATE`, `CASCADE`, wildcard cleanup, or dynamic object
  identifier is present.

Not executable without a valid receipt-owned fixture:

- rollback-only cleanup of the expected 364 application rows and one receipt;
- dynamic unknown-dependent-row and ownership-mismatch negative cases;
- active-fixture retention check after rollback.

Cleanup remains fail-closed and must not be treated as fully demonstrated until
those active-fixture tests pass.

## H. Security Tests

| Check | Result |
|---|---|
| Fixture role/function effective-permission checks | PASS - all 15 checks returned true |
| Live collision guard and no sequence advance | PASS |
| Invalid receipt, wrong role, SET ROLE, direct DML negative checks | PASS - 4/4 |
| `python manage.py test config.test_test_isolation_no_db config.tests_test_branch_guard --verbosity=1` | PASS - 44/44 |
| `python manage.py test login.test_selectors_no_db login.tests_learner_progress_gate learner_api.test_curriculum_lookup_permissions_no_db --verbosity=1` | PASS - 56/56 |
| `python -B reports/verify_phase4g2_runtime.py` | PASS - exact Reader identity, aliases, host, read-only transaction, no owner/fallback environment |
| Exact fixture inventory and synthetic ownership | BLOCKED - no fixture created |
| Real Django session and canonical identity | BLOCKED - no fixture; Reader prerequisite above |
| Rollback-only valid cleanup rehearsal | BLOCKED - no receipt-owned fixture |
| Authenticated HTTP benchmark | NOT RUN - explicitly outside this phase |
| Teams checks | NOT REQUIRED - no Teams file or behavior changed |

Focused tests used test doubles or read-only database checks; no external
Teams, Graph, Azure, SMTP, Redis, or paid integration was invoked.

## I. Remaining Risks

1. Historical orphan reward rows overlap prospective progress IDs. Safe options
   require a separate decision: advance the sequence beyond every conflicting
   historical ID with an explicitly bounded operation, or investigate/remediate
   the orphan rows. Deleting or rewriting those pre-existing rows is outside
   this task and was not attempted.
2. The Reader lacks the required column grant for canonical transfer-state
   identity reads. Reader changes were forbidden in this phase.
3. The branch uses the existing read-write endpoint. PostgreSQL privileges and
   read-only runtime transactions are enforced, but there is no dedicated
   read-only compute and no complete process/container egress boundary.
4. The test branch is unprotected and expires at
   `2026-11-25T09:54:00Z`; expiry must be rechecked before a later retry.
5. Rolled-back inserts consumed 714 sequence values. No records were overwritten
   and no sequence reset was performed, but this gap is a permanent observable
   effect of the failed safe attempts.

## J. Next Phase

Do not start the authenticated HTTP benchmark yet. Before provisioning can be
retried:

1. approve one bounded resolution for the orphan-ID collision;
2. separately approve and verify the minimum Reader column grant required by
   canonical identity, without adding DML;
3. recheck branch identity/expiration and rerun the guarded provisioner;
4. require exact 364+1 inventory, zero unexpected trigger writes, real session
   and canonical identity resolution, and the rollback-only cleanup rehearsal;
5. only after those checks pass, retain the fixture and proceed to the HTTP
   benchmark phase.

## K. Safety Confirmation

- Production modifications: **none**.
- Parent-branch access or modifications: **none at the SQL/database level**;
  parent identity was read only from authoritative target-branch metadata.
- Existing Learner record modifications: **none**.
- Existing Engagement record modifications: **none**.
- External integrations: **none**.
- Django migrations: **none**.
- Application business logic, frontend code, and API contracts: **unchanged by
  this phase**.
- Branch/worktree creation or switching: **none**.
- Commit or push: **none**.
- Existing contributor worktree changes: **preserved**.

