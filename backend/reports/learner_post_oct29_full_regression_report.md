# Learner post-29 October full regression report

Date: 29 October 2026 (Africa/Cairo)  
Scope: local `LMS_v2` working tree and the pinned local Neon test runtime  
Verdict: **UNSTABLE**

## 1. Executive summary

The active local backend was proven to use the intended `lms_ideal_test` Neon branch, database and scoped role. It is not using the architecture or Production branch.

Eleven critical Learner read projections completed against the pinned database in a process forced to read-only mode. Calendar and Attendance still returned backend-generated HTTP 502 responses. Their current blockers are missing `SELECT` privileges for the runtime role, not a proxy outage:

- `Coach.coach_meeting_attendance` blocks Calendar outcome annotation and is also read by Attendance catch-up processing.
- `enrolment.Employers` blocks Attendance mode/manager resolution.
- `enrolment.Staff_users` is denied during optional coach-phone resolution; Header survives but logs a database error and omits the phone.

Two schema-compatibility defects were fixed in source before the privilege blockers were reached:

- Calendar no longer hydrates all legacy `Created_users` columns and no longer selects missing `Created_users." Status"`.
- Calendar profile resolution now uses the normalized canonical `programme_id` projection instead of selecting missing `Learner.learners.programme`.
- Attendance no longer selects missing `Created_users."Programme"`; it resolves the display name through the existing programme adapter.

No database, schema, learner data, Neon branch, external integration, commit or branch operation was performed. The running Django process uses `--noreload` and predates these source fixes; it must be restarted by the owner before they are active in the browser.

## 2. Runtime database verification

Evidence:

- Active backend: PID 22520, started 14:40:06 with `python -B run_lms_ideal_test_server.py` on `127.0.0.1:8000`.
- Frontend: Vite on `127.0.0.1:3000`.
- Launcher pins branch/database/role in `backend/run_lms_ideal_test_server.py:20-24` and validates both Django aliases in `backend/run_lms_ideal_test_server.py:187-220`.
- Independent sanitized verification returned:
  - branch ID `br-orange-shadow-abm8uwwe`
  - endpoint ID `ep-dawn-block-ab5vob3x`
  - database `neondb`
  - role `lms_local_runtime`
  - aliases `default`, `enrolment`, both on the same endpoint
  - scoped authentication writes and denied learner writes

Result: **runtime matches the expected local test branch**. The legacy values in `.env` do not win because the launcher injects and verifies the pinned URL before Django imports settings.

## 3. Complete Learner route inventory

The current inventory contains **77 request families**. Its source is the current React route/client chain, `backend/learner_api/urls.py:249-388`, `backend/login/urls.py:78-84`, and the earlier source-derived inventory in `backend/reports/learner_phase4k_request_coverage_and_optimisation.md:72-150`.

| IDs | Page / feature | Endpoint families |
|---|---|---|
| R01-R04 | Login and Home | `/login_api/me/`, learner summary, home summary, upcoming plan |
| R05-R12 | Dashboard | minimal header, weekly plan/week, overview, monthly, training/module, rewards |
| R13-R17 | Learner detail and activity | detail summary/content, metrics, student activity and selected media |
| R18-R20 | Training Plan | persisted plan and dashboard overview/learning/my-learning/contract |
| R21-R25 | My Learning | catalogue, search, upcoming, module and free courses |
| R26-R27 | Certificates | read/template/module and issue action |
| R28-R37 | Attendance and recovery | attendance, lectures, modes, meeting attendance, absence and catch-up |
| R38-R53 | Calendar and Reviews | calendar, review sessions/history/forms/artifacts, booking, availability and connections |
| R54-R58 | Evidence | current, historical, detail, download/open, upload/delete |
| R59-R60 | Support | ticket list/detail/create and attachments |
| R61-R62 | Progress state | progress transfer and module progress |
| R63-R68 | Quiz/content/reflection | quiz/reading/submit, timers, completion, reflection and AI actions |
| R69-R74 | Monthly/compliance | reports, statutory documents, personal learning and monthly logs |
| R75-R77 | Session/onboarding | results/media, subject covers/holidays and first/onboarding session |

The exact per-family methods and route shapes remain listed under R01-R77 in the cited Phase 4K report. Current frontend routes additionally expose learner home, week, my-learning, learning-plan, timeline, training-plan, quiz, video, component, modules, attendance, feedback, catch-up, absence, evidence, progress, monthly cycles, reviews, rewards, calendar, profile, support and messages in `frontend/src/router/config.tsx:572-873` and `frontend/src/router/studentWorkspaceRoutes.tsx`.

## 4. Coverage matrix

“Isolated 200” below is a direct execution of the real Django view against the pinned database with both connections forced read-only. It is not authenticated HTTP and therefore is not labelled VERIFIED WORKING.

| Page | Endpoint | HTTP status / evidence | Contract | Business logic | Runtime result |
|---|---|---|---|---|---|
| Login / identity | `GET /login_api/me/` | Real backend and proxy HTTP: 401 in 7-11 ms without a session | Correct unauth contract | 42 actual identity tests passed | BLOCKED (no authorised synthetic session) |
| Home gate | learner summary | Isolated 200, 0.835 s, compact identity keys present | Shape checked | Access-gate fields present | BLOCKED |
| Home | overview-week home summary | Isolated 200, 5.595 s | Required week/OTJH keys present | Not parity-proven end-to-end | BLOCKED |
| Dashboard header | minimal header | Isolated 200, 4.432 s, 26 queries | Required card keys present | Optional coach phone denied | BLOCKED |
| Weekly Dashboard | weekly plan | Isolated 200, 16.526 s, 81 queries | Modules/weeks/selection present | 158 KB response; slow | BLOCKED |
| Monthly Dashboard | monthly v2 plan | Isolated 200, 42.912 s, 79 queries | v2 keys present | Exceeds normal UI tolerance | BLOCKED |
| Training Dashboard | training tab | Isolated 200, 18.823 s, 46 queries | Timeline/selection present | Slow | BLOCKED |
| Programme Overview | overview tab | Isolated 200, 24.984 s, 55 queries | Attendance/hours/metrics/modules present | Slow | BLOCKED |
| Training Plan overview | `section=overview` | Isolated 200, 17.491 s, 89 queries | Full plan keys present | 206 KB response; slow | BLOCKED |
| My Learning | catalogue | Isolated 200, 20.999 s | Modules/OTJH/upcoming present | Slow | BLOCKED |
| Progress / metrics | metrics | Isolated 200, 1.025 s, 5 queries | KSB/OTJH/programme keys present | Focused tests passed | BLOCKED |
| Student Activity | activity summary | Isolated 200, 0.993 s | Activity/source/total keys present | Focused tests passed | BLOCKED |
| Calendar / Reviews | calendar | 502 after source fixes | Contract not returned | `42501` on meeting attendance | VERIFIED FAILING |
| Attendance | lecture workspace | 502 after source projection fix | Contract not returned | `42501` on Employers; meeting attendance also denied | VERIFIED FAILING |
| My Learning search/upcoming/module | R22-R24 | Isolated suites only; harness drift exists | Focused frontend API tests pass | No authenticated runtime check | NOT TESTED |
| Module/week/component details | R07/R11/R14/R24 | Focused tests only | Targeted contract tests pass | No authorised browser session | NOT TESTED |
| Quiz detail/reading | R63 | Frontend and authorization tests only | Quiz ID/entitlement tests pass | No authenticated GET | NOT TESTED |
| Rewards | R12 | No safe runtime check | Not checked | Engagement grants not fully exercised | NOT TESTED |
| Evidence | R54-R57 GET | Runner blocked before combined suite | Not checked at runtime | Storage/open paths intentionally not called | NOT TESTED |
| First session/onboarding | R77 | Unauthenticated HTTP returned 401 | Auth boundary correct | No authenticated runtime check | BLOCKED |
| Certificates/documents/reports/logs | R26/R69-R74 reads | Source inventory only | Not checked | Not checked | NOT TESTED |
| Support/profile/messages/feedback | current frontend routes | Source inventory only | Not checked | Not checked | NOT TESTED |
| All POST/PATCH/DELETE, uploads and integrations | R27/R30/R32/R34/R36-R37/R42/R45/R47-R49/R53/R58/R60-R62/R64-R74 | Not executed by restriction | Isolated/mocked tests only where present | No shared Neon writes or external calls | NOT TESTED |

Coverage counts:

- Request families identified: **77**.
- Unique families exercised with real HTTP: **7**, but only the unauthenticated 401 boundary (14 requests: backend and Vite proxy); authenticated real HTTP: **0**.
- Critical read families exercised through the real Django view and pinned DB in read-only mode: **13**; 11 returned 200 and 2 returned 502.
- Functionally verified by isolated/runtime-direct checks only: **11**.
- Confirmed runtime failures: **2** families.
- Not functionally tested end-to-end: **64** families, including the 7 auth-boundary-only checks.

## 5. HTTP 500/502/503 findings

Confirmed:

1. Calendar source lookup originally raised `42703` for missing `Created_users." Status"`. The projection fix advanced the request past this error.
2. Calendar mirror lookup then raised `42703` for missing `Learner.learners.programme`. Canonical normalized profile reuse advanced the request past this error.
3. Calendar now returns 502 because `lms_local_runtime` has no `SELECT` on `Coach.coach_meeting_attendance`.
4. Attendance source lookup originally raised `42703` for missing `Created_users."Programme"`. The adapter fix advanced the request past this error.
5. Attendance now returns 502 because `lms_local_runtime` has no `SELECT` on `enrolment.Employers`. A caught denial also occurs on `Coach.coach_meeting_attendance`.
6. Header logs a caught `42501` on `enrolment.Staff_users`; the response remains 200 but coach phone data is unavailable.
7. `curriculum.learner_review_additions` is absent. Review generation catches `SchemaNotProvisioned` and continues, so manually added Curriculum Reviews can be missing without a page-level failure.

No proxy outage was found. The same unauthenticated requests returned 401 through port 8000 and through Vite on port 3000. The observed 502/503 bodies originate in Django error boundaries after database exceptions. No statement-timeout SQLSTATE or backend crash was observed in this pass.

## 6. Missing columns and permission errors

| Object | SQLSTATE | Effect | Status |
|---|---:|---|---|
| `Created_users." Status"` | 42703 | Calendar source load failed | Source fixed; restart required |
| `Created_users."Programme"` | 42703 | Attendance source load failed | Source fixed; restart required |
| `Learner.learners.programme` | 42703 | Calendar profile load failed | Source fixed; restart required |
| `Coach.coach_meeting_attendance` | 42501 | Calendar 502; attendance outcome reads fail | BLOCKED by no-DB-write restriction |
| `enrolment.Employers` | 42501 | Attendance 502 | BLOCKED by no-DB-write restriction |
| `enrolment.Staff_users` | 42501 | Header loses optional phone and logs an error | BLOCKED by no-DB-write restriction |
| `curriculum.learner_review_additions` | schema absent | Manual review additions omitted | BLOCKED by no-migration restriction |

## 7. Regression findings from 29 October changes

Confirmed exposure rather than wrong-branch selection:

- The normalized branch removed legacy display/status columns while unmanaged ORM models still describe them. Targeted projections and adapters introduced on 29 October fixed several paths, but Calendar and Attendance were missed.
- The runtime role manifest is incomplete for current Learner reads. This is independent of the source projection issue and explains the remaining 42501 failures.
- Recent changes did not alter the runtime database selection; the launcher overrides stale environment values and verifies both aliases.

Test drift found:

- The holiday test expected all future weeks to shift. The current authoritative scheduler explicitly keeps authored slots fixed and marks the holiday closure. The test was updated to the current business contract.
- Two Training Plan tests depended on a deleted `stored_training_plan` patch and a removed fixed-interval Review fallback. They were updated to use a Curriculum-generated occurrence.
- Several larger no-DB harnesses extract functions without their current imports/helpers. Their NameErrors are harness drift, not evidence that the imported runtime modules fail.

## 8. Confirmed fixes applied

1. `backend/learner_api/calendar.py:49-62,1573`
   - Added an explicit normalized source projection.
   - Reused canonical profile data so programme name comes from `programme_id`/Curriculum rather than the removed profile column.
2. `backend/learner_api/attendance_lectures.py:32-33,1252-1255`
   - Removed legacy `programme` from the ORM projection.
   - Applied the existing read-only programme-name adapter.
3. Regression coverage:
   - `backend/learner_api/test_historical_cross_role_routes.py:85-90`
   - `backend/learner_api/test_programme_reference_no_db.py:49`
   - `backend/learner_api/tests_attendance_lectures.py`
4. Stale regression expectations corrected:
   - `backend/learner_api/tests_builder_activity_dates.py:77`
   - `backend/learner_api/tests_training_plan_dashboard.py:395`

No permissions were granted and no schema was changed.

## 9. Response contract and business-logic validation

- Direct-view payloads were parsed as JSON and checked for expected top-level keys; no response body contained a serialization failure.
- Holiday semantics now match the scheduler contract: a holiday closes a delivery slot but does not move all authored weeks.
- Curriculum Review booking merge remains covered by a deterministic generated-occurrence fixture.
- Quiz entitlement, quiz ID handling and frontend failure/timeout behaviour passed 53 focused frontend tests.
- Identity selector tests using the imported current selector passed 42/42.
- Full parity for progress percentages, attendance calculations, KSB totals, monthly targets and historical data was not established end-to-end; those remain limited by the session, privilege and runner blockers.

## 10. Backend test results

Passed:

- 106/106 change-focused backend tests: Builder dates, Training Plan, training module, Attendance lookup, Calendar projection, and programme adapter.
- 42/42 current identity selector/login selector tests.
- Earlier focused runs: Builder dates 11/11; Training Plan 86/86.

Failed or blocked:

- Dashboard aggregate: 272 run, 265 passed, 7 stale-test failures (six obsolete Weekly mocks, one obsolete monthly fallback expectation).
- Login boundary aggregate: 40 run, 38 passed, two extracted-function NameErrors because the harness omitted `_profile_matches_canonical_identity`; current imported selector suite passed.
- My Learning aggregate: 221 run with 44 harness NameErrors from omitted imports/helpers; runtime My Learning returned isolated 200.
- Calendar/Attendance/Evidence aggregate could not create the SQLite database because schema-qualified models generate SQLite-incompatible DDL.
- No mutating PostgreSQL test runner was pointed at Neon.

## 11. Frontend test results

- Vitest: **53/53 passed** across `learnerContentLoading`, `learnerRead`, and learner quiz page tests.
- TypeScript: **failed** because `src/components/SupportChatWidget.tsx:18` cannot resolve `lottie-react` or its type declarations.
- Production build: transformed 4,241 modules, then **blocked** by Windows `EPERM` while Vite attempted to empty the locked `frontend/out/assets` directory. No source compile error was reported before that filesystem failure.

## 12. Actual HTTP and browser smoke results

- Real unauthenticated requests against ports 8000 and 3000 for `/login_api/me/`, header, weekly, monthly, Training Plan, My Learning and first-session all returned 401 in 7-14 ms. Authentication boundaries and proxy forwarding are alive.
- No authorised synthetic authenticated browser/session was available. Computer-use reported no controllable browser surfaces, so browser rendering/navigation is BLOCKED.
- No real credentials, sessions, learner writes, quiz attempts, attendance writes, evidence actions or external integrations were used.

## 13. Remaining failures

1. Grant the scoped runtime role read access to the three proven relations, then re-run Calendar and Attendance. This requires a separately authorised database change:
   - `Coach.coach_meeting_attendance`
   - `enrolment.Employers`
   - `enrolment.Staff_users`
2. Provision `curriculum.learner_review_additions` through the reviewed migration path if manual Review additions are required on this branch. This is forbidden in the present task.
3. Restart the pinned local backend so the source fixes are loaded; current PID 22520 uses `--noreload`.
4. Investigate the still-high read latency separately only after stability is restored. This task intentionally did not start another optimisation phase.

## 14. Untested routes and limitations

- No authenticated end-to-end page was available.
- All write, upload, signing, booking, Graph/Teams, Azure, SMTP and AI routes were intentionally not called.
- Binary media/PDF/storage routes were not exercised.
- Production and the architecture branch were not inspected or changed.
- Existing local server stdout was not captured to a file; errors above came from reproducible isolated direct-view execution.

## 15. Git diff summary

The working tree was already heavily modified and contains staged, unstaged and untracked contributor work from the performance phases. This task preserved it. The complete tree currently reports 61 tracked files changed in the unstaged diff plus existing staged/untracked reports/scripts. `git diff --check` passed.

Changes attributable to this pass are limited to the Calendar/Attendance compatibility fixes, their focused tests, the two stale-test corrections, and this report. No commit was created.

## 16. Final readiness verdict

**UNSTABLE**

Reason: two critical learner workflows (Calendar and Attendance) are reproducibly failing with backend 502 responses, and authenticated browser/HTTP verification is blocked. Eleven other critical read projections reached valid JSON against the correct database, but several are too slow for a reliable UI and isolated success is not end-to-end verification.

Minimum readiness gate: apply the reviewed read grants, provision or explicitly waive the missing review-additions schema, restart the pinned backend, then repeat authenticated HTTP/browser checks and the full coverage matrix without writes.
