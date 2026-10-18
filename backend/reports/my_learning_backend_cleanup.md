> Update: the initial JSON contract and search/upcoming behavior below describe the prior baseline. See [My Learning minimal JSON implementation](my_learning_minimal_json.md) for the current implementation and validation. This earlier record is preserved.

# My Learning: compact initial API and scoped module detail

Branch: `coach_view`. Both previously incomplete implementation requirements are
**DONE**. Database-backed integration and browser visual validation remain
blocked as described below; this is not a claim of production readiness or
measured HTTP performance.

All modifications and untracked files present at the start were preserved.
No branches, commits, merges, migrations, schema/data writes, deployment or
production Neon connections were performed.

## Final request graph

Before this continuation, a cold Modules visit with previous learning used:

1. `/learner_api/learner-detail/commercial/265/?content=summary`
2. `/learner_api/subject-covers/265/?refs=`
3. `/learner_api/student-activity/commercial/265/?view=my-learning`
4. `/learner_api/metrics/commercial/265/`
5. `/learner_api/training-plan-dashboard/commercial/265/?section=my-learning`
6. `/learner_api/certificates/commercial/265/template/?summary=1`

After:

1. `/learner_api/my-learning/commercial/265/` owns display identity, the complete
   current/previous summaries, cards, covers, programme OTJH and upcoming links.
2. `/learner_api/certificates/commercial/265/template/?summary=1` remains an
   independent, consumed certificate-configuration read in catalogue view.

Thus five learning-data projections become one; the independent certificate
read remains. Native-only learners also use the same single catalogue read.
Authentication `/login_api/me/`, staff action authorization where applicable,
and `/curriculum_api/performance/record/` telemetry remain independent.
Quizzes/Assignments tabs request their existing resources only when selected.

Opening a subject requests:

`/learner_api/my-learning/commercial/265/modules/current%3AMODULE-ID/`

A legacy course uses `legacy%3ACOURSE-ID`. The catalogue can remain cached, and
cold deep links load catalogue and subject detail concurrently. The module API
supplies its own authorized metadata; no follow-up cover/detail/schedule request
is needed to construct the module workspace. Existing material and native
quiz/video/component runners keep their stable action URLs and fetch their
required runner resources on demand. Those conditional activity-page reads are
separate from the Modules initial graph.

The original cleanup's `section=learning` and `section=overview` duplicate
schedule reads remain absent. Their public compatibility routes were retained.
No `content-summary` route exists in this checkout.

These paths are source-derived. Mocked route tests exercise the complete page
and assert the actual request URLs, including StrictMode deduplication and the
absence of the five retired initial projections. No authenticated production
browser trace was collected.

## Compact initial contract

The following is a shortened projection of the real synthetic fixture (optional
card fields are omitted here for readability). The complete exact response,
native detail and legacy detail are in
[`myLearningFixtures.json`](../../frontend/src/test/myLearningFixtures.json).

```json
{
  "version": 1,
  "learner": {
    "id": "7",
    "kind": "commercial",
    "name": "Synthetic learner",
    "programme": "Example programme",
    "cohort": "",
    "group": ""
  },
  "summary": {
    "current": {
      "subjects": 2,
      "total": 3,
      "completed": 1,
      "percent": 33.33
    },
    "previous": {
      "subjects": 1,
      "total": 4,
      "completed": 2,
      "percent": 50.0
    },
    "subjectCount": 3
  },
  "modules": [
    {
      "id": "current:M2",
      "title": "Another module",
      "source": "current",
      "activityCount": 1,
      "completedActivityCount": 0,
      "progress": 0.0,
      "status": "Upcoming",
      "searchText": "C2",
      "nextTitle": "C2",
      "actualHours": 0,
      "planModule": {
        "id": "M2",
        "title": "Another module",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "tutor_name": "Example tutor",
        "total_otjh": 10,
        "educational_session_count": 2,
        "programme_name": null,
        "cohort_name": null,
        "group_name": null
      }
    },
    {
      "id": "current:M1",
      "title": "Example module",
      "source": "current",
      "activityCount": 2,
      "completedActivityCount": 1,
      "progress": 50.0,
      "status": "In progress",
      "searchText": "Example reading\nFinal test",
      "nextTitle": "Final test",
      "actualHours": 1.0,
      "planModule": {
        "id": "M1",
        "title": "Example module",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "tutor_name": "Example tutor",
        "total_otjh": 10,
        "educational_session_count": 2,
        "programme_name": null,
        "cohort_name": null,
        "group_name": null
      }
    },
    {
      "id": "legacy:50",
      "title": "Previous course",
      "source": "legacy",
      "activityCount": 4,
      "completedActivityCount": 2,
      "progress": 50.0,
      "status": "In progress",
      "searchText": "Previous material 1\nPrevious material 2\nPrevious quiz 3\nPrevious material 4",
      "nextTitle": "Previous material 2",
      "actualHours": 2,
      "planModule": null
    }
  ],
  "otjh": {
    "actual": 3.0,
    "planned": 20.0
  },
  "deadlines": [],
  "sessions": [],
  "verification_status": "verified"
}
```

Cards carry aggregate counts/status, search text, one next-activity preview,
final-test eligibility, owned source/grouping identities, cover and small
placement/hours metadata. Search text separates activity titles with newlines,
so ordinary searches cannot match across two different activity titles.

The initial JSON contains no activity arrays, learner progress ledger, quiz
attempt arrays, curriculum weeks, lesson HTML or full module descriptions. It
is produced by a dedicated fact/aggregate path, not by constructing the old
learner-detail/student-activity/dashboard responses and trimming them.

## Scoped module contract

Exact synthetic native response:

```json
{
  "version": 1,
  "subjectId": "current:M1",
  "detail": {
    "modules": [
      "Example module"
    ],
    "components": [
      {
        "componentId": "C1",
        "moduleId": "M1",
        "module": "Example module",
        "component": "Example reading",
        "type": "reading",
        "week": "Week 1",
        "hasReadingContent": true
      },
      {
        "componentId": "Q1",
        "moduleId": "M1",
        "module": "Example module",
        "component": "Final test",
        "type": "quiz",
        "week": "Week 1",
        "isQuiz": true,
        "quizMeta": {
          "quizId": 1,
          "questions": 1
        }
      }
    ],
    "retiredQuizComponents": [],
    "quizAttempts": [
      {
        "componentId": "Q1",
        "quizId": 1,
        "passed": false,
        "grade": 0
      }
    ],
    "videoProgress": [],
    "componentProgress": [
      {
        "componentId": "C1",
        "kind": "component"
      }
    ],
    "id": "7",
    "programme": "Example programme",
    "cohort": "",
    "group": "",
    "week": [],
    "name": "Synthetic learner"
  },
  "activity": null,
  "metadata": {
    "covers": {
      "current:M1": "https://assets.example.test/cover.png"
    },
    "builder_subjects": {
      "current:M1": {
        "id": "M1",
        "title": "Example module"
      }
    },
    "imported_courses": {},
    "replacement_courses": {},
    "previous_learning_groups": {},
    "current_subjects": [
      {
        "id": "M1",
        "title": "Example module"
      }
    ],
    "activity_dates": {}
  },
  "schedule": {
    "modules": [
      {
        "id": "M1",
        "title": "Example module",
        "description": "",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "tutor_name": "Example tutor",
        "coach_name": "",
        "total_otjh": 10,
        "educational_session_count": 2
      }
    ],
    "moduleLinks": {
      "current:M1": {
        "id": "M1",
        "title": "Example module"
      }
    },
    "generatedAt": "2026-10-18T00:00:00+00:00"
  },
  "sessions": []
}
```

A legacy response has the same envelope, with an owned-course `activity`
projection and its native `detail.components` empty unless a verified successor
resolves that route to its current module. The legacy fixture contains course
50 only. Unrelated course 60 and module M2 content are not fetched or returned.
Verified replacement detail may include its one predecessor as archived
learning, with separate identities and unchanged accepted-hour attribution.

The view is GET-only and retains `learner_self_or_staff` plus journal-source
routing. It validates membership before selected content reads. Unknown or
foreign subjects return 404; an unqualified ambiguous evidence link also
fails closed. Component/quiz actions retain their existing server gates.

## Canonical rules and backend work

- `owned_source_courses()` is shared with the existing canonical catalogue;
  source ownership and verified membership exclusions remain authoritative.
- `course_record_placements()` was extracted from the existing canonical
  allocator and is used by both aggregates and activity detail. Typed material
  versus quiz identity, source-link precedence, journal routing and once-per-
  course accepted hours retain the same code path.
- Initial historical reads select only IDs, titles and placement/provenance
  keys needed for counting, replacement reconciliation, search and the visible
  next-activity preview. Source materials, score/attempt responses and evidence
  bodies are not built. Owned catalogue identity facts are still required to
  retain the exact denominator, including unstarted work.
- The initial native path reuses the existing Weekly content/identity helper,
  removed-video rules, global retained-quiz decisions, deleted-evidence exclusion and progress achievement
  rule. It adds a narrow opt-in identity projection for live-session routing
  and mixed id-less plans. Existing Weekly callers retain their default shape.
- Real attendance completion and live-credit supplementation reuse the existing
  services. Initial reads batch these facts; detail restricts attendance and
  live-credit work to the selected native module.
- A request-local verified owner, effective assignment set and narrow canonical
  ledger snapshot serve all calculations. Ledger reads keep reporting/lineage
  facts but exclude raw evidence bodies. Programme OTJH is independent of week
  selection; it is not summed from a selected week.
- Initial module metadata, authored session counts and module/week identities
  are batched once. The same module/week metadata is passed into the native
  resolver, avoiding another title/week query pair. KSB descriptions, lesson
  bodies and reflection resources are not loaded for initial card counts.
- Detail reads keep programme-wide narrow identities for quiz/replacement
  reconciliation, then query native content for one selected assignment and
  historical activity records for only its selected owned course/predecessor.
- Module counts, completion and search lookup use indexed sets/maps. Repeated
  progress scans per component and per-subject identity checks are avoided.
- Initial programme metrics no longer call a separate metrics endpoint or
  calculate an unused KSB metric response. Module hours retain the canonical
  module projector and successor-hour union; no historical records are rewritten.
- Covers use the earlier scoped cover-only reader. Builder URLs are kept intact;
  only legacy storage paths receive upload URL conversion.

This does not claim zero internal identity rows or zero global reconciliation
work. Those narrow facts are necessary to preserve counts and unambiguous
credit. No real SQL timings, query plans or production query-count benchmark
were collected. No application-wide absence of N+1 queries is asserted.

## Frontend ownership and cleanup

`myLearningCatalogue` is the single initial resource owner, keyed by learner
kind/ID in the existing authenticated read cache. Module state and transport
keys also include the selected subject. A new learner/subject hides the old
response immediately; stale in-flight results cannot replace the new identity.

The compact UI reuses `LearningCatalogue`, `SubjectCard`, loading skeletons and
the activity workspace. Optional card aggregates replace activity-array counts
for the initial view. Search/filter/sort/list/grid changes remain local.
Module revisits share cached detail; saves invalidate the catalogue and detail.
A successful legacy completion stays visible locally if refresh fails, while
the failure is exposed. A successful authoritative refresh clears that local
feedback override.

Removed the obsolete `ModulesTab` multi-request pipeline and its unused page
imports. Four tests for its old request sequencing were replaced with stronger
whole-route tests of one-request ownership, identity isolation, atomic refresh,
saved-data failure behavior and cache reuse. The original completion/refresh-
failure/reopening regression was migrated to the scoped module flow without
removing its behavioral assertions.

`useUnifiedLearningSummary`/`learningSummary` remain because Progress, shared
consumers and selected module presentation still use them. Existing public
source endpoints and the previous opt-in schedule projection remain available;
shared consumers were not silently removed.

Two pre-existing canonical test doubles were repaired to accept the real
`lineage_only` keyword and load the real ratio helper. Their completion/hour
assertions remain, with additional assertions on the narrow reader call. They
now execute rather than failing on mock signatures.

## Fixture payload sizes

Measured by `json.dumps(payload, separators=(',', ':')).encode()` and
`gzip.compress(raw, mtime=0)` on the checked-in synthetic responses:

| Response | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| Initial catalogue: 2 current modules, 1 previous course | 1868 | 651 |
| Selected native module | 1358 | 583 |
| Selected previous course | 3431 | 836 |

The fixture is generated by `fixture_responses()` in
`backend/learner_api/tests_my_learning_no_db.py`, which calls the actual
projections with mocked readers and synthetic facts. A backend test compares
its output with the shared JSON; frontend tests decode and render it.
These sizes are not learner 265 measurements and do not establish an HTTP
latency improvement. Real HTTP latency, production SQL time and the five-second
target remain **UNMEASURED**.

## Final validation

- Frontend My Learning + shared Dashboard/Weekly + cache/transport regression:
  **505 tests passed, 46 files**. Command:
  `npm --prefix frontend run test -- src/pages/learner/my-learning src/pages/workspace/learner/__tests__ src/api/__tests__/weeklyLearningContract.test.ts src/api/__tests__/weeklyMutations.test.ts src/hooks/__tests__/useWeeklyLearning.test.tsx src/hooks/__tests__/useWeeklyLearningWeek.test.tsx src/api/__tests__/learnerRead.test.ts src/api/__tests__/learnerOverview.test.ts src/hooks/__tests__/learnerNavigation.test.tsx --maxWorkers=2`.
- Final fixture-focused UI rerun:
  `npm --prefix frontend run test -- src/pages/learner/my-learning/compactModules.test.tsx --maxWorkers=2`: **13 passed**.
- `npm --prefix frontend run type-check`: **PASS**.
- `npm --prefix frontend run build`: **PASS**, 4185 modules transformed; existing
  dependency eval/plugin-timing warnings emitted. No deployment followed.
- Changed TS/TSX files: installed ESLint with
  `--report-unused-disable-directives --max-warnings 0`: **PASS**.
- Guarded backend suites: **104 passed**. Exact runner below.
- With `PYTHONPATH=backend`:
  `python -m unittest backend.learner_api.test_canonical_learning_no_db backend.learner_api.test_current_learning_no_db backend.learner_api.test_my_learning_cleanup_no_db`: **73 passed**.
- `python -m unittest backend.learner_api.test_local_subject_content_no_db`:
  **21 passed**, separate process because this suite configures minimal settings.
- `git diff --check`: **PASS**.
- Coverage includes both learner kinds; current-only, previous-only and mixed
  data; typed quiz/material identities; exclusions; retained and failed quiz
  attempts; attendance; replacement completion/hours; current/previous totals;
  module membership denial; local search/sort/layout; cache reuse/invalidation;
  saved completion after refresh failure; and stable activity navigation.
- Teams baseline/expanded Teams checks: **NOT REQUIRED**. No listed Teams file,
  or function/type/response consumed by a listed file, changed. Existing Teams
  scheduling/attendance services are called unchanged.
- Live Teams: **NOT RUN**.
- PostgreSQL integration: **BLOCKED / NOT RUN**; no authorized isolated
  PostgreSQL target is available. No production-connected Django server started.
- Browser visual smoke: **BLOCKED**. Playwright's JS package is unavailable;
  a direct Chromium fixture attempt failed to complete after a network-service
  access-denied error. No screenshot result is claimed. Its frontend-only server
  was stopped and temporary harness removed; all harness API fetches were
  blocked or fixture-backed. UI verification here is DOM/component regression,
  not a live authenticated browser acceptance test.

Guarded runner (no database setup, migrations or connections):

```python
import os, sys, unittest
sys.path.insert(0, 'backend')
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['DJANGO_USE_SQLITE'] = 'true'
from django.conf import settings
assert all(db['ENGINE'] == 'django.db.backends.sqlite3'
           for db in settings.DATABASES.values())
import django
django.setup()
from unittest.mock import patch
from django.db.backends.base.base import BaseDatabaseWrapper
names = [
    'learner_api.tests_my_learning_no_db',
    'learner_api.test_dashboard_training_no_db',
    'learner_api.test_dashboard_request_reuse_no_db',
    'learner_api.test_dashboard_weekly_no_db',
    'learner_api.test_weekly_optimization_no_db',
    'learner_api.test_previous_learning_groups_no_db',
    'learner_api.test_ksb_point_display_no_db',
    'learner_api.test_replacement_learning_no_db',
    'learner_api.tests_weekly_learning',
]
with patch.object(BaseDatabaseWrapper, 'ensure_connection',
                  side_effect=AssertionError('Database access prohibited')):
    result = unittest.TextTestRunner().run(
        unittest.defaultTestLoader.loadTestsFromNames(names))
sys.exit(not result.wasSuccessful())
```

## Exact working-tree files

Includes preserved changes from the previous cleanup as well as this
continuation; no unrelated work was discarded:

```text
backend/learner_api/canonical_learning.py
backend/learner_api/dashboard_training.py
backend/learner_api/learner_detail.py
backend/learner_api/my_learning.py
backend/learner_api/replacement_hours.py
backend/learner_api/student_activity.py
backend/learner_api/subject_store.py
backend/learner_api/test_current_learning_no_db.py
backend/learner_api/test_my_learning_cleanup_no_db.py
backend/learner_api/tests_my_learning_no_db.py
backend/learner_api/training_plan_dashboard.py
backend/learner_api/urls.py
backend/learner_api/weekly_learning.py
backend/reports/my_learning_backend_cleanup.md
frontend/src/api/__tests__/learnerOverview.test.ts
frontend/src/api/__tests__/learnerRead.test.ts
frontend/src/api/learnerOverview.ts
frontend/src/api/myLearning.ts
frontend/src/api/studentActivity.ts
frontend/src/hooks/__tests__/learnerNavigation.test.tsx
frontend/src/hooks/useStudentActivity.ts
frontend/src/pages/learner/my-learning/CompactModules.tsx
frontend/src/pages/learner/my-learning/LearningCatalogue.tsx
frontend/src/pages/learner/my-learning/SubjectWorkspace.tsx
frontend/src/pages/learner/my-learning/compactModules.test.tsx
frontend/src/pages/learner/my-learning/learningSummary.ts
frontend/src/pages/learner/my-learning/page.tsx
frontend/src/pages/learner/my-learning/studentActivity.test.tsx
frontend/src/pages/learner/my-learning/subjectLearning.ts
frontend/src/pages/learner/my-learning/useSubjectLearningData.ts
frontend/src/test/myLearningFixtures.json
```

## Handoff

Compact initial API: **DONE**. Scoped My Learning module detail: **DONE**.
Mandatory automated checks completed as recorded. Browser/PostgreSQL acceptance
remain blocked; review is still needed before acceptance or any release.
