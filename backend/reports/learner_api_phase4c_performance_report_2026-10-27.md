# Phase 4C — Learner API Request Baseline, SQL Profile, and Bottleneck Ranking

Date: 2026-10-27 (Africa/Cairo)  
Branch/workspace: current `fix/api-endpoints` checkout; no branch or worktree created  
Scope: Learner read paths only; measurement and diagnosis, not optimisation

## 1. Executive Verdict

**Verdict: PARTIALLY MEASURED; no Learner endpoint can yet be named the highest confirmed request-level bottleneck.** There was no safe authenticated local HTTP target or disposable PostgreSQL database, the protected Neon branch was not suitable for Django test-database creation, and the two performance-sample tables contained zero rows. Consequently, current HTTP duration, TTFB, cold/warm behaviour, endpoint SQL count, endpoint cumulative DB time, and production-like p50/p95/p99 remain **NOT VERIFIED**.

The strongest current diagnostic signal is narrower: the quiz ownership/history `UNION` used by `_append_week_quizzes` has a `pg_stat_statements` mean execution time of **1,897.317 ms** across five recorded calls. Learner Summary calls that helper, but the statistics cannot attribute the five calls exclusively to Summary. The current non-`ANALYZE` plan estimates the `record_revisions` JSON-history branch at 479.03 of the total 650.70 cost, about 74% of estimated plan cost. Evidence: `backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:57-126`; source: `backend/learner_api/learner_detail.py:783-812` and `backend/learner_api/learner_detail.py:2393-2395`.

This makes staged quiz-ownership resolution the best **next bounded optimisation candidate**, not a proven endpoint-level winner. Phase 4D should retain it only after authenticated before/after request measurements show a material improvement with exact response parity.

## 2. Environment and Database Safety Verification

| Check | Result |
|---|---|
| Database provider | Neon PostgreSQL |
| Project / branch | `LMS` / `lms-ideal-architecture` |
| Database | `neondb` |
| PostgreSQL | 18.6 |
| `transaction_read_only` | `on` |
| `pg_is_in_recovery()` | `false` |
| Disposable | No; treated as protected |
| Local Docker PostgreSQL | Not available |
| Local `psql` / PostgreSQL service | Not available |
| Authenticated local HTTP session | Not available |
| Neon writes, migrations, fixtures, `ANALYZE`, `VACUUM` | None |

The exact sanitized environment evidence is in `backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:5-31`. No connection strings, credentials, learner identifiers, names, emails, or response bodies were retained.

The default full Learner Detail GET was not executed. Source inspection shows that non-read-only detail construction can advance/hydrate lifecycle data and refresh KSB state (`backend/learner_api/learner_detail.py:2311-2317`, `backend/learner_api/learner_detail.py:2332-2348`). The Summary projection explicitly selects `read_only=True` (`backend/learner_api/learner_detail.py:2556-2565`). Similarly, `overview-week?section=home` may enqueue refresh work, while `section=home-summary` does not enter that branch (`backend/learner_api/overview_week.py:629-657`).

## 3. Benchmark Methodology

Evidence is deliberately separated into five classes:

1. **REAL HTTP MEASUREMENT:** not available in this phase.
2. **ISOLATED POSTGRESQL MEASUREMENT:** bounded aggregate `SELECT`s, `pg_stat_statements`, and `EXPLAIN` without `ANALYZE` on a verified read-only Neon transaction.
3. **SYNTHETIC PYTHON MEASUREMENT:** prior Phase 4B isolated timings only; not repeated as an endpoint benchmark here.
4. **HISTORICAL MEASUREMENT:** checked-in 2026-10-17 projection benchmarks; useful for prioritisation but not current HTTP evidence.
5. **NOT VERIFIED:** any metric for which the safe environment was absent.

Current progress-history distribution was remeasured using aggregation only:

| Population | Min | p50 | p95 | Max | Mean |
|---:|---:|---:|---:|---:|---:|
| 622 learners with progress | 1 | 357 | 1,115.95 | 3,617 | 446.5 |

Evidence: `backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:32-39`. This differs materially from the older 340 / 978 / 2,790 observation and confirms that the representative fixture must be refreshed.

The implementation-ready protocol for a disposable PostgreSQL environment is:

- Build sanitized learners closest to 1, 357, 1,116, and 3,617 ledger rows, then verify relationship complexity (programme, plan modules, weeks, components, KSBs, OTJH, historical lineage), not row count alone.
- Include commercial and apprenticeship records at median and high-volume tiers where safely available.
- Preserve authentication and object-level permission middleware.
- Run warm-up separately; then at least 20 warm samples per endpoint and at least three explicitly cold worker/cache starts. Report small-sample maxima, not production p95/p99, until sample sizes support percentiles.
- Capture browser wall/TTFB/bytes, `Server-Timing`, request query count, DB-client wall time, serialization stage, cache headers, and request ID.
- Pair each request with SQL fingerprints and bounded plans; use `EXPLAIN ANALYZE` only in the disposable database.
- Keep the learner and database snapshot fixed for before/after comparisons.

One attempted aggregate intended to locate a maximum-complexity module was cancelled after about 60 seconds and was not repeated. It produced no result and is not treated as latency evidence (`backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:128-134`).

## 4. Learner Request Inventory

The backend routes are registered at `backend/learner_api/urls.py:249-271`, with Learning Plan at `backend/learner_api/urls.py:110` and evidence reads at `backend/learner_api/urls.py:382-388`.

| Priority | Page / request | Frontend consumer | Execution status in Phase 4C | Important note |
|---:|---|---|---|---|
| 1 | `GET /learner_api/learner-detail/{kind}/{id}/?content=summary` | `frontend/src/api/learnerDetail.ts:12-16`, `:266-268` | NOT RUN | Source-read-only projection; invokes quiz ownership helper |
| 2 | Dashboard minimal header | `frontend/src/api/dashboardHeader.ts:17-31` | NOT RUN | Compact header, cached read |
| 2 | Dashboard weekly initial/detail | `frontend/src/api/weeklyLearning.ts:18-85` | NOT RUN | Initial response primes selected week detail (`:53-59`) |
| 2 | Dashboard overview | `frontend/src/hooks/useDashboardTabsData.ts:7-27` | NOT RUN | Loads only after Overview is opened |
| 2 | Dashboard monthly | `frontend/src/hooks/useDashboardMonthly.ts:7-33` | NOT RUN | Enabled only while the visited panel is active |
| 2 | Dashboard training timeline/module | `frontend/src/api/dashboardTraining.ts:25-75` | NOT RUN | Module detail is on demand |
| 3 | Home `overview-week?...section=home-summary` | `frontend/src/api/learnerOverview.ts:63-70` | NOT RUN | Read projection; distinct from potentially enqueueing `section=home` |
| 3 | Home `training-plan-dashboard?...section=upcoming` | `frontend/src/api/learnerOverview.ts:80-82` | NOT RUN | Bounded upcoming projection |
| 4 | My Learning catalogue/search/upcoming/module | `frontend/src/api/myLearning.ts:26-67` | NOT RUN | Catalogue is compact; detail is selected on demand; search paginates |
| 5 | Learning Plan current data | `frontend/src/api/learningPlan.ts:13-14`, `:90-160` | NOT RUN | Includes plan plus administration-oriented available options |
| 5 | Weekly learning/module/component projections | `frontend/src/api/weeklyLearning.ts:18-85` | NOT RUN | Shared with Dashboard weekly |
| 6 | Metrics | `frontend/src/api/learnerMetrics.ts:37-46` | NOT RUN | Uses canonical metrics bulk backend path |
| 6 | Student activity | `frontend/src/api/studentActivity.ts:171-184` | NOT RUN | Broad progress/source projection |
| 6 | Evidence list | `frontend/src/api/evidence.ts:132-148` | NOT RUN | List query has no measured HTTP baseline |

Backend entry points are `backend/learner_api/dashboard_header.py:424`, `dashboard_weekly.py:83`, `dashboard_tabs.py:134`, `dashboard_metrics.py:496`, `overview_week.py:621`, `training_plan_dashboard.py:761`, `my_learning.py:732`, `learning_plan.py:644`, `student_activity.py:223`, and `evidence.py:395`.

## 5. Frontend Request Waterfalls

These diagrams describe source-observed sequencing, not measured network timing.

### Dashboard

```text
route/auth resolution
        |
        v
minimal dashboard header
        |
        +--> default Weekly tab --> weekly plan initial
        |                           +--> selected week already primed
        |                           +--> adjacent week prefetch later
        |
        +--> [only when opened] Overview --> compact overview
        +--> [only when opened] Monthly  --> selected month projection
        +--> [only when opened] Training --> timeline --> selected module detail
```

The page keeps only visited panels mounted (`frontend/src/pages/workspace/learner/DashboardTabs.tsx:38-68`), and the parent tracks opened/active tabs (`frontend/src/pages/workspace/learner/page.tsx:93-101`). The weekly client primes the selected detail from the initial response (`frontend/src/api/weeklyLearning.ts:53-85`), preventing an initial duplicate detail GET. Training detail waits for the active selected module (`frontend/src/pages/workspace/learner/tabs/DashboardTrainingTab.tsx:49-66`). No hidden-tab eager fan-out was found.

### Learner Home

```text
route/auth resolution
        |
        v
Learner Summary (identity + authorization gate)
        |
        +--------------------------+
        v                          v
home-summary                 upcoming schedule
        |                          |
        +----------- render useful cards -----------+
```

Home waits for the learner profile and access decision before enabling cards (`frontend/src/pages/learner/home/page.tsx:89-106`). This is an intentional security/eligibility dependency and must not be bypassed.

### My Learning

```text
route/auth resolution
        |
        +--> Modules tab --> compact catalogue
        |                     +--> certificate template (catalogue only)
        |                     +--> debounced search --> serial result pages
        |                     +--> selected card --> module detail
        |                     +--> View all --> upcoming list
        |
        +--> Quizzes/Assignments tabs --> Learner Summary consumers
```

The catalogue is enabled only for the Modules/courses view (`frontend/src/pages/learner/my-learning/page.tsx:77-93`). Module detail and search are conditional (`frontend/src/pages/learner/my-learning/CompactModules.tsx:38-45`), the certificate request is suppressed for selected detail (`:72-78`), and upcoming expansion is user-driven. Search follows `nextOffset` serially (`frontend/src/api/myLearning.ts:56-67`), so a large result set can extend the waterfall even though it avoids parallel duplicate pages.

### Learning Plan / Weekly Plan

```text
authorized learner context
        |
        +--> current learning-plan GET
        |       +--> plan modules + free courses + programme options
        |
        +--> weekly plan GET
                +--> selected week detail from primed response
                +--> later selected/adjacent detail requests
```

The plan contract is broad and includes picker data (`frontend/src/api/learningPlan.ts:90-160`). Weekly navigation and detail are independently cacheable (`frontend/src/api/weeklyLearning.ts:18-85`).

### Progress / Evidence

```text
authorized learner context
        +--> metrics
        +--> student activity
        +--> evidence list
```

These calls are independent at the API layer. The inspected clients do not require serializing metrics, activity, and evidence behind one another (`frontend/src/api/learnerMetrics.ts:37-46`, `frontend/src/api/studentActivity.ts:171-184`, `frontend/src/api/evidence.ts:132-148`). Page-specific hooks still determine which are actually requested.

## 6. Measured Performance Baseline

### Current measurements (2026-10-27)

| Measurement | Result | Classification |
|---|---:|---|
| Learners with progress | 622 | ISOLATED POSTGRESQL |
| Progress entries p50 / p95 / max | 357 / 1,115.95 / 3,617 | ISOLATED POSTGRESQL |
| Progress relation estimated rows / total bytes | 262,523 / 568,606,720 | ISOLATED POSTGRESQL |
| Quiz ownership/history statement mean | 1,897.317 ms, 5 calls | `pg_stat_statements`; not endpoint latency |
| Activity-source mapping statement mean | 1,102.274 ms, 21 calls | `pg_stat_statements`; not endpoint latency |
| Full progress select mean | 675.253 ms, 15 calls | `pg_stat_statements`; not endpoint latency |
| Canonical metrics bulk statement mean | 321.262 ms, 24 calls | `pg_stat_statements`; not endpoint latency |
| Telemetry rows | 0 in both discovered tables | ISOLATED POSTGRESQL |
| HTTP p50/p95/p99, TTFB, cold/warm, raw/gzip | NOT VERIFIED | No safe authenticated HTTP target |

Evidence: `backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:32-101`.

### Historical projection evidence (not current HTTP)

| Projection | Samples / result | Duration | DB client wall | Queries | Raw / gzip |
|---|---|---:|---:|---:|---:|
| Dashboard minimal header, optimized | 6 samples; median | 1,901.24 ms | varies per sample | 21 | 3,941/1,232 or 4,671/1,542 B |
| Older learner header before/after | 6 + 6; median | 5,399.32 → 3,253.77 ms | 5,032.09 → 3,157.07 ms | 23 → 21 | about 4–4.7 KB raw |
| Weekly initial, one historical representative | 3 samples | 6,049.63 / 6,227.42 / 9,208.87 ms | 5,707.75 / 5,804.89 / 8,824.67 ms | 16 | 49,143 / 4,723 B |
| Weekly representative, four learner shapes | navigation/detail records | 1,076.72–5,024.95 ms | 1,034.82–3,946.89 ms | 12–14 | 8,480–207,363 raw; 1,599–15,332 gzip B |

Header evidence: `backend/reports/header_consolidated_performance_2026-10-17.json:183-200`, `:334-351`, `:787-804`, `:1089-1106`, `:1240-1257`, `:1693-1710`; older summary: `backend/reports/student_header_performance_2026-10-17.json:1910-1919`; weekly: `backend/reports/weekly_consolidated_performance_2026-10-17.json:165-178`, `:285-298`, `:405-418`; representative range: `backend/reports/weekly_representative_2026-10-17.json:16-29`, `:432-445`, `:614-648`.

The prior Phase 4B 12.7%–23.9% synthetic Python improvement remains an isolated claim, not evidence of current request latency. The focused reuse regression suite was rerun and passed 3/3; it proves fallback lookups are avoided when resolved OTJH values are present, not the end-to-end performance gain (`backend/learner_api/test_learner_summary_performance_no_db.py:10-76`; run evidence at `backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:147-153`).

## 7. SQL Profiling Findings

### 7.1 Strongest current SQL signal: quiz ownership/history

Learner Summary always reaches `_append_week_quizzes` after component preparation (`backend/learner_api/learner_detail.py:2385-2395`). For pending quizzes, the helper executes one three-branch `UNION` across:

- current `components.settings_json->>'linkedQuizId'`;
- `quiz_component_links` joined to current components;
- historical `record_revisions.snapshot->settings_json->>'linkedQuizId'`.

Source: `backend/learner_api/learner_detail.py:783-812`.

Current `pg_stat_statements` shows 5 calls, 1,897.317 ms mean, 9,486.586 ms total, and 1,519 returned rows. This is aggregate statement evidence, not a Summary percentile. The bounded current `EXPLAIN` (without `ANALYZE`) shows:

| Branch | Access | Estimated cost |
|---|---|---:|
| Current component JSON | module index, then JSON filter | 154.58 |
| Link table | quiz/component index-only scan + component PK | 17.04 |
| Revision JSON history | module index, then snapshot JSON filter | 479.03 |
| Whole `Unique -> Sort -> Append` | three branches | 650.70 |

Evidence: `backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:63-76`, `:103-126`. The revision branch dominates estimated cost because the module index narrows modules but the JSON quiz reference remains a post-index filter. Actual rows, buffers, and execution time per branch are **NOT VERIFIED** because `EXPLAIN ANALYZE` was intentionally not used on protected Neon.

### 7.2 Canonical ledger/source work is real but not yet endpoint-ranked

`canonical_learning.entries_for` reads progress, segments, activity sources, journals, and optional KSB rows through CTEs (`backend/learner_api/canonical_learning.py:131-271`). The compact catalogue projection omits KSB aggregation and narrows source payloads (`:149-205`), while metrics uses a separate bulk path (`:1405-1499`). Current statistics still show activity-source mapping at 1,102.274 ms mean, full progress selection at 675.253 ms, and metrics bulk at 321.262 ms (`backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:76-100`).

The canonical catalogue query is on an actual My Learning critical path: the checked-in request trace maps the initial catalogue to `entries_for(catalogue_summary=True)` (`backend/reports/my_learning_36s_bottleneck_investigation.md:13-24`). However, neither the current statistics nor historical reports correlate its statement time to a current authenticated request. It therefore cannot displace the quiz query as the best bounded SQL candidate, and it cannot establish My Learning as the highest current endpoint.

### 7.3 Historical plan evidence

A prior paired weekly ledger plan improved from 26.202 ms to 7.218 ms and from 930 shared hits to 92 hits plus one read (`backend/reports/week_switch_ledger_explain_paired_2026-10-17.json:1-54`, `:67-120`). That improvement is useful proof that scoped source-segment access matters, but it is one historical learner/query and cannot be extrapolated to current request latency.

### 7.4 Round trips, Python, serialization, and network

- The historical header and weekly projections were overwhelmingly DB-client-wall dominated, but they were not HTTP requests and include remote database/network wait in client timings.
- Current middleware can separate wrapped Django execute time from application wall time, but not PostgreSQL server execution, connection acquisition, every fetch/decode wait, or direct driver calls (`backend/config/performance.py:22-49`; `backend/reports/my_learning_36s_bottleneck_investigation.md:69-79`).
- Current Python processing and JSON serialization for real requests are **NOT VERIFIED**.
- Current WAN/network transfer and browser TTFB are **NOT VERIFIED**.

## 8. Payload Analysis

| Endpoint | Expensive data | Frontend usage | Proposed later reduction | Compatibility risk |
|---|---|---|---|---|
| Learner Summary | Modules, weeks, components, progress, quiz placement in one contract | Profile, Progress, Learning Plan, quiz/assignment consumers use different subsets | Add explicit versioned `identity`, `progress`, `quiz`, and `assignment` projections; keep current Summary | High: many consumers and historical fallbacks |
| Dashboard weekly initial | Navigation plus selected-week detail; historical native case reached 207,363 raw bytes | Sidebar/navigation and selected content; selected detail is already primed | Versioned compact navigation plus one selected detail; preserve priming | Medium/high: dates, holidays, progress and live sessions |
| Dashboard minimal header | Small 3.9–4.7 KB historical payload | Header identity, module label, next action | Keep contract; optimise SQL/round trips before bytes | Low payload benefit |
| My Learning catalogue | Compact cards, summary, OTJH, limited upcoming | All catalogue fields are deliberately consumed; KSB/history bodies already removed from SQL | Measure first; avoid further contract reduction until actual field tracing | Medium |
| My Learning search | Serial pages of matching IDs | Used only while searching the catalogue | Add a bounded result cap/continuation UI in a versioned contract if real searches show long chains | Medium: search completeness |
| Learning Plan | Current plan plus group defaults, all available modules/programmes and totals | Staff editing needs broad options; learner views may not need all picker data | Split learner read projection from staff editor projection | High: staff workflow compatibility |
| Evidence list | Potentially growing full list | Evidence page consumes list metadata | Add cursor pagination/versioned endpoint if row/payload measurements justify it | Medium: ordering and historical links |

Relevant contracts: Summary types in `frontend/src/api/learnerDetail.ts:185-266`; My Learning compact card contract in `frontend/src/api/myLearning.ts:10-20`; Learning Plan response in `frontend/src/api/learningPlan.ts:90-160`. The historical weekly payload spread is recorded at `backend/reports/weekly_representative_2026-10-17.json:432-648`.

No field was removed and no response shape changed in Phase 4C.

## 9. Bottleneck Ranking

Because no current authenticated request samples exist, ranks are evidence priorities rather than fabricated numerical scores.

| Rank | Endpoint | p50 | p95 | SQL Count | DB Time | Payload | Bottleneck | Confidence |
|---:|---|---|---|---|---|---|---|---|
| 1 | Learner Summary | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Quiz ownership/history statement has 1.897 s aggregate mean and is on this code path | Medium for SQL candidate; low for endpoint rank |
| 2 | Dashboard weekly initial | NOT VERIFIED | NOT VERIFIED | Historical: 16 | Historical: 5.71–8.82 s | Historical: 49,143 / 4,723 B | Remote DB wall and broad schedule/progress projection | Medium historical; low current |
| 3 | My Learning catalogue | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Historical browser observations only | Canonical ledger/source, attendance, metadata, historical aggregation | Low; supplied 20.46 s/36.25 s observations were uncontrolled |
| 4 | Dashboard minimal header | NOT VERIFIED | NOT VERIFIED | Historical: 21 | Historical sample-dependent | Historical: 3,941–4,671 raw B | Many remote round trips, not payload | Medium historical; low current |
| 5 | Metrics / Student Activity | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Current stats show bulk progress/source costs, but request attribution is absent | Low |
| 6 | Home / Monthly / Training / Learning Plan / Evidence | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Insufficient current timing evidence | Low |

The earlier My Learning reports explicitly state that the 36.25-second and 20.46-second browser observations were supplied and uncontrolled, and that no new HTTP measurement proved the responsible stage (`backend/reports/my_learning_36s_bottleneck_investigation.md:3-7`; `backend/reports/my_learning_catalogue_backend_performance.md:3-17`).

## 10. Frontend Test Failure Classification

Focused rerun:

```text
npm --prefix frontend test -- --run \
  src/api/__tests__/learnerContentLoading.test.ts \
  src/pages/learner/monthly-submission/page.test.tsx \
  src/pages/learner/__tests__/pages.test.tsx --maxWorkers=2
```

Result: **133 passed, 26 failed, 3 files failed, 63.52 seconds** (`backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:135-145`).

| Failure group | Count | Classification | Evidence |
|---|---:|---|---|
| `learnerContentLoading.test.ts` | 5 | Test fixture defect | Test mocks omit the required learner `id` and/or matching component and expect `content=reading` (`frontend/src/api/__tests__/learnerContentLoading.test.ts:12-26`, `:47-58`); implementation validates `content=activity`, learner ID, and component identity (`frontend/src/api/learnerDetail.ts:19-22`). Backend was not invoked. |
| Monthly undated-work chooser | 1 | Date-sensitive test defect | Test mounts without pinning time and expects September (`frontend/src/pages/learner/monthly-submission/page.test.tsx:260-264`); the run date is October 2026. Other tests in the same file explicitly pin time (`:130`, `:250`). |
| Home pair in `pages.test.tsx` | 2 | Environment limitation | jsdom lacks `HTMLCanvasElement.getContext` required by Lottie; this is not an HTTP/backend result. |
| Learning Plan / Progress Review empty-data pairs | At least 4 | Fixture defect | Shared mock payloads are incomplete for current consumers and crash reading `programme`; the generic fixture is assembled at `frontend/src/pages/learner/__tests__/pages.test.tsx:41-50`, with broad URL mocks at `:81-132`. |
| Remaining `pages.test.tsx` failures | 14 | Unresolved / potential UI-contract regression | Failures cover support, programme header, URL/back behaviour, attendance, canonical metrics, and programme-start flows. They were not isolated enough to prove either an application regression or an unrelated fixture defect. |

`window.scrollTo` warnings are also an environment limitation, but the captured output does not prove they independently account for a failed assertion. No frontend tests were edited.

## 11. Telemetry Assessment

Both discovered `platform_performance_samples` tables contain zero rows (`backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:40-55`). Source inspection explains why empty telemetry is plausible:

- Performance timing is disabled unless `PERFORMANCE_DIAGNOSTICS=true` (`backend/config/performance.py:12-20`; default false at `backend/config/settings.py:463-470`).
- Production diagnostic headers require an authenticated account whose ID is explicitly allowlisted (`backend/config/performance.py:42-53`; `backend/system_audit/performance.py:42-46`).
- The browser collector only becomes active after receiving the server-owned diagnostic header and does not post otherwise (`frontend/src/lib/performanceDiagnostics.ts:114-122`, `:185-215`).
- Stored request paths are route patterns, not concrete learner IDs, and inputs are bounded/sanitized (`backend/system_audit/performance.py:67-107`).
- Recording is a gated POST that writes `PerformanceSample`; it was not invoked in this phase (`backend/system_audit/performance.py:128-186`).
- Request IDs are generated server-side and returned in `X-Request-ID` (`backend/config/observability.py:88-117`).

The actual deployed environment variables and allowlist are **NOT VERIFIED**. Therefore, “feature disabled or no allowlisted diagnostic traffic” is a source-supported explanation, not a confirmed production setting.

No new profiler was added. Existing instrumentation already meets the local/opt-in/privacy requirements; the missing prerequisite is a safe authenticated benchmark account and disposable/local database, not another production code path.

## 12. Recommended Target Architecture

1. **Projection-specific reads:** keep compact Home, lazy Dashboard tabs, My Learning catalogue, and selected module/week detail as separate read contracts. Add versioned projections rather than shrinking shared legacy JSON in place.
2. **Request-scoped canonical context:** resolve learner identity, programme/plan scope, and canonical progress once per request and pass immutable projections to downstream builders.
3. **Staged historical fallback:** query current normalized relationships first and consult JSON history only for unresolved identities.
4. **Explicit read models for expensive aggregates:** refresh through lifecycle/write commands or asynchronous workers; GETs read canonical state and never heal/persist implicitly.
5. **Bounded pagination:** evidence, activity search, and other growing collections should expose cursor/versioned contracts after payload measurements prove need.
6. **Observable by default in benchmark environments, disabled by default elsewhere:** retain request IDs, allowlisted timing headers, sanitized route patterns, and local/disposable sample storage.

This preserves Dashboard lazy tabs (`frontend/src/pages/workspace/learner/DashboardTabs.tsx:38-68`), Home authorization gating (`frontend/src/pages/learner/home/page.tsx:89-106`), My Learning on-demand detail (`frontend/src/pages/learner/my-learning/CompactModules.tsx:38-45`), and the existing server-side permission model.

## 13. Prioritised Implementation Tasks

| Priority | Task | Evidence / acceptance gate |
|---:|---|---|
| 0 | Establish disposable PostgreSQL plus authenticated local HTTP benchmark | Mandatory before claiming endpoint p50/p95, TTFB, or Phase 4B request gain |
| 1 | Stage `_append_week_quizzes` ownership resolution: current components and normalized links first; query revisions only for unresolved `(module, quiz)` pairs | Preserve all historical/deleted/relinked behaviour; prove response parity and fewer revision reads |
| 2 | Correlate canonical `activity_sources` and progress statements to My Learning, Metrics, and Student Activity via request IDs/stage traces | Current means are high, but endpoint ownership is not established |
| 3 | Benchmark weekly initial projection by small/p50/p95/max relationship shapes | Historical 6.0–9.2 s samples justify attention, not a current fix |
| 4 | If weekly bytes remain large, design a versioned compact navigation projection | Must preserve selected-week priming, schedule, holidays, progress, and live sessions |
| 5 | Repair/modernise the three frontend test fixtures in a separate authorised task | Do not mix test maintenance with backend optimisation |

## 14. Unverified Measurements

The following remain **NOT VERIFIED**:

- HTTP status/duration, TTFB, raw/gzip response bytes, cold/warm behaviour, p50/p95/p99 for every listed endpoint.
- Per-request SQL count, cumulative DB-client wall, PostgreSQL server execution, connection acquisition, Python processing, serialization, and cache hit/miss.
- Which endpoint owns each `pg_stat_statements` call in the current statistics window.
- The statistics reset timestamp and whether all samples represent the current revision.
- Actual plan rows, buffers, cardinality error, and branch timing for the quiz ownership query.
- Current browser duplicate/refetch behaviour under authenticated navigation.
- Deployment state of performance diagnostic flags and account allowlist.
- Real Phase 4B improvement at HTTP/request level.
- Whether the 14 unresolved learner page tests are frontend regressions, stale fixtures, or mixed failures.

## 15. Safety Confirmation

- No application business logic, frontend UI, API response contract, permission rule, schema, migration, or production configuration was changed.
- No Neon writes, telemetry POSTs, fixture loads, Django test database creation, `EXPLAIN ANALYZE`, `ANALYZE`, `VACUUM`, external integration calls, or heavy concurrent load occurred.
- Only bounded read-only database inspection was performed; one slow aggregate was cancelled and not repeated.
- No learner PII, credentials, tokens, or connection strings were stored in either deliverable.
- `AGENTS.md` was not modified by this task. Existing working-tree changes were preserved.
- No branch/worktree was created or switched, and no commit or push was made.
- Teams baseline: **NOT REQUIRED** — no Teams-trigger file was edited.
- Expanded Teams checks: **NOT REQUIRED** — no Teams logic or consumed contract was changed.
- Live Teams: **NOT RUN**.
- Feature check: `learner_api.test_learner_summary_performance_no_db` **PASS 3/3** with no database connection.
- Frontend focused recheck: **FAIL 26 / PASS 133**; classified in section 10, not modified or suppressed.

## 16. First Recommended Performance Fix

### Decision

1. **Which Learner request is the highest confirmed performance bottleneck?**  
   No endpoint is confirmed at request level. The best current SQL candidate on a Priority-1 request path is the quiz ownership/history query reached by Learner Summary.

2. **What evidence proves it?**  
   The query is called by Summary (`backend/learner_api/learner_detail.py:2393-2395`), its exact SQL is at `:793-810`, and current aggregate statistics show 1,897.317 ms mean across five calls (`backend/reports/learner_api_phase4c_readonly_measurements_2026-10-27.json:63-76`). The non-`ANALYZE` plan assigns 479.03 of 650.70 estimated cost to the revision-history JSON branch (`:103-126`). This proves an expensive SQL candidate, not exclusive endpoint causation.

3. **What exact optimisation should be implemented next?**  
   Replace the three-way all-at-once `UNION` with staged resolution:
   - resolve pending `(module, quiz)` pairs from current components;
   - resolve the remainder through `quiz_component_links`;
   - query `record_revisions` only for still-unresolved pairs, scoped by module and quiz references;
   - union results in Python sets with exactly the existing per-module ownership semantics.

4. **Which files would change?**  
   Primary: `backend/learner_api/learner_detail.py`. Tests: the existing quiz-placement/no-database suite if present, plus focused PostgreSQL regression coverage under `backend/learner_api/`; no frontend production file and no API contract file should change.

5. **What performance improvement is realistically expected?**  
   A defensible endpoint percentage is not available. For requests whose pending quizzes are fully resolved by current normalized data, the change should eliminate the revision branch and most of the observed 1.897-second statement cost. A realistic engineering hypothesis is a reduction of several hundred milliseconds up to roughly 1.5 seconds for affected cold/remote requests; this is an estimate, not a promise. Retain the change only if the same-data authenticated benchmark shows at least a material median improvement (proposed gate: 20%) without p95 regression.

6. **How should it be measured?**  
   In the disposable environment, use identical small/p50/p95/max fixtures, one separated warm-up, at least 20 warm requests and at least three cold starts per shape. Record HTTP wall/TTFB/raw/gzip, `Server-Timing`, SQL count and cumulative client DB wall, stage/serialization timing, query fingerprints, and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for each staged branch. Compare paired before/after medians and variability; do not label small-sample maxima as production p95.

7. **Which regression tests are required?**
   - Learner owns and reads their own Summary; cross-learner, employer, anonymous, and unauthorized roles remain denied; allowed staff/admin workflows remain allowed.
   - Current `settings_json` quiz link, normalized `quiz_component_links`, and revision-only historical fallback.
   - Deleted/relinked quiz components do not reappear, while passed historical quizzes remain where the current contract requires them.
   - Same quiz independently assigned to multiple modules retains per-module ownership.
   - Legacy programme/title/week fallbacks, empty/no-quiz plans, commercial and apprenticeship learners.
   - Byte-for-byte semantic response parity for fields, types, ordering, null/empty states, and status codes.
   - Query assertion that revisions are not read when current sources resolve every pending pair, plus a bounded revision query when fallback is necessary.
   - Authenticated HTTP paired benchmark and affected frontend Summary/quiz/assignment consumer tests.

