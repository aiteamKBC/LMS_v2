# Learner Dashboard: learning panels and sources

Implemented 12 September 2026, below the four programme summary cards. Existing card formulas and sources are unchanged.

The page and sidebar now use **Dashboard**. `/workspace/learner` is the default home for both new and imported learners; `/learner` redirects there. Explicit activity/previous-record links still work, and existing onboarding and previous-record access prerequisites still apply. The Profile page's **Back to Dashboard** button returns to the current learner's own dashboard. The navigation/sign-in regression run passed **67 tests**, and the production build passed.

## Endpoints

| Endpoint | Used for | Database sources / fields |
| --- | --- | --- |
| `GET /learner_api/overview-week/{kind}/{id}/` (new) | This week's modules, dates, completed activities, KSB codes, expected hours, actual hours and authored assignment/checkpoint deadlines | Sources detailed below. Learner identity is resolved by enrolment ID; imported data requires matching Aptem ID and email. |
| `GET /learner_api/training-plan-dashboard/{kind}/{id}/?section=overview` (existing) | Live sessions, monthly coaching, support sessions, progress reviews | `curriculum.live_sessions`, `curriculum.live_session_occurrences`; `Coach.coach_calendar_event` via `coaching_events_for_learner()`. Uses the same active programme cycle and generated target dates as the learner calendar. |

Both requests run independently, use private responses and shared 30-second client snapshots, and refresh on focus, returning online, visible-page polling and successful LMS saves. Background errors retain the last successful panel and provide Retry. No contract/PDF request is made by these panels.

## Monthly learning and coaching: moved from Training Plan

The existing **Monthly focus**, **Reviews this period** (including coach support booking), and **Module overview** panels now appear together immediately below **This week / Upcoming**, followed by the **Module timeline** across the full available width. All four sections are removed from the original Training Plan page. Colours and calculation helpers are preserved.

- The grid follows the available content width: three aligned columns at 72rem and above; at 60rem, Monthly focus spans a row with the other two panels underneath; smaller widths stack the panels. Gaps, padding and corner radii match the Dashboard. Monthly sessions and reviews have bounded, scrollable lists so long lists do not stretch the entire row.
- Month arrows, direct month selection, attendance filtering, session materials, Teams links, review booking and support booking retain their original behavior. The module selector and timeline bars both select the module in the cards; clicking a bar reveals those cards without leaving Dashboard. Existing `/workspace/learner/{kind}/{id}?subject={subjectId}&month={month}#training-plan-details` links still select the matching module/month.
- **View full timeline** jumps to `#module-timeline` on the same Dashboard. The original `/learner/training-plan-timeline/{kind}/{id}` page retains its four summary cards and links to `/workspace/learner/{kind}/{id}#module-timeline`. The similarly named `/learner/training-plan/{kind}/{id}` remains the existing materials alias.
- Loading is independent of the upper Dashboard. A slow or failed contract request does not hide reviews or module details; retries preserve the selected month. Existing focus/visibility refresh and the manual refresh control remain available. The schedule request shares in-flight reads with Upcoming instead of making a duplicate request.

Existing data sources retained by the moved panels:

| Endpoint | Panel data |
| --- | --- |
| `GET /learner_api/training-plan-dashboard/{kind}/{id}/?section=overview` | Assigned module metadata and explicit old/new links; live sessions, occurrences and learner attendance; calendar coaching/review events and support booking URL; accepted historical hours grouped by month and group. |
| `GET /learner_api/training-plan-dashboard/{kind}/{id}/?section=contract` | Contract monthly topics, planned hours and weekly target when present. Uses the existing selected training-plan contract and document reader. |
| Existing learner detail, optional student activity, and `GET /learner_api/subject-covers/{id}/?refs=...` | Assigned subjects, dated activities, completion and metadata, through the unchanged `subjectsFrom()` / `buildPlanModules()` logic. |

Monthly Completed/Remaining and module Hours recorded retain the source used by the original Training Plan panels: accepted `structured_manual_activities.manual_learner_activities.actual_hours`, grouped by `month` / `group_id`. These moved tiles do not introduce a replacement for the programme Actual card or This week's separate OTJ formula. Their original module-period review filtering and month-based default selection are also retained; This week continues to follow the newest assigned module as described below.

Move verification: **65 tests passed across 5 files**, covering the moved controls, calculations, booking/material destinations, independent loading/retries, shared request cancellation, and existing weekly-panel behavior. Production build passed. Browser checks with intercepted fixture responses at **1763, 1366, 1150, 768 and 390 px** found no horizontal overflow or JavaScript errors. No live records were modified. The full TypeScript check reports six diagnostics outside this change: `AccessPanel.test.tsx`, `SessionsTree.tsx`, `teams-meetings/page.tsx`, `CreateEmployerModal.tsx` (two), and `CreateUserModal.tsx`.

### Timeline beneath the cards

`ModuleTimeline` consumes the same plan snapshot and built module list as the monthly cards. It does not fetch data. Year ranges, clipping multi-year module bars, progress fill, teaching-week/session counts, undated modules, today's marker and grouped calendar review links retain the existing helpers and source data.

The year selector, **Today**, **Jump to** and clickable month headers update the same selected month as Monthly focus. Month arrows above also update the timeline. Selecting a dated module outside that month moves focus to its start month, then reveals its overview; an undated module keeps the selected month.

The timeline has a 20px gap below the cards, matching their grid gap. Its height is bounded, with horizontal and vertical scrolling inside the timeline instead of widening the page. Month headings and module names remain fixed during scrolling. On narrow screens the toolbar stacks, and choosing a month reveals that column horizontally without moving the page vertically. Existing loading, retries, refresh and selection persistence are shared with the monthly panels.

Timeline follow-up verification: all **65 tests**, the production build, and ESLint on the four changed TSX components passed. Browser fixtures with 28 modules verified sticky labels/header during both scroll directions, five viewport widths, month synchronisation and horizontal reveal, in-page module selection, and the old page's link to the new timeline anchor. Initial Dashboard loading made **one** shared overview/schedule request.

## This week

- Week = Monday–Sunday in **Europe/London**, independent of the browser/server timezone. The panel displays the actual date range.
- Only learner-assigned activities with trustworthy teaching dates enter the week. Creation/import timestamps, ambiguous dates and undated sections do not become teaching dates.
- Native activities: `curriculum.components` joined to assigned `curriculum.modules` and `curriculum.weeks`. Dates come from component/week titles; live-session components can use `settings_json.sessionDate`, `sessionDateTimeUtc` or `teamsStartDateTimeUtc`.
- Historical activities: `Last_audit.learners`, `group_learners`, `groups`, `group_activities`, `activities`, `activity_results`. Retained `MBA.course_curriculum` section dates and an explicitly linked Builder week's current title supply the schedule through the existing `read_curriculum_schedules()` helper.
- Native completion: `Learner.learner_progress_entries` with `component_link_source` of `direct` or `quiz_ref`. Failed records do not count; quizzes require an explicit pass. New attempts on old activities also come from `Learner.subject_activity_attempts.completed`.
- Old/new placements merge only through explicit `source_component_id` / `component_id` export identity. Any successful completion survives, and the same placement does not count twice. Same titles alone never join records.
- Weekly progress = completed activities / all assigned activities scheduled that week **in the selected module**. If several modules have scheduled activities, the selector lets the learner inspect each one.
- Default focus follows the owner's clarification: the **newest created module assigned to this learner**, selected by `curriculum.modules.created_at DESC` within the IDs resolved from their current plan. Start dates, alphabetical titles and `updated_at` do not decide this. The response exposes `latestModuleId`; a newly created but unassigned module cannot become the focus.
- That module stays visible even before it has this week's dated activities; no artificial 0% progress is displayed. If a newer assigned module appears on refresh, it becomes the default even after a previous manual selection. An ordinary data refresh preserves manual selection while the latest module identity is unchanged.
- KSB codes: old `structured_manual_activities.activity_ksbs.ksbs`, overridden by `learner_activity_ksbs.ksbs` when `source_preference = 'learner'`; native `curriculum.components.ksb_mappings` with `curriculum.ksb_mappings.ksb_code` fallback. Codes in this tile describe the selected week's activity coverage; this is not a second programme-wide KSB percentage. Missing mappings are labelled.
- Open learning activities links to `/learner/modules/{kind}/{id}?subject={subjectId}`. Coaching/review links open their actual event in `/learner/calendar`.

## Weekly OTJH: owner-confirmed formula

**Actual hours recorded during this week / sum of expected hours for the activities scheduled this week.** Both sides cover all modules in this week; the label says so even when one module's progress is selected.

Actual:

- Historical accepted ledger: `structured_manual_activities.manual_learner_activities.actual_hours`, filtered by server-resolved `aptem_id`, `accepted = true`, `deleted_at IS NULL`, and `activity_date` within the week. This is the same accepted ledger used by the programme Actual card.
- New LMS: direct progress submitted in the week (`Learner.learner_progress_entries.submitted_at`), using the existing OTJ deduplication/provenance rule: explicit entered seconds, reported time, verified seconds, then the existing fallback for older records.
- Imported progress copies do not add the historical time a second time. Accepted historical rows with no activity date in the relevant month make the weekly actual unknown, with an explanatory note.

Expected:

- Native: `curriculum.components.expected_otjh`.
- Historical: `Last_audit.activity_planned_hours.planned_hours`, joined by learner/Aptem identity and activity `ref`/`kind`, as in the existing activity reader.
- Explicitly linked native expected hours take precedence for the same old activity. A reused historical activity's expected hours are counted once across group placements in the week.
- Missing expected hours remain unknown; explicitly stored zero stays zero. No contract total is divided by weeks or substituted for these activity hours.

## Upcoming

- Earliest five future items, sorted by actual date/time in UK time. Repeated event identities are deduplicated. Cancelled, deleted, superseded, failed, completed or awaiting-signature calendar events are excluded.
- A coaching/review target without a scheduled booking appears as **To book** with no invented meeting time. Stored booked dates override target dates. A booking whose invitation has not synced appears as **Booking pending**.
- Live sessions in both panels are scoped to the selected module's exact curriculum ID(s), including explicit old/new mappings. A new session can appear on refresh even if the module has no weekly activities. There is no fallback to another module's sessions. Coaching/review events remain learner-wide.
- This week's live-session tile can show a session that has already taken place; Upcoming only includes future starts.
- Assignment/checkpoint due dates require an authored rule: `curriculum.components.settings_json.dueTiming = 'End of week'` plus a trustworthy dated week. Completed assignments are excluded. Arbitrary activity dates are not treated as deadlines.
- No synthetic monthly portfolio deadline or checkpoint appointment is inserted to imitate the screenshot. Rows appear when the required source data exists.

### Coaching source verification (12 September 2026)

Read-only inspection confirmed that learner 125's Upcoming reviews match the shared calendar reader exactly. The two displayed entries are generated, unbooked programme targets:

| Entry | Target | Source |
| --- | --- | --- |
| Monthly Coaching #23 | 25 September 2026 | Programme start + 23 × 30 days |
| Monthly Coaching #24 | 25 October 2026 | Programme start + 24 × 30 days |

For this learner the dates resolve from `enrolment.Created_users.Start_date` (`2024-11-04`) and `End_date` (`2026-11-03`), because the active `Learner.learners` profile has no schedule dates. The generated coach name comes from that profile's `coach_name`. The existing calendar rule uses a **30-day interval**, not the same day of every calendar month. Sequence numbers identify planned slots; they do not assert that earlier sessions were attended.

Once booked, `Coach.coach_calendar_event` overrides the matching generated `event_key`: `scheduled_date`, `scheduled_time`, `status`, `owner_name`, and `graph_event_id` supply the date, time, state, coach, and invitation confirmation. Cancelled/completed rows suppress their generated target and are then excluded from Upcoming. The panel re-reads its source every 30 seconds while visible/online, and on returning to the page; updated results appear once the request completes.

Verification added a backend regression using unsaved booking fixtures and a frontend regression driven only by polling. They cover booking, rescheduling, invitation confirmation, changing coach, cancellation and completion; the backend also covers changed programme start/end dates and regenerated targets. **40 backend tests and 17 frontend tests passed.** No bookings, programme dates or other database records were changed.

## Read-only verification for learner 125

For **7–13 September 2026**:

- 16 dated activities in `G1-Keith-Strategy&Planning`; 0 completed.
- Expected hours currently stored for those activities: **0**; weekly recorded actual: **0.0017 h** (shown as `<0.01h`).
- 833 other programme activities have no reliable teaching date; they are excluded from the weekly panel, not removed from the programme.
- No future live sessions were returned by the training-plan schedule. Monthly coaching targets include 25 September and 25 October, currently unbooked. No dated pending assignment/checkpoint deadline was returned.

These are source-data gaps, not placeholder values to overwrite in code. No database changes or migrations were made.

## Validation

- All learner frontend tests: **665 passed across 68 files**.
- **32 backend regressions passed** for the weekly overview and existing programme metrics, using `SimpleTestCase` (no test database creation or writes).
- Production build passed. TypeScript's six existing errors outside learner code remain unchanged.
- Fixture browser checks: 1763, 1366, 768 and 390 px; no horizontal page overflow or page JavaScript errors. Verified module navigation, calendar event links, empty/error states and refresh after changed data without navigation.
- Live source inspection used a query guard permitting read-only SQL only. Weekly response for learner 125 took about **3.7 seconds** locally; this is not a guarantee for every network or learner.

Latest-module follow-up: **18 backend tests and 15 frontend tests passed**, including a newly assigned module with no dated activities, preserved explicit old/new identity, automatic focus changes, and a later live session appearing without showing an older module's sessions. Read-only inspection selected `Sufian-Strategic Leadership` as learner 125's newest created assigned module.

Automatic-update verification: **9 panel integration tests passed**. The added regression simulates a module being created and assigned from another browser, with no local invalidation event or manual reload. The next 30-second polling cycle selects that module and updates the activities link; a later cycle picks up its dated activities, KSBs, progress, weekly hours and live session. Sessions from the previously selected module remain excluded. This verification used mocked responses and did not create or change database records.
