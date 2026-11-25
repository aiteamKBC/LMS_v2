# Architecture V1 — execution plan and tracker

2026-11-18. Current checkout: Architecture, HEAD 606aca43df97967e8cb1fab45c5a794cc0635246.
Planning only in this task; preserve the existing uncommitted pilot, KSB fix and
frontend fixture correction. No database access, code restructuring or tests run.
Use existing audits and RELEASE_READINESS.md; do not restart discovery.

## Delivery contract

Target: 10–15 working days with one backend implementer and one frontend implementer,
plus timely review/QA. Parallel opportunities below are staffing proposals, not
agent delegation or branch-switch authorization. With one implementer, sequence
the lanes and reforecast rather than promise both lanes in the same time window.
Day 10 is the earliest acceptance checkpoint; days 11–15 absorb failures and review.
No batch is complete just because its files moved.

V1 means working, tested boundaries for membership reads, curriculum catalogue
reads, module-authoring frontend state/API composition, and the three known UI
cycles. Existing app/model labels, schema, routes, payloads, identifiers, writer
transactions and provider behavior remain intact. New domain code has no Django,
SQL, HTTP or provider imports. Extracted modules must not import legacy views back.
Temporary exports point old -> new and have an explicit removal condition.

V1 does NOT mean elimination of every legacy view, migration of every LMS context,
writer convergence, global TypeScript strict mode, new database ownership, or
production performance improvement without measurement. Coach scheduling, Teams,
assessment writes, audit authority, jobs and mobile remain in scope for compatibility
and the residual backlog, not silently claimed modernized.

## Prioritized batches

| Batch / days | Exact major sources | Coherent deliverable | Validation / dependencies |
| --- | --- | --- | --- |
| B1 Frontend dependency cycles / 1–2 | `frontend/src/pages/users/wizard/{FieldError.tsx,stepErrors.ts,stepErrors.helpers.ts}`; `frontend/src/features/monthly-logs/page.tsx`; `frontend/src/features/coach/monthly-logs/components/CoachLearnerLogs.tsx`; `frontend/src/pages/learner/video-watch/{AssignmentSubmissionWizard.tsx,TopicAssignment.tsx}` | Move shared monthly-log rendering and assignment-form leaves below route/wizard composition; import wizard helpers directly. Preserve query keys, role/view-as state, requests, submit handlers and exports. Remove all three recorded value-import cycles. | Exact selected UI tests below, type-check, build, static resolved-import check. No backend or provider changes. |
| B2 Membership read boundary / days 1-4 backend lane | `backend/curriculum_api/{learner_status_counts.py,learner_assignments.py}`; `backend/learner_api/learning_plans/` | COMPLETE: application orchestration and concrete fact reader extracted; existing wrappers and writers preserved. | 64 tests PASS; see Batch 02 execution record. |
| B3 Curriculum catalogue read boundary / 4–7 backend lane | `backend/curriculum_api/views.py`: `authoring_module_content_counts`, `authoring_catalogue_summaries`, `resolve_stored_module_catalogue_id`; `backend/curriculum_api/{home_summary.py,programme_list.py,learning_storage.py}` | Extract the catalogue read family into `catalogue/application/` and `catalogue/infrastructure/` only where needed; move required leaf dependencies with it. Keep HTTP exports, KSB projection, source/canonical aliases, scoring/ties, filters and caches unchanged. No schema helpers moved into ordinary read startup. | KSB standalone regression suite; isolated normalized-schema and alias/ranking tests; Home Summary/Programme List payload contract cases (currently only import coverage). Depends on explicit KSB prerequisite scope and bounded dependency closure. |
| B4 Module authoring feature / 3–7 frontend lane | `frontend/src/pages/curriculum/module-builder/{page.tsx,moduleAuthoringData.ts}`; `frontend/src/lib/curriculumApi.ts` | Extract existing draft transforms/selectors and cohesive editor panels into `features/curriculum/module-authoring`; split authoring-specific API contracts/client from the broad API module with compatibility exports. Keep transport/cache identity, autosave timing and mutation payloads unchanged. Route page delegates real behavior, not just re-exports a relocated monolith. | Existing structure loading/delta/save-size, conflicts, autosave, live-sync and rendering tests after setup inspection; type-check/build. Exclude scheduling/Teams code and tests; stop if extraction needs those changes. |
| B5 Curriculum consumers / 8–10 | `frontend/src/pages/curriculum/programme-detail/page.tsx`; `frontend/src/pages/curriculum/shared/entities/learnerAssignmentDrawer.tsx`; `frontend/src/lib/curriculumApi.ts`; B2/B3 adapters | Reuse established read/API contracts in programme detail and roster UI; split cohesive roster/filter presentation and programme panels. Remove duplicated transforms only when contracts are equivalent. Keep assignment actions unchanged. | Drawer tests, programme rendering/filter/error tests and existing backend integration parity; identical API requests and identity meanings. Depends on B2–B4 contracts stabilizing. |
| B6 Stabilization / 10–15 | Extracted packages, existing targeted tests, test-only dependency checks; CI proposal from RELEASE_READINESS.md | Resolve regressions, verify imports/URL exports and packaging, remove obsolete duplicate implementations only after all callers migrate, record actual metrics, prepare candidate review. | Targeted suites, type-check/build, isolated ORM/HTTP tests; approvals for CI workflow changes remain separate. No deployment or broad test discovery. |

Do not make large files smaller by moving their full contents to another large file.
Record responsibility moved, callers migrated, dependency edges removed, remaining
compatibility exports and actual tests for each batch. Historical file sizes are
navigation aids: views.py ~37k, Coach views ~17k, module builder ~10k, programme
detail ~7k and curriculumApi ~5.8k lines in the existing audit, not fresh metrics.

## Batch 01 - PASS (2026-11-19)

Completed all three structural extractions. No backend source, database, provider,
environment or Git branch changes; unrelated working-tree edits preserved.

| Original cycle | Resolution |
| --- | --- |
| FieldError.tsx -> stepErrors.ts -> FieldError.tsx | FieldError imports/re-exports types from existing stepErrors.helpers.ts. Barrel remains compatible. |
| monthly-logs/page.tsx -> CoachLearnerLogs.tsx -> monthly-logs/page.tsx | MonthlyLog.tsx owns shared views/helpers. Coach imports it directly; route page preserves public exports. |
| AssignmentSubmissionWizard.tsx -> TopicAssignment.tsx -> AssignmentSubmissionWizard.tsx | AssignmentSubmissionForm.tsx owns form/types/helpers. Both consumers import the leaf; wizard preserves its public exports. |

Created (relative to frontend/):
- src/features/monthly-logs/MonthlyLog.tsx
- src/pages/learner/video-watch/AssignmentSubmissionForm.tsx
- scripts/check-batch01-cycles.cjs

Changed: the five source files named in the cycle table, plus mock import paths
only in src/features/coach/monthly-logs/components/requests.test.tsx and
src/pages/learner/video-watch/TopicAssignment.test.tsx. Assertions unchanged.
stepErrors.ts and stepErrors.helpers.ts were not modified.

TypeScript AST comparison confirmed all 7 monthly-log and 6 assignment non-import
declarations preserved verbatim across the split: state/effects, query keys,
requests, callbacks, role/view-as, validation and navigation bodies unchanged.

Static baseline: 1,843 production files, 3 cyclic components (the three pairs).
After: 1,845 files, 0 cyclic components and 0 unresolved local source specifiers.
No additional reachable static cycles. Reproduce using
`node frontend/scripts/check-batch01-cycles.cjs` (PASS). The installed TypeScript
resolver checks static value imports/exports; type-only edges, tests/mocks,
declarations, dynamic imports and auto-import plugin edges are outside this count.

Actual validation:
- Before: type-check PASS; build PASS. Default forks test run: 44 tests passed
  across five files, but two other files failed worker startup with
  `Timeout waiting for worker to respond`. This is an incomplete baseline, not PASS.
- After: 7 files, **180 tests PASS**, 0 failures, using the exact list below and
  `--maxWorkers=1 --pool=threads` (93.40s). Preliminary TopicAssignment-only
  threads execution passed 13 tests; not added again to the unique 180 total.
- After: type-check PASS; build PASS (50.48s); `git diff --check` PASS.
- Build dependency eval warnings also occurred before the change. No unrelated fix.

Commands: `npm.cmd --prefix frontend run type-check`;
`npm.cmd --prefix frontend run build`;
`npm.cmd --prefix frontend run test -- <paths below> --maxWorkers=1 --pool=threads`.
Selected test paths relative to frontend/:

- src/pages/users/wizard/__tests__/missingFieldHighlight.test.tsx
- src/pages/users/wizard/__tests__/learnerStepGating.test.tsx
- src/features/monthly-logs/monthlyLogs.test.tsx
- src/features/coach/monthly-logs/components/requests.test.tsx
- src/pages/employer/EmployerMonthlyLogsTab.test.tsx
- src/pages/learner/video-watch/AssignmentSubmissionWizard.test.tsx
- src/pages/learner/video-watch/TopicAssignment.test.tsx

Setup and selected mocks inspected; no Django startup or live service tests.
No Teams suite selected. Pool selection is command-local; no configuration,
dependency or assertion was weakened. No remaining Batch 01 blocker; default
fork-worker startup reliability remains an environment limitation. Release gates
remain separate. Next executable batch: B2 membership read boundary, preserving
writers and requiring isolated POST/DELETE guard parity; no Neon access implied.

## Batch 02 - PASS (2026-11-19)

Implemented the membership read boundary, retaining existing public signatures:
- `curriculum_api/learner_status_counts.py`: single-module reader now owns only
  legacy read scope and dependency wiring. `learner_facts` delegates to SQL adapter.
- Added `learner_api/learning_plans/application/module_membership.py`: target/fact
  orchestration, pure policy invocation and enrolment-key projection. Only domain import.
- Added `learner_api/learning_plans/infrastructure/membership_facts.py`: existing
  PostgreSQL SQL/row projection, injected connection and schema checks; no views import.
- Added required application/infrastructure package markers. Domain membership rules
  unchanged; corrected stale integration comments in domain/membership_policy.py.
- Added application/test_module_membership_standalone.py (10 tests) and immutable
  infrastructure/learner_facts_prebatch02.json source oracle. Original pre-integration
  membership snapshot remains unchanged (SHA256 24c360f42bbc158624275b853222d2fe2476cdb201b89fe264bea6764c593e51).
- Updated domain/test_membership_integration_standalone.py and
  domain/test_membership_runtime_isolated.py for the real application delegate/import
  boundary. Retained original writer-body equality, decisions and behavior assertions.
- Updated image/run_import_smoke.py to bundle the two real modules and SQL oracle;
  image/integration.py now executes an independent old SQL reader and adds two tests.

Before: legacy reader coordinated target/facts/policy/identity projection, while its
fact function contained SQL. After: legacy compatibility/composition -> Application
-> Domain; legacy fact wrapper -> Infrastructure, with existing catalogue/schema
capabilities supplied explicitly. No new module imports legacy views or the caller.
Lineage resolution stays in Curriculum; its catalogue dependencies are B3 scope.
Legacy file reduced from 265 working-tree lines to 199 (66 lines net delegated).
Two functional production modules plus two required package markers added; existing
production modifications limited to learner_status_counts and domain docstrings.
No writer, URL, model/app identity, schema, authentication, cache or provider changes.
Shared fact-reader callers still use the same signature, SQL and errors.

Final distinct tests: **64 PASS, 0 FAIL, 0 SKIPPED**:
- Domain policy: 15; caller parity: 10; reader/guard binding: 6; isolated runtime: 8.
- New standalone application/fact contracts: 10.
- Disposable PostgreSQL/Django: 15 (original 13 plus 2 boundary/fact tests), 1.396s.
  An earlier 13-test PostgreSQL run also passed; not double-counted.
- Import smoke: all seven existing modules PASS; 107 source files bundled.
- Syntax compilation: 15 Python files PASS without importing application modules.
- `git diff --check`: PASS. Container cleanup verified; no Phase 1F containers remain.

Commands: `python -I -B` followed by each of the existing four
`backend/learner_api/learning_plans/domain/test_membership_*` scripts listed in
VERIFICATION.md; `backend/learner_api/learning_plans/application/test_module_membership_standalone.py`;
`backend/phase1f_tests/image/run_import_smoke.py`; `backend/phase1f_tests/image/run_integration.py`.
The historical binding-only structural assertion was adapted to compare the
extracted body against the original, reversing only explicit dependency-reference
renames. Full runtime parity still exercises actual orchestration, not a substitute.

Evidence: exact old/new SQL text, parameters, row order, optional columns, profile
narrowing, schema/driver errors; missing vs empty target, duplicate facts and bridges,
numeric 0 vs string "0", original 21 guard decision cases; full/compact GET JSON,
authorization/order, persisted POST/DELETE/mirrors and rollback after real INSERT.
The two added PostgreSQL tests spy with wraps (no query bypass) and compare independent
old/new fact readers. Expected refusal/injected rollback errors remain negative cases.

Isolation: reused existing images; network=none PostgreSQL and shared loopback-only
app namespace, no ports/mounts/live credentials, OS isolation asserted before initdb
or Django; all six aliases use disposable synthetic PostgreSQL. No Neon access.

Limits: legacy catalogue/schema helpers and production ready hooks/shared-cache/
outbox/provider behavior remain outside certification; no concurrency or production
latency claim. No remaining Batch 02 blocker. Existing release gates are unchanged.
Next executable backend batch: B3 catalogue read boundary; B4 frontend authoring can
proceed as its separately scoped parallel lane. Neither is implemented by Batch 02.

## Batch 03 execution record ? 2026-11-19

Status: **PARTIAL ? implementation complete; expanded regression suite has three
pre-existing assertion failures, reproduced against frozen pre-extraction code.**
Branch Architecture preserved. No writer, URL, auth, model/app-label, frontend,
provider, environment or existing database changes.

Actual affected tree (unrelated curriculum_api files omitted):

Before:
```
curriculum_api/
  views.py
  home_summary.py
  programme_list.py
```
After (all three legacy files remain as compatibility/composition adapters):
```
curriculum_api/
  views.py
  home_summary.py
  programme_list.py
  catalogue/
    __init__.py
    application/
      __init__.py
      resolution.py
      projections.py
    infrastructure/
      __init__.py
      content_counts.py
      projection_sources.py
    domain/
      __init__.py
      ranking.py
    prebatch03_snapshot.json
    test_boundary_standalone.py
```

Nine real function bodies moved, not duplicated production implementations:
- Application/resolution: resolve_stored_module_catalogue_id and
  resolve_authoring_catalogue_id; canonical fast path, alias candidate collection,
  legacy delivery-signature fallback and best-candidate orchestration.
- Application/projections: build_home_summary and build_programme_list, including
  current enrichment decisions, fallback composition and result construction.
- Infrastructure/content_counts: authoring_module_content_counts; exact grouped
  component SQL and normalized KSB projection, active filters and deduplication.
- Infrastructure/projection_sources: home_relationship_rows and
  programme_list_sources; original PostgreSQL JSON reads, parameters, ordering,
  optional-key handling and non-PostgreSQL fallback preserved.
- Domain/ranking: authoring_summary_score and best_authoring_summary; priority
  ksbCount > qualityScore > lessonCount > weeks, first candidate wins ties.

Legacy exports retain signatures and bind explicit named capabilities. No new
module imports views, Django, another context, a provider or another new module;
only stdlib imports. Thus **zero new import cycles** in the extracted closure;
this does not certify removal of the pre-existing whole-project import component.
Existing schema-guard invocation remains in exactly the same read paths; no new
bootstrap behavior. Domain has no persistence/HTTP dependencies. No repositories,
interfaces, inheritance, container or empty architectural packages introduced.

Net legacy reduction: views.py 82 lines; home_summary.py 35; programme_list.py 22:
**139 lines net**, replacing 275 original function lines with 136 wrapper lines.
Function bodies are AST-equal after reversing explicit dependency-name binding.
Immutable prebatch03 source SHA256:
`df45c28e0d47de2e705afacfd39c9eb2b2a3c56ceec04e163271b2eba1afe19c`.

Changed files beyond the tree above:
- curriculum_api/test_ksb_count_compatibility_standalone.py: execute actual new
  modules through a reviewed import hook, retain existing behavioral assertions.
- phase1f_tests/image/integration.py: four catalogue integration/parity cases,
  immutable original-code oracle, existing fixture suites and failure comparison;
  reset extra synthetic standard_ksbs fixture table between tests.
- phase1f_tests/image/run_import_smoke.py: allowlist required new/dynamic local
  import closure and frozen source snapshot. Pure calendar metadata helper is
  bundled as an existing catalogue dependency; no Teams tests/provider calls.
- This tracker only; prior Batch 01/02 modifications preserved.

Actual final results (distinct post-extraction tests, no repeated oracle counting):
**136 PASS, 3 FAIL, 0 SKIPPED / 139 tests**.
- Existing membership standalone/isolated-runtime: 15 + 10 + 6 + 8 + 10 = 49 PASS.
- KSB/legacy aliases/ranking standalone: 10 PASS.
- New static extraction/dependency/signature contracts: 4 PASS.
- Real disposable PostgreSQL/Django: 19/19 PASS (2.177s). Includes original 15
  membership checks, normalized KSB and alias comparison, exact source payload
  parity, Home/Programme payload parity and spies proving new code invocation.
- Existing Home Summary/Home Source/Programme List/Catalogue read tests: 54/57
  PASS (0.241s); frozen original code reproduces identical three failures (0.262s).
  Assertions are unchanged. Runner intentionally exits nonzero; no failures hidden.
- DB-free SimpleTestCase fixtures select the generic reader vendor branch; their
  own PostgreSQL-specific mock cases still override it. Database access remains
  forbidden there. The separate 19 integration cases use real PostgreSQL readers.
- Import smoke: seven legacy entry modules PASS; 129 reviewed source files bundled.
- Syntax compile: 16 Python files PASS; git diff --check PASS.

Unresolved existing assertion mismatches:
1. ProgrammeListTests.test_cards_keep_counts_metadata_ksb_source_and_learner_ownership:
   weeks 16 versus expected 11.
2. ProgrammeListTests.test_week_fallback_excludes_archived_rows:
   weeks 12 versus expected 7.
3. ModuleCatalogueReadTests.test_narrow_read_produces_identical_list_and_never_reads_component_bodies:
   KSB codes include S1 alongside S2,K1, while fixture expects S2,K1.
These reproduce before/after with the same test IDs and assertion messages.
Resolve the fixture/current-behavior disagreement separately; do not change
business rules or weaken assertions to label this batch green.

Commands actually run: `python -I -B` with each of the five membership test scripts
listed in Batch 02; curriculum_api/test_ksb_count_compatibility_standalone.py;
curriculum_api/catalogue/test_boundary_standalone.py;
`python -B backend/phase1f_tests/image/run_integration.py`;
`python -B backend/phase1f_tests/image/run_import_smoke.py`; AST/compile and
`git diff --check`. Earlier expanded runs failed on test-container missing local
imports/fixture reset and were corrected; no application workaround was applied.

Isolation: existing local images, network-none PostgreSQL, app sharing only its
loopback network, no published ports/host mounts/live secrets; OS isolation checked
before initdb/Django. Six aliases target disposable synthetic PostgreSQL. Only
synthetic state used, test containers removed; no Neon access or Teams tests.

Remaining catalogue legacy: authoring_catalogue_summaries detailed builder,
training/identity adapters, serializers/enrichment helpers, grouped catalogue
content reader, field lists, schema guards and low-level DB primitives remain
legacy dependencies passed explicitly. Existing wrappers stay until their callers
migrate with contract coverage. No complete endpoint/performance/global dependency
cleanup or G01-G05/release approval claimed.
Next tracker implementation lane: B4 module authoring frontend, under its own
scope. B03 acceptance remains pending disposition of the three existing failures.

## Batch 04 execution record ? 2026-11-19

Status: **PARTIAL ? safe feature extraction implemented; existing frontend URL
return-state assertion remains failing; final type-check/build/lint pass.**
Architecture branch preserved; no backend production changes, database/provider
access, Teams tests, dependency installs, environment edits or Git mutations.
The three Batch 03 baseline failures remain unresolved: programme weeks 16/11,
week fallback 12/7, additional KSB code S1. No backend assertions were changed.

Affected tree before: pages/curriculum/module-builder/page.tsx alongside the
existing moduleAuthoringData.ts, componentAuthoringModel.ts, collaboration,
confirmation, live-sync and editor components. These entry points remain.
After, the page imports these concrete feature modules (no barrel or empty folder):
```
features/curriculum/module-authoring/
  components/
    ComponentTypeModal.tsx
    EditorPrimitives.tsx
    KsbCards.tsx
    KsbCoverageDialogs.tsx
    KsbSelectorModal.tsx
    SaveStatus.tsx
    SessionKsbMappingModal.tsx
    ksbOptions.ts
    authoringPanels.test.tsx
  model/
    catalogueTypes.ts
    componentSelection.ts
    draftTransforms.ts
    ksbCoverage.ts
    ksbMappings.ts
    ksbPresentation.ts
    ksbSources.ts
    ksbWeights.ts
    saveState.ts
    authoringContracts.test.ts
```
Exact scoped changes: 17 new production modules and 2 new test files above;
modified frontend/src/pages/curriculum/module-builder/page.tsx and this tracker.
Existing frontend/backend uncommitted changes preserved. moduleAuthoringData.ts
and curriculumApi.ts are inspected but unchanged; existing public exports remain.

Responsibilities moved: source-aware KSB add/remove/weight transformations at
module/week/component scope; normalization/aliases and source selection; coverage
rows and placement columns; draft title/order helpers; component selection;
KSB cards, selector/review/coverage dialogs; save-state priority and save/archived
presentation. No stateful component is nested in a render; callbacks/props remain
identical. Actual route calls the extracted implementations, not parallel copies.

Measured source preservation: 94 moved declarations retain their original bodies
(type/function/constant declarations), 132 retained declarations unchanged, apart
from replacing the save-status expression with its pure function call. The exact
original ternary expression is preserved inside that function. No changes to the
autosave effect, dependencies, refs, debounce, persistence/rebase/retry code,
cache keys, payloads, permissions, navigation or provider operations.
Route: **10,162 -> 8,073 lines**, net **2,089 fewer** (UTF-8 splitlines count).
Route import declarations 82 -> 94: explicit feature imports replace local
implementations; this is responsibility extraction, not a claim of fewer imports.
Production static graph: 1,845 -> 1,862 files, **0 -> 0 cyclic components**,
no unresolved local specifiers. Direction: route -> feature components/model;
components -> model/shared UI; model retains explicit existing authoring-data
helpers and type contracts. No new module imports the route. This is an incremental
feature boundary, not a claim that moduleAuthoringData is already decoupled.

Tests: **128 PASS, 1 FAIL, 0 SKIPPED / 129 distinct**. Before extraction the same
11 existing suites returned 103 PASS / 1 FAIL; after extraction the same failure
remains, plus all 25 new tests PASS. New tests cover immutable targeted KSB updates,
duplicate/source separation, missing targets, weight validation, source aliases,
week coverage identity, reordering/selection and save-status precedence, footer
callbacks/disabled controls and mapping-id callback identity. No casts or weakened
production types/assertions used. Final new-suite rerun: 25 PASS in 4.62s.

Existing suite selection (module-builder/__tests__, original assertions unchanged):
moduleAutoSave, moduleStructureLoading, moduleStructureDelta,
moduleStructureSaveSize, moduleConflicts, moduleDeepLink, moduleBuilderReturnState,
moduleBuilderArchivedProgramme, moduleLiveSync, confirmModuleSave, ksbImportReview.
Exact command pattern: `npm.cmd --prefix frontend run test --` with the explicit
11 .test.ts/.test.tsx paths above plus
`src/features/curriculum/module-authoring --pool=threads --maxWorkers=1`.
No broad discovery or Teams suite. Vitest uses its standalone config (no dev
proxy); existing synthetic API mocks retained. No server or live endpoint started.

Outstanding frontend assertion (reproduced before this batch):
moduleBuilderReturnState.test.tsx ? "returns with the same search, filters and
learner list open": the assertion expects one argument, while the actual call
contains the target, undefined signal and { assignedOnly: true }. This same
three-argument call occurs before and after extraction (line 213). Remaining
seven tests in that suite pass. Leave the assertion and
behavior intact; investigate its fixture/runtime disagreement separately before
release acceptance. React act warnings also occur in existing tests.

ESLint changed route + entire new feature with --report-unused-disable-directives
--max-warnings 0: PASS, 0 warnings/errors (route baseline also PASS).
`node frontend/scripts/check-batch01-cycles.cjs`: PASS.
`git diff --check`: PASS.
`npm.cmd --prefix frontend run type-check`: PASS (exit 0).
`npm.cmd --prefix frontend run build`: PASS (exit 0, 33.84s); build emits plugin
timing/bundle warnings, no build failure. A prior intermediate type-check caught
new-test fixture typing omissions and a relocated helper import; all corrected
without casts, weakened types or production behavior changes.

Remaining oversized responsibilities: route still ~8k lines, catalogue filtering,
main workspace state/effects, CourseStructure/ComponentEditor, duplication,
preview/navigation and persistence coordination. Shared moduleAuthoringData and
curriculumApi retain transport/cache/confirmation and scheduling/provider coupling.
API extraction and moving the autosave loop were deliberately left unchanged:
those closures include shared caches, collaboration, Teams/link and retry behavior.
No empty hooks/api folders or compatibility-only API wrapper was introduced.
The safe independent transformations, status policy and panels are implemented.
No live UI/provider certification or full V1/release acceptance is claimed.

Next tracker lane: B5 consumer composition after explicit scope and stable B2/B3/B4
contracts; resolve outstanding B03/frontend baseline issues before release.

## Batch 05 execution - 19 November 2026

Status: **PARTIAL - scoped consumer extraction implemented; inherited failure remains**.
Architecture checkout preserved; no branch operation, backend production edits,
database/provider access, Teams tests, dependency or environment changes.

Before: programme-detail/page.tsx owned navigation/record transforms, view models,
staff selection, roster and overview panels. LearnerAssignmentDrawer.tsx owned
filters, row rendering, loading and mutation coordination.
After (all ten new production files and two tests listed):

    frontend/src/features/curriculum/
      programme-detail/
        model/{types,presentation,navigation,records,roster}.ts
        model/consumerContracts.test.ts
        components/{StaffSlot,EnrolledLearnersPanel,OverviewPanels}.tsx
      learner-assignments/
        selection.ts
        LearnerRows.tsx
        selection.test.tsx

Only the two existing frontend consumers were modified. This B5 record/status row
are the only tracker edits. curriculumApi.ts and curriculumLearnerAssignments.ts
remain unchanged: shared transport/cache contracts are reused, not duplicated.

Moved responsibilities: canonical/legacy navigation and identity precedence;
programme matching/record statuses; presentation/view types; staff options,
avatar/progress helpers; readonly roster search/lifecycle filtering/order/selection;
coach StaffSlot and overview panels. Drawer delegates option/filter construction,
immutable set toggling and row display. Request effects, mutation payloads,
progress/retry, pending selections and remount key remain in AssignmentForm.
Existing route/default and drawer public exports remain the composition entry
points; no pass-through API wrapper or empty architectural folders introduced.

Physical lines excluding terminal empty line: programme page 7,258 -> 6,234
(net -1,024); drawer 350 -> 287 (net -63). Largest extracted panel 321 lines.

Source parity against pre-edit snapshots using installed TypeScript AST:
- 48 moved declarations preserve exact bodies (ignoring export/whitespace).
- All 113 retained programme declarations unchanged.
- 26 programme and 5 drawer request/mutation/cache expressions unchanged,
  including argument counts and options.
- Drawer: 14 state/selection callback declarations, two filter callback bodies,
  toggle body and full row JSX match. Scope-only filter input retains the original
  useMemo dependency list without adding target object identity as a dependency.
- Registration IDs pass through unchanged; no profile/enrolment conversion or new
  membership/lifecycle rule. Programme roster retains its existing UI lifecycle
  filter. Coach display/selection and existing state ownership are preserved.

Validation (standalone Vitest/jsdom, setup/import dependencies and API mocks
inspected before baseline; no HTTP server or live endpoint started):
- Before edits: 53 PASS / 1 FAIL / 0 SKIPPED, 54 tests, 28.28s.
- After extraction: 68 PASS / 1 FAIL / 0 SKIPPED, 69 tests, 34.11s.
- Existing drawer/programme suites pass; return-state remains 7 PASS / 1 FAIL.
- New 15 tests pass: exact IDs, immutable selection, scope filters, multi-term
  search, programme versus lifecycle status, options, empty/permission/disabled
  rows, navigation/deep links, presentation and staff names.
- Intermediate new-test expectation assumed case-sensitive label deduplication;
  corrected it to unchanged normalized-key behavior. Type-check caught two new
  fixtures missing required name; added empty names without casts/type changes.
  Affected helper suite rerun: 7 PASS, 2.21s.

Exact test command (single invocation, paths wrapped for readability):

    npm.cmd --prefix frontend run test --
    src/pages/curriculum/shared/entities/__tests__/learnerAssignmentDrawer.test.tsx
    src/pages/curriculum/programme-detail/__tests__/programmeWorkspace.test.tsx
    src/pages/curriculum/module-builder/__tests__/moduleBuilderReturnState.test.tsx
    src/features/curriculum/learner-assignments/selection.test.tsx
    src/features/curriculum/programme-detail/model/consumerContracts.test.ts
    --pool=threads --maxWorkers=1

Other validation:
- npm.cmd --prefix frontend run build: PASS, exit0, 37.03s; bundle/direct-eval/plugin
  timing warnings remain; no performance certification claimed.
- npm.cmd --prefix frontend run type-check: PASS, exit 0 after fixture correction.
- Scoped ESLint on both consumers and both new feature directories: PASS, zero
  warnings/errors with --report-unused-disable-directives --max-warnings 0.
- node frontend/scripts/check-batch01-cycles.cjs: 1,862 -> 1,872 source files;
  0 -> 0 cyclic components; zero unresolved local imports. Features reference
  existing shared UI/model helpers and API types, not their consuming page/drawer.
- git diff --check: PASS. Backend suites were not executed.

Known selected failure identical before/after: moduleBuilderReturnState line213
expects one argument; actual call is target, undefined, {assignedOnly:true}.
Neither assertion nor behavior changed. Existing React act warnings remain.
Three B3 backend failures remain open (weeks16/11, fallback12/7, extra KSB S1);
not rerun or claimed resolved. B3/B4 are not certified by frontend extraction.

Remaining responsibilities: programme page (~6.2k lines) still owns read coordination,
component/achievement/KSB/session composition and other panels. Assignment loading,
mutation/review coordination intentionally remains in the entry point. Shared
curriculumApi transport stays deferred because of shared cache/provider behavior.
No full endpoint/backend equivalence or release acceptance claimed.

Next B06: triage the three B3 fixture/runtime differences in the established isolated
PostgreSQL environment; separately decide/correct the return-state assertion versus
the preserved three-argument contract. Rerun relevant B1-B5 candidate regressions,
static boundaries, type/build/lint after approved corrections; complete reviewer,
CI/protection and performance-budget evidence. No Neon access, writer redesign or
automatic release implied.

## Batch 06 stabilization and acceptance - 19 November 2026

Scope: test-only corrections on Architecture; previous production changes retained.
No new production source, writer, URL, model, migration, environment or provider
changes. Four unique failing tests reproduced before correction. Backend pre/post
extraction oracle reproduced the same three failures; frontend reproduced 7 PASS /
1 FAIL in the return-state file. No assertion was deleted or test skipped.

| Failure | Evidence and classification | Narrow correction |
| --- | --- | --- |
| Programme card weeks 16/11 | Incorrect synthetic fixture. MOD-1 had sessions=10, no delivery day and no live week rows: fallback contributes 10. MOD-2 has sessions=12 and two days: contributes 6. `module_stored_week_count` defines live week rows as authority, then sessions/day fallback; normalized ModuleAuthoringModule does not store weeks_number. Existing authored-week precedence test corroborates this contract. | Supply five active MOD-1 week rows; retain expected 11 and all payload/count/ownership assertions. |
| Programme fallback 12/7 | Same fixture defect: MOD-1 contributes 10 instead of intended five; MOD-2 has W1/W2 active (2), W4 inactive (excluded). | Same five-row fixture fixes it; retain expected 7. Add independent no-authored-weeks case expecting 10+6=16 and old/new list parity. |
| Catalogue extra S1 | Incorrect archive fixture. `archive_state` explicitly defines status as lifecycle state; KSB mapping projection preserves status and joins component/standard keys. `is_deleted=True` is not normalized archive state. C4 also used stale deleted_at. | Use status=inactive for S1 and C4; keep KSB deduplication, merge order, lesson/quiz counts and body-exclusion assertions. Once reached, the same test exposed stale weeks=3: its W1/W2 rows imply 2, despite legacy weeks_number=3. Correct that assertion to 2. |
| Return-state one/three arguments | Stale assertion. Public fetchLearnerAssignments(target, signal?, options) and assignedOnly backend branch define the compact read; restored progress drawer intentionally requests assignedOnly=true. Existing search/filter/navigation expectations remain authoritative. | Assert target, undefined, {assignedOnly:true}; preserve the production call and all UI assertions. |

Changed test files only:
`backend/curriculum_api/test_programme_list_no_db.py`,
`backend/curriculum_api/test_catalogue_reads_no_db.py`,
`frontend/src/pages/curriculum/module-builder/__tests__/moduleBuilderReturnState.test.tsx`.
This tracker is the only documentation edit. An older comment at programme
structure counts still describes stored weeks_number precedence; the normalized
model, helper contract and authored-week behavior supersede that comment. No
production comment or business rule was changed to hide the discrepancy.

Candidate validation:
- Backend **140 PASS / 0 FAIL / 0 SKIPPED**: 49 membership policy/caller/guard/
  isolated-runtime/application contracts; 10 KSB/alias/ranking; 4 catalogue AST
  boundaries; 19 disposable PostgreSQL/Django; 58 Home/Programme/Catalogue fixtures.
- Real PostgreSQL tests exercise actual extracted reads, old/new source parity,
  canonical/legacy IDs, normalized KSB projection, GET/assignedOnly ordering and
  serialization, authorization, missing/zero bridges, POST/DELETE guards and
  persisted state, including injected-write rollback. Synthetic records only.
- `python -I -B <script>` for four domain test_membership_* scripts, application/
  test_module_membership_standalone.py, curriculum_api/test_ksb_count_compatibility_standalone.py
  and curriculum_api/catalogue/test_boundary_standalone.py: PASS.
- `python -B backend/phase1f_tests/image/run_integration.py`: PASS. Existing
  images reused; PostgreSQL network=none; app shares only its loopback namespace;
  no mounts/published ports/host env. OS guards pass before initdb/Django; all six
  aliases use synthetic phase1f on 127.0.0.1. Containers removed after execution.
- `python -B backend/phase1f_tests/image/run_import_smoke.py`: seven real imports
  PASS, 129 reviewed source files bundled. No settings/.env bundled.
- `python -B backend/phase1f_tests/image/validate_image.py`: pip check PASS; all
  30 application packages match pins. No image rebuild or dependency install.
- Frontend final split validation: **370 PASS / 0 FAIL / 0 SKIPPED**. Curriculum
  190 PASS across 17 files (138.94s); B01 180 PASS across seven files (51.27s).
  Both invocations exit 0, no unhandled errors. Same deduplicated B01/B04/B05 selection,
  24 files. Initial combined run: 334 PASS across 23 files, nonzero exit because
  ProgrammeWorkspace threads worker startup timed out; not counted as a clean run.
  Reproduce with `npm.cmd --prefix frontend run test -- <explicit paths>
  --pool=threads --maxWorkers=1`: B01's seven paths listed above as one invocation;
  B04's eleven paths plus its two feature tests, B05's drawer/programme paths and
  two new feature tests as the other (return-state included once, 17 paths).
- `npm.cmd --prefix frontend run type-check`: PASS, exit 0.
- `npm.cmd --prefix frontend run build`: PASS, exit 0, 2m18s; existing bundle/eval/
  plugin warnings remain. No measured runtime performance improvement claimed.
- Scoped ESLint: B01 production split files, B04/B05 entry points and feature tree,
  corrected frontend test; --report-unused-disable-directives --max-warnings 0:
  PASS, zero warnings/errors. Full-repository lint is not claimed.
- Static frontend checker: 1,872 files, zero cyclic components and unresolved
  local imports. Original three B01 cycles remain removed. Static-value-edge
  limitations recorded under B01 still apply.
- Python syntax compile: 24 boundary/test files PASS without imports/bytecode.
  `git diff --check`: PASS.

Actual V1 structure and boundary acceptance:

    backend/learner_api/learning_plans/
      domain/membership_policy.py
      application/module_membership.py
      infrastructure/membership_facts.py
    backend/curriculum_api/catalogue/
      domain/ranking.py
      application/{resolution,projections}.py
      infrastructure/{content_counts,projection_sources}.py
    frontend/src/features/curriculum/
      module-authoring/{model,components}/
      programme-detail/{model,components}/
      learner-assignments/{selection.ts,LearnerRows.tsx}

Existing Django handlers remain API adapters. Spies and SQL/HTTP tests prove these
boundaries are invoked. Membership Application -> Domain; facts Infrastructure
receives the caller connection/schema capabilities. Catalogue modules have only
stdlib imports, explicit dependencies and no return imports into legacy views.
AST against HEAD limits backend function changes to 5 catalogue view wrappers,
2 Home wrappers, 2 Programme wrappers and 2 membership/facts wrappers; no other
top-level backend declaration changes in those files. Model/app identities, URL
definitions and writer source are unchanged. Frontend public entries remain;
type-check/build plus caller suites validate their use without transport changes.

Remaining legacy is explicit, not a new V1 blocker by itself: views.py 37,354 lines;
module-builder 8,073; programme-detail 6,234; drawer 287. Membership caller 199,
Home Summary 386, Programme List 121. Residual catalogue composition, shared API
transport, scheduling/providers, writer convergence, quiz writes, jobs and mobile
remain outside this bounded V1 acceptance. Prior extraction metrics remain above.

Packaging / release decision:
- Clean-checkout reproduction is **NOT yet established**. New catalogue (11),
  learning_plans (14), test-image/config/docs (12) and curriculum feature (31)
  deliverable files are all untracked, not ignored. Include their reviewed source,
  test, immutable snapshot and sanitized harness manifests in the eventual PR,
  plus B01 leaf files and frontend/scripts/check-batch01-cycles.cjs. Do not include
  caches, raw *.log or credentials. Existing modifications must also be packaged.
- docs/architecture remains ignored by root `/*` (.gitignore line313). This
  tracker under backend is eligible but untracked. Proposed separate packaging
  action: approve an explicit sanitized documentation subset in a tracked location
  or a narrowly reviewed ignore exception. No ignore edits, staging or force-add.
- Reproduction requires tracked frontend package-lock/npm ci, the dedicated
  image manifests/build context, pinned local Python/PostgreSQL images and the
  reviewed source snapshots. Docker build context excludes real settings/.env.
  This run verifies the existing image, not a fresh clean-checkout image build.
- Tracked workflows exist: deploy-aws, teams-checks, calendar-deployment-checks,
  aptem-learner-sync. deploy-aws runs main/manual, not a V1 PR gate; frontend lint,
  type/build block there, but unit tests are report-only (continue-on-error).
  No dedicated required V1 boundary/isolated integration/cycle workflow found.
- Needed candidate gates: selected frontend regressions/type/build/lint/cycles,
  standalone boundary contracts and isolated PostgreSQL parity. Required-status
  configuration, branch protection, named reviewer approvals and remote CI runs
  are UNVERIFIED. Existing Teams remote policy is not bypassed; local Teams tests
  and live provider checks were not requested/run.
- Implementation acceptance: **PASS for the agreed B01-B05 scope**, supported by
  510 distinct passing candidate tests and the static/type/build/import checks.
  Overall V1 milestone / B06 acceptance remains **PARTIAL** until reproducible packaging and candidate gates are
  established. GO for review preparation; PR-ready not certified; merge/deployment
  NO-GO. No commit, push, PR, merge, deployment or GitHub-setting change performed.

## Parallel execution and risk controls

- B1 then B4 can run alongside B2 then B3. One owner per shared file; serialize
  `curriculumApi.ts` edits and integration, and do not run competing working-tree
  edits on the same files. B5 follows stable contracts rather than guessing them.
- The 304-file backend static import component is coupling evidence, not an import
  crash. Remove reviewed edges; do not promise its complete removal in V1.
- Local wrappers do not exempt write guards from testing. Do not consolidate writers,
  change explicit-empty policy or repair identities to simplify extraction.
- Reuse approved disposable Docker isolation; inspect any new startup/import closure
  before executing tests. Never point tests at NEW_ENDPOINT_URL. No real provider calls.
- If B3's closure exceeds the day-7 budget, narrow to counts/catalogue reads with a
  documented retained legacy resolver boundary; label the full resolver work deferred.
  If required V1 acceptance cannot be met by day 15, report incomplete/reforecast;
  do not relabel failing or untested work as done.
- Release reviews, named owners, CI protections and performance-budget disposition
  remain release dependencies from the final readiness review. They need not block
  independent safe UI restructuring. Separate implementation progress from release approval.

## Definition of done and tracker

V1 acceptance requires B1–B5 accepted (or explicitly agreed reduced scope), B6
checks passing on the exact candidate, no new dependency cycles, no extracted
domain/infrastructure -> legacy views imports, preserved URL/API/schema/model
identities, no silent test skips and no altered writer/provider policy. At least
one real backend read use case and the authoring frontend route must delegate to
tested cohesive modules. Record before/after responsibility and edge counts, not
an arbitrary file-size quota. A release still requires normal reviewer/CI approval.

| Item | Status | Evidence / next action |
| --- | --- | --- |
| Existing membership pilot | IMPLEMENTED; release pending | Prior 39 standalone/runtime + 13 isolated integration PASS; one-module real-data baseline; no rerun today |
| KSB prerequisite | IMPLEMENTED; scope review pending | Earlier compatibility fix; keep distinct from membership extraction |
| B1 | PASS | Three cycles removed; 180 tests, type-check, build and static graph PASS; execution record above |
| B2 | PASS | Read boundary extracted; 64 distinct tests PASS; original writers unchanged |
| B3 | PASS (implementation) | Three fixture/assertion failures resolved in B06; backend candidate 140 PASS |
| B4 | PASS (implementation) | Return-state assertion corrected in B06; included in 370 frontend PASS |
| B5 | PASS (implementation) | Consumer contracts included in 370 frontend PASS; no new failures |
| B6 / release | PARTIAL | 510 distinct tests PASS; packaging/clean-checkout reproducibility, required CI and review/protection evidence remain open; no merge/deploy approval |
| Residual legacy | DEFERRED beyond V1 | Coach scheduling/providers; plan writer convergence; quiz writes; audit variant authority; canonical evidence query modes; jobs/mobile restructuring |

Update this single tracker per completed batch: changed responsibilities, exact
checks/results and concrete blocker. No additional numbered planning phases.


## Post-V1 approved continuation: programme structure reads (19 November 2026)

- Before: views.py owned programme structure count orchestration, ID/name
  attribution, archived/deleted exclusions, week aggregation and legacy selection.
- After: catalogue/application/programme_structure.py owns these three concrete
  functions. Existing view signatures and scoped_curriculum_read decorator stay;
  existing read adapters/normalizers are supplied explicitly. No new infrastructure
  layer or domain package was needed. No SQL, writers, URLs or auth changed.
- This batch reduces views.py from 37,354 to 37,254 lines (100 net lines).
  AST comparison against the pre-task working source confirms only
  _empty_programme_structure_counts, authoring_programme_structure_counts and
  programme_structure_counts changed; earlier uncommitted batches are preserved.
- Added programme_structure_snapshot.json (original function source, synthetic
  test oracle) and test_programme_structure_standalone.py. Bodies match the
  original AST exactly; signatures/cache decorator and synthetic results checked.
  Synthetic dependency stubs do not independently prove real helper semantics;
  existing isolated Django consumer tests provide that complementary coverage.
- run_import_smoke.py includes the new module in its explicit source bundle
  because function-local imports are intentionally not traversed by that bundler.
- Actual commands/results: python -I -B followed by
  curriculum_api/catalogue/test_programme_structure_standalone.py: 7 PASS;
  curriculum_api/catalogue/test_boundary_standalone.py: 4 PASS;
  curriculum_api/test_ksb_count_compatibility_standalone.py: 10 PASS
  (all script paths prefixed backend/).
- python -B backend/phase1f_tests/image/run_import_smoke.py: PASS, exit 0.
  python -B backend/phase1f_tests/image/run_integration.py: 19 PostgreSQL/Django
  integration + 58 Home/Programme/Catalogue fixtures PASS, exit 0; 98 distinct
  tests overall, no failures/skips. Initial PowerShell stderr redirection reported
  NativeCommandError despite both suites passing; reran via subprocess with merged
  file output to verify the actual exit code 0. Repeated tests are counted once.
- Isolation: network none/shared loopback namespace, no ports/mounts; OS isolation
  asserted before initdb/Django, synthetic database only; temporary containers
  removed. No Neon, external providers or Teams suites executed.
- Syntax checks and git diff --check PASS. New application module imports only
  collections.Counter; no reverse import to views and no new import cycle.
- Implementation PASS for this bounded extraction. Remaining: legacy readers and
  normalizers still supplied by views, large remaining views.py responsibilities,
  broader real-data/performance evidence and V1 release packaging/reviews/CI.
  No staging, commit, PR, push, deployment or gate approval was performed.


## Post-V1 approved continuation: programme card builder (19 November 2026)

- Before: build_programmes in views.py held 189 lines of programme grouping,
  visibility, ordering, count selection, KSB-source decisions and payload assembly.
- After: catalogue/application/programme_builder.py owns the unchanged body;
  the legacy function is a 38-line composition adapter preserving its public
  signature and all callers. views.py: 37,254 -> 37,103 lines, net reduction 151.
  AST comparison with the pre-task working copy confirms build_programmes is the
  only existing production function changed in this batch. No SQL, writer,
  provider, schema, route or authorization change; previous batches preserved.
- The application module imports only Counter/defaultdict. Its 29 existing helper
  dependencies are explicit keyword capabilities supplied by the outer adapter;
  no application -> views/Django import or new cycle. This remains a transitional
  boundary: identity/KSB/count helpers have not all been extracted from legacy.
- Added programme_builder_snapshot.json containing the actual original body and
  dependency names, and test_programme_builder_standalone.py (4 contracts).
  Added four ProgrammeList fixture tests: actual extracted invocation, complete
  original/new payload and read-order parity in operational/all modes, renamed/
  duplicate/archived/draft configs, empty inputs, supplied-count read suppression.
  Existing assertions were retained. The oracle compiles the original source
  with real helpers plus fixture readers, not a reimplementation of expectations.
- Test harness changes: explicit new application module, immutable source oracle
  and existing KSB-source test module included in the sanitized bundle; added only
  StoredSourceReaderTests, AppliedProfileTests and ProgrammeCardLabelTests to the
  isolated fixture selection (13 additional existing tests, no Teams selection).
- Actual commands, all exit 0 (python -B plus each path):
  backend/curriculum_api/catalogue/test_programme_builder_standalone.py: 4 PASS;
  backend/curriculum_api/catalogue/test_programme_structure_standalone.py: 7 PASS;
  backend/curriculum_api/catalogue/test_boundary_standalone.py: 4 PASS;
  backend/curriculum_api/test_ksb_count_compatibility_standalone.py: 10 PASS;
  backend/phase1f_tests/image/run_import_smoke.py: PASS;
  backend/phase1f_tests/image/run_integration.py: 19 integration + 75 fixtures PASS.
  Total: 119 distinct tests PASS, 0 FAIL, 0 SKIPPED. Syntax checks on 18 relevant
  Python files and git diff --check PASS. No frontend changes/checks required.
- Isolation verified before PostgreSQL/Django startup: no external network,
  published ports or host mounts; all aliases target disposable synthetic data.
  Temporary containers removed. No Neon, existing DB, provider or Teams operation.
- Changed/created files this batch: views.py; test_programme_list_no_db.py;
  catalogue/application/programme_builder.py; catalogue/programme_builder_snapshot.json;
  catalogue/test_programme_builder_standalone.py; image/run_import_smoke.py;
  image/integration.py; this tracker (image paths under backend/phase1f_tests/).
- Implementation PASS for this scope. Not full endpoint or live-data equivalence,
  no performance claim. Remaining legacy readers/helpers, release packaging,
  remote CI/protections and human acceptance remain open. No staging, commit, PR,
  push or deployment; G01-G05 not marked complete.


## Post-V1 approved continuation: programme identity domain (19 November 2026)

- Before: programme_identity, programme_config_identity, display selection and
  its preference/tie rule lived in views.py; builder received all three entry
  points through its legacy dependency list (29 supplied capabilities).
- After: catalogue/domain/programme_identity.py owns those three rules plus
  program_config_preference, importing datetime only. Builder imports the three
  rules directly; supplied legacy capabilities fall 29 -> 26. Four compatibility
  entry points keep existing signatures. Normalization/archive predicates remain
  explicitly supplied; this is not complete legacy dependency elimination.
- views.py: 37,103 -> 37,038 lines (-65). Pre-task working-source AST comparison
  verifies only those four functions and build_programmes changed. No writer,
  SQL, schema, route, authorization, frontend or provider implementation changed.
- Preserve ID alias precedence, name fallback (including its existing legacy
  sourceId behavior), rename handling, string normalization, active duplicates,
  archived representative preference, timestamp/ID ranking and first-wins ties.
  programme_config_id has a different existing alias order and remains untouched.
- Added programme_identity_snapshot.json (actual original source plus dependencies)
  and test_programme_identity_standalone.py: 8 tests with synthetic matrices for
  missing/zero/whitespace IDs, malformed inputs/errors, names/renames, timestamp
  forms, permutations, archival flags, ties, unchanged inputs and object identity.
  Pure helper definitions are AST-extracted explicitly; no Django module imports.
  Rule body ASTs match the original after restoring verified helper call bindings.
- Updated builder contracts to require the inward domain imports and absence of
  the three removed dependency arguments, retaining the frozen body comparison.
  ProgrammeList parity oracle now also restores all four original identity rules;
  a new spy test proves direct domain invocation by actual consumer execution.
  The isolated source bundle includes the new frozen oracle; static import
  traversal includes the domain module via its application import.
- Actual python -B commands (paths under backend/):
  curriculum_api/catalogue/test_programme_identity_standalone.py: 8 PASS;
  curriculum_api/catalogue/test_programme_builder_standalone.py: 4 PASS;
  curriculum_api/catalogue/test_programme_structure_standalone.py: 7 PASS;
  curriculum_api/catalogue/test_boundary_standalone.py: 4 PASS;
  curriculum_api/test_ksb_count_compatibility_standalone.py: 10 PASS;
  phase1f_tests/image/run_import_smoke.py: PASS;
  phase1f_tests/image/run_integration.py: 19 integration + 76 fixtures PASS.
  Final total 128 distinct tests, 0 FAIL, 0 SKIPPED. Initial test-file BOM encoding
  error was corrected and the test rerun successfully; accidental CRLF changes
  were normalized back to LF. Syntax and final git diff --check PASS.
- Isolated Docker/PostgreSQL only; OS network isolation checked before startup,
  synthetic data, no host mounts/ports/credentials, containers removed. No Neon,
  existing database, Teams suite or external provider operations.
- Changed/created: views.py; catalogue/application/programme_builder.py;
  catalogue/domain/programme_identity.py; catalogue/programme_identity_snapshot.json;
  catalogue/test_programme_identity_standalone.py;
  catalogue/test_programme_builder_standalone.py; test_programme_list_no_db.py;
  phase1f_tests/image/run_import_smoke.py; this tracker.
- Implementation PASS for this scope. No full endpoint/performance/live-data
  equivalence claim. Remaining legacy adapters and release packaging/review/CI
  requirements stay open; no G01-G05 completion or staging/commit/PR/push/deploy.


## Programme Reads cohesive batch (19 November 2026)

Implementation PASS for the reviewed List/Home/Detail orchestration and read
boundaries below; not complete Curriculum legacy elimination or release approval.

| Before | After | Legacy line count |
| --- | --- | --- |
| views.py owned enrichment, archived keys, learner counts, KSB-stat orchestration and detail/workspace assembly | Catalogue application enrichment/detail plus infrastructure readers | 37,038 -> 36,626 (-412) |
| home_summary.py owned projection, enrichment decision and source adaptation beside HTTP/cache | application/home_projection, application/programme_enrichment and infrastructure/programme_reads | 386 -> 223 (-163) |
| programme_list.py mixed SQL learner count and fallback decision with composition | infrastructure/programme_reads and application/programme_enrichment | 121 -> 92 (-29) |
| programme_workspace_reads.py mixed bounded child queries with selection checks | shared child reader in infrastructure/programme_reads | 112 -> 82 (-30) |

- 20 functions / 863 original lines extracted; net 634 lines removed from the
  four legacy files. New files: application/programme_enrichment.py (273 lines),
  application/programme_detail.py (415), application/home_projection.py (184),
  infrastructure/programme_reads.py (202). Explicit dependencies and compatibility
  wrappers add lines; this is not a claim of net project size reduction.
- Existing URLs, HTTP handlers, permissions, cache lifetimes/keys, serialization
  and writer code remain in place. Archived reconstruction, count ownership,
  Home matching/sort/limits, shell/modules/full detail, workspace outline/text
  fallback, SQL text/params/order and exception behavior remain unchanged.
- Detail still calls repair_curriculum_parent_links(..., allow_writes=False),
  the existing documented no-op. Static and runtime tests pin this argument.
  No repair implementation moved, enabled or exercised with writes.
- Frozen programme_reads_snapshot.json stores the actual pre-batch bodies and
  capability mappings. Four standalone contracts compare all 20 AST bodies,
  wrapper signatures/bindings, read-only repair guard and import direction.
  Only views.* references become supplied names; two local imports stay in outer
  adapters. New modules import stdlib only, with no reverse edge to views/Django.
  Home projection helpers call each other inside their new owner directly;
  _DETAIL_KEYS remains available from the old module through a compatible import.
- New test_programme_read_boundary_no_db.py compares actual old/new Home full/
  summary, programme list values/read order, detail shell/modules/full/tree modes,
  checks extracted invocation and verifies the disabled repair capability.
  Original source is compiled with current fixture globals; fixture-provided
  mocks are retained identically in both comparison branches.
- Added existing inspected detail/workspace suites to the isolated runner:
  tests_programme_detail_sections, test_programme_modules_workspace_no_db,
  test_programme_workspace_latency_no_db, test_programme_workspace_text_no_db.
  The latency fixture uses only SQLite :memory: within the isolated container.
  All are SimpleTestCase; no broad discovery or Teams suite selection.
- First integration attempt: 19 integration PASS; fixtures had four missing
  authoring_read_transport import errors and one oracle mock-overwrite mismatch.
  Corrected only source-bundle inclusion and oracle fixture preservation; retained
  every assertion. Final rerun: 19 integration + 105 fixtures PASS, 0 FAIL/SKIPPED,
  exit 0. Import smoke also PASS. Original failure diagnostics remain in local
  temporary logs, not included as application data or release evidence artifacts.
- Actual commands: python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; python -B with each
  backend/curriculum_api/catalogue/test_programme_reads_standalone.py (4 PASS),
  test_programme_identity_standalone.py (8), test_programme_builder_standalone.py
  (4), test_programme_structure_standalone.py (7), test_boundary_standalone.py (4),
  plus backend/curriculum_api/test_ksb_count_compatibility_standalone.py (10).
  Total: 161 distinct tests PASS; failed attempts/repeated runs are not added.
- Final syntax and git diff --check PASS. Pre-task working-source AST comparison
  confirms only the 20 selected existing functions changed (7 views, 10 Home,
  2 Programme List, 1 workspace). No existing writers/handlers were rewritten.
- Docker OS isolation checked before Django/PostgreSQL startup; disposable
  synthetic PostgreSQL only, no host mounts/ports/credentials, no egress.
  Containers removed. No Neon/existing DB/provider/Teams operation. No frontend
  changes or frontend tests; no performance improvement claim.
- Remaining dependencies: common module/cohort/session builders and normalization,
  generic authoring transport/schema compatibility and caching stay legacy;
  programme achievement/coverage/roster and mixed read/write endpoints are outside
  this batch. A wrapper is compatibility, not proof of full context isolation.
  Remote CI, packaging and human release acceptance remain open; G01-G05 unchanged.
- Files touched: four legacy modules above, four new catalogue modules, snapshot,
  two new tests, phase1f_tests/image/run_import_smoke.py and integration.py, tracker.
  Existing uncommitted work preserved. No staging, commit, PR, push or deployment.


### Module read assembly and projection batch - 2026-11-19

Status: implementation COMPLETE; validation PARTIAL due to one confirmed
pre-existing assertion failure. No release/merge approval or G01-G05 closure.

| Before | After |
| --- | --- |
| views.py owned module selection, delivery/config payload construction and authoring enrichment | 13 original functions / 547 lines now belong to three concrete catalogue modules |
| views.py: 36,626 lines | 36,220 lines (-406 net); original signatures remain as compatibility adapters |
| Richness/dedup/group matching in views | domain/module_selection.py (83 lines): curriculum_item_richness, unique_curriculum_items, module_belongs_to_group |
| Module/placement/outline payloads in views | application/module_projection.py (283 lines): curriculum_module_from_authoring_payload, normalise_programme_config_cohort/group, build_modules, module_rows_with_week_outline |
| Programme module selection and authoring merge in views | application/module_assembly.py (334 lines): programme_authoring_module_rows, programme_authoring_modules, programme_config_modules, enrich_curriculum_modules_with_authoring_details, enrich_modules_with_authoring |

- Original bodies are preserved exactly (AST comparison for all 13); only
  explicit capability parameters and compatibility calls were added. The domain
  deduplicator calls its owned richness function directly. No new repository,
  class hierarchy, empty layer or reverse import to views/Django/infrastructure.
  SQL readers remain at existing boundaries; this batch adds no new SQL reader.
- Canonical/delivery IDs, programme ownership before name fallback, archived
  exclusion, list order, tie handling, zero/empty field precedence, batch read
  options, component omission flags and exception fallback remain unchanged.
  Existing schedule calculations and writer/provider implementations were not edited.
- module_reads_snapshot.json freezes actual pre-task source. Four standalone
  contracts pass. Ten new isolated SimpleTestCase cases compare original/new
  implementations, assert extracted invocation, read-call parity and input
  immutability across synthetic catalogue/placement/config/duplicate/failure cases.
- Validation: 41 standalone PASS; 19 PostgreSQL/ORM/HTTP integration PASS;
  123/124 selected fixtures PASS, 1 FAIL, 0 SKIPPED. Total 183 PASS / 1 FAIL
  across 184 distinct tests; diagnostic replay and retries are not added.
- Existing failure: test_module_builder_latency_no_db.GroupedCatalogueTests.
  test_two_sessions_in_one_week_do_not_become_one_session_after_grouping expects
  deliveryWeeks=7, receives 3. It first asserts full/grouped equivalence, which
  passes. The current unchanged reader uses live week structure (three fixture
  rows), while this fixture expects stored weeks_number=7. The exact pre-task
  module implementations reproduce the same failure; so does the pre-Batch03
  catalogue oracle. Neither this assertion nor the scheduling rule was changed.
- Expanded suite retained: two projection performance contracts, three grouped
  catalogue cases, one visibility case, three outline cases, all 105 previously
  selected fixtures plus the ten new parity cases. No Teams suite selected.
- Intermediate runs exposed delayed cache-warm workers crossing test mock scopes
  (unexpected reads/logging in otherwise standalone fixtures). Test-only runner
  now patches CURRICULUM_WARM_ENABLED=False during synchronous integration/fixture
  execution and asserts no warm loop runs. This does not change production config
  or claim cache-worker coverage. Final run has only the reproduced 3-versus-7
  failure; integration command correctly exits 1 rather than hiding it.
- Executed: python -B backend/phase1f_tests/image/run_import_smoke.py (PASS);
  python -B backend/phase1f_tests/image/run_integration.py (FAIL as above);
  python -B backend/curriculum_api/catalogue/test_module_reads_standalone.py (4),
  test_programme_reads_standalone.py (4), test_programme_identity_standalone.py (8),
  test_programme_builder_standalone.py (4), test_programme_structure_standalone.py (7),
  test_boundary_standalone.py (4), and ../test_ksb_count_compatibility_standalone.py
  (10), all PASS. Syntax and git diff --check PASS.
- Production-scope AST review against the pre-task working copy confirms only the
  13 selected views functions changed; all other symbols/imports/constants are
  identical. New modules import stdlib only, introducing no runtime import cycle.
- Runtime isolation: network-none PostgreSQL, app shares only its loopback namespace;
  no ports, mounts, host credentials or routes; assertions precede initdb/Django.
  Disposable synthetic PostgreSQL and in-memory SQLite only; containers removed.
  No Neon, existing DB, provider, frontend, environment, staging, commit, PR or push.
- Changed files: views.py; the three modules above; module_reads_snapshot.json;
  catalogue/test_module_reads_standalone.py; test_module_read_boundary_no_db.py;
  phase1f_tests/image/run_import_smoke.py, integration.py and this tracker.
- Remaining: agree the existing week-count assertion against the established
  business contract before claiming green acceptance. Common normalizers,
  cohort/group/session builders, authoring transport/cache and mixed endpoints
  remain legacy capabilities. Full endpoint/performance parity and release/CI
  acceptance are not established by this extraction. Existing work preserved.


### Cohort/group delivery read boundary - 2026-11-19

Status: PASS for this extraction and selected regression scope. The preceding
module-read batch's known week-count assertion is resolved; release/CI acceptance
and G01-G05 are not automatically completed.

| Before | After |
| --- | --- |
| views.py owned delivery identity/count rules | domain/delivery_identity.py (63 lines): actual_cohort_identity, actual_group_identity, delivery_learner_count, detail_is_archived |
| views.py assembled normalized cohort/group overview and details | application/delivery_reads.py (334 lines): build_cohorts_and_groups, cohort_authoring_detail_rows, group_authoring_detail_rows, serialize_group_authoring_detail |
| views.py owned active placement count SQL/fallbacks | infrastructure/delivery_counts.py (85 lines): active_learner_delivery_counts |
| views.py 36,220 lines | 35,950 lines (-270 net); nine functions / 374 original lines extracted |

- Existing signatures and the scoped_curriculum_read decorator remain at the
  compatibility boundary. Application calls delivery_learner_count and
  detail_is_archived directly in Domain; infrastructure imports stdlib only.
  Body/SQL AST parity allows only explicit clean_str arguments for those five
  direct domain calls. No reverse dependency or new runtime import cycle.
- Normalized-table ownership, explicit source versus empty-source behavior,
  legacy ignored training_rows, archive handling, group reconstruction, stale
  stored child arrays, id-plus-name count buckets, lifecycle SQL, read order,
  date/tutor projection and exception propagation/fallback are preserved.
  Cohort holiday/calendar serializer and schedule/writer logic remain unchanged.
- Corrected only the stale test assertion in test_module_builder_latency_no_db:
  deliveryWeeks=3 for actual W1/W2/W4, not stored weeks_number=7; retained full
  versus grouped parity and added both-reader sessionsNumber=2 / weeks=3 checks.
  Evidence: module_stored_week_count uses live rows; test_catalogue_reads_no_db
  already pins live rows over stored counts; tests_weeks_sessions_split contains
  authored-row precedence/live count regression cases (inspected, not executed).
  No application week/session calculation was modified.
- New tests: four standalone source/signature/direction contracts; eight isolated
  old/new parity cases covering identity, count partitions, overview flags,
  reconstruction, empty scope, serialized detail reads, SQL variants and failures;
  one real disposable PostgreSQL reader parity case with known active/inactive
  placement rows. Added five existing SharedParentReadTests; no Teams selection.
- First expanded run: new test expected tutor label Ada, but both old and new
  return Ada +1 when a second module says Unassigned. Source inspection confirms
  staff_assignment_key returns an empty key for that token, so the existing
  != 'unassigned' condition retains it. The new characterization expectation now
  pins this existing quirk; no production fix or extra filtering was introduced.
- Final actual results: 45 standalone PASS + 20 PostgreSQL/ORM/HTTP PASS + 137
  fixtures PASS = 202 distinct PASS, 0 FAIL, 0 SKIPPED. Replays/retries excluded.
  Import smoke, in-memory syntax compilation and git diff --check also PASS.
- Commands: python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/catalogue/test_delivery_reads_standalone.py;
  same catalogue directory: test_module_reads_standalone.py,
  test_programme_reads_standalone.py, test_programme_identity_standalone.py,
  test_programme_builder_standalone.py, test_programme_structure_standalone.py,
  test_boundary_standalone.py; plus
  python -B backend/curriculum_api/test_ksb_count_compatibility_standalone.py.
- Production-scope comparison to the pre-task working copy confirms only nine
  selected views functions changed; all other symbols/imports/constants remain
  identical. Prior edits preserved. Network/alias isolation verified before
  disposable PostgreSQL/Django startup; no external routes, mounts, credentials
  or ports. Cache warm worker remains disabled only by the test harness; no
  worker coverage claimed. Containers removed; no Neon/existing DB/provider use.
- Changed files: views.py; three new boundary modules above;
  catalogue/delivery_reads_snapshot.json; catalogue/test_delivery_reads_standalone.py;
  test_delivery_read_boundary_no_db.py; test_module_builder_latency_no_db.py;
  phase1f_tests/image/run_import_smoke.py, integration.py and this tracker.
  No frontend/environment changes, staging, commit, PR, push, branch change or deploy.
- Remaining: generic authoring transport/cache, calendar/session responsibilities
  and mixed endpoints still carry legacy dependencies. Tutor placeholder labeling
  is a separate behavioral issue. No full endpoint/performance/release equivalence
  claim; subsequent batches must retain the current SQL and writer boundaries.


### Authoring catalogue read assembly - 2026-11-19

Status: PASS for the selected boundary and regression scope. G01-G05 and release
acceptance remain unchanged; no full legacy elimination claim.

| Before | After |
| --- | --- |
| views.py owned normalized-to-training/catalogue adaptation | application/authoring_rows.py (151 lines): authoring_modules_as_training_rows, authoring_modules_as_catalogue_rows |
| views.py owned full/compact/count-only summaries and catalogue item projection | application/authoring_summaries.py (373 lines): authoring_catalogue_summaries, authoring_summary_catalogue_item |
| catalogue_summary_reads.py owned grouped component/mapping SQL with views references | infrastructure/grouped_content.py (51 lines): grouped_catalogue_content_rows; old module retains compatible composition adapter |
| views.py 35,950 lines; catalogue_summary_reads.py 39 | 35,623 and 19 respectively; net 347 legacy lines removed |

- Five functions / 459 original source lines extracted. Compatibility signatures
  and exports retained; no new classes, repositories, domain placeholders or
  speculative abstractions. Additional explicit parameters/adapters mean this
  is not a claim of net project line-count reduction.
- Full content, list_only and include_content=False paths retain original fields,
  exception boundaries, normalized KSB projection, raw-key dedup, per-component
  minute rounding, multiplicity, ordering, archive filtering, module/week/session
  distinctions, coach enrichment and prefetch/cache read keys. SQL/params remain
  identical. No schedule, writer, cache implementation or provider logic changed.
- Application receives only pricing lookup/payload callbacks, not a pricing
  module with save capabilities. Database vendor access remains lazy at the
  original branch condition. The grouped reader import stays lazy at its original
  call point, so grouped failures still enter the original exception fallback.
  The metadata-only delivery projection callback remains unchanged.
- New authoring_reads_snapshot.json freezes actual original source. Four standalone
  tests restore only explicit capability references/local import relocation before
  AST comparison; also check signatures, wiring and stdlib-only new imports.
  No new runtime import cycle; existing compatibility dependencies remain.
- Eight isolated parity tests cover actual original/new implementations: all
  summary modes and SQL sequence over synthetic SQLite fixtures, grouped KSB SQL,
  parent precedence/placement exclusion, prefetch flags, week ordering/dedup,
  summary-item contract, read failures versus propagated pricing errors, and
  read-only pricing callback order. Added three existing SharedWeekIndexTests.
- Added real disposable PostgreSQL original/new summary parity for full, compact
  and counts-only modes; asserts normalized KSB counts and actual invocation of
  the extracted grouped reader. Existing membership/writer parity suites retained.
- Final actual results: 49 standalone PASS + 21 PostgreSQL/ORM/HTTP PASS + 148
  fixtures PASS = 218 distinct PASS; 0 FAIL, 0 SKIPPED. Import smoke, syntax and
  git diff --check PASS. Tests passed on the first run for this batch.
- Commands: python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/catalogue/test_authoring_reads_standalone.py;
  same catalogue directory: test_delivery_reads_standalone.py,
  test_module_reads_standalone.py, test_programme_reads_standalone.py,
  test_programme_identity_standalone.py, test_programme_builder_standalone.py,
  test_programme_structure_standalone.py, test_boundary_standalone.py; plus
  python -B backend/curriculum_api/test_ksb_count_compatibility_standalone.py.
- Scope audit versus pre-task working sources: only four views functions and the
  grouped reader changed; every other function/class/import/constant is identical.
  Isolated Docker network/alias checks preceded initdb/Django; no host mounts,
  credentials, published ports or external routes. Synthetic PostgreSQL and
  in-memory SQLite only; containers removed. Cache-warm worker remains disabled
  only in the test process; no worker/performance coverage claimed.
- Files changed: views.py, catalogue_summary_reads.py, three new modules above,
  catalogue/authoring_reads_snapshot.json, catalogue/test_authoring_reads_standalone.py,
  test_authoring_read_boundary_no_db.py, phase1f_tests/image/run_import_smoke.py,
  integration.py and this tracker. Existing changes preserved on Architecture.
  No frontend/environment changes, Neon, existing DB, Teams/provider calls,
  staging, commit, PR, push, merge or deployment.
- Remaining: single/batched module structure payload builders, generic authoring
  transport/schema compatibility, cache and mixed endpoints remain legacy.
  Existing tutor-placeholder behavior is unchanged. Full endpoint, performance,
  CI and release acceptance are separate from the verified extraction scope.


### Single/batched module structure and component readers - 2026-11-19

Status: PASS for this extraction and selected regressions. No change to G01-G05,
release acceptance or approval for existing databases/providers.

| Before | After |
| --- | --- |
| views.py assembled single and batched authored structures (527 lines) | application/structure_payloads.py owns both actual implementations (641 lines including explicit capability parameters) |
| views.py owned component paging and PostgreSQL content omission (162 lines) | infrastructure/component_reads.py owns three actual readers (196 lines) |
| views.py 35,623 lines | 35,110 lines; net 513 legacy lines removed |

- Five functions / 689 original lines extracted. Legacy exports, exact public
  signatures, with_course_storage and scoped_curriculum_read remain in place.
  Existing cache keys, SQL, ordering, dedup, source-row reuse, archive selection,
  component settings, rounding, KSB counts, pricing and error boundaries retained.
  Single and batch differences remain intentional; no claim they are interchangeable.
- Application imports only collections.defaultdict; infrastructure has no imports.
  Neither imports views, Django, settings or providers. Existing outer adapters
  supply explicit callbacks; pricing/archive access is narrowed to used operations.
  Lazy calendar imports remain lazy in the compatibility wrapper. Existing schema
  guards and calendar/delivery implementations remain outside the extracted bodies;
  their implementations and provisioning/writer behavior are unchanged. No new
  runtime cycle or empty domain package. This is not net project line reduction.
- structure_reads_snapshot.json freezes exact original working-copy source,
  SHA256 a9059023cdb271784946963dd64d2df9add8d3fdb18e362a437615a3d9c09d65.
  Four standalone contracts compare actual bodies (restoring only explicit
  dependency references), signatures, decorators, wiring and dependency direction.
- Eleven new isolated parity tests compare actual original/new implementations,
  values, input immutability and read sequence: full option matrix, shared parents,
  projected columns, missing/empty targets, archive-copy filtering, training-source
  display fallback, calendar-error boundaries, propagated read/pricing failures,
  paged SQL/dedup, content SQL/parameter/order parity and unsupported-vendor fallback.
- One new real PostgreSQL case verifies single and lean-batch assembly, actual
  boundary invocation, paged reads and both content-omission modes against synthetic
  rows. Existing module structure revision/fingerprint (3), paging (3), and plain
  content SQL (1) checks added. Calendar/delivery integration ports are stubbed;
  no Teams test suite or provider validation was run or claimed.
- Initial expanded run failed on two missing test-environment dependencies:
  module_merge was absent from the static Docker bundle; normalized module_details
  was absent from the disposable schema. Both failed with the original code too.
  Added the inspected stdlib-only module to the bundle and an explicit synthetic
  module_details fixture table. No application workaround or assertion weakening.
- Final actual results: 53 standalone PASS + 22 PostgreSQL/ORM/HTTP PASS + 166
  fixture tests PASS = 241 distinct PASS, 0 FAIL, 0 SKIPPED. Oracle replays and
  retries excluded. Import smoke, syntax and git diff --check PASS.
- Commands: python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/catalogue/test_structure_reads_standalone.py;
  same catalogue directory: test_authoring_reads_standalone.py,
  test_delivery_reads_standalone.py, test_module_reads_standalone.py,
  test_programme_reads_standalone.py, test_programme_identity_standalone.py,
  test_programme_builder_standalone.py, test_programme_structure_standalone.py,
  test_boundary_standalone.py; plus
  python -B backend/curriculum_api/test_ksb_count_compatibility_standalone.py.
- Scope comparison to the pre-task working copy confirms only five selected views
  functions changed; all other functions/classes/imports/constants remain identical.
  Original source snapshot matches that copy. Existing work preserved on Architecture.
  Docker isolation verified before initdb/Django; all six aliases remain disposable,
  no host mounts/credentials/published ports/external routes. Containers removed.
  Cache warming remains disabled only in the harness; no worker coverage claimed.
- Files: views.py; catalogue/application/structure_payloads.py;
  catalogue/infrastructure/component_reads.py; catalogue/structure_reads_snapshot.json;
  catalogue/test_structure_reads_standalone.py; test_structure_read_boundary_no_db.py;
  phase1f_tests/image/run_import_smoke.py, import_smoke.py, integration.py and this tracker.
  No frontend/environment changes, Neon/existing DB access, provider operations,
  staging, commit, PR, push, merge, branch switch or deployment.
- Remaining: generic authoring transport/schema compatibility, calendar/session
  implementations, native free-course storage integration and mixed endpoints are
  not fully verified or eliminated by this batch. Full HTTP, performance and release
  equivalence are not implied. Next coherent extraction: component/library catalogue
  reads and response construction (component_builder_response, component_builder_rows,
  _component_builder_rows, library_component_rows and their read-only projections),
  retaining existing writer and provider boundaries.


### Component/library catalogue and misleading read fallbacks - 2026-11-19

Status: PASS for this batch. The user additionally authorized removing misleading
legacy/fallback behavior while continuing the architecture work. G01-G05 and
release acceptance remain unchanged.

| Before | After |
| --- | --- |
| views.py owned component responses, labels, sorting and partial projections | application/component_projection.py, 155 lines |
| views.py orchestrated full/trimmed/programme component reads, summaries and reuse library | application/component_catalogue.py, 297 lines |
| library SQL, filters and parent lookup mixed into views | infrastructure/library_reads.py, 132 lines; programme filter precedes LIMIT/OFFSET |
| views.py 35,110 lines | 34,851 lines; 259 legacy lines removed |

- Eleven original functions / 436 lines extracted with actual implementation,
  compatible legacy signatures and explicit read capabilities. No new classes,
  generic repositories or empty domain packages. New production modules import
  only collections.defaultdict (application); no reverse imports into views,
  Django, settings, providers or infrastructure. No new runtime import cycles.
  Parameter/wrapper overhead means this is not net project line reduction.
- Authorized behavioral corrections, demonstrated against frozen original code:
  1. Missing/archived/unlabelled week no longer becomes invented Week 1. Builder
     and summary keep weekId, with empty week/weekTitle when no label is known.
  2. Programme filtering previously happened after pagination, yielding false
     empty/incomplete pages. SQL now filters before the same bounded page window;
     stored IDs preserve Python str.strip() whitespace semantics and parameters
     remain bound. Actual PostgreSQL and SQLite regression cases pass.
  3. Library detail previously selected raw normalized ksb_mappings rows, lacking
     KSB code/description and silently dropping mappings. Parent lookup now uses
     the existing ksb_mapping_placement.read_source projection; other tables keep
     their physical source. Normalized detail returns the existing KSB data.
  4. A nonempty, entirely invalid origin filter no longer falls back to all
     origins. It matches nothing; absent filter still means all, mixed valid and
     invalid values retain the valid subset.
  5. Missing parent/mapping table no longer pretends the parent/mappings are
     empty. Query failure propagates to existing HTTP 500 mapping. Missing rows
     inside a valid table and empty ID sets retain their existing behavior.
- Correct full-read fallback for unavailable optimized projection is retained,
  including content-omission markers and partial-save guards. Existing writer,
  scheduling, provider, cache/authentication implementations and URLs untouched.
  Library list intentionally remains a lightweight picker, not complete detail.
- component_catalogue_snapshot.json freezes exact pre-task original source.
  Four standalone contracts allow only reviewed corrections plus dependency
  wiring/extraction; the SQL page body is otherwise identical. Fourteen new
  isolated tests cover actual old/new implementations, SQL sequencing, unknown
  week/parent cases, programme paging and whitespace, normalized KSB projection,
  unknown filters, partial markers, immutable cached rows and HTTP failure/paging.
- Two real disposable PostgreSQL cases cover component/full/trimmed/summary parity,
  missing-week correction, programme pagination and normalized KSB detail. Selected
  existing summary/projection/HTTP and KSB tests added; no Teams suite selected.
- First expanded run: 24 PostgreSQL tests passed; one existing summary fixture
  assumed two component queries while allowing conditional KSB SQL to join its
  mocked results (three queries). It failed under original implementations too.
  Isolated that unrelated fixture dependency explicitly; retained its two-query
  assertion and ran all four dedicated ComponentSummaryKsbCodesTests. Updated the
  old Week 1 assertion only for the explicitly authorized behavior correction.
- Final actual results: 57 standalone PASS + 24 PostgreSQL/ORM/HTTP PASS + 204
  fixtures PASS = 285 distinct PASS, 0 FAIL, 0 SKIPPED. Replays/retries excluded.
  Import smoke, syntax, new-file whitespace and git diff --check PASS.
- Commands: python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/catalogue/test_component_catalogue_standalone.py;
  same catalogue directory: test_structure_reads_standalone.py,
  test_authoring_reads_standalone.py, test_delivery_reads_standalone.py,
  test_module_reads_standalone.py, test_programme_reads_standalone.py,
  test_programme_identity_standalone.py, test_programme_builder_standalone.py,
  test_programme_structure_standalone.py, test_boundary_standalone.py; plus
  python -B backend/curriculum_api/test_ksb_count_compatibility_standalone.py.
- Scope audit against pre-task working copy: only 11 selected views functions
  changed; all other source symbols/imports/constants identical. Current branch
  Architecture; prior work preserved; index empty. Docker isolation proved before
  initdb/Django, all six aliases disposable, no host mounts/credentials/ports or
  external routes. Synthetic PostgreSQL/SQLite only; containers removed. Existing
  test-only cache-warm guard retained; no worker coverage claimed.
- Files: views.py; three production modules above;
  catalogue/component_catalogue_snapshot.json;
  catalogue/test_component_catalogue_standalone.py;
  test_component_catalogue_boundary_no_db.py; test_component_summary_no_db.py;
  phase1f_tests/image/run_import_smoke.py, import_smoke.py, integration.py and tracker.
  No frontend/environment changes, Neon/existing DB access, provider operations,
  staging, commit, PR, push, merge, branch switch or deployment.
- Remaining: summary SQL and generic authoring read transport/schema compatibility
  still reside in legacy adapters; native free-course storage and full frontend
  display paths are not newly certified here. No production performance or full
  endpoint/release equivalence claim. Next cohesive work: component summary SQL
  and authoring read adapters, preserving writer and provider boundaries and only
  removing additional fallback behavior when its incorrect result is demonstrated.

### Authoring read adapters and component summary SQL - 2026-11-19

- Status: PASS for this bounded batch; no automatic G01-G05/release clearance.
- Extracted 11 actual functions (341 original implementation lines): views.py
  34,851 -> 34,622 lines (229 removed). Public signatures, scope decorators,
  memo keys, parameters, ordering, completion and error propagation preserved.
- Infrastructure now owns authoring_sql.py (SELECT construction, authoritative
  placement names, normalized KSB projection), authoring_reads.py (execution,
  completion, ID reads, request-scope prefetch) and component_summary_reads.py
  (grouped component/JSON-string reads and normalized KSB summary SQL).
  Domain/component_summary.py owns publication and Math.round-style decisions
  over plain values. No new interface hierarchy or empty packages.
- Existing schema guard remains in the outer compatibility adapter; pure SQL
  construction cannot provision schema. Legacy composition callbacks remain;
  this is not complete removal of views.py or all shared read transport.
- Preserved valid fallback: failed/incomplete batching leaves calls to read
  individually, with logging; ordinary read errors still propagate. No newly
  proven misleading fallback was removed in this batch. Raw-cursor JSON strings
  retain the existing single-parse/draft behavior, confirmed against old source
  and the full component read; deeper decoding is not silently introduced.
- Validation: 63 standalone + 26 isolated PostgreSQL/ORM/HTTP + 235 selected
  fixtures = 324 distinct PASS, 0 FAIL, 0 SKIPPED on the final runs. Existing
  membership/assignment transaction checks retained; no Teams suites selected.
  SQL/body/signature comparison uses actual pre-task source snapshot. Real PG
  covers grouped and string JSON, publication/minutes/KSB counts, plus five
  direct/prefetched reads (modules, mappings, weeks, groups, cohorts), normalized
  descriptions, current production ordering and exact memo-key hits.
- Test-only fixture adjustments: complete AST namespace for extracted wrappers;
  align SQLite columns with its mocked schema and test derived-name ordering
  there, while production vendor-specific ordering runs on real PG. The initial
  JSON publication expectation was corrected to observed old/full-read behavior;
  synthetic mappings specify their source to avoid unrelated standards inference.
  Initial failures/replays are not counted as additional passing tests.
- Commands: python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/catalogue/test_read_adapters_standalone.py;
  the eleven prior standalone scripts listed in the preceding batch; git diff --check.
  Import smoke and syntax PASS. New modules import stdlib only, no new cycles.
- Scope audit: every other views symbol/import/constant unchanged against the
  pre-task working copy. Architecture branch retained; index empty. Isolation
  proved before initdb/Django; six aliases on disposable loopback-only PG,
  synthetic SQLite only, no host credentials/mounts/ports/external routes.
  Containers removed. Existing test-only cache-warm guard retained.
- Files: views.py; four modules above; read_adapters_snapshot.json;
  test_read_adapters_standalone.py; test_read_adapters_boundary_no_db.py;
  test_unified_reader_no_db.py; test_authoring_placement_names_no_db.py;
  phase1f_tests/image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
  No writer implementation, frontend, environment, Neon, provider, Git publication
  or deployment changes. Full production HTTP/performance equivalence unclaimed.
- Next coherent batch: compact authoring transport and verified row-cache readers
  (authoring_read_transport.py / authoring_row_cache.py), with lossless read and
  normalized KSB parity; keep writer/provider behavior outside the extraction.

### Compact authoring transport and verified row snapshots - 2026-11-19

- Status: PASS for this bounded read batch; no automatic gate/release approval.
- Moved seven existing functions into catalogue/infrastructure/authoring_transport.py
  (projection selection, lossless SQL decoding, fingerprints and verified reads)
  and authoring_row_snapshots.py (keying, compressed local storage, TTL/LRU bounds).
  Legacy authoring_read_transport.py: 65 -> 43 lines; authoring_row_cache.py:
  146 -> 23 lines (211 -> 66 combined, 145 removed). views.py is byte-identical
  to the pre-task working copy. Public function signatures remain compatible.
- Targeted module import cycle authoring_read_transport <-> authoring_row_cache:
  1 -> 0, with no replacement among the four affected modules. New infrastructure
  imports only stdlib and its snapshot owner, never views/Django/settings/providers.
  Existing schema guard and source routing stay at the compatibility boundary.
- Confirmed compatibility defect with actual pre-task source in disposable PG:
  compact normalized KSB read raises SQLSTATE 42703 because its selected placement,
  code and description are not physical mapping columns. All three SQL paths
  (content, ordered digest, changed-row headers) now resolve the same existing
  component/standard projection when the resolved source is the physical table.
  Learning/native free-course sources remain routed as before; no schema changes.
- Real PG regressions prove cold/warm reads, lossless raw values/types, changed
  content/order/deletion, no content re-fetch on unchanged digest, and updates to
  joined standard descriptions/component ownership. The old KSB failure caused
  module_structure_revision to return ''; the corrected read produces a revision
  for the same fixture. No writer/guard algorithm was modified.
- Preserved verified fallback: one fresh read on a detected snapshot race;
  database errors are never answered with stale cached rows. Existing bounds,
  independent mutable values and native types preserved. Private snapshot tests
  now target their new owner; all original test assertions retained.
- Validation: 69 standalone + 28 isolated PG/ORM/HTTP + 249 selected fixtures =
  346 distinct PASS, 0 FAIL, 0 SKIPPED. Source snapshot comparisons, import smoke,
  syntax, targeted cycle analysis and git diff --check PASS. No Teams suites.
  Commands: python -B backend/curriculum_api/catalogue/test_transport_standalone.py;
  the twelve prior standalone scripts; python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
- Files: the two legacy adapters and two infrastructure owners above;
  catalogue/transport_snapshot.json, test_transport_standalone.py;
  test_transport_boundary_no_db.py, test_authoring_row_cache_no_db.py;
  phase1f_tests/image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
- Isolation proved before initdb/Django: disposable loopback-only PostgreSQL,
  six aliases isolated, no host mounts/credentials/ports/external routes. Test
  containers removed. Architecture branch/index and unrelated work preserved.
  No Neon/existing DB, frontend, writer implementation, environment, provider,
  Teams, Git publication or deployment changes. No performance improvement claim.
- Remaining: full native free-course storage runtime is not newly certified.
  module_structure_revision still returns '' on other read errors, disabling its
  optional conflict check; this existing writer-facing fallback needs a separate
  save-protection scope, not silent change during read extraction. Next coherent
  read batch: structure/revision source orchestration and fingerprint composition,
  preserving current save callers and making that remaining failure path explicit.


### Structure/revision read boundary ? 2026-11-19 ? PASS (bounded scope)

- Before: five structure/revision functions combined six source reads, revision
  material, payload ordering and item-fingerprint composition in views.py.
- After: catalogue/application/structure_revisions.py owns revision orchestration,
  revision-before-payload sequencing and item-fingerprint composition;
  infrastructure/structure_sources.py owns the six scoped compact reads;
  domain/structure_revision.py owns stored-column/timestamp projection, ordering
  and deterministic digest. Existing module_merge fingerprint algorithm unchanged.
- Legacy signatures, with_course_storage decorators, routing, read parameters,
  read order/reuse flags, active/retired filtering and save callers preserved.
  views.py: 34,622 -> 34,518 lines (104 removed). No unrelated production AST
  nodes changed. New owners import only domain/stdlib; no back-import to views,
  Django or providers; new-owner dependency cycles: 0. No global-cycle claim.
- Actual pre-task source frozen in catalogue/revisions_snapshot.json; tests run
  the original bodies and compare results/read events with the invoked new owners.
  Shared source rows remain the same bundle for payload/revision. This is not a
  guarantee of a single transactional snapshot across the six database reads.
- Final validation: 81 standalone + 30 isolated PG/ORM/HTTP + 258 selected fixtures
  = 369 distinct PASS, 0 FAIL, 0 SKIPPED. Includes actual PostgreSQL fresh/shared
  revision equality, normalized KSB projection, external content/timestamp edits,
  complete structure/item-fingerprint parity, missing/error states, and existing
  membership/catalogue regression coverage. No new endpoint-wide parity claim.
- First fixture run: one new assertion failed because its synthetic archived row
  used status='deleted'. Old/new results matched. Corrected the fixture to actual
  inactive/archived semantics, added legacy deletion/retired-type coverage, and
  reran: 30 + 258 PASS. Production status rules were not changed.
- Commands: python -B backend/curriculum_api/catalogue/test_revisions_standalone.py;
  python -B backend/curriculum_api/tests_structure_revision_no_db.py; the thirteen
  prior standalone scripts; python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Syntax, exact source comparison, import smoke and scoped dependency checks PASS.
- Files: views.py; the three new owners above; catalogue/revisions_snapshot.json,
  test_revisions_standalone.py; test_revision_boundary_no_db.py;
  tests_structure_revision_no_db.py (standalone import setup only);
  phase1f_tests/image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
- Isolation verified before initdb/Django: loopback-only disposable PostgreSQL,
  six isolated aliases, no host mounts/credentials/ports/external routes. Containers
  removed. No Neon/existing DB, frontend, writer implementation, Teams tests,
  provider operations, environment edits, Git publication or deployment.
- Remaining: revision read errors still return '' to existing save callers;
  read payloads continue to stamp 'unverified'. Metadata-read failures still use
  all nonvolatile columns. Both compatibility paths are explicitly characterized,
  not silently redefined here; stricter save failure behavior remains a separate
  save-protection scope. No G01-G05 or release gate automatically closed.
- Next cohesive read batch: record revisions and conflict-response assembly for
  programme/cohort/group/week-template, preserving locks and save decisions.


### Record revisions and conflict read boundary ? 2026-11-19 ? PASS (bounded scope)

- Moved 11 responsibilities from views.py: record_revision; programme/cohort/
  group/week-template/module revision readers; revision dispatch and bulk read;
  programme/cohort/group conflict-record builders. views.py: 34,518 -> 34,408
  lines (110 removed). Legacy exports, decorators and dispatch registration kept.
- Application: catalogue/application/record_revisions.py owns five record-kind
  scopes, identifier resolution and bulk ordering/deduplication;
  application/conflict_records.py owns drawer fields and cohort JSON decoding.
  Infrastructure: infrastructure/record_revisions.py owns exact scoped row reads,
  ensure_tables=False and volatile-column exclusion. Reuses existing pure
  domain/structure_revision.revision_digest; no additional domain/interface layer.
- HTTP method restrictions, JsonResponse/409 encoding, requested-token precedence,
  name-only write classification, locks, save decisions and all writer bodies
  remain unchanged. Empty primary row vs empty children, unreadable revisions,
  unresolved module identifiers and source ordering preserve original semantics.
- Actual original functions frozen in catalogue/record_revisions_snapshot.json.
  Old-run dispatch references restored as well as function bodies; new-owner
  invocation verified. All other views.py AST statements are identical to the
  pre-task source. New owners have no framework/legacy imports; scoped cycles 0.
- Validation: 93 standalone + 34 isolated PG/ORM/HTTP + 269 selected fixtures =
  396 distinct PASS, 0 FAIL, 0 SKIPPED. New cases verify entity scope, actual SQL
  revision equality, timestamps, template child changes/unrelated templates,
  revision GET deduplication/order/405, actual snapshot GETs and 409 payloads.
  Existing membership/catalogue suites also pass. No new lock-race claim.
- Commands: python -B backend/curriculum_api/catalogue/test_record_revisions_standalone.py;
  the prior fifteen standalone scripts plus test_record_snapshot_no_db.py;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Syntax, immutable-source comparison, import smoke and dependency checks PASS.
- Files: views.py; the three owners above; catalogue/record_revisions_snapshot.json,
  test_record_revisions_standalone.py; test_record_revision_boundary_no_db.py;
  phase1f_tests/image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
  Representative week-template fixture tables added only inside disposable PG;
  no production schema, migration, settings or dependency-manifest changes.
- Runtime isolation proved before initdb/Django: loopback-only disposable PG,
  six isolated aliases, no host mounts/credentials/ports/external routes. All test
  containers removed. Architecture branch/index and unrelated work preserved.
  No Neon/existing DB, Teams suites, provider calls, frontend, commits/PRs or deployment.
- Remaining: existing unreadable-token/unguarded-client behavior is characterized,
  not redesigned. Native free-course runtime and concurrent save races are not
  newly certified. Save-protection behavior changes remain a separate scope;
  G01-G05/release acceptance not automatically closed.
- Next cohesive batch: Week Template read queries, payloads and response assembly
  (get_week_template_rows/get_week_template_component_rows/week_template_payload/
  week_template_record), keeping provisioning and component writers untouched.


### Week Template read boundary ? 2026-11-19 ? PASS (bounded scope)

- Before: template/component SQL, archive filtering, list selection, JSON/numeric
  projection and revision sequencing lived in views.py. After: six functions and
  collection GET orchestration moved into catalogue/application/week_templates.py
  and infrastructure/week_templates.py. views.py: 34,408 -> 34,337 (71 removed).
- Infrastructure owns get_week_template_rows/get_week_template_row and component
  reads with exact WHERE parameters, ordering, schema guard and include_deleted
  semantics. Application owns component/header payloads, template record sequencing
  and list filters/search. HTTP adapters, URLs and response encoding stay put.
- No new Domain package or interface layer: existing numeric/coach/archive rules
  remain authoritative. Reflection column precedence and settings reflectionPrompt
  compatibility preserved: the current writer still stores both. Stored totals
  are preserved, not silently recomputed from the returned component list.
- Exact AST checks confirm provisioning, numeric/scope/metrics helpers, component
  writer, entire detail GET/PATCH/DELETE handler and response adapter unchanged;
  collection POST statements unchanged. Only its GET body is extracted.
- Frozen actual source: catalogue/week_templates_snapshot.json. Original/new
  functions compared with actual helpers, SQL call events and isolated PostgreSQL.
  New owners are invoked by real GETs and have no imports/back-edges/framework
  dependencies. Scoped new-owner import cycles: 0; no global-cycle claim.
- Validation: 97 standalone + 38 isolated PG/ORM/HTTP + 280 selected fixtures =
  415 distinct PASS, 0 FAIL, 0 SKIPPED. Covers paid/free filters, search, archive
  visibility/include_deleted, ordering, JSON/null/native values, reflection and
  coach defaults, stored totals, read/after_write order, unverified/missing states,
  real list/detail GET parity, 404/405, and revision changes after synthetic edits.
  Existing membership/catalogue regressions PASS. No new writer/race certification.
- Commands: python -B backend/curriculum_api/catalogue/test_week_templates_standalone.py;
  the seventeen prior standalone scripts; python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Source/syntax/whitespace, import smoke and dependency checks PASS.
- Files: views.py; the two new owners above; catalogue/week_templates_snapshot.json,
  test_week_templates_standalone.py; test_week_template_read_boundary_no_db.py;
  phase1f_tests/image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
  Read-contract columns added only to disposable fixture tables, not application
  schema/migrations. Runtime provisioning is disabled and was not invoked.
- Isolation proved before initdb/Django: loopback-only disposable PG, six isolated
  aliases, no host mounts/credentials/ports/external routes. Containers removed.
  Architecture branch/index and unrelated changes preserved. No Neon/existing DB,
  frontend/provider/Teams operations, environment edits, commit/PR or deployment.
- Remaining: preserve existing optional revision/error behavior pending the
  separate save-protection scope. Real concurrent saves and full native free-course
  runtime are not newly certified. G01-G05/release gates remain independently open.
- Next cohesive read batch: Cohort/Group row readers and API payload projections
  (fetch_cohort_row/fetch_group_row/curriculum_cohort_from_authoring_detail/
  curriculum_group_from_authoring_detail), preserving date and delivery semantics.


### Cohort/Group record read boundary ? PASS (2026-11-19)
- Old -> new: six complete functions moved from views.py into concrete
  catalogue/infrastructure/placement_records.py (canonical row readers) and
  catalogue/application/placement_records.py (identifier/name resolution and
  Cohort/Group drawer payloads). Public signatures remain as compatibility
  exports. views.py: 34,337 -> 34,241 lines (-96); new owners: 27 / 178 lines.
- Preserved canonical-first and alias-before-name lookup, query parameters/read
  order, live-before-archived names, first cohort match, ambiguous-group refusal,
  date/override/key precedence, coach deduplication, delivery-field priority,
  schedule compatibility, empty/error states, snapshot and conflict contracts.
  No Domain folder, repository/interface hierarchy or HTTP abstraction added.
  Coach splitting is a narrow callable, not an infrastructure-module dependency.
- Validation: 438 distinct tests PASS / 0 FAIL / 0 SKIPPED: 101 standalone,
  43 disposable PostgreSQL/ORM/HTTP, 294 selected fixture tests. New coverage:
  4 exact-source/import checks, 14 fixture parity tests, 5 PostgreSQL/HTTP tests.
  Original-source oracle + new-owner spies verify extraction is actually invoked.
  Prior membership, catalogue, revisions and week-template regressions PASS.
- Commands: python -B backend/curriculum_api/catalogue/test_placement_records_standalone.py;
  the eighteen prior standalone scripts; python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Syntax, exact original-source snapshots, wrapper bindings and import smoke PASS.
  All views AST nodes outside the six functions unchanged, including writers,
  date rules, HTTP/auth handlers and provisioning. New owners: 0 imports/cycles;
  this is not a claim that the entire legacy backend has no cycles.
- Initial run: 1 new test assertion failed (expected list for a stored JSONB
  module_ids column). Both original and extracted responses returned JSON text.
  Corrected the new assertion to verify that existing type/order explicitly;
  native list and raw JSON text both covered. No production fix/test weakening.
  Final complete isolated run: 43 + 294 PASS. Historical KSB oracle SQL errors
  are expected pre-fix evidence and do not represent current-query failures.
- Existing discrepancy recorded, unchanged: parse_epa_months documents zero as
  same-day completion, but calculate_apprenticeship_end_date returns None for
  zero; the API currently exposes an empty apprenticeshipEndDate. Cases now
  preserve this actual behavior. Changing that rule needs its own bug-fix scope.
- Files: views.py; the two owners above; catalogue/placement_records_snapshot.json,
  catalogue/test_placement_records_standalone.py; test_placement_record_boundary_no_db.py;
  phase1f_tests/image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
- Isolation verified before initdb/Django: loopback-only disposable PG, all six
  aliases isolated, no host mounts/credentials/ports/external routes; containers
  removed. Representative fixture columns only, no application schema changes.
  Architecture branch/index and unrelated changes preserved. No Neon/existing DB,
  frontend/provider/Teams operations, environment edits, commit/PR or deployment.
- Limits: retained valid compatibility paths; no fabricated empty read fallback
  added. No new cohort/group writer, concurrent-save, live-calendar or complete
  production-schema certification. G01-G05/release gates remain independently open.
- Next cohesive read batch: cohort detail serialization and holiday/calendar
  read assembly (serialize_cohort_authoring_detail and its read-only consumers),
  keeping provider access behind existing callbacks and using synthetic fixtures.


### Cohort details and holiday read boundary ? PASS (2026-11-19)
- Old -> new: 12 complete functions extracted from views.py into concrete
  catalogue/application/cohort_calendar.py (249 lines: cohort/feed/holiday
  projections and exclusion summary), domain/holiday_selection.py (78 lines:
  source/archive/period rules), infrastructure/holiday_reads.py (63 lines:
  normalized and separate-table readers). views.py: 34,241 -> 34,054 (-187).
- Public signatures, scope memo key/decorator, query order, canonical holiday
  ids, archived/withdrawn distinctions, field types, inclusive ranges, duplicate
  behavior, exclusions, EPA/override dates and supplied-empty-calendar semantics
  preserved. Country reads retain their lazy adapter and CalendarUnavailable
  message; no fallback from an unavailable country calendar to England.
- 467 distinct tests PASS / 0 FAIL / 0 SKIPPED, first run: 105 standalone,
  49 isolated PostgreSQL/ORM/HTTP, 313 selected fixtures. New: 4 source/import
  contracts, 17 original/new fixture parity cases, 6 PostgreSQL/HTTP cases;
  2 existing HolidayReadScopeTests added. Previous membership/catalogue,
  placement, revisions and week-template checks remain green.
- Commands: python -B backend/curriculum_api/catalogue/test_cohort_calendar_standalone.py;
  nineteen prior standalone scripts; python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Frozen pre-edit source + owner spies verify actual extraction. Syntax,
  adapter bindings, lazy policy exception handling, import smoke and diff PASS.
  All non-target views AST nodes unchanged (writers, schedulers, HTTP/auth,
  provisioning included). Three new owners: 0 imports / 0 import cycles.
- Isolated real SQL covers normalized and explicitly named legacy fixture tables,
  cohort rows and shared single-calendar read, saved foreign calendars (valid,
  missing, expired), holiday GET visibility/serialization/405, and memo refresh
  after synthetic edits. Provider/sync methods blocked or stubbed; GET refresh
  notification mocked. No claim about live refresh or Teams behavior.
- Files: views.py; the three owners above; catalogue/cohort_calendar_snapshot.json,
  catalogue/test_cohort_calendar_standalone.py; test_cohort_calendar_boundary_no_db.py;
  phase1f_tests/image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
- Runtime isolation verified before initdb/Django: six disposable aliases,
  loopback only, no host mounts/credentials/ports/external routes; containers
  removed. Fixture schemas only. Existing work/index/Architecture branch preserved.
  No Neon, existing DB, provider calls, Teams suites, env edits, commit/PR or deploy.
- Remaining: existing get_holiday_rows_safe and cohort-list error-to-empty behavior
  remains shared with save/scheduling consumers. This extraction does not certify
  those failures as an accurate empty calendar; correcting them needs coordinated
  caller/error-contract coverage, not silent changes to writers. G01-G05/release
  gates remain independently open; no full schema, endpoint or save certification.
- Next: inherited holiday reads for modules (cohort_selected_holidays_by_id,
  cohort_selected_holidays_by_cohort and module wrappers), including explicit
  review of the remaining error-to-empty paths; preserve scheduling/write rules.


### Inherited module calendar read boundary - PASS (2026-11-19)
- Old -> new: five complete functions moved from views.py into
  catalogue/application/inherited_calendar.py (197 lines): scheduling_holidays_from,
  cohort_selected_holidays_by_id, cohort_selected_holidays_by_cohort,
  module_cohort_selected_holidays and module_schedule_holidays.
  views.py: 34,054 -> 33,949 (-105). Existing SQL readers reused; no empty
  domain/infrastructure layer, new repository or duplicated business policy.
- Preserved: open-ended holiday selection, spanning dates, Unicode exclusions,
  duplicate/order semantics, ignored stale holiday_ids/selected_holidays,
  normalized bulk cohort ids, ensure_tables=False, one calendar read per batch,
  preview-list priority and object identity, caller-owned cache semantics.
  Lazy country reads retain both contracts: overview mutates calendarError on
  CalendarUnavailable (including empty messages); bulk/module reads propagate it.
- Final 521 distinct PASS / 0 FAIL / 0 SKIPPED: 109 standalone,
  53 isolated PostgreSQL/ORM/HTTP, 359 selected fixture tests. New: 4 source/import
  contracts, 16 frozen-original parity cases, 4 PostgreSQL cases; 30 existing
  tests_holiday_reading_weeks cases added after inspecting their pure planner
  closure (no Teams tests/operations). Existing membership/catalogue checks PASS.
- Commands: python -B backend/curriculum_api/catalogue/test_inherited_calendar_standalone.py;
  the twenty previously selected standalone scripts; python -B
  backend/phase1f_tests/image/run_import_smoke.py; python -B
  backend/phase1f_tests/image/run_integration.py; git diff --check.
  Initial integration run failed in new test setup only: nonexistent mock target
  authoring_ensure_tables. Corrected to existing ensure_module_authoring_tables;
  final complete run: 53 + 359 PASS. No production change to satisfy tests.
- Actual extracted owners verified with spies against frozen pre-edit functions.
  Read-only real SQL covers normalized calendars, multi-cohort inheritance,
  missing cohorts, cached module reads, saved foreign calendars/errors, and fresh
  exclusions after synthetic fixture edits. No production performance claim.
- Source signatures/bindings, lazy adapters, syntax and isolated imports PASS.
  All other views AST nodes unchanged, including writers/schedulers/HTTP/auth.
  New owner has zero imports, hence adds no runtime import cycle or legacy edge.
- Files: views.py; catalogue/application/inherited_calendar.py;
  catalogue/{inherited_calendar_snapshot.json,test_inherited_calendar_standalone.py};
  test_inherited_calendar_boundary_no_db.py;
  phase1f_tests/image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
- Isolation established before initdb/Django: six disposable aliases, loopback
  only, no external routes, host mounts/credentials or published ports; containers
  removed. No Neon/existing DB, provider, frontend/env edits, commit/PR or deploy.
- Remaining risk: existing database-error-to-empty paths remain shared with
  persist_group_module_session_dates and scheduling consumers. They are explicitly
  characterized, not endorsed as correct empty data. Changing their failure
  contract requires coordinated caller/writer coverage. Existing calendar docstrings
  describe older shifting behavior; actual current planner flags holiday slots
  without moving dates, as the 30 existing consumer tests confirm. No rule changed.
  G01-G05/release gates remain independently open; no live/complete endpoint proof.
- Next cohesive batch: module session-plan/date calculation and projection
  (build_module_session_plan, holiday_date_set/holiday_details_by_date,
  module_session_plan_for_count/weeks and module_session_dates), preserving
  actual slot identity, dates, overrides and caller caches; no scheduling writes.


### Module session-plan and date boundary - PASS (2026-11-19)
- Old -> new: nine complete functions extracted from views.py into
  catalogue/domain/session_plan.py (185 lines: weekday parsing, holiday date
  expansion, delivery-week/session-slot calculation) and
  catalogue/application/session_plans.py (221 lines: holiday detail assembly,
  module delivery plans, count/week reads and caller-owned date memoization).
  views.py: 33,949 -> 33,668 (-281). Public signatures remain compatibility adapters;
  existing clock/override/calendar helpers and SQL readers keep their ownership.
- Preserved: first-delivery week, Monday default and Custom anchors, overlapping
  holiday labels, flag-only closures (no automatic date/type changes), per-day
  clocks, explicit end clipping, session overrides and slot links, warning order,
  missing-input results, explicit-empty vs inherited calendars, date-set identity
  and existing cache signature. Missing country calendars still raise errors.
  Existing weekly-from-start compatibility and its warnings are retained.
- Final 551 distinct PASS / 0 FAIL / 0 SKIPPED: 113 standalone,
  56 isolated PostgreSQL/ORM/HTTP, 382 selected fixtures; first runtime run PASS.
  New: 4 source/import contracts, 16 old/new parity cases (including 168 core-plan
  combinations), 3 real PostgreSQL/HTTP cases. Added 3 existing first-delivery-week
  cases and 4 explicitly selected Custom schedule cases; no Teams cases selected.
- Commands: python -B backend/curriculum_api/catalogue/test_session_plans_standalone.py;
  twenty-one previously selected standalone scripts; python -B
  backend/phase1f_tests/image/run_import_smoke.py; python -B
  backend/phase1f_tests/image/run_integration.py; git diff --check.
  Actual owner calls checked against frozen pre-edit implementations. Corrected
  obsolete shifting/reclassification prose in extracted owners; executable AST
  fidelity still verified. New standalone checks rerun after prose/test update.
- Real SQL fixtures cover inherited calendars, count/week reads, unchanged-cache
  zero rereads, Custom weekly JSON and overrides. Real session-plan HTTP covers
  count/weeks/default payload parity, 405 and missing-resolution 404. The HTTP
  fixture mocks only the broad authoring schema-presence gate because it contains
  representative read tables, not the full authoring schema; resolver, SQL, plan
  and serialization remain real for canonical successful requests. No new broad
  authorization, complete schema, legacy-alias or live-performance certification.
- Both owners import stdlib only: no new Django/provider/views dependencies or
  runtime import cycles. All non-target views AST nodes unchanged, including
  writers, HTTP/auth, schema helpers and other scheduling behavior. No new layers
  or generic repositories; no application schema/model/app-label changes.
- Files: views.py; catalogue/{domain/session_plan.py,application/session_plans.py,
  session_plans_snapshot.json,test_session_plans_standalone.py};
  test_session_plan_boundary_no_db.py;
  phase1f_tests/image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
- Isolation verified before initdb/Django: six disposable aliases, loopback only,
  no external routes/host mounts/credentials/published ports; containers removed.
  Synthetic fixture columns only. No Neon/existing DB, external providers, Teams
  tests, frontend/env changes, staging, branch switch, commit/PR or deployment.
- Remaining: shared database-error-to-empty and memo-signature limitations were
  not redesigned; unchanged compatibility is not approval of every failure path.
  G01-G05/release gates remain independently open. Architecture V1 is not full
  legacy elimination; existing calendar prose outside these owners remains.
- Next cohesive batch: delivery pattern and clock assembly (module_delivery_row,
  module_session_clock, module_live_session_clock, module_schedule_view and group
  schedule parsing), preserving Group/Custom precedence, overrides and clock
  contracts without changing writers or provider operations.

### Delivery schedule, session calendar and preview boundary - PASS (2026-11-19)
- Old -> new: 16 complete helpers plus two HTTP orchestration bodies extracted.
  views.py: 33,668 -> 33,323 (-345). Domain: catalogue/domain/delivery_pattern.py
  (233 lines: group/custom precedence, time parsing, session clocks and the
  distinct tutor day-gap rule). Application: delivery_schedules.py (228 lines:
  schedule normalization, group reads, preview and stored-plan orchestration),
  session_calendar.py (236 lines: authored session assembly, scoped reads and
  combined calendar projection). Existing SQL adapters reused; no empty layers.
- Preserved: public signatures/URLs/decorators, exact Group/Custom differences,
  explicit overrides, confirmed-clock metadata, no invented undated sessions,
  component/order identity, holiday flags, missing vs empty results, archived
  group sibling-clock compatibility, and API validation/404/405/500 boundaries.
  Final HTTP formatting remains outside the read-error catch, as before.
- Final 606 distinct PASS / 0 FAIL / 0 SKIPPED: 135 standalone, 60 isolated
  PostgreSQL/ORM/HTTP, 411 selected fixture tests. Includes 4 new source/import
  contracts, 21 frozen-original parity cases, 4 PostgreSQL/HTTP cases, existing
  10 group-pattern + 8 scoped-session standalone and 8 tutor-availability cases.
  Membership/catalogue regressions PASS. No Teams suites selected.
- Validation: 25 explicit standalone scripts with python -B; python -B
  backend/phase1f_tests/image/run_import_smoke.py; python -B
  backend/phase1f_tests/image/run_integration.py; syntax and git diff --check.
  Initial source-fidelity check caught a Unicode decoding error in extracted
  parser text; restored exact UTF-8 source, added separator parity coverage,
  reran affected standalone checks and the full isolated 60 + 411 suite: PASS.
- Real PostgreSQL cases verify stored Group/Custom HTTP plans, normalized rows,
  calendar/override projection and preview HTTP responses. Existing broad
  schema-presence gate remains mocked for representative fixture tables; calendar
  projection supplies synthetic component links, not component-link SQL coverage.
  No full live schema, provider, authorization or performance certification.
- New owners import only stdlib; no new runtime cycles or reverse view imports.
  All non-target views AST nodes unchanged. Changes: views.py, the three owners,
  catalogue/{delivery_schedules_snapshot.json,test_delivery_schedules_standalone.py},
  test_delivery_schedule_boundary_no_db.py, import-context-only adjustments to
  test_{group_delivery_pattern,module_scoped_sessions}_no_db.py, and isolated
  image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
- Isolation proven before initdb/Django: six disposable aliases, loopback only,
  no external routes/host credentials/mounts/published ports. Containers removed.
  Existing work and Architecture branch preserved; no staging/commit/PR/deploy,
  Neon, existing database, provider, frontend or environment changes.
- Remaining: safe_group_delivery_rows still maps read errors to {}; this is
  characterized compatibility shared with conflict/writer consumers, not evidence
  of an empty or conflict-free schedule. Valid archived-group/legacy-session
  compatibility retained. G01-G05/release gates remain independently open.
- Next coherent batch: tutor-conflict read/preview orchestration
  (tutor_conflict_context, find_tutor_schedule_conflicts, tutor_conflict_message,
  curriculum_preview_tutor_availability), preserving the shared save-time guard
  contracts and handling the error-to-empty risk with explicit caller coverage.

### Tutor conflicts and availability read boundary - PASS (2026-11-19)
- Old -> new: nine complete helper bodies and tutor-availability orchestration
  moved from views.py (33,323 -> 33,067, -256 lines). Owners:
  catalogue/domain/tutor_conflicts.py (49 lines: booking changes, clock windows),
  application/tutor_availability.py (429: dated conflicts, shared guard context,
  inherited-vs-created clashes, group/batch decisions and availability roster),
  infrastructure/tutor_reads.py (35: required module/group/staff reads).
- Intentional correction: preview no longer uses error-to-empty module, group
  or directory reads. Known read failures/missing enrolment alias raise an explicit
  availability error; HTTP returns sanitized 503 with no availability verdict.
  Successful empty reads remain valid. Module/group adapters use ensure_tables=False.
  Existing UI failure/null-verdict behavior checked; no frontend source changes.
- Preserved: successful response fields/order, identifiers and stored-slot merge,
  normalized tutor identity, pending-before-stored precedence, excluded IDs,
  clock/date grouping, inherited-clash subtraction, enforcement flags, deliberate
  override handling and existing 400/404/405 responses. Nine helper bodies match
  frozen original AST exactly. Writer handlers and all other views AST unchanged.
- Final 657 distinct PASS / 0 FAIL / 0 SKIPPED: 159 standalone (28 scripts),
  64 isolated PostgreSQL/ORM/HTTP, 430 selected fixture cases, 4 frontend hook cases.
  New: 4 source/import contracts, 19 original-source parity/failure/guard cases,
  4 PostgreSQL/HTTP cases. Existing scope (7), delivery-day (13), tutor roster (8)
  and membership/catalogue regressions pass. No Teams tests selected.
- Commands: explicit standalone scripts with python -B;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py;
  npm.cmd --prefix frontend run test -- src/hooks/__tests__/useTutorAvailability.test.tsx --maxWorkers=1;
  syntax/import-boundary checks and git diff --check. Initial integration failed
  on a missing test-fixture tutor_name column and an incorrect new dayless-group
  expectation. Corrected only the disposable fixture and the characterization
  assertion; full final 64 + 430 rerun passed, with no production test workaround.
- Real fixtures cover staff-directory SQL, roster/single/canonical HTTP parity,
  read refusal, unchanged stored assignments and inherited/new clash dates.
  Shared staffing writer tested to return the same 409 before mutation. The
  representative schema still bypasses the existing broad authoring presence gate
  for legacy resolver/oracle comparisons; no full writer/provider/schema proof.
- New dependencies: views -> owners; infrastructure -> application error type;
  domain/application -> stdlib only. No new runtime cycle or reverse legacy import.
  Files: views.py; the three owners; catalogue/{tutor_availability_snapshot.json,
  test_tutor_availability_standalone.py}; test_tutor_availability_boundary_no_db.py;
  import-context adjustments to test_{tutor_conflict_scope,tutor_delivery_day}_no_db.py;
  reader mock bindings in test_tutor_availability_roster_no_db.py; isolated
  image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
- Remaining: shared writer/other-consumer safe readers retain their old failure
  contracts. A dayless group clears delivery days, but the existing planner then
  generates weekly-from-start dates; the original conflict check can still report
  clashes on them. This is characterized, not endorsed or silently rewritten.
  A coordinated writer/preview behavior correction is separate from this extraction.
  G01-G05 and release gates remain open; no live performance/equivalence claim.
- Isolation verified before initdb/Django: six disposable aliases, loopback only,
  no external routes/host mounts/credentials/published ports; containers removed.
  Architecture branch, HEAD, index and unrelated work preserved. No Neon/existing
  database, provider, Teams, environment changes, staging, commit/PR or deployment.
- Next read batch: staff directory/profile and assignment display assembly
  (get_staff_profile_rows, build_staff_profiles, serialize_staff_profile and GET
  adapters), preserving writer ownership and making incomplete reads explicit.


### Staff directory, profiles and assignment display boundary ? PASS (2026-11-19)

- Before: identity normalization, staff SQL, profile assembly and assignment
  display lived in views.py. After: 24 helpers owned by catalogue/domain/
  staff_identity.py, application/staff_profiles.py and infrastructure/
  staff_directory.py; staffing GET assembly also moved. views.py 33,067 ->
  32,828 lines (-239 after readable dependency bindings). Existing public helper
  signatures/decorators remain; compatibility wrappers compose the new owners.
- Domain: blank/unassigned identity, archive flags, name/email keys, canonical
  module identifier matching and deduplication. Application: staff source
  projections, module summaries, role-specific assignments, profile merge/order,
  collection/detail lookup and workspace assignment IDs. Infrastructure: exact
  enrolment.Staff_users SQL and curriculum.tutors SQL, with no source substitution.
- Kept the two current identity contracts: Module Builder tutor collection reads
  curriculum.tutors; staff profiles/detail read enrolment.Staff_users. Preserved
  UUID/row-ID separation, exact-ID/email/name precedence, active-first legacy
  lookup, stored assignment compatibility, multi-coach groups and archived order.
- Intentional correction only at staff GET boundaries: unavailable/missing staff
  identity sources return sanitized HTTP 503, not successful empty collections
  or a false profile 404. Genuine empty/missing reads remain 200/404. Existing
  writer directory fallback and staffing POST/PATCH/DELETE bodies are unchanged.
- Final 680 distinct PASS / 0 FAIL / 0 SKIPPED: 163 standalone (29 scripts),
  67 isolated PostgreSQL/ORM/HTTP and 450 selected fixture cases. New coverage:
  4 standalone source/import contracts, 20 original-source parity/failure cases,
  3 real PostgreSQL/HTTP cases. Actual owners are spied on; 23 complete extracted
  bodies match the frozen original AST; tutor catalogue SQL/projection split
  matches its original source. No independently rewritten oracle.
- Commands: explicit standalone scripts with python -B;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py;
  AST/syntax/dependency checks and git diff --check. Import smoke PASS.
  Initial new tests exposed a coach expectation error, an unplaced synthetic
  module and a proxy-vendor mock leaking into following fixtures. Corrected only
  tests/fixture setup; final complete 67 + 450 rerun passed. Synthetic tutors
  fixture gained its required phone column and per-test cleanup; no app schema change.
- Isolation proved before initdb/Django: loopback-only runtime, six disposable
  aliases, no external route/host credentials/mounts/published ports. Own containers
  removed. No Neon/existing database, providers, Teams tests or host Django startup.
- Files: views.py; the three owners; catalogue/{staff_profiles_snapshot.json,
  test_staff_profiles_standalone.py}; test_staff_profiles_boundary_no_db.py;
  image/{run_import_smoke.py,import_smoke.py,integration.py,this tracker}.
  All other views top-level AST, unrelated dirty files, Architecture branch,
  HEAD and empty index preserved. No staging/commit/PR/push/deployment.
- Dependencies: views -> concrete owners; infrastructure -> application error;
  domain/application -> stdlib only. No reverse views imports or new import cycle.
- Limits: shared catalogue/training readers still retain existing failure-to-empty
  and schema-presence behavior; this is not full assignment-read reliability or
  production/auth/performance equivalence. Frontend inspection found
  useCurriculumEntities still suppresses tutor/coach failures with catch(() => []);
  useCurriculumStaffProfiles exposes its error. No frontend edits/tests this batch.
  G01-G05 and release gates are not automatically complete.
- Next executable batch: staff-read failure visibility across frontend consumers
  and the shared assignment-read chain, preserving valid empty states and writer
  contracts. Remove misleading empty-success fallbacks with focused regression
  coverage; keep optional collections independent of the main structure result.


### Staff read failure visibility and complete assignment sources ? PASS (2026-11-19)

- Before: useCurriculumEntities converted failed tutor/coach reads into [], the
  Module Builder ignored tutor errors, and the structure wizard did not display
  its staff hook error. After: an explicit, retryable warning accompanies the
  successfully loaded curriculum; failed refreshes preserve last successful staff
  options and label them potentially incomplete/outdated. Successful empty reads
  replace old options normally; successful retry clears the warning.
- useCurriculumStaffProfiles now keeps independent successful role results and
  ignores superseded requests. Shared error wording lives in the small pure
  hooks/curriculumStaffReads.ts leaf. Cache keys, write requests, form values and
  assignments are unchanged. Module Builder staff retry revalidates only tutors;
  the existing unrelated provider-summary effect is preserved.
- Backend: staff_assignments.assignment_readers projects from one complete lazy
  request-local source; staff_directory.read_assignment_source reads the existing
  module/group/cohort/programme inputs and fails explicitly. Raw authoring reads
  use ensure_tables=False. Required-source failure returns the existing sanitized
  503, not a profile with fabricated zero assignments. Empty identity results do
  not read assignments. Genuine empty assignment sources remain successful.
- Existing builders still own selection/order/alias/visibility policy. Coach
  profiles expose only group IDs/counts, so unused cohort calendar projection and
  learner totals are not read on this path. Tutor training/catalogue projection
  is unchanged. Full profile parity tested for tutor/coach, operational/all,
  archived/deleted/missing groups and real PostgreSQL/HTTP fixtures.
- Only _staff_user_profile_reader and _curriculum_tutor_profile_reader changed in
  existing views functions; added one concrete read-composition helper. All writer
  function ASTs unchanged. views.py 32,828 -> 32,854 (+26 composition lines);
  new responsibility belongs to application/staff_assignments.py, not new layers.
- Final 554 distinct PASS: 4 standalone source/import contracts, 69 isolated
  PostgreSQL/ORM/HTTP, 458 selected backend fixture cases, 23 frontend cases.
  Two existing cases in the mixed sequencing file were deliberately deselected
  by name; no Teams tests ran. No test failures or weakened assertions.
- Commands: python -B catalogue/test_staff_profiles_standalone.py (from its full
  backend/curriculum_api path); python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py;
  npm.cmd --prefix frontend run test -- src/hooks/__tests__/curriculumStaffReadFailures.test.tsx src/pages/curriculum/module-builder/__tests__/moduleBuilderReturnState.test.tsx --maxWorkers=1;
  npm.cmd --prefix frontend run test -- src/hooks/__tests__/curriculumEntitiesSequencing.test.tsx --maxWorkers=1 -t "does not bypass either cache|still paints the structure|reports staff failures".
- Type-check PASS; production build PASS (1m31s). Build reports direct-eval
  warnings in untouched lottie-web dependencies and plugin timings; no dependency
  changes. node frontend/scripts/check-batch01-cycles.cjs: 1,873 production files,
  0 cyclic components and 0 unresolved local specifiers. Syntax/diff checks PASS.
- New files: application/staff_assignments.py; test_staff_assignment_reads_no_db.py;
  hooks/curriculumStaffReads.ts; hooks/__tests__/curriculumStaffReadFailures.test.tsx.
  Updated: views.py, infrastructure/staff_directory.py, staff standalone contract;
  isolated import/bundle/integration scripts; useCurriculumEntities,
  useCurriculumStaffProfiles, sequencing test, module-builder page/return-state
  test, structureWizard.tsx and this tracker. All unrelated work preserved.
- Isolation verified before initdb/Django, all six aliases disposable/loopback,
  no external runtime network or host secrets; containers removed. Architecture
  branch, HEAD and empty index preserved. No Neon/existing DB, real data,
  provider/Teams operations, environment changes, commit/PR/merge/deployment.
- Limits: this does not remove fallbacks from every curriculum reader or prove
  production/auth/performance equivalence. Existing legacy writer fallback and
  unrelated optional holiday/provider-summary behavior remain outside this batch.
  G01-G05 and release approval are not automatically complete.
- Next executable batch: shared curriculum overview assembly and failure handling
  around build_curriculum_payload / build_curriculum_payload_from_rows and their
  read inputs; preserve cache/API contracts and keep writers separate.


### 2026-11-21 ? Curriculum overview assembly and required-source reads ? PASS

- Before: overview composition and shared-row orchestration lived in views.py;
  safe legacy readers could turn failed module/placement/staff reads into partial
  success. The same shared-row reader also serves programme post-save responses.
- After: catalogue/application/overview.py owns the original payload assembly
  and legacy shared-row orchestration. Infrastructure/overview_reads.py owns the
  required source bundle for the live Overview GET. Complete raw sources are
  projected through the existing training/catalogue functions. No new domain
  package, repository/interface hierarchy, SQL rewrite or writer policy.
- Preserved both original function bodies in overview_snapshot.json and checked
  exact AST parity. Existing signatures/decorators and all other view bodies,
  including writers, are unchanged. Views: 32,854 -> 32,769 lines (-85 net).
- Overview live builds reject required source failures with sanitized HTTP 503;
  genuine empty sources remain valid. The legacy/post-save readers retain their
  original behavior. Required reads use rows-required:* / overview-required:*
  cache entries, preventing partial legacy entries from satisfying this contract.
  Visibility, compact/full/profile identity separation, epoch invalidation, TTL,
  compression, force refresh and retaining the last successful value are tested.
  First required build is cold; the existing legacy warmer is unchanged.
- Original source projection, archive/copy handling, full/compact payloads,
  Home/module/programme branches and assignment-count call contracts match on
  synthetic fixtures. Required SQL retains existing projections/order/schema
  guards and memo keys; PostgreSQL source rows match the original reader.
- Validation: 558 distinct cases PASS, 0 failed/skipped in final selected runs:
  4 standalone contracts; 72 disposable PostgreSQL/ORM/HTTP integration cases;
  482 selected fixture cases (including 15 new overview cases, 4 existing profile
  identity cases and 5 shared read-model/cache cases). No Teams tests selected.
  Commands: python -B backend/curriculum_api/catalogue/test_overview_standalone.py;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Import preflight, syntax, explicit dependency checks and diff checks PASS.
  New owners have only infrastructure -> application imports, no views/framework
  imports or cycles. No frontend changes; frontend checks were not rerun.
- Initial validation issues resolved: Docker Engine was stopped (started locally);
  the new fixture now isolates assignment-count dependencies while asserting their
  inputs/options; two dynamically imported cache helpers added to the sanitized
  test bundle. An existing read-model fixture now includes the already-established
  compact ksbSets field. No assertions removed or production rules changed for tests.
- Created: application/overview.py, infrastructure/overview_reads.py,
  catalogue/overview_snapshot.json, catalogue/test_overview_standalone.py,
  curriculum_api/test_overview_boundary_no_db.py.
  Updated: views.py; test_bulk_attendance_overview_no_db.py;
  test_curriculum_read_model_no_db.py; isolated import_smoke.py,
  run_import_smoke.py, integration.py; this tracker. Unrelated work preserved.
- Isolation proved before initdb/Django: network-none namespace, loopback-only
  disposable PostgreSQL for all six aliases, no host environment/credentials;
  owned containers removed. No Neon/existing DB, real data, provider/Teams calls,
  environment changes, commits, PRs, pushes, merges or deployment.
- Limits: this does not remove every downstream count/calendar fallback or
  certify full production/auth/performance parity. Existing shared read-model
  hits still use their prior contract; this batch tightens live Overview source
  builds only. Representative PostgreSQL tests bypass the broad authoring-table
  presence gate in both old/new readers; production schema-guard policy is unchanged.
  G01-G05 and release approval remain unchanged.
- Next executable batch: overview delivery/calendar enrichment and shared
  read-model publication failure handling, preserving post-save readers and
  existing cache invalidation; continue using isolated synthetic validation.


### 2026-11-21 - Accelerated KSB / OTJH reporting read boundary - implementation complete; wider acceptance PARTIAL

- Before: 21 reporting functions (1,531 original lines) mixed progress/reflection
  SQL, learner identity resolution, KSB achievement, OTJH plans and activity
  projections in views.py. After: six concrete owners under curriculum_api/reporting:
  domain/ksb.py and domain/otjh.py own pure weighting, achievement and hours rules;
  application/consumption.py and application/activity.py own read orchestration,
  identity/scope classification and projections; infrastructure/progress.py and
  infrastructure/reflections.py own exact SQL and metadata availability reads.
  Views retains existing public signatures as explicit compatibility composition.
  views.py: 32,769 -> 31,406 lines (-1,363 net). No empty architecture layers.
- Preserved: canonical completion gate, failed/unresolved/repeat exclusions,
  stamped lineage for deleted components, no-KSB activity hours, live/stamped
  titles, profile vs enrolment IDs, reflection linkage only through Progress,
  declared vs achieved KSB separation, group-specific denominators, caps/order,
  metadata unavailability and exception mapping. No SQL query rewrite, writer,
  membership, authentication, URL, schema, frontend or provider behavior change.
- Evidence: snapshot.json contains actual original sources; 19 unsplit bodies
  match AST exactly; the two split functions retain original identity/projection
  bodies and reflection SQL. All 21 signatures/decorators and every other view
  declaration match the pre-task checkout. No domain/application storage edges;
  imports are standard library or the existing pure progress error type.
  Dependency bindings are explicit; no imports of views, Django or providers,
  no new module cycles. No repositories, DI container or class hierarchy added.
- New checks: 7 standalone contracts; 58 original-source fixture trace parity
  cases plus 8 focused read/error/SQL/owner contracts; 3 PostgreSQL parity cases
  covering actual progress SQL, reflections and the assembled reporting output.
  PostgreSQL reads run in READ ONLY transactions after disposable synthetic seed.
- Final results: 703 PASS, 3 FAIL, 0 SKIPPED across 706 distinct selected tests:
  7/7 standalone; 75/75 disposable PostgreSQL/ORM/HTTP; 621/624 fixture tests.
  All new reporting checks and prior 482 selected fixture cases PASS. Repeated
  diagnostic/oracle runs are not counted as extra tests. Import smoke, syntax,
  dependency checks and git diff --check PASS. The wider runner still exits 1.
- Existing baseline issues were checked against the frozen original reporting
  implementations: 15/76 newly selected existing tests already failed. Twelve
  failures came from stale scalar KSB fixtures/direct-join assertion; fixtures
  now supply the existing arrays contract, and the LEFT lateral assertion pins
  the real query shape. Business assertions retained. The new integration
  fixture was corrected to pass per-learner KSB weights rather than whole plans.
- Three existing ScopedRosterTests still FAIL, unchanged: cohort selection,
  group selection and label case/spacing. Their name-only fixtures expect the
  historical label fallback; current narrow_learners_to_placement requires IDs.
  This behavior predates this extraction (reproduced with original source).
  No tests skipped/deleted and no membership semantics changed to obtain green.
  Next verification action: reconcile those legacy tests with the approved
  ID-based contract, including duplicate-label and missing-ID cases.
- Created: reporting/{__init__,domain/{__init__,ksb,otjh},application/{__init__,
  activity,consumption},infrastructure/{__init__,progress,reflections}}.py;
  reporting/snapshot.json; reporting/test_standalone.py;
  curriculum_api/test_reporting_boundary_no_db.py.
  Updated: views.py; tests_ksb_achievement.py; tests_scope_achievement.py;
  isolated image/{import_smoke,run_import_smoke,integration}.py; this tracker.
- Commands: python -B backend/curriculum_api/reporting/test_standalone.py;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Local evidence: D:/Temp/HP/lms-reporting-{smoke,original-fixture-baseline,
  acceptance-final}.log. Original fixture baseline used network-none/dummy DB
  settings. Integration isolation proved before initdb/Django; all six aliases
  point only to disposable loopback PostgreSQL, with no host credentials/env.
- No Neon/existing database, real data, Teams tests/provider calls, environment
  changes, Git staging/commit/PR/push/merge or deployment. Branch/HEAD unchanged;
  unrelated changes preserved; owned containers removed. G01-G05 unchanged.
- Limits/next larger batch: reporting HTTP/read orchestration and evidence
  assembly remain in views.py (scope_learner_ksb_impact_payload,
  _scope_learner_ksb_impact_payload, _achievement_projection,
  progress_evidence_index). Preserve endpoint/auth/cache and writer boundaries.
  This extraction does not eliminate historical metadata/reflection empty-read
  fallbacks or certify live performance/full endpoint equivalence. The previously
  queued overview delivery/read-model publication work also remains open.

### 2026-11-21 - Reporting queries, HTTP delivery and evidence reads - PASS

- Before: 18 reporting functions (1,008 original lines) mixed query orchestration,
  HTTP errors, cache delivery and supplementary SQL in views.py. After: concrete
  reporting/application/{queries,achievement,coverage,supplementary}.py own
  orchestration/projections over plain query values; reporting/api/responses.py
  owns HTTP/cache delivery; infrastructure/{achievement_cache,supplementary}.py
  owns fingerprints, totals, declarations and evidence SQL. Existing domain rules
  are reused. No empty domain package, repository or DI framework added.
- views.py: 31,406 -> 30,679 lines (-727 net); compatibility composition accounts
  for the difference from 1,008 moved lines. All 18 signatures/decorators and
  every other view declaration/module constant remain unchanged. Application
  errors are plain outcomes, mapped to existing HTTP errors at the API boundary.
- Preserved: SQL text/parameters, completion/status filters, progress-linked
  evidence identity and order, KSB deduplication, current scope/placement policy,
  pagination, coverage projections, cache keys/TTL/fingerprints, ETags/gzip and
  read-failure contracts. No writers, URLs, authentication, schema or frontend
  production changes. New owners import no views, Django, SQL drivers/providers;
  no new import cycles. Legacy callbacks remain explicit at composition points.
- Regression coverage: frozen original sources in delivery_snapshot.json;
  7 new standalone source/dependency contracts; 23 original-source parity and
  focused HTTP/cache/error fixture tests; 3 new PostgreSQL/HTTP integration tests.
  Real synthetic SQL covers totals, declarations, evidence and fingerprints;
  8 HTTP requests compare original/new responses through existing handlers.
  Catalogue/placement input ports remain synthetic in those HTTP comparisons.
- Resolved the prior batch's three roster fixture failures using stable IDs:
  9 roster cases now cover duplicates, missing IDs, normalization and ordering.
  Two additionally selected fixtures were stale: the stats assertion omitted
  three existing achievement fields, and coverage lacked a source-fingerprint
  mock when metadata is present. Both reproduced against original code (coverage
  under metadata-present conditions). Added deterministic read mocks and retained
  existing assertions; no production membership/calculation change or skipped test.
- Final: 772 PASS, 0 FAIL, 0 SKIPPED across distinct selected cases: 78 isolated
  PostgreSQL/ORM/HTTP, 680 fixtures, 14 standalone (7 previous + 7 new). Import
  smoke, syntax, dependency/AST checks and git diff --check PASS. Diagnostic and
  original-oracle reruns are not counted again. No live performance claim.
- Created: the seven owner modules above plus api/__init__.py,
  reporting/delivery_snapshot.json, reporting/test_delivery_standalone.py and
  curriculum_api/test_report_delivery_boundary_no_db.py. Updated: views.py,
  tests_scope_achievement.py, test_coverage_summary_no_db.py,
  test_ksb_stats_latency_no_db.py, image/{import_smoke,run_import_smoke,integration}.py
  and this tracker. Synthetic schema additions exist only in the isolated harness.
- Commands: python -B backend/curriculum_api/reporting/test_standalone.py;
  python -B backend/curriculum_api/reporting/test_delivery_standalone.py;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Evidence: D:/Temp/HP/lms-report-delivery-{smoke-final,acceptance-final,
  original-fixture-baseline,original-cache-baseline}.log.
- Isolation proved before initdb/Django: network-none/shared loopback namespace,
  six aliases on disposable PostgreSQL, synthetic data/credentials only. No Neon,
  real data, Teams tests/provider operations or host application startup. Owned
  containers removed; branch/HEAD and unrelated work preserved. No staging,
  commit, PR, push, merge or deployment. G01-G05 are not automatically cleared.
- Remaining: programme KSB-stat aggregation, source lookup and legacy composition
  still live outside reporting owners; compact totals retain their deferred
  ksb_stats_reads binding to avoid introducing a views import in infrastructure.
  Next read-only batch can group programme KSB stats and remaining coverage-source
  reads. Historical empty-read fallbacks and full production endpoint/performance
  equivalence are not certified by this extraction.

### 2026-11-21 - Programme KSB statistics and coverage-source boundary - PASS

- Before: programme mapping counts, expected weights, achievement statistics,
  source resolution, cache delivery and grouped SQL were mixed in legacy views
  and ksb_stats_reads. Extracted 42 functions representing 849 original source
  lines (38 from views, four from the SQL helper). After: real implementations
  live under reporting, with existing signatures/decorators retained as adapters.
  views.py: 30,679 -> 30,324 (-355); ksb_stats_reads.py: 120 -> 79 (-41).
- Domain: programme_statistics owns scoped mapped-code counts, positive expected
  weights, per-learner caps, declaration counts and ordered weight accumulation;
  sources owns normalization, source identity and definition/placement rules.
  Application: programme_statistics coordinates design/progress/declaration reads;
  source_catalogue resolves stored/module/name sources and standard definitions;
  source_projection assembles labels and coverage metadata. Legacy profile
  selection stays in Application: its existing ID projection can mint a temporary
  ID for noncanonical legacy rows and is not claimed as a deterministic domain rule.
- Infrastructure: statistics_reads owns unchanged grouped normalized-schema SQL,
  eligible outcomes and latest-attempt ordered weights; statistics_cache owns
  design generations and the request-local force flag. API/statistics owns the
  existing conditional HTTP response, force read, TTL and missing-programme error.
  Eight concrete owner modules, no new package layers/interfaces/repositories.
- Preserved: stored-source precedence, explicit archived-profile semantics,
  mapping-source cache/order, normalized joins/status filtering, Python whitespace,
  duplicate/parent KSB rules, Decimal rounding and floating-point addition order,
  progress versus declared achievement, design-cache failures and force restoration.
  The legacy 'all-profiles' marker still yields no required definitions; corrected
  the coverage resolver docstring to describe mapping-only behavior accurately.
- Validation: 829 PASS, 0 FAIL, 0 SKIPPED: 81 isolated PostgreSQL/ORM/HTTP tests,
  724 selected fixtures, 24 standalone (14 previous + 10 new). New coverage:
  32 original-source fixture trace comparisons, five focused owner/source/cache
  cases, 10 standalone contracts and three PostgreSQL/HTTP cases. Seven existing
  source/normalized-mapping tests newly selected. The parity harness resets cache
  state before each old/new run; warm/forced assertions remain inside each case.
  The non-PostgreSQL projection case remains in its original suite; it invokes
  no new owner and is not counted as an additional parity case.
- Real synthetic PostgreSQL verifies grouped duplicates/archive filtering and
  normalized mapping placement, latest eligible progress/exclusions, capped
  programme totals and actual HTTP 200/304/forced/404/405 behavior. Catalogue and
  roster input ports are synthetic; no full production/performance claim.
- Import smoke, syntax, original-source AST/SQL/parameter checks and git diff
  --check PASS. New imports point inward, with no views/Django/provider imports
  or new cycles in the owners. The existing ksb_stats_reads -> views composition
  edge remains in the compatibility facade; its SQL/calculations have moved.
- Created: reporting/{domain/{sources,programme_statistics},application/
  {programme_statistics,source_catalogue,source_projection},infrastructure/
  {statistics_reads,statistics_cache},api/statistics}.py; reporting/
  {statistics_snapshot,statistics_reads_snapshot}.json; reporting/
  test_statistics_standalone.py; curriculum_api/test_statistics_boundary_no_db.py.
  Updated: views.py; ksb_stats_reads.py; reporting/application/coverage.py
  (docstring only); image/{import_smoke,run_import_smoke,integration}.py; tracker.
- Commands: python -B backend/curriculum_api/reporting/test_standalone.py;
  python -B backend/curriculum_api/reporting/test_delivery_standalone.py;
  python -B backend/curriculum_api/reporting/test_statistics_standalone.py;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Evidence: D:/Temp/HP/lms-ksb-sources-{smoke,acceptance-final}.log.
- OS isolation verified before disposable database creation/Django startup; all
  six aliases use synthetic loopback PostgreSQL, no host settings/credentials.
  No Neon, existing data, Teams tests/provider calls, writer/schema/URL/auth
  changes, frontend edits, environment changes or Git publishing operations.
  Branch/HEAD and unrelated work preserved; owned containers removed. No release
  or G01-G05 clearance implied.
- Remaining/next: shared overview delivery/calendar enrichment and read assembly;
  legacy standards-row cache and compatibility composition remain. Existing
  error-to-empty paths shared with save callers were not removed or redefined.
  Read-model publication and writer convergence remain outside this read batch.


### 2026-11-21 - Overview session enrichment and authoritative source reads - PASS

- Before: session identity, link queries, planning orchestration and training-row
  projections lived in views.py. Full live Overview generated training-count
  sessions before merging authored sessions; secondary delivery readers could
  silently turn failed reads/plans into empty results or stored-date substitutes.
- After: 10 functions / 572 original source lines extracted into four concrete
  owners: catalogue/domain/session_identity.py, application/session_links.py,
  application/session_enrichment.py and infrastructure/session_reads.py.
  views.py: 30,324 -> 29,932 lines (392 net legacy lines removed).
- Required live Overview reuses the successful module/cohort/group source bundle
  for delivery and authoring details. Group dates/tutors use one shared projection
  in application/delivery_reads.py; no duplicate enrichment implementation.
  Full live Overview reads authored session components only, with strict source
  and planner failure propagation. It no longer falls back to sessions_number
  generation. Missing calendar sources produce the existing sanitized HTTP 503
  and cannot populate a successful payload cache. Genuine empty structures remain
  empty; undated authored components retain the existing dated-only list policy.
- Removed misleading decisions: arbitrary first-programme-module matching;
  ambiguous title matching; resolving a broken explicit module link through a
  different source/name; synthesizing start + index*7 dates when the planner
  supplies none. Canonical/source identities and unique legacy title matches stay.
  Required reads do not substitute empty links or stored dates after a read/plan
  error. Other compatibility callers keep their previous tolerant read contract.
- Required rows/overview cache namespaces advanced to v2 so old cached partial
  payloads cannot satisfy the strengthened live-read contract. Existing force,
  TTL, epoch, profile-source isolation and public response fields are retained.
  The internal _delivery_rows bundle is not included in HTTP payloads.
- Validation: 853 PASS, 0 FAIL, 0 SKIPPED: 84 isolated PostgreSQL/ORM/HTTP tests,
  738 selected fixtures and 31 standalone tests (24 prior + 7 new).
  Added 14 runtime fixture cases, 7 standalone cases, and 3 PostgreSQL cases.
  Actual original source bodies are frozen in session_enrichment_snapshot.json;
  parity compares outputs, types, ordered reads and exact query parameters.
  Intentional identity/date corrections are asserted separately from parity.
- PostgreSQL coverage uses synthetic authored weeks/components and the real
  planner/read adapter; verifies strict/default healthy parity, authored-only
  overview assembly and HTTP 503 on component-read failure. The HTTP failure
  case stubs unrelated enrichment/count ports; no full production parity claim.
  Initial run: 84 PostgreSQL PASS, one fixture failed solely on old cache-key
  expectations. Updated the affected exact-key assertions; final 738/738 PASS.
- Import smoke, changed-source syntax, git diff --check and static owner import
  graph PASS: 67 catalogue owner modules, zero static relative-import cycles.
  Four new owners import only standard library; no views/Django/SQL/provider
  imports in Domain or Application. Long new signatures formatted with identical
  complete AST after the runtime run; no behavioral edits after acceptance.
- Created: the four owners above; catalogue/session_enrichment_snapshot.json;
  catalogue/test_session_enrichment_standalone.py;
  curriculum_api/test_session_enrichment_boundary_no_db.py.
  Updated: views.py; catalogue/application/{overview,session_calendar,delivery_reads}.py;
  test_overview_boundary_no_db.py; test_bulk_attendance_overview_no_db.py;
  image/{run_import_smoke,import_smoke,integration}.py; this tracker.
- Commands: python -B backend/curriculum_api/catalogue/test_session_enrichment_standalone.py;
  python -B backend/curriculum_api/reporting/{test_standalone,test_delivery_standalone,
  test_statistics_standalone}.py (each separately);
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Evidence: D:/Temp/HP/lms-overview-delivery-{smoke,standalone,acceptance-final}.log.
- Isolation verified before disposable PostgreSQL initialization and Django:
  loopback-only network namespace, read-only application filesystem, sanitized
  source bundle, synthetic credentials and all six aliases on disposable local
  PostgreSQL. All owned containers removed. No Neon, existing data, provider calls,
  Teams tests, frontend changes, writer/schema/auth changes or Git publication.
  Architecture branch/HEAD unchanged; unrelated changes preserved.
- Remaining/next: converge programme-detail session projections and remaining
  overview/session compatibility consumers on authored components, then retire
  the generated-session helpers once their callers are covered. Shared read-model
  publication, writer convergence and other legacy best-effort readers remain
  outside this live-Overview batch. No whole-LMS single-source completion, release
  acceptance, G01-G05 clearance or measured performance improvement is claimed.


## Programme sessions and calendar convergence — PASS (2026-11-21)

- Before: Programme Detail generated sessions from training-row counts; the
  session/overview compatibility path generated and then merged two sources.
  Module-scoped reads had a separate projection and a global fallback for misses.
- After: Programme Detail, scoped/all Sessions GET and Delivery use the same
  authored calendar application query and projection. Overview and post-save
  assembly reuse that projection. Only authored live components supply sessions;
  genuine empty/undated structures never become count-generated calendar rows.
- Concrete owners: catalogue/api/programme_detail.py owns five HTTP/validation
  functions (155 original source lines); application/calendar_queries.py owns
  scoped read orchestration; infrastructure/calendar_rows.py owns normalized
  module/parent queries and the existing slim component SQL. Existing views and
  calendar_read_rows exports remain composition adapters. No empty packages.
- Removed application/session_enrichment.py, four obsolete domain matching/merge
  helpers, six legacy views exports and duplicated module-scoped calendar logic.
  Programme scope uses the resolved stored ID, never a programme-name guess;
  missing module/programme scope stays empty without reading the global calendar.
- views.py: 29,932 -> 29,686 lines (246 net removed). Across the ten affected
  production files including new owners/deleted generator: 31,316 -> 30,886
  lines (430 net removed). These figures are relative to this task's starting
  working tree, not Git HEAD or a claim about the whole project.
- Required calendar/planner failures propagate to sanitized HTTP 503 before
  success caching. Calendar, sessions and programme-detail cache namespaces
  advanced; TTL/epoch/force behavior preserved. Existing post-save tolerant link
  reads remain explicitly separate to avoid changing writer transaction behavior.
- Two verified corrections: slim component reads now retain normalized status
  so inactive components are excluded; canonical programme validation returns the
  intended 422 payload instead of the existing duplicate-message TypeError.
  Frozen original HTTP/source evidence distinguishes corrections from parity.
- Retained: canonical session/component identity, component ordering, holiday and
  delivery-plan rules, booked date/clock controls, explicit JSON null precedence,
  legacySettings compatibility, URLs/authentication and all writer implementations.
- Validation: **891 PASS, 0 FAIL, 0 SKIPPED** = 87 isolated PostgreSQL/ORM/HTTP
  tests + 781 selected fixtures + 23 standalone tests. Includes actual slim JSONB
  SQL/status filtering, scoped source parity, real session HTTP serialization,
  missing/empty/undated states, required-read failure and unchanged persisted
  curriculum records. Programme-detail orchestration/HTTP parity uses synthetic
  read ports; this is not a full production-data endpoint equivalence claim.
- New test_calendar_convergence_no_db.py and programme_http_snapshot.json;
  affected historical fixtures updated for retired generators, current normalized
  archive state, actual module ordering and new cache namespaces. Initial failures
  exposed the 422 bug plus obsolete fixture assumptions; final runs above passed.
- Commands: python -B backend/phase1f_tests/image/{run_import_smoke,run_integration}.py
  (each separately); python -B backend/curriculum_api/test_module_scoped_sessions_no_db.py;
  python -B backend/curriculum_api/catalogue/{test_session_enrichment_standalone,
  test_delivery_schedules_standalone,test_programme_reads_standalone}.py (each separately);
  changed-source AST checks; git diff --check. Import smoke PASS; extracted SQL
  body AST parity PASS; 69 catalogue owner modules, zero static owner import cycles
  and zero forbidden Domain/Application dependency edges.
- Evidence: D:/Temp/HP/lms-session-convergence-{smoke,standalone-final,acceptance-final}.log;
  dependencies.json, changes.json and pre-task source/hash snapshots under the same prefix.
  Isolation proven before initdb/Django: loopback-only disposable PostgreSQL,
  read-only application container, sanitized sources and synthetic credentials.
  All owned containers removed. No Neon, existing data, providers, Teams tests,
  frontend production edits, writer/schema/auth edits, commits, PRs or deployment.
- Next coherent batch: programme module candidate assembly, consolidating normalized
  authored modules versus programme-config representations where evidence proves
  duplication. Retire misleading name/config fallbacks with focused read-contract
  tests; preserve legitimate alias and authoring/write behavior. Shared read-model
  publication and remaining best-effort readers/writers remain separate work.
  No whole-LMS completion, measured performance gain or G01-G05 clearance claimed.


## Module workspace read extraction - PASS (2026-11-21)

- Before: bulk module resolution, scope selection/hydration, KSB display,
  component setting definitions and module metadata projections lived in views.py.
- After: 23 existing functions (1,035 original function lines) and six setting
  declarations have concrete owners. views.py retains public names, decorators
  and composition bindings: **29,686 -> 28,684 lines; 1,002 net lines removed**.
  This is responsibility extraction, not a 1,002-line whole-project deletion;
  explicit read contracts and composition bindings add production code overall.
- API: catalogue/api/module_reads.py owns module collection, reuse-library and
  bulk resolver HTTP contracts. Application: structure_resolution.py owns exact
  ID/source alias selection, ambiguity and result construction; scope_queries.py
  coordinates scopes and child projections; scope_identity.py owns programme
  matching and delivery selection; ksb_projection.py and authoring_metadata.py
  own KSB/framework and module display/quality payloads. Domain:
  component_settings.py owns the existing schema and pure setting normalization.
  Infrastructure: resolution_candidates.py preserves the actual resolver SQL;
  scope_reads.py owns child-table, week-owner and grouped KSB read capabilities.
  No empty folders, repository abstractions or views imports in these owners.
- One intentional correction, separately tested against the original behavior:
  in the linked programme scope, a standalone module with a DIFFERENT canonical
  programme ID can no longer enter through a matching stale programme name.
  Exact linked IDs remain authoritative; legitimate name-only/legacy aliases,
  ordering, duplicate ranking, manual/normalized membership and writers retain
  their existing behavior. The entire legacy compatibility surface is not retired.
- Validation: **893 PASS, 0 FAIL, 0 SKIPPED** = 89 disposable PostgreSQL/ORM/HTTP
  tests + 799 selected fixture tests + 5 standalone settings tests. Added 2 real
  PostgreSQL cases and 15 frozen-source fixture cases; also selected the existing
  3 assignment-settings tests. The actual new owners are spied on, and the old
  oracle is the exact pre-task source, not a reimplementation.
- Real SQL/HTTP checks cover bulk resolution, exact versus ambiguous title
  results, missing modules, authored component counts, scoped child hydration and
  week ownership. Fixture checks include scope identities, archived/empty paths,
  KSB projections, settings round trips, HTTP status/headers/payloads and query
  parameters. Existing membership and catalogue regression suites still pass.
- Initial run exposed test-harness defects: an unhashable synthetic URL config,
  a generated profile ID in the KSB fixture, and nested patching of Django's
  connection proxy leaking its vendor. Corrected those fixtures; final full run
  above passed without weakening assertions or allowing DB access in SimpleTestCase.
- Import smoke, AST syntax, snapshot provenance, assigned-value preservation,
  unchanged writer/class/decorator AST checks and git diff --check PASS. Static
  catalogue graph: 79 production Python modules including package markers,
  zero cycles and zero forbidden Domain/Application import edges. No runtime
  import cycle observed by isolated import/integration tests.
- Tests/source support: test_module_workspace_boundary_no_db.py;
  catalogue/test_component_settings_standalone.py; module_workspace_snapshot.json.
  Existing recording/session/external-calendar AST fixtures now load the moved
  settings owner without copying its implementation; Teams tests were NOT run.
  Image bundle/import targets and explicit integration test selection updated.
- Commands: python -B backend/curriculum_api/catalogue/test_component_settings_standalone.py;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Evidence: D:/Temp/HP/lms-module-workspace/{import-smoke,acceptance-2}.log,
  dependencies.json, metrics.json, views.diff and pre-task source/hash snapshots.
- Isolation re-proven before initdb/Django: loopback-only disposable PostgreSQL,
  sanitized source bundle, read-only app filesystem, no host credentials and all
  six aliases on the disposable database. Owned containers removed. No Neon,
  existing data, provider operations, frontend edits, migrations, env/auth changes,
  commits, PRs, branch changes or deployment. Prior working-tree changes preserved.
- Next: consolidate programme module candidate assembly and normalized authored
  modules versus programme-config representations with focused compatibility
  coverage. Remaining legacy KSB-profile identity generation also needs explicit
  read-contract coverage before retiring its missing-ID behavior. Writer/provider
  boundaries and shared read-model publication remain separate; this batch does
  not complete views.py, full LMS modernization, release approval or G01-G05.


## Programme module source convergence - PASS (2026-11-21)

- Before: full detail and workspace independently assembled delivery, authoring
  and embedded config candidates. Authoring hydration ran twice; stale config
  content, same-name programme matches and truthiness fallbacks could hide saved
  empty/zero values. After: both paths invoke application/programme_modules.py,
  sharing one normalized structure hydration per pass and the same selection.
  Workspace retains the existing textless-first optimization, with a second
  full-text pass only if component text can affect selection.
- Domain: programme_scope.py owns ID-first programme membership; module_selection.py
  now also owns the pure component-layout/text-cancellation decision and normalized
  KSB-code projection. Infrastructure readers/SQL remain unchanged. Public legacy
  exports stay compatible; optional supplied snapshots add no new layers/classes
  beyond one explicit read-unavailable error.
- Intentional corrections, tested separately against frozen pre-task source:
  embedded config modules cannot inject content or invent membership; reference
  exports batch-fetch real IDs (including existing snake-case/id aliases);
  foreign canonical/known programme IDs cannot enter through a shared name;
  stored empty/zero content is authoritative. Missing required structures/read
  failures or concurrent ownership changes produce sanitized HTTP 503, not a
  successful partial result. Programme response cache namespace is v3; TTL,
  invalidation, auth, routes, writers and schema remain unchanged.
- Actual size: programme_detail.py 401 -> 343; programme_workspace_reads.py
  82 -> 45; views.py 28,684 -> 28,688 (+4 composition lines). Eight production
  files changed, two created; net production +94 lines. This batch consolidates
  responsibility and removes misleading sources; it is not a 1,000-line extraction
  or elimination of all config/legacy reads across the LMS.
- Validation: **914 PASS, 0 FAIL, 0 SKIPPED** = 92 isolated PostgreSQL/ORM/HTTP
  cases + 814 selected DB-forbidden fixture cases + 8 standalone static contracts.
  Added 3 PostgreSQL/HTTP and 15 focused fixture cases. Actual new query invoked;
  frozen original bodies verify healthy parity and reproduce the corrected bugs.
  Full/lean selection, missing/read-error cases, canonical ownership, cached input
  immutability, preserved public reference formats and 503 responses covered.
- Integration scope: module/week/component/KSB SQL uses disposable PostgreSQL;
  new SQL parity cases explicitly use include_extra=False for unchanged optional
  live-session/completion extras. These extras and Teams/provider behavior are
  not claimed validated. Full default orchestration is covered with fixture ports;
  no real deployment, production timing or all-programme parity is claimed.
- Initial verification caught a missing unique binding and incorrect assumptions
  in new synthetic fixtures (programme ID and availability of optional tables).
  Corrected the binding/fixtures; final acceptance passed without weakening existing
  assertions. Existing static tests distinguish unchanged bodies from this deliberate
  source correction, whose behavior is checked by executable frozen-source tests.
- Commands: python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/catalogue/test_module_reads_standalone.py;
  python -B backend/curriculum_api/catalogue/test_programme_reads_standalone.py;
  git diff --check. Import smoke, syntax, provenance and diff checks PASS.
  Catalogue graph: 81 production Python modules, zero static cycles/forbidden
  Domain/Application imports. Unrelated views functions, writers, classes,
  module-level assignments and decorators are AST-identical to the task baseline.
- Evidence: D:/Temp/HP/lms-programme-source/{acceptance-final,import-smoke-final,
  module_reads-static-final,programme_reads-static-final}.log; dependencies.json,
  changes.json and exact pre-task source copies. Isolation checked before Django
  startup/initdb: loopback-only disposable database, sanitized source archive,
  read-only app container, all six aliases local; owned containers removed.
  No Neon/existing data, providers, Teams tests, frontend/env/auth/migration edits,
  commits, PRs, branch changes or deployment. Existing work preserved.
- Remaining/next: KSB profile/source identity fallbacks and catalogue enrichment
  still need contract coverage and convergence; config cohort/group compatibility,
  other read-model publication and writer/provider boundaries remain separate.
  views.py is not finished; G01-G05 and release/deployment approvals are unchanged.

## KSB identity and source read boundary - PASS (2026-11-21)

- Before: KSB identity/normalization and reference HTTP contracts remained in
  views.py. A profile without a public KSBP ID could receive a newly generated ID
  on every read, even when it had a persisted legacy row ID. Programme source
  lookup accepted the first matching name or ID, allowing a name collision to
  select another programme's source before reaching the actual ID.
- After: reporting/domain/sources.py owns nine extracted pure helpers;
  catalogue/api/ksb_sources.py owns seven reference API handlers. views.py keeps
  public signatures, decorators and explicit composition bindings. Stored public
  IDs retain priority, persisted legacy row IDs remain stable, and a name alone
  cannot generate an identity. Identity-less profiles cannot name a programme;
  build_ksb_data explicitly rejects them instead of emitting a fabricated framework.
  Programme source resolution checks all IDs before names and refuses a missing
  canonical ID's collision with a different programme name. Legitimate name aliases,
  stored profile aliases, normalization and retired-framework HTTP statuses remain.
- Scope: five production files (the new API owner, reporting domain sources,
  reporting/application/source_catalogue.py, catalogue/application/ksb_projection.py
  and views.py). Sixteen functions / 123 original function lines extracted;
  views.py **28,688 -> 28,658**, net **30 lines removed**. Production code overall
  grows by 138 lines including explicit composition; this is not a 1,000-line batch.
- Validation: **934 PASS, 0 FAIL, 0 SKIPPED** = 94 disposable PostgreSQL/ORM/HTTP
  cases + 827 selected DB-forbidden fixture cases + 13 standalone contracts.
  Added two actual PostgreSQL/HTTP cases, 13 fixture cases and three standalone
  contracts. Actual new owners are invoked/spied on. Frozen pre-task implementations
  reproduce the old identity/name bugs and verify healthy payload/status/ETag parity.
  Existing membership, catalogue, reporting and writer transaction regression
  selections pass. The new SQL cases exercise stored programme sources and actual
  standard rows through HTTP, including detail/missing/304 responses.
- Test files/support: test_ksb_identity_boundary_no_db.py;
  reporting/test_ksb_identity_standalone.py; reporting/ksb_identity_snapshot.json;
  reporting/test_statistics_standalone.py (source checks account for exactly the
  deliberate corrections, retaining checks on all other statements); image
  integration.py, run_import_smoke.py and import_smoke.py. Frozen oracle provenance
  verified against pre-task bytes. Initial standalone validation caught a harness
  module-path error and the old exact-body guard caught the intentional corrections;
  corrected these checks without rewriting the historical oracle.
- Isolated import smoke, AST syntax, unchanged unrelated views functions/classes/
  constants/decorators and git diff --check PASS. Static graph across 82 catalogue
  and 26 reporting production modules: zero cycles or forbidden Domain/Application
  imports. Domain sources imports only stdlib re. No runtime import cycle observed.
- Commands: python -B backend/curriculum_api/reporting/test_ksb_identity_standalone.py;
  python -B backend/curriculum_api/reporting/test_statistics_standalone.py;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Evidence: D:/Temp/HP/lms-ksb-identity/{acceptance-1,import-smoke,ksb-identity-static,
  statistics-static}.log; changes.json, dependencies.json and exact source snapshots.
- Isolation re-proven before initdb/Django: loopback-only disposable PostgreSQL,
  all six aliases local, sanitized source archive, read-only app container and no
  host secrets/network route. Schema additions occur only in disposable test fixture
  tables. Owned containers removed. No Neon, existing records, providers, Teams
  tests, production migrations, env/auth changes, frontend changes, commits, PRs,
  branch switching or deployment. Prior working-tree changes preserved.
- Limits/next: the production profile reader remains retired/empty; compatibility
  profile projections are tested with synthetic facts, not live profiles. This does
  not remove every legacy KSB display projection or prove deployed cache behavior.
  Next cohesive extraction: GET responsibilities still mixed with mutation handlers
  in curriculum_module_detail, curriculum_module_structure and curriculum_group_modules,
  preserving writer branches and current contracts. G01-G05 and release approvals
  remain unchanged; views.py and whole-LMS modernization are not complete.

## Module GET boundary - PASS (2026-11-21)

- Verified correction to the preceding next-step assumption: curriculum_module_detail
  accepts PATCH/DELETE only and returns 405 for GET. It was not changed. Structure
  GET also contains a training-module alias path that can provision/link records;
  that path remains in the legacy handler, with its original expressions, scope,
  exception mapping and link-after-scope order. It is not labelled read-only.
- Before: ordinary Structure GET orchestration/cache/error mapping, Group Modules
  GET, Session Plan HTTP projection and compact module projection remained in views.
  After: catalogue/application/structure_payloads.py owns load_stored_module_structure;
  catalogue/api/module_reads.py owns structure responses, group-module GET and
  session-plan HTTP contracts; application/module_projection.py owns compact rows.
  Existing infrastructure readers/SQL and Domain membership rules remain unchanged.
  No new production package, interface, repository or class was introduced.
- Ordinary structure reads retain the exact cache key, bypass value, targeted read
  scope, missing-target behavior and revision stamped inside the cached payload.
  Cache hits cannot receive a newer revision than their content. API adapters retain
  404/405/sanitized 500 behavior, ordering, duplicates, legacy catalogue aliases,
  session-plan query parameters and public serialization. Group membership policy
  is preserved. No intentional business-rule change or fallback deletion this batch.
- Scope: four production files above plus views.py; **28,658 -> 28,595 lines**, net
  **63 lines removed from views**, net production +79 including composition bindings.
  This is a bounded read extraction, not a 1,000-line migration. The large remaining
  writer/provider handlers were not moved merely to improve the line-count metric.
- Validation: **943 PASS, 0 FAIL, 0 SKIPPED** = 96 disposable PostgreSQL/ORM/HTTP
  cases + 840 selected DB-forbidden fixture cases + 7 standalone source contracts.
  Added two real SQL/HTTP cases and 13 fixture cases. Real tests compare canonical
  and legacy catalogue structure responses with frozen originals, then verify
  bypass refresh after changing synthetic content, including revision/item fingerprints.
  Existing session-plan, membership, catalogue and writer regression selections pass.
- Frozen-source fixture comparisons cover cache-hit/force/missing/error outcomes,
  scope event ordering, training-alias dispatch using writer mocks only, group
  selection/duplicates/input immutability, session-plan output and compact projection.
  Actual extracted owners are invoked/spied on. New standalone checks prove unchanged
  writer branches, common target resolution, signatures/decorators, training payload
  expressions and the cache/error expressions. The historical oracle is not rewritten.
- Initial validation: 96 SQL/HTTP cases passed; one new fixture expected bool False
  instead of the original cache predicate's empty string. Old/new event parity already
  agreed. Corrected that fixture expectation; final full run above passed without
  changing production behavior to satisfy the test.
- Support files: test_module_get_boundary_no_db.py; catalogue/test_module_get_standalone.py;
  catalogue/module_get_snapshot.json; image/integration.py and run_import_smoke.py.
  Import smoke, syntax, frozen-source provenance, unchanged unrelated function/class/
  assignment AST and git diff --check PASS. Graph across 82 catalogue + 26 reporting
  production modules: zero static cycles and forbidden Domain/Application imports.
- Commands: python -B backend/curriculum_api/catalogue/test_module_get_standalone.py;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Evidence: D:/Temp/HP/lms-module-get-boundary/{import-smoke,acceptance-final,
  standalone-final}.log; changes.json, dependencies.json, diffs and pre-task snapshots.
- Isolation verified before initdb/Django: loopback-only disposable PostgreSQL, all
  six aliases local, sanitized source archive, read-only app filesystem, no host
  credentials/external route. Owned containers removed. Provider/calendar ports
  are opaque in the new structure tests; Teams tests and real integrations were not
  run. No Neon/existing data, migrations, frontend/env/auth changes, commits, PRs,
  branch switching or deployment. Existing uncommitted changes preserved.
- Remaining: training-alias GET provisioning/linking and all existing writer branches
  remain legacy responsibilities; HTTP session maintenance and deployed/shared-cache
  behavior are not claimed fully equivalent from these fixtures. The next cohesive
  read-side target is cache/read-scope ownership (cached_curriculum_value,
  curriculum_read_scope and cached catalogue payload readers), preserving epoch,
  TTL, invalidation and response contracts. G01-G05/release approval unchanged.


## Batched catalogue read runtime and archive boundary - PASS (2026-11-21)

- Before: payload caching/read memoization, metadata probes, archive reads and
  responses, placement lineage and Free Course display projection lived in views.
  After: 40 actual function bodies / 1,006 original function lines have owners in
  catalogue Infrastructure, Application, API and one existing Domain package.
  views.py **28,595 -> 27,867**, net **728 lines removed**. Thirteen production
  files changed (views + 12 concrete owner modules); overall production +450 lines
  including explicit composition bindings. This is extraction, not deletion of
  1,006 lines from the project or completion of the whole LMS modernization.
- Infrastructure: payload_cache.py (publication, build locks, compression, keys),
  read_scope.py (nested memoization), schema_reads.py (cached metadata probes),
  archive_reads.py (archive source rows and SQL component counts).
- Application: cached_reads.py (row/payload/section builds), archive_queries.py
  (archive projections), placement_lineage.py (scope/identifier resolution),
  free_course_projection.py (existing canonical and provenance display fields).
  API: read_responses.py, cached_reads.py and archive_reads.py. Domain:
  archive_visibility.py owns the unchanged cohort/group archive predicate.
- Cache invalidation, epoch writes, warming, schema provisioning, restore/delete
  handlers and all other writer/provider functions remain unchanged. Public
  signatures/decorators and SQL/response expressions are preserved. Live epoch
  and read-scope getters retain concurrent invalidation and late scope binding;
  no copied generation can publish stale in-flight builds. Arbitrary cache-key
  shaping options are passed as a mapping to avoid collisions with injected ports.
- Corrected two obsolete docstrings: the epoch is database-backed, and placement
  lineage is not the effective membership policy or a name-matching fallback.
  No business fallback was removed blindly. Existing archive-count failure-to-empty
  behavior and legacy provenance fields remain explicit compatibility limits.
- Final validation: **1,020 PASS, 0 FAIL, 0 SKIPPED** = 99 disposable PostgreSQL/
  ORM/HTTP cases + 917 selected DB-forbidden fixtures + 4 standalone contracts.
  Added 3 real PostgreSQL cases, 20 frozen-source parity fixtures and 4 source
  contracts. Existing cache concurrency, forced-read reuse, TTL/fingerprint,
  metadata, archive, membership, catalogue and writer regression cases pass.
- Real SQL checks cover schema metadata, archive component aggregation and all
  six lineage levels; HTTP checks cover archive missing/live/method guards.
  New fixtures cover archive list/structure output/error paths, Free Course IDs,
  cache force/shared/compressed/error behavior, nested read scopes and native-mode
  separation, pagination, ETags and source ordering. Existing APIs still compose
  the actual extracted owners; the oracle compiles frozen original source.
- Initial run: 99 SQL cases passed; 3 newly selected existing TTL tests produced
  5 Resolver404 subcase errors because the isolated URLconf lacked their routes.
  Added the exact production route mappings to the test URLconf; no assertions
  or production URLs changed. Final full selection above passed. Earlier oracle
  diagnostic reruns are not counted in the final total.
- Syntax, frozen-source provenance, all unrelated views AST, git diff --check and
  isolated import smoke PASS. Static graph: 94 catalogue + 26 reporting modules,
  zero cycles and forbidden Domain/Application imports. Four standalone checks
  rerun after comment-only corrections; executable bodies remain exact apart
  from the documented live-state access and explicit dependency parameters.
- Commands: python -B backend/curriculum_api/catalogue/test_read_runtime_standalone.py;
  python -B backend/phase1f_tests/image/run_import_smoke.py;
  python -B backend/phase1f_tests/image/run_integration.py; git diff --check.
  Evidence: D:/Temp/HP/lms-catalogue-read-batch/ (pre-task snapshots, changes.json,
  dependencies.json, import-smoke.log, acceptance-final.log, standalone-final.log).
- Isolation re-proven before initdb/Django: disposable loopback-only PostgreSQL,
  all six aliases local, sanitized source bundle, read-only app filesystem,
  no host credentials or external routes. Owned containers removed. No Neon,
  existing data, production schema/env/auth/provider changes, Teams tests,
  frontend edits, Git branch changes, commits, PRs, pushes or deployment.
- Remaining: legacy composition/shared state remains in views; this does not prove
  deployed cache, full authorization or complete endpoint equivalence. Next read
  batch: remaining learner directory and placement consumers, beginning with
  assigned_learners_for_programme/assigned_learners_for_scope and tutor workspace
  query assembly, preserving identity, lifecycle and assignment contracts.
  Existing work is preserved on Architecture at 606aca43df97967e8cb1fab45c5a794cc0635246.
  G01-G05 and release approvals remain unchanged.

### Learner Directory and Tutor Workspace read boundary - PASS (2026-11-21)

- Before: programme SQL, placement narrowing, directory HTTP/result construction,
  progress selection and tutor workspace query assembly lived in legacy modules.
  After: 12 original functions (378 source lines) split across 10 concrete owners.
  `views.py`: 27,867 -> 27,655 (-212); `learner_directory.py`: 80 -> 41 (-39);
  `learner_directory_details.py`: 167 -> 131 (-36). Net legacy reduction: 287;
  net production size: +128 lines including explicit composition and contracts.
  These are responsibilities moved, not 378 lines of deleted application logic.
- New `curriculum_api/directory/`: Infrastructure `assigned_reads.py` owns exact
  programme/profile SQL, schema checks and existing strict/error behavior;
  Application `assigned_reads.py`, `queries.py`, `progress.py` own scope queries,
  profile projections, deduplication/status/order and verified progress selection;
  Domain `placement.py`, `progress.py` own ID narrowing and due/available rules;
  API `queries.py` owns directory request validation and response construction.
  Five package markers accompany real modules; no empty architectural layers.
- Catalogue adds Application `tutor_workspace.py`, Infrastructure
  `workspace_reads.py`, API `tutor_workspace.py`. Existing session/provider read
  remains an opaque, unchanged capability; all workspace tests stub that port.
  Current tutor identity matching, assignment grants, SQL joins/order, module
  projection and numeric-to-string JSON serialization are preserved.
- Public signatures, URLs, decorators, auth, request scope, strict failures,
  profile/enrolment separation (including zero/missing bridges), manual/inherited
  modes, lifecycle filtering and exact progress import links remain compatible.
  Existing module_assignment_roster and compact membership policy are not merged:
  the directory's nonempty module-reference explicitness is retained as-is.
  Corrected stale name-fallback comments/docstring; no identity fallback removed
  without behavioral evidence. Existing optional soft-empty reads and tutor
  name matching remain compatibility limits, not newly introduced fallbacks.
- Final validation: **1,065 PASS, 0 FAIL, 0 SKIPPED** = 103 disposable PostgreSQL/
  ORM/HTTP + 957 selected DB-forbidden fixtures + 5 standalone source contracts.
  Added 4 PostgreSQL cases, 18 frozen-original parity cases and 5 source contracts;
  selected 22 existing directory/progress tests. Existing membership, catalogue,
  reporting and isolated writer suites still pass. HTTP oracle explicitly binds
  frozen original URL callbacks, rather than merely patching module attributes.
- Initial test-harness issues resolved without application behavior changes:
  synthetic bundle now contains an empty coach booking asset (no real staff or
  provider URLs); disposable module fixture now has the existing query's color
  column; cursor doubles use context managers; numeric response assertion uses
  the actual unchanged string "6.00". Two stale existing fixture setups corrected:
  memoization observes the schema probe instead of a retired identity helper;
  bounded progress mocks the placement hydration port and asserts its input.
  The original and new memoization source both pass the same cache contract.
- Syntax, full unrelated legacy AST/writer preservation, exact SQL/projection
  source checks, package import checks, new-file whitespace and git diff --check
  PASS. Static runtime import graph: 338 -> 353 curriculum modules; 3 existing
  cyclic components unchanged. 132 catalogue/reporting/directory modules form
  no cycles; new Application/Domain imports have no infrastructure/framework or
  reverse legacy-views edge. This is not a claim that all legacy cycles are gone.
- Commands: python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/directory/test_boundary_standalone.py;
  git diff --check. Evidence: D:/Temp/HP/lms-directory-workspace/
  (before.json and snapshots, extraction.json, diffs/, changes.json,
  dependencies.json, acceptance-final.log, standalone-final.log).
- Isolation proven before initdb/Django: no external route, disposable loopback
  PostgreSQL, all six aliases local, read-only app filesystem, sanitized source
  bundle with synthetic data only. Owned containers removed. No Neon, existing
  database, provider, Teams test, frontend, env/auth, Git branch, commit, PR,
  push, merge or deployment changes. Existing Architecture work preserved.
- Remaining: directory progress HTTP/journal/ORM source acquisition and the
  existing module_assignment_roster reader still compose through legacy modules;
  tutor meeting reader and identity/assignment compatibility remain unchanged.
  Next cohesive read step: separate those directory progress and normalized-plan
  read adapters, preserving journal identity and the frozen writer guards.
  G01-G05 and release approvals remain unchanged; no full endpoint/deployment or
  provider equivalence is claimed from these bounded tests.


### Directory Progress and Membership Read Convergence - PARTIAL (2026-11-21)

- Implementation complete; extended acceptance remains PARTIAL because three
  newly selected, unchanged AssignmentTests also fail against the actual
  pre-task production files. No assertion was weakened or failing test excluded.
- Extracted 15 legacy functions (318 original source lines), including deletion
  of the duplicate membership decision body. Count, batch and compact-module
  readers now share learning_plans/domain/membership_policy.py; its executable
  policy is unchanged. Frozen-original preflight: 256/256 synthetic cases match.
- Application: directory/application/{assignment_queries,status_queries}.py,
  existing directory/application/progress.py, and learning_plans/application/
  module_membership.py. Infrastructure: directory/infrastructure/
  {assignment_reads,registration_reads,lineage_reads}.py and learning_plans/
  infrastructure/plan_reads.py. HTTP validation/error mapping:
  directory/api/progress.py. Existing public wrappers/decorators remain intact.
- Before -> after: learner_assignments.py 503 -> 411; learner_status_counts.py
  199 -> 86; learner_directory_details.py 131 -> 115; module_plan_rows.py
  139 -> 139 (read guards delegated, writers unchanged). Net legacy reduction:
  221 lines. views.py unchanged at 27,655. Net production change +126 lines
  across 14 files, including seven new concrete owners; no empty packages.
- Preserved query text, ordering, source/profile identities, missing/zero bridges,
  manual/inherited membership, ambiguous facts, lifecycle-filter differences,
  per-learner versus whole-request errors, journal/viewAsCoach and UK dates.
  Deferred direct-profile display projection preserves excluded-profile laziness.
  Directory nonempty-module-reference explicitness still differs from compact
  membership's ANY normalized plan row; synthetic null-row parity covers both.
  No automatic merger of those different contracts or new JSON fallback.
- Actual selected results: 1,175 PASS / 3 FAIL-or-ERROR / 0 SKIPPED =
  107/107 disposable PostgreSQL/ORM/HTTP; 1,021/1,024 DB-forbidden fixtures;
  47/47 standalone tests. Added four real PostgreSQL cases, 16 frozen-original
  fixture cases and six standalone source contracts. Existing isolated POST/
  DELETE persisted-state and rollback tests pass. Do not count diagnostic
  reruns as additional distinct coverage; full runner exits 1, not green.
- Unchanged failures in tests_learner_assignments.AssignmentTests:
  test_cohort_includes_every_target_module_and_preserves_other_modules lacks
  the current _state/using profile fixture; test_single_module_after_empty_plan_
  never_inherits_group_siblings calls _serialize without canonical_plan and
  plan_version; test_unsaved_learner_keeps_modules_they_already_inherit supplies
  no canonical group placement to the preset reader. All three reproduced with
  original pre-task modules in a separate no-network, dummy-DB container.
  Align these fixtures with current canonical contracts before a green acceptance
  claim; production writer and serializer changes are outside this batch.
- Test setup fixes only: progress date stub now replaces its local timezone
  binding, preserving the real session clock; manual-roster fixture patches
  the local connection object rather than corrupting shared Django vendor state.
- Static checks PASS: 15 frozen bodies match pre-task sources; all 28 protected
  non-extracted functions unchanged; SQL/projection contracts, syntax and diff
  whitespace pass. Runtime import graph: 353 -> 359 curriculum modules, three
  existing cyclic components unchanged. Including reviewed learning_plans:
  360 -> 367 modules; same three components. All 145 extracted boundary modules
  are acyclic; no new framework/infrastructure/legacy-views import in Application.
- Commands: python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/directory/test_progress_membership_standalone.py;
  python -B backend/learner_api/learning_plans/domain/test_membership_policy_standalone.py;
  python -B backend/learner_api/learning_plans/domain/test_membership_caller_parity_standalone.py;
  python -B backend/learner_api/learning_plans/domain/test_membership_integration_standalone.py;
  python -B backend/learner_api/learning_plans/application/test_module_membership_standalone.py;
  git diff --check. Evidence: D:/Temp/HP/lms-progress-membership-batch/
  (before snapshots, diffs, changes.json, dependencies.json, policy-preflight.json,
  acceptance-2.log, standalone logs, prebatch-failures.log).
- Isolation verified before initdb/Django: network none/loopback, no host mounts
  or credentials, six disposable aliases, synthetic records only. Owned containers
  removed. No Neon, provider, Teams tests, frontend, env/auth, production-schema, writer-body,
  branch, commit, PR, push or deployment changes. Prior Architecture work preserved.
- Limits: progress content loader is stubbed in the new HTTP test; full My Learning
  data/provider equivalence and live performance are not demonstrated. Compatibility
  composition and old cycles remain. Next immediate step: repair the three stale
  test fixtures while keeping production semantics, then resume remaining legacy
  extraction. G01-G05 and release approvals are unchanged.


### Assignment Fixture Repair and Content Validation Boundary - PASS (2026-11-21)

- Closed the previous directory/membership batch's three stale-fixture blockers.
  All existing selected tests remain enabled. The cohort test now verifies the
  exact linked-profile FK update on the enrolment alias and unchanged registration
  display fields. Preset tests supply canonical group identity; the serializer
  receives canonical_plan/plan_version and proves the available sibling preset
  never enters the displayed plan. Added assertions; no production writer fix.
- Extracted 16 functions / 320 original lines from views into two concrete owners:
  catalogue/domain/content_validation.py (types, URLs, hours/reflection semantics,
  retired-content filtering, duplicate keys and partial-read guards), and
  catalogue/application/content_validation.py (component/module/KSB validation
  orchestration with explicit existing source-read callbacks). No new persistence
  layer or empty package. Existing views signatures remain compatibility exports.
- Before -> after: views.py 27,655 -> 27,423 (-232). Production files: three,
  including two new owners; net production change +148 lines. Unrelated original
  views bytes and all non-extracted AST definitions remain intact. Existing writer,
  transaction, authentication, provider and schema implementation bodies unchanged.
- Behavior preserved: ordered error paths/messages; in-place settings normalization;
  explicit empty reflection versus missing-field compatibility; uploaded MP4 URL
  restrictions; source lookup short-circuits/cache reuse/errors; retired filtering;
  partial-read save refusal before database access. No legacy fallback removed
  without evidence that it misrepresents the supported input contract.
- Final actual validation: 1,157 PASS / 0 FAIL / 0 SKIPPED = 107 disposable
  PostgreSQL/ORM/HTTP + 1,044 DB-forbidden fixtures + six standalone contracts.
  The fixture suite increased from 1,024: 15 new frozen-original parity methods
  plus five existing PartialReadSaveGuardTests. The previous 47 membership-only
  standalone cases were not rerun or counted this turn. Full isolated runner exits
  zero. Initial fixture-only run revealed a missing dynamically imported test
  dependency in the sanitized bundle; an explicit reviewed import corrected it.
- Frozen-source parity executes the original functions against actual new owners,
  checks mutated input as well as outputs/exceptions, and preserves source-cache
  identity. Six standalone tests also verify exact extracted bodies (two local
  imports become injected ports), all other views AST, public contracts and pure
  import safety. Syntax, new-file whitespace and git diff --check PASS.
- Import graph: curriculum runtime modules 359 -> 361; including learning_plans
  367 -> 369. Three pre-existing cyclic components unchanged; all 147 reviewed
  extracted-boundary modules remain acyclic. New owner imports are stdlib only.
- Commands: python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/catalogue/test_content_validation_standalone.py;
  git diff --check. Evidence: D:/Temp/HP/lms-assignment-contracts-batch/
  (before snapshots, extraction.json, diffs, changes.json, dependencies.json,
  fixture-repair.log, acceptance-1.log, standalone-final.log).
- Same verified Architecture branch/HEAD. Disposable network isolation verified
  before initdb/Django; six local aliases, synthetic data, no host mounts/env,
  no provider calls. Owned containers removed. No Neon, Teams tests, frontend,
  migration, existing database, Git commit/PR/push/merge or deployment operations.
- Remaining: legacy composition/import cycles and most writer/provider code remain;
  bounded validation parity does not certify every authoring workflow or production
  performance. Next cohesive candidate: attachment payload construction and catalogue
  candidate selection, preserving identity/ranking and all persistence behavior.
  G01-G05 and release approvals remain unchanged.


### Attachment Preparation and Content Preservation Boundary - PASS (2026-11-21)

- One coherent batch: 22 functions / 646 original implementation lines extracted.
  views.py 27,423 -> 26,926 (-497). Five new concrete owners, six production files
  total; net production +261 lines including explicit composition contracts.
  Original public signatures remain; all 54 statically identified call sites keep
  their compatibility exports. No new persistence flow or architectural package.
- Responsibilities now owned by catalogue/domain/attachment_content.py (identity,
  week/session counts, authored-content protection, date-window rules),
  catalogue/domain/structure_changes.py (partial structure deltas and assurance
  flags), catalogue/application/attachment_preparation.py (candidate selection,
  structure choice and attachment payloads), catalogue/application/course_conversion.py
  (module/free-course content-copy shapes), and
  catalogue/infrastructure/attachment_reads.py (existing component aggregate SQL).
- Preserved canonical-ID conflict checks, title/context matches, stable candidate
  ranking/ties, explicit free-course identity, current-ID retention on equal content,
  missing versus explicitly blank tutor/cover/calendar fields, stored weeks and
  components, partial-save order/conflicts, and missing/false assurance flags.
  Existing read/setup callback order and exception handling remain exact. Setup
  callbacks are legacy capabilities, not a claim that every caller is read-only.
  No unsupported legacy fallback was removed; stored-content preservation remains.
- Final validation: 1,194 PASS / 0 FAIL / 0 SKIPPED = 109 disposable PostgreSQL/ORM/
  HTTP tests + 1,067 DB-forbidden fixtures + 18 standalone checks. Added two real
  PostgreSQL catalogue/aggregate parity tests, 23 frozen-original parity methods
  and six standalone contracts. Existing six conversion and six validation tests
  passed. Original-source oracle is verified against the pre-turn snapshot.
- Initial run: 108/109 PostgreSQL passed; new attachment fixture reached unrelated
  delivery-enrichment tables missing from the isolated schema. Explicit delivery
  doubles now match the established catalogue fixture boundary; catalogue SQL,
  component aggregates and structure reads still execute for real. Second full
  run exits zero. No coverage removed to hide a failure. Teams behavior untested.
- Test-only adjustments: conversion tests load the new pure owner; the earlier
  validation AST guard restores the reviewed attachment originals before comparing
  its prior hash. All other views bytes/AST, including writers, transactions,
  authentication, HTTP handlers, providers and schema code, remain unchanged.
- Syntax and git diff --check PASS. Runtime static graph: curriculum 361 -> 366
  modules; including learning_plans 369 -> 374. Three pre-existing cyclic SCCs
  unchanged; all 152 reviewed boundary modules acyclic. New owners have no reverse
  imports; only the aggregate adapter imports stdlib collections.Counter.
- Changed support files: catalogue/attachment_preparation_snapshot.json,
  catalogue/test_attachment_preparation_standalone.py,
  test_attachment_preparation_boundary_no_db.py, test_free_course_convert_no_db.py,
  catalogue/test_content_validation_standalone.py, image/integration.py,
  image/run_import_smoke.py and this tracker. No frontend changes.
- Commands: python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/catalogue/test_attachment_preparation_standalone.py;
  python -B backend/curriculum_api/test_free_course_convert_no_db.py;
  python -B backend/curriculum_api/catalogue/test_content_validation_standalone.py;
  git diff --check. Evidence: D:/Temp/HP/lms-attachment-preparation-batch/
  (before snapshots, extraction.json, callers.json, changes.json, diffs,
  dependencies.json, acceptance-1.log and acceptance-2.log).
- Existing Architecture branch/HEAD preserved. Loopback-only Docker isolation
  proved before initdb/Django; six local aliases, synthetic data, no host mounts,
  credentials or network. Owned containers removed. No Neon, Teams tests,
  production provider operations, commits, PRs, pushes, merges or deployment.
- Remaining: legacy composition and three old cycles; full attachment writer and
  delivery-provider integration are outside this batch. These results do not
  certify every authoring flow or production performance. Next coherent candidate:
  cohort/group authoring payload preparation and related metadata rules, preserving
  all persistence/transaction boundaries. G01-G05/release approvals unchanged.

### Hierarchy Preparation and Lifecycle Guard Boundary - PASS (2026-11-21)

- Accelerated batch: 103 functions / 2,006 original implementation lines moved
  from views.py into 11 concrete owners. views.py 26,926 -> 25,616 (-1,310).
  Twelve production files changed; net production +1,182 lines from explicit
  dependency parameters, compatibility composition and module documentation.
  This is responsibility extraction, not a claim of total code-size reduction.
- Domain: catalogue/domain/{hierarchy_dates,hierarchy_values,content_values}.py
  owns delivery/EPA/holiday date calculations, hierarchy identity/archive rules,
  content assurance and KSB mapping values. No Django, SQL, persistence or provider
  imports/capabilities. Application: catalogue/application/{hierarchy_preparation,
  hierarchy_queries,lifecycle_checks,content_preparation}.py owns cohort/group
  payloads, hierarchy lookups, deletion eligibility/plans and free-course/KSB
  preparation. Infrastructure: catalogue/infrastructure/{lifecycle_reads,
  free_course_reads}.py owns existing guard and free-course query construction.
  API: catalogue/api/{authoring_guards,delivery_scope}.py owns existing HTTP
  preconditions and request scope. No empty packages or new class hierarchy.
- Public signatures/decorators remain unchanged, including scoped free-course
  read caching. Five former local imports are explicit lazy capabilities in the
  compatibility caller; timing, mock bindings and exceptions are preserved.
  All other views bytes are unchanged against the pre-turn snapshot, including
  actual writers, deletion execution, transactions, authorization and handlers.
  Legacy setup/calendar callbacks retain their existing capabilities; this does
  not make every preparation caller pure or read-only. No unproven fallback removal.
- Preserved missing/zero/cleared EPA and OTJH values, stored override retention,
  holiday exclusions, programme/cohort/group identity, stable order, archive and
  restoration rules, retained-content blockers, KSB deduplication and shared
  free-course ownership. Frozen-original source matches the pre-turn source;
  parity fixtures invoke and spy on all 103 actual extracted functions.
- Final validation: 1,269 PASS / 0 FAIL / 0 SKIPPED = 111 disposable PostgreSQL/
  ORM/HTTP tests + 1,134 DB-forbidden fixtures + 24 standalone checks. Added two
  real SQL parity tests (stored authoring dates/no persistence and deletion
  blockers/restore candidates), 67 synthetic parity methods and six source checks.
  Final integration runner exit 0; no tests removed or broad discovery used.
- Initial new-fixture failures were corrected: supply the excluded holiday inside
  the contracted period; compare context-manager exception details rather than
  traceback object identity. Final diff review restored two accidentally re-encoded
  pre-existing Unicode fixture lines exactly, followed by a successful full rerun.
  No production behavior was changed to obtain passing tests.
- Syntax and git diff --check PASS. Runtime graph: curriculum 366 -> 377 modules;
  including learning_plans 374 -> 385. Three pre-existing cyclic SCCs unchanged;
  all 163 reviewed boundary modules acyclic. New owner modules have no imports.
- Support files: catalogue/hierarchy_preparation_snapshot.json,
  catalogue/test_hierarchy_preparation_standalone.py,
  test_hierarchy_preparation_boundary_no_db.py,
  catalogue/test_content_validation_standalone.py, image/integration.py,
  image/run_import_smoke.py and this tracker (19 changed files in this batch).
- Commands: python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/catalogue/test_hierarchy_preparation_standalone.py;
  python -B backend/curriculum_api/catalogue/test_attachment_preparation_standalone.py;
  python -B backend/curriculum_api/catalogue/test_content_validation_standalone.py;
  python -B backend/curriculum_api/test_free_course_convert_no_db.py; git diff --check.
  Evidence: D:/Temp/HP/lms-hierarchy-preparation-batch/ (before snapshots,
  extraction.json, changes.json, diffs, dependencies.json, validation.json,
  acceptance-final.log and standalone.log).
- Architecture branch/HEAD and prior changes preserved. Docker loopback isolation
  proved before initdb/Django; six disposable local aliases, synthetic records,
  no host credentials/mounts/external network. Owned containers removed. No Neon,
  Teams tests, provider calls, frontend, migration, environment or Git mutations.
- Remaining: legacy composition/cycles and substantial writer/provider code remain.
  These bounded tests do not establish every authoring workflow, live provider
  behavior or production performance. Next candidate: consolidate related catalogue
  composition/callers to reduce remaining compatibility plumbing, preserving the
  extracted owners and existing transaction boundaries. G01-G05/release unchanged.

### Quality History, Audit Assets and KSB Domain Boundary - PASS (2026-11-21)

- Accelerated the same modernization beyond views.py: 2,046 original source lines
  relocated, covering 84 functions and 21 constant groups (includes the intact
  428-line pure KSB module). Eleven new concrete owners; 14 production files,
  21 files including tests/tracker. No new architectural package or interface.
  quality.py 1,081 -> 332; programme_audit.py 1,153 -> 727;
  ksb_coverage.py 428 -> 29. Combined legacy reduction: 1,574 lines.
  views.py remains 25,616 lines. Net production +792 lines from explicit ports
  and compatibility composition; these figures do not claim overall code deletion.
- reporting/domain/{ksb_coverage,history_values,history_labels}.py now owns pure
  KSB calculations, history windows/attribution and display contracts. Coverage
  moved byte-for-byte with explicit compatibility re-exports and no second live
  implementation. reporting/application/history_projection.py builds event and
  record shapes; reporting/infrastructure/history_reads.py owns existing revision
  lookup, actor-facet and scope SQL; reporting/api/history.py owns HTTP history
  responses. Existing public signatures, GET/cache decorators and callers remain.
- catalogue/domain/{asset_values,asset_contracts}.py owns asset/source identity,
  embed classification and field contracts; catalogue/application/audit_assets.py
  owns payload traversal, asset projection/deduplication and serialization;
  catalogue/infrastructure/audit_asset_reads.py owns material/schema/asset SELECTs;
  catalogue/api/audit_assets.py owns status/material responses and role refusals.
  URL conversion only constructs strings; no provider requests were executed.
- Preserve Decimal rounding, full/summary/totals coverage, source-qualified KSB
  identities, duplicate handling, ancestry, material ordering, stored revision
  snapshots, privacy redaction, structured attribution precedence, errors, cache
  headers and missing-store responses. Existing historical reason-tag support
  remains necessary for old records; canonical history still uses recover=False
  and never fabricates timestamp-derived events or actor names.
- Frozen originals verified against pre-turn files. New comparisons invoke all
  65 extracted quality/asset owners and preserve recursive call counts, outputs,
  mutated inputs and watched SQL/callback order. All 19 KSB functions compared,
  including 32 deterministic multi-source fixture sets. All other legacy source
  bytes, including asset imports/sync, provisioning and writes, are unchanged.
- Final validation: 1,304 PASS / 0 FAIL / 0 SKIPPED = 113 disposable PostgreSQL/
  ORM/HTTP tests + 1,156 DB-forbidden fixtures + 35 standalone tests. Added 15
  caller parity tests, 11 standalone tests and two PostgreSQL checks. Also ran
  six existing programme-material tests and only tests_lean_log.WindowTests;
  no Teams tests selected. PostgreSQL verified actual newest-revision/count/
  snapshot SQL and material/asset ordering/counts against synthetic fixture tables.
- First full run: all 113 PostgreSQL tests passed; one new parity assertion
  incorrectly expected a recursive traversal to call its owner once. It now
  compares original/new recursive call counts. Full rerun exits zero; no production
  changes or removed assertions were needed to make behavior match.
- Syntax, unchanged-source checks and git diff --check PASS. Runtime graph:
  curriculum 377 -> 388 modules; including learning_plans 385 -> 396. Three
  pre-existing cyclic SCCs unchanged; 174 reviewed boundary modules acyclic.
  New owners import no legacy views/infrastructure; KSB imports only stdlib.
- Support: reporting/quality_assets_snapshot.json,
  reporting/test_quality_assets_standalone.py, test_quality_assets_boundary_no_db.py,
  image/quality_assets_postgresql.py, image/integration.py, image/run_import_smoke.py
  and this tracker. Existing standalone hierarchy/attachment/content/conversion
  checks also passed. Commands: python -B backend/phase1f_tests/image/run_integration.py;
  python -B backend/curriculum_api/reporting/test_quality_assets_standalone.py;
  python -B backend/curriculum_api/catalogue/test_hierarchy_preparation_standalone.py;
  python -B backend/curriculum_api/catalogue/test_attachment_preparation_standalone.py;
  python -B backend/curriculum_api/catalogue/test_content_validation_standalone.py;
  python -B backend/curriculum_api/test_free_course_convert_no_db.py; git diff --check.
- Evidence: D:/Temp/HP/lms-quality-assets-batch/ (before snapshots, extraction.json,
  changes.json, diffs, validation.json, dependencies.json, acceptance-2.log,
  standalone.log). Docker loopback isolation verified before initdb/Django; six
  disposable local aliases, no host credentials/mounts/external network. New
  fixture schemas rolled back and owned containers removed. No Neon, providers,
  production data/schema changes, Teams tests, Git commit/PR/push/merge/deployment.
- Remaining: history HTTP orchestration still constructs some SQL filters and
  response-specific read sequences; further separation can reuse these established
  parity fixtures. Asset import/writer/provider paths and legacy composition cycles
  remain. Tests do not establish every end-to-end authorization path or production
  performance. Architecture branch/HEAD and unrelated work preserved; G01-G05 and
  release approvals remain unchanged.


### Revision History and Merge Policy Boundary ? PASS

- Continued on Architecture / 606aca43df97967e8cb1fab45c5a794cc0635246.
  Relocated 1,728 original source lines across eight concrete owners (including
  the 681-line pure merge policy moved byte-for-byte). Eleven production files;
  21 files total with tests and this tracker. No new package or interface layer.
- Before -> after: versioning.py 2,000 -> 1,419; module_merge.py 681 -> 40;
  reporting/api/history.py 441 -> 264. Legacy reduction 1,399 lines; production
  net +568 from explicit dependency ports and compatibility composition.
  views.py remains 25,616 lines; these figures do not imply its extraction.
- reporting/domain/{revision_contracts,snapshot_values,snapshot_changes,
  snapshot_context}.py owns shared registrations, privacy/normalization,
  differences, lifecycle/file-event decisions and historical ancestry values.
  All 35 extracted revision functions compared with frozen actual originals;
  signatures and non-selected versioning bytes (writers, actor/state handling,
  provisioning and transaction machinery) remain unchanged. Mutable registries
  preserve shared object identity; no duplicate live implementation.
- reporting/infrastructure/revision_reads.py owns capability probes, ancestry,
  latest revisions and publication counts. history_queries.py owns history SQL;
  application/history_results.py assembles result dictionaries. The HTTP adapter
  now contains no SQL literals. Canonical recover=False, parameter ordering,
  scopes, pagination, privacy and successful response bytes are preserved.
- catalogue/domain/module_merge.py owns the existing pure three-way comparison
  and conflict rules (23 functions, three existing classes); the old module
  re-exports the same objects. No save handler, lock or writer is changed.
- Intentional correction under the user's prior misleading-fallback removal
  instruction: failed version summary/totals or record timeline reads now return
  an explicit 503 error. Totals no longer fabricate a successful zero count;
  read failures no longer claim the history store is uninstalled. Actual missing
  store, empty results and successful payloads retain their contracts. Existing
  frontend fetchJson/error handling accepts the error; no frontend code changed.
- Final validation: 1,366 PASS / 0 FAIL / 0 SKIPPED = 116 disposable PostgreSQL/
  ORM/HTTP + 1,166 DB-forbidden fixtures + 84 standalone cases. New checks include
  18 standalone revision/source tests, five HTTP/assembly cases, three real SQL
  checks, five existing snapshot cases and 30 explicit non-Teams merge cases.
  No duplicated imported TestCase selection is counted. Existing standalone
  quality/coverage and hierarchy/attachment/content/conversion tests also pass.
- PostgreSQL checks cover real capability/latest/ancestry SQL and canonical feed
  scope/paging/HTTP bytes. First runtime attempt missed new readers in the static
  source bundle; explicit targets fixed it. A synthetic empty diff was correctly
  excluded by existing policy; the fixture now contains a real change. No
  production logic was altered to make those fixture failures pass.
- Final runner: python -B backend/phase1f_tests/image/run_integration.py.
  Standalone commands and exact non-Teams merge selections are recorded in
  D:/Temp/HP/lms-revision-history-batch/{standalone.log,standalone-final.log}.
  Final integration evidence: acceptance-4.log; extraction/diffs/validation and
  dependency results are in the same directory. Runtime loopback-only isolation
  was proved before initdb/Django; six local disposable aliases, synthetic data,
  no host mounts/credentials or external network; owned containers removed.
- Syntax and git diff --check PASS. Curriculum graph 388 -> 396 modules;
  including learning_plans 396 -> 404. Three existing cyclic SCCs unchanged;
  all 182 reviewed boundary modules acyclic. No Neon/provider/Teams operations,
  production data/schema changes, environment changes, commit/PR/push/deployment.
- Remaining: legacy writer/composition responsibilities and existing cycles;
  full end-to-end permissions, production performance and whole-LMS legacy
  elimination are not established by this batch. Existing compatibility for
  historical reason tags remains necessary. G01-G05/release approvals unchanged.


## Catalogue test layout and contract maintenance - PASS (2026-11-21)

- Before: catalogue/ mixed 30 standalone test modules and 32 frozen source JSON
  fixtures with 117 production modules across API/Application/Domain/Infrastructure.
  After: tests/parity/ owns the same 30 modules; tests/fixtures/legacy_snapshots/
  owns the same 32 byte-identical fixtures. The root has the four production
  layers, tests/ and its existing package marker (generated bytecode excluded).
  No empty unit/integration packages or old-path compatibility loaders were added.
- Updated 35 existing external test/runner files, including split fixture paths,
  dynamic component-settings test loaders and the Docker source bundle. The
  isolated catalogue oracle reads the canonical fixture path, with its original
  hash assertion intact. Tests README records the current executable commands;
  older tracker entries retain their historical paths.
- Pre-move standalone baseline: 148 cases, 144 PASS / 3 FAIL / 1 ERROR. Four older
  checks still targeted pre-extraction bodies: group projection, session-plan
  HTTP adapter, overview cache owners, and the programme configuration index.
  Rebound checks to actual current owners and verified caller bindings; the
  programme oracle loads the real frozen pre-extraction helper. No snapshot was
  regenerated, test removed, expected business behavior changed or skip added.
  Same 148 method names; explicit assertion calls increased from 421 to 437.
- Final: 1,440 PASS / 0 FAIL / 0 SKIPPED = 148 standalone catalogue + 10 standalone
  KSB compatibility + 116 disposable PostgreSQL/ORM/HTTP + 1,166 DB-forbidden
  fixtures. Counts exclude baseline and repeated validation runs. One missed
  dynamically assembled fixture path was found on the first relocated run and
  corrected; final scoped unittest discovery is green.
- Commands (repository root):
  - python -B -m unittest discover -s backend/curriculum_api/catalogue/tests/parity -p "test_*standalone.py" -v
  - python -B backend/curriculum_api/test_ksb_count_compatibility_standalone.py -v
  - python -B backend/phase1f_tests/image/run_integration.py
- Docker isolation was proved before initdb/Django: loopback-only disposable
  PostgreSQL, no host mounts/credentials/external route, six disposable aliases,
  synthetic data, cache workers disabled; owned containers removed afterward.
  No Neon/provider operations. Teams test loader references received path-only
  updates; Teams and recording/provider suites were not run.
- Production Python unchanged, including all 117 catalogue owners and views.py
  (25,616 lines). Reviewed legacy bindings still have production consumers, so
  none were removed merely for appearance. No application-to-test import edges.
  Curriculum graph unchanged: 396 modules, three existing cyclic SCCs; 175
  catalogue/directory/reporting boundary modules remain acyclic. Syntax and
  git diff --check PASS. Branch/HEAD unchanged; no commit/PR/push/deployment.
- Evidence: D:/Temp/HP/lms-catalogue-layout-20261121-163659/ contains before hashes,
  moves.json, reference_changes.json, review.json, wrapper_callers.json,
  dependencies.json and final standalone-discovery.log, ksb-standalone.log,
  integration.log. Existing dirty work was preserved.
- Remaining: simplify genuinely redundant legacy composition only after caller
  migration; continue coherent production responsibility extraction. This batch
  organizes regression assets and restores stale checks; it does not establish
  whole-LMS completion or close G01-G05/release approvals.

## Directory, reporting and learning-plan test layout - PASS (2026-11-21)

- Before: directory mixed two test modules/two snapshots into its root;
  reporting mixed six tests/seven snapshots into its root; learning_plans kept
  five tests/two snapshots inside production layers. After: all 13 tests and
  11 byte-identical source snapshots live under each context's tests/ directory.
  Directory/reporting use parity/; learning_plans uses unit/, parity/ and
  integration/. All snapshots use fixtures/legacy_snapshots/. Package markers
  exist only for populated test packages; no empty production layers were added.
- Updated eight external boundary tests, the shared Docker bundle/integration
  fixture paths and two active verification/release manifests. Added three
  concise tests/READMEs. Historical tracker paths remain historical. No duplicate
  fixture copies or old-path loaders remain in active Python references.
- Standalone baseline and final: the same 109 cases PASS. The pre-move isolated
  runtime harness failed before Django setup because its source extraction still
  expected the placement helper body in views.py. It now uses the actual pure
  directory owner and explicitly permits the inspected current read owners.
  All eight runtime case names/assertions and fail-closed I/O guards remain.
  Added the shared run_membership_runtime.py Docker launcher with an explicit
  source allowlist (including the attendance source consumed by the oracle).
- Final: 1,399 PASS / 0 FAIL / 0 SKIPPED = 109 standalone + eight synthetic
  Django import/HTTP cases + 116 disposable PostgreSQL/ORM/HTTP cases + 1,166
  DB-forbidden fixtures. Repeated runs and the baseline are not double-counted.
  Commands: guarded standalone runner in the evidence directory; python -B
  backend/phase1f_tests/image/run_membership_runtime.py; python -B
  backend/phase1f_tests/image/run_integration.py.
- Runtime isolation was verified before Django/initdb: loopback only, no host
  mounts/credentials/external routes. The eight-case runtime has no database;
  PostgreSQL checks use six disposable aliases and synthetic records. Owned
  containers were removed. No Neon/provider operations or Teams tests ran.
- Production Python unchanged; views.py remains 25,616 lines. No application
  imports tests. Combined curriculum/learning_plans graph remains 404 modules
  and three existing cyclic SCCs; all 182 reviewed boundary modules are acyclic.
  Syntax, unchanged fixture hashes and git diff --check PASS. Architecture/HEAD
  and all unrelated work preserved; no commit, PR, push, merge or deployment.
- Evidence: D:/Temp/HP/lms-context-tests-20261121-164851/ contains before hashes,
  moves.json, task.diff, review.json, dependencies.json, standalone-before/after
  logs, runtime-before/after/final logs and integration-final.log. The first
  post-move temporary runtime bundle omitted an AST-only source; the explicit
  maintained launcher supplies it. Final runtime exit 0; integration exit 0.
- Next: return to cohesive production responsibility extraction from views.py.
  Whole-LMS legacy elimination and G01-G05/release approvals remain outstanding.

## Media delivery and presentation rendering boundary - PASS (2026-11-21)

- Before -> after: views.py 25,616 -> 25,367 lines (-249); pptx_slides.py
  1,277 -> 97 (-1,180). Combined legacy-file reduction: 1,429 lines. Seven
  view helpers now delegate; the other 995 view functions/classes are AST-identical.
- New concrete owners under catalogue/: api/media_delivery.py owns download,
  byte-range, signed-preview and slide HTTP responses; application/presentation_reads.py
  coordinates stamped-cache/source reads and explicitly marked missing-source results.
  Infrastructure owns presentation_values/style/geometry/shapes/rendering/cache/sources.py
  and upload_paths.py. No empty Domain layer or new class/interface hierarchy.
- All 83 defined renderer exports remain compatible. Upload storage and render
  cache now import the canonical upload-root value without importing views.
  Legacy attachment access stays lazy in handler composition; no new owner imports
  media_proxy. The whole-backend static graph retains nine existing cyclic groups;
  the large group shrank from 303 to 301 members (pptx_slides/upload_storage left).
  All 192 reviewed catalogue/directory/reporting/learning-plan boundary modules
  remain acyclic; no new cyclic group or forbidden owner-to-views edge.
- Preserved URLs, decorators, tokens/expiry, status/headers/bytes, cache stamps,
  rendering models/assets, cleanup and error handling. Retained the sourceMissing
  fallback: the existing SlideDeckViewer shows its warning. No writers, provider
  behavior, schema, frontend, authentication or real data were changed.
- Final: 1,544 PASS / 0 FAIL / 0 SKIPPED: 158 guarded standalone catalogue cases,
  104 isolated media cases, 116 disposable PostgreSQL/ORM/HTTP cases and 1,166
  DB-forbidden fixtures. Baseline/repeated runs are not double-counted. The media
  baseline was 95 PASS; nine new cases compare actual frozen HTTP/PPTX/PDF code
  and real synthetic output bytes, plus ten new standalone contracts.
- Commands: guarded run_standalone.py final in the evidence directory; python -B
  backend/phase1f_tests/image/run_media_contracts.py; python -B
  backend/phase1f_tests/image/run_integration.py; python -B
  backend/phase1f_tests/image/validate_image.py; git diff --check. Syntax PASS.
- Test image added only the existing project pin pymupdf==1.28.0; build/pip check
  PASS and all 31 installed application packages match project pins. Runtime
  isolation proved before Django/initdb; synthetic files/records only, no host
  credentials or external route. Owned containers removed. No Neon/provider/Teams
  operations or Teams tests; no commit, PR, push, merge or deployment.
- Corrected test-bundle omissions and a historical whole-views guard's owner
  mapping; its original protected hash remains unchanged. Restored original LF
  endings. The initial tar-stream build packaging failed before dependency work;
  the final build used only the three sanitized image manifests. No assertions,
  snapshots or existing business expectations were weakened to obtain a pass.
- Files: three existing production files, ten new concrete owners; two existing
  tests, two new test modules and one frozen snapshot; three image/harness updates
  and two dedicated media runners; tests README and this tracker.
- Evidence: D:/Temp/HP/lms-media-delivery-20261121-batch/ contains before hashes,
  frozen source hash, task.diff, review.json, standalone-final/media/integration
  logs, image-build.log and image.log. All unrelated existing work preserved.
- Remaining: views.py still owns substantial writers, provisioning and provider
  workflows. Continue coherent extraction with separate ownership and regression
  coverage; this batch does not close G01-G05, release approval or whole-LMS work.

## Normalized schema and KSB read boundary - PASS (2026-11-21)

- Before -> after: views.py 25,367 -> 25,336 (-31); schema_compat.py 618 -> 289
  (-329); ksb_mapping_placement.py 344 -> 261 (-83). Net legacy-file reduction:
  443 lines. Extracted 26 functions comprising 511 original lines; compatibility
  bindings account for the difference. No unrelated production behavior changed.
- Five concrete infrastructure owners: schema_contracts.py (column/lifecycle
  shapes and pure rules), schema_relations.py (schema probes and relation SQL),
  schema_projection.py (row enrichment and reference lookups), sql_compatibility.py
  (existing legacy SQL translation), ksb_placement_reads.py (normalized joins,
  placement filters and reference reads). Existing schema_reads.py now owns the
  curriculum column probe. These are storage-format concerns, so no artificial
  Domain/Application packages or generic repository/interface were added.
- Canonical shape constants have one owner and explicit legacy re-exports.
  Preserved nullable joins, status filtering, requested/excluded columns, row
  mutation/setdefault behavior, duplicate ordering, both SQL parameter forms,
  cache TTL/reset/locks and native/SQLite/PostgreSQL column paths. Existing cache
  state remains shared with its callers; no extra cache or provisioning path.
  Active legacy consumers still need the compatibility translation; it was not
  deleted or merged into the native query merely because its name is legacy.
- Writer and middleware definitions are AST-identical. Only column_names changed
  in views.py; its other 1,001 functions/classes and all module-level definitions
  remain unchanged. New owners import no Django/settings/providers/legacy views.
  Whole-backend static graph: 1,181 -> 1,186 modules, same nine cyclic groups;
  all 197 reviewed boundary modules acyclic, no new forbidden import edge.
- Baseline: 41 existing schema/KSB tests PASS before extraction. Final: 173
  guarded standalone cases (163 catalogue + 10 KSB), 51 isolated DB-forbidden
  schema/KSB cases, 120 synthetic PostgreSQL/ORM/HTTP cases and 1,166 existing
  DB-forbidden fixtures PASS; 0 FAIL / 0 SKIPPED. 1,508 distinct cases: two
  existing tests overlap the schema and main selections; repeats are excluded.
  New coverage: five source contracts, ten frozen-original parity cases and four
  PostgreSQL cases verifying actual owned SQL, NULLs, status, caches and columns.
- Commands: guarded run_standalone.py final in the evidence directory; python -B
  backend/phase1f_tests/image/run_schema_contracts.py; python -B
  backend/phase1f_tests/image/run_integration.py; git diff --check. Syntax PASS.
  The existing KSB standalone harness now permits the actual extracted reader;
  the whole-views guard canonicalizes the approved column-reader extraction with
  its original protected hash intact. No snapshots/assertions/skips weakened.
- Docker isolation proved before Django/initdb. All six PostgreSQL aliases use
  the disposable loopback environment; new synthetic tables roll back per case.
  No Neon, existing data, providers, Teams tests, package installation, environment
  or Git history changes. Owned containers removed; Architecture/HEAD and dirty work kept.
- Files: four production updates and five new owners; two test-loader updates,
  two new tests and one frozen snapshot; two shared runner updates and three
  schema test runners; tests README and this tracker. Evidence:
  D:/Temp/HP/lms-schema-read-boundary-20261121/ (before hashes, source snapshot hash,
  task.diff, review.json, baseline/schema/integration/standalone-final logs).
- Remaining: existing writer/provider composition and further caller migration
  before removing public compatibility exports. No G01-G05 or release approval
  was closed; this remains one bounded step in whole-LMS modernization.


## Home / Programme List consumer composition - PARTIAL (2026-11-21)

Follow-up: the remaining consumer reverse imports were closed by the 2026-11-22 entry-point wiring batch below. Historical evidence here remains unchanged.

- Completed: the two consumers have no direct views import or attribute access
  (Home 25 -> 0 references; Programme List 27 -> 0). Eight pure Home forwarding
  functions now explicitly re-export their existing application owner. Four
  public read functions still compose callbacks to preserve existing override
  seams; the other four read exports resolve to one outer composition owner.
- catalogue_read_composition.py is an explicit legacy adapter OUTSIDE catalogue's
  clean layers. Its eight original query-binding bodies and source-field tuples
  are AST-identical, apart from local import placement and explicit callbacks.
  It preserves the current legacy read/cache state; it does not remove the
  transitive views dependency. Home-only authoring-fact dependencies remain
  supplied by Home, so Programme List does not gain that dependency.
- Before -> after: home_summary.py 223 -> 123; programme_list.py 92 -> 26;
  views.py unchanged at 25,336. The new composition adapter is 221 lines.
  Total production size across these files grows by 55 lines; this batch is NOT
  reported as a views reduction or full cycle elimination.
- Dependency result: nine existing cyclic groups remain. The largest group is
  301 -> 302 because the new adapter subdivides an existing cyclic dependency;
  no other legacy module joins it. All 197 reviewed clean-boundary modules remain
  acyclic and none imports this legacy adapter. Full consumer decoupling is OPEN.
- Baseline: 120 disposable PostgreSQL cases and 1,166 fixture cases PASS before
  edits. Final: 120 PostgreSQL cases + 1,176 fixtures + 173 guarded standalone
  cases = 1,469 PASS / 0 FAIL / 0 SKIPPED. Ten new cases compare actual frozen
  source, signatures/exports, payloads/read order, archive/module-only cases,
  SQL/parameters, exceptions, cache keys/force flags, shared stale/hit headers,
  attention errors and HTTP method rejection. Existing authorization tests pass.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py (captured
  by evidence/run.py); guarded run_standalone.py verified; review.py; git diff
  --check. All final command results PASS. One intermediate standalone harness
  incorrectly treated an unrelated programme_workspace_reads owner as moved;
  its owner selection was corrected, with original assertions/baselines retained.
  The initial PowerShell stderr redirection reported NativeCommandError while
  both baseline suites said OK; final subprocess capture records actual exit 0.
- No writer, views, URL, settings, frontend, schema or environment changes.
  Docker isolation checked before Django/initdb; synthetic data only; all owned
  containers removed. No Neon/provider/Teams operations or Teams tests. No Git
  history or branch changes, commit, PR, push, merge or deployment.
- Evidence: D:/Temp/HP/lms-projection-consumers-20261121/ (task-start snapshot,
  immutable consumer source, integration-before/final logs, standalone-verified
  logs, review.json, task.diff). Existing unrelated work preserved.
- Next: replace the adapter's remaining legacy capability lookup with explicit
  entry-point wiring, preserving shared cache invalidation/read-scope identity
  and public caller contracts. This is required to close the original consumer
  decoupling objective; G01-G05 and whole-LMS acceptance remain open.

## Home / Programme List explicit entry-point wiring - PASS (2026-11-22)

- Closed the previous partial objective: removed catalogue_read_composition.py.
  Home, Programme List and module_authoring_facts have no direct OR transitive
  import path to views. The existing views entry point supplies concrete read,
  formatting and cache callbacks; no service registry, generic container or new
  cache instance. The optional read-model import/registration stays lazy.
- Eight query bindings plus three Home HTTP/cache bindings now live at the entry
  point. SQL, projections and enrichment decisions remain in their existing
  catalogue owners. Bounded column tuples have one infrastructure owner.
  KSB fact helpers now accept explicit dependencies and import only stdlib.
- HTTP URLs, methods, payloads, staff gate, cache keys/force flags and shared
  invalidation are preserved. Internal Python helpers at the old module paths
  now expose explicit query contracts; all inspected runtime callers use the
  bound entry-point functions. This is not a promise that their former implicit
  Python signatures are unchanged. Bound entry-point signatures retain them.
- Before -> after lines: home_summary 123 -> 94; programme_list 26 -> 7;
  module_authoring_facts 85 -> 75; composition adapter 221 -> removed;
  projection_sources 123 -> 151; views 25,336 -> 25,522 (+186 wiring lines).
  Net production change across these files: -65 lines. Not a views-size reduction.
- Graph: cyclic groups 9 -> 9; largest group 302 -> 300; no new cyclic members.
  Programme List leaves the group; the transitional adapter disappears. Home
  and KSB helpers cannot reach views. All 197 reviewed clean-boundary modules
  remain acyclic. Other legacy cycles and whole-LMS modernization remain open.
- Final validation: 120 isolated PostgreSQL/ORM/HTTP + 1,177 DB-forbidden fixture
  + 180 guarded standalone cases = 1,477 PASS / 0 FAIL / 0 SKIPPED. The new tests
  cover exact frozen KSB SQL/body/payload parity, dependency closure, and no
  optional read-model import when disabled. Existing fixture assertions and all
  historical snapshots are retained; only bound callsites/oracle globals moved.
- 1,001 existing views definitions are AST-identical. The only other existing
  definition changed is curriculum_programmes: its old local builder import
  disappears. Every writer body remains intact. The historical whole-views
  protected hash still passes after canonicalizing just the reviewed bindings.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py (captured
  by evidence/run.py); guarded run_standalone.py final (34 files), followed by
  the six-case protected-hash recheck after updating its owner mapping;
  review.py; git diff --check. Final state PASS. No dependency installations.
- Docker: no host mounts/credentials/ports; network-none PostgreSQL with Django
  sharing only its loopback namespace; OS isolation proved before initdb/Django;
  all six aliases disposable; synthetic data only; owned containers removed.
  No Neon, production providers, Teams tests, environment changes or Git actions.
- Files: six production files updated and the transitional adapter removed;
  five fixture tests and three existing static contracts updated; one new
  standalone contract, one immutable fact snapshot; two runner/oracle updates;
  catalogue test README and this tracker. Evidence:
  D:/Temp/HP/lms-projection-wiring-20261122/ (before hashes, final results,
  standalone-verified.json, integration-final.log, review.json, task.diff).
- Remaining: views still owns legacy composition/shared runtime capabilities;
  other read-model/writer/provider cycles are not solved by this batch. Next
  extractions must preserve their shared state and remove actual dependencies.
  No G01-G05, release or whole-LMS completion gate is marked passed here.


## Read/cache state ownership - PASS (2026-11-22)

- Before: views owned process/thread caches, locks, epochs and invalidation.
  After: catalogue/infrastructure/runtime_state.py owns the same ten state
  values once; cache_epochs.py owns epoch SQL/polling/bumping;
  cache_invalidation.py owns invalidation and request-scope lifecycle;
  cache_runtime.py binds read scopes and payload caching to that shared state.
  No mirrored state in views, no generic registry or reverse adapter.
- Moved 24 existing functions/bindings. Views retains explicit outer capability
  wiring and public signatures; independent functions are re-exported. Deferred
  integration callbacks retain effect order, outbox deduplication and on_commit.
  native_only remains a live callback after decorator construction.
- views.py: 25,522 -> 25,256 (-266 lines). Four concrete owners add 512 lines;
  net production +246 lines for explicit dependencies and module boundaries.
  This is real ownership removal, not a claim of total-code reduction or full
  cache/writer decoupling. Business writer bodies and API contracts are unchanged.
- Source evidence: all 24 executable bodies/SQL match frozen originals after
  reviewed state/import relocation; the entire remaining views AST matches the
  task-start baseline. Existing historical snapshots and protected hash retained.
  Test observations/patches point to the new state owner; assertions stay intact.
- Final tests: 123 isolated PostgreSQL/ORM/HTTP + 1,199 DB-forbidden fixtures +
  186 guarded standalone = 1,508 PASS / 0 FAIL / 0 SKIPPED. Added 3 real PostgreSQL,
  5 fixture and 6 standalone cases; added 17 existing relevant cache-scope cases.
  Initial run caught captured native_only binding (corrected) and old oracle
  state addresses (relocated). Final-state six-case source guard rerun PASS.
- Verified commit/on_commit, failed epoch SQL/savepoint recovery, rollback,
  once-per-request invalidation, failure cleanup, concurrency/single-flight,
  live cache epochs, read-scope nesting and previous reader/HTTP regressions.
  Existing rollback nuance preserved: a nested epoch bump publishes local memory
  before a caller's outer transaction ends. Outer rollback restores the DB epoch
  and suppresses warming but does not restore that local value immediately.
  This is characterized behavior, not a newly introduced consistency guarantee.
- Graph: 9 -> 9 cyclic groups; largest 300 -> 300; no new cyclic members.
  All 201 reviewed boundary modules acyclic. New owners cannot transitively
  import views. cache_scope, warming and other legacy cycles remain to extract.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py;
  guarded run_standalone.py final (35 files); final binding/source recheck;
  syntax compilation, graph review and git diff --check PASS.
- Isolation proved before initdb/Django: no host mounts/credentials/ports,
  network-none PostgreSQL, Django sharing its loopback namespace, all six aliases
  disposable. Synthetic data only; owned containers removed. No Neon, Teams
  tests, providers, settings, frontend, branch or Git-history operations.
- Evidence: D:/Temp/HP/lms-cache-ownership-20261122/ (before hashes, task.diff,
  integration-first/final logs, standalone-final.json, final binding recheck,
  review.json). Prior unrelated work retained; no G01-G05/release gate closed.
- Next: extract remaining scoped-generation and cache-warm orchestration with
  explicit readers, using this single state owner, before removing more legacy
  entry-point wiring. Preserve actual commit/rollback behavior and request scope.


## Programme / Cohort / Group command boundary - PASS (2026-11-22)

- Larger coherent batch: 31 original functions, 2,111 body lines relocated.
  views.py 25,256 -> 23,835 (-1,421 lines, 5.6%). Six new concrete owner files
  plus the existing domain leaf add 2,844 lines; net production +1,423 lines
  including explicit capability signatures/bindings. This is responsibility
  relocation, not deletion of 2,111 lines of functionality or total-code reduction.
- API: catalogue/api/{programme_commands,cohort_commands,group_commands}.py
  owns existing list/create/patch/reorder/archive/restore/delete/attachment HTTP
  decisions. URLs, public facade signatures, decorators and authentication are
  unchanged. Existing already-extracted read/reporting wrappers were left alone.
- Application: catalogue/application/hierarchy_commands.py owns programme/tree
  preparation, child saves, attachment revision guards and delivery-count resync;
  programme_tree.py owns the original atomic/versioning block. The API retains
  exception mapping and final deduplication/serialization in their original order.
- Infrastructure: catalogue/infrastructure/hierarchy_writes.py owns four row
  update/upsert adapters, including NULL scope, fallback reads and raise_on_error.
  Domain: clean_tree_remove_ids added to the existing hierarchy_values.py leaf.
  No empty packages, generic repositories, service registry or reverse adapter.
- Frozen-source guards verify all 31 bodies, SQL, public contracts, deferred
  imports and every other views AST statement. Historical snapshots/hashes stay
  unchanged; older guards now inspect the relocated owner. No existing business
  fallback, archive behavior, identity rule or writer transaction was redesigned.
- Final tests: 128 isolated PostgreSQL/ORM/HTTP + 1,232 DB-forbidden fixtures +
  195 guarded standalone = 1,555 PASS / 0 FAIL / 0 SKIPPED in the selected suites.
  Covers partial/hydrated trees, scoped removals, parent restore guards, create
  read-back failures, archive detachment, POST vs PATCH attachments, stale module
  revisions, permanent-delete refusals, rename and existing read boundaries.
- New PostgreSQL checks execute actual cohort/group authoring SQL on synthetic
  tables, NULL updates, FK refusal, committed tree write order, intermediate
  failure rollback and outer rollback. Tree SQL ports are synthetic; this does
  not claim an exhaustive full hierarchy endpoint/provider integration baseline.
  Existing authentication/HTTP suite remains passing; middleware/URLs unchanged.
- Initial validation found incomplete test-clock/stub fixtures and a missing
  bundled collaboration import; corrected test setup only. Source guards caught
  a Windows encoding change during signature formatting; original UTF-8 restored.
  Earlier writer guards were redirected to the actual moved body, not weakened.
- Graph: 9 -> 9 cyclic groups; largest 300 -> 300; no new cyclic members.
  All 207 reviewed boundary modules acyclic. New owners cannot transitively
  import views. Legacy capabilities remain injected at the existing facade;
  this is not complete writer/infrastructure decoupling.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py;
  guarded run_standalone.py initial (36 files), affected final rerun (4 files,
  only two non-Teams cohort archive cases), final 7-case source-contract recheck;
  syntax compilation, dependency graph and git diff --check PASS.
- Isolation before initdb/Django: network-none PostgreSQL, Django sharing only
  loopback, no host credentials/mounts/ports, all six aliases disposable. Owned
  containers removed. No Neon, live data, Teams/provider operations or Teams
  suites, frontend/settings edits, commits, PRs, pushes or branch changes.
- Evidence: D:/Temp/HP/lms-hierarchy-boundary-20261122/ (before hashes, immutable
  source snapshot, initial/final results, standalone-verified.json, review.json,
  task.diff). Current branch Architecture and original HEAD retained.
- Next coherent batch: module authoring save/structure/detail/collection and
  their internal preparation/storage seams (currently 559 + 303 + 263 + 186
  body lines before helpers). Preserve concurrency and persisted-state parity;
  leave meeting/provider operations outside that batch. G01-G05, release and
  whole-LMS completion remain open.


## Module authoring command boundary - PASS (2026-11-22)

- Seven original functions, 1,542 body lines relocated. views.py 23,835 ->
  22,655 (-1,180 lines, 5.0%). Five concrete owner files add 1,869 lines;
  net production +689 lines including explicit signatures/capability bindings.
  This removes responsibilities from the legacy file, not application features.
- Application: catalogue/application/module_authoring.py owns validation,
  module/week/component/KSB save orchestration, completion/details persistence
  and post-save reconciliation. component_authoring.py owns component context
  preparation, settings/assurance preservation and component persistence.
- API: catalogue/api/module_commands.py owns collection/detail/artwork contracts;
  module_structure.py owns structure GET/PATCH, revision guards, partial merges,
  HTTP error mapping and post-commit response construction. Infrastructure:
  catalogue/infrastructure/module_cover.py owns the exact live-module UPDATE.
  Existing independent domain rules are reused; no empty domain layer added.
- Public facade signatures, decorators, URLs, authorization, existing schemas,
  SQL text, transaction nesting, exception mapping and call order preserved.
  Deferred legacy integrations stay explicit at the existing composition seam.
  No new views imports in the owners, registry/context bag, generic repository,
  runtime source execution or duplicated business implementation.
- Immutable source baseline: module_commands_snapshot.json SHA256
  5bb4a3232da1bbbd4a52ccdc8a695081f0ed86c080edf09fa81d2e120b8f566d.
  Seven source guards check actual moved bodies and every other views statement.
  The hierarchy restoration chain and old module GET guards now follow these
  owners; no historical fixture/hash or assertion was regenerated/removed.
- Final validation: 135 disposable PostgreSQL/ORM/HTTP + 1,244 DB-forbidden
  fixtures + 200 guarded standalone = 1,579 PASS / 0 FAIL / 0 SKIPPED.
  New cases: full/changed-only/light saves, known locked identity reuse,
  collection reuse/duplicate semantics, component flags/settings, narrow rename,
  validation refusal, missing targets, partial-save revision requirements,
  current/stale/unreadable revisions, after-commit readback and staff gate.
- PostgreSQL cases prove committed content-write order, nested failure rollback,
  outer rollback, post-commit HTTP revision and actual artwork UPDATE/active-row
  predicate. Module persistence ports are synthetic; artwork validation/storage
  and provider boundaries are mocked. This is not full writer/schema/provider
  end-to-end parity or concurrent-worker contention evidence.
- Initial source guard caught SQL literal indentation changed during extraction;
  exact original text restored. Initial artwork tests lacked a staff principal
  and the unrelated learner image-validator import in the isolated bundle;
  fixed test fixtures only. Final actual application behavior comparisons pass.
- Graph: 9 -> 9 cyclic groups; largest 300 -> 300; no added cyclic members.
  All 212 reviewed boundary modules acyclic. New-owner transitive imports stay
  within catalogue. Existing facade capability wiring and legacy cycles remain.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py;
  guarded run_standalone.py after (37 files) plus corrected 7-case source check;
  syntax compilation, dependency graph and git diff --check PASS.
  Evidence: D:/Temp/HP/lms-module-commands-20261122/ (before hashes, task.diff,
  initial/final integration logs, standalone-verified.json and review.json).
- Isolation proved before initdb/Django: network-none PostgreSQL, Django sharing
  only loopback, no host mounts/credentials/ports; all six aliases disposable.
  Owned containers removed. No Neon, existing database, provider operations,
  Teams tests, frontend/settings edits, commit, PR, push or branch change.
  Existing Architecture branch/HEAD and unrelated changes retained.
- Next coherent batch: curriculum archive/restore and deletion orchestration
  (programme/module/child quiz lifecycle and its existing guarded adapters).
  Preserve ownership, refusal/restore rules and atomic boundaries; keep provider
  implementations separate. Remaining module work includes legacy training
  materialization, free-programme writers, schema provisioning and facade wiring.
  No G01-G05, release or full-LMS completion gate is closed by this batch.

## Curriculum lifecycle command boundary - PASS (2026-11-22)

- Before: programme/module archive, restore, guarded deletion and quiz ownership
  persistence lived in views.py. After: 18 functions / 971 original body lines
  belong to six concrete catalogue owner modules. views.py 22,655 -> 21,866
  (-789 lines, 3.5%). The owners total 1,339 lines including readable explicit
  capability signatures; net production +550 lines, not a reduction in total
  application code. Existing public signatures/decorators remain at the facade.
- Application: programme_lifecycle.py (archive/restore), programme_deletion.py
  (content refusal, reusable detachment, ordered deletion), module_lifecycle.py
  (atomic archive of quizzes/children/module). Infrastructure: lifecycle_writes.py
  (schema-aware archive/restore/delete adapters) and quiz_lifecycle.py (ownership
  SQL, shared-reference protection, quiz archive). API: lifecycle_commands.py
  (programme permanent-delete outcome, module restore/permanent-delete outcome,
  component/week DELETE contracts). Existing domain policies are reused.
- Removed the unused 138-line delete_programme_authoring_structure helper:
  repository search found no runtime caller, only an obsolete fixture comment.
  The guarded production deletion path remains the single implementation.
  Retained active legacy schema/quiz metadata compatibility; no speculative
  fallback removal, changed writer decisions, SQL, auth, URLs or transaction order.
- Source baseline lifecycle_commands_snapshot.json SHA256
  6dbdef0e9e61192b8fe47a171f1bd02d4ed363e520e7614818f8aa9bf478bf72.
  Seven standalone guards check actual bodies, exact SQL literals, facade
  bindings, deferred collaboration imports, dead-helper references and restored
  whole-file AST. Earlier snapshots/hashes are unchanged; the module-command
  restoration chain now restores this batch before its historical assertions.
- Final validation: 143 disposable PostgreSQL/ORM/HTTP + 1,260 DB-forbidden
  fixtures + 207 guarded standalone cases = 1,610 PASS / 0 FAIL / 0 SKIPPED.
  New fixtures compare real frozen source, request values, operation order,
  exception mapping, provenance selection and 500-row restore batches. Existing
  quiz fixtures run on the new path and frozen path. PostgreSQL tests cover
  actual DELETE/RETURNING, caller rollback, active-row predicates, legacy
  cascade/time bounds, shared quizzes, template owners and metadata scope.
- Limit: generic read/update ports use a small synthetic schema; revision/cache
  and provider capabilities are mocked. No live-provider, concurrency, whole-LMS
  or complete writer-schema acceptance claim. Initial run: PG 143 PASS; fixture
  run had one request-object comparison failure and two old mocks rejecting the
  already-existing columns keyword. Corrected request-value journaling and the
  two test mocks (including projection assertions); no production behavior fix.
- Existing defect confirmed on normalized synthetic PostgreSQL in BOTH original
  and extracted implementations: permanent_module_delete_response applies
  module_catalogue_id to ksb_mappings, whose placement is component-based.
  SQLSTATE 42703 maps to module-delete-restricted / HTTP 409; rollback preserves
  the module. This is a characterized remaining compatibility defect, not a
  successful hard-delete test or a new regression. No Neon query was performed.
- Graph 9 -> 9 cyclic groups, largest 300 -> 300, no new cyclic members;
  218 reviewed boundary modules acyclic. New owners import no legacy views,
  settings or providers. Existing facade wiring and legacy cycles remain.
- Files: views.py; the six owners; lifecycle snapshot/oracle/source guards;
  test_lifecycle_commands_boundary_no_db.py; two quiz test mocks/comment;
  lifecycle_commands_postgresql.py; explicit runner/bundle selections; previous
  oracle chain; tests README and this tracker. Unrelated changes preserved.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py;
  guarded run_standalone.py initial (38 explicit files) and final lifecycle
  source guard; syntax/dependency review and git diff --check. Evidence:
  D:/Temp/HP/lms-lifecycle-20261122/ (before hashes, initial/final logs,
  standalone results, task.diff, review.json). Isolation proved before initdb
  and Django: network-none disposable PostgreSQL, loopback-only runtime,
  synthetic credentials and all six aliases confined; owned containers removed.
  No Teams tests, provider operations, existing DB access, frontend/settings
  changes, commit, PR, push or branch change. Architecture/HEAD preserved.
- Next: a bounded normalized-KSB permanent-module-delete compatibility fix with
  real PostgreSQL rollback/scope tests, then the remaining free-programme
  persistence responsibilities. Keep schema provisioning and provider code
  distinct. G01-G05, release approval and full legacy elimination remain open.

## Authoring persistence and free-programme boundary - PASS (2026-11-22)

- Before: row writers, provisioning, free-programme persistence/conversion and
  week-template HTTP commands lived in views.py. After: 17 functions / 1,601
  original implementation lines moved. views.py 21,866 -> 20,668 (-1,198 / 5.5%).
  Six new concrete owners total 1,933 lines; existing week_templates.py gains 50
  lines and lifecycle_commands.py gains 8. Net production +793 lines, including
  explicit capability signatures and compatibility wiring; not total-code shrinkage.
- Infrastructure: authoring_writes.py owns upsert/bulk-upsert/scoped UPDATE;
  authoring_schema.py owns the existing module/free-programme/template DDL bodies.
  Application: authoring_persistence.py owns changed-content writes and parent
  repair; free_programme_commands.py owns scoped deletion, save and clone/move;
  week_templates.py now also owns component persistence. API:
  free_programme_commands.py and week_template_commands.py own validation,
  orchestration entry and response/error construction. No empty domain package.
- Views retains public signatures/decorators, existing opt-in schema gates and
  one set of readiness flags, set only after successful provisioning. Deferred
  storage/adoption/pricing imports stay lazy. No owner imports views/settings or
  providers. Existing SQL, transactions, created_at preservation, nullable clears,
  normalized-parent ordering, canonical-store fast path and adopted-course
  protections remain. No active compatibility fallback was removed speculatively.
- Narrow KSB deletion correction: permanent_module_delete_response now uses
  ksb_mapping_placement.where(catalogue_id) for mappings before deleting their
  components. Other child predicates, archive/reference/provider refusal gates,
  transaction and HTTP contracts are unchanged. Frozen original still reproduces
  42703 / 409; current synthetic PostgreSQL proves HTTP 200 and bounded counts,
  another module unaffected, late-FK rollback and outer-transaction rollback.
- Source baseline authoring_storage_snapshot.json SHA256
  16abc8d6b4b78227d015af3f23417ee1e33d96390a5ab227b07777c0962499f3.
  Seven guards check real owner bodies/SQL, every unrelated views statement,
  signatures, explicit bindings, lazy imports and readiness flags. Previous
  snapshots remain byte-identical. Earlier lifecycle/week-template/cover tests
  follow the actual owners; the KSB change has an explicit narrow AST allowance.
- Final validation: 153 disposable PostgreSQL/ORM/HTTP + 1,303 DB-forbidden
  fixtures + 224 guarded standalone cases (41 explicit files) = 1,680 PASS /
  0 FAIL / 0 SKIPPED. Covers actual writer invocation, partial/null writes,
  created_at, bulk batches/history, scoped updates, transaction failure/rollback,
  free-course save/clone/move, template missing/empty/stale input, CSRF and grants.
- Initial failures were test setup/path issues: missing CSRF token and access
  grant in a new HTTP fixture, and old week-template guards looking inside views.
  Supplied valid synthetic credentials, added refusal cases and followed the new
  owner while preserving assertions. No auth logic was changed to make tests pass.
- Limits: provisioning DDL compared via fake cursors, not applied as a live schema
  upgrade. Generic normalization/history/cache/provider ports are mocked; free
  programme transactions use a synthetic journal. No complete writer-schema,
  multi-worker contention, live provider or full-LMS acceptance claim.
- Graph: 9 -> 9 cyclic groups; largest 300 -> 300; no new cyclic members.
  All 224 reviewed boundary modules acyclic. Legacy cycles and facade wiring remain.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py;
  guarded run_standalone.py final (41 files); syntax/dependency review and
  git diff --check. Evidence: D:/Temp/HP/lms-authoring-storage-20261122/
  (before hashes, initial/final logs, standalone results, task.diff, review.json).
  Runtime isolation proved before initdb/Django: network-none, loopback only,
  no host credentials/mounts/ports, six aliases restricted to disposable fixtures.
  Owned containers removed. No Neon/existing DB, Teams tests, provider operations,
  frontend/settings edits, commit, PR, push or branch switch. Architecture/HEAD
  and unrelated changes preserved. G01-G05 and release gates remain open.
- Next coherent area: remaining component/KSB HTTP commands and content-save
  orchestration. Preserve upload/provider ports and source ownership; review
  remaining training materialization separately before removing its fallbacks.

## Content commands and misleading fallback removal - PASS (2026-11-22)

- views.py 20,668 -> 20,023: net -645 lines. Moved 25 functions / 874 original
  implementation lines; deleted six helpers / 122 lines plus their GET dispatch.
  Five new owners total 1,118 lines; existing free_programme_commands.py +120,
  module_structure.py -12. Net production +581 including explicit composition;
  this batch is responsibility separation and real deletion, not total-code shrinkage.
- API content_commands.py owns component CRUD/summary, settings and guarded KSB
  writes; content_uploads.py owns component/template/book HTTP workflows.
  Application component_resources.py owns attachment settings/KSB synchronization;
  existing free_programme_commands.py gains single-course deletion and reverse
  conversion. Infrastructure content_uploads.py owns storage metadata/locked
  attachment updates/material reads; content_source_writes.py owns source SQL,
  freshness queries, module locks and unchanged assignment cleanup SQL.
- Deleted catalogue_for_training_row, authoring_row_for_training_source,
  attach_training_source_metadata, ksb_mappings_from_codes,
  imported_training_module_payload and ensure_training_module_authoring_structure.
  Two were no-op stubs; the remaining chain fabricated lessons, two-hour/ten-point
  values and KSB weights on unresolved training GET. GET now returns 404 for that
  missing content; resolved aliases retain their stored payload without link writes.
  Explicit PATCH creation/link behavior is unchanged. Runtime-reference scan passes.
- Also removed KSB PATCH's successful empty-dict readback fallback. Readback now
  occurs inside the mapping transaction; missing identity returns 500 and rolls
  back. Frozen-source test demonstrates former 200/empty mapping with committed
  changed identity; current real PostgreSQL test proves original row/weight restored
  and no invalidation. Successful mapping update preserves the original payload.
- Retained active normalized/legacy storage selection, adopted-course safeguards,
  optional schema mirrors and detached-mapping cleanup: these serve real stored
  states. No arbitrary removal of reachable compatibility paths, provider guards,
  revision checks, access decorators, URLs or schema identities.
- Immutable content_commands_snapshot.json SHA256
  92b870f6ad8b3279bd4db243f7471bd7ad9c6d04729e9b01d098448c28c849fb.
  Eight source guards check actual owners/bindings, whole-file preservation and
  the two explicit behavior corrections. Historical snapshots remain unchanged;
  oracle chains and existing training tests preserve the original failure evidence.
- Final validation: 159 disposable PostgreSQL/ORM/HTTP + 1,316 DB-forbidden
  fixtures + 232 guarded standalone (42 files) + 120 network/DB-blocked media
  tests = 1,827 PASS / 0 FAIL / 0 SKIPPED. Initial two PostgreSQL test failures
  were fixture JSONB returned as text; normalized the fixture reader and reran.
  Media suite and unchanged standalone cases passed first run; final affected
  source guards rerun. Final whitespace cleanup verified whole-file AST identical.
- Tests cover actual owner invocation, lock-before-revision order, partial fields,
  KSB sibling preservation, normalized mapping authority, topic upload deferral,
  conversion append/archive/rollback, scoped deletion and failed readback rollback.
  Free-course assignment SQL remains source-compared; persistence/normalization,
  progress sync/cache/provider ports are synthetic where noted. No complete schema,
  concurrency or live-provider acceptance claim.
- Graph 9 -> 9 cyclic groups; largest 300 -> 300; no added cyclic members;
  229 reviewed boundary modules acyclic. Syntax and git diff --check PASS.
  Commands: python -I -B backend/phase1f_tests/image/run_integration.py;
  python -I -B backend/phase1f_tests/image/run_media_contracts.py; guarded
  run_standalone.py initial and run_contract.py final. Evidence:
  D:/Temp/HP/lms-content-commands-20261122/ (before hashes, logs, task.diff,
  review.json). Existing local Docker images only; isolation proved before startup,
  no host credentials/mounts/ports, all six aliases disposable or dummy, containers
  removed. No Neon/existing DB, Teams tests, real providers, commit/PR/push,
  branch switch or deployment. Architecture/HEAD and unrelated changes preserved.
- Remaining: facade/composition volume, remaining schedule/provider handlers,
  shared persistence helpers and legacy import cycles. Next non-provider batch:
  shared row persistence and programme configuration ownership, with dead-code
  review first. G01-G05, release gates and full legacy elimination remain open.


## Shared row persistence and programme configuration - PASS (2026-11-22)

- Existing Architecture checkout, HEAD 606aca43df97967e8cb1fab45c5a794cc0635246;
  previous working changes preserved. views.py 20,023 -> 19,677 (-346 net).
  Moved 12 implementations / 299 original lines; removed four unused functions
  plus the deduplication latch (137 source lines). Production Python net +3
  across all affected owners, including explicit composition bindings.
- New infrastructure/row_persistence.py owns writable/NULL shaping, row decoration,
  INSERT/UPDATE SQL and history/live notification ordering. New infrastructure/
  write_notifications.py owns content retirement before moves and write notifications.
  New application/programme_configuration.py owns authoring programme resolution,
  conditional updates and explicit creation. Existing programme_reads, authoring_schema,
  hierarchy_writes and lifecycle_writes gained their remaining concrete helpers.
- Removed _notes_with_authoring_meta, merge_duplicate_program_configs_by_name,
  update_programme_reference_table, sync_group_authoring_details_from_modules and
  _PROGRAMME_CONFIG_DEDUP_READY. Repository reference review and the executable
  runtime-reference guard found no production callers; the name-based destructive
  maintenance chain and reverse group reconstruction are not relocated.
- Preserve SQL, active storage compatibility, schema bootstrap gate, programme ID
  preference/name matching for placeholder drafts, status defaults, unchanged-save
  avoidance, history order, cache retirement and caller transaction boundaries.
  API URLs, decorators, signatures and payload contracts are unchanged.
- Frozen row_persistence_snapshot.json SHA256:
  7bc305f65a17e5c467e20c5da701bbc41dcb63cdb75c33116e0c64ec8e135f88.
  Seven source contracts compare actual owners and bindings, deleted-symbol references
  and full views AST outside the approved edits. Previous baselines remain immutable.
- Final actual validation: 164 disposable PostgreSQL/ORM/HTTP + 1,334 DB-forbidden
  fixtures + 239 guarded standalone (43 files) + 120 DB/network-blocked media
  = 1,857 PASS / 0 FAIL / 0 SKIPPED. Covers persisted partial updates, explicit
  NULL, duplicate-key refusal, outer rollback, programme identity and no-op saves,
  group detachment preserving content/other groups, write history and invalidation.
- Initial standalone state guard correctly caught the deliberately removed dedup
  latch; updated its exact expectation without changing the frozen source.
  Initial integration found test vendor leakage: MovePreReadTests patched Django's
  ConnectionProxy, losing the enclosing vendor override on cleanup. Diagnostic run
  confirmed sqlite -> postgresql after that fixture. Patched the concrete default
  wrapper instead, added restoration regression, and reran the complete selection.
  No application fix, weakened assertion, dropped test or database allowance.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py;
  python -I -B backend/phase1f_tests/image/run_media_contracts.py; guarded
  run_standalone.py initial and run_contract.py final in the evidence directory.
  Syntax / git diff --check PASS. Import graph 9 -> 9 cyclic groups, largest
  300 -> 300, no new cyclic members; 232 reviewed boundary modules acyclic.
- Evidence: D:/Temp/HP/lms-row-persistence-20261122/ (before bytes/hashes,
  initial/diagnostic/final logs, task.diff, review.json). Existing Docker images;
  loopback-only isolation verified before initdb/Django, synthetic DB/all six aliases,
  no host mounts/credentials/ports; owned containers removed. No Neon/existing DB,
  Teams tests, real providers, commit/PR/push, branch switch or deployment.
- Limits: synthetic schemas/ports prove reviewed contracts, not full production
  concurrency, provider acceptance or live release readiness. G01-G05 remain open.
  Next coherent non-provider area: remaining holiday HTTP handlers and calendar
  configuration; substantial views composition/provider volume and legacy cycles remain.

### Holiday HTTP/storage and cohort preview boundary — PASS (2026-11-22)

- Moved 26 implementations / 623 original lines. views.py: 19,677 -> 19,423
  (-254); calendar_holidays.py: 372 -> 196 (-176); combined legacy reduction 430.
  Production Python net +303 including explicit compatibility bindings.
- New catalogue/api/holiday_commands.py owns holiday HTTP contracts;
  api/cohort_preview.py delegates date computation to application/cohort_calendar.py.
  New infrastructure/holiday_store.py owns normalized reads, writes, mirror SQL and
  cohort choice persistence. infrastructure/holiday_reads.py owns table selection.
  Existing views/calendar exports retain signatures, decorators and lazy bindings.
- Preserve partial PATCH fields, archive visibility/cache keys, official-row write
  refusal, cohort selection/exclusion precedence, caller rollback, authored practical
  dates and EPA overrides. Both active storage shapes remain supported; no unproven
  dead-code deletion. No provider engine or scheduling behavior change.
- Removed the refresh `json_body(request) or {}` fallback: malformed/non-object
  JSON now returns 400 before sync/reset dispatch. The actual frozen implementation
  demonstrates the previous malformed-JSON 200/sync behavior using mocked ports.
- Frozen holiday_boundary_snapshot.json SHA256:
  42b8dba49a169a33158346aaa2c18b7a1053166f14892b58c9849e8b16e4d7fa.
  Six standalone source contracts verify original bodies/SQL, full unrelated AST,
  split preview computation and public bindings. Earlier snapshots remain unchanged.
- Actual validation: 169 disposable PostgreSQL/HTTP + 1,350 DB-forbidden fixtures
  + 245 guarded standalone (44 files) = 1,764 PASS / 0 FAIL / 0 SKIPPED.
  Added five PostgreSQL and nine fixture cases; included seven existing holiday
  cases. The extracted owners are invoked. Media tests were not rerun this batch.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py; guarded
  run_standalone.py initial in D:/Temp/HP/lms-holiday-boundary-20261122/.
  Syntax / git diff --check PASS. Import graph: 9 -> 9 cyclic groups, largest
  300 -> 300; no new cyclic members. 235 reviewed boundary modules remain acyclic.
- Isolation verified before initdb/Django: existing images, network=none PostgreSQL
  namespace shared by Django, no host mounts/published ports/credentials, synthetic
  database only. Owned containers removed. No Neon, real provider calls, Teams
  tests, branch switch, commit/PR/push or deployment. Evidence: before bytes/hashes,
  integration-initial.log/json, standalone-initial.log/json, review.json and task.diff
  in the evidence directory above.
- Limits: synthetic schemas and selected mocked persistence/cache ports do not
  establish full production concurrency, middleware/authorization or provider
  acceptance. Existing get_holiday_rows_safe error-to-empty tolerance remains at
  the legacy seam, shared with scheduling consumers; it was not relocated or
  silently redefined. G01-G05 remain open. Next: remaining session-plan persistence
  and staffing/calendar editing boundaries, with provider dispatch kept isolated.

### Session planning, persistence and staffing editing — PASS (2026-11-22)

- Moved 12 implementations / 510 original lines. views.py: 19,423 -> 19,054
  (-369). Production Python net +271 including explicit bindings and split owners.
- New domain/week_session_dates.py owns date/clock stamping on caller values;
  application/session_plan_updates.py owns calendar error enrichment, plan assembly
  and changed-settings persistence. infrastructure/session_writes.py owns concrete
  authoring read/write calls and required staffing module reads. New api/calendar_editing.py
  owns session/staffing HTTP and preview adapters; application/staff_assignment_writes.py
  owns validated staffing persistence. Staff identity helpers and the explicit conflict
  override rule join existing staff_profiles and tutor_conflicts owners.
- Keep public signatures, URLs/decorators, dates/clocks, numbered session matching,
  booked/additional-session protection, partial updates, conflict/refusal order,
  cache/notification order and caller transactions. No provider engine changes.
- Deliberate correction: staffing no longer uses safe_authoring_module_rows to
  disguise required-read failure as an empty assignment set. Read before any write
  when tutor is supplied; failure returns sanitized 503 with no coach/module changes.
  Coach-only changes omit the unused module read. Successful selection retains the
  original full read, Python group-ID normalization, duplicate and ID semantics.
  Removed unused previous_coach and next_coach calculations, including the redundant
  second coach lookup. The shared tolerant helper remains for untouched consumers.
- Frozen session_editing_snapshot.json SHA256:
  063239a4719e44529b348415227a3dfcbe65321504adcfbda29f70be61369896.
  Seven source contracts reconstruct actual split implementations and unchanged
  views AST. Three existing source guards follow their new API owner; earlier
  snapshots/assertions stay intact. Numbered-header fixture keeps the same six
  assertions/cases and now supplies package context for the real wrapper import.
- Final actual validation: 175 disposable PostgreSQL/HTTP + 1,370 DB-forbidden
  fixtures + 252 guarded standalone (45 files) = 1,797 PASS / 0 FAIL / 0 SKIPPED.
  Added six PostgreSQL and fourteen fixture cases plus seven standalone contracts;
  included six existing numbered-header cases. Actual extracted owners invoked.
- Initial run: 174/175 PostgreSQL passed; new assertion incorrectly indexed a
  driver-returned JSON string. Decode the fixture result explicitly. Source guards
  caught accidental Windows encoding conversion and two old handler locations;
  restored original UTF-8 bytes and followed the extracted handlers. Final suites
  rerun after corrections; no historical baselines regenerated or assertions removed.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py; guarded
  run_standalone.py final in D:/Temp/HP/lms-session-editing-20261122/.
  Syntax / git diff --check PASS; graph 9 -> 9 cyclic groups, largest 300 -> 300,
  no new cyclic members; 240 reviewed boundary modules acyclic.
- Existing Docker images; network isolation verified before initdb/Django;
  synthetic PostgreSQL/all six aliases, no host mounts/credentials/published ports;
  owned containers removed. No Neon, existing DB, real provider calls, Teams suites,
  branch switch, commit/PR/push or deployment. Logs, before hashes/bytes, task.diff
  and review.json are in the evidence directory above.
- Limits: synthetic persistence adapters and selected mocked validation/cache ports;
  not complete middleware/authorization, concurrency or live calendar acceptance.
  Existing caller transaction boundaries are preserved, not replaced with new
  endpoint-wide atomicity. G01-G05 remain open. Remaining large areas include
  compatibility composition and provider/meeting orchestration still in views.

### Catalogue read dependencies and direct exports — PASS (2026-11-22)

- Architecture / HEAD 606aca43df97967e8cb1fab45c5a794cc0635246 preserved.
  views.py 19,054 -> 17,763 (-1,291). Replaced 177 local definitions with
  direct owner exports: 43 remaining value helpers moved, 134 redundant wrappers
  removed. Reduced 157 further read wrappers by 484 dependency arguments.
  This is the coherent verified batch, not a claim of a 2,000-line reduction.
- Production Python net +250 lines including explicit concrete imports/defaults;
  this batch reduces legacy coupling, not total repository line count.
- Domain owns normalization, identifiers, component types and read markers;
  existing application projection/selection owners supply concrete pure defaults.
  Added domain/values.py, component_types.py and read_contracts.py. Existing
  explicit keyword injection remains supported during migration. Required I/O,
  runtime state and provider capabilities remain explicit; no generic container.
- All affected function bodies and unrelated views statements source-compare
  exactly. Existing calls, SQL, HTTP handlers, writer bodies, cache behavior and
  provider dispatch are preserved. No active compatibility fallback was removed
  without evidence; eliminated forwarding duplication is the change here.
- Actual validation: 175 disposable PostgreSQL/HTTP + 1,370 DB-forbidden fixtures
  + 258 guarded standalone tests across 46 files = 1,803 PASS / 0 FAIL / 0 SKIPPED.
  Six new contracts include 102 frozen-source parity cases. Initial fixture
  failures exposed obsolete wrapper spies and synthetic dependency patch sites;
  updated these to direct exports/concrete default contracts, retaining existing
  assertion calls and inputs. Standalone loaders now follow actual imports.
- Syntax and git diff --check PASS. Import graph 9 -> 9 cyclic groups, largest
  300 -> 300, no added cyclic members; 243 reviewed boundary modules acyclic.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py;
  python -I -B D:/Temp/HP/lms-pure-read-20261122/run_standalone.py final.
  Earlier snapshots remain immutable. Source/test evidence, initial/second/final
  logs and task-scoped diffs: D:/Temp/HP/lms-pure-read-20261122/.
- Docker isolation verified before startup, synthetic DB only, all six aliases
  disposable/dummy, no host credentials/mounts/ports; owned containers removed.
  No Neon, existing DB, Teams tests, real providers, branch switch, commit/PR/push
  or deployment. G01-G05 and release acceptance remain open.
- Remaining: explicit storage/runtime composition, mixed orchestration and
  provider/meeting handlers. Next coherent area is the remaining catalogue read
  adapters and their composition. Pure defaults remove legacy wiring, but the
  optional injection arguments and retained facades are still transitional.


### Catalogue schema-read ownership and KSB composition ? PASS (2026-11-22)

- Architecture / HEAD 606aca43df97967e8cb1fab45c5a794cc0635246 retained.
  views.py 17,763 -> 17,665 (-98); 13 read/schema utilities now exported from
  catalogue/infrastructure/database_reads.py. Shared column/existence/Learner
  caches have one owner; schema reset updates the owner's listing flag.
- Schema introspection and seven KSB read adapters now use that owner directly,
  removing eight read-side imports of views. Extracted the existing ContextVar
  and two storage-scope functions into infrastructure/storage_context.py; the
  legacy learning_storage exports share the same context object. Removed six
  repeated authoring table definitions. Production Python net +44 lines.
- SQL, status/NULL handling, KSB joins, cache TTLs, request memoization and public
  call signatures are preserved. KSB writer section, HTTP handlers and provider
  workflows remain unchanged. Active compatibility paths were not deleted.
- Actual final validation: 175 isolated PostgreSQL/HTTP + 1,383 DB-forbidden
  Django fixture tests + 266 guarded standalone tests (47 files) = 1,824 PASS,
  0 FAIL, 0 SKIPPED. Added 8 standalone and 3 actual wiring tests; included the
  10 existing schema-read parity tests in the isolated selection. Retained all
  existing assertions; synthetic ports now reach both the frozen facade and
  concrete owner. The standalone KSB loader compiles the actual pure formatter
  without importing Django. Initial failed checks and fixes are retained in logs.
- Syntax and git diff --check PASS. Static graph 9 -> 9 cyclic groups, largest
  300 -> 300, no new cyclic members; 245 reviewed boundary modules acyclic.
  This is foundational read ownership, not a 2,000-line extraction or endpoint-
  wide acceptance. Remaining: authoring SELECT/completion/prefetch composition,
  other compatibility facades and provider/meeting handlers.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py;
  python -I -B D:/Temp/HP/lms-read-composition-20261122/run_standalone.py final.
  Evidence and task-scoped diff: D:/Temp/HP/lms-read-composition-20261122/.
- Docker loopback-only isolation verified before initdb/Django; all six aliases
  disposable/dummy; no host mounts/credentials/ports. Owned containers removed.
  No Neon, existing DB, Teams tests, live providers, environment changes,
  commit/PR/push/deployment or branch switch. G01-G05 remain open.


### Authoring read composition and KSB read ownership - PASS (2026-11-22)

- Existing Architecture / HEAD 606aca43df97967e8cb1fab45c5a794cc0635246 retained.
  views.py 17,665 -> 17,607 (-58); ksb_mapping_placement.py 261 -> 157 (-104).
  Production Python net -6 lines; no claim of a 2,000-line extraction.
- Twelve existing KSB read/helper functions and their shared text cache now live
  in catalogue/infrastructure/ksb_read_store.py; legacy exports retain object
  identity. The writer section is byte-identical. Authoring SQL owns derived
  placement-name constants and functions. Five outer read adapters now supply
  only their remaining open capabilities; cursor/state/KSB defaults live in
  Infrastructure. Schema guard, free-course routing and name completion remain
  explicit; the existing schema guard still runs before query construction.
- SQL, parameters, selection/exclusion, KSB joins and NULL/status handling,
  request memo keys, batching gates and individual-read error behavior retained.
  Pure explicit-port authoring execution remains importable without Django;
  concrete I/O is loaded only on use. Removed the unconsumed
  CURRICULUM_PIPELINED_READS setting and its misleading enablement comment;
  CURRICULUM_BATCHED_READS behavior is unchanged.
- Final validation: 175 isolated PostgreSQL/HTTP + 1,391 Django fixture tests +
  270 guarded standalone tests (48 files) = 1,836 PASS, 0 FAIL, 0 SKIPPED.
  Added four source-preservation tests and eight actual-wiring tests, including
  30 SQL projection combinations, completion/NULL/selected-field parity,
  successful/failed/incomplete batches, transaction/vendor guards and schema
  failure ordering. All existing assertion calls and earlier frozen snapshots
  retained. Updated synthetic patch sites and bundled the new baseline fixture.
  Initial packaging/mock failures and their diagnostics are retained in evidence.
- Syntax and git diff --check PASS. Static graph 9 -> 9 cyclic groups, largest
  300 -> 300, no added cyclic members; 246 boundary modules remain acyclic.
  Existing unrelated views nodes and all KSB writer statements are unchanged.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py;
  python -I -B D:/Temp/HP/lms-authoring-composition-20261122/run_standalone_parallel.py verified.
  Evidence/diff: D:/Temp/HP/lms-authoring-composition-20261122/.
- Loopback-only Docker isolation proved before initdb/Django; disposable data
  and aliases only, no host mounts/credentials/published ports. Owned containers
  removed. No Neon, existing DB, Teams tests, providers, .env, commit/PR/push,
  deployment or branch switch. G01-G05 remain open.
- Remaining: outer schema/storage/name-completion composition, other catalogue
  read facades and large meeting/provider handlers. Full legacy elimination and
  live provider/production acceptance are not established by these checks.

### Meeting creation, scheduling, attachment and results boundary - PASS (2026-11-22)

- Explicit user approval: extract the meeting/scheduling block and run mocked
  Teams checks only. Architecture / HEAD 606aca43df97967e8cb1fab45c5a794cc0635246
  retained; unrelated work preserved. views.py 17,607 -> 15,912 (-1,695).
  Five original bodies total 2,011 lines; the public facade retains explicit
  capability wiring, signatures, decorators, recursive schedule entry and URLs.
- New concrete owners: meetings/api/{creation,scheduling,results}.py and
  meetings/application/{attachment,reconciliation}.py. HTTP orchestration stays
  in API; occurrence reconciliation and module/week attachment are application
  operations. No empty Domain/Infrastructure packages or new class hierarchy.
  Existing SQL/provider adapters remain injected; these are transitional
  boundaries, not a claim that all meeting responsibilities are fully separated.
- Actual body/source-contract checks and 70 old/new synthetic trace replays
  preserve meeting/occurrence identity, invitation/retry behavior, original
  calendar handling, partial failures, attachment and read-only status behavior.
  Frozen source hash: e00146e80ef2d4e5826255511370c47174aff9480b7957fafddafb00460c12d1.
  Existing assertion behavior retained; loaders now reach actual extracted
  owners. Stale synthetic fixtures now use curriculum_module_id and the existing
  module_catalogue_id keyword; archive guards inspect current owner bodies.
- Final checks: 579 mocked Teams/source-contract cases + 45 disposable
  PostgreSQL Teams cases + 175 existing PostgreSQL/HTTP + 1,391 existing Django
  fixtures + 270 guarded standalone + 162 frontend Teams = 2,622 PASS,
  0 FAIL, 0 SKIPPED. Initial failures and task-start replays retained in evidence.
  PostgreSQL fixture DB defaults match existing authoring DDL; constraints were
  retained. Added only msgpack==1.2.1 to test-image requirements, using the
  existing production/constraint pin. Rebuild, pip check and isolated import
  smoke PASS; installed-version comparison confirms no other package changes.
- Full backend static graph: 9 -> 9 cyclic groups, largest 300 -> 300, identical
  cyclic members. All 251 reviewed boundary modules are acyclic. Syntax and
  git diff --check PASS. No production edits outside views.py and new meetings
  owners. No SQL/schema/provider algorithms changed or unproven fallbacks deleted.
- Commands: python -I -B backend/phase1f_tests/image/run_meeting_checks.py;
  python -I -B backend/phase1f_tests/image/run_meeting_postgresql.py;
  python -I -B backend/phase1f_tests/image/run_integration.py;
  python -I -B backend/phase1f_tests/image/run_import_smoke.py;
  npm.cmd --prefix frontend run test:teams;
  python -I -B D:/Temp/HP/lms-meeting-boundary-20261122/run_standalone_parallel.py after.
  Evidence, exact task diff and file list: D:/Temp/HP/lms-meeting-boundary-20261122/.
- Runtime network-none/loopback-only isolation proved before initdb/Django;
  dummy/disposable aliases, no host mounts/credentials/published ports. Owned
  containers removed. No Neon/existing DB, live Microsoft/provider operations,
  .env changes, commit/PR/push, deployment or branch switch. G01-G05 remain open.
- Next cohesive block: meeting summary/sync verdict, restore and link attachment
  endpoints, then remaining calendar read/transport composition. Legacy facades
  and other bounded contexts still need work; Architecture V1 is not full legacy
  elimination and these mocks do not establish live Microsoft correctness.

### Meeting calendar, shared ownership and storage boundary - PASS (2026-11-22)

- Continued the explicitly approved meeting extraction and mocked Teams checks
  on Architecture / HEAD 606aca43df97967e8cb1fab45c5a794cc0635246.
  views.py 15,912 -> 14,834 (-1,078 net); 33 original function bodies total
  1,575 lines. Existing URLs, decorators, signatures and runtime bindings remain.
- Concrete owners under meetings/: api/{calendar,module_links,serialization}.py;
  application/{calendar_status,shared_delivery}.py;
  domain/calendar_policy.py; infrastructure/{session_reads,session_writes}.py.
  Domain owns calendar choice and occurrence identity/scheduling decisions;
  application owns sync/read composition; infrastructure owns stored queries
  and persistence; API owns transport payloads and existing HTTP workflows.
  Public facade wiring is transitional; this is not complete legacy elimination.
- Preserved query text, transaction boundaries, date-first occurrence pairing,
  cancelled-row identity, shared-source ownership, partial link replacement,
  restore GET/probe/POST distinctions, sync multiset rules and error responses.
  Calendar fallback imports remain deferred on the original error path.
  No business-rule changes or unproven deletion of active compatibility paths.
- Added 4 source-contract checks and 19 old/new public-facade comparisons.
  Existing assertion behavior retained; two test loaders now reach actual
  owners. New frozen source: meetings/tests/fixtures/calendar_snapshot.json;
  previous frozen baselines and their hashes remain unchanged.
- Final selected checks: 611 mocked Teams/contracts + 45 disposable PostgreSQL
  Teams + 175 existing PostgreSQL/HTTP + 1,391 Django fixtures + 270 guarded
  standalone + 162 frontend Teams = 2,654 PASS, 0 FAIL, 0 SKIPPED.
  Import smoke, syntax and git diff --check PASS. Initial test-harness encoding
  and exception-comparison failures were corrected; evidence retains all runs.
- Static full-backend graph: 1,360 -> 1,368 modules; 9 -> 9 cyclic groups,
  largest 300 -> 300 with identical members. All 259 reviewed boundary modules
  are acyclic; new owners import no legacy facade, framework or provider.
- Commands: python -I -B backend/phase1f_tests/image/run_meeting_checks.py;
  python -I -B backend/phase1f_tests/image/run_meeting_postgresql.py;
  python -I -B backend/phase1f_tests/image/run_integration.py;
  python -I -B backend/phase1f_tests/image/run_import_smoke.py;
  npm.cmd --prefix frontend run test:teams;
  python -I -B D:/Temp/HP/lms-meeting-status-20261122/run_standalone_parallel.py verified.
  Exact task diff, file list and results: D:/Temp/HP/lms-meeting-status-20261122/.
- Isolation verified before Django/initdb: network-none/loopback-only runtime,
  synthetic data, dummy/disposable aliases, no host mounts/credentials/ports.
  No Neon, existing DB, live provider, schema migration, .env, commit/PR/push,
  deployment or branch switch. G01-G05 are not automatically closed.
- Next coherent block: remaining meeting result-content/recording delivery and
  provider transport composition. Existing summary read-failure empty responses
  remain a separate error-contract decision; this extraction does not validate
  live Microsoft behavior or remove the remaining legacy cycles.


### Meeting provider composition and result delivery boundary - PASS (2026-11-22)

- Architecture / HEAD 606aca43df97967e8cb1fab45c5a794cc0635246 unchanged.
  views.py 14,834 -> 13,573 (-1,261 net); 52 original bodies totaling 1,737
  lines moved into 13 concrete owners. URLs, public signatures, decorators,
  database statements, transaction boundaries and response contracts preserved.
- New meetings/ owners: domain/{invitation_policy,recurrence_policy,attendance_policy};
  application/{invitation_preparation,calendar_publication,meeting_options,artifact_identity};
  infrastructure/{graph_identity,graph_payloads,graph_reads,artifact_storage};
  api/{content_delivery,recording_tracking}. No empty packages or generic service
  containers. The facade supplies explicit capabilities; owners import no legacy
  facade, Django or provider. Conditional imports resolve at their original points,
  including Bunny/archive selection and Graph failure handling.
- Preserved invitee ordering/roles, recurrence and DST behavior, scoped occurrence
  movement, silent/announced updates, pending option warnings, attendance grouping,
  artifact identity/visibility locks, server-owned metadata, original-file delivery,
  Range/206/416 responses, authenticated viewer identity and 200-event limits.
  Active historical compatibility paths remain; no path was proven dead or safe
  to delete in this batch. No new fallback or second business-rule implementation.
- Added 4 exact source/public-binding contracts and 26 old/new public-facade
  comparisons. Existing 70 meeting and 19 calendar parity cases still pass.
  Extended the fixture loader to reach actual owners and retained all earlier
  immutable baselines. New snapshot: meetings/tests/fixtures/delivery_snapshot.json.
  Cancellation assertions now inspect the extracted options owner as well.
- Validation: 674 distinct mocked/dummy-Django Teams, media and delivery cases;
  45 disposable PostgreSQL Teams; 175 existing PostgreSQL/HTTP; 1,391 Django
  fixtures; 270 guarded standalone; 162 frontend Teams = 2,717 PASS, 0 FAIL,
  0 SKIPPED. A repeated 42-case notification suite is not double-counted.
  Import smoke, syntax, exact AST restoration and git diff --check PASS.
- Static backend graph: 1,368 -> 1,381 modules; cyclic groups 9 -> 9, largest
  300 -> 300, identical members. All 272 reviewed boundary modules are acyclic.
  This is verified dependency separation, not elimination of existing LMS cycles.
- Commands: python -I -B backend/phase1f_tests/image/run_meeting_checks.py;
  same runner with test_teams_notification_rules_no_db test_session_content_provider_no_db
  test_session_media_no_db test_session_downloads_no_db for final added/updated checks;
  python -I -B backend/phase1f_tests/image/run_meeting_postgresql.py;
  python -I -B backend/phase1f_tests/image/run_integration.py;
  python -I -B backend/phase1f_tests/image/run_import_smoke.py;
  npm.cmd --prefix frontend run test:teams;
  python -I -B D:/Temp/HP/lms-meeting-delivery-20261122/run_standalone_parallel.py final.
  Task-start diff, changed-file list, graph and logs: D:/Temp/HP/lms-meeting-delivery-20261122/.
- Isolation proven before initdb/Django: network-none/loopback-only containers,
  synthetic records, dummy/disposable aliases, no host mounts, credentials or ports.
  No Neon/existing DB, live Microsoft/provider calls, .env, migrations, commits,
  PRs, pushes, branch changes or deployment. G01-G05 are not automatically closed.
- Remaining: active facade composition and smaller legacy helpers. The next
  coherent work is meeting lifecycle/invitee guards and reducing feature API
  dependence on views.py through reviewed context composition. Preserve late
  bindings and public imports; relocating all wrappers to another giant file is
  not completion. Live-provider behavior is outside this local verification.

### Meeting lifecycle, invitation reads and change notices - PASS (2026-11-22)

- Architecture / HEAD 606aca43df97967e8cb1fab45c5a794cc0635246 unchanged.
  views.py 13,573 -> 13,187 (-386 net); 17 original function bodies (585 lines,
  excluding retained decorators) moved into 9 concrete owners. Existing public
  signatures, URLs, decorators and late-bound dependencies remain compatible.
- New meetings/ owners: api/{lifecycle,change_notifications,invitees}.py;
  application/{delivery_validation,invitee_queries}.py;
  domain/module_delivery.py;
  infrastructure/{tracking_schema,lifecycle_reads,invitee_reads}.py.
  Invitation HTTP validation, payload construction and normalized ORM reads are
  separate responsibilities. No generic container, repository or empty package.
- Preserved normalized-plan invitation sources, first-spelling deduplication,
  response sorting, out-of-placement assignments and existing inactive-learner
  behavior. No group-roster substitution or lifecycle filter. Archive guards,
  shared identity, calendar refusal, holidays, email opt-in/authorization,
  recipients and retry notice identities remain unchanged. Readiness flags stay
  in the facade; SQL and cache invalidation statements are unchanged.
- Added 5 exact source/binding contracts, 34 old/new behavior cases, and 2 real
  HTTP/ORM invitation checks in disposable PostgreSQL. Added the full existing
  78-case email suite to the explicit isolated selection. Snapshot/oracle files
  live under meetings/tests/; earlier frozen baselines are byte-for-byte intact.
- Final distinct tests: 791 mocked/dummy-Django meeting cases + 47 disposable
  PostgreSQL meeting cases + 175 existing PostgreSQL/HTTP + 1,391 Django fixtures
  + 270 guarded standalone + 162 frontend = 2,836 PASS, 0 FAIL, 0 SKIPPED.
  Initial harness failures required package metadata and two static email assets
  in the sanitized bundle. One stale message assertion failed identically against
  task-start sources; its expectation now matches the exact existing participant
  invitation error. The application message and refusal rule were not changed.
- Import smoke, exact AST restoration, syntax and git diff --check PASS.
  Static backend graph: 1,381 -> 1,390 modules; 9 -> 9 cyclic groups, largest
  300 -> 300, identical members. All 281 reviewed boundary modules are acyclic.
- Commands: python -I -B backend/phase1f_tests/image/run_meeting_checks.py;
  targeted reruns of test_teams_notification_rules_no_db, test_schedule_email_no_db
  and test_lifecycle_behavior_parity; run_meeting_postgresql.py, run_integration.py
  and run_import_smoke.py under the same image directory; npm.cmd --prefix frontend
  run test:teams; guarded standalone runner under the evidence directory below.
  Task-relative diff, exact file list, original-failure reproduction, test logs
  and graph: D:/Temp/HP/lms-meeting-lifecycle-20261122/.
- Isolation verified before Django/initdb: network-none/loopback-only disposable
  containers, synthetic fixtures, dummy/disposable aliases, no host credentials,
  mounts or published ports. No Neon/existing DB, live provider calls, .env
  changes, migrations, commit/PR/push, branch switch or deployment. G01-G05 remain
  open; local checks do not establish live Microsoft or full endpoint equivalence.
- Remaining: legacy facade wiring and existing cyclic groups. Next reduce direct
  feature-consumer dependence on views.py for already-extracted policies and
  compose concrete context APIs while preserving late bindings. Active points
  and calendar-read error fallbacks were preserved; no path was proven dead or
  removable without a separate behavior decision in this batch.

### Concrete meeting policies and direct consumers - PASS (2026-11-22)

- Architecture / HEAD 606aca43df97967e8cb1fab45c5a794cc0635246 unchanged.
  views.py 13,187 -> 12,974 (-213 net). Removed 24 forwarding functions and
  relocated 3 instant helpers; all 27 existing names remain direct re-exports
  with identical signatures. No replacement facade/container was introduced.
- Existing meetings/domain/{invitation_policy,recurrence_policy,attendance_policy}
  now compose their actual pure dependencies directly. The scheduling/pairing
  subset of calendar_policy follows the same contract. New domain/instants.py
  owns parsing; api/time_serialization.py owns UTC response serialization.
  Providers, storage, writers and other runtime capability bindings are unchanged.
- teams_attendee_compare.published_invitation_list and
  teams_imported_meeting_edit.emails now call invitation_policy directly, without
  loading views.py for these operations. Other IO paths in those files still use
  existing composition. No claim that their entire modules are facade-independent.
- Added 91 pure checks, including 85 original-source/current-policy scenarios
  covering all 27 functions, exact signatures/bodies, mutation behavior, malformed
  inputs, duplicate recipients, recurrence, offset handling and attendance groups.
  Earlier immutable snapshots remain byte-for-byte intact. Existing source tests
  now validate direct exports/import allowlists or load actual owners, retaining
  their behavioral assertions and synthetic ports.
- Final selected cases, excluding repeated commands: 984 mocked/dummy-Django
  meeting checks + 47 disposable PostgreSQL meeting checks + 175 PostgreSQL/HTTP
  + 1,391 Django fixtures + 270 guarded standalone + 162 frontend = 3,029 PASS,
  0 FAIL, 0 SKIPPED. Import smoke, syntax and git diff --check PASS.
  Initial failures were outdated AST fixture loaders/bundle dependencies.
  Two additional existing failures were reproduced against task-start sources:
  a holiday-policy mock missing module_catalogue_id and a cancellation audit not
  recognizing the existing group-calendar path. The mock now matches the real
  signature; the audit recognizes that site AND checks the exact sole DELETE
  remains inside the explicit cancel/group branch, with the confirmed-action
  chain still asserted. No production cancellation code or error contract changed.
- Static backend graph: 1,390 -> 1,392 modules; 9 -> 9 cyclic groups with identical
  members, largest 300 -> 300. All 283 reviewed boundary modules remain acyclic.
  Domain imports are limited to standard library and existing pure value modules;
  the concrete policies import no views, Django, storage or provider modules.
- Commands: python -I -B backend/phase1f_tests/image/run_meeting_checks.py plus
  explicit failing-suite/final-contract reruns; run_meeting_postgresql.py,
  run_integration.py and run_import_smoke.py in that image directory;
  npm.cmd --prefix frontend run test:teams; the guarded 48-file standalone runner.
  Task diff, file list, commands/logs, graph and pre-existing failure reproduction:
  D:/Temp/HP/lms-context-composition-20261122/.
- Verified existing disposable isolation before Django/initdb: network-none or
  shared loopback namespace, synthetic fixtures and aliases, no host credentials,
  mounts or published ports. No Neon/existing DB, live Microsoft/provider calls,
  environment changes, migrations, commits, PRs, pushes, branch changes or deploy.
  G01-G05 remain open; this does not establish live-provider or full LMS parity.
- Next: reduce the remaining catalogue consumer/facade dependencies using concrete
  read and policy entry points. Preserve IO timing and writer behavior; remaining
  runtime composition and legacy cycles still require incremental integration.


### 2026-11-22 ? Concrete catalogue content reads and archive policy ? PASS

- Existing Architecture checkout and HEAD 606aca43df97967e8cb1fab45c5a794cc0635246 preserved.
  views.py: 12,974 -> 12,926 lines (-48); six functions become direct exports.
  Content-count composition supplies one storage-routing capability instead of eight.
- Domain: archive_policy owns existing status normalization, row/payload deletion
  predicates and week/mapping filters. content_values uses that same policy by
  default and preserves its existing explicit pure-helper override contracts.
- Infrastructure: grouped_content and content_counts use concrete database/KSB
  read owners; archive_sql owns existing status-table SQL predicates. Existing
  aliases remain compatible. No query/filter/grouping/normalization/ranking changes.
- catalogue_summary_reads is now a direct export (19 -> 2 lines); ksb_stats_reads
  uses concrete read/policy owners, with no views import. Existing archive/name
  modules re-export the pure rules; all remaining writer bodies are unchanged.
- Validation: 301 guarded standalone cases in 49 files (31 new), 175 disposable
  PostgreSQL/HTTP cases, 1,399 Django fixture cases (8 new), 984 mock-only meeting
  cases, 47 disposable PostgreSQL meeting cases, 162 frontend Teams cases.
  Final suite totals (excluding failed attempts/reruns): 3,068 PASS, 0 FAIL,
  0 SKIP. Import smoke, syntax and
  git diff --check PASS. Earlier mock/AST-loader failures were corrected at the
  new lookup sites; frozen original sources and behavioral assertions retained.
- Static backend graph: 1,392 -> 1,394 modules; 9 -> 9 cyclic groups; largest
  300 -> 298. No new cyclic groups/members; 285 reviewed boundary modules acyclic.
- Commands: image/run_integration.py, run_meeting_checks.py,
  run_meeting_postgresql.py, run_import_smoke.py (python -I -B);
  npm.cmd --prefix frontend run test:teams; guarded standalone runner with final
  targeted KSB/source-contract reruns. Evidence, exact task diff, scope and logs:
  D:/Temp/HP/lms-catalogue-content-20261122/.
- Existing Docker isolation verified before startup: no external network,
  host mounts/credentials or published ports; disposable synthetic data only.
  No Neon, live provider operations, environment changes, migrations, commits,
  PRs, pushes, branch changes or deployment. G01-G05 remain open.
- Next: authoring_read_transport/programme_workspace_reads composition and their
  remaining views dependencies; preserve schema-guard timing and writer behavior.


### 2026-11-22 - Concrete authoring/workspace read composition - PASS

- Existing Architecture checkout and HEAD 606aca43df97967e8cb1fab45c5a794cc0635246 preserved.
  views.py: 12,926 -> 12,837 lines (-89); authoring_read_transport: 43 -> 2;
  programme_workspace_reads: 45 -> 4; learning_storage: 391 -> 317;
  free_course_native_schema: 362 -> 339. Existing entry points remain exports.
- Infrastructure authoring_runtime now owns the concrete composition of source
  routing, schema-check timing, completion, memoized reads, prefetch and compact
  transport. Programme child reads use these owners directly. Existing SQL,
  projections, parameter/row order, native routing, snapshot reuse and bounded
  race recovery remain unchanged. Domain component_text_cancels uses its existing
  pure value functions by default, with explicit override contracts retained.
- learning_read_routes owns the existing readiness caches, refresh/negative TTL,
  native and union relation selection. learning_storage exports the SAME functions
  and cache objects. learning_relations supplies the SAME metadata to readers and
  the existing migration helper, without importing the migration implementation.
  authoring_columns owns the shared projection contract.
- authoring_schema_runtime owns the single authoring-ready latch and unchanged
  guard/provision sequence. reset_schema_ready_flags resets that owner. Production
  still uses the read-only schema gate; the existing opt-in local provisioning
  path and DDL implementation are unchanged, not expanded or executed on live data.
  Calendar read lookups now use concrete read/value owners instead of views.
- Tests: 309 guarded standalone cases in 50 files, 175 disposable PostgreSQL/HTTP,
  1,408 Django fixture cases, 984 mocked meeting cases in 37 suites, 47 disposable
  PostgreSQL meeting cases, 162 frontend Teams cases. Final suite totals excluding
  repeats: 3,085 PASS, 0 FAIL, 0 SKIP. Added 8 standalone and 9 isolated Django
  composition cases; the latter also passed a final network-none/dummy-DB run.
  Import smoke, syntax and git diff --check PASS. All 63 prior JSON fixtures
  remain byte-for-byte unchanged; the new snapshot contains task-start sources.
- Initial failures came from mocks/AST loaders still targeting the legacy exports
  and test-runner registration/context-manager setup. Updated the lookup sites
  and exact alias checks; no assertions or expected behavior were removed. The
  frozen original algorithms still supply parity expectations. Coverage includes
  SQL/parameters, full workspace/revision payloads, KSB projection, provisioning
  failure/ready state, native routing, cache refresh, read scope and text selection.
- Static backend graph: 1,394 -> 1,399 modules; largest cyclic group 298 -> 284.
  Cyclic groups 9 -> 10 because the already-existing curriculum_names/calendar_holidays
  pair separated from the large group. No newly cyclic modules or unrelated new
  cycle membership. All 290 reviewed boundary modules remain acyclic. The isolated
  legacy pair is outstanding work, not claimed resolved.
- Commands: python -I -B image/run_integration.py, run_meeting_checks.py,
  run_meeting_postgresql.py, run_import_smoke.py; npm.cmd --prefix frontend run
  test:teams; guarded standalone runner with final transport/workspace reruns;
  final focused network-none Django check. Evidence, exact task-start copies,
  file list, test logs and graph: D:/Temp/HP/lms-authoring-workspace-20261122/.
- Isolation verified before application/database startup: no external runtime
  network, host mounts, real credentials or published ports. Disposable synthetic
  PostgreSQL/dummy databases only; owned containers removed. No Neon/existing DB,
  providers, environment changes, migrations, commits, PRs, pushes, branch switches
  or deployment. G01-G05 remain open; this does not establish complete LMS parity.
- Next: separate the remaining placement-name/calendar read dependency and wire
  catalogue consumers directly to these read owners, reducing the views facades
  while retaining the current authorization, writer and response contracts.

### 2026-11-23 - Placement/name read ownership and calendar cycle removal - PASS

- Existing Architecture checkout and HEAD 606aca43df97967e8cb1fab45c5a794cc0635246
  preserved. curriculum_names.py: 446 -> 93 lines; calendar_holidays.py: 199 -> 186;
  views.py: 12,837 -> 12,815. These legacy files shrink by 388 lines in total.
- Domain placement_labels (121 lines) owns the existing plain-value names,
  multiple/single-coach compatibility and ordered live-child projections.
  Infrastructure placement_reads (236 lines) owns the unchanged lookup SQL,
  optional-table metadata, request-local cache, TTL, invalidation and row completion.
  The compatibility facade exports the SAME functions/cache objects; staff_id
  and store_staff bodies remain unchanged. Calendar writes invalidate the owner
  at the same point; no writer algorithm or transaction was changed.
- holiday_reads owns calendar availability; placement_reads composes existing
  cohort-calendar selection before name completion without importing the legacy
  calendar facade. authoring_runtime and the reviewed Home/structure consumers
  use the concrete reader. ksb_read_store owns the existing standard-row query
  and atomic digest/cache pair; views retains its compatible function export.
- Preserved SQL, row/parameter ordering, selected-column precedence, optional
  schema handling, empty/error behavior, request-token/TTL rules and current
  authorization/response contracts. No unsupported fallback was deleted: the
  single-coach compatibility path still has active consumers and coverage.
- Final checks: 317 guarded standalone cases across 51 files; 175 disposable
  PostgreSQL/HTTP cases; 1,435 isolated Django fixture cases; 984 mocked meeting
  cases across 37 suites; 47 disposable PostgreSQL meeting cases; 162 frontend
  Teams cases. Final suite totals excluding repeats: 3,120 PASS, 0 FAIL, 0 SKIP.
  Added 8 standalone and 8 isolated composition cases; registered 19 existing
  curriculum-name cases in the isolated suite. Import smoke, syntax and
  git diff --check PASS. All 67 task-start JSON files inspected remain unchanged;
  the new snapshot records only this batch's original production source.
- Initial failures were stale fixture lookup sites, a missing bundle target and
  an older source-contract test counting the newly relocated KSB reader. Updated
  those sites and exact source restoration; retained original assertions and
  frozen algorithms. A transient import-edit syntax error was caught before
  startup and corrected. Final integration and affected standalone reruns passed.
- Static graph: 1,399 -> 1,401 backend modules; cyclic groups 10 -> 9; the
  curriculum_names/calendar_holidays cycle is removed, without new cyclic members.
  Largest existing cyclic group remains 284. All 292 reviewed boundary modules
  are acyclic; this is not a claim that the whole backend is acyclic.
- Known scope limit: placement lookup caching retains its existing thread-local,
  non-alias-keyed behavior. No cache redesign or complete multi-database parity
  is claimed. Existing G01-G05 remain open; these results do not establish full
  LMS or live-data parity.
- Commands: python -I -B image/run_integration.py, run_meeting_checks.py,
  run_meeting_postgresql.py, run_import_smoke.py; npm.cmd --prefix frontend run
  test:teams; guarded standalone tests with final targeted source-contract reruns.
  Evidence, exact task-start copies, changed-file list, graph and logs:
  D:/Temp/HP/lms-placement-names-20261123/.
- Isolation verified before startup: runtime network disabled, no host mounts,
  real credentials or published ports; disposable synthetic PostgreSQL/dummy DBs
  only. No Neon, live providers, environment changes, migrations, branch changes,
  commits, PRs, pushes, merges or deployment.
- Next: concrete composition of get_authoring_structure_payloads and adjacent
  module-structure reads, reducing views dependency wiring while preserving
  schema-guard timing, holiday/staff enrichment and writer contracts.

### 2026-11-23 - Concrete entry composition extraction - PASS; views completion OPEN

- Same Architecture branch/HEAD preserved. views.py: 12,815 -> 9,487 lines
  (-3,328); 751 -> 432 functions. Moved 319 functions and 72 shared values into
  28 concrete owners (27 new modules), retaining identical public exports.
- Catalogue owners cover value rules, row queries, content/calendar/placement
  runtime wiring, cache composition and HTTP adapters. Reporting owns source
  values/read contracts and progress runtime; meetings owns session/calendar
  runtime and HTTP adapters. Existing application algorithms remain authoritative.
  Exact symbol/file mapping: catalogue/tests/fixtures/legacy_snapshots/
  entry_composition_snapshot.json. No empty packages or replacement monolith.
- Preserved function signatures, decorators, SQL, transactions and responses.
  The existing optional global lookup in apply_shared_teams_settings_to_weeks
  now directly references teams_module_owner_id in the same owner. Shared cache,
  lock and thread-local objects retain identity; logger name remains unchanged.
  Registry-dependent revision wrappers and mutable readiness flags remain in
  views. Active compatibility paths were retained where deletion lacked evidence.
- Final results: 324 guarded standalone cases/52 files; 175 disposable
  PostgreSQL/HTTP; 1,441 isolated Django fixture cases; 984 mocked meeting
  cases/37 suites; 47 disposable PostgreSQL meeting cases; 162 frontend Teams
  cases/9 files. Total: 3,133 PASS, 0 FAIL, 0 SKIP, excluding repeated runs.
  Import smoke, syntax and git diff --check PASS; 68 prior JSON fixtures unchanged.
- New tests check actual source/signatures, all public alias identities, pure
  imports, dependency boundaries and HTTP/read contracts. Existing fixtures now
  follow concrete lookup sites and actual relocated AST bodies. Original parity
  expectations remain; cache-header comparisons use the same synthetic clock.
  Review caught and corrected two layer-placement errors before acceptance.
- Static backend graph: 1,401 -> 1,428 modules; 9 -> 9 cyclic groups; largest
  existing group remains 284. All 319 reviewed boundary modules are acyclic.
  No external production assignments to the moved facade aliases were found.
- Commands: python -I -B image/run_integration.py, run_meeting_checks.py,
  run_meeting_postgresql.py, run_import_smoke.py; guarded standalone runner;
  npm.cmd --prefix frontend run test:teams; git diff --check.
  Task-start copies, exact diff, changed-file list, graph and execution logs:
  D:/Temp/HP/lms-views-composition-20261123/.
- OS isolation passed before Django/initdb: no external runtime network, host
  mounts, real credentials or published ports. Synthetic disposable databases
  only; owned containers removed. No Neon, live providers, environment changes,
  branch changes, commits, PRs, pushes, merges or deployment.
- Remaining: views still contains 432 functions/6,899 function lines plus imports,
  registries and composition state. Next remove shared cache/schema-state and
  registry dependencies, then move their dependent catalogue/meeting composition
  groups. Finishing views requires resolving those dependencies, not merely moving
  the remaining file wholesale. G01-G05 and full LMS acceptance remain open.

### 2026-11-23 - Cache/schema ownership and dependent composition - PASS; views completion OPEN

- Same Architecture branch/HEAD retained. views.py: 9,487 -> 8,074 lines
  (-1,413), 432 -> 320 functions. Moved 112 functions and 18 values from views
  into concrete owners. cache_scope.py: 389 -> 13 lines; module_live.py:
  313 -> 170 lines. Combined reduction across these three legacy files: 1,932.
- Scoped epoch SQL, locks and state now belong to scoped_epochs; module write
  counters, commit hooks and polling belong to module_epochs. Both retain
  compatibility exports with shared object identity. Pure HTTP-path classification
  lives in infrastructure/cache_scope_paths, since cache invalidation is a
  technical responsibility. No new domain abstractions or empty packages.
- Course/template and meeting-tracking readiness flags each have one owner.
  Existing production gates, opt-in provisioning, failure propagation and reset
  behavior are preserved. Removed the unused _TRAINING_PLAN_CANONICAL_READY latch
  and the obsolete views-owned flag registry. No schema changes or live DDL.
- Dependent catalogue reads, hierarchy/component/template composition and KSB
  source-catalogue reads now import concrete capabilities. HTTP response/query
  adapters remain in API. Nineteen owners participate, including 15 new modules;
  the longest new module is 366 lines. Exact mapping and task-start source:
  catalogue/tests/fixtures/legacy_snapshots/runtime_ownership_snapshot.json.
- Existing SQL, filters, ordering, decorators, signatures and error boundaries
  are retained. teams_delivery_metadata_from_live_session now references the
  existing teams_module_owner_id directly instead of looking it up via globals;
  a synthetic alias test verifies resolution before reading and serialization.
  Existing active compatibility behavior remains where deletion lacked evidence.
- Validation: 330 guarded standalone cases/53 files; 175 disposable PostgreSQL/
  HTTP cases; 1,448 isolated Django fixture cases; 984 mocked meeting cases/37
  suites; 47 disposable PostgreSQL meeting cases; 162 frontend Teams cases/9 files.
  Final combined result: 3,146 PASS, 0 FAIL, 0 SKIP, excluding repeated tests.
  The meeting run initially had one source-binding assertion failure; its four
  contract tests passed after updating the expected direct owner binding.
  Final cache-path relocation additionally passed 13 source-contract tests and
  12 isolated cache/owner tests. Import smoke, syntax and git diff --check PASS.
- Review caught a cache-decorated function incorrectly placed in Domain and an
  infrastructure dependency on an API serializer; both were corrected. Earlier
  fixture failures concerned removed readiness globals and a cache injection
  still targeting views. Updated dependency injection sites, preserving assertions
  and frozen implementations. All 69 pre-existing JSON fixtures remain unchanged.
- Static backend graph: 1,428 -> 1,443 modules; 9 -> 9 cyclic groups; largest
  existing group 284 -> 282. cache_scope and module_live leave that group; no
  newly cyclic members. All 334 reviewed boundary modules are acyclic. This does
  not mean the remaining legacy backend has no cycles.
- Commands: python -I -B image/run_integration.py, run_meeting_checks.py,
  run_meeting_postgresql.py, run_import_smoke.py; guarded standalone runner and
  focused final contract/cache reruns; npm.cmd --prefix frontend run test:teams;
  git diff --check. Evidence, original copies, exact diff, graphs and logs:
  D:/Temp/HP/lms-runtime-ownership-20261123/.
- Runtime isolation verified before Django/initdb: network none or shared isolated
  loopback, no host mounts, host credentials or published ports. Only disposable
  synthetic PostgreSQL/dummy backends; owned containers removed. No Neon, live
  Microsoft/provider calls, .env changes, commits, PRs, pushes or deployment.
- Remaining: views still has 320 functions/5,654 function lines, imports and
  registries. Next resolve revision/record registry dependencies and extract the
  module-structure read/save composition groups while retaining existing writer
  transaction and authorization tests. G01-G05 and full LMS acceptance stay open.

### 2026-11-23 - Revision registry and storage composition - PASS; views completion OPEN

- Same Architecture branch and HEAD retained. views.py: 8,074 -> 6,962 lines
  (-1,112), 320 -> 247 functions. Moved 73 functions and 10 values into concrete
  catalogue, reporting and meeting owners; legacy names remain direct exports.
  learning_storage.py: 317 -> 71 lines (-246), with 12 read/routing/persistence
  functions moved intact. Combined reduction in these legacy files: 1,358 lines.
- Course routing/reads and persistence have separate infrastructure owners.
  Conversion orchestration and the existing creation refusal remain in the
  compatibility entry. SQL, row locks, transaction ownership, generator handling,
  native storage selection, price validation and write ordering are unchanged.
  Pricing and KSB table naming use their concrete owners without importing views.
- Revision readers, row locks and the shared CURRICULUM_RECORD_REVISIONS registry
  now belong to revision_runtime; HTTP revision/refusal adapters remain in API.
  Catalogue resolution, hierarchy/lifecycle persistence, template persistence,
  meeting persistence and reporting response composition have explicit owners.
  No new application algorithm or domain hierarchy was needed: their existing
  application/domain implementations remain authoritative. Fifteen new owner
  modules; longest new module 222 lines. No empty packages or copied algorithms.
- Source fidelity checks cover all 73 moved views bodies and 12 storage bodies.
  New cases exercise actual owner exports, registry identity/order, unknown and
  failed readers, HTTP deduplication, ordinary/native row locks, scope restoration,
  iterator consumption and SQL literals/comments. Existing fixture injection now
  follows actual owners; all 70 pre-existing JSON fixtures remain unchanged.
- Validation: 338 guarded standalone cases/54 files; 175 disposable PostgreSQL/
  HTTP cases; 1,456 isolated Django fixture cases; 984 mocked meeting cases/37
  suites; 47 disposable PostgreSQL meeting cases; 162 frontend cases/9 files.
  Final relevant results: 3,162 PASS, 0 FAIL, 0 SKIP, excluding repeat runs.
  Final template-owner placement additionally passed 36 source-contract cases,
  the full 175 + 1,456 integration selection and isolated import smoke.
- Review corrected grouping cycles and API dependencies placed in infrastructure;
  the coverage error/response composition belongs to API, and template saving
  belongs with template composition. Initial standalone failures identified this
  layer error and an obsolete KSB import-binding expectation; both were resolved
  without weakening SQL/body assertions. Initial frontend run had a 5-second
  timeout followed by a duplicate-DOM failure; an unchanged isolated rerun passed
  162/162. No frontend edits or test timeout increases.
- Backend graph: 1,443 -> 1,458 modules; 9 -> 9 cyclic groups; largest existing
  group 282 -> 279. free_course_pricing, ksb_mapping_placement and write_shape
  leave that group; no newly cyclic modules. All 349 reviewed boundary modules
  are acyclic. Syntax, isolated import smoke and git diff --check PASS.
- Commands: python -I -B image/run_integration.py, run_meeting_checks.py,
  run_meeting_postgresql.py, run_import_smoke.py; guarded standalone runner;
  npm.cmd --prefix frontend run test:teams; git diff --check. Task-start copies,
  exact diff, final counts, graph and logs: D:/Temp/HP/lms-registry-composition-20261123/.
  New source snapshot: catalogue/tests/fixtures/legacy_snapshots/registry_composition_snapshot.json.
- Runtime isolation proved before Django/initdb: no external network, host
  credentials/mounts or published ports. Synthetic disposable databases only;
  owned containers removed. No Neon, live providers, environment changes, branch
  changes, commits, PRs, pushes, merges or deployment.
- Remaining: views has 247 functions/4,646 function lines. Module-structure
  read/save orchestration still depends on country/delivery-calendar composition
  and cache invalidation/warming. Next separate those concrete dependencies and
  move their coherent callers; do not move the residual monolith wholesale.
  No active compatibility behavior was deleted without evidence. G01-G05 and
  full LMS acceptance remain open; this batch does not finish views.py.

### 2026-11-23 - Calendar and module-structure composition - PASS; views completion OPEN

- Same Architecture branch and HEAD retained. views.py: 6,962 -> 5,794 lines
  (-1,168), 247 -> 170 functions. Moved 77 functions and four values; public names
  remain direct exports of their actual owners. Additional legacy reductions:
  country_calendars 165 -> 122, delivery_calendar 83 -> 7, delivery_dashboard
  141 -> 30, calendar_read_rows 41 -> 4. Combined reduction: 1,435 lines.
- Concrete infrastructure owns stored country calendars, inherited cohort holidays,
  session plans, authored session inputs, tutor availability and existing calendar
  persistence bindings. API owns structure payload/response assembly, programme
  module assembly, staff profile composition and delivery HTTP composition.
  Meetings owns calendar verification bindings. Existing application/domain
  algorithms remain authoritative; no generic interfaces or copied policies.
  Seventeen new owner files; longest 194 lines. No empty packages.
- Country calendar reads no longer load provider synchronization through views.
  Missing/expired calendars still raise CalendarUnavailable; cohort display keeps
  errors scoped to the affected cohort. Provider/sync bodies stay unchanged.
  Delivery overview/sessions retain their original authentication decorators in
  the existing entry module; their read composition has no reverse views import.
  SQL, calendar choices, session dates, booked-date protection, transactions,
  HTTP payloads, authorization and cache keys are preserved.
- Source fidelity covers all 77 moved functions, all 170 remaining views functions,
  four values, 23 additional calendar/dashboard symbols and unchanged provider/
  authenticated endpoint bodies. Ten new standalone and seven actual-owner runtime
  tests cover identity, expiry boundaries, country/year selection, missing dates,
  duplicates, per-cohort failure isolation, inherited selections and schema refusal.
  Existing behavioral assertions and all 71 pre-existing JSON fixtures unchanged.
- Validation: 348 guarded standalone cases/55 files; 175 disposable PostgreSQL/HTTP
  cases; 1,463 isolated Django fixture cases; 984 mocked meeting cases/37 suites;
  47 disposable PostgreSQL meeting cases; 162 frontend cases/9 files.
  Final results: 3,179 PASS, 0 FAIL, 0 SKIP, excluding repeated verification.
  The complete meeting selection ran; its four failed suites passed after updating
  fixture injection/import paths, with no selection or expectation reductions.
  Source review caught and restored unintended encoding drift from task-start
  copies; final source contracts and integration checks passed afterward.
- Backend graph: 1,458 -> 1,475 modules; nine cyclic groups remain; largest existing
  group 279 -> 275. No newly cyclic modules. All 366 reviewed boundary modules
  are acyclic. Syntax, isolated import smoke and git diff --check PASS.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py,
  run_meeting_checks.py, run_meeting_postgresql.py, run_import_smoke.py;
  guarded standalone runner and focused source/fixture reruns;
  npm.cmd --prefix frontend run test:teams; git diff --check.
  Evidence, initial copies, exact diff, graphs and results:
  D:/Temp/HP/lms-calendar-composition-20261123/.
- Isolation verified before initdb/Django: no external network, host mounts,
  credentials or published ports. Synthetic disposable PostgreSQL only; owned
  containers removed. No Neon, live providers, frontend source edits, environment
  changes, branch switches, commits, PRs, pushes, merges or deployment.
- Remaining: views retains 170 functions/3,578 function lines plus imports and
  compatibility exports. Next separate cache invalidation/warming composition and
  the dependent module-authoring save/command groups, keeping writer contracts and
  isolated transaction tests. No active compatibility behavior was removed without
  evidence. G01-G05 and full LMS acceptance remain open; views.py is not finished.

### 2026-11-23 - Cache worker and programme detail ownership - PASS; views completion OPEN

- Architecture branch and HEAD retained. views.py: 5,794 -> 5,255 lines (-539),
  170 -> 150 functions; 20 functions and eight existing exception classes moved.
  Three cache-warm bodies now delegate to the actual application/worker owners.
  Twelve new owner modules; longest 180 lines. Existing public function/error
  names remain available; no new interfaces, copied policies or empty packages.
- Application owns compact-payload warm orchestration through explicit reads.
  Infrastructure owns the worker lock/latches, coalescing, failure handling and
  connection cleanup. Mutable worker flags no longer have duplicate views names;
  their only external readers were isolated tests, now pointed to the owner.
  Runtime warm enable/delay values and three compatibility entry adapters remain
  in views while overview composition still depends on legacy membership readers.
- Catalogue owns programme construction, section/tree HTTP composition, cover
  storage and authoring guards. Reporting owns KSB statistic composition and its
  existing design-read exception. Response-producing exceptions stay in API;
  framework-free authoring errors live in Domain. No writer algorithm changed.
- Exact source contracts preserve all 20 moved functions, eight classes, seven
  values and the remaining views bodies except the three reviewed warm adapters.
  Actual old/current worker tests cover disabled/reconciliation guards, burst
  coalescing, writes during warming, thread-start failure, payload/section errors,
  BaseException propagation, cleanup, cache keys and both visibility variants.
  All 72 previous JSON fixtures and existing behavioral assertions unchanged.
- Executed: 360 guarded standalone tests/56 files; 175 disposable PostgreSQL/HTTP
  tests; 1,469 isolated Django fixture tests; 984 mocked meeting tests/37 suites;
  47 disposable PostgreSQL meeting tests. All final backend results PASS.
  Frontend mocked Teams baseline: 162/162 PASS (nine files). Final unique total:
  3,197 PASS, 0 FAIL, 0 SKIP; repeated validation excluded.
- Initial fixture run exposed stale patch.multiple targets in programme-detail
  tests. Grouped fixture injection now reaches actual owners, with the same
  inputs/assertions and complete suite rerun; no production workaround or skips.
- Graph: 1,475 -> 1,487 backend modules, nine cyclic groups unchanged, largest
  existing group unchanged at 275. All 378 reviewed boundary modules acyclic;
  no newly cyclic modules. Syntax, isolated import smoke and diff checks PASS.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py,
  run_meeting_checks.py, run_meeting_postgresql.py, run_import_smoke.py;
  guarded standalone runner; npm.cmd --prefix frontend run test:teams;
  git diff --check. Task-start copies, exact diff, graph and logs:
  D:/Temp/HP/lms-cache-composition-20261123/.
- Isolated runners proved no external network/host mounts/published ports before
  startup; synthetic disposable data only. No Neon, live providers, frontend
  source edits, environment changes, Git branch changes, commits, PRs or deployment.
- Remaining: views is not finished. Invalidation still composes the existing
  read-model outbox and warm callback; overview construction still reaches legacy
  membership-count readers. Next remove those reverse dependencies before moving
  the dependent module save/command composition. No active fallback was deleted
  without evidence. G01-G05 and full LMS acceptance remain open.

### 2026-11-23 - Membership and content-validation dependency cut - PASS; overview/cache completion OPEN

- Architecture branch/HEAD preserved. views.py: 5,255 -> 5,205 lines (-50),
  150 -> 147 functions. This batch removes blocking dependencies rather than
  claiming the remaining overview/cache/save composition is finished.
  learner_status_counts.py: 86 -> 22 lines; read_model.py: 103 -> 62;
  video_uploads.py: 122 -> 117. Eighteen functions and seven values moved;
  public exports retain the same callable/value objects.
- Five concrete owners, longest 80 lines:
  directory/domain/membership_values.py (existing status/legacy value parsing),
  directory/infrastructure/membership_runtime.py (normalized roster/count read wiring),
  catalogue/infrastructure/home_read_model.py (lookup and refresh events),
  catalogue/infrastructure/video_paths.py (generated video path validation),
  catalogue/infrastructure/content_validation_runtime.py (validation/context wiring).
  Existing Application orchestration and pure membership policy remain authoritative.
- Normalized readers no longer import views. The retained-live free-course reader
  binds its existing SQL reader directly. Video path validation no longer imports
  the upload writer. No membership, SQL, status, bridge or writer algorithm changed.
  Legacy JSON count SQL remains unchanged: it has active consumers and different
  semantics from normalized roster counts. Its model dependencies still reach
  legacy HTTP modules; moving that chain wholesale would create new cycles.
- Actual old/current source contracts and synthetic cases preserve missing vs
  empty targets, inherited/manual/direct/ambiguous membership, sibling exclusion,
  Python whitespace rules, duplicate profiles, zero/missing registration bridges,
  status labels, refresh-event ordering and video path restrictions. Synthetic
  34-direct + 4-inherited coverage is not a new real-data or endpoint baseline.
  All 73 previously captured curriculum JSON fixtures remain unchanged.
- Validation: 420 guarded standalone cases/62 files; 175 disposable PostgreSQL/HTTP
  cases; 1,474 isolated Django fixture cases; 984 mocked meeting cases/37 suites;
  47 disposable PostgreSQL meeting cases; 162 frontend mocked cases/nine files.
  Final unique results: 3,262 PASS, 0 FAIL, 0 SKIP. Initial stale fixture injection
  targets and helper-source locations were corrected without weakening behavioral
  expectations; one structural assertion explicitly accounts for the direct
  curriculum_read_scope binding. Full isolated integration rerun passed.
- Graph: 1,487 -> 1,492 backend modules; nine cyclic groups remain; largest
  existing group 275 -> 273. No newly cyclic modules. All 383 reviewed boundary
  modules are acyclic. Syntax, isolated import smoke and git diff --check PASS.
  All 367 captured learner production files and assignment writers are unchanged.
- Commands: python -I -B backend/phase1f_tests/image/run_integration.py,
  run_meeting_checks.py, run_meeting_postgresql.py, run_import_smoke.py;
  guarded standalone selection and focused reruns; npm.cmd --prefix frontend run
  test:teams; git diff --check. Baselines, exact diff, graphs and actual logs:
  D:/Temp/HP/lms-overview-composition-20261123/.
- Isolation proved before initdb/Django; synthetic disposable data only; owned
  containers removed. No Neon, live providers, environment/frontend production
  changes, branch switches, commits, PRs, pushes, merges or deployment.
- Next: separate the legacy assignment-count read dependencies from the broader
  Learning Plan/model/HTTP chain, then complete overview/cache composition and
  dependent save-command wiring. Do not replace active legacy count semantics
  with canonical membership totals merely to shrink views. G01-G05 remain open.

### 2026-11-23 - Overview and reporting read entries - PASS; views facade completion OPEN

- `views.py`: 5,205 -> 4,994 lines (-211). Twenty read-entry bodies (373 former
  function lines) now belong to seven focused owners; six new production modules
  include the independently extracted `reporting/domain/readiness.py` rule.
  Top-level function count stays 147 because public signatures/exports are retained.
- Application: profile/enrolment assignment-count selection, required overview
  caching, delivery-input preparation and forced programme response construction.
  API: overview cache/read-model negotiation and 503 mapping, achievement errors,
  pagination, KSB identity selection, scope validation, coverage trace/readiness.
  Domain: zero/negative/missing weights warn; positive weights have no invented
  percentage target. Existing SQL, writers, URLs, decorators and auth stay intact.
- Concrete owners: `directory/application/assignment_counts.py`;
  `catalogue/application/{cached_reads,hierarchy_queries,overview_delivery}.py`;
  `catalogue/api/overview.py`; `reporting/api/{achievement_reads,coverage_reads}.py`;
  `reporting/domain/readiness.py`. Lazy reader loaders preserve the original import
  point, including activity-import failures outside the existing call-error guard.
- No active legacy count fallback was removed or substituted with profile totals.
  Its SQL is byte-identical. All 74 prior curriculum JSON fixtures and all 740
  captured learner Python files are unchanged. The 381 unrelated top-level views
  statements and pre-existing functions in the two extended owners are unchanged.
- Final-state checks: 431 guarded standalone cases/63 files; 175 disposable
  PostgreSQL/HTTP cases; 1,478 isolated Django fixture cases; 984 mocked meeting
  cases/37 suites; 47 disposable PostgreSQL meeting cases; 162 frontend mocked
  cases/nine files. Total 3,277 PASS, 0 FAIL, 0 SKIP. Import smoke, syntax and
  `git diff --check` PASS. No expectations or assertions were relaxed.
- Early Docker runs omitted deferred-import modules from the explicit source
  bundle; targets were completed and full suites rerun. An intermediate Programme
  List assertion also failed; the final complete-bundle suite passed unchanged.
  Initial failure logs are retained; that assertion is not labelled pre-existing.
- Dependencies: 1,492 -> 1,498 backend modules; nine cyclic groups, largest 273,
  unchanged. No newly cyclic modules; all 389 reviewed boundary modules acyclic.
- Completion evidence: views functions containing `if/for/try/while` went 15 -> 0;
  no conditional/comprehension expressions remain in those functions. This alone
  is not facade completion: 146 composition/compatibility functions and the schema
  reset hook remain. Close shared cache/invalidation and legacy provider/permission
  bindings, move concrete wiring to owning entry boundaries, then verify routes,
  public exports and dependent consumers before declaring views finished.
- Commands: guarded standalone runner; `python -I -B` with
  `backend/phase1f_tests/image/{run_import_smoke,run_integration,run_meeting_checks,run_meeting_postgresql}.py`;
  `npm.cmd --prefix frontend run test:teams`; `git diff --check`.
  Evidence/diffs/logs: `D:/Temp/HP/lms-overview-final-20261123/`.
- Isolation verified before initdb/Django; disposable synthetic databases only;
  owned containers removed. Architecture branch and HEAD preserved. No Neon,
  live providers, environment changes, commits, PRs, pushes, merges or deployment.
  G01-G05 and wider Architecture V1 completion are not automatically cleared.


### 2026-11-23 - Required-read error handling and confirmed dead branch cleanup - PASS

- Corrected nine failure-to-empty/false paths: holiday calendar, staff directory,
  delivery counts, module index aliases/full module reads, cohort/group details
  and schema existence. Unexpected read/probe failures now raise explicit errors;
  existing middleware maps catalogue/staff errors to sanitized 503 responses.
  Failed probes are not cached as missing tables. Calendar read failure stops
  meeting validation before provider/persistence calls.
- Staff compatibility reads share the existing required reader. Successful data,
  archive filtering, identity buckets, SQL and lifecycle rules remain unchanged.
  Genuine empty reads still succeed. Previously documented non-PostgreSQL and
  known-absent optional learner-source behavior remains; not all LMS fallbacks
  were removed. No writer algorithm, schema, authentication or settings change.
- Removed unreachable `_preset_ids` name-based branch and unused `_PLACEMENT_SQL`;
  corrected stale assignment-count documentation. Active JSON-plan compatibility
  and public hierarchy exports remain. `views.py`: 4,994 -> 4,994, byte-identical.
- Eight production files: catalogue/application/{read_errors,delivery_reads}.py;
  catalogue/infrastructure/{catalogue_sources,delivery_counts,row_queries,schema_reads}.py;
  middleware.py; learner_assignment_counts_sql.py. Only read_errors.py is new.
- Nineteen actual-reader fault-injection cases cover schema failure/recovery,
  empty success, count identity, staff filtering, real Django HTTP 503/redaction,
  and meeting creation refusing before provider/persistence. Frozen snapshots
  stay unchanged; source checks explicitly permit only approved error/delegation
  changes and still compare successful bodies, SQL and public contracts.
- Final results: 431 guarded standalone/63 files; 175 disposable PostgreSQL/HTTP;
  1,497 isolated Django fixtures (including the 19 new cases); 984 mocked meeting
  cases/37 suites; 47 disposable PostgreSQL meeting cases; 162 frontend mocked
  cases/nine files. Total 3,296 PASS, 0 FAIL, 0 SKIP. Separate import smoke and
  focused 19 cases passed, not double-counted. Syntax and git diff --check PASS.
- Early failures were obsolete failure-to-empty expectations and a fixture
  mocking the wrong module reader. Corrected those expectations/dependencies;
  DB guards remain enabled. Initial diagnostic logs retained. Original line
  endings preserved. No new cycles: nine backend groups unchanged; 390 boundary
  modules acyclic. Architecture branch/HEAD preserved; owned containers removed.
- Commands: guarded standalone runner; python -I -B with image/run_integration.py,
  run_meeting_checks.py and run_meeting_postgresql.py; isolated import/fault runner;
  npm.cmd --prefix frontend run test:teams; git diff --check. Exact diff, logs,
  counts and graphs: D:/Temp/HP/lms-read-failures-20261123/.
- No Neon/live providers/real records, environment changes, commits, PRs or deploy.
  Remaining: other schema compatibility probes and retained legacy exports, then
  shared cache/composition wiring in views. G01-G05 and views completion stay open.

### 2026-11-23 - Learner schema probe failure handling - PASS

- Before: `learner_schema_table_exists` returned False and `learner_schema_columns`
  returned an empty set after failed metadata reads. Consumers could mistake an
  outage for absent optional data or choose name-based placement compatibility.
- After: both raise sanitized `CatalogueReadUnavailable` with
  `learner_schema_unavailable`; existing middleware returns 503. Successful SQL,
  genuine empty results, non-PostgreSQL behavior, positive caches, column TTL and
  membership/identity rules remain unchanged. Errors neither publish missing
  metadata nor populate request memoization; expired data is not returned on error.
- Production change: catalogue/infrastructure/schema_reads.py only. Four test
  files changed: test_required_read_failures_no_db.py and catalogue/tests/parity/
  {required_read_assertions,test_database_reads_standalone,test_read_runtime_standalone}.py.
  No frozen snapshots, URLs, writer algorithms or provider code changed.
- Eleven new actual-reader cases cover cursor/query/fetch failures, recovery,
  request memoization, expired cache, sanitized HTTP errors, membership facts,
  assigned profiles, ID-link decisions and progress/reflection/evidence consumers.
  First focused run exposed mock side_effect restoration errors; fixed the fixture.
  Historical source checks now allow only the two reviewed error-handler changes;
  successful bodies, queries, public signatures and wrapper decorators stay checked.
- Final validation: 431 guarded standalone cases/63 files (two affected files
  rerun after correcting old failure expectations); 175 disposable PostgreSQL/HTTP;
  1,508 isolated Django fixtures; 984 mocked meeting cases/37 suites; 47 disposable
  PostgreSQL meeting cases; 162 frontend mocked cases/nine files. Total 3,307 PASS,
  0 FAIL, 0 SKIP. Separate import smoke + 30 focused cases PASS, not double-counted.
- Syntax and git diff --check PASS. Nine existing backend cycle groups unchanged;
  390 reviewed boundary modules remain acyclic. No runtime imports added.
  `views.py`: 4,994 -> 4,994, byte-identical. This is error cleanup, not extraction.
- Hierarchy legacy helpers have no direct production callers found in the repo,
  but remain public compatibility exports; retained pending contract retirement.
  Next structural work: move remaining cache invalidation/warming composition
  from views to concrete infrastructure owners while preserving public bindings.
- Evidence, exact diff, commands and results: D:/Temp/HP/lms-schema-failures-20261123/.
  Commands: guarded standalone runner; python -I -B image/run_integration.py,
  run_meeting_checks.py and run_meeting_postgresql.py; isolated focused runner;
  npm.cmd --prefix frontend run test:teams; git diff --check.
  All DB tests used synthetic loopback-only disposable containers after isolation
  checks. No Neon, real records, live providers, environment changes or Git
  publication. Existing Architecture checkout/HEAD preserved. G01-G05 and views
  completion remain open; other compatibility fallbacks have not been certified.

### 2026-11-23 - Cache lifecycle and overview composition - PARTIAL

- Implemented the remaining cache lifecycle composition extraction. Nine public
  functions moved from views, preserving signatures and exports: four lifecycle
  entries to catalogue/api/cache_lifecycle.py, four overview builders to
  catalogue/api/overview_composition.py, and the assignment-count binding to
  directory/infrastructure/assignment_count_runtime.py. Two existing environment
  expressions moved unchanged to infrastructure/runtime_config.py.
- API composition binds existing encoded-section/read callbacks; actual commit
  hooks, cache mutation and thread state remain in infrastructure, with payload
  orchestration in application. No infrastructure-to-API edge was introduced.
  AppConfig.ready imports the lifecycle owner directly. A cold import with dummy
  aliases, network/thread guards and ready hooks disabled PASSED without importing
  views. The actual ready hook's guarded scheduling is covered separately.
- Removed two direct views lookups from learner_assignment_counts_sql by importing
  the same concrete readers. Its reference Python count reader moved unchanged
  from learner_assignments, which reexports it; the diagnostic no longer imports
  the writer module. Assignment algorithms, count rules, SQL, URLs, auth, app
  identities, transaction timing and active compatibility semantics are unchanged.
  The normalized membership_runtime file is byte-identical to the task baseline.
- views: 4,994 -> 4,851 lines (-143 net); 147 -> 138 top-level functions. The nine
  moved definitions total 85 lines; the net reduction also removes stale cache
  comments and replaces definitions with public imports. This is not 143 lines
  of deleted business logic. Three concrete production modules were added.
- Functional checks: 439 guarded standalone cases/64 files; 175 disposable
  PostgreSQL/HTTP; 1,512 isolated Django fixtures; 984 mocked meeting cases/37
  suites; 47 disposable PostgreSQL meeting cases; 162 frontend mocked cases/nine
  files. Total 3,319 PASS, 0 functional FAIL/SKIP. Twelve new cases: eight source/
  reference-reader checks plus four actual-owner/runtime checks. Import smoke,
  cold owner import, syntax and git diff --check PASS. Focused checks are not
  double-counted. Initial missing-fixture packaging was corrected in the test
  bundle; original frozen snapshots remain unchanged.
- Dependency clearance FAILED / OPEN: nine full-backend cyclic groups remain,
  but the largest grows from 273 to 276 modules as the three new compositions
  join the existing legacy count path. The 393 reviewed boundary modules have
  no internal cycle. The graph includes deferred imports; a passing cold import
  does not close this structural debt. No gate waiver or full PASS is claimed.
  Remaining path: cache_lifecycle -> overview_composition -> assignment_count_runtime
  -> learner_assignment_counts_sql -> learner_api.learning_plan -> legacy
  curriculum readers -> views. Keep legacy count behavior until that reader's
  dependencies can be separated and characterized; do not remove active plan
  compatibility to make the graph green. That is the next bounded read task.
- Eight production files, seven test/support files, one new synthetic source
  snapshot, one isolated-bundle manifest and this tracker. Exact diff, graphs,
  before hashes, commands and logs: D:/Temp/HP/lms-cache-lifecycle-20261123/.
  Commands: guarded standalone runner; python -I -B image/run_integration.py,
  run_meeting_checks.py, run_meeting_postgresql.py; isolated import runner;
  npm.cmd --prefix frontend run test:teams; git diff --check.
- Existing Architecture branch/HEAD retained. No Neon, live provider operations,
  real data, environment changes, commits, PRs or deployment. All DB verification
  used the existing disposable loopback-only synthetic runner. G01-G05, release
  approval and views facade completion remain open.

### 2026-11-23 - Remaining feature bindings extracted - PARTIAL

- Extracted all 137 remaining HTTP/runtime binding functions and 15 constants
  into 19 concrete API owners across catalogue, meetings, directory and reporting.
  Owners cover authoring, programme/module/placement commands, free courses,
  uploads, staffing, holidays/templates, meeting options/scheduling/artifacts/
  module links, roster, coverage and achievement. Existing Application, Domain
  and Infrastructure implementations are reused; no new business layer.
- views: 4,851 -> 1,184 lines (-3,667 net); 138 -> 1 function. The retained
  function is reset_schema_ready_flags for existing test callers. 2,775 moved
  lines include definitions/decorators; the net reduction also removes orphaned
  comments and consolidates compatibility exports. It is not 3,667 deleted
  business-logic lines. Existing public import names remain available.
- Exact AST parity verifies all bodies, signatures, defaults, decorators and
  constant expressions. Runtime checks verify exported identity and all bound
  capabilities. URL definitions, legacy count SQL, assignment writers, learner
  models and learning_plan are byte-identical to the task baseline. No active
  fallback rule was deleted as a shortcut to clear dependency checks.
- Final results: 445 guarded standalone cases / 65 files; 175 disposable
  PostgreSQL/HTTP; 1,514 isolated Django fixtures; 984 mocked meeting cases /
  37 suites; 47 disposable PostgreSQL meeting cases; 162 frontend mocked cases /
  9 files. Total 3,327 PASS, 0 final FAIL/SKIP. Import smoke and 12 focused
  runtime cases also PASS (not double-counted). Syntax, whitespace, production
  scope and git diff --check PASS.
- Initial failures: four Django fixtures patched the old views lookup; one
  meeting source test searched definitions in views. Updated the actual lookup
  targets/source reader, preserving every existing assertion. Complete suites
  passed on rerun. Initial frontend test/worker-start timeouts cleared on a full
  rerun alone; test assertions and timeout settings were not changed.
- Dependency clearance remains OPEN / FAIL: full-backend cyclic groups 9 -> 9,
  largest 276 -> 294 as 18 new owners join existing legacy cycles. All 412
  reviewed boundary modules remain internally acyclic. Internal consumers
  still import views; counts -> learning_plan -> curriculum readers -> views
  remains. The earlier count-reader decoupling is NOT completed. Reverse
  dependency removal is next; this extraction is not full views retirement.
- Scope: 20 production files (views plus 19 owners), targeted test/import
  support and one new source snapshot under tests/fixtures. Evidence, exact
  diff, before hashes and logs:
  D:/Temp/HP/lms-views-final-bindings-20261123-152804/.
  Commands: guarded standalone runner; python -I -B image/run_integration.py,
  run_meeting_checks.py, run_meeting_postgresql.py; isolated import runner;
  npm.cmd --prefix frontend run test:teams; git diff --check.
- Architecture branch and HEAD preserved. No Neon, real records, live providers,
  environment changes, commits, PRs or deployment. PostgreSQL/Django ran only
  in disposable network-isolated synthetic containers. G01-G05, release
  acceptance and final views dependency clearance remain open.

### 2026-11-23 - Assignment read owner and learner consumer imports - PARTIAL

- Moved 12 unchanged functions and four SQL constants to two concrete owners:
  learner_api/learning_plans/domain/stored_plan.py (saved-plan value parsing) and
  infrastructure/assignment_reads.py (existing group presets, query transport,
  manual-roster filtering, effective plan IDs and request cache). learning_plan
  and mappers reexport the same function objects. Counts import the reader
  directly; no HTTP handler, writer algorithm, schema or membership rule changed.
- Redirected 30 named views imports across eight learner consumers (active_users,
  working_rules, builder_activity_dates, subject_cache, training_plan_dashboard,
  personal_learning_reads, weekly_calendar, ksb_progress). Redirected 20 storage
  read imports to the existing concrete course_storage_reads/learning_read_routes
  owners. Lazy import timing and all function bodies remain unchanged.
- Production scope: 28 files (26 existing plus two new owners). learning_plan:
  1,863 -> 1,635 lines; mappers: 1,375 -> 1,354. views remains 1,184 lines; this
  batch removes consumer dependencies, not compatibility exports still in use.
  Exact transferred-source AST, constant, remaining production-body and existing
  test-assertion comparisons PASS. Public aliases are identical runtime objects.
- Core checks: 445 existing guarded standalone cases plus 13 new source/parity
  cases PASS; 180 disposable PostgreSQL/HTTP and 1,525 isolated Django fixtures
  PASS. A subsequent focused run passes 12 cases, including one added binding
  identity case (the other 11 overlap the integration fixture selection).
  Cold import PASS with views, learning_plan, mappers and writer imports denied,
  six dummy aliases, no socket activity, settings files or background threads.
- Mocked Teams checks (previous explicit authorization): 984 cases/37 suites PASS;
  disposable PostgreSQL meeting cases 47 PASS; frontend Teams 162/9 files PASS.
  The first concurrent frontend run had a 5-second timeout and a duplicate-DOM
  failure; the unchanged full suite passed when rerun alone. No timeout or
  assertion was weakened; no live Teams/Graph/provider operation occurred.
- Additional learner-consumer check: 151 cases, 130 PASS, 13 assertion failures
  and eight errors, zero skips. All 21 failure signatures also reproduce against
  the captured pre-task source in the same isolated harness; no new signatures.
  Remaining failures concern existing group-sync/picker and count fixtures,
  one activity-date SQL assertion, and eight KSB schema-read fixture errors.
  This additional suite is FAIL, not waived or presented as a passing baseline.
- Initial fixture issues corrected: mock targets now use actual reader owners;
  SQLite fixture preserves aggregate ordering through an ordered subquery, and
  its vendor substitute is local to the reader instead of mutating Django's
  connection proxy. Old assertions are unchanged. Frozen prior snapshots are
  unchanged; the earlier cache oracle reverses only the exact plans import move.
- Dependency result: direct static views importers 100 -> 92; full-backend cyclic
  groups 9 -> 9; largest group 294 -> 290. Reviewed boundary modules 412 -> 414,
  with zero internal cycles. Global clearance remains OPEN: lazy model/placement
  dependencies still reach mappers/active_users and old_otjh.repository ->
  learning_storage -> views. Cold-import isolation does not erase that graph.
- Next: remove remaining internal facade imports by concrete ownership, starting
  with read consumers that still load mixed storage/model compatibility modules;
  preserve active JSON/manual-roster fallback semantics until separately changed.
  Do not mark views retirement, G01-G05 or release acceptance complete.
- Commands/evidence: guarded standalone runner; run_integration.py;
  run_meeting_checks.py; run_meeting_postgresql.py; npm.cmd --prefix frontend run
  test:teams; run_reader_checks.py cold/focused/current/baseline; review.py and
  git diff --check. Exact source baseline, changed-file list, diff, dependency
  graph, fixture failure comparison and complete logs:
  D:/Temp/HP/lms-count-read-boundary-20261123-160056/.
- Architecture branch/HEAD retained. No Neon, real learner data, live providers,
  environment changes, commits, PRs, branch switches or deployment. PostgreSQL
  ran only on disposable loopback-only synthetic containers.

### 2026-11-23 - Concrete read consumers instead of views/storage facades - PARTIAL

- Redirected 60 read/helper bindings across 12 production files to their existing
  concrete owners; no new production module or compatibility wrapper was added.
  Curriculum consumers: attendance_membership, authoring_row_cache,
  catalogue_activity, module_progress_metrics, programme_audit,
  programme_ksb_stats_batch, quality, read_model, record_snapshots, review_otjh.
  Other consumers: learner_api/free_courses_view and old_otjh/repository.
  The hours reader now imports course_storage_reads.read_sql directly instead
  of loading the mixed learning_storage module. Public views exports remain.
- Before -> after: direct static views importers 92 -> 81; views.py remains
  byte-identical at 1,184 lines. Full-backend cyclic groups 9 -> 9, largest group
  290 -> 290; the same 414 reviewed boundary modules have zero internal cycles.
  No new cyclic group. Remaining transitive cycles are still open; eleven fewer
  facade importers do not establish global dependency clearance.
- Exact normalized AST comparison confirms all production bodies, SQL, constants,
  decorators and contracts are unchanged apart from import/lookup ownership.
  Imports retain their module/function/with-block timing. Existing test assertions
  and frozen historical snapshots are unchanged. No active fallback was removed
  without evidence that its behavior was obsolete or misleading.
- Standalone: 467 cases across 68 files PASS, combining the full run with focused
  reruns of the two corrected test-harness cases. New checks cover source parity,
  all 60 scoped bindings and removal of the two facade dependencies.
- Disposable integration: 180 PostgreSQL/HTTP and 1,529 Django fixture cases PASS.
  New runtime tests confirm actual export identity and hours query alias/parameter,
  JSON decoding, empty-result and exception behavior. All six aliases remain on
  the disposable target; external networking is unavailable before startup.
- Additional consumer suite: 146 cases, 145 PASS, one ERROR, zero skips. The same
  missing-id SimpleNamespace error in the existing free-course assignment writer
  fixture reproduces with pre-task production code (142/143 PASS) under the same
  updated harness. No new failure signature; the writer and its test are unchanged.
  The previous batch's 21 supplementary failures were not rerun or cleared here.
- Previously authorized mocked Teams: 984 cases/37 suites PASS; isolated meeting
  PostgreSQL: 47 PASS; frontend Teams: 162 cases/9 files PASS. No live calls.
- Fixture maintenance: inject mocks at concrete owners, restore the original
  views namespace only when executing frozen historical functions, correct the
  attendance fixture's invalid mock.composition_patch lookup, and bundle explicit
  source dependencies. The isolated core registers base coach AppConfig for the
  review-reader import; the meeting harness avoids registering it twice. Initial
  harness failures were corrected without changing expected application results.
- Validation commands: guarded standalone runner; run_integration.py;
  run_consumer_checks.py verified/baseline; run_meeting_checks.py;
  run_meeting_postgresql.py; npm.cmd --prefix frontend run test:teams;
  syntax/body/assertion/dependency review and git diff --check. Exact changed-file
  inventory, pre-task source, diff, graph and complete logs are retained at
  D:/Temp/HP/lms-storage-consumers-20261123-164410/.
- Next: remove the remaining internal views dependencies by coherent consumer
  groups (including review composition), distinguishing legitimate URL/public
  compatibility imports from internal back-references. Views retirement, global
  acceptance and G01-G05 remain open. No Neon, real data, provider operations,
  environment edits, branch changes, commits, PRs, pushes or deployment.

### 2026-11-23 - Approved dev source reconciliation complete; acceptance PARTIAL

- User explicitly approved dev's study-week, payload and scheduling behavior.
  Reconciled pinned dev 99f81ec8c661519da17225ac8a7a566447967487 into the existing
  Architecture working tree; HEAD remains 606aca43df97967e8cb1fab45c5a794cc0635246.
  Upstream scope: 168 commits / 1,077 paths. This was source reconciliation,
  not a Git merge, and does not include subsequent unreviewed dev revisions.
- Recovery: 7,370 pre-task files hash-verified in working-files.zip, with manifest,
  diffs, index and refs. Dependency caches/private ignored runtime data excluded.
  Evidence and exact changed-file inventory: D:/Temp/HP/lms-dev-reconcile-20261123-175134/.
- Ported 36 changed legacy views functions into their actual concrete owners;
  added the bounded teams_module_session_limit through existing composition.
  Application planning, domain date stamping, read ports and API error mapping
  remain separate. Preserved the normalized KSB fix and membership boundaries.
  Frontend changes reach the extracted module/programme components, assignment
  form and drawer. Fixed the relocated KSB dialog's missing createPortal import.
- Before -> after: views.py 1,184 -> 1,188 lines, still one top-level function.
  Source scope: 892 existing files modified, 239 new files, one upstream prompt
  rename; includes imported dev code, focused harness changes and two new parity
  artifacts. Existing unrelated work retained; staged diff and HEAD unchanged.
- Frontend: type-check, production build and lint PASS. Mocked Teams 162/162 PASS;
  extracted-feature checks 40/40 PASS. Changed-suite run: 2,308/2,325 PASS,
  17 FAIL and two unhandled errors. One KSB portal failure subsequently fixed
  and its focused test passed (35 other cases filtered); the other 16 failures
  remain unresolved. Do not infer a fresh full-suite pass from the focused rerun.
- New standalone comparison uses actual frozen dev function bodies, not copied
  expectations: four tests / 40 synthetic subcases PASS; six numbered-session
  tests PASS. Certificate eligibility/admin checks 59/59 PASS in isolated Docker.
- Historical acceptance remains red: standalone 467 cases / 68 files, 35 suites
  PASS and 33 FAIL; PostgreSQL/HTTP core 180 cases with six failures; Django
  fixture suite 1,529 cases with 39 failures and six errors. Numbered-session
  fixture errors were corrected and focused tests passed, but the full suites
  were not rerun. Historical snapshots/assertions were not rewritten for green.
- Final mocked backend meeting run: 1,035 cases / 43 suites, 29 failure events
  including subtests, zero errors/skips; 32 suites PASS, nine FAIL, two BLOCKED
  by migration restrictions. Failures include historical source/signature oracles,
  the new pruning dependency allowlist, study-week limits and one conflict case.
- Extended disposable PostgreSQL run: 83 cases, 78 PASS, four FAIL, one ERROR;
  one additional migration test BLOCKED. The five nonpassing persisted/HTTP
  cases reproduce on pristine pinned dev with the same isolated fixtures:
  material exception reads, holiday slots, two inherited/custom-day attachments,
  and persisted week counts. Dev's weeks_number-only series-limit failure also
  reproduces. This narrows provenance; it does not clear the acceptance failures.
- All backend runtime checks used reviewed network-disabled disposable Docker
  environments, synthetic fixtures and blocked providers. Three exact migration
  tests are explicitly BLOCKED, not silently skipped. No migrations executed.
  Upstream settings and migration files were reconciled as source only; no host
  Django startup, real environment loading or existing database access occurred.
- Static checks: 450 changed Python files compile; git diff --check PASS.
  The 414 reviewed boundary modules retain zero internal cycles. Full backend
  cyclic groups remain nine, largest 290 -> 300; views importers 81 -> 82,
  including new dev study_week_teams -> views debt. Frontend runtime graph retains
  the same two cycle groups (including dynamic imports); no new group introduced.
- Next: diagnose remaining failures individually, fix confirmed study-week bugs
  in a focused change, and review updated behavior-specific parity baselines.
  Source integration is complete; release readiness, full endpoint equivalence
  and G01-G05 remain OPEN. No Neon, real data, live providers, .env edits, staging,
  branch changes, commits, PRs, pushes, Git merge or deployment.

### 2026-11-24 - Dev reconciliation stabilization; release acceptance still PARTIAL

- Fixed confirmed defects in six production files, preserving the approved dev
  features and existing Architecture owners. No further views extraction:
  views.py remains 1,188 lines and is unchanged in this batch.
  - `learner_api/builder_activity_dates.py`: raw JSON `null` now uses the existing
    weekly-calendar decoder; malformed non-null exceptions still fail validation.
  - `learner_api/training_plan_dashboard.py`: calendar mode uses actual authored
    week counts to build slots, including holiday weeks; legacy planning retained.
  - `meetings/application/invitation_preparation.py` and
    `meetings/infrastructure/invitation_runtime.py`: series limits use scoped live
    week rows through an explicit read capability, with no schema provisioning.
    Legacy limit 52 and cap 728 retained; existing no-week session fallback retained.
  - Frontend `free-courses/page.tsx`: saved zero-week courses stay visible/editable
    from canonical documents, sale prices display, and AppIcon imports explicitly.
    `module-builder/ModuleLearnerProgressDialog.tsx` tolerates pending progress data.
- Test changes use distinct native free-course IDs/API fixtures, canonical Quality
  routes, correctly scoped search transport, and the actual conflict-guard owner.
  Module-form assertion waits for its loaded snapshot value. No production route,
  permission, cache, authentication, writer or migration was changed in this batch.
- Historical contract comparisons explicitly add only the approved nullable
  study-week fields, null-write allowlist, provisioning SQL and date-cache key.
  Frozen snapshots remain unchanged; current outputs are not filtered. Added a
  mode-change cache invalidation test and seven pure study-week regression tests.
  Corrected the disposable group fixture's `session_week_day` column; replaced
  obsolete scalar week-count assertions with persisted live rows/public counts.
- Backend before -> after: PostgreSQL/HTTP core 174/180 -> **180/180 PASS**;
  Django fixtures 39 failures/6 errors in 1,529 cases -> **1,530/1,530 PASS**.
  Extended PostgreSQL 78/83 -> **83/83 PASS**, with one additional migration case
  explicitly BLOCKED (runner exit 1 reflects that block, not a test failure).
  Mocked study/conflict suites **31/31 PASS**; pure tests **7/7** and actual pinned
  dev comparison **4/4 PASS**. Counts overlap between runners; do not sum them.
- Frontend type-check, production build and lint PASS. Affected six-file run
  **241/241 PASS**; module-form **61/61 PASS**; mocked Teams **162/162 PASS**.
  Final 117-file run: **2,324/2,325 PASS**, one failure in the compact My Learning
  commercial-route request-count assertion (4 calls versus 3). Its full file
  subsequently passed **43/43** in isolation; retained the assertion and added
  request-set diagnostics. Timing/test-isolation versus a real extra-read defect
  is not yet established; the broad run remains FAIL. An earlier PDF narration
  failure passed 16/16 in isolation and passed in the final broad run; no PDF code
  or expectations changed. These reruns do not prove intermittent failures absent.
- Broader mocked meeting acceptance remains red: 1,036 cases / 43 suites,
  34 suites PASS, seven FAIL (26 failure events including subtests), two BLOCKED.
  Outstanding: five historical source/signature/hash suites, nine historical
  behavior-oracle failures around `max_sessions`, and the cancellation audit's
  new `study_week_teams.prune_study_week_fillers` dependency. Do not silently
  whitelist cancellation or regenerate historical snapshots to claim acceptance.
  Prior 33 failing standalone suites were not rerun or declared resolved here.
- Static review: 22 changed Python files compile; git diff --check PASS. The 414
  reviewed boundary modules retain zero internal cycles. Whole-backend groups
  remain 9 (largest 300), views importers 82; frontend groups including dynamic
  imports remain the same 2. No new cycle introduced. Global legacy debt remains.
- Safety: OS isolation verified before disposable PostgreSQL/Django startup;
  synthetic data only, providers blocked. All three named migration cases remain
  BLOCKED. No migrations, existing DB/Neon, live provider, environment or Git-state
  operations. Current Architecture branch, HEAD and staged diff unchanged.
- Reproducible commands: `python -I -B backend/phase1f_tests/image/run_integration.py`;
  `run_meeting_postgresql.py`; `run_meeting_checks.py` with the inspected suites.
  Frontend: `npm.cmd --prefix frontend run type-check`, `build`, `lint`, `test:teams`,
  and `test -- <117 reviewed paths> --maxWorkers=2`, under the local network guard.
  Evidence, exact selected paths/commands, preimages and batch diff:
  `D:/Temp/HP/lms-architecture-stabilize-20261124-104100/`.
- Next: diagnose the intermittent compact-route extra request, then reconcile
  remaining historical acceptance contracts with pinned approved dev behavior,
  including the narrowly guarded holiday-padding removal;
  retain cancellation protections and add behavior evidence before changing that
  audit. Separately resolve the migration-test restriction. Architecture V1
  release acceptance and G01-G05 remain OPEN; no commit, PR, merge or deployment.

### 2026-11-25 - Learning Plans Phase 1.7 capability closure - PASS

- Extracted the two active normalized-plan hydration paths from
  `learner_api/learning_plan.py`. Application now coordinates cache mutation and
  injected readers; Infrastructure owns the exact ORM prefetch, compact SQL,
  database-alias selection and ordered row conversion; Composition wires them;
  Public exposes the supported calls. Eleven Learner consumers now use Public.
- Root `_legacy_serialize` still owns its legacy HTTP payload, but stored,
  inherited and Aptem membership selection now delegates the canonical pure
  policy. Explicit, unsaved, empty, manual-roster, ordering and cache semantics
  are unchanged. The two removed root functions comprised 90 definition lines
  (29 and 61); the root hydration constant was also removed.
- No obsolete root hydration definition/caller remains. The writer compatibility
  module alias remains because active runtime, test and PostgreSQL-tool consumers
  require exact import/patch identity. Exactly one `reconcile_training_plan`
  definition remains, in Learning Plans Infrastructure. The candidate canonical
  endpoint remains unregistered.
- Final gates: legacy 80/80; standalone 99/99; disposable PostgreSQL 44/44;
  isolated membership 8/8; module assignment 5/5; public/writer/consumer 79/79;
  Curriculum 49/49; Engagement 31/31. Boundary checks are 9/9 and 8/8; focused
  Ruff, syntax and diff checks pass. No shared database, provider or Teams call.
- Established repository blockers remain separate: Coach reproduces its Phase 1.6
  baseline at 60 pass, five fail and two errors out of 67; the migration graph
  still references missing `curriculum_api.0087_free_course_compatible_fields`.
  Broader Learner stale-fixture checks have 231 pass, nine fail and three errors
  out of 243, all outside the extracted path. Capability status PASS; repository
  readiness remains PARTIAL. Phase 2 was not started.

### 2026-11-25 - Identity & Placement Phase 2.1 cohesive migration - PASS

- Added `learner_api/identity_placement` with pure identifier/placement domain
  rules, injected application orchestration, exact ORM read adapters, explicit
  composition and one supported Public facade. Canonical Learner IDs remain
  distinct from enrolment, Aptem and UUID identities; placement authority remains
  the stable programme/cohort/group IDs and the exact `enrolment_id` bridge.
- Moved the existing legacy email/PK fallbacks and optional opportunistic link
  repair without changing their order or outcomes. They are documented legacy
  debt, not new canonical rules. No new matching, inference, backfill, schema,
  data, authorization, calculation or external-provider behavior was introduced.
- Production read consumers in Learner, Learning Plans, Curriculum and Coach now
  import only `identity_placement.public`. The old identity and placement read
  implementations and Free Course exact resolver were removed. Compatibility
  re-exports remain only for historical test/dotted-import surfaces; mixed Free
  Course assignment and placement write validation stay with their current owners.
- Old module reduction: `identity.py` 77 -> 15, `placement_links.py` 99 -> 56,
  `free_course_selectors.py` 46 -> 40: 111 lines removed in total. No source file
  or model was deleted; no Learning Plans public contract was changed.
- Final gates: new unit/parity/public/architecture 22/22; no-DB ORM contracts 4/4;
  Learning Plans standalone 99/99; isolated membership 8/8; disposable PostgreSQL
  44/44; source-only import smoke PASS; focused Ruff, 144-file AST syntax and
  `git diff --check` PASS. PostgreSQL proved loopback-only isolation, no ports or
  mounts, synthetic aliases/data and container removal before Django ran.
- The legacy canonical-placement file reproduces its exact pre-change result:
  28/34 PASS and the same six stale source-extraction errors. It is not counted as
  green. Whole-backend graph: 9 cyclic groups/largest 309 before, 9/largest 307
  after; the new capability belongs to no cycle. No Teams suite or live provider,
  Neon, existing database, migration, `.env`, branch, commit, push or deployment.
- Next recommended Identity & Placement batch: separately decide and migrate the
  legacy email/PK resolver and optional write-on-read repair, with DB/identity-owner
  approval and data evidence. Phase 2.2 was not started.

### 2026-11-25 - Identity & Placement Phase 2.2 physical migration - PASS

- Physically removed the obsolete `learner_api/identity.py` and
  `learner_api/placement_links.py` compatibility modules after migrating every
  executable production import, test patch and isolated-runtime stub. The only
  old dotted path left is inside an immutable historical source snapshot; its
  parity test supplies a test-only in-memory module and no production wrapper.
- Identity resolution decisions now belong to Domain, orchestration to
  Application, exact ORM reads and optional link repair to separate
  Infrastructure adapters, and wiring to Composition/Public. Placement input
  interpretation and hierarchy validation follow the same layers. A dependency-
  free shared validation exception prevents the Public/mapper import cycle.
- Free Course keeps only `assigned_course_ids` and `assignment_version`; its
  assignment logic was not moved. The obsolete identity constants/resolver
  re-exports were removed. No Identity & Placement compatibility file remains.
- Moved the three root capability suites into
  `identity_placement/tests/parity/`, extracted the nine identity-resolution
  cases from `learner_api/tests.py` and `tests_weekly_learning.py`, added package
  discovery markers, and deleted the original root suites/classes. Workflow-
  specific consumer tests remain with their real owners and import/patch Public.
- Root `learner_api` Python files changed from 698 to 694: five obsolete root
  files were removed and one dependency-free validation leaf was added. The
  capability owns ten discovered test files. No duplicate capability class or
  business implementation remains.
- Final capability discovery: 104/104 PASS, including canonical placement 34/34
  (pre-change 28 pass/six extraction errors), identity resolution 9/9, relocated
  ORM/consumer parity 30/30 and architecture/public/domain/validation contracts.
  Updated external consumer cases are 15/15; isolated membership is 8/8 under
  Docker `network=none`; read-only import smoke PASS with 899 bundled files.
- Learning Plans reproduces its pre-change 98/99 result: only the unrelated
  `active_users.standard_required_ksbs` redirect assertion fails. The disposable
  PostgreSQL harness was already blocked before tests by missing unrelated
  `curriculum.week_template_components`; no database/schema workaround was made.
  Focused Ruff, changed-file AST syntax and `git diff --check` pass.
- Whole-backend cyclic-group count remains nine; the largest observed component
  reduced from 452 to 439 and Identity & Placement participates in zero cycles.
  No database, schema, Neon, Teams/provider, branch, commit, push, merge or
  deployment operation occurred.

### 2026-11-24 - Pinned dev meeting acceptance; remaining curriculum contracts OPEN

- Started on Architecture at 2d06b0de038955f7ce68f4c9abdc336731c82d78 with a clean
  working tree. This batch changes test contracts, fixtures and the test bundle
  only; application bodies, writers, endpoints and views.py (1,188 lines) remain
  unchanged. No commit, push, PR, branch switch, migration or live provider call.
- Added meetings/tests/approved_dev_contracts.py and fixtures/approved_dev_99f81.json.
  Seven reference bodies are extracted from actual approved upstream revision
  99f81ec8c661519da17225ac8a7a566447967487, with source/fixture hashes verified.
  The only textual adaptation retains existing readable punctuation in one
  additional-week error message. Historical snapshots are unchanged.
- Meeting source/signature/capability and behavior tests now use those pinned
  references for the approved changes. Historical whole-file reconstruction
  removes exactly four reviewed compatibility imports; new tests reject changed
  or duplicate imports and retain unknown additions. The source loader and
  delivery/calendar contracts share this explicit reference selection.
- The cancellation audit distinguishes explicit cancellation from the single
  approved opted-in holiday-padding site. It checks the exact DELETE site,
  creation/schedule callers and people-only prohibition. Added synthetic tests
  for missing targets, no holidays, cancelled/non-holiday occurrences and an
  unproven later candidate preventing ALL deletion. Existing identity, tracked
  session, history, exception, pagination and partial-failure guards still pass.
- Targeted verification: 222/222 PASS across eight suites. Full mocked meeting
  verification: 1,042 executed cases, zero failures/errors/skips, 41 suites PASS
  and two BLOCKED by the unchanged migration exclusions (runner exit 1).
  These counts overlap. The third PostgreSQL migration test remains blocked too.
- Re-ran all 68 historical standalone suites under import/network/write guards:
  467 cases; 45 suites PASS, 23 FAIL, with no newly failing suite relative to the
  earlier 35 PASS / 33 FAIL result. Remaining failures cover old bodies, signatures
  and imports in catalogue authoring, scheduling, storage and composition. They
  need individual review against approved dev; do not delete or regenerate their
  expectations. Full list: evidence/remaining-standalone.json below.
- Frontend test-only preparation loads the real lazy FreeCourseMaterial renderer
  before the saved-URL assertion, avoiding cold transformation consuming its
  one-second UI wait. No component mock or assertion was weakened. Type-check
  and focused ESLint PASS; the changed UI test is NOT runtime-verified yet.
- Frontend verification remains BLOCKED/PARTIAL: default forks and threads
  repeatedly timed out starting workers, before executing tests. A diagnostic
  VM run before the fixture preparation executed 43 cases: 42 PASS and one cold
  lazy-render wait failure. The original extra-request case passed there, which
  does not explain or resolve its previously observed intermittent failure.
  The same 117-file broad selection under VM threads reported seven failures
  across two 36-case files (moduleDeliveryCatalogue, programmeWorkspace) before
  being stopped to reduce host memory pressure (91% observed). A single-worker
  retry of all 117 paths with vmMemoryLimit=512MB produced no file result after
  prolonged startup/import and was stopped. Neither attempt is an acceptance
  pass; preserve their reported failures for diagnosis, without assuming the
  resource pressure caused them. Final focused default-pool attempt also ended
  with "Timeout waiting for worker to respond", zero tests executed.
- Evidence and exact selected commands/logs:
  D:/Temp/HP/lms-acceptance-20261124/. Mocked backend command:
  python -I -B backend/phase1f_tests/image/run_meeting_checks.py.
  No PostgreSQL or HTTP integration rerun is claimed for this test-only batch.
- Curriculum/Architecture V1 release acceptance and G01-G05 remain OPEN.
  Finish frontend request-count diagnosis and the 23 remaining historical
  contracts before treating acceptance as green or proceeding to release.

### 2026-11-24 - Post-merge curriculum contract stabilization PASS (bounded)

- Architecture at `fcdaa2a542412536cc51ff8ea5ee7846ad5a118f`; preserved the
  pre-existing attendance fixture edit byte-for-byte. Application code, URLs,
  writers and `views.py` (1,188 lines) are unchanged in this batch.
- Closed all 23 failing historical contract suites. Added a fixed source-delta
  fixture for the reviewed, accepted dev merge: study-week fields/validation,
  calendar planning, explicit composition capabilities, native content reads,
  profile-keyed marks and canonical Free Course behavior. The reference records
  Git revision/blob identities and the pre-reconciliation archive fingerprint.
  Every affected current file must match the approved AST before historical
  extraction comparisons can reverse those exact deltas. Unknown changes fail;
  all 62 existing catalogue JSON fixtures remain unchanged. This establishes
  source compatibility with the reviewed changes, not endpoint/runtime parity.
- Added 17 standalone cases: source-mutation/revert/import rejection, current
  runtime fixture preservation, actual study-week mode/end-date/payload rules,
  missing modules, the 104-week bound, legacy behavior, session precedence and
  group delivery. Current behavior tests import actual owners, never restored
  historical bodies. Updated the import bundle to carry the reference/helper;
  inspected the generated archive successfully without starting Docker/Django.
- Diagnosed the intermittent frontend failure by reproducing a certificate
  request for an apprenticeship learner during the next commercial test. Awaited
  cleanup/effect flushing before restoring fetch and clearing caches; retained
  all exact request-count assertions and added request diagnostics. No request,
  cache, component or endpoint implementation was changed.
- Validation: 69 guarded DB-free backend suites, **484/484 PASS**, zero skips;
  final frontend selection (compactModules, moduleDeliveryCatalogue,
  programmeWorkspace, learnerCertificates), **118/118 PASS**. compactModules also
  passed five consecutive full-file runs (43 each; overlapping evidence).
  Type-check, focused ESLint, production build, syntax and diff checks PASS.
- Changed: catalogue tests/parity/{approved_dev_contracts.py,
  test_approved_dev_standalone.py, final_bindings_oracle.py,
  test_final_bindings_standalone.py, test_read_dependencies_standalone.py,
  test_read_consumer_imports_standalone.py}; catalogue tests/fixtures/
  approved_dev_source_deltas.json; phase1f_tests/image/run_import_smoke.py;
  frontend my-learning/compactModules.test.tsx; this tracker.
- Evidence, exact commands, preimages, reproduced failure and final results:
  `D:/Temp/HP/lms-curriculum-acceptance-20261124-next/`.
- Remaining: full post-merge HTTP/PostgreSQL integration acceptance and blocked
  migration checks; the full 117-file frontend selection was not rerun here.
  No database/provider connection, Django startup, commit, PR or deployment.
  G01-G05 and overall Curriculum/Architecture V1 release acceptance remain OPEN.

### 2026-11-24 - Post-merge isolated runtime acceptance PARTIAL

- Continued on Architecture at `fcdaa2a542412536cc51ff8ea5ee7846ad5a118f`.
  Preserved all task-start changes. No application source, URL, schema migration
  file or environment file changed; `views.py` remains 1,188 physical lines.
- PostgreSQL/HTTP: **180/180 PASS**, zero skips, 16.906 seconds in the test body.
  Ran the unchanged MembershipIntegration class and all 13 existing PostgreSQL
  extension suites from integration.py. Includes GET/full/compact/assignedOnly,
  real session authorization, profile/enrolment bridges, canonical/legacy IDs,
  KSB counts, Home Summary/Programme List, persisted POST/DELETE and rollback.
  The separate historical/mock fixture mega-suite was not selected in this run.
- Isolation was checked before initdb/Django: existing pinned local images,
  PostgreSQL network=none with only loopback, app sharing that namespace,
  no published ports or host mounts, PostgreSQL data on tmpfs, read-only app
  filesystem, synthetic credentials, all six aliases on 127.0.0.1/phase1f.
  No real .env/settings, Neon, external database or provider was accessed.
  Each created container was removed. This is minimal configured Django/HTTP
  fixture evidence, not production startup hooks or live-provider acceptance.
- Frontend: **114 files, 2,227/2,227 PASS**, zero skipped cases, 345.343 seconds.
  Reused the earlier 117-file selection except the three dedicated Teams files:
  teamsWeeklyModal, longStudyCalendarReview, teamsMeetingsPage. Network guard
  blocked TCP/DNS/unmocked HTTP; existing consumer mocks remained in place.
  No frontend code changed, so prior type-check/build results were not rerun.
- Resolved four previously unexecuted migration checks: **4/4 PASS** on synthetic
  SQLite :memory: only (0089/0091 repeatability/old-null values and 0071 immutable
  history/rollback). No PostgreSQL or Django startup in that runner; one
  SimpleTestCase requires configured dummy aliases. Initial missing-settings
  runner error was corrected without changing any test or assertion.
- The fifth existing check, StudyWeekPersistenceTests.
  test_migration_refreshes_existing_read_views_and_preserves_legacy_rows,
  was executed on fresh disposable PostgreSQL and **FAIL (one error)**.
  Fixed its fixture's absent nullable learner_progress_ksbs.ksb_definition_id
  from LearnerProgressKsb's model contract, and bundled the existing 0091 source
  and free_course_storage.sql dependency. These are test setup changes only.
- Confirmed remaining failure after that fixture correction: production
  free_course_native_schema creates learning_components without status (the
  free_course_contract.COLUMNS projection); attachment_reads.
  authoring_component_counts_by_catalogue applies a status predicate to it.
  PostgreSQL reports `column "status" does not exist`; the reader's broad catch
  masks that first failure, then the current transaction is aborted during the
  test's final create_delivery call. The test reached and passed its earlier
  repeat-migration/old-row/view checks, but the whole scenario is NOT a pass.
  No view column, archive rule, expected assertion or production fallback was
  altered to hide this failure. Actual existing-database impact was not probed.
- Changed this batch: phase1f_tests/image/{meeting_postgresql.py,
  run_import_smoke.py, ARCHITECTURE_V1_TRACKER.md}. Syntax and git diff --check
  PASS; no commit, PR, branch change or deployment.
- Exact commands, fixed test selection, isolation/image IDs, preimages and
  first/final error evidence: D:/Temp/HP/lms-runtime-acceptance-20261124-140512/.
  Commands: `python -I -B <evidence>/run_runtime.py` (180 existing cases),
  `python -I -B <evidence>/run_frontend.py` (114 explicit files),
  `python -I -B <evidence>/run_memory.py` (four explicit cases),
  `python -I -B <evidence>/run_runtime.py migration-postgres` (one explicit case).
- Next bounded correction: reconcile the catalogue component reader's source
  and archive predicate with the actual mixed/native read contract; preserve
  ordinary/free-course identity and inactive/archived/deleted behavior. Keep
  this failing persisted HTTP case as its baseline and review content_counts
  for the same structural assumption. No further bulk extraction before this
  acceptance blocker is addressed. G01-G05 and release acceptance remain OPEN.

### 2026-11-24 - Component count read compatibility PASS; acceptance PARTIAL

- Old: both count readers applied ordinary `status` predicates to
  `learning_components`, whose native/mixed contract has no status column.
  The attachment counter swallowed SQL errors and returned zero/partial counts.
- New: one narrow infrastructure SQL builder filters ordinary components with
  each caller's unchanged predicate, and native components by `deleted_at`.
  It combines the two with UNION ALL before aggregation. Native-only scope
  reads only the native view. IDs, cutover/converted visibility, grouping,
  retired-type filtering and ordinary NULL semantics remain intact. The
  normalized KSB query and ranking algorithm are unchanged. Failed attachment
  reads now propagate to existing caller error handling instead of fake counts;
  higher-level legacy catches have not been redesigned in this batch.
- Production: catalogue/infrastructure/{component_count_sql.py (new),
  attachment_reads.py, content_counts.py}. No writer, URL, model, migration,
  environment or frontend changes. `views.py` is unchanged at 1,188 lines.
- New regressions: catalogue/tests/{test_component_counts_standalone.py (11),
  component_counts_postgresql.py (6)}. Tests use actual current count readers.
  Historical source guards have a separate pinned two-file bug-fix record and
  reject unknown edits; existing 62 legacy snapshots and the dev merge record
  were not refreshed. Updated final_bindings_oracle, the historical content
  source check, the KSB harness import closure and run_import_smoke bundling.
- Verified: **495/495 standalone cases across 70 files PASS** (initial full
  selection followed by the five affected suites after harness corrections);
  **6/6 new PostgreSQL regressions PASS**; **180/180 existing PostgreSQL/HTTP
  cases PASS**, zero skips, 12.070 seconds. No frontend or dedicated Teams suite
  rerun. Syntax and git diff --check PASS. Catalogue's four-layer static graph:
  277 -> 278 modules, **0 -> 0 cycles**; only two imports of the new SQL leaf.
- The previously failing migration/HTTP case was rerun: the missing-status
  failure is gone. Completing its disposable reference-view fixture using the
  existing create_reference_views helper exposed a different failure:
  `module_catalogue_id is ambiguous`. prepare_native_authoring_fixture adds
  legacy KSB placement columns while the normalized projection also derives
  them through component joins. The full scenario remains **FAIL (one error)**;
  no assertion was bypassed and no KSB/schema production fix was made here.
- All PostgreSQL runs used network-none disposable containers, synthetic rows,
  all six aliases on loopback/phase1f, no host mounts/credentials, checked before
  initdb/Django; containers removed afterward. No Neon/provider access or Git
  publishing. Task-start unrelated changes preserved.
- Evidence: `D:/Temp/HP/lms-component-read-fix-20261124/`. Exact commands:
  `python -I -B <evidence>/run_standalone_parallel.py all`, then
  `python -I -B <evidence>/run_focused.py focused-final`;
  `python -I -B <evidence>/run_runtime.py component-postgres`,
  `python -I -B <evidence>/run_runtime.py`, and
  `python -I -B <evidence>/run_runtime.py migration-postgres`.
- Next: reconcile the native migration fixture/preparation contract with the
  normalized KSB schema, then rerun that complete persisted HTTP scenario.
  Existing-database schema suitability is unverified. G01-G05 and Curriculum
  release acceptance remain OPEN; this batch does not certify endpoint parity.

### 2026-11-24 - Normalized KSB preparation and migration/HTTP regression PASS

- Closed the previously failing StudyWeekPersistenceTests.
  test_migration_refreshes_existing_read_views_and_preserves_legacy_rows,
  including repeated 0091 execution, unchanged existing module rows and the
  final real HTTP creation of a new calendar-mode module. Its assertions and
  source were not changed.
- Old: the native test fixture recreated module/week/code/description columns
  on ksb_mappings. Normalized readers also projected those names, causing an
  ambiguous module_catalogue_id. Native preparation read the physical copies,
  and the mixed view could project NULL instead of authoritative KSB values.
- New: free_course_native_schema.prepare and create_read_views use the existing
  pure ksb_placement_reads.relation projection. Component ownership supplies
  module/week; standard_ksbs supplies code/description. The fixture no longer
  invents these four physical columns. SQL explicitly serializes the projected
  whole row with to_jsonb(ksb_mappings.*), avoiding the same-named outer JSON
  column. Existing mapping IDs, metadata, row ordering, duplicate codes across
  different components and storage_version=2 protection are tested.
- Final PostgreSQL selection: **12/12 PASS**, zero skips, 1.474 test seconds:
  the original migration/HTTP case + five new native-KSB tests + six existing
  component-reader regressions. **180/180 existing integration cases PASS**,
  zero skips, 14.134 seconds. **75/75 standalone cases across eight relevant
  suites PASS**, including KSB ranking/legacy aliases and historical guards.
  Initial new-fixture duplicate mappings were corrected to use distinct
  components, retaining the real component/standard unique index unchanged.
- Historical snapshots remain unchanged. A separate pinned native-KSB source
  delta is validated before historical layout comparisons; runtime tests call
  current implementations. New dependency: the migration helper imports an
  import-free SQL constructor; no new cycle, runtime settings or API dependency.
- Changed: free_course_native_schema.py; tests_free_course_native_storage.py;
  catalogue/tests/ksb_native_preparation_postgresql.py; catalogue/tests/parity/
  {native_ksb_contracts.py, test_native_ksb_contracts_standalone.py,
  final_bindings_oracle.py}; catalogue/tests/fixtures/native_ksb_preparation_fix.json;
  phase1f_tests/image/run_import_smoke.py and this tracker.
  No runtime writer/endpoint/model/migration-file/frontend/environment changes.
  The existing migration-owned preparation helper changed; it was executed
  only on synthetic disposable data. views.py stays at 1,188 lines.
- Isolation checked before initdb/Django: network-none PostgreSQL, application
  sharing loopback-only namespace, all six aliases on phase1f, no host mounts,
  credentials or real .env; containers removed. No dedicated Teams tests,
  Neon/provider access, commit, PR or deployment. Syntax/diff checks PASS;
  unrelated task-start changes preserved.
- Evidence: `D:/Temp/HP/lms-ksb-native-compat-20261124/`. Final commands:
  `python -I -B <evidence>/run_runtime.py native-final`;
  `python -I -B <evidence>/run_runtime.py`;
  `python -I -B <evidence>/run_standalone_parallel.py final`.
- Remaining, separately scoped: the full native storage cutover is not covered
  by this preparation/0091 scenario. Static inspection still finds physical
  KSB module-column assumptions in detach/verify_remaining_references. Review
  those before attempting full cutover. Existing deployed read views were not
  refreshed; any release-time refresh requires its own verified database plan.
  G01-G05 and overall Curriculum release acceptance are not automatically closed.

### 2026-11-24 - Canonical Free Course document read boundary PASS

- Scope: source-only extraction of canonical catalogue/document reads. No storage
  cutover, schema/migration, writer, URL, authentication, frontend or provider
  behavior changes. Current Architecture HEAD remains fcdaa2a542412536cc51ff8ea5ee7846ad5a118f.
- Before: free_course_authoring.py (910 lines) mixed canonical SQL, snapshot
  control, revisions, integrity decisions, document assembly and HTTP/writers;
  free_course_catalogue.py (219 lines) owned SQL plus API identity projection.
- After: the two compatible entry modules are 273 and 20 lines respectively
  (836 net lines removed). Existing HTTP/writer tail is byte-for-byte unchanged.
  Actual responsibility owners under catalogue/:
  - domain/free_course_integrity.py: identifier/settings validation and existing
    quiz/course/week/component ownership and integrity decisions (249 lines).
  - application/free_course_revisions.py: stable canonical values and revision
    hashing (119); free_course_documents.py: response-document/identity projection
    (162); free_course_queries.py: single/batched read orchestration (111).
  - infrastructure/free_course_rows.py: existing canonical table selectors and
    batching (206); free_course_document_reads.py: quiz SQL, schema availability
    checks and read-only snapshot control (119). No provisioning or writer API.
  - Existing HTTP adapters stay in place. Four legacy query entry points bind
    the concrete reads capability; application/domain import no Django, SQL,
    infrastructure, legacy views or providers. Public exports/signatures retained.
- Preserved: exact SQL and parameters on synthetic PostgreSQL, repeatable-read
  READ ONLY snapshots, inactive-versus-archived visibility, canonical/provenance
  identity, legacy quiz diagnostics, ownership errors, ordering, revisions and
  private/no-store Cookie-varying ETags. No misleading fallback was introduced;
  existing legacy ownership diagnostics remain explicit and read-only.
- Validation actually run: baseline 58/58 existing feature cases PASS; final
  65/65 PASS (same 58 + five real PostgreSQL/original-source/HTTP checks + two
  existing read-only PostgreSQL checks), zero skips. Existing shared integration
  180/180 PASS, zero skips, 13.472 test seconds. Standalone 59/59 across eight
  suites PASS, including nine new old/new parity and boundary tests. These
  include 64 settings/ownership/status combinations and additional duplicate,
  orphan, missing-target, revision, failure and snapshot cases.
- The pinned task-start source oracle compiles the actual old read definitions;
  runtime tests invoke the new implementations. Two existing test files changed
  only mock ownership/call-count references. Original assertions retained. One
  existing mocked catalogue test logs blocked database/cache-table attempts in
  both baseline and final runs; SimpleTestCase prevents those operations.
- Static four-layer catalogue graph: 278 -> 284 modules, 0 -> 0 cyclic components.
  Syntax and git diff --check PASS; views.py unchanged at 1,188 lines. All unrelated
  pre-existing changes preserved. No extra interfaces/classes/packages added.
- Docker isolation checked before PostgreSQL initialization/Django: network=none,
  loopback-only app namespace, no host mounts/ports/credentials, all six aliases
  on disposable phase1f, synthetic data only. Containers removed. No Neon, Teams
  suite, live provider, commit, PR, branch switch or deployment.
- Evidence: D:/Temp/HP/lms-free-course-read-boundary-20261124/. Commands:
  python -I -B <evidence>/run_runtime.py native-final;
  python -I -B <evidence>/run_runtime.py;
  python -I -B <evidence>/run_standalone_parallel.py final.
  Source/test files are bundled by the existing run_import_smoke.py.
- Remaining: root HTTP/writer adapters and other Curriculum areas still require
  their own boundaries; the separate native cutover issue remains outside this
  batch. HTTP feature checks use synthetic authentication, with existing shared
  session/authorization regression coverage from the 180-case suite. This does
  not prove deployed data suitability or full Curriculum completion. G01-G05
  and release acceptance remain OPEN.

### 2026-11-24 - Curriculum test ownership: relocation complete; existing failures remain

- Root `test*.py`: 338 -> 19. Moved 319 existing files / 74,762 source lines
  into existing feature test packages: catalogue/tests 186, directory/tests 14,
  reporting/tests 23, meetings/tests 96. Basenames and all 4,644 test-function
  definitions retained; no test assertions, fixtures or business rules replaced.
  Total static Curriculum test-function inventory: 5,776 -> 5,776 (not a claim
  that all those tests were executed).
- Updated imports, source/fixture path anchors and 38 dependent test/runner/CI
  files. The deployment workflow change is only its existing test module label;
  no workflow was executed. Added meetings/tests/__init__.py for discovery,
  without forwarding modules at the old paths. Its nine previously namespace-only
  test modules (55 definitions) also become eligible for package discovery;
  Teams discovery/execution was not run. Explicit runner selections are retained.
- Independent before/after AST comparison: 319/319 equivalent after resolving
  relocated imports and filesystem anchors. 81 frozen fixture files and 791
  non-test application modules byte-identical. views.py remains 1,188 lines.
  Static explicit-import graph: 1,264 -> 1,265 modules, 4 -> 4 cyclic components,
  zero new cycles (includes function-local imports; not a runtime-cycle claim).
- Validation actually run: existing shared PostgreSQL/HTTP 180/180 PASS before
  and after; Free Course 65/65 PASS before and after; nine guarded standalone
  suites 69/69 PASS after. Syntax checks and git diff --check PASS.
- Expanded, explicit non-Teams selection: 42 boundary suites, 679 executions
  both before and after. Discovery IDs, order and multiplicity match after module
  path normalization. Final result in each: 677 passing methods, two failing
  methods (five failure events including subtests), zero errors/skips. No new
  failure. Existing failures remain in:
  - catalogue/tests/test_attachment_preparation_boundary_no_db.py:
    test_component_count_query_predicates_parameters_and_error_contract still
    expects the historical swallowed-error/empty-count behavior.
  - catalogue/tests/test_authoring_read_boundary_no_db.py:
    test_summary_modes_preserve_values_and_sql_on_real_synthetic_grouped_reads
    fails four include_content=False subcases expecting MOD-ONE/MOD-TWO.
  Assertions were preserved, not weakened to obtain green results. An initial
  temporary harness omitted a fixture and media URL patterns; both harness-only
  omissions were corrected before the final paired comparison above.
- Isolation: network-none Docker, no host mounts/credentials, dummy DB aliases
  and blocked DB calls for boundary checks; existing disposable PostgreSQL only
  for the 180/65 selections. All containers removed. No host Django, Neon, live
  provider calls, Teams tests, production changes, commit, PR or deployment.
- Evidence / exact commands: D:/Temp/HP/lms-curriculum-test-ownership-20261124/.
  `python -I -B <evidence>/verify_moves.py`; `check_graph.py`;
  `python -I -B <evidence>/run_boundaries.py before` / `after`;
  `python -I -B <evidence>/final/run_runtime.py` / `native-final`;
  `python -I -B <evidence>/final/run_standalone_parallel.py final`.
  moves.json contains the complete old -> new file mapping; preimages and logs
  preserve the actual task-start work, including prior uncommitted changes.
- Remaining root tests: 13 Reviews-related files and six app/shared files,
  including the mixed tests.py harness. Next: resolve the two existing catalogue
  test-contract discrepancies explicitly, then complete the Reviews boundary and
  its test ownership. Full Curriculum modernization and release gates remain OPEN.

### 2026-11-24 - Reviews templates, classification and scheduling boundary: PASS

- Resolved both catalogue test discrepancies: retain the approved count-reader
  error propagation (compare the frozen swallowed-error behavior explicitly),
  and bind grouped-count SQL to its synthetic SQLite source. No catalogue
  production behavior changed; the original 679 boundary executions now pass.
- Extracted 108 functions/constants from reviews.py, review_schedule.py and
  review_types.py into review_management: 19 concrete modules across domain
  (field validation, type identity, calendar recurrence), application (template
  validation/results/commands and schedule orchestration), infrastructure
  (existing SQL, section persistence, provisioning/readiness), and API (HTTP
  and cache-callback composition). No generic repositories or new model layer.
- Old files: reviews.py 1,228 -> 53; review_schedule.py 578 -> 30;
  review_types.py 402 -> 27. Combined 2,208 -> 110 compatibility-export lines
  (2,098 removed from legacy files). Existing callable signatures retained;
  seven cache-dependent commands bind their existing callback at the API edge.
  urls.py imports actual API owners; every URL registration/name/argument/order
  has an identical AST. views.py stays 1,188 lines; only two readiness resets
  now delegate to the single infrastructure flag owners.
- Moved all 13 Review test files to review_management/tests, preserving all
  240 existing test methods. Root test*.py count 19 -> 6. Updated five external
  test references; no Coach/Learner application behavior changed. The template
  test fixture now declares enrolment as well as default because its existing
  missing-programme fallback reads the staff directory. Assertions unchanged.
- Actual validation: 240/240 existing Review PostgreSQL/HTTP/PDF tests PASS
  against both task-start and extracted code under the same synthetic setup;
  683/683 boundary/owner-contract executions PASS (679 existing + 4 new);
  shared PostgreSQL/HTTP 180/180 PASS; existing guarded standalone 69/69 PASS;
  new guarded Review policy/source checks 6/6 PASS. Zero final failures/errors/
  skips. No Teams suite executed. 85 prior fixture files remain byte-identical.
  Historical source guards validate the entire new views AST before reversing
  exactly two readiness calls; immutable dev/extraction snapshots were not edited.
- Static explicit-import graph (including local imports): 1,265 -> 1,293
  modules; four cyclic components remain, with the largest shrinking 60 -> 57
  as all three old Review modules leave it. No new cyclic component or Review
  feature cycle; domain has no Django/SQL/HTTP imports, and new application/
  infrastructure modules do not import API or legacy views. Syntax and
  git diff --check PASS. This does not claim the entire backend is cycle-free.
- Isolation: network-none disposable Docker/PostgreSQL, no host mounts,
  credentials or published ports; all six aliases restricted to the synthetic
  database before Django/startup. Test-only fixture setup included the needed
  placement/profile/staff/calendar tables and native synthetic identities.
  The existing image lacked pypdf/reportlab: copied only existing local package
  sources/font assets matching pinned 6.14.2/5.0.1, plus the existing logo, into
  container tmpfs. No downloads, package installs, image/dependency changes or
  provider operations. All task containers removed; no Neon or existing DB used.
- Evidence/exact commands: D:/Temp/HP/lms-reviews-boundary-20261124/:
  python -I -B run_reviews.py before / after; run_boundaries.py after;
  run_domain.py; check_graph.py; scope-verification.json; task.diff; manifests
  and isolation logs. Shared checks use the already reviewed
  D:/Temp/HP/lms-curriculum-test-ownership-20261124/final/run_runtime.py and
  run_standalone_parallel.py final. Initial incomplete-harness failures were
  resolved without suppressing assertions or changing application behavior.
- Remaining: review_instances.py is still 2,725 lines and byte-identical in
  this batch; instance lifecycle/signatures, OTJH and PDF production ownership
  are the next cohesive extraction. Six root app/shared test files remain,
  including mixed tests.py. Full Reviews/Curriculum completion, live equivalence
  and G01-G05/release acceptance remain OPEN. No commit, PR, push or deployment.

### 2026-11-24 - Review Instance lifecycle and definition boundary: PASS

- Extracted all 121 source symbols (90 functions) into 15 concrete modules in
  review_management. review_instances.py: 2,725 -> 120 compatibility-export
  lines, removing 2,605 lines from the legacy file. Existing function signatures
  and all ten native-write decorators remain intact; no dynamic runtime proxy.
- Domain: instance_rules, instance_definitions, occurrence_identity own frozen
  signature requirements, eligibility, answer-safe section merging, required
  fields, respondent roles, historical progress values and occurrence identity.
  Application: learner_occurrences and instance_creation/definitions/answers/
  progress/lifecycle/signatures/reopening coordinate the existing reads and
  transactions. Infrastructure: instance_relations/schema/rows/calendar own
  concrete reads, readiness, audit persistence and locked Calendar projections.
  Existing concrete storage primitives remain the application write boundary;
  no generic repository, new interface hierarchy or empty API package was added.
- HTTP handlers remain in their current Coach/Learner owners; URLs, models,
  migrations and handler files are unchanged. review_pdf imports the pure
  policies directly, removing its return edge through the legacy instance
  facade. views.py: 1,188 -> 1,186; one explicit reset delegates the same three
  readiness flags to their sole owner, preserving the separate reopen gate.
- Preserved source bodies/control flow and SQL after binding normalization.
  Two exact answer/signature SELECT expressions became concrete infrastructure
  readers; tests independently verify both SQL/parameters and call expansion.
  Existing transaction nesting, row locks, conditional writes, historical
  evidence capture and rollback behavior are unchanged. All 86 prior fixture
  files remain byte-identical; the source guard pins the full new views AST.
- Actual validation: original 240 Review tests PASS before/after; expanded
  selection 262/262 PASS against task-start code and 264/264 PASS after extraction
  (same 262 IDs/order plus two new public-contract/readiness tests). Includes
  persisted reopen/signature history, Calendar identity/rollback, linked HTTP
  consumers and two specifically selected Native source-boundary cases.
  Shared PostgreSQL/HTTP 180/180 PASS; existing boundary selection 683/683 PASS;
  guarded standalone 69 existing + 6 template/schedule + 8 instance tests PASS.
  Zero final failures/errors/skips. Teams suites and live providers NOT RUN.
- Expanded baseline initially exposed incomplete synthetic identities and stale
  test doubles: supplied profiles 301/901/940-942, corrected Calendar stub
  learner_profile_id fields, and modelled the mocked signature writer's existing
  Calendar update. Applied identical fixture corrections to the frozen before
  run and current tests; assertions remain intact. Internal mocks now bind to
  the real extraction owners. No application bug fix was concealed in this move.
- Static Curriculum explicit-import graph: 1,293 -> 1,311 modules, four cyclic
  components before/after; largest 57 -> 55, with review_instances/review_pdf
  leaving it. No new cyclic component/member or review_management cycle. Domain
  imports are framework-free; no new API/legacy-views dependency from feature
  Application/Infrastructure. Syntax and git diff --check PASS.
- Isolation verified before startup: existing network-none disposable Docker/
  PostgreSQL, no host mounts/credentials/ports, six aliases restricted to
  synthetic loopback storage; provider/network/settings guards remain enabled.
  Containers removed. No Neon, existing DB, host Django startup, environment
  changes, commit, PR, push or deployment. Branch/HEAD stayed Architecture/fcdaa2a.
- Exact commands/evidence: D:/Temp/HP/lms-review-instances-20261124/:
  `python -I -B run_reviews.py before` / `after`; `run_boundaries.py after`;
  `run_domain.py`; `check_graph.py`; scope-verification.json and task.diff.
  Shared: D:/Temp/HP/lms-curriculum-test-ownership-20261124/final/run_runtime.py
  and run_standalone_parallel.py final; prior Review run_domain.py supplies the
  six template/schedule checks. Frozen preimages and initial/final logs retained.
- Remaining: Review OTJH and PDF presentation ownership, then other root feature
  families. Existing manual-addition read-error fallback and historical identity
  compatibility remain unchanged; this batch does not claim their elimination.
  Full Curriculum architecture, live equivalence and G01-G05/release gates remain
  OPEN. No production acceptance or merge/deployment approval is implied.


### 2026-11-24 - Review OTJH and signed PDF ownership: PASS

- Before: root review_otjh.py 209 lines, review_pdf.py 105,
  review_pdf_presentation.py 433 (747 total). After: 6 / 14 / 10 lines
  (30 total; 717 lines removed from the root implementations). These are
  explicit compatibility exports; existing Coach/Learner/Employer imports remain.
- Moved 27 declarations into six concrete review_management modules:
  domain/otjh_rules.py (15), domain/pdf_policy.py (63);
  application/otjh_queries.py (178), application/pdf_export.py (35);
  infrastructure/pdf_renderer.py (396); api/pdf_responses.py (47).
  No new folders, generic interfaces, models, schema objects or duplicated SQL.
- OTJH application code calls existing learner_occurrences, instance_rows and
  template_rows owners directly. Live-template hours, claimability, raw planned
  occurrences, completed-only actual hours, rounding, caching, ordering and error
  behavior are unchanged. No writer/transaction/authorization change.
- PDF policy owns exportability, frozen required-signature eligibility and
  programme-date precedence. Application prepares information/coordinates export;
  Infrastructure renders supplied saved data; API preserves status, headers,
  filenames and historical-original-only downloads. Renderer logo path now resolves
  the same existing curriculum_api/templates asset from its new location.
  instance_definitions imports pure pdf_policy rather than the root HTTP facade.
- Existing seven root Review modules are now compatibility export modules;
  this does not certify every Review consumer or all Curriculum as modernized.
- Exact original source is frozen in tests/fixtures/otjh_pdf_boundary.json,
  hash 0f06e03ebeaf99d42e3ab66a505dea018a6cbbaf341a3e2d4a8acdfc93ce8e44.
  Five new standalone checks compare all 27 AST declarations and pure rules;
  five new runtime checks compare original/new hours, read calls, cache state,
  error contracts, actual owner bindings, PDF bytes and HTTP headers. PDF byte
  comparison fixes ReportLab metadata only in the test, not production.
- Validation: 279/279 existing Review + migrated PDF presentation tests PASS
  before; same 279 + five new runtime tests = 284/284 PASS after. Shared isolated
  PostgreSQL/HTTP 180/180 PASS; standalone new 5 + instance 8 + template 6 =
  19/19 PASS. No final failures/errors/skips. No existing assertions weakened.
  Initial after bundles omitted two lazy-import modules; corrected test bundling,
  retained failed logs and reran the full selection. No application workaround.
- Source/import checks: 1,311 -> 1,320 Curriculum Python modules; four cyclic
  components before/after, largest 55 -> 55; no new cyclic members/components or
  review_management cycle. Syntax and git diff --check PASS. All 87 existing
  fixture files unchanged. Six existing files changed plus ten new files, and
  this tracker update; no source deletion outside the three extracted bodies.
- Runtime isolation verified before initdb/Django: existing Docker images,
  no external network, host mounts, ports or credentials; six aliases restricted
  to disposable loopback PostgreSQL; containers removed. Teams suites, Neon,
  live providers, host Django, commits, PRs and deployment NOT RUN.
- Evidence/commands: D:/Temp/HP/lms-review-exports-20261124/ contains preimages.zip,
  scope-verification.json, task.diff, before/after.log, isolation JSON and graph
  evidence. Commands: python -I -B <evidence>/run_reviews.py before / after;
  <evidence>/run_domain.py; <evidence>/check_graph.py. Existing guarded runners:
  lms-review-instances-20261124/run_domain.py, lms-reviews-boundary-20261124/run_domain.py,
  lms-curriculum-test-ownership-20261124/final/run_runtime.py (180 tests).
- Remaining: OTJH read-error fallbacks still return zero/partial totals and cannot
  distinguish unavailable from genuine zero; preserved for behavioral compatibility,
  not certified as desirable reporting behavior. Root Attendance/media/other feature
  families remain. Full Curriculum acceptance and G01-G05/release gates stay OPEN.

### 2026-11-24 - Review facade retirement: implemented; extended baseline PARTIAL

- Before: seven root compatibility modules, 260 lines total: reviews (53),
  review_schedule (30), review_types (27), review_instances (120), review_otjh (6),
  review_pdf (14), review_pdf_presentation (10). After: all seven files removed.
  Coach, Learner, Employer, Progress Reviews, management commands and test mocks
  import the existing concrete review_management owners directly. No new runtime
  facade or business implementation; URLs, writers, SQL and identity rules unchanged.
- Compared all 27 changed production files with task-start preimages: their ASTs
  match after resolving only the reviewed import bindings. Preserved all preexisting
  source fixtures. Test-only retired_review_exports.json pins 269 former bindings;
  contract tests retain signatures, decorators, readiness lifetimes and PDF parity.
  Three standalone guards reject retired files, imports and literal mock/import targets.
- Validation: identical 288 Review/PDF tests PASS before and after; isolated shared
  PostgreSQL/HTTP 180/180 PASS; guarded standalone policy/source checks 19/19 PASS;
  retired-import guards 3/3 PASS. Syntax and git diff --check PASS. The initial
  Review test bundle lacked template_schedule_boundary.json; included that fixture
  and reran the complete 288-test selection without changing application behavior.
- Additional exact six-suite consumer selection: 64 methods before and after,
  59 passing and the same five failing methods (eight failure entries including
  six subtests, two errors), zero skips. These are not new regressions or green
  acceptance: three LearningPlanMeetings expectations no longer reach the expected
  native projection, Employer document assertions expect learner_id where the
  unchanged code uses enrolment_id, and one imported-calendar test reaches an
  unmocked LearnerProfile query blocked by the DB-free environment. Existing
  assertions and business rules were not changed to make these tests pass.
  Initial consumer bundle omissions were corrected before the before/after comparison.
- Static explicit-import graphs: Curriculum 1,320 -> 1,315 Python modules,
  four cyclic components unchanged (largest 55). Full backend 3,447 -> 3,442,
  ten components before/after; largest 309 -> 301. No new cyclic member or merged
  component. Four Review API owner modules leave the existing large backend cycle
  along with four deleted facades. Existing unrelated cycles remain.
- Isolation proved before Django/initdb: no external network, host credentials,
  mounts or ports. Review/shared runs use disposable PostgreSQL only; consumer
  runs use six dummy aliases and blocked DB/socket operations. Containers removed.
  Teams/booking/Graph suites NOT RUN under the local explicit-request-only rule;
  their affected imports and mock targets were updated and syntax checked only.
  No Neon, live providers, .env changes, Git mutations, PR or deployment.
- Evidence: D:/Temp/HP/lms-review-import-cleanup-20261124/ holds preimages.zip,
  task.diff, scope-verification.json, consumer-source-parity.json, assertion-review.json,
  before/after.log, consumers-before/after.log, isolation JSON and both graph reports.
  Commands: python -I -B run_reviews.py before / after; run_consumers.py before / after;
  check_consumer_parity.py; check_graph.py; check_backend_graph.py. Standalone command:
  python -I -B backend/curriculum_api/review_management/tests/test_retired_imports_standalone.py -v.
  Existing guarded run_domain.py scripts: lms-review-exports-20261124,
  lms-review-instances-20261124, lms-reviews-boundary-20261124. Shared runner:
  lms-curriculum-test-ownership-20261124/final/run_runtime.py.
- Remaining: the five preexisting consumer test failures need their own fixture/
  behavior review; deferred Teams coverage remains unverified. Attendance/media
  and other root feature families, known OTJH read-error fallbacks, full Curriculum
  acceptance and G01-G05/release gates remain open. This is not release approval.

### 2026-11-24 - Free Course ownership and canonical authoring boundary: PASS (scoped)

- Before: 16 root free_course_*.py files, 3,409 lines, plus the 252-line storage
  SQL asset. After: concrete owners under catalogue/api, application, domain and
  infrastructure; no remaining root free_course_*.py files. The export-only
  catalogue facade is retired; readers use infrastructure/free_course_rows.
  The 119-line revision policy moved from application to domain. Tests/fixtures
  remain under catalogue/tests. No new empty packages or generic repositories.
- Actual separation: API composition binds four canonical create/update/delete/
  clone use cases to explicit capabilities. Application orchestration imports
  no Django, SQL, ORM, HTTP or providers. Sixteen original pure declarations
  own validation, normalization, revision and replay decisions in domain.
  Infrastructure owns 18 concrete SQL operations, exact cursor/transaction/lock
  behavior, schema helpers, storage and video queue effects. Alignment decisions,
  catalogue comparison/order rules and week identity also have pure owners.
  Catalogue storage no longer resolves its dependencies through views.
- URLs, authorization, payloads, canonical/legacy identities, writer-mode guards,
  transaction boundaries and archived history are preserved. Root consumers and
  six historical migration imports point to the new owners; migration operations
  were not changed. No migration was run against an existing database. The active
  legacy authoring/conversion/import and quiz flows are retained, not deleted as
  dead code. Some still mix responsibilities and require a later cohesive split.
- Validation: canonical read/contracts 65/65 PASS before/after; real disposable
  PostgreSQL writer/history tests 11/11 PASS before/after; shared Membership and
  Curriculum PostgreSQL/HTTP 180/180 PASS after; guarded standalone source/policy
  checks 35/35 PASS. New guards expand the actual SQL adapters into application
  bodies and compare them with task-start source; no independently rewritten oracle.
- Additional feature selection originally executed 68 passing methods but failed
  class setup for nine conversion-date cases, identically before/after. Rebound that
  test setup to the actual extracted owners and explicit persistence doubles;
  all nine test bodies/assertions are unchanged. Those nine PASS without Django,
  and the full additional selection now reports 77/77 PASS, zero errors/skips.
  Original failing logs retained. No production behavior changed to satisfy tests.
- Scope checks: 32 existing production consumers are import-only changes; three
  existing composition/document files additionally supply the explicit read
  capability or re-export the moved identity function. All 89 existing JSON
  fixtures unchanged. Syntax and git diff --check PASS. Static explicit-import
  cycles: backend 10 -> 10 (largest 301 -> 300), Curriculum 4 -> 4 (55 -> 54).
  This is not a claim that the preexisting import cycles are eliminated.
- Isolation proved before initdb/Django: existing Docker images, no external
  network, host mounts/credentials or published ports, six aliases limited to
  disposable loopback PostgreSQL. Containers removed after each run. No Neon,
  live providers, host Django, Teams tests, .env edits, Git mutations, PR or deploy.
- Evidence: D:/Temp/HP/lms-free-course-ownership-20261124/ contains preimages.zip,
  task.diff, task-changes.json, scope-verification.json, consumer-scope.json,
  SQL/graph evidence and before/after logs. Commands: python -I -B -X utf8
  <evidence>/{before,after,writer-before,writer-after,extended-before,extended-after}/run_runtime.py
  native-final; <evidence>/after/run_runtime.py runtime; guarded final_test_*.py;
  check_graph.py and final_scope.py. Failed intermediate fixture-bundle runs are
  retained; corrected test bindings did not weaken assertions.
- Remaining: the preexisting legacy authoring endpoint has an unresolved
  transaction global; it was not changed or certified by this batch. Legacy
  import/conversion/quiz orchestration, root Attendance/media families, earlier
  Review consumer failures and deferred Teams validation remain. Full Curriculum
  acceptance, G01-G05 and release approval stay OPEN.

### 2026-11-25 - Free Course workflow boundaries: implemented; acceptance PARTIAL

- Before: authoring, conversion and Quiz API files contained 703 lines; the
  infrastructure importer contained another 155 lines of mixed orchestration.
  After: the three API files total 309 lines (168/53/88), plus a 25-line import
  composition entry. Four application owners coordinate structure edits,
  conversion, Quiz operations and imports; four domain owners hold delta,
  placement, ownership/revision and import preparation rules; concrete SQL/ORM,
  locks and transaction operations have infrastructure owners. No generic
  repositories, interface hierarchy or new package layer was introduced.
- The old infrastructure/free_course_import.py is removed after updating its
  management command and test consumers. Its behavior remains in explicit
  application/domain/storage owners. No active legacy flow or fallback was
  deleted merely because of its name. Existing writer-mode gates are preserved.
  API URLs, decorators, payloads, error mapping, IDs, lock order, rollback and
  on-commit timing are unchanged; no models/migrations/settings were edited.
- Final checks: existing feature selection 77/77 PASS; canonical read/contracts
  65/65 PASS; disposable PostgreSQL writer/history 19/19 PASS (11 existing + 8
  new real Quiz ORM/link/rollback cases); shared Membership/Curriculum HTTP and
  PostgreSQL 180/180 PASS. Guarded standalone checks 43/43 PASS (35 existing + 8
  new source/policy cases). New parity compares frozen actual implementations
  with current code: 24 Quiz, 13 authoring, 11 conversion, 9 import workflow,
  8 delta and 5 import preparation scenarios. No independent rewritten oracle.
  Synthetic authoring tests explicitly bind its existing transaction dependency;
  they do not establish that its unresolved production global is fixed.
- Historical conversion/storage/command suites: 34 executed before AND after,
  with identical 2 PASS / 19 FAIL / 13 ERROR / 0 SKIP outcomes. Evidence includes
  missing KSB fixture data, incomplete historical total_otjh/migration fixtures,
  and the correctly disabled legacy writer. These are not 32 newly introduced
  regressions, but persisted legacy import/conversion acceptance remains OPEN.
  Existing assertions are unchanged; mocks now target actual owners.
- Static explicit-import graph: backend cycles 10 -> 10, largest 300 -> 300;
  Curriculum cycles 4 -> 4, largest 54 -> 54. Domain/application owners have no
  Django/HTTP/SQL/infrastructure imports. Existing 90 JSON fixtures are unchanged.
  Syntax, whitespace and git diff --check PASS. One extra API composition file
  was eliminated during review to avoid enlarging an existing import cycle.
- Isolation proved before initdb/Django: existing Docker images, network none,
  loopback-only disposable PostgreSQL, six restricted aliases, no mounts/host
  credentials/published ports. Task containers removed. No Neon, live providers,
  Teams tests, host Django, Git mutations, PR or deployment.
- Evidence: D:/Temp/HP/lms-free-course-workflows-20261125/ contains task-start
  preimages, task.diff, task-changes.json, scope-verification.json, dependency
  graph, guarded standalone logs and all before/after/final Docker logs.
  Commands: python -I -B -X utf8 <evidence>/final-{after,reads,writers}/run_runtime.py
  native-final; final-after/run_runtime.py runtime; run_standalone.py; prior
  lms-free-course-ownership-20261124/final_test_*.py guards (five selected
  non-Teams suites); check_graph.py; final_scope.py; git diff --check.
- Remaining: legacy authoring's id-only course projection/adoption-required409
  and unresolved transaction global are unchanged, not certified as repaired.
  Complete historical import/conversion fixtures and acceptance separately;
  existing cross-context Quiz API dependency and import cycles remain. Other
  root feature families, previous Review failures and deferred Teams validation
  remain; this batch does not close full Curriculum acceptance or G01-G05.

### 2026-11-25 - Identity & Placement Phase 2.3 ownership/authorization: implemented; verification PARTIAL

- The learner-self, linked-staff and scoped-Coach ownership decisions moved from
  `login.permissions` into Identity & Placement Domain/Application/Infrastructure.
  The learner-scoped HTTP target parsing, 401/400/404/403 response adaptation and
  admin/Coach audit integration moved to the capability API. Login retains session
  authentication, generic roles and account lifecycle; `account_identity` retains
  transactional identity writes. No permission, fallback, repair, alias or audit
  rule changed and no second authentication policy was introduced.
- `login.permissions` lost the obsolete 267-line ownership/decorator implementation
  with no compatibility aliases. Fifty-five modified runtime consumers (52 Learner,
  two Curriculum, one Login) now import the supported Public owner; a five-app
  offline import smoke loaded all 59 production Public consumers. Repository scans
  found zero old executable imports, mock targets, dotted references or duplicate
  Login definitions. No production compatibility file remains.
- Four complete Login suites moved physically to
  `learner_api/identity_placement/tests/authorization`; their originals were deleted.
  Capability production Python files increased 17 -> 22 and discovered test files
  10 -> 15. Learner root Python files remain 694 -> 694; Login root Python files
  decrease 80 -> 76. No production source file was deleted in this phase.
- Pre/post ownership parity is exact: the same 48 cases report 45 PASS, one FAIL
  and two ERROR. The unchanged failure expects an older `subject_store.finish`
  signature; the unchanged errors require the absent isolated `enrolment` alias in
  live-session access. Excluding only those three recorded baseline blockers, the
  remaining ownership selection is 45/45 PASS. Full capability discovery runs 161
  tests: 158 PASS with exactly those same one failure/two errors; the Phase 2.2 core
  plus new ownership/architecture coverage is 113/113 PASS; canonical placement is
  34/34 PASS. Focused Domain/Public/
  Application/architecture selection is 23/23 PASS. No assertion was weakened,
  skipped or rewritten.
- Static verification: 3,623 backend Python files parse with zero syntax errors;
  focused Ruff on the new ownership boundaries passes; `git diff --check` passes.
  The accepted Phase 2.2 reference had nine broader cyclic groups (largest 439) and
  zero Identity & Placement cycles. The final explicit-import scan still has nine
  groups (largest 449) and zero Identity & Placement cycles; no capability cycle was
  introduced. Existing broader backend cycles remain an open repository issue.
- Retained neighboring rules are not compatibility wrappers: account identity email
  conflict/lifecycle writes (`account_identity.py:34,46`), Enrolment route/employer
  policy (`enrolment_api/auth.py:138,180`) and Engagement reward ownership
  (`engagement_api/permissions.py:141`) remain with their owning capabilities.
- No database, schema, migration, Neon, existing database, real-data, provider,
  branch, commit, push, merge, PR or deployment action ran. `attendance.py` and
  `calendar_connections.py` received import-only owner changes, but the assignment
  explicitly prohibits Teams tests. Teams baseline and expanded checks are therefore
  NOT RUN / BLOCKED BY TASK RESTRICTION, so repository-level Phase 2.3 verification
  is PARTIAL even though the cohesive migration and scoped parity checks pass.
