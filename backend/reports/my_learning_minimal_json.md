# My Learning minimal JSON implementation

Implemented in the current folder on `coach_view`, preserving the pre-existing working tree. No branches, commits, merges, migrations, database connections/writes or deployments were performed. This report supersedes the compact-contract portions of `my_learning_backend_cleanup.md`; that file remains the prior implementation record.

## Fields removed and retained

Removed from the initial envelope: `version`, `sessions`, `deadlines`, `verification_status`.
Removed from module cards: `searchText`, `catalogueCount`, `catalogueProgress`, `acceptedHours`; `moduleId` for current cards; duplicated `planModule.id` and `planModule.title`. Removed `version` from selected-module responses and both frontend version checks. There is one canonical contract, with no version negotiation or alternate V1/V2 handling.

`actualHours` supplies the existing recorded-hours display for native, historical and replacement cards. The UI adapter maps it to the existing SubjectCard interface. Legacy planned hours remain unknown (`planModule: null`), displayed as Unavailable, never manufactured as zero. Legacy `moduleId` remains when needed to resolve its builder placement. Current IDs encode their module identity.

Retained `nextTitle` (visible next-activity preview), `finalTestPassed` (certificate eligibility), `cover`, stable source/grouping identities, aggregate counts/progress/status and the remaining `planModule` display/placement fields. Retained `summary.subjectCount` (grouped count/empty state), learner name/identity (display and response validation), programme/cohort/group (current-module placement selection), and programme `otjh` (visible totals). Placement fields remain nested because their presence/null semantics are useful and removing duplicate id/title already removes the actual duplication.

Initial `upcoming` contains at most three display-ready navigation links. `hasMoreUpcoming` preserves View all. A link contains only `id`, `title`, `type`, `date`, `href`, `online`. Expanded links load on demand; module-detail sessions and the existing Quizzes/Assignments resources remain available independently.

## Backend work eliminated

- No activity-title concatenation or large card search strings. Narrow activity identities/titles still serve canonical counts, replacement reconciliation and the visible next-activity preview; these required facts are not claimed to be eliminated.
- The initial endpoint no longer invokes `plan_sessions` or materializes the complete historical/future schedule. Its dedicated navigation query restricts starts to the future and limits session candidates to four in SQL, sufficient to merge the first three links and detect additional results.
- That query omits attendance EXISTS/lateral lookups, session duration/end/attendance fields, recurrence response objects and actual join URLs. It retains shared-delivery owner resolution and real occurrence identities. Only an online boolean is returned.
- Initial deadlines are minimal pending-assignment/checkpoint links merged into the three-item preview, rather than a full response collection. No additional deadline candidate query was introduced: native identity/completion and activity-date facts already required by cards are reused.
- Historical activity search applies the title predicate and validated membership exclusions in SQL and returns DISTINCT owned course references, not matching title rows, materials, source payloads, attempts or evidence bodies.
- Search avoids the canonical ledger read, programme/module hours calculations, export placements, cover reads, authored session-count metadata, attendance/live-credit work, builder activity-date reads, previous-learning grouping reads and replacement-settings JSON. Required native narrow membership/retained-quiz reconciliation still uses the established helper; no full native activity bodies are fetched.
- Upcoming expansion preserves canonical replacement completion before choosing assignment links. It skips cover and programme metric reads. The existing canonical initial hour/count calculations and selected-module action gates are unchanged.

These are source- and mock-verified removals; PostgreSQL query plans, SQL timing, production query counts and HTTP latency were not measured.

## Search and request behavior

Module names filter locally immediately. Activity names use GET `/learner_api/my-learning/{kind}/{id}/search/?q=...&offset=0` after 300 ms without typing. Superseding queries, learner switches, clearing and unmount cancel the previous request. Late results cannot replace the current learner/query. Responses contain `{ "matches": [{ "id": "current:M1" }], "nextOffset": null }`, with at most 50 module IDs per response; additional pages are fetched only when needed. Terms are capped at 200 characters server-side; invalid offsets return 400. Errors remain visible with a retry action. No new global cache was added.

Catalogue search/filter/sort/layout retain the established component. Search matches individual titles, never strings spanning two activities. Both new GET routes retain `learner_self_or_staff`, journal-source routing, verified source/profile ownership and private/no-store responses. Historical membership exclusions are validated before SQL filtering. Foreign learners are rejected before projection.

Cold catalogue visits still make one initial learning-data read, plus the pre-existing independent certificate configuration read. Search reads occur only for a settled nonempty query. GET `/learner_api/my-learning/{kind}/{id}/upcoming/` loads expanded upcoming links only when View all is selected and uses the existing authenticated read cache/invalidation. Scoped module reads and cache/mutation behavior remain intact.

## Actual synthetic initial contract

The complete exact shared fixture is `frontend/src/test/myLearningFixtures.json`, generated by the actual backend projections with mocked readers. Below is its complete catalogue object, not learner 265 data.

```json
{
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
      "nextTitle": "C2",
      "finalTestPassed": false,
      "planModule": {
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "tutor_name": "Example tutor",
        "total_otjh": 10,
        "educational_session_count": 2,
        "programme_name": null,
        "cohort_name": null,
        "group_name": null
      },
      "actualHours": 0,
      "cover": null
    },
    {
      "id": "current:M1",
      "title": "Example module",
      "source": "current",
      "activityCount": 2,
      "completedActivityCount": 1,
      "progress": 50.0,
      "status": "In progress",
      "nextTitle": "Final test",
      "finalTestPassed": false,
      "planModule": {
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "tutor_name": "Example tutor",
        "total_otjh": 10,
        "educational_session_count": 2,
        "programme_name": null,
        "cohort_name": null,
        "group_name": null
      },
      "actualHours": 1.0,
      "cover": "https://assets.example.test/cover.png"
    },
    {
      "id": "legacy:50",
      "title": "Previous course",
      "source": "legacy",
      "moduleId": null,
      "activityCount": 4,
      "completedActivityCount": 2,
      "progress": 50.0,
      "status": "In progress",
      "nextTitle": "Previous material 2",
      "finalTestPassed": false,
      "planModule": null,
      "actualHours": 2,
      "cover": null
    }
  ],
  "otjh": {
    "actual": 3.0,
    "planned": 20.0
  },
  "upcoming": [],
  "hasMoreUpcoming": false
}
```

## Fixture sizes

Measured with `json.dumps(payload, separators=(',', ':')).encode()` and `gzip.compress(raw, mtime=0)` on the same synthetic responses before/after this task:

| Response | Before raw | After raw | Before gzip | After gzip |
| --- | ---: | ---: | ---: | ---: |
| Catalogue: 2 current, 1 previous | 1868 | 1513 | 651 | 549 |
| Selected native module | 1358 | 1346 | 583 | 574 |
| Selected previous course | 3431 | 3419 | 836 | 826 |

Catalogue reduction: 19.0% raw, 15.7% gzip on this small fixture. Large real activity-title lists are absent from the new contract, but no real learner payload reduction or latency is claimed.

## Files changed in this continuation

Backend: `backend/learner_api/my_learning.py`, `backend/learner_api/urls.py`, `backend/learner_api/tests_my_learning_no_db.py`.
Frontend: `frontend/src/api/myLearning.ts`; `frontend/src/pages/learner/my-learning/{CompactModules.tsx,LearningCatalogue.tsx,learningSummary.ts,compactModules.test.tsx,studentActivity.test.tsx}`; `frontend/src/test/myLearningFixtures.json`.
Reports: this report and a superseding notice in the previous report. Other existing modified/untracked files were preserved.

## Validation

- Frontend: **508 passed, 46 files**:
  `npm --prefix frontend run test -- src/pages/learner/my-learning src/pages/workspace/learner/__tests__ src/api/__tests__/weeklyLearningContract.test.ts src/api/__tests__/weeklyMutations.test.ts src/hooks/__tests__/useWeeklyLearning.test.tsx src/hooks/__tests__/useWeeklyLearningWeek.test.tsx src/api/__tests__/learnerRead.test.ts src/api/__tests__/learnerOverview.test.ts src/hooks/__tests__/learnerNavigation.test.tsx --maxWorkers=2`.
- Focused UI run: **16 passed**: `npm --prefix frontend run test -- src/pages/learner/my-learning/compactModules.test.tsx --maxWorkers=2`.
- `npm --prefix frontend run type-check`: **PASS**, final frontend state. An earlier run overlapped fixture edits and failed on two old fixture fields; the final run passed after correction.
- `npm --prefix frontend run build`: **PASS**, 4185 modules transformed; dependency eval/chunk-size/plugin-timing warnings remain. No deployment.
- From frontend: `.\node_modules\.bin\eslint.cmd src/api/myLearning.ts src/pages/learner/my-learning/CompactModules.tsx src/pages/learner/my-learning/LearningCatalogue.tsx src/pages/learner/my-learning/learningSummary.ts src/pages/learner/my-learning/compactModules.test.tsx src/pages/learner/my-learning/studentActivity.test.tsx --report-unused-disable-directives --max-warnings 0`: **PASS**.
- Guarded backend: **111 passed**, using the runner below. SQLite engines were verified, all connection attempts prohibited before Django setup, no database setup/migrations or network validation.
- With `PYTHONPATH=backend`, `python -m unittest backend.learner_api.test_canonical_learning_no_db backend.learner_api.test_current_learning_no_db backend.learner_api.test_my_learning_cleanup_no_db`: **73 passed**.
- Separate process: `python -m unittest backend.learner_api.test_local_subject_content_no_db`: **21 passed**.
- `git diff --check`: **PASS**.
- Tests cover commercial/apprenticeship, current-only/legacy-only/mixed, correct canonical completion/hours/replacements, stable navigation, cache reuse/invalidation, saved progress after refresh failure, learner isolation, individual-title search, debounce/cancellation/stale responses, bounded pages, access denial, upcoming session/assignment actions and carried-completion suppression on expansion.
- Teams baseline and expanded checks: **NOT REQUIRED**. No listed Teams file or contract consumed by a listed file changed. Existing Teams services remain unchanged. Live Teams: **NOT RUN**.

Guarded runner, executed through a literal PowerShell here-string piped to `python -`:

```python
import os, sys, unittest
sys.path.insert(0, 'backend')
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['DJANGO_USE_SQLITE'] = 'true'
from django.conf import settings
assert all(db['ENGINE'] == 'django.db.backends.sqlite3'
           for db in settings.DATABASES.values())
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
    import django
    django.setup()
    result = unittest.TextTestRunner().run(
        unittest.defaultTestLoader.loadTestsFromNames(names))
sys.exit(not result.wasSuccessful())
```

## Remaining blockers and acceptance limits

PostgreSQL integration: **BLOCKED / NOT RUN**. This task prohibits database connections; the new PostgreSQL SELECTs have mock/structural tests, not execution against a real schema.
Browser visual/authenticated acceptance: **NOT RUN** in this continuation. Component/DOM tests validate behavior; pixel-identical appearance is not asserted. The referenced real learner 265 JSON/screenshots were not included in the available attachment, which contained only the implementation request.
Real HTTP latency, production SQL timing and the five-second target remain **UNMEASURED**. Review and safe acceptance validation remain outstanding; no release-readiness claim is made.
