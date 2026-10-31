# Phase 4K — Learner Request Coverage and Remaining Performance Optimisation

Date: 2026-10-28 (Africa/Cairo)  
Branch/workspace: current `fix/api-endpoints` checkout  
Measurement boundary: guarded read-only Django service/SQL measurements; **no HTTP or browser latency measurement**

## A. Verdict

**OPTIMISED AND VERIFIED** at the Django service boundary.

The highest-impact safely reproducible unresolved read was the default Learner
Metrics request.  Its Phase 4I projection still loaded dashboard-only source
metadata and journal-route bodies before calculating a small metrics response.
Phase 4K adds a Metrics-only canonical projection while preserving the broader
Dashboard projection and the progress-transfer frozen-record path.

Across four real anonymised history shapes and 20 alternating samples per
variant, response equality held for every pair.  For the largest available
eligible shape (2,790 progress rows), service median improved from
**3,141.655 ms to 2,623.502 ms (-16.5%)**, service p95 from **4,498.677 ms to
3,364.535 ms (-25.2%)**, and peak traced allocation from **32,747,256 to
24,652,557 bytes (-24.7%)**.  Query count remained three.  These are not HTTP
p50/p95 claims.

## B. Request Coverage Summary

Current source inspection found **77 Learner request families** used by Learner
pages or their interaction flows.  A family consolidates only the same route
shape with different parameters (for example, selected week IDs); method or
side-effect differences are shown explicitly.  Staff/admin-only routes in the
same Django URL module are not counted as Learner-facing requests.

Coverage summary:

| Classification | Families | Meaning in this report |
|---|---:|---|
| OPTIMISED AND MEASURED | 6 | Equivalent SQL/Python/service measurement exists; this does **not** mean HTTP verified |
| MEASURED, NOT OPTIMISED | 2 | Historical/current measurement exists but no retained request-specific fix |
| OPTIMISED, NOT END-TO-END VERIFIED | 3 | Focused optimisation/tests exist but no complete request measurement |
| NOT MEASURED | 33 | Source and contract discovered; no comparable timing baseline |
| UNSAFE TO PROFILE DIRECTLY | 32 | Writes, storage, PDF/media, AI, calendar/Teams or other external side effects |
| NOT APPLICABLE | 1 | Authentication bootstrap is a dependency, not a Learner API optimisation target |

No authenticated HTTP latency was collected in Phase 4K.  Previous SQL,
service and synthetic evidence is labelled as such below.

## C. Coverage Matrix

Common trace: Learner pages call the listed client/hook under
`frontend/src/api`, which reaches `backend/learner_api/urls.py`; learner-scoped
views use `learner_self_or_staff` or an equivalent server-side ownership gate
before their service/selectors.  Canonical learning reads primarily use
`learner_progress_entries`, KSB, reporting-segment, source, journal and
historical-component relations.  Calendar/review, evidence and document rows
use their named services and stores.  “Unknown” means not measured, not zero.

Source-validated critical chains:

| Page | Component/hook → API client | Route → view → principal read |
|---|---|---|
| Home | `home/page.tsx` → `useLearnerSummaryParam` → `fetchLearnerSummary`; then `homeSummary` and `upcomingSchedule` | learner summary → `learner_detail`; home summary → `overview_week`; upcoming → `training_plan_dashboard` |
| Dashboard | workspace `page.tsx` → `useDashboardHeader`; default `DashboardTabs` → `useWeeklyLearning` | minimal header → `dashboard_header`; weekly plan → `dashboard_weekly` → canonical/profile/plan selectors |
| Weekly Learning | `WeeklyLearningPlan` → `useWeeklyLearning` / selected-week reader | weekly plan routes → `dashboard_weekly` → week/module/component and progress selectors |
| Training Plan | `DashboardTrainingPlan` / plan views → `learnerOverview` or `trainingPlanDashboard` clients | training-plan-dashboard route → sectioned `training_plan_dashboard` selectors |
| My Learning | `my-learning/page.tsx` → `useMyLearning` → `myLearningCatalogue`; `CompactModules` triggers search/detail/upcoming | `my_learning` routes → canonical catalogue + curriculum/source selectors |
| Progress | `progress/page.tsx` → `useLearnerMetrics` and `usePrefetchStudentActivity`; summary uses `useLearnerDetailParam` | Metrics → `dashboard_metrics` → `canonical_learning.metrics`; activity → `student_activity` |
| Attendance | `attendance/page.tsx` → `useLearnerAttendance`, `learningSchedule`, attendance lecture client | attendance/lecture routes → attendance selectors; confirmation routes write separately |
| Evidence | `evidence/page.tsx` → detail hook + `fetchEvidence` + `fetchHistoricalEvidence` | evidence metadata views → database selectors; open/download branches cross into storage |
| Reviews | Reviews/Monthly Coaching components → `useReviewSessions`, `reviewHistory`, `learnerCalendar` | review/calendar views → stored events, definitions and instances; sign/PDF/artifact branches remain separate |
| Calendar | `calendar/page.tsx` → `fetchLearnerCalendarEvents` and connection/availability clients | `calendar` and `calendar_connections`; booking/availability may cross external providers |

| ID | Page / frontend client | Endpoint and method | Initial / lazy dependency | Backend handler / main access | Queries | Evidence | Status | Priority |
|---|---|---|---|---|---:|---|---|---|
| R01 | All Learner routes / auth | `GET /login_api/me/` | Initial auth dependency | Login session/identity selectors | Unknown | Source waterfall only | NOT APPLICABLE | Gate |
| R02 | Home/navigation / `learnerDetail` | `GET /learner_api/learner-summary/{kind}/{id}/` | Initial gate | `learner_detail.learner_summary`; compact identity/plan | Unknown | Phase 4B synthetic reuse, Phase 4D SQL | OPTIMISED, NOT END-TO-END VERIFIED | P0 |
| R03 | Home / `learnerOverview` | `GET /overview-week/{kind}/{id}/?section=home-summary` | Initial after R02, parallel with R04 | `overview_week`; summary projections | Unknown | Source-safe classification | NOT MEASURED | P0 |
| R04 | Home / `learnerOverview` | `GET /training-plan-dashboard/{kind}/{id}/?section=upcoming` | Initial after R02 | `training_plan_dashboard`; upcoming plan/events | Unknown | Source-safe classification | NOT MEASURED | P0 |
| R05 | Dashboard / `dashboardHeader` | `GET /dashboard/{kind}/{id}/header/minimal/` | First protected Dashboard read | `dashboard_header`; profile, next cards | 8 after 4J | Phase 4J 20x service | OPTIMISED AND MEASURED | P0 |
| R06 | Dashboard/Weekly / `weeklyLearning` | `GET /dashboard/{kind}/{id}/weekly/plan/` | Default after R05 | `dashboard_weekly`; weekly spine + selected detail | 7 after 4J | Phase 4J empty-plan 20x; older rich timings | OPTIMISED AND MEASURED | P0 |
| R07 | Weekly / `weeklyLearning` | `GET /dashboard/{kind}/{id}/weekly/plan/{weekId}/?moduleId=...` | Navigation/adjacent prefetch | `dashboard_weekly`; selected week | Unknown | Historical representative projection only | MEASURED, NOT OPTIMISED | P1 |
| R08 | Dashboard Overview / `dashboardTabs` | `GET /dashboard/{kind}/{id}/overview/` | Lazy visited tab | `dashboard_tabs`; canonical overview/attendance | Unknown | Source only | NOT MEASURED | P1 |
| R09 | Dashboard Monthly / `dashboardMonthly` | `GET /dashboard/{kind}/{id}/monthly/plan/?month=...` | Lazy active tab | `dashboard_tabs`; monthly plan | Unknown | Source only | NOT MEASURED | P1 |
| R10 | Dashboard Training / `dashboardTraining` | `GET /dashboard/{kind}/{id}/training/?subject=...` | Lazy active tab | `dashboard_tabs`/`dashboard_training`; training summary | Unknown | Source only | NOT MEASURED | P1 |
| R11 | Dashboard Training module | `GET /dashboard/{kind}/{id}/training/modules/{moduleId}/` | Selection-only | `training_module`; one module graph | Unknown | Source only | NOT MEASURED | P2 |
| R12 | Dashboard Rewards / `learnerRewards` | `GET /rewards-summary/{kind}/{id}/` | Lazy Rewards tab | `rewards_summary`; engagement-backed summary | Unknown | No safe Reader coverage of Engagement | NOT MEASURED | P2 |
| R13 | Progress/plan / `learnerDetail` | `GET /learner-detail/{kind}/{id}/?content=summary` | Initial on several pages | `learner_detail`; read-only graph/prefetch | changed SELECT 1 | Phase 4H 20x service/SQL | OPTIMISED AND MEASURED | P0 |
| R14 | Courses/activity / `learnerDetail` | `GET /learner-detail/{kind}/{id}/?content=activity|reading|quiz&component_id=...` | Selected content | `learner_detail`; owned component graph | Unknown | Phase 4H contract tests | OPTIMISED, NOT END-TO-END VERIFIED | P1 |
| R15 | Progress / `learnerMetrics` | `GET /metrics/{kind}/{id}/` | Initial, independent | `dashboard_metrics.learner_metrics` → `canonical_learning.metrics` | 3 | Phase 4I + Phase 4K 20x service | OPTIMISED AND MEASURED | P0 |
| R16 | Progress/My Learning / `studentActivity` | `GET /student-activity/{kind}/{id}/[?view=my-learning]` | Initial after summary availability | `student_activity`; broad current/historical learning | Unknown | Phase 4C statement evidence only | MEASURED, NOT OPTIMISED | P1 |
| R17 | Selected imported activity/media | `GET /student-activity/{kind}/{id}/?...group_id/activity_id...`; file/source-file routes | Selection-only | `student_activity`; attempt/content/file selectors | Unknown | Source only; file routes may stream media | UNSAFE TO PROFILE DIRECTLY | Safety |
| R18 | Aptem plan / `aptemTrainingPlan` | `GET /training-plan/{kind}/{id}/` | Page initial | `training_plan_view`; persisted plan | Unknown | Source only | NOT MEASURED | P2 |
| R19 | Plan/Home panels / `learnerOverview` | `GET /training-plan-dashboard/{kind}/{id}/?section=overview|learning|my-learning` | Page/tab dependent | `training_plan_dashboard`; section projections | Unknown | Source only | NOT MEASURED | P1 |
| R20 | Training plan contract | `GET /training-plan-dashboard/{kind}/{id}/?section=contract` | Lazy document panel | `training_plan_dashboard`; contract facts | Unknown | Source only | NOT MEASURED | P2 |
| R21 | My Learning / `myLearning` | `GET /my-learning/{kind}/{id}/` | Initial Modules tab | `my_learning`; canonical catalogue summary | canonical SQL 1 | Phase 4E 20x SQL/client | OPTIMISED AND MEASURED | P0 |
| R22 | My Learning search | `GET /my-learning/{kind}/{id}/search/?q=&offset=` | Debounced, serial pages | `my_learning`; paged search | Unknown | Contract tests only | NOT MEASURED | P2 |
| R23 | My Learning upcoming | `GET /my-learning/{kind}/{id}/upcoming/` | “View all” interaction | `my_learning`; expanded links | canonical SQL 1 | Phase 4E shared SQL | OPTIMISED AND MEASURED | P2 |
| R24 | My Learning module | `GET /my-learning/{kind}/{id}/modules/{subjectId}/` | Card selection | `my_learning`; detail/activity/schedule | Unknown | Contract tests only | NOT MEASURED | P1 |
| R25 | Free Courses / `freeCourses` | `GET /free-courses/{kind}/{id}/` | Page-dependent | `free_courses_view`; assigned authored tree | Unknown | Source only | NOT MEASURED | P2 |
| R26 | Certificates / `learnerCertificates` | `GET /certificates/{kind}/{id}/[template|modules/{ref}]` | Catalogue/detail follow-up | `certificates`; template/status | Unknown | Source/contract tests | NOT MEASURED | P2 |
| R27 | Certificates issue | `POST /certificates/{kind}/{id}/.../issue/` | Explicit action | `certificates`; creates issued document | — | Write side effect | UNSAFE TO PROFILE DIRECTLY | Safety |
| R28 | Attendance / `learnerAttendance` | `GET /attendance/{kind}/{id}/?source=` | Attendance/Profile initial | `attendance.learner_attendance`; attendance aggregates | Unknown | Source only | NOT MEASURED | P1 |
| R29 | Attendance lectures | `GET /attendance/{kind}/{id}/lectures/` | Attendance initial | `attendance_lectures`; scheduled sessions | Unknown | Source only | NOT MEASURED | P1 |
| R30 | Confirm lecture attendance | `POST /attendance/{kind}/{id}/attend/` | Explicit action | `attendance_confirmation`; writes confirmation | — | Database write | UNSAFE TO PROFILE DIRECTLY | Safety |
| R31 | Attendance modes | `GET /attendance-mode/` | Form metadata | `attendance_modes`; lookup | Unknown | Source only | NOT MEASURED | P3 |
| R32 | Learner attendance mode | `POST /attendance/{kind}/{id}/mode/` | Explicit action | `attendance_mode`; writes mode | — | Database write | UNSAFE TO PROFILE DIRECTLY | Safety |
| R33 | Meeting attendance | `GET /meeting-attendance/{kind}/{id}/` | Page-dependent | `meeting_attendance`; meeting/attendance rows | Unknown | Source only | NOT MEASURED | P2 |
| R34 | Confirm meeting attendance | `POST /meeting-attendance/{kind}/{id}/attend/` | Explicit action | `confirm_meeting_attendance`; writes attendance | — | Database write | UNSAFE TO PROFILE DIRECTLY | Safety |
| R35 | Absence reports / `absenceReports` | `GET /absence-reports/{kind}/{id}/` | Attendance initial/lazy | `absence_reports`; report rows | Unknown | Source only | NOT MEASURED | P2 |
| R36 | Create absence report | `POST /absence-reports/{kind}/{id}/` | Explicit form | `absence_reports`; writes/uploads | — | Write/upload | UNSAFE TO PROFILE DIRECTLY | Safety |
| R37 | Catch-up link | `POST /session-catchup/{kind}/{id}/` | Explicit booking follow-up | `session_recovery.link_catchup`; booking/report mutation | — | Database/calendar effects | UNSAFE TO PROFILE DIRECTLY | Safety |
| R38 | Calendar / `learnerCalendar` | `GET /calendar/{kind}/{id}/` | Calendar/Reviews initial | `calendar.learner_calendar`; events/review rules | Unknown | Source only | NOT MEASURED | P1 |
| R39 | Review sessions / `reviewSessions` | `GET /review-sessions/{kind}/{id}/?content=summary|full` | Reviews initial | `review_sessions`; stored sessions | Unknown | Source-safe classification | NOT MEASURED | P1 |
| R40 | Imported review history / `reviewHistory` | `GET /review-history/{kind}/{id}/?category=` | Reviews initial/lazy | `review_history`; imported rows | Unknown | Source-safe classification | NOT MEASURED | P2 |
| R41 | Curriculum event review | `GET /calendar/{kind}/{id}/events/{key}/review/` | Selected event | `calendar.learner_calendar_event_review`; form instance | Unknown | Source only | NOT MEASURED | P2 |
| R42 | Review save/sign | `POST .../events/{key}/review/` or `/sign/` | Explicit action | `calendar`; answers/signature/month-log sync | — | Database + possible sync | UNSAFE TO PROFILE DIRECTLY | Safety |
| R43 | Meeting artifacts/content | `GET .../events/{key}/artifacts[/.../content]/` | Selected event | `calendar`; stored artifact metadata/content | — | Storage/recording content | UNSAFE TO PROFILE DIRECTLY | Safety |
| R44 | Migrated review party | `GET /migrated-reviews/{id}/party` | Selected imported review | coach migrated views; review document | Unknown | Source only | NOT MEASURED | P2 |
| R45 | Migrated answers/signature/PSP | `POST /migrated-reviews/{id}/party-answers|party-sign|prepare-psp` | Explicit action | migrated review/personal-support services | — | Writes and signature sync | UNSAFE TO PROFILE DIRECTLY | Safety |
| R46 | Review PDFs/revisions | `GET .../party-pdf|revisions/{n}/pdf|review/pdf/` | Download action | review PDF renderers | — | Generated binary/download | UNSAFE TO PROFILE DIRECTLY | Safety |
| R47 | Calendar booking | `POST /calendar/{kind}/{id}/book/` | Explicit action | `calendar_book`; DB + Graph/Teams path | — | External/write effects | UNSAFE TO PROFILE DIRECTLY | Safety |
| R48 | Calendar reschedule | `PATCH /calendar/{kind}/{id}/reschedule/` | Explicit action | `calendar_reschedule`; same meeting update | — | External/write effects | UNSAFE TO PROFILE DIRECTLY | Safety |
| R49 | Calendar cancel | `POST /calendar/{kind}/{id}/cancel/` | Explicit action | `calendar_cancel`; cancellation/invitations | — | External/write effects | UNSAFE TO PROFILE DIRECTLY | Safety |
| R50 | Coach availability | `GET /calendar/{kind}/{id}/coach-availability/` | Booking dialog | coach availability; calendar provider | — | May contact calendar service | UNSAFE TO PROFILE DIRECTLY | Safety |
| R51 | Calendar connections | `GET /calendar-connections/{kind}/{id}/` | Calendar settings | `calendar_connections.connection_list`; credentials metadata | Unknown | Source only | NOT MEASURED | P3 |
| R52 | Personal availability | `GET /calendar-connections/{kind}/{id}/availability/` | Booking dialog | `calendar_connections.availability`; provider calls | — | External calendars | UNSAFE TO PROFILE DIRECTLY | Safety |
| R53 | Calendar OAuth/connect/disconnect | `GET .../{provider}/oauth/`; `POST .../connect|disconnect/` | Explicit settings action | `calendar_connections`; credentials/OAuth | — | External/write effects | UNSAFE TO PROFILE DIRECTLY | Safety |
| R54 | Evidence current / `evidence` | `GET /evidence/{kind}/{id}/?section_ref=&status=` | Evidence initial | `evidence.list_evidence`; metadata rows | Unknown | Source-safe classification | NOT MEASURED | P1 |
| R55 | Historical evidence list | `GET /evidence/{kind}/{id}/historical/` | Evidence initial parallel | `historical_evidence.list`; persisted summaries | Unknown | Source-safe classification | NOT MEASURED | P1 |
| R56 | Historical evidence detail | `GET /evidence/{kind}/{id}/historical/{source}/{sourceId}/` | Selection-only | `historical_evidence.detail`; metadata/notes | Unknown | Source-safe classification | NOT MEASURED | P2 |
| R57 | Evidence open/download | `GET .../historical/.../open/` or `/{fileId}/download/` | Document action | historical/evidence URL generation | — | Azure/SAS/storage path | UNSAFE TO PROFILE DIRECTLY | Safety |
| R58 | Evidence upload/delete | `POST .../upload/`; `DELETE .../{fileId}/` | Explicit action | `evidence`; Blob + metadata mutation | — | Storage/database writes | UNSAFE TO PROFILE DIRECTLY | Safety |
| R59 | Support tickets | `GET /support/tickets/[{ticketId}/]` | Support initial/detail | `support_tickets`; ticket rows | Unknown | Source only | NOT MEASURED | P3 |
| R60 | Ticket create/attachments | `POST /support/tickets/`; `GET .../attachments/{id}/` | Explicit/detail action | support service; DB/upload/download | — | Write/storage mix | UNSAFE TO PROFILE DIRECTLY | Safety |
| R61 | Progress transfer | `GET|POST /progress-transfer/{kind}/{id}/` | My Learning interaction | `progress_transfer.learner_request`; frozen state/request | — | POST changes transfer state | UNSAFE TO PROFILE DIRECTLY | Safety |
| R62 | Module progress | `GET|POST /module-progress/{kind}/{id}/` | Dashboard module interaction | `module_progress`; progress read/correction | — | Same route can write | UNSAFE TO PROFILE DIRECTLY | Safety |
| R63 | Quiz detail/reading | `GET /quizzes/{quizId}/`; `GET .../reading/` | Quiz open | `quizzes`/`quiz_reading`; owned quiz/content | Unknown | Phase 4D ownership SQL | OPTIMISED, NOT END-TO-END VERIFIED | P1 |
| R64 | Quiz submission | `POST /quizzes/{quizId}/submit/` | Explicit action | `quizzes`; attempt/progress writes | — | Database write | UNSAFE TO PROFILE DIRECTLY | Safety |
| R65 | Time tracking | `POST /time-tracking/start|checkpoint|clock/` | During content | `time_tracking`/`reward_tracking`; timer writes | — | Database/engagement writes | UNSAFE TO PROFILE DIRECTLY | Safety |
| R66 | Component/video completion | `POST /components/{id}/complete/`; `/videos/{id}/complete/` | Completion action | component/video services; progress writes | — | Database write | UNSAFE TO PROFILE DIRECTLY | Safety |
| R67 | Reflection submissions | `GET|POST /reflection/submissions/` | Assignment page/load/save | `reflection_submissions`; submission rows/files | — | POST/write and possible files | UNSAFE TO PROFILE DIRECTLY | Safety |
| R68 | Reflection/assignment AI | `POST /reflection/transcribe|proofread|ksb-explanations|monthly-reflections|learning-statements|assignment/ai-check/` | Explicit assistance | AI/transcription services | — | Paid/external services | UNSAFE TO PROFILE DIRECTLY | Safety |
| R69 | Monthly reports | `GET|POST /monthly-reports/{kind}/{id}/`; attachment route | Monthly assignment | `monthly_reports`; report rows/files | — | POST and attachment storage | UNSAFE TO PROFILE DIRECTLY | Safety |
| R70 | Statutory documents | `GET /apprenticeship-agreement|ilr-document|training-plan-document|written-agreement/{id}/` | Compliance page | named document handlers; persisted versions | Unknown | Source only | NOT MEASURED | P2 |
| R71 | Document issue/sign | `POST` to the four document `issue/` or `sign/` routes | Explicit action | named document handlers; immutable/signature writes | — | Database writes | UNSAFE TO PROFILE DIRECTLY | Safety |
| R72 | Personal learning | `GET /personal-learning/courses/`; `POST .../{identity}/request/`; `GET .../verify/{token}/` | Page/action/public verify | `personal_learning`; course/certificate records | — | Request issues/sends certificate | UNSAFE TO PROFILE DIRECTLY | Safety |
| R73 | Monthly logs read | `GET /monthly-logs/{id}/[month|activities|documents]` | Monthly coaching/evidence | `monthly_logs`; journal/material/document rows | Unknown | Source only | NOT MEASURED | P2 |
| R74 | Monthly log sign/complete/unlock | `POST /monthly-logs/{id}/{month}/sign|complete|unlock/` | Explicit action | `monthly_logs`; status/signature writes | — | Database writes/sync | UNSAFE TO PROFILE DIRECTLY | Safety |
| R75 | Session results/media | `GET /session-results/{kind}/{id}/{series}/sessions|artifacts/...` | Attendance/review selection | curriculum session results/recording | — | Join links/recording storage | UNSAFE TO PROFILE DIRECTLY | Safety |
| R76 | Subject covers/working holidays | `GET /subject-covers/{id}/`; `GET /working-hours/holidays/` | My Learning/content access | student activity/working-hours selectors | Unknown | Source only | NOT MEASURED | P3 |
| R77 | First/onboarding session status | `GET /calendar/{kind}/{id}/first-session|onboarding-reviews/` | Gate/onboarding page | `calendar`; persisted booking/review status | Unknown | Source only | NOT MEASURED | P2 |

GET alone was not treated as proof of safe profiling.  Storage URL generation,
media/PDF generation, availability providers, OAuth and join/recording paths
remain excluded even where the route is read-shaped.

## D. Top Five Bottlenecks at Selection Time

| Rank | Candidate | Evidence and impact | Decision |
|---:|---|---|---|
| 1 | Metrics `GET /metrics/{kind}/{id}/` | Phase 4I left a 2,790-row service median of 3.54 s; Phase 4K decomposition found the canonical SELECT dominated. Initial Progress read and reused by Home calculations. Safe Reader harness and strong parity tests existed. | **Selected** |
| 2 | Rich Weekly initial/detail | Initial Dashboard critical path. Older rich projections recorded 6.0–9.2 s and up to 207 KB raw, but the current Reader can only execute the empty-plan shape because of a deliberate attendance privilege boundary. | Retain as high-priority measured gap; current magnitude is historical |
| 3 | Minimal Dashboard Header | Initial authorization gate, still eight queries and 537.139 ms service median on the empty fixture after Phase 4J. | Next bounded consolidation candidate |
| 4 | My Learning catalogue maximum history | Phase 4E improved the dominant SQL, yet maximum DB-client median remained 2,597.304 ms. It is an initial page request, but the retained SQL fix already removed 88.8% of examined relation rows. | Re-profile before another edit |
| 5 | Student Activity | Progress/My Learning can load a broad consolidated ledger after the summary gate. Phase 4C found expensive related statements, but no current endpoint/service timing exists. | Estimate from shared data path only; measure before editing |

The ranking does not equate historical SQL duration with current endpoint
latency.  Metrics was selected because the unresolved cost was current,
reproducible, high-volume, safe and covered by exact response parity.

## E. Selected Request

```text
Progress page
  -> useLearnerMetrics
  -> frontend/src/api/learnerMetrics.ts
  -> GET /learner_api/metrics/{kind}/{id}/
  -> learner_api.dashboard_metrics.learner_metrics (line 496)
  -> canonical_learning.metrics (line 1323)
  -> canonical_learning.entries_for (line 131)
  -> learner_progress_entries + KSB/source/segment/history relations
```

The view remains `GET`-only and guarded by learner ownership/staff permission.
The request is independent of the Progress summary read.  The same
`canonical_learning.metrics` calculation is also consumed by Home overview
logic, so the narrower internal projection benefits that service call without
adding an endpoint or changing the frontend waterfall.

## F. Root Cause

The Phase 4I `training_summary=True` path correctly removed raw evidence, but
it was shared with Dashboard Overview/Training.  Metrics consequently still:

1. built source payload keys used only for course/module display;
2. retained full `source_payload` metadata used by dashboard placement rules;
3. aggregated every journal route and its display fields even though Metrics
   uses the programme-level planned-hours calculation;
4. decoded and held those intermediate objects in Python before reducing the
   result to programme, OTJH and KSB counts.

For the maximum selected shape, the pre-change canonical SELECT accounted for
most of the three-query service wall.  An earlier owner-predicate experiment
improved the maximum median by only 3.4% while worsening several p95/other
shapes; it was rejected and fully removed.  The retained change targets data
materialisation rather than forcing an inconsistent PostgreSQL plan.

## G. Code Changes

1. `backend/learner_api/canonical_learning.py`
   - adds internal `metrics_summary=True` to the existing canonical reader;
   - keeps timing, KSBs, segment presence, source completion/status and typed
     old-LMS lineage required by `current_records` and completion rules;
   - narrows activity-source JSON to the five fields Metrics consumes;
   - narrows object `source_payload` to retake choice and original source ref;
   - omits the journal-route CTE and its Python payload for Metrics only;
   - keeps `training_summary=True` for active progress transfers so frozen
     records retain the existing complete projection.
2. `backend/learner_api/test_canonical_metrics_bulk_no_db.py`
   - asserts the Metrics-only projection and transfer fallback;
   - asserts required lineage/completion keys remain and unused journal/wide
     source keys are absent.
3. `backend/reports/benchmark_learner_metrics_phase4k.py`
   - guarded, anonymised, SELECT-only, 20-sample reproduction harness.

Dashboard Overview/Training continue to call `training_summary=True`; My
Learning continues to call its Phase 4E catalogue projection.  No public
function, route or JSON field changed.

## H. Response and Business Logic Parity

- Warm-up and all **160 measured calls** (4 shapes × 20 samples × 2 variants)
  produced exact Python payload equality.
- Final payload byte counts were identical per shape: 1,382; 356; 2,812; and
  5,468 bytes.
- `metrics_from_records` remains the single owner of programme completion,
  accepted OTJH hours, KSB ratios, nulls, rounding and ordering.
- Required source completion/status and old-LMS typed lineage remain present.
- Retake timing and original source-reference semantics remain present.
- Active progress transfers deliberately retain the previous broader frozen
  projection.
- Empty, decimal/null, KSB ordering, duplicate/source-completion and large
  in-memory shapes remain covered by the Phase 4I/4K tests.
- Anonymous and cross-learner denial remain in the unchanged endpoint
  decorator path and passed the endpoint/progress-gate tests.
- The benchmark transaction verified `transaction_read_only=on`; no write or
  external-service call is made by the harness.

## I. Before and After Performance

Method: same process, same Reader role, same branch, same owner and parameters,
warm-up followed by 20 alternating calls per variant.  The Reader cannot read
the KSB exclusion relation or optional subject-attempt relation, so both
variants replace the exclusion predicate with `TRUE` and treat attempts as
absent inside the benchmark only.  Application code was not weakened.

| Shape / rows | Metric | Before: Phase 4I training summary | After: Metrics summary | Change |
|---|---|---:|---:|---:|
| Small / 52 | Service median | 380.037 ms | 356.556 ms | -6.2% |
|  | Service p95 | 711.415 ms | 548.008 ms | -23.0% |
|  | Peak traced allocation | 581,913 B | 422,409 B | -27.4% |
| Median / 357 | Service median | 381.920 ms | 377.522 ms | -1.2% |
|  | Service p95 | 509.955 ms | 548.718 ms | **+7.6%** |
|  | Peak traced allocation | 2,867,350 B | 2,503,600 B | -12.7% |
| Large / 1,105 | Service median | 975.958 ms | 849.275 ms | -13.0% |
|  | Service p95 | 1,236.509 ms | 1,117.469 ms | -9.6% |
|  | Peak traced allocation | 12,507,924 B | 9,184,935 B | -26.6% |
| Maximum / 2,790 | Service median | 3,141.655 ms | 2,623.502 ms | **-16.5%** |
|  | Service p95 | 4,498.677 ms | 3,364.535 ms | **-25.2%** |
|  | SQL execute median | 2,320.028 ms | 1,850.700 ms | -20.2% |
|  | Process CPU median | 539.062 ms | 421.875 ms | -21.7% |
|  | Peak traced allocation | 32,747,256 B | 24,652,557 B | **-24.7%** |
| All shapes | Query count | 3 | 3 | unchanged |
| All shapes | Final response bytes | identical | identical | unchanged |
| Maximum plan | Progress rows examined | 3,617 | 3,617 | unchanged |
| Maximum plan | PostgreSQL execution | 417.088 ms | 298.455 ms | -28.4% |

The median-shape p95 regression is retained in the report rather than hidden;
its median and memory improved, and the larger histories improved materially.
Remote Neon variability means this 20-sample p95 is diagnostic, not a
production percentile.  Serialization was measured but was sub-millisecond
and final payload size was unchanged.  No errors or statement timeouts occurred.

## J. Backend Tests

```text
backend\.venv\Scripts\python.exe backend\manage.py test \
  learner_api.test_canonical_metrics_bulk_no_db \
  learner_api.tests_dashboard_metrics.DashboardMetricsTests.test_live_metrics_read_is_ssot_only \
  learner_api.tests_dashboard_metrics.DashboardMetricsTests.test_endpoint_scopes_identity_and_returns_retryable_error \
  learner_api.tests_dashboard_metrics.LearnerOverviewMetricsEndpointTests \
  login.tests_learner_progress_gate --verbosity=1
```

**PASS — 34/34.**  Covers Metrics contract, empty/large shapes, query-count
stability, null/decimal/order rules, source completion, endpoint errors,
anonymous denial and cross-learner scoping.

Previous-phase final-state checks:

- Phase 4J Header/Weekly: **PASS — 47/47**.
- Phase 4H standalone detail behavior: **PASS — 14/14**.
- Phase 4H SQLite projection/shared calculations: **PASS — 32/32**.
- Python compilation and `git diff --check`: **PASS**.
- Phase 4K Reader benchmark: **PASS**, four shapes, 20 alternating samples,
  exact response parity, no timeout.

## K. Frontend Tests

No frontend production or test file changed.

```text
npm --prefix frontend test -- --run \
  src/hooks/__tests__/useLearnerMetrics.test.tsx \
  src/api/learnerMetrics.test.ts --maxWorkers=1
```

**PASS — 13/13.**  Metrics request keys, response consumption and cache behavior
remain compatible.

The repository TypeScript check was attempted but did not finish or emit a
diagnostic after more than two minutes; only that spawned check process was
stopped.  Result: **BLOCKED / timeout**, not passed.  The earlier Phase 4J run
had stopped at unavailable `lottie-react`, but this run did not reach a result
and is not relabelled as the same failure.

## L. Existing Unrelated Failures

```text
npm --prefix frontend run test -- \
  src/api/__tests__/learnerContentLoading.test.ts --maxWorkers=2
```

Reproduced **5 failed / 2 passed**, exactly the known baseline: four fixtures
do not satisfy the existing activity identity guard and one fixture returns
invalid JSON.  No Phase 4K file participates in these failures.

Two broader backend runs performed during investigation also exposed existing
SQL-text assertions tied to older canonical SQL forms: one expects a reduced
payload without the already-retained `retakeTimeChoice`, and five subcases
expect the former deleted-content predicate.  The Phase 4K focused/final tests
do not suppress or modify those assertions; they are outside this optimisation.

## M. Remaining Request Backlog

1. Obtain a rich, Reader-accessible Weekly fixture (or a verified isolated
   equivalent) and remeasure R06/R07; the current Phase 4J fixture is empty.
2. Decompose the remaining eight Minimal Header statements and consolidate
   only a proven repeated selector while preserving its authorization gate.
3. Measure Student Activity as a complete service request across 52/357/1,105/
   maximum histories before changing its broad canonical contract.
4. Re-profile My Learning maximum histories after Phase 4E to distinguish
   unavoidable remote fetch/decode time from remaining SQL work.
5. Measure lazy Dashboard Overview and Training separately; they intentionally
   retain the broader training projection and must not inherit Metrics-only
   assumptions.
6. Establish safe metadata-only baselines for Evidence and Reviews; keep
   storage, PDF, Graph/Teams and signature routes excluded.

## N. Recommended Next Optimisation

Target **Minimal Dashboard Header** next.  It is a measured initial critical
path, still performs eight queries, and has a safe read-only fixture.  Profile
the next-review, next-session and next-assignment selectors separately, then
retain only a consolidation that preserves the Header-first authorization
gate, exact card ordering and error semantics.  In parallel, improving Reader
coverage for rich Weekly histories is measurement work, not permission to
optimise from the old 6–9 second figures alone.

## O. Safety Confirmation

- Production and the parent database/branch were not accessed.
- The only database benchmark target was `lms_ideal_test`, branch
  `br-orange-shadow-abm8uwwe`, endpoint `ep-dawn-block-ab5vob3x`, database
  `neondb`, role `lms_benchmark_reader`, with `transaction_read_only=on`.
- No application data write, fixture creation/deletion or cleanup occurred.
- No schema change or migration was created or run.
- No Teams, Graph, Azure, SMTP, AI or other external integration was enabled
  or called.
- No frontend UI, loading state, cache key or public API contract changed.
- No Teams-trigger file was edited; Teams baseline and expanded checks are
  **NOT REQUIRED**.
- No branch or worktree was created or switched.
- No commit or push was performed.
- Existing Phase 4H, 4I, 4J and unrelated contributor changes were preserved.
