# Phase 4G.7 — Authenticated Learner HTTP Benchmark

Date: 2026-10-28 (Africa/Cairo)  
Verdict: **BLOCKED**

## A. Verdict

The real HTTP benchmark was not executed. The mandatory independent process/container egress boundary is not available on this host. Python connection guards remain useful defence in depth, but they are not independent network isolation and were not treated as such.

Consequently:

- no Django HTTP server was started;
- no localhost HTTP request was sent;
- no warm-up, cold, or measured sample was collected;
- no latency, SQL-count, payload, or endpoint-ranking claim is made;
- safe source-level request discovery, endpoint classification, database-runtime verification, and focused regression tests were completed.

This is a security-gate blocker, not an endpoint failure.

## B. Benchmark Environment

Authoritative Neon metadata and the Reader-only Django runtime agreed on the target:

| Item | Verified value |
|---|---|
| Project | `green-term-97168878` |
| Branch | `lms_ideal_test` |
| Branch ID | `br-orange-shadow-abm8uwwe` |
| Parent ID (metadata only; not accessed) | `br-raspy-sky-abvs8lq9` |
| Parent snapshot | LSN `1F/C6433540`, timestamp `2026-10-28T08:53:53Z` |
| Database | `neondb` |
| Endpoint | `ep-dawn-block-ab5vob3x` |
| PostgreSQL role | `lms_benchmark_reader` |
| Branch state | `ready`, non-primary, non-default, unprotected |
| Last reset | `2026-10-28T08:54:00Z` |
| Expiration | `2026-11-25T09:54:00Z` (about 27 days 23 hours remaining at verification) |

The final runtime check reported both Django aliases (`default`, `enrolment`) on the same exact endpoint, database, branch and Reader role, with `default_transaction_read_only=on`.

## C. Security and Isolation Evidence

### Passed controls

- `python -B reports/verify_phase4g2_runtime.py` reported aliases exactly `default` and `enrolment`.
- Both aliases used `lms_benchmark_reader` at `ep-dawn-block-ab5vob3x.eu-west-2.aws.neon.tech`.
- Database identity was `lms_benchmark_reader / neondb / br-orange-shadow-abm8uwwe / ep-dawn-block-ab5vob3x / read-only on`.
- Owner environment loading was false.
- `DATABASE_URL` fallback loading was false.
- A direct Reader-only preflight found no database TEMP privilege, no DML grants, no role memberships, and no `BYPASSRLS`.
- The Reader's denied access to the `Engagement` schema remained intact; it was not broadened for this task.
- The runtime verification performed no startup write.

### Failed mandatory control

No independently verified process/container boundary could be established:

- Docker: unavailable.
- Podman: unavailable.
- Windows Sandbox: unavailable.
- Hyper-V control/runtime: unavailable.
- Firejail: unavailable.
- WSL command surface existed, but no usable installed distribution/runtime was available.
- Reading the active Windows Firewall policy failed with `CimException`; no scoped rule could be verified.

No Windows Firewall rule was changed and no isolation software was installed. Per the task's gate, execution stopped before server startup.

## D. Synthetic Learner Identity Validation

The Phase 4G.6B fixture was reused, not recreated:

| Object | Verified state |
|---|---|
| Enrolment | ID `1602`, one exact row |
| Canonical Learner | ID `1251`, one exact row |
| LoginAccount | ID `633`, one exact row |
| LoginSession | ID `6763`; token hash matched; unrevoked |
| Module / week / component | `11460` / `181203` / `1410458` |
| Progress rows | 357 exact fixture rows, IDs `940755..941111` |
| Receipt handle | `2558c5ef-a31b-4e72-9dbe-2df0f368208c`, present in Windows Credential Manager |

At Reader-only preflight database time `2026-10-28T10:57:00.495821Z`, the session expiry was `2026-10-28T11:43:50.827622Z`, and it was neither expired nor revoked. The credential value was never printed.

Actual middleware authentication was not repeated in Phase 4G.7 because doing so over real HTTP was downstream of the failed network gate. The immediately preceding Phase 4G.6B evidence remains: owned request 200, anonymous 401, cross-learner 404, and no session-row mutation. This report does not relabel that earlier verification as a Phase 4G.7 HTTP sample.

## E. Discovered Request Inventory and Classification

All URLs below came from the current frontend clients and Django URL configuration. `learner_self_or_staff` (or the equivalent learner ownership decorator) is required for every listed learner-scoped read. Payload descriptions are contract summaries, not measured sizes.

| Page / load | Actual GET URL | Django view | Frontend caller | Expected payload | Side-effect classification |
|---|---|---|---|---|---|
| Home, identity first | `/learner_api/learner-summary/{kind}/{id}/` | `learner_detail.learner_summary` | `useLearnerSummaryParam` / `fetchLearnerSummary` | Small identity, status and access gate | **SAFE**; DB projections only |
| Home, initial after identity | `/learner_api/overview-week/{kind}/{id}/?section=home-summary` | `overview_week.overview_week` | `homeSummary` | Home progress/activity summary | **SAFE** for `home-summary`; unlike `section=home`, this branch does not enqueue a read-model refresh |
| Home, initial after identity | `/learner_api/training-plan-dashboard/{kind}/{id}/?section=upcoming` | `training_plan_dashboard.training_plan_dashboard` | `upcomingSchedule` | Upcoming lectures, assignments and reviews | **SAFE**; stored database reads |
| Dashboard, critical first | `/learner_api/dashboard/{kind}/{id}/header/minimal/` | `dashboard_header.dashboard_header` | `useDashboardHeader` | Canonical learner/header/access projection | **SAFE**; stored database reads |
| Dashboard, default Weekly after header | `/learner_api/dashboard/{kind}/{id}/weekly/plan/` | `dashboard_weekly.dashboard_weekly` | `useWeeklyLearning` | Weekly spine plus selected-week compact detail | **SAFE**; selected detail is primed client-side |
| Dashboard, lazy week | `/learner_api/dashboard/{kind}/{id}/weekly/plan/{weekId}/?moduleId={moduleId}` | `dashboard_weekly.dashboard_weekly` | `useWeeklyLearningWeek` | One selected week | **SAFE**; user selection or bounded adjacent prefetch |
| Dashboard, lazy Overview | `/learner_api/dashboard/{kind}/{id}/overview/` | `dashboard_tabs.dashboard_tab` | `useDashboardTabsData` | Overview metrics, hours, attendance | **SAFE** by source inspection |
| Dashboard, lazy Monthly | `/learner_api/dashboard/{kind}/{id}/monthly/plan/?month=...&subject=...` | `dashboard_tabs.dashboard_tab` | `useDashboardMonthly` | Monthly plan board | **SAFE** by source inspection |
| Dashboard, lazy Training | `/learner_api/dashboard/{kind}/{id}/training/` | `dashboard_tabs.dashboard_tab` | `dashboardTraining` | Training timeline/modules | **SAFE** by source inspection |
| Dashboard, lazy module detail | `/learner_api/dashboard/{kind}/{id}/training/modules/{moduleId}/` | `dashboard_training.training_module` | `readTrainingModule` | One training module | **SAFE** by source inspection |
| My Learning, initial | `/learner_api/my-learning/{kind}/{id}/` | `my_learning.my_learning` | `useMyLearningCatalogue` | Module catalogue and progress cards | **SAFE**; canonical stored reads |
| My Learning, debounced/lazy | `/learner_api/my-learning/{kind}/{id}/search/?q={q}&offset={offset}` | `my_learning.my_learning` | `useMyLearningSearch` | Matches and `nextOffset` | **SAFE**; pages are requested serially |
| My Learning, interaction | `/learner_api/my-learning/{kind}/{id}/upcoming/` | `my_learning.my_learning` | `readMyLearningUpcoming` | Expanded upcoming links | **SAFE**; only after View all |
| My Learning, selection | `/learner_api/my-learning/{kind}/{id}/modules/{subjectId}/` | `my_learning.my_learning` | `useMyLearningModule` | Selected module/activity detail | **SAFE** |
| Learner summary/progress, initial | `/learner_api/learner-detail/{kind}/{id}/?content=summary` | `learner_detail.learner_detail` | `fetchLearnerDetail` | Compact learner plan/progress graph | **SAFE**; explicit `read_only=True` |
| Progress, initial | `/learner_api/metrics/{kind}/{id}/` | `dashboard_metrics.learner_metrics` | `useLearnerMetrics` | Programme, KSB and OTJH metrics | **SAFE**; canonical reads |
| Progress, after summary availability | `/learner_api/student-activity/{kind}/{id}/` | `student_activity.student_activity` | `usePrefetchStudentActivity` | Consolidated activity and hours ledger | **SAFE**; source explicitly forbids old-LMS refresh during learner requests |
| Current Aptem plan | `/learner_api/training-plan/{kind}/{id}/` | `training_plan_view.training_plan` | `aptemTrainingPlan` / `RealLearnerPlanView` | Aptem month plan | **SAFE**; database SELECT only |
| Component selection | `/learner_api/learner-detail/{kind}/{id}/?content=activity&component_id={componentId}` | `learner_detail.learner_detail` | `fetchLearnerDetail({componentId})` | One owned component and content | **SAFE**; explicit compact/read-only path |
| Evidence, initial | `/learner_api/evidence/{kind}/{id}/` | `evidence.list_evidence` | `fetchEvidence` | Current evidence metadata | **SAFE**; list does not contact Azure |
| Evidence, initial parallel | `/learner_api/evidence/{kind}/{id}/historical/` | `historical_evidence.list_historical_evidence` | `fetchHistoricalEvidence` | Historical evidence summaries | **SAFE**; metadata reads only |
| Evidence, selection | `/learner_api/evidence/{kind}/{id}/historical/{source}/{sourceId}/` | `historical_evidence.historical_evidence_detail` | `fetchHistoricalEvidenceDetail` | Evidence detail/doc metadata | **SAFE**; lazy database read |
| Evidence document open | `/learner_api/evidence/{kind}/{id}/historical/{source}/{sourceId}/open/?part=...` | `historical_evidence.open_historical_document` | `openHistoricalDocument` | Short-lived document URLs | **UNSAFE for this benchmark**; storage/SAS path, excluded |
| Evidence download | `/learner_api/evidence/{kind}/{id}/{fileId}/download/` | `evidence.download_evidence` | `getEvidenceDownloadUrl` | Short-lived SAS URL | **UNSAFE for this benchmark**; Azure configuration/path, excluded |
| Progress reviews, initial parallel | `/learner_api/review-sessions/{kind}/{id}/?content=summary|full` | `review_sessions.learner_review_sessions` | `useReviewSessions` | Review events and booking-calendar rules | **SAFE** by source inspection; stored events only |
| Imported review history | `/learner_api/review-history/{kind}/{id}/?category={category}` | `review_history.learner_review_history` | `fetchReviewHistory` | Imported review summaries/details | **SAFE**; persisted review reads only |

Additional classification finding: `/overview-week/.../?section=home` is **UNSAFE** when the shared read model is enabled because a miss/stale hit can enqueue a refresh. The actual Learner Home request is `section=home-summary`, so that mutating/scheduling branch was not placed in the benchmark candidate set.

## F. Real HTTP Measurement Table

| Page | Endpoint | Samples | p50 | p95 | SQL Count | DB Time | Payload |
|---|---|---:|---:|---:|---:|---:|---:|
| All | All candidate endpoints | **0** | Not measured | Not measured | Not measured | Not measured | Not measured |

There is no hidden or discarded request set. Zero HTTP requests were made after the gate failed.

## G. Cold Versus Warm Results

No cold or warm result exists. Starting a server merely to collect partial timings would have violated the mandatory gate. Earlier Phase 4D/4E SQL timings were not reused or presented as HTTP latency.

## H. Request Waterfalls

These waterfalls are **source-inferred, not browser-measured**.

### Learner Home

`authenticated identity -> learner-summary -> [home-summary || upcoming]`

The two cards start in parallel only after the small identity/status response confirms that the page will not redirect. Feedback is feature-flagged and is outside this benchmark inventory.

### Dashboard (default route)

`minimal header -> weekly initial -> selected-week detail served from the primed client cache`

The header is a hard dependency because it validates identity/access and controls whether tabs mount. Weekly is the default tab. Overview, Monthly, Training and Rewards are lazy and begin only when opened. An adjacent week may be prefetched after a 750 ms delay, sequentially and only if no week request is active.

### My Learning

`catalogue -> render cards`

Search is debounced and paginated serially. Module detail begins after card selection. Expanded upcoming begins only after the user selects View all. Certificate-template metadata is a separate follow-up in `CompactModules`; it was discovered but not classified/measured here because the mandatory gate had already stopped execution.

### Progress

`[learner-detail?content=summary || metrics]` in parallel, while `learner-summary -> student-activity` is a source-gated chain. Shared caches can deduplicate the summary read. This is source behavior, not measured network deduplication.

### Learning Plan / Weekly Learning

The plan page requests the compact learner-detail summary. The dedicated Aptem plan route requests `/training-plan/.../`. Weekly Learning requests the weekly spine; its selected week is primed from that response, and another detail request is needed only after navigation/prefetch.

### Evidence

`[learner-detail summary || current evidence || historical evidence]` start independently. Historical item detail and all document-opening/storage operations are interaction-only.

### Progress Reviews

`[learner-detail summary || review-sessions]` start in parallel. Artifact/content downloads and all booking/signing writes are interaction-only and excluded.

## I. Slowest Endpoint Ranking

No ranking is provided because no endpoint was measured. A ranking derived from code size, older SQL profiling, or intuition would not satisfy this phase.

## J. SQL-Level Bottlenecks

No SQL bottleneck is claimed for Phase 4G.7. Query count, client wall time, PostgreSQL execution time and query plans were not collected through real HTTP requests. Source inspection shows several candidates for later measurement—canonical progress loading in metrics/student activity and plan aggregation in dashboard views—but these are hypotheses, not verified bottlenecks.

## K. Django-Level Bottlenecks

No Django bottleneck is claimed. Python processing, authentication time, serialization time, compression time and TTFB were not measured. The source contains request-stage instrumentation (`measure_projection`/projection stages), which can be reused once the isolation gate is satisfied.

## L. Frontend Request Dependencies

Verified from source/contracts:

- Home intentionally serializes identity before two parallel card reads.
- Dashboard intentionally serializes minimal header before the default Weekly request.
- Non-default Dashboard tabs are lazy; reopening a visited tab reuses its cached snapshot subject to invalidation.
- Weekly initial data primes the selected-week detail and avoids an immediate duplicate request.
- My Learning search pages are serial; upcoming and module detail are interaction-only.
- Progress prefetch waits for `studentActivityAvailable` from the small summary.
- Evidence uses three independent initial reads; storage URL generation is lazy.

No duplicate-call or unnecessary-refetch claim is made without browser network evidence.

## M. Security and Regression Tests

| Check | Result |
|---|---|
| Authoritative Neon branch metadata | PASS |
| Reader-only Django alias/runtime check | PASS |
| Independent process/container egress boundary | **FAIL / BLOCKER** |
| Backend isolation, branch guard, auth selector/progress gate, curriculum permissions | PASS — `100/100` |
| Frontend Home/Dashboard/My Learning/activity request contracts | PASS — 6 files, `67/67` |
| Real HTTP auth/status validation in this phase | NOT RUN — blocked before server startup |
| Teams baseline | NOT REQUIRED — no Teams file edited |
| Expanded Teams checks | NOT REQUIRED |

Commands:

```text
python manage.py test config.test_test_isolation_no_db config.tests_test_branch_guard login.test_selectors_no_db login.tests_learner_progress_gate learner_api.test_curriculum_lookup_permissions_no_db --verbosity=1
npm test -- --run src/pages/learner/home/initialRequests.test.tsx src/pages/workspace/learner/__tests__/dashboardRequestGraph.test.tsx src/api/__tests__/learnerOverview.test.ts src/api/__tests__/weeklyLearningContract.test.ts src/api/__tests__/myLearningCurriculumContract.test.ts src/api/__tests__/activityRequestGraph.test.ts --maxWorkers=2
python -B reports/verify_phase4g2_runtime.py
```

## N. Limitations and Unmeasured Endpoints

- The acceptance criteria requiring real authenticated HTTP, actual middleware timings, SQL metrics, response sizes, compression, and measured ranking are unmet.
- No browser was launched, so every page waterfall is source-inferred.
- The Reader cannot inspect the fixture receipt table, Engagement schema, or sequence state. Those restrictions are intentional least privilege. Their most recent direct verification is the Phase 4G.6B provisioning report.
- Because this phase made no HTTP request and opened only read-only database transactions, it could not mutate fixture rows, the progress sequence, Engagement, or the login session.
- Azure/storage document endpoints were excluded by classification even if an independent boundary later becomes available; they require a separately controlled integration policy.
- The synthetic dataset is not representative of Production even after a future benchmark succeeds.

## O. Recommended Next Optimisation

Do not optimise application code from this run. First provide an approved independent egress boundary, for example a usable container/VM with deny-by-default outbound policy and explicit allow-listing only for the verified Neon endpoint. Then repeat Phase 4G.7 using the existing Reader/session, sequential requests, bounded timeouts, and at least 20 warm samples plus separate limited cold samples.

Only after that measurement should an endpoint or query optimisation be selected.

## P. Fixture Preservation

No fixture creation, cleanup or deletion was executed. The synthetic identity/session handle and receipt handle remain stored for follow-up testing. The exact fixture relationships and 357 progress rows were present during the Reader preflight. Receipt/Engagement/sequence internals were not re-read with an elevated credential; their last verified state remains documented by Phase 4G.6B.

## Q. Changed Files and Safety Confirmation

Changed by this task:

- `backend/reports/learner_http_phase4g7_benchmark_report.md` (this report only)

Safety confirmation:

- Production was not accessed.
- The parent branch/database was not accessed or modified; its ID/LSN came only from target-branch metadata.
- No application data write occurred.
- No migration ran.
- No server or background worker started.
- No external integration was enabled or contacted.
- No fixture cleanup ran.
- No application or frontend production source changed.
- Existing contributor modifications were preserved.
- No commit or push was performed.

