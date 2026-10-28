# Phase 4G.4 - Secure Neon Learner HTTP Benchmark

Date: 2026-10-28  
Target: `LMS` / `green-term-97168878` / `lms_ideal_test` only

## A. Verdict

**BLOCKED**

The existing restricted Reader and Django benchmark isolation were verified, and an exact receipt-controlled fixture design was prepared but not executed. A trustworthy authenticated HTTP benchmark cannot start because all three required gates are still open:

1. No read-only Neon compute exists. Creating one adds an independent compute resource with usage-based compute implications, so it was not provisioned without approval.
2. No independent OS/container egress boundary is available on this host. The existing Python network guards are application controls, not an independent network boundary.
3. The synthetic Learner, session, SECURITY DEFINER functions, and 364 application rows have not been explicitly approved or created.

No HTTP percentile, TTFB, SQL-count, payload, cache, or bottleneck claim is made.

## B. Neon Infrastructure

Authoritative Neon metadata and a Reader connection were checked on 2026-10-28.

| Resource | Verified value | Status |
|---|---|---|
| Project | `LMS` / `green-term-97168878` | Verified |
| Region / PostgreSQL | `aws-eu-west-2` / PostgreSQL 18 | Verified |
| Branch | `lms_ideal_test` / `br-orange-shadow-abm8uwwe` | Ready; non-primary; non-default; non-protected |
| Parent | `br-raspy-sky-abvs8lq9` (`lms-ideal-architecture`) | Identified only; not accessed |
| Branch origin | Parent-data branch | Verified |
| Expiration | `2026-10-28T13:01:57Z` | About 4h24m remained at `2026-10-28T11:37:11+03:00` |
| Database | `neondb`, owner `neondb_owner` | Verified; owner was not used by the Django benchmark runtime |
| Existing endpoint | `ep-dawn-block-ab5vob3x`, `read_write`, 0.25-8 CU, autosuspend disabled | Preserved |
| Read-only endpoint | None | Not created |
| Reader | `lms_benchmark_reader` | Existing and verified |
| Fixture caller | `lms_fixture_provisioner` | Existing LOGIN role but no usable credential supplied to this run; no memberships, table DML grants, or explicit routine EXECUTE grants |
| Planned function owner | `lms_fixture_owner` | Does not exist; creation is only in the unexecuted SQL plan |

Neon's documentation describes a read replica as an independent read-only compute attached to the same branch storage and configurable with autoscaling/scale-to-zero. It therefore cannot be represented by setting `transaction_read_only` on the current read-write endpoint. The exact proposed resource, pending cost/resource approval, is:

- Branch: `br-orange-shadow-abm8uwwe` only.
- Type: `read_only`.
- Name: `phase4g4-benchmark-ro`.
- Compute: fixed minimum supported 0.25 CU (`min=0.25`, `max=0.25`).
- Scale-to-zero: 300 seconds.
- Pooler: disabled for direct session/endpoint identity verification.
- Passwordless access: disabled.
- Existing read-write endpoint: unchanged.

References: [Neon Read Replicas](https://neon.com/docs/introduction/read-replicas), [Neon Scale to Zero](https://neon.com/docs/introduction/scale-to-zero).

## C. Database and Network Isolation

### Independently verified database restrictions

Using `lms_benchmark_reader` on the exact test branch/database/endpoint:

- `current_user = lms_benchmark_reader`.
- `current_database() = neondb`.
- `neon.branch_id = br-orange-shadow-abm8uwwe`.
- `neon.endpoint_id = ep-dawn-block-ab5vob3x`.
- `transaction_read_only = on`.
- 88 selectable application relations.
- 0 writable application relations.
- 0 sequence USAGE grants.
- 0 role memberships and 0 application-object ownership.
- `NOSUPERUSER`, `NOINHERIT`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`.

The existing benchmark runtime verification also proved:

- Only `default` and `enrolment` aliases are configured.
- Both aliases use the Reader and the exact test branch/endpoint/database.
- Owner environment variables were not loaded.
- Fallbacks, including `DATABASE_URL`, were not loaded.
- PostgreSQL direct-connection guards remained active.
- External integrations and background jobs remained blocked by the existing Phase 4F/4G isolation controls.

The read-only transaction on the existing read-write endpoint is useful defence in depth but is not a substitute for the required read-only compute.

### Independent network boundary

**BLOCKED.** Docker and Podman are absent; WSL has no usable distribution; Windows Sandbox/Hyper-V container tooling is unavailable. `CheckNetIsolation` manages AppContainer exemptions and does not provide a suitable arbitrary-Python allowlist. A Windows process-specific firewall rule would be a system-wide firewall change, which was not approved.

The existing Python socket guards remain application-level protection only. DNS, IPv4, IPv6, endpoint rotation, and child-process egress are therefore not independently constrained.

## D. Fixture Provisioning

### Approval checkpoint

1. **Verified target:** `green-term-97168878` / `br-orange-shadow-abm8uwwe` / `ep-dawn-block-ab5vob3x` / `neondb`; the fixture write functions are hard-gated to this identity.
2. **Exact application inserts:**

   | Table | Rows |
   |---|---:|
   | `enrolment."Created_users"` | 1 |
   | `"Learner".learners` | 1 |
   | `login."Login_accounts"` | 1 |
   | `login."Login_sessions"` | 1 |
   | `"Learner".learner_training_plan_modules` | 1 |
   | `"Learner".learner_training_plan_weeks` | 1 |
   | `"Learner".learner_training_plan_components` | 1 |
   | `"Learner".learner_progress_entries` | 357 |
   | **Application total** | **364** |

   Provisioning also performs one scoped `Created_users.learner_id` update and inserts one immutable receipt row in `benchmark_admin.fixture_receipts`, for 365 inserted rows including the control row.
3. **Trigger-driven writes:** each progress insert invokes the existing attendance-link and shared-reward trigger paths. Fixed input values keep `kbc_attendance_key` null, `submitted_at` null, tracking/session/source strings empty, and `kind='component'`; expected trigger-created rows are zero. The procedure asserts zero reward outbox/saved-progress, login invitation/reset/audit, and read-model outbox side effects and rolls back if containment fails.
4. **Planned SQL objects/privileges:** one NOLOGIN `lms_fixture_owner`, one `benchmark_admin` schema, one receipt table, and two fixed-search-path SECURITY DEFINER functions. The function owner receives only the enumerated table/sequence/dependency privileges. The provisioner receives only `CONNECT`, schema `USAGE`, and EXECUTE on those two functions; it receives no direct table or sequence privilege and no role membership.
5. **Credential scope:** a separate single-connection provisioner credential must be generated outside source control and supplied only to the provisioning/cleanup process. The Reader credential remains separate. No credential or connection string is stored in the plan or report.
6. **Input/ownership controls:** namespace must be `phase4g_<canonical-lowercase-uuid>`; token input is a 64-character SHA-256 hash; expiry is 30-90 minutes; collision checks, an advisory transaction lock, exact captured IDs, and an immutable JSON receipt bind provision and cleanup.
7. **Cleanup:** receipt equality is checked and owned rows are locked. Catalog-derived FK checks and explicit non-FK side-effect checks fail closed. Cleanup then deletes exactly 357 progress rows plus the seven other application rows, deletes the one receipt, and performs one scoped unlink update. Unknown or additional dependent rows stop cleanup; no wildcard or broad delete is allowed.
8. **Maximum intended write impact:** provisioning is 364 application inserts + 1 receipt insert + 1 scoped update; cleanup is 364 application deletes + 1 receipt delete + 1 scoped update. Eight identity sequences advance by 364 values and are never reset, including after a later transaction rollback. Unexpected trigger output causes rollback rather than broader cleanup.
9. **Isolation state:** Reader/database isolation is verified; read-only compute and independent network isolation are not present. These unresolved boundaries prevent execution even before considering fixture approval.

Exact reviewed SQL: `backend/reports/phase4g4_fixture_security_definer_not_executed_2026-10-28.sql`.

**Approval state: NOT APPROVED / NOT EXECUTED.** No role, schema, table, function, credential, synthetic record, session, or cleanup write from this plan was created or run.

## E. Authentication

No synthetic Learner exists, and no real Learner credential or inherited session was used. The proposed database session token was not generated or inserted. No localhost Django server was started and no forced authentication was used.

Result: **actual synthetic Learner authentication NOT VERIFIED**.

The focused isolated tests did preserve the real login selector, canonical learner identity, anonymous denial, cross-Learner denial, and staff/admin permission contracts, but these tests are not a substitute for a real authenticated HTTP session on the target branch.

## F. HTTP Results

No endpoint was measured. Empty values are deliberate and must not be replaced by historical SQL timings.

| Page | Endpoint | HTTP p50 | HTTP p95 | SQL Count | DB Time | Payload |
|---|---|---:|---:|---:|---:|---:|
| Learner Home | Not run | N/A | N/A | N/A | N/A | N/A |
| Dashboard | Not run | N/A | N/A | N/A | N/A | N/A |
| My Learning | Not run | N/A | N/A | N/A | N/A | N/A |
| Learner Summary | Not run | N/A | N/A | N/A | N/A | N/A |
| Weekly Learning | Not run | N/A | N/A | N/A | N/A | N/A |
| Training Plan | Not run | N/A | N/A | N/A | N/A | N/A |
| Progress | Not run | N/A | N/A | N/A | N/A | N/A |
| Evidence and Reviews | Not run | N/A | N/A | N/A | N/A | N/A |

HTTP status, TTFB, warm/cold samples, maximum latency, PostgreSQL execution time, Django time, serialization time, raw/gzip bytes, and cache behaviour are all **NOT VERIFIED**.

## G. Query-Level Bottlenecks

None ranked. There is no Phase 4G.4 HTTP evidence. Earlier Phase 4D/4E PostgreSQL measurements and Phase 4B Python measurements remain historical component-level evidence and are not presented as HTTP latency.

## H. Frontend Waterfall

No browser/network waterfall was captured. The current source was inspected at `frontend/src/pages/learner/home/page.tsx:103-106`, `frontend/src/pages/workspace/learner/DashboardTabs.tsx:45-74`, `frontend/src/pages/learner/my-learning/page.tsx:86-93`, `frontend/src/pages/learner/my-learning/CompactModules.tsx:34-45,105-143`, and `frontend/src/api/myLearning.ts:26-65`. The following is source-observed request ordering only:

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

Learning Plan
authorized learner -> current plan
                   -> weekly plan with selected detail primed

Progress / Evidence / Reviews
authorized learner -> metrics, student activity, evidence, and review reads independently
```

This indicates intentional lazy loading and one known serial pagination dependency for My Learning search. Without browser timestamps and payloads, it does not prove a duplicate request, render blocker, heavy payload, or safe parallelism opportunity.

## I. Tests

| Command / check | Result |
|---|---|
| `python -B reports/verify_phase4g2_runtime.py` | **PASS**; only `default`/`enrolment`, Reader-only exact target, no owner/fallback environment loaded |
| `python manage.py test config.test_test_isolation_no_db config.tests_test_branch_guard --verbosity=1` | **44/44 passed** in 32.389s |
| `python manage.py test login.test_selectors_no_db login.tests_learner_progress_gate learner_api.test_curriculum_lookup_permissions_no_db --verbosity=1` | **56/56 passed** in 0.107s |
| Reader target/role/privilege SQL | **PASS**; exact test identity, read-only transaction, SELECT-only effective access |
| Provisioner current grants SQL | **PASS**; 0 memberships, 0 table DML grants, 0 explicit routine EXECUTE grants |
| Read-only compute connection | **NOT RUN / BLOCKED**; resource does not exist |
| Independent egress isolation | **BLOCKED**; no safe existing boundary |
| SECURITY DEFINER validation/execution | **NOT RUN**; separate approval required |
| Fixture provision/cleanup | **NOT RUN**; separate approval required |
| Authenticated HTTP benchmark | **0 requests / BLOCKED** |
| Frontend tests | **NOT RUN**; no frontend source changed and benchmark did not start |
| Teams baseline | **NOT REQUIRED**; no Teams-listed file edited |
| Expanded Teams checks | **NOT REQUIRED** |
| Live Teams | **NOT RUN** |

## J. Changes

Repository files created by Phase 4G.4:

- `backend/reports/phase4g4_fixture_security_definer_not_executed_2026-10-28.sql` - exact unexecuted fixture/security design.
- `backend/reports/learner_http_phase4g4_neon_report_2026-10-28.md` - this report.

No production backend source, frontend source, test source, settings, migration, `.env`, credential file, `AGENTS.md`, branch, or worktree was changed.

Database/infrastructure resources created or changed by Phase 4G.4: **none**.

Read-only operations performed: authoritative Neon metadata inspection, Reader catalog/privilege queries, runtime verification, source inspection, and focused isolated tests.

## K. Outstanding Risks

1. Creating the proposed read replica is an additional compute resource. Scale-to-zero reduces active compute usage but does not remove the need for resource/cost approval.
2. Independent egress isolation is absent; application-level Python guards cannot constrain every process, DNS/IPv4/IPv6 path, or endpoint rotation.
3. The exact SECURITY DEFINER SQL has not been parsed/executed against a disposable PostgreSQL clone or server-validated on Neon. Execution may expose a schema drift or privilege dependency and must fail closed.
4. Existing progress triggers are transitive write paths. The fixed values and containment assertions are designed for zero trigger-created rows, but this is not proven until an approved atomic provisioning transaction runs.
5. Sequence values will advance and cannot be transactionally reclaimed; this is the only intended persistent artifact after successful cleanup.
6. No actual authentication, object-level request authorization, cross-Learner live denial, response contract, no-write request proof, or HTTP performance metric exists for this phase.
7. Branch expiry is near. It must not be extended, replaced, or redirected to the parent without explicit instruction.

## L. Next Action

The smallest safe next task is to resolve the two infrastructure gates before authorising data writes:

1. Explicitly approve or reject creation of `phase4g4-benchmark-ro` with the exact 0.25-CU, 300-second scale-to-zero configuration in section B.
2. Provide an approved independent process/container egress mechanism, or explicitly authorise a narrowly scoped Windows firewall implementation after its exact rules and rollback are reviewed.
3. Only after both gates pass, review and explicitly approve the exact SECURITY DEFINER objects and the provision/cleanup write impact in section D. That approval must cover both creation/provisioning and receipt-bound cleanup.

Until then, do not create the fixture and do not run the authenticated HTTP benchmark.

## M. Safety Confirmation

- No Production or parent-branch database connection was made.
- No Neon migration, branch change, extension, replacement, endpoint creation, or endpoint update occurred.
- No database write, DDL, SECURITY DEFINER object, credential, synthetic identity, or session was created.
- No owner credential was loaded into the Django benchmark process.
- No real Learner credential/session or learner data was used.
- Authentication and object-level permissions were not disabled or bypassed.
- No external Teams, Azure, Graph, mail, storage, or paid-service operation was executed.
- No system firewall rule was changed and no software was installed.
- No commit or push was made.

