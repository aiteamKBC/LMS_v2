# Phase 4G.6B — Controlled Sequence Adjustment and Synthetic Learner Provisioning

Date: 2026-10-28 (Africa/Cairo)  
Target: `green-term-97168878 / lms_ideal_test / br-orange-shadow-abm8uwwe / neondb`  
Endpoint: `ep-dawn-block-ab5vob3x`

## A. Verdict

**FIXTURE READY AND VERIFIED**

The minimum Reader grant is active, the progress identity sequence was advanced
forward under a transaction-held sequence lock, and exactly 364 synthetic
application rows plus one receipt were committed. The real Django session,
canonical identity lookup, and object-level learner gate all passed using the
Reader credential. The fixture is retained for Phase 4G.7. No HTTP performance
benchmark and no final cleanup ran.

## B. Environment Verification

Authoritative Neon metadata and the PostgreSQL session agreed on the target:

| Evidence | Verified value |
|---|---|
| Project | `green-term-97168878` |
| Branch name / ID | `lms_ideal_test` / `br-orange-shadow-abm8uwwe` |
| Parent ID recorded in target metadata | `br-raspy-sky-abvs8lq9` |
| Parent snapshot recorded in target metadata | LSN `1F/C6433540`, timestamp `2026-10-28T08:53:53Z` |
| Last reset | `2026-10-28T08:54:00Z` |
| Branch state | ready; non-primary; non-default; unprotected |
| Expiration | `2026-11-25T09:54:00Z` |
| Database / endpoint | `neondb` / `ep-dawn-block-ab5vob3x` |
| Owner session | `neondb_owner`; exact branch and endpoint settings; writable only for the controlled operation |
| Other client sessions before the critical section | 0 |
| Relevant granted locks before the critical section | 0 |

The parent metadata above was read from the target branch's control-plane
record. No connection was made to the parent database or Production.

## C. Previous and New Sequence State

| State | Before | After |
|---|---:|---:|
| Sequence `last_value` | 939437 | 941111 |
| Sequence next value | 939438 | 941112 |
| Maximum committed progress ID | 938723 | 941111 |
| Progress row count | 277717 | 278074 |

The sequence was restarted at 940755 and the fixture consumed
`940755..941111`. The forward adjustment skipped 1,317 sequence values
(`939438..940754`) and never moved backwards. Sequence ownership remains the
identity dependency (`deptype='i'`) owned by `neondb_owner`.

Two preliminary coordinator attempts failed closed before provisioning: one on
the deliberately unavailable `SET ROLE lms_fixture_owner`, and one because a
nested owner-context call lacked EXECUTE on the existing provision function.
Both transactions rolled back. The sequence remained 939437, no receipt or
fixture existed, temporary credentials were removed, and no control object
survived either attempt.

## D. Safe ID Window

The safe interval was recomputed from the live union of:

- `Learner.learner_progress_entries.id`;
- `Engagement.shared_reward_saved_progress.progress_id`;
- `Engagement.shared_reward_outbox.progress_id`.

Immediately before the successful adjustment:

| Evidence | Value |
|---|---:|
| Current next sequence value | 939438 |
| Maximum progress ID | 938723 |
| Maximum saved-reward progress ID | 940754 |
| Maximum reward-outbox progress ID | 938721 |
| Saved-reward orphan rows | 666 |
| Minimum 357-ID collision-free window | `940755..941111` |

The search was bounded to at most 1,000,000 candidates. The candidate was
recomputed again after sequence and table locks were held; it was not taken
from the earlier audit as a constant.

## E. Concurrency and Locking Evidence

The successful critical section used a short-lived, dedicated
`phase4g6b_control` schema containing one `SECURITY DEFINER` coordinator owned
by the sequence owner. The schema granted only USAGE to
`lms_fixture_provisioner`; the function granted only EXECUTE to that role and
explicitly revoked PUBLIC.

Within one provisioner transaction the coordinator:

1. verified `session_user`, database, branch and endpoint;
2. acquired the existing fixture advisory transaction lock;
3. executed the no-op `ALTER SEQUENCE ... CACHE 1`, acquiring the sequence
   relation lock before any table lock;
4. acquired `SHARE ROW EXCLUSIVE ... NOWAIT` only on progress, saved-reward and
   reward-outbox tables;
5. reread the sequence and recomputed the first safe interval;
6. executed transactional `ALTER SEQUENCE ... RESTART WITH 940755`;
7. returned while all locks remained held by the same transaction;
8. invoked the existing restricted provision function as the provisioner;
9. asserted the 357 exact IDs and sequence state before commit.

The `NOWAIT` table locks make an inverse-lock-order writer fail the operation
closed rather than expose a range or deadlock. A direct `nextval()` consumer
must wait behind the sequence relation lock. The temporary function and schema
were dropped without `CASCADE` immediately after commit and are confirmed
absent.

This deliberately avoids `setval()`: PostgreSQL documents that `setval()`
changes are immediately visible and are not undone on rollback, whereas
`ALTER SEQUENCE ... RESTART` is transactional and blocks concurrent sequence
operations until the transaction completes:

- <https://www.postgresql.org/docs/16/functions-sequence.html>
- <https://www.postgresql.org/docs/17/sql-altersequence.html>

## F. Reader Permission Change

Applied exactly:

```sql
GRANT SELECT (enrolment_id)
ON TABLE "Learner".progress_transfer_requests
TO lms_benchmark_reader;
```

Final effective privileges:

| Check | Result |
|---|---|
| Column SELECT on `enrolment_id` | true |
| Table-wide SELECT | false |
| DML grants | 0 |
| Role memberships | 0 |
| Database TEMP | false |
| `Learner` schema CREATE | false |
| BYPASSRLS | false |
| Transaction read-only | on |

## G. Synthetic Fixture Inventory

Receipt: `2558c5ef-a31b-4e72-9dbe-2df0f368208c`.
The namespace and raw session token are intentionally omitted.

| Object | Exact ID / range | Rows |
|---|---:|---:|
| Enrolment `Created_users` | 1602 | 1 |
| Learner profile | 1251 | 1 |
| Login account | 633 | 1 |
| Login session | 6763 | 1 |
| Training-plan module | 11460 | 1 |
| Training-plan week | 181203 | 1 |
| Training-plan component | 1410458 | 1 |
| Progress entries | `940755..941111` | 357 |
| **Application total** |  | **364** |
| Receipt control row | receipt ID above | 1 |

All 357 progress IDs are unique, belong to learner 1251 and component 1410458,
and are absent from both historical Engagement tables. The stored receipt
payload equals the returned receipt exactly.

## H. Trigger Side-Effect Verification

All trigger and dependent-table containment checks passed:

| Check | Result |
|---|---:|
| Saved-reward rows referencing fixture progress IDs | 0 |
| Reward-outbox rows referencing fixture progress IDs | 0 |
| Login audit rows for fixture | 0 |
| Invitations for fixture | 0 |
| Password resets for fixture | 0 |
| Fetching-evidence read-model outbox rows | 0 |
| Public read-model outbox rows | 0 |
| Fixture progress rows with attendance keys | 0 |

Historical state remains 1,796 saved-reward rows, 666 saved-reward orphans and
4 reward-outbox orphans. Maximum historical saved-reward progress ID remains
940754. Post-provision fingerprints were captured as verification evidence;
no historical Engagement row was updated or deleted.

## I. Receipt and Cleanup Status

The cleanup procedure was exercised only inside a transaction that was rolled
back. Its full FK/dependency validation took approximately 86 seconds on this
snapshot, so the helper now raises `statement_timeout` to a bounded 120 seconds
only for that rollback-only call; the provisioner role's 30-second default is
unchanged.

| Cleanup check | Result |
|---|---|
| Valid exact receipt would delete 364 application + 1 control row | PASS |
| Empty receipt rejected | PASS |
| Altered receipt rejected | PASS |
| Reader/wrong role rejected | PASS |
| Active fixture retained after rollback | PASS — 357 progress rows |
| Sequence reset attempted | No |

Final cleanup was not executed.

## J. Authentication Verification

The verifier ran in a separate process with owner/fallback database variables
removed and only the Reader credential available. It used Django's real
`kbc_session` cookie path; it did not use `force_login`, fabricate middleware
state, or call the login writer.

| Check | Result |
|---|---|
| Django aliases | exactly `default`, `enrolment` |
| Both database aliases | Reader-only target |
| `/login_api/me/` with synthetic cookie | 200; learner account 633 / enrolment 1602 |
| Owned learner summary | 200; enrolment 1602 |
| Different learner ID | 404 (object hidden) |
| Anonymous `/login_api/me/` | 401 |
| Anonymous owned summary | 401 |
| Canonical enrolment → Learner | 1602 → 1251 |
| Session row before/after requests | unchanged |

The unusual synthetic `Last_seen_at = Expires_at` value kept the genuine
session lookup read-only, so session validation required no forbidden write.

## K. Security Tests

| Command / check | Result |
|---|---|
| `python manage.py test config.test_test_isolation_no_db config.tests_test_branch_guard --verbosity=1` | PASS — 44/44 |
| `python manage.py test login.test_selectors_no_db login.tests_learner_progress_gate learner_api.test_curriculum_lookup_permissions_no_db --verbosity=1` | PASS — 56/56 |
| `python backend/reports/verify_phase4g6b_auth.py` | PASS — 15/15 assertions |
| Reader privilege/effective-role SQL | PASS — column-only SELECT, no DML/elevation |
| Provisioner security verifier | PASS — 15/15 controls |
| Exact fixture/receipt/side-effect verifier | PASS |
| Cleanup rollback rehearsal | PASS — 5/5 controls |
| Python compile for the two new helpers | PASS |

External integration isolation remained enabled by test-branch mode. No Teams
file was edited, so the Teams baseline and expanded Teams checks are **NOT
REQUIRED**.

## L. Changed Files and Database Objects

Files:

- `backend/reports/execute_phase4g6b.py` — target-pinned execution and evidence helper;
- `backend/reports/verify_phase4g6b_auth.py` — Reader-only real auth/ownership verifier;
- `backend/reports/provision_phase4g6_fixture.py` — cleanup rehearsal's local bounded timeout;
- this report.

Persistent database changes on the test branch only:

- one column-level Reader grant;
- forward sequence position;
- 364 synthetic application rows;
- one receipt row.

Temporary `phase4g6b_control` schema/function: removed. No application schema,
index, constraint, trigger, role membership or production setting changed.
The raw session secret and receipt handle are stored only in the existing
Windows Credential Manager targets.

## M. Remaining Risks

- Cleanup dependency validation is intentionally comprehensive and currently
  takes about 86 seconds. Future schema growth may require re-measurement before
  final cleanup; it must not be bypassed.
- The branch expires at `2026-11-25T09:54:00Z`; Phase 4G.7 and cleanup must
  finish before expiry or obtain separate approval to extend it.
- This phase proves authentication/readiness, not HTTP latency, TTFB, query
  count, payload size, cache behaviour or percentile performance.

## N. Phase 4G.7 Readiness

**READY** for the separately authorised, Reader-only authenticated Learner HTTP
benchmark. The retained synthetic identity, session credential, exact receipt
and rollback-verified cleanup path are available. Phase 4G.7 must continue to
use the verified test branch and must not load owner credentials into Django.

## O. Safety Confirmation

- No Production access or change.
- No parent-branch database access or change.
- No existing Learner record modified.
- No historical Engagement record modified, deleted or repaired.
- No trigger or constraint disabled.
- No migration, branch reset, synthetic over-provisioning or final cleanup.
- No external Teams, Azure, Graph, mail, storage or other integration call.
- No HTTP performance benchmark.
- No credential or raw authentication token printed or committed.
- No `AGENTS.md` edit by this task.
- No Git branch/worktree creation, commit, push or deployment.
