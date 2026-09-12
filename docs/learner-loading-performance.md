# Learner loading improvements — 12 September 2026

The shared learner client now requests a compact plan. Reading HTML is omitted
from the database result and JSON until the learner opens that lesson. Module,
week and activity membership, progress, quiz results, KSBs and hours are retained.
Required nullable fields, zero values and false flags are preserved.

Opening a lesson reuses the shared plan and reads only that lesson's HTML.
The new `content=reading` response uses the existing learner authorization and
checks assigned modules and module/week/component visibility. Opening a video
or another activity already described by the plan needs no additional detail
request. Saving progress invalidates both plan and opened-lesson caches.

The Dashboard can render an active learner's identity and load attendance,
metrics, weekly focus, schedule and contract independently while the plan is
pending. Other programme statuses still wait for the existing progression and
onboarding checks. Slow module metadata enriches an already visible training
plan; failure offers retry without removing it or resetting the selected month.
Profile-photo reads are shared across mounts, and successful uploads replace
the cached photo. Account changes clear these in-memory caches.

## Read-only measurements

Observed against learner 125 from this development machine. These are individual
diagnostic observations against remote databases, not browser or production SLA
measurements. Existing GET-time mutation hooks were disabled and SQL wrappers
rejected non-read statements (apart from savepoints and the existing connection
statement-timeout setting). No schema or data changes were executed.

The initial full detail build took 8.629 seconds and returned 9,223,311 JSON
bytes. It also reloaded the entire progress graph after an empty KSB refresh.
The reload now occurs only when that refresh returns an assignment.

After that change, a paired run with the same source row measured:

| Read | Build/read + JSON time | JSON bytes | Queries |
| --- | ---: | ---: | ---: |
| Full response | 6.880 s | 9,223,311 | 31 |
| Compact plan | 5.676 s | 4,574,685 | 30 |
| One selected reading | 0.077 s | 7,016 | 1 |

The paired timings exclude authorization and the initial source-row lookup.
Both plans contained **3,515 activities**. A field-by-field comparison confirmed
identical plan/progress data except deferred HTML, its availability flag and
omitted optional nulls. The selected reading exactly matched the original HTML.
The compact payload is **50.4% smaller** before HTTP compression.

## Verification

- Backend: 229 database-free tests passed, including compact payloads, assigned
  content scope, KSB refreshes, activities, dashboard totals and weekly data.
- Frontend: **703 tests passed across 72 files** (`npm run test:learner`). Checks
  cover compact/shared reads, deferred lesson content, iframe
  readings, cache invalidation, early Dashboard rendering, metadata failure and
  recovery, identity changes, profile photos and the complete learner page matrix.
- The production build passes. Repository-wide TypeScript checking has existing
  errors in admin/curriculum/user-management files; see its output for details.

The local backend uses the development server with automatic reload enabled.
The external historical-subject service and Neon latency still affect uncached
reads; these changes do not replace or hide historical activity records when a
source is slow. No database writes, migrations, commits, pushes, pulls or pull
requests were performed.


## Dashboard follow-up (12 September 2026)

The Dashboard no longer requests learner-detail, student-activity or
subject-covers. It reads a small identity response with programme dates and
access-gate information. The weekly response now also includes per-subject
counts, teaching dates and live-session titles computed from the same verified
historical mirror and direct progress that drive the Dashboard. Explicit source
links deduplicate native/imported activities, including later completions.
Lesson HTML, quiz content and individual attempt histories stay on learning pages.

Monthly panels reuse the weekly and schedule requests already used by This week
and Upcoming. The contract PDF remains independent, so slow hour-target extraction
does not block reviews, module progress or the timeline. The overview schedule
also skips an unused contract lookup.

Read-only measurements for the same learner, with a SQL guard rejecting writes:

| Read | Elapsed | JSON bytes |
| --- | ---: | ---: |
| Dashboard identity (including source lookup) | 0.716 s | 540 |
| Weekly overview plus all module summaries | 5.736 s | 20,384 |
| Schedule and coaching | 1.556 s | 27,775 |
| Programme/KSB/hour totals | 2.306 s | 6,314 |

The last three timings exclude authorization/source lookup and are separate
server reads; the browser starts them concurrently. These are not browser
end-to-end timings. Neon latency still varies. The 20 KB plan summary replaces
the Dashboard's dependency on a 4.6 MB detail graph and external historical
content requests. The summary and programme card both report exactly **1,227
completed / 3,746 activities** for the measured learner.

Dashboard remains the login/default learner destination. After the last of the
learner's four required signatures, the documents page invalidates learner caches
and returns there; incomplete signatures and failed saves stay on documents.
Staff reviewing a learner stay on Dashboard instead of being redirected to that
learner's onboarding wizard. My Learning is the final navigation card, including
the reduced menu for learners with previous learning.

The follow-up backend regression run passes 232 database-free tests. The full
learner frontend run passes 700 tests across 72 files, and the production build
passes. Repository-wide type checking still reports errors in unrelated monthly
logs, admin, curriculum and user-management files. Frontend
coverage checks that Dashboard cards render with no detail/history requests,
share weekly/schedule reads, preserve monthly selections, retry failures, preserve
progress totals, and handle signatures and staff review navigation.
