# Phase 4P — Learner Functional and Runtime Stability Verification

Date: 29 October 2026 (Africa/Cairo)  
Branch: `fix/api-endpoints`  
Source revision: `371a8550` plus the preserved staged/unstaged working tree  
Final verdict: **UNSTABLE**

## 1. Executive Summary

The local runtime is connected to the intended test database, not Production or the architecture branch. The pinned launcher verified Neon branch `br-orange-shadow-abm8uwwe`, endpoint `ep-dawn-block-ab5vob3x`, database `neondb`, and role `lms_local_runtime` for both Django aliases. The final backend listener is the pinned launcher on port 8000; the frontend dev server is listening on port 3000.

Authenticated HTTP coverage expanded to **42 of the 77 request families**. Of those, 24 were fully working with the checked contract, four were partial/incomplete, and 14 had a failing or inaccessible runtime path. The remaining families were either write/external-effect routes deliberately blocked by the task restrictions or safe lazy routes not reached with a canonical fixture identity.

Four confirmed normalized-schema regressions were repaired and re-verified:

1. Meeting Attendance, Absence Reports and Review Sessions no longer hydrate removed `Created_users` compatibility columns.
2. The programme-start middleware no longer reads removed `Created_users.Programme`; Quiz Definition changed from HTTP 503 to HTTP 200.
3. Imported Review History no longer hydrates removed `Learner.learners.programme`; all three review categories changed from HTTP 503 to HTTP 200.
4. Calendar/onboarding/review form and calendar-connection ownership readers now use compatible source projections.

The release is still not ready. The most important remaining blocker is missing column-level `SELECT` on `Learner.learner_ksb_assignments`, which makes Learner Detail Summary, Component Detail and Quiz Context fail with SQLSTATE 42501 and HTTP 502. Other runtime-role gaps affect Free Courses, Historical Evidence, Support, Progress Transfer, Monthly Reports/Logs, Holidays, Calendar Connections and Feedback. Home Summary also exceeded the 45-second client timeout and completed server-side only after about 98 seconds.

No migration, schema change, permission change, Learner-data write, external integration call, branch change, commit or push was performed. All Phase 4P synthetic sessions were revoked; the final active-session count is zero.

## 2. Verified Runtime Identity

| Item | Final evidence |
|---|---|
| Git branch / revision | `fix/api-endpoints` / `371a8550`, dirty tree preserved |
| Backend | Port 8000, PID 23400 at final capture, `backend/.venv/Scripts/python.exe -B run_lms_ideal_test_server.py` |
| Frontend | Port 3000, PID 29204, local dev server |
| Neon branch | `br-orange-shadow-abm8uwwe` (`lms_ideal_test`) |
| Endpoint | `ep-dawn-block-ab5vob3x` |
| Database / role | `neondb` / `lms_local_runtime` |
| Django aliases | Exactly `default` and `enrolment`; both verified against the same branch, endpoint, database and role |
| Runtime write boundary | Auth/session writes scoped; Learner writes denied |
| External services | Graph, Teams, Azure, SMTP, AI, Redis and automatic jobs disabled by the pinned launcher |
| Synthetic cleanup | Zero active sessions whose user-agent begins `Phase4P-` |

The launcher performs the identity and privilege checks before importing Django (`backend/run_lms_ideal_test_server.py`). The final restart was limited to the verified pinned process; no unrelated process was terminated.

## 3. Page and API Coverage Matrix

Evidence codes: **AH** = authenticated HTTP against the running backend; **UT** = isolated unit/SimpleTestCase; **IT** = integration-style Django test with all database/external I/O mocked or local; **SI** = source inspection only. Expected authorization denials are shown separately from functional success.

| ID | Page | Endpoint | HTTP / evidence | Data completeness | Business logic | Verdict |
|---|---|---|---|---|---|---|
| R01 | Auth identity | `GET /login_api/me/` | AH 200, ~0.99s; anonymous 401 elsewhere | Identity object present | Session resolved and later revoked | VERIFIED WORKING |
| R02 | Home identity | `GET /learner-summary/{kind}/{id}/` | AH 200, ~1.29s | Full compact summary contract | Owner gate preserved | VERIFIED WORKING |
| R03 | Home summary | `GET /overview-week/.../?section=home-summary` | AH client timeout at 45s; server completed 200 in ~98.0s, 189 queries | Response arrived after client disconnected | Formula not disproved, but unusable latency | VERIFIED FAILING |
| R04 | Upcoming learning | `GET /training-plan-dashboard/.../?section=upcoming` | AH 200, ~3.79s | 10 events | Scheduling contract present | VERIFIED WORKING |
| R05 | Dashboard header | `GET /dashboard/.../header/minimal/` | AH 200, ~2.30s | Required header keys present | Existing fixed path retained | VERIFIED WORKING |
| R06 | Weekly initial | `GET /dashboard/.../weekly/plan/` | AH 200, 12.2–21.9s | Modules, weeks and selectedWeek present | 52-week/selection UTs exercised | VERIFIED WORKING |
| R07 | Weekly selected week | `GET .../weekly/plan/{weekId}/?moduleId=` | One AH probe used a non-canonical pair and returned 404; no valid pair available from `selectedWeek` | Not established | UT coverage only | NOT TESTED |
| R08 | Dashboard overview | `GET /dashboard/.../overview/` | AH 200, ~36.1s | Overview contract present | Dashboard UT coverage; very slow | VERIFIED WORKING |
| R09 | Dashboard monthly | `GET /dashboard/.../monthly/plan/` | AH 200, ~23.0s | Monthly payload present | Monthly tests cover planned/actual rules; five older assertions drift | VERIFIED WORKING |
| R10 | Dashboard training | `GET /dashboard/.../training/` | AH 200, ~11.7s | Training summary present | 48/48 training-plan tests passed | VERIFIED WORKING |
| R11 | Training module detail | `GET .../training/modules/{moduleId}/` | UT/SI only | Not runtime checked | Covered indirectly by training tests | NOT TESTED |
| R12 | Rewards summary | `GET /rewards-summary/{kind}/{id}/` | AH 200, ~0.65s | Summary keys present | Claim/write not executed | VERIFIED WORKING |
| R13 | Learner detail summary | `GET /learner-detail/.../?content=summary` | AH 502, ~2.38s | No detail payload | SQLSTATE 42501 on `Learner.learner_ksb_assignments` | VERIFIED FAILING |
| R14 | Component/reading/quiz context | `GET /learner-detail/.../?content=activity|reading|quiz` | AH component 502; cross-Learner 404 | Component contract unavailable | Same KSB privilege blocker | VERIFIED FAILING |
| R15 | Progress metrics | `GET /metrics/{kind}/{id}/` | AH 200, ~0.81s | Metrics contract present | Canonical metrics tests mostly pass; five visibility-string assertions drift | VERIFIED WORKING |
| R16 | Student activity | `GET /student-activity/{kind}/{id}/` | AH 200, ~0.84s | Contract present but activity/subjects empty for fixture | Empty result not proven correct | BLOCKED |
| R17 | Imported activity/media | Student-activity selection/file routes | SI; media/storage excluded | Not checked | External/file effects excluded | BLOCKED |
| R18 | Persisted Aptem plan | `GET /training-plan/{kind}/{id}/` | AH 404, ~0.28s | No plan payload | Fixture/route semantics unresolved | VERIFIED FAILING |
| R19 | Plan dashboard sections | `GET /training-plan-dashboard/.../?section=overview|learning|my-learning` | AH 200: ~23.1s / 2.36s / 29.8s | Section contracts present | 48/48 training-plan tests passed | VERIFIED WORKING |
| R20 | Training contract | `GET .../?section=contract` | AH 200, ~1.15s | Contract facts present | Read-only | VERIFIED WORKING |
| R21 | My Learning catalogue | `GET /my-learning/{kind}/{id}/` | AH 200, 22.0–34.4s | Learner/modules/summary/upcoming present | Canonical module path worked | VERIFIED WORKING |
| R22 | My Learning search | `GET .../search/?q=&offset=` | AH 200, ~0.99s | Empty matches with paging contract | Serial search contract | VERIFIED WORKING |
| R23 | Upcoming modules | `GET .../upcoming/` | AH 200, ~39.8s | 129 upcoming entries | Correct shape; very slow | VERIFIED WORKING |
| R24 | My Learning module | `GET .../modules/{subjectId}/` | AH 200, 16.2–21.9s | activity/detail/metadata/schedule/sessions present | Canonical subject ownership worked | VERIFIED WORKING |
| R25 | Free courses | `GET /free-courses/{kind}/{id}/` | AH 503, ~0.46s | None | Tables exist; runtime role cannot read them; schema gate mislabels this as missing schema | VERIFIED FAILING |
| R26 | Certificates | `GET /certificates/...` and template | AH 200, ~0.42–0.47s | Explicitly `configured: false`; no certificate | Correct for disabled local integration | VERIFIED WORKING |
| R27 | Certificate issue | `POST .../issue/` | UT/SI; no write performed | N/A | Write endpoint excluded | BLOCKED |
| R28 | Attendance summary | `GET /attendance/{kind}/{id}/` | AH 200, ~20.9s | Attendance contract present | Existing aggregates retained | VERIFIED WORKING |
| R29 | Attendance lectures | `GET .../lectures/` | AH 200, ~21.8s | 142 lectures | Attendance/session tests passed | VERIFIED WORKING |
| R30 | Confirm lecture attendance | `POST .../attend/` | UT only | N/A | Learner write excluded | BLOCKED |
| R31 | Attendance-mode metadata | `GET /attendance-mode/` | AH 403 | No metadata for learner role | Route appears staff/admin restricted; frontend applicability unresolved | BLOCKED |
| R32 | Save attendance mode | `POST .../mode/` | UT only | N/A | Learner write excluded | BLOCKED |
| R33 | Meeting attendance | `GET /meeting-attendance/.../` | AH 200 after fix, ~3.65s; anonymous 401/cross 404 | 19 sessions | 83-test batch includes meeting rules | FIXED AND RE-VERIFIED |
| R34 | Confirm meeting attendance | `POST .../attend/` | UT only | N/A | Write excluded | BLOCKED |
| R35 | Absence reports | `GET /absence-reports/.../` | AH 200 after fix, ~20.7s | 13 reports and 127 missed sessions | Absence workflow tests passed | FIXED AND RE-VERIFIED |
| R36 | Create absence report | `POST /absence-reports/.../` | UT only | N/A | Write/upload excluded | BLOCKED |
| R37 | Catch-up booking/link | `POST /session-catchup/.../` | SI/UT | N/A | Calendar/write effects excluded | BLOCKED |
| R38 | Calendar | `GET /calendar/{kind}/{id}/` | AH 200, ~15.6s | 272 events, but manual additions silently unavailable | Core calendar works; review-addition permission gap remains | BLOCKED |
| R39 | Review sessions | `GET /review-sessions/.../?content=summary|full` | AH 200 after fix, ~2.05s; anonymous 401/cross 404 | 45 events | Ownership and summary/full tests pass | FIXED AND RE-VERIFIED |
| R40 | Imported review history | `GET /review-history/.../?category=` | AH after fix: all 3 categories 200 in 0.93–1.34s | Correct contract; zero rows for this fixture | Identity bridge preserved | FIXED AND RE-VERIFIED |
| R41 | Selected curriculum review | `GET .../events/{key}/review/` | UT/SI | Not runtime checked | Read route only | NOT TESTED |
| R42 | Review save/sign | Review POST/sign routes | UT only | N/A | Writes/signatures excluded | BLOCKED |
| R43 | Meeting artifacts/content | Artifact GET routes | SI | Not checked | Storage/recording access excluded | BLOCKED |
| R44 | Migrated review party | `GET /migrated-reviews/{id}/party` | UT/SI | Not runtime checked | Ownership tests only | NOT TESTED |
| R45 | Migrated answers/signature/PSP | POST routes | UT only | N/A | Writes excluded | BLOCKED |
| R46 | Review PDFs/revisions | PDF routes | SI | Not checked | Binary generation excluded | BLOCKED |
| R47 | Calendar book | `POST .../book/` | SI/UT | N/A | Graph/DB write excluded | BLOCKED |
| R48 | Calendar reschedule | `PATCH .../reschedule/` | SI/UT | N/A | Graph/DB write excluded | BLOCKED |
| R49 | Calendar cancel | `POST .../cancel/` | SI/UT | N/A | External/write effect excluded | BLOCKED |
| R50 | Coach availability | `GET .../coach-availability/` | SI | Not checked | Could contact calendar provider | BLOCKED |
| R51 | Calendar connections | `GET /calendar-connections/.../` | AH 503 after ownership projection fixed prior 500 | None | `Learner.calendar_connections` SELECT absent | VERIFIED FAILING |
| R52 | Personal availability | Availability GET | SI | Not checked | External provider excluded | BLOCKED |
| R53 | Calendar OAuth/connect | OAuth/connect/disconnect | SI | N/A | Credentials/external writes excluded | BLOCKED |
| R54 | Current evidence | `GET /evidence/{kind}/{id}/` | AH 200, ~0.44s | 22 items | Metadata-only route | VERIFIED WORKING |
| R55 | Historical evidence | `GET .../historical/` | AH 503, ~0.39s | None | Runtime role lacks `USAGE` on `LMS` schema | VERIFIED FAILING |
| R56 | Historical evidence detail | `GET .../historical/{source}/{id}/` | SI/UT | Not runtime checked | Metadata route | NOT TESTED |
| R57 | Evidence open/download | URL-generation routes | SI | Not checked | Azure/SAS disabled | BLOCKED |
| R58 | Evidence upload/delete | POST/DELETE routes | UT only | N/A | Storage/database writes excluded | BLOCKED |
| R59 | Support | `GET /support/tickets/` | AH 503, ~0.34s | None | `Learner.support_tickets` SELECT absent | VERIFIED FAILING |
| R60 | Ticket create/attachments | Mixed routes | UT/SI | Not checked | Writes/storage excluded | BLOCKED |
| R61 | Progress transfer | `GET /progress-transfer/.../` | AH 503, ~1.33s | None | `progress_transfer_items` SELECT absent; POST not executed | VERIFIED FAILING |
| R62 | Module progress | GET/POST route | UT/SI | Not runtime checked | Same route can write | BLOCKED |
| R63 | Quiz detail/reading | `GET /quizzes/{id}/`; learner quiz context | AH quiz definition fixed to 200, 3.84s; anonymous 401/cross 404; context remains 502 | Definition/questions present; contextual progress unavailable | Entitlement/ownership tests 15/15; KSB permission blocks context | BLOCKED |
| R64 | Quiz submit | `POST .../submit/` | UT only | N/A | Attempt/progress write excluded | BLOCKED |
| R65 | Time tracking | POST start/checkpoint/clock | UT/SI | N/A | Writes excluded | BLOCKED |
| R66 | Component/video completion | Completion POST routes | UT only | N/A | Progress writes excluded | BLOCKED |
| R67 | Reflection submissions | GET/POST | UT/SI | Not runtime checked | Save/submit may write | BLOCKED |
| R68 | Reflection/assignment AI | AI POST routes | SI | N/A | Paid/external services disabled | BLOCKED |
| R69 | Monthly reports | `GET /monthly-reports/.../` | AH 502, ~0.35s | None | `Learner.learner_monthly_reports` SELECT absent | VERIFIED FAILING |
| R70 | Statutory documents | Agreement/ILR/training-plan documents | UT/SI | Not runtime checked | Read route only | NOT TESTED |
| R71 | Document issue/sign | POST routes | UT only | N/A | Immutable/signature writes excluded | BLOCKED |
| R72 | Personal learning | `GET /personal-learning/courses/` | AH 403, ~0.20s | None | Learner-page/role applicability unresolved; POST/verify excluded | BLOCKED |
| R73 | Monthly logs | `GET /monthly-logs/.../` | AH 503, ~1.85s | None | `Learner.learner_monthly_locks` SELECT absent | VERIFIED FAILING |
| R74 | Monthly log sign/complete/unlock | POST routes | UT only | N/A | Writes excluded | BLOCKED |
| R75 | Session results/media | Session/artifact routes | SI/UT | Not checked | Join/recording/storage path excluded | BLOCKED |
| R76 | Subject covers/holidays | Subject covers and `GET /working-hours/holidays/` | AH holidays 503, ~0.47s; subject covers not isolated | None for holidays | Curriculum holiday table SELECT absent | VERIFIED FAILING |
| R77 | First session/onboarding | `GET /calendar/.../first-session|onboarding-reviews/` | AH 200 after projection fixes, ~0.64–3.23s | First-session `caseOwner` can be null because broader Staff query lacks privilege | Core gate works; optional staff detail incomplete | BLOCKED |

Additional implemented pages outside the R01–R77 table:

- Feedback `GET /engagement_api/feedback/my-forms/`: HTTP 500 because the runtime role has no `USAGE` on schema `Feedback`. Source inspection also shows the GET can invoke synchronization with `select_for_update`; it was not changed to a fabricated empty success.
- Profile photo/storage: HTTP 503 because storage integrations are intentionally disabled by the local launcher.

## 4. HTTP 500/502/503 Findings

| Failure | Root cause | State |
|---|---|---|
| Learner Detail/Component/Quiz Context 502 | SQLSTATE 42501, last failing SELECT reads `Learner.learner_ksb_assignments` | OPEN, critical |
| Quiz Definition 503 | Programme-start middleware selected removed `Created_users.Programme` | FIXED; AH 200 |
| Review History 503 | Shared review resolver broadly hydrated removed `Learner.learners.programme` | FIXED; 3/3 categories AH 200 |
| Meeting/Absence/Review Sessions 502/503 | Broad source hydration selected removed `Created_users." Status"`/`Programme` | FIXED; AH 200 |
| Free Courses 503 | Tables exist but runtime role has no SELECT; information-schema gate reports them as missing | OPEN |
| Calendar Connections 503 | `Learner.calendar_connections` SELECT absent | OPEN |
| Historical Evidence 503 | `LMS` schema USAGE absent | OPEN |
| Support 503 | `Learner.support_tickets` SELECT absent | OPEN |
| Progress Transfer 503 | `Learner.progress_transfer_items` SELECT absent | OPEN |
| Monthly Reports 502 | `Learner.learner_monthly_reports` SELECT absent | OPEN |
| Monthly Logs 503 | `Learner.learner_monthly_locks` SELECT absent | OPEN |
| Holidays 503 | Curriculum holiday-table SELECT absent | OPEN |
| Feedback 500 | `Feedback` schema USAGE absent; GET is not strictly read-only | OPEN |
| Home Summary timeout | 189 queries, ~92.4s database time, ~98.0s server duration | OPEN, critical performance/runtime failure |

No observed 502/503 in this run was a reverse-proxy outage. Each investigated case resolved to a SQL compatibility, privilege or deliberate local-integration boundary.

## 5. Data Completeness Findings

- Calendar returns HTTP 200 but calls the manual Review-addition reader, which catches its privilege failure and substitutes an empty list. This is a confirmed silent omission path.
- The table currently contained zero rows when inspected with the approved read-only owner path earlier in this phase, so no current fixture row was lost; the feature is nevertheless incomplete for future coach-created additions.
- First-session/onboarding payloads can omit `caseOwner` details because only a narrow Staff projection is granted and another reader still requests broader fields.
- Student Activity returned a valid contract with empty activities/subjects. The test fixture may legitimately have no projected activity, so this is marked incomplete/unverified rather than a confirmed defect.
- Certificate endpoints explicitly returned `configured: false`, which is correct under the disabled local integration and is not classified as missing data.

## 6. Review Additions Permission Analysis

`curriculum.learner_review_additions` exists on `lms_ideal_test`. The runtime role has neither table-level nor column-level SELECT. The learner calendar needs exactly these columns, now explicitly projected at `backend/curriculum_api/review_instances.py:88` and `:533`:

`id`, `review_template_id`, `programme_id`, `learner_id`, `target_date`, `reason_code`, `reason`, `deleted_at`.

Prepared minimum grant (not executed):

```sql
GRANT SELECT (
  id, review_template_id, programme_id, learner_id,
  target_date, reason_code, reason, deleted_at
)
ON TABLE curriculum.learner_review_additions
TO lms_local_runtime;
```

No INSERT, UPDATE, DELETE, CREATE, ownership or table-wide privilege is required for the Learner read. Explicit approval remains required before executing this grant.

The false “missing table” message comes from schema-gate use of `information_schema.tables`, which hides relations from roles with no privilege. That diagnostic should eventually distinguish “relation absent” from “relation present but inaccessible.”

## 7. Schema Compatibility

Read-only introspection confirmed:

- `enrolment."Created_users"` on this branch uses normalized `programme_id`; legacy `Programme` is absent.
- The optional legacy field mapped as `Status` (the ORM mapping historically includes a leading-space variant) is absent.
- `Learner.learners` has exactly one ORM-mapped column missing from the physical schema: `programme`; normalized `programme_id` is the source of truth.

Compatibility fixes use narrow projections plus the existing read-only programme adapter. They do not remove response fields:

- Profile programme projection: `backend/learner_api/learner_detail.py:212-256`.
- Meeting/absence/review source projections: `backend/learner_api/meeting_attendance.py:103`, `absence_reports.py:103`, `review_sessions.py:30`.
- Review form and onboarding readers: `backend/learner_api/review_form.py:347,669,752`, `calendar.py:2700`.
- Calendar-connection ownership projection: `backend/learner_api/calendar_connections.py:136`.
- Programme-start gate: `backend/learner_api/programme_access.py:121-126`.
- Imported review profile resolver: `backend/coach_api/review_sources.py:99-116`.

Legacy mappings remain in unmanaged models for compatibility with older deployed schemas. Therefore, any remaining broad `.all()`/`.first()` hydration of these models is still a risk and must be checked route-by-route rather than deleting the model fields globally.

## 8. Business Logic Parity

- Training Plan: 48/48 isolated tests passed, including schedule, module and section behavior.
- Header: 29/29 isolated tests passed.
- Quiz ownership/entitlement: 15/15 isolated tests passed; authenticated HTTP confirmed owner 200, anonymous 401 and cross-Learner 404 for the quiz-definition route.
- Programme-start rules: included in the 54/54 focused pass after the normalized source fix.
- Absence, Meeting Attendance, Progress Transfer, Monthly Reports, Support and Holiday rules: 83/83 isolated tests passed. Their current live failures are privilege/runtime availability, not a proven formula change.
- Review history/identity: 29/29 focused tests passed after the projection fix; all three authenticated HTTP categories returned the expected contract.
- The broader 321-test backend invocation did not pass: five metrics assertions expect an older soft-delete SQL string, and six Weekly tests patch a symbol no longer exported by `dashboard_weekly`. These are concrete old-harness drift items, not evidence that the runtime formulas are correct. They remain unresolved.

No test wrote progress, quiz attempts, attendance, evidence, reviews, training plans or Learner profile data to Neon.

## 9. Confirmed Fixes

1. `curriculum_api/review_instances.py`: replaced `SELECT *` with the eight-column Learner Review-addition projection; added `curriculum_api/test_review_additions_projection_no_db.py`.
2. `learner_api/learner_detail.py`: excluded removed profile `programme` from ORM hydration and restores the established string contract from the already-resolved source; added `test_learner_profile_programme_projection_no_db.py`.
3. `learner_api/meeting_attendance.py`, `absence_reports.py`, `review_sessions.py`, `review_form.py`, `calendar.py`, `calendar_connections.py`: narrow normalized source/ownership reads; added `test_normalized_source_projection_no_db.py` and updated affected harnesses.
4. `learner_api/programme_access.py`: removed the obsolete programme column from the start-gate projection and invokes the read-only adapter; Quiz Definition re-verified at HTTP 200.
5. `coach_api/review_sources.py`: excludes `Learner.learners.programme` when resolving imported Review identity and preserves the profile attribute without another query; Review History re-verified at HTTP 200 for all categories.

All changes are unstaged/working-tree changes mixed with pre-existing contributor work; no commit was created.

## 10. Backend Tests

| Command/scope | Result |
|---|---|
| Focused normalized projections + programme gate + detail/review harnesses | 54/54 PASS |
| Progress transfer, monthly reports, support, holidays, absence workflow, meeting attendance | 83/83 PASS |
| Focused review identity/history/session/projection tests | 29/29 PASS |
| Training Plan Dashboard | 48/48 PASS |
| Dashboard Header | 29/29 PASS |
| Quiz authorization | 15/15 PASS |
| Broad dashboard/weekly/metrics command | 321 tests executed; FAIL with 5 metrics assertion failures and 6 Weekly harness errors |
| Full ReviewSourceSeparation class | Two unrelated date-window failures plus the now-fixed projection assertion; focused projection test passes |
| `git diff --check` | PASS |

All listed backend test runs used `DJANGO_USE_SQLITE=1` and selected SimpleTestCase/no-DB suites; no migrations or Neon test-data setup ran.

## 11. Frontend Tests

- Focused learner request graph/API/Quiz suite: **4 files, 82/82 tests PASS**.
- Full `npm run test:learner`: **NOT COMPLETED**. It exposed failures across Home, My Learning, Reviews, Rewards, Clubs and other pages, plus jsdom canvas/scroll warnings. A Vitest worker then exhausted the approximately 4 GB Node heap and the runner did not terminate; only that test session was stopped. No final pass/fail count is claimed.
- `npm run type-check`: **FAIL** at `src/components/SupportChatWidget.tsx:18` because TypeScript cannot resolve `lottie-react` or its declarations, despite the dependency being declared in `package.json`.
- Frontend build: **NOT RUN** in this phase. The previously observed Windows `EPERM` issue under `frontend/out/assets` was not “fixed” by deleting generated files.
- Teams baseline: **NOT REQUIRED** — no file in the AGENTS.md Teams trigger list was edited.

## 12. HTTP and Browser Results

Authenticated requests used only short-lived synthetic server-side sessions created through the approved auth-session workflow. Every created session was revoked in a `finally` block; final verification found zero active Phase 4P sessions. No real password or real browser session was used.

Browser rendering was **NOT RUN**. The visible browser contained an existing user session; attaching the synthetic token to that browser would have risked mixing identities and violated the approved synthetic-session boundary. Therefore UI loading, visual error boundaries, navigation and retry-loop behavior are not claimed as browser-verified. Frontend evidence is limited to the focused Vitest suite and source inspection.

## 13. Outstanding Failures and Blockers

Critical:

1. Grant review is needed for the exact columns read from `Learner.learner_ksb_assignments`; until then Progress, Component and Quiz-context pages remain broken.
2. Home Summary is not operational at normal client timeout: ~98 seconds server-side.
3. Several learner pages still fail because the scoped runtime role lacks narrowly required reads.

High:

4. Calendar silently omits manual Review additions until the prepared eight-column grant is approved and applied.
5. Feedback cannot load and its GET path appears capable of synchronization/write behavior; it needs a separate read-contract review, not only a privilege grant.
6. Historical Evidence requires a reviewed decision about access to the legacy `LMS` schema.

Medium:

7. First-session `caseOwner` data is incomplete because the Staff projection/privilege contract is inconsistent.
8. Selected-week runtime verification needs the frontend’s canonical module/week pair rather than a generic object scan.
9. Full frontend regression is blocked by OOM, existing failures and the unresolved `lottie-react` type-resolution problem.
10. Old backend harness drift must be updated before the broad suite can be used as a release gate.

## 14. Performance Observations Only

This phase did not optimize performance. Observed authenticated HTTP times nevertheless show serious stability risk:

- Home Summary: ~98.0s server, client timeout at 45s.
- My Learning: 22.0–34.4s.
- Upcoming Modules: ~39.8s.
- Dashboard Overview: ~36.1s.
- Monthly: ~23.0s.
- Weekly: 12.2–21.9s.
- Attendance/Absence: ~20.7–21.8s.

These are single local samples, not percentiles. They are sufficient to reject a “stable” verdict but not to select another optimization design in Phase 4P.

## 15. Recommended Next Actions

1. Review and approve only the minimum column-level `SELECT` required by the learner KSB reader, then retest R13/R14/R63 with owner, anonymous and cross-Learner cases.
2. Separately approve or reject the prepared eight-column grant for `curriculum.learner_review_additions`; immediately verify the privilege and Calendar completeness after any execution.
3. Produce a reviewed least-privilege matrix for the remaining failing relations/schemas. Do not grant broad schema/table access merely to clear 503s.
4. Diagnose Home Summary’s 189-query request before any further broad optimization phase.
5. Split the frontend learner suite into bounded workers/files, resolve the known test failures and `lottie-react` installation/type state, then run a clean final suite.
6. Run controlled browser navigation only after a browser-safe synthetic-session injection/cleanup mechanism is explicitly approved.

## 16. Final Readiness Verdict

**UNSTABLE — NO-GO for release acceptance.**

The runtime identity is correct and several schema regressions are now fixed, but critical Learner pages still return 502/503, Calendar can silently omit business data, Home Summary exceeds the client timeout, and complete frontend/browser verification is unavailable. The current evidence supports continued targeted reliability repair, not a declaration of stability and not another general performance-optimization phase.
