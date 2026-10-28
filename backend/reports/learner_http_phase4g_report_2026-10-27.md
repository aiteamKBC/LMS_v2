# Phase 4G - Authenticated Learner HTTP Performance Benchmark

Date: 2026-10-27  
Git branch: `fix/api-endpoints`  
Verdict: **BLOCKED**

## A. Verdict

The authenticated HTTP benchmark did not run. The dedicated Neon branch and read-only connection were verified, but no explicitly test-owned Learner identity, usable benchmark credential, or recoverable synthetic session was present. The branch was created from an existing data snapshot and had `written_data_bytes=0`; therefore an existing account cannot be classified as synthetic merely because it is on the test branch.

Following the task's safety gate, no existing Learner was impersonated, no authentication middleware or object-level permission was bypassed, no local benchmark server was started, and no HTTP request was sent. This is **BLOCKED**, not partially measured: there are no Phase 4G HTTP samples.

## B. Environment

| Item | Verified value |
|---|---|
| Neon organisation | Kent Business College (`org-falling-sea-18071422`) |
| Project | `LMS` (`green-term-97168878`) |
| Target branch | `lms_ideal_test` (`br-orange-shadow-abm8uwwe`) |
| Parent branch | `lms-ideal-architecture` (`br-raspy-sky-abvs8lq9`) |
| Branch state | Ready; non-primary, non-default, non-protected |
| Branch writes before benchmark | `written_data_bytes=0` |
| Endpoint | Direct endpoint `ep-dawn-block-ab5vob3x`; the configured pooled hostname was converted to the matching direct hostname for inspection |
| Database | `neondb`, PostgreSQL `18.6 (fd34222)` |
| Transaction mode | `transaction_read_only=on` |
| Recovery state | `pg_is_in_recovery=false` |
| Connection source | `LMS_IDEAL_TEST` only; no `DATABASE_URL` fallback |
| Isolation mode | `LMS_TEST_MODE=postgres-read-only` with the Phase 4F network/database guard |

Django configuration resolved only two database aliases, `default` and `enrolment`. Both pointed to the verified endpoint/database and both carried `-c default_transaction_read_only=on`. Audit, attendance, assistant-conversation, ticketing, and separate learner-auth aliases were suppressed before `.env` loading and rejected if they survived configuration.

Two Phase 4F guard defects were corrected during preflight:

1. PostgreSQL URI `options` are now parsed by the connection guard, so the guard can verify server-enforced read-only mode.
2. Spaces in libpq URI options are encoded as `%20`, not `+`; libpq now receives `-c default_transaction_read_only=on` correctly.

The benchmark mode also now prevents `.env` from silently reintroducing external database aliases after the shell environment has removed them. These are benchmark/test-isolation changes only; no application business logic or response contract changed.

## C. Authenticated Identity

### Identity audit

A read-only aggregate inspection looked only for accounts using reserved synthetic domains ending in `.test` or `.invalid`. It returned:

| Condition | Count |
|---|---:|
| Candidate accounts | 0 |
| Candidates with a password | 0 |
| Candidates with a live session | 0 |
| Candidates with a canonical Learner profile | 0 |
| Candidates with programme association | 0 |
| Candidates with a training plan | 0 |

No names, email addresses, account IDs, Learner IDs, session hashes, or tokens were output. No benchmark credentials or session cookie were present in the environment. Existing session rows contain hashes only, so their plaintext cookies cannot and must not be reconstructed.

The real authentication path was inspected. `LoginSession` resolution, active-account checks, canonical identity mapping, role checks, and object-level permissions can be preserved with a real synthetic session. Ordinary login is unsuitable for a read-only benchmark because successful login updates the account, creates a session, and may create an audit record. Authenticated requests can also update `Last_seen_at` or renew `Expires_at` after the five-minute heartbeat threshold.

### Exact proposed provisioning writes - not executed

Provision one median-shape identity in a single transaction, on `lms_ideal_test` only, after explicit authorisation. Use a unique `phase4g_<random>` namespace and a reserved `@example.invalid` address. The proposed row set is:

| Rows | Table | Required relationship and safe values |
|---:|---|---|
| 1 | `enrolment."Created_users"` | Identity-generated `id`; generated UUID; `Learner_type='apprenticeship'`; synthetic username/email; active status; programme/cohort/group set to the synthetic namespace; no employer, invitation, phone, or real-person fields; `Learning_plan` contains one synthetic module/week/component; `Free_courses=[]` |
| 1 | `"Learner".learners` | Identity-generated `id`; same UUID and synthetic email; `enrolment_id` points to the Created_users row; active lifecycle; matching learner type/programme/cohort/group; one-module learning plan |
| 1 | `login."Login_accounts"` | Identity-generated `id`; `Subject_type='learner'`; `Subject_id` points to Created_users; `Role='learner'`; active; synthetic email; empty password hash because benchmark authentication uses an ephemeral session rather than the login endpoint |
| 1 | `login."Login_sessions"` | Identity-generated `id`; `Account_id` points to the synthetic account; store only SHA-256 of a cryptographically random token; plaintext token exists only in benchmark-client memory; one-hour expiry; not remembered; localhost metadata only |
| 1 | `"Learner".learner_training_plan_modules` | `learner_id` points to the canonical Learner profile; position 0; namespaced module ref/title; no curriculum FK required |
| 1 | `"Learner".learner_training_plan_weeks` | Points to the synthetic plan module; position 0; namespaced week ref/title |
| 1 | `"Learner".learner_training_plan_components` | Points to the synthetic plan week; position 0; namespaced component ref/title/type |
| 357 | `"Learner".learner_progress_entries` | `learner_id` points to the canonical Learner profile; unique `entry_order` 1-357; `kind='component'`; points to the synthetic plan component; matching namespaced refs; empty/non-matching time-tracking and source values; `source_payload={}`; `kbc_attendance_key=NULL`; no evidence or real content |

Total proposed insert count: **364 rows**. The IDs would be captured as exact receipts. Small, p95, and maximum shapes would remain **NOT VERIFIED**; no real Learner would be used to fill those gaps.

Session heartbeat handling must be explicit. The safest no-code benchmark setup is to create the one-hour synthetic session with `Last_seen_at=Expires_at`, preventing `touch_session` from issuing its five-minute heartbeat during the benchmark while leaving real session lookup, active-account validation, role checks, canonical identity, and object-level permission code intact. This deliberately unusual test value must be limited to the synthetic namespace and removed during cleanup.

### Referential integrity, triggers, signals, and cleanup

- Schema inspection confirmed the account-to-session FK, enrolment-to-profile FK, profile-to-plan graph, plan component FK, and `(learner_id, entry_order)` uniqueness.
- Raw SQL inside one explicit transaction is recommended for provisioning so Django `post_save` handlers cannot enqueue learner-home read-model events or create system-audit records.
- PostgreSQL triggers still run. The progress rows must keep `kbc_attendance_key` null, avoid an `att:*` original-source reference, use a namespaced module ref other than `MOD-KBC-PMP-M01-SMR`, and leave the time-tracking session ref empty. This avoids attendance linking and shared-reward outbox conditions.
- After insert, read-only verification must prove exactly 364 owned rows, correct relationships, no extra login-audit/invitation/reset rows, and no rows in attendance, reward, or read-model outboxes for the namespace.
- Cleanup must delete only captured IDs in reverse dependency order: progress, plan component, plan week, plan module, session, account, profile, then enrolment. Cleanup requires a separate explicitly authorised write transaction and must verify zero remaining rows by exact receipt IDs. It must never use wildcard email/title deletion, cascade discovery, flush, or broad delete.
- If either provisioning verification or cleanup encounters an unknown dependent row, stop and preserve the isolated fixture for inspection rather than broadening deletion.

A local disposable PostgreSQL validation was not possible because neither `psql` nor Docker is available on this host. No provisioning was attempted on Neon.

## D. Endpoints Measured

No endpoint was measured. The table is intentionally free of invented timings.

| Page | Endpoint group | HTTP status | Samples | HTTP p50/p95 | TTFB | SQL count / DB time | Raw/gzip bytes | Status |
|---|---|---:|---:|---|---|---|---|---|
| Home | Learner summary, home summary, upcoming | - | 0 | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT RUN |
| Dashboard | Minimal header, weekly initial/selected, overview, monthly, training | - | 0 | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT RUN |
| My Learning | Catalogue, search, upcoming, module detail | - | 0 | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT RUN |
| Learner detail/progress | Summary projection, metrics, student activity | - | 0 | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT RUN |
| Learning Plan | Plan read, weekly learning, safe module/component detail | - | 0 | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT RUN |
| Evidence/reviews | Evidence list, safe review summary | - | 0 | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT RUN |

The default full Learner Detail GET, calendar availability refresh, attendance settlement, and any other GET with an unproven mutation path remain excluded.

## E. Page-Level Waterfalls

These are source-observed dependencies from the current frontend, not Phase 4G network measurements.

```text
Learner Home
route/auth -> Learner Summary permission gate -> home-summary + upcoming in parallel

Dashboard
route/auth -> minimal header -> Weekly initial (selected detail primed)
                              -> Overview only when opened
                              -> Monthly only when opened
                              -> Training timeline, then selected module detail

My Learning
route/auth -> catalogue
              -> debounced search, with serial nextOffset pages
              -> module detail only after card selection
              -> upcoming only after user action
Quizzes/Assignments -> Learner Summary consumers

Learning Plan
authorized learner -> current plan
                   -> weekly plan with selected detail primed

Progress/Evidence
authorized learner -> metrics, student activity, and evidence list independently
```

This graph preserves the intentional Learner Summary authorization gate on Home and does not treat lazy requests as initial-page fan-out.

## F. Bottleneck Ranking

No Phase 4G request was measured, so no HTTP endpoint is ranked. PostgreSQL statement timings from earlier phases are not substituted for request latency.

| Page | Endpoint | HTTP p50 | HTTP p95 | SQL Count | DB Time | Payload | Main Bottleneck |
|---|---|---|---|---|---|---|---|
| All requested pages | All requested endpoints | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Not classified |

## G. Previous Optimisation Impact

The following is historical context only:

- Phase 4D's mixed isolated SQL shape improved from a 1,231.115 ms median to 248.406 ms and reduced examined revision rows from 1,447,221 to 32,490. It was not an HTTP result.
- Phase 4E's catalogue SQL improved PostgreSQL execution by 28.3%-42.1% across its four shapes and reduced examined rows materially. Remote DB-client timing remained variable; no authenticated HTTP measurement existed.
- Phase 4B reported a 12.7%-23.9% synthetic Python improvement for Learner Summary projection reuse. It did not establish end-to-end HTTP impact.

No paired before/after HTTP claim is made because no safe authenticated identity was available and no code revision/database-snapshot pairing was executed.

## H. Security Validation

- Verified the requested Neon project, exact test branch name/ID, parent branch, endpoint, database, and server-side read-only transaction state.
- Confirmed the target branch is not primary, default, protected, or the parent `lms-ideal-architecture` branch.
- Confirmed Django exposes only the verified `default` and `enrolment` aliases in benchmark mode.
- Existing isolated permission tests cover anonymous denial, Learner ownership, cross-Learner denial, and relevant staff/admin contracts.
- Real authentication and object-level permissions were inspected and were not bypassed.
- No identity healing, request-driven write, or external integration was exercised because HTTP execution stopped at the missing-identity gate.
- No existing account, session, or Learner record was used.

## I. Test Results

| Check | Result |
|---|---|
| `python manage.py test config.test_test_isolation_no_db --verbosity=1` | **21/21 passed** |
| `python manage.py test config.test_test_isolation_no_db config.tests_test_branch_guard --verbosity=1` | **31/31 passed** total |
| `python manage.py test login.test_selectors_no_db login.tests_learner_progress_gate learner_api.test_curriculum_lookup_permissions_no_db --verbosity=1` | **56/56 passed** |
| Authenticated HTTP benchmark | **0 executed / BLOCKED** |
| Local disposable PostgreSQL provisioning test | **NOT RUN** - `psql` and Docker unavailable |
| Frontend tests | **NOT RUN** - no frontend source changed and no HTTP benchmark was executed |
| Teams baseline | **NOT REQUIRED** - no Teams-listed file changed |
| Expanded Teams checks | **NOT REQUIRED** |
| Live Teams | **NOT RUN** |

## J. Remaining Gaps

1. Explicit approval is required before inserting the described 364-row synthetic fixture on `lms_ideal_test` and later deleting those exact receipts.
2. The provisioning and cleanup process has not been validated on a disposable local PostgreSQL instance.
3. All requested HTTP latency, TTFB, cold/warm, raw/gzip, query-count, DB-client, Python, serialization, cache, request-ID, fingerprint, plan, rows, and buffer metrics remain **NOT VERIFIED**.
4. Only the proposed median shape has fixture coverage. Small, p95, and maximum representative shapes remain unavailable.
5. Cross-Learner, employer, and staff/admin behavior is covered by isolated tests, not by Phase 4G live local HTTP requests.
6. Frontend waterfall descriptions are source-observed and have no timing samples.

## K. Next Implementation Task

There is no highest confirmed HTTP bottleneck yet. The next task is fixture enablement, not application optimisation:

1. Obtain explicit authorisation for the exact 364-row insert and receipt-based cleanup on `lms_ideal_test`.
2. Run a preflight that re-verifies project/branch/database/aliases immediately before writes.
3. Provision the synthetic median-shape identity transactionally with all external networking blocked.
4. Verify relationships, trigger containment, no dependent side effects, and real session/role/object-permission resolution.
5. Start a localhost-only server in PostgreSQL read-only mode and confirm a single authenticated safe GET performs no write.
6. Run one warm-up, at least 20 sequential warm samples, and a bounded number of cold samples per proven read-only endpoint.
7. Rank only the measured requests, then propose the smallest optimisation for the highest confirmed bottleneck.
8. Delete only exact fixture receipts in reverse dependency order and verify zero residue.

No application optimisation should be selected from historical SQL evidence alone.

## L. Safety Confirmation

- Production access: **NONE**.
- Protected Neon branch writes: **NONE**.
- Any Neon writes: **NONE**.
- Existing Learner impersonation: **NONE**.
- Production cookies or credentials: **NONE**.
- Local HTTP server starts: **NONE**.
- HTTP benchmark requests: **NONE**.
- Teams, Graph, Azure, SMTP, or other external calls: **NONE**.
- Migrations, schema changes, index changes, or destructive operations: **NONE**.
- Frontend production changes: **NONE**.
- API contract or production business-logic changes: **NONE**.
- Commit/push: **NONE**.
- `AGENTS.md`: not modified by Phase 4G; the existing worktree modification was preserved.
- Unrelated contributor changes: preserved.

Sanitised machine-readable evidence is stored in `backend/reports/learner_http_phase4g_preflight_2026-10-27.json`.
