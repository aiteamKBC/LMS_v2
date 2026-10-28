# Phase 4D: Learner Quiz Ownership SQL Optimisation

## 1. Verdict

**IMPROVED WITH LIMITATIONS**

The ownership lookup now avoids `record_revisions` when current authored data is sufficient, preserves exact historical ownership per module/quiz pair, and retains the original single-query strategy as a performance safety valve above 32 pending pairs. Real PostgreSQL measurements on the verified Neon test branch show a 79.82% median client-wall reduction for the representative mixed 30-pair case, no revision scan for current-only cases, and no material regression for the 75-pair history-heavy case because that case executes the original SQL.

The result is not classified as fully verified because no safe authenticated HTTP session was available. Endpoint HTTP latency, endpoint JSON serialization, and raw/gzip response sizes remain **NOT VERIFIED**.

## 2. Root Cause

`_append_week_quizzes` previously combined current component JSON, normalized `quiz_component_links`, and historical `record_revisions` in one three-branch `UNION`. Any pending ownership lookup therefore included the revisions branch, even when current authored data already proved that every relevant quiz/module pair belonged to the authored component tree.

On the test branch, the ownership population contained 7,236 current pairs and 4,563 historical pairs. Of the historical pairs, 4,242 were the same pairs already present in current ownership, while 321 were history-only. This means history cannot be removed, but it is redundant for many exact pairs.

## 3. Ownership Semantics

Ownership is a module/quiz-pair decision, not a quiz-only decision. The same quiz can validly be associated with multiple modules.

| Situation | Required result |
|---|---|
| Quiz already represented in the projected component tree | Preserve that component and skip ownership lookup for that exact pair. |
| Exact pair exists in current component JSON | Treat it as authored, suppress metadata/course-link fallback, and skip history for that exact pair. |
| Exact pair exists through `quiz_component_links` | Treat it as authored with the same suppression behavior. |
| Current pair exists in module A but a historical pair exists in module B | Resolve module B independently; module A must not suppress module B history. |
| Exact pair exists only in `record_revisions` | Treat it as historically authored and prevent stale fallback resurrection. |
| Deleted/cleared/relinked authored component | Revision ownership prevents the former quiz from reappearing through legacy metadata; the new current component remains authoritative. |
| No current or historical ownership | Preserve the existing explicit module/week, resolved week, and legacy programme/module-title fallback behavior. |
| Multiple matching revisions | De-duplicate through set membership. |
| More than 32 pending pairs | Use the original bounded three-branch query as a one-round-trip safety valve. |

Historical ownership is additive across distinct module/quiz pairs, but an identical historical pair adds no new set outcome after current ownership has resolved it. Passed/submitted and retired historical progress is retained separately by the existing retained-progress path; this optimisation does not remove or recalculate that history.

Final module, week, component, and quiz ordering remains controlled by the existing projection loops. Ownership sets are used only for membership and de-duplication, so response order is unchanged.

## 4. Implementation

- Replaced independent `pending_modules` and `pending_quizzes` collections with exact `(module_id, quiz_id)` pairs.
- For at most 32 pending pairs:
  1. Resolve current component JSON and normalized links together.
  2. Remove those exact pairs from the unresolved set.
  3. Probe `record_revisions` only for the remaining exact pairs using paired `unnest` values.
- For more than 32 pending pairs, execute the original three-branch query unchanged. Benchmarking showed that splitting a large history-heavy case adds a network round trip without reducing its broad historical scan.
- Kept result handling set-based and preserved the existing final placement and ordering code.
- Added a repeatable read-only benchmark script that refuses an unapproved endpoint and emits aggregate results only.
- Added regression coverage for safe history skipping, cross-module history, duplicate revisions, and the large-set safety valve.

There are no schema, migration, index, frontend production, response-shape, permission, completion-policy, or GET-write changes in Phase 4D.

## 5. SQL Comparison

**Before:** one `UNION` always queried current component JSON, normalized links, and revisions, bounded by independent module and quiz arrays.

**After for 32 or fewer pairs:** one current-ownership query runs first. If any exact pairs remain, a second query probes revisions using paired module/quiz values. Current-only requests perform no revision access.

**After for more than 32 pairs:** the original one-query `UNION` is retained. This is an intentional safety valve based on the measured history-heavy behavior.

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` showed:

- Current-only shapes: zero revision rows and zero revision buffers after the change.
- Mixed 30-pair shape: revision rows examined fell from 1,447,221 to 32,490; revision disk reads fell from 272,245 blocks to zero in the captured plans.
- History-heavy 75-pair shape: the same original query and same 1,447,221 revision rows are retained.

## 6. Performance

Measurements used the direct Neon endpoint, one read-only transaction, alternating before/after execution order, a 15-second statement timeout, one warm-up, and 20 measured warm samples per shape. Client-wall time includes remote network latency. Pair counts are controlled SQL shapes, not learner-history percentiles.

| Metric | Before | After | Difference |
|---|---:|---:|---:|
| Small current-only SQL count | 1 | 1 | No change |
| Small current-only client p50 | 84.128 ms | 85.889 ms | +2.09% |
| Small current-only revision rows | 1 | 0 | Eliminated |
| Median current-only client p50 | 96.117 ms | 89.911 ms | -6.46% |
| Median current-only revision rows | 6 | 0 | Eliminated |
| Mixed 30-pair SQL count | 1 | 2 | +1 bounded round trip |
| Mixed 30-pair client p50 | 1,231.115 ms | 248.406 ms | -79.82% |
| Mixed 30-pair plan execution | 1,103.156 ms | 62.193 ms | -1,040.963 ms |
| Mixed 30-pair revision rows | 1,447,221 | 32,490 | -97.75% |
| Mixed ownership Python p50 | 0.0483 ms | 0.0987 ms | +0.0504 ms |
| History-heavy 75-pair SQL count | 1 | 1 | No change |
| History-heavy client p50 | 959.252 ms | 944.875 ms | -1.50% (same SQL; run variability) |
| History-heavy revision rows | 1,447,221 | 1,447,221 | No change |
| Authenticated HTTP latency | NOT VERIFIED | NOT VERIFIED | No safe authenticated session |
| Endpoint JSON serialization | NOT VERIFIED | NOT VERIFIED | No request-level benchmark |
| Raw/gzip payload size | NOT VERIFIED | NOT VERIFIED | Contract parity tested, bytes not captured |

The complete aggregate evidence and plan counters are in `learner_quiz_ownership_phase4d_measurements_2026-10-27.json`.

## 7. Contract Parity

- All four measured PostgreSQL shapes returned identical exact ownership sets before and after.
- Focused response-object tests preserved module-to-quiz maps, stable order, de-duplication, empty behavior, deleted/relinked behavior, multiple-module ownership, and retained passed/retired quiz progress.
- Commercial and apprenticeship summary paths, read-only behavior, activity behavior, and object-level permissions passed existing focused tests.
- No serializer, mapper, endpoint status code, permission decorator, or frontend contract was changed by Phase 4D.

## 8. Tests

### Passed

- `learner_api.test_quiz_placement_no_db`, `learner_api.test_retained_quiz_progress_no_db`, and `learner_api.test_mobile_quiz_scope_no_db`: **40/40 passed**.
- `python -B learner_api/test_learner_detail_o05_no_db.py`: **14/14 passed**. Covers learner owner, staff/admin, employer/anonymous rejection, commercial/apprenticeship, read-only summary, activity, and response behavior.
- `LearnerQuizModuleMatchingTests`, `LearnerWeekQuizVisibilityTests`, and `learner_api.tests_learner_loading`: **16/16 passed**.
- Targeted frontend quiz/learner consumers: **5 files, 34/34 tests passed**:
  - `src/api/__tests__/quizzes.test.ts`
  - `src/utils/learnerJourney.quizStatus.test.ts`
  - `src/pages/learner/quiz-take/page.test.tsx`
  - `src/pages/learner/my-learning/retainedQuizProgress.test.ts`
  - `src/hooks/__tests__/learnerDetailFocusRefresh.test.tsx`
- Final source files parsed successfully with Python `ast.parse` without writing bytecode caches.
- PostgreSQL benchmark: **4/4 shapes achieved ownership parity**, 20 warm measurements each.

### Failed

None in the final focused runs. The initial pre-change baseline had two scripted-cursor fixture failures because that fixture did not recognize the already-existing ownership `UNION`; the fixture was corrected and the same behavioral assertions now pass.

### Not executed

- Full backend suite: outside the requested focused scope and its database lifecycle was not invoked against Neon.
- Full frontend suite/type-check/build: no frontend production code changed; only affected consumer tests were requested.
- Authenticated HTTP benchmark: no safe authenticated session was available.
- Teams baseline and expanded Teams checks: **NOT REQUIRED**; no Teams trigger file or imported Teams contract was changed.

## 9. Changed Files

- `backend/learner_api/learner_detail.py`
- `backend/learner_api/test_quiz_placement_no_db.py`
- `backend/learner_api/test_mobile_quiz_scope_no_db.py`
- `backend/reports/benchmark_quiz_ownership_phase4d.py`
- `backend/reports/learner_quiz_ownership_phase4d_measurements_2026-10-27.json`
- `backend/reports/learner_quiz_ownership_phase4d_report_2026-10-27.md`

Other modified/untracked repository files were present before Phase 4D and were preserved. No commit or push was made.

## 10. Remaining Risks

- The benchmark uses controlled ownership-pair shapes, not statistically derived small/median/p95/max learner records.
- HTTP latency, serialization, and compressed/uncompressed endpoint sizes remain unmeasured.
- Remote client-wall measurements show network variability; PostgreSQL plan execution and row/buffer counters are the stronger database evidence.
- The 32-pair threshold is deliberately conservative, based on the measured 30-pair win and 75-pair split-query regression. A larger corpus could establish a more precise crossover point.
- Historical ownership remains inherently important: 321 test-branch pairs exist only in revisions. Removing the revision path would still be incorrect.

## 11. Next Optimisation

The strongest next step is an authenticated, same-worker benchmark of real summary requests on the dedicated test branch, with synthetic/test-owned learner sessions. It should map learner history sizes to small/median/p95/max cohorts and capture total HTTP latency, serialization, raw/gzip bytes, and per-request SQL attribution. If database work remains dominant after this change, profile the next highest-cost Summary statement rather than changing the proven historical-ownership policy.

## Environment Verification

- Neon organisation: Kent Business College (`org-falling-sea-18071422`).
- Neon project: LMS (`green-term-97168878`).
- Verified branch metadata name: `lms_ideal_test` (`br-orange-shadow-abm8uwwe`). The attachment called it `lms-ideal-test`; authoritative metadata uses underscores.
- Parent branch: `lms-ideal-architecture` (`br-raspy-sky-abvs8lq9`).
- Endpoint: `ep-dawn-block-ab5vob3x`, non-production, read/write test endpoint.
- Source variable: `LMS_IDEAL_TEST` only; no fallback to `DATABASE_URL`.
- The supplied URL used the transaction pooler; benchmarks derived and used the matching direct endpoint for session-stable measurements.
- Database: `neondb`, PostgreSQL `18.6 (fd34222)`.
- Every benchmark transaction reported `transaction_read_only=on`.
- No fixture writes, schema changes, migrations, index changes, destructive statements, learner data changes, or external-service calls were performed. Nothing remains to clean up.
