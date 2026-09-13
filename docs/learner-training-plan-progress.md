# Training plan progress and rewards

The training plan has two columns on desktop: a twelve-month module timeline above two progress charts, and the module overview alongside. The chart row fills the remaining column height so both columns end together. On narrow screens the sections stack.

Selecting a timeline bar, module name or programme-chart row updates the focused module and its progress chart. The month and session filters remain unchanged. The existing module filter controls the same selection.

## Timeline

The first column is the month of the learner start date displayed in the dashboard header. A window always contains twelve months, including months in the following calendar year. The period selector moves between windows anchored to that start month. January is the fallback when a learner start date is unavailable. Bars, review markers and the today marker use the same equal-month positioning calculation, including leap years.

## Progress measures

The owner selected equal weighting of the five measures for each module's programme-chart progress:

| Measure | Calculation |
| --- | --- |
| Attendance | Attended occurrences divided by occurrences with a recorded attendance mark. Cancelled/deleted and unmarked sessions are excluded. |
| Activities | Completed activities divided by assigned activities, using the existing merged completion rules. |
| Hours | Accepted historical hours for the subject plus directly recorded hours attributed by component/quiz identity, divided by the module's planned OTJH. |
| KSBs | Achieved activity KSB point occurrences divided by mapped point occurrences. A repeated code on a different activity counts separately, matching dashboard KSB totals. |
| Reviews | Completed programme reviews divided by planned reviews dated within the module's inclusive start/end dates. A rescheduled date takes precedence over the target date. Cancelled reviews and student support sessions are excluded. |

Each percentage is capped at 100 before averaging. The module chart displays the underlying counts and uncapped recorded hours. Missing data and a missing/zero denominator are N/A, not zero progress; the average uses available measures and explicitly displays how many of the five are available. A module with no available measures has no aggregate percentage. The timeline's existing activity-completion percentage remains an activity measure.

Compact plan summaries now include KSB completed/total counts and directly recorded hours. Historical and current summaries are combined only through verified Builder links. Recorded hours are never assigned by matching module titles, and ambiguous quiz-to-module links are not guessed. These additions read existing data and require no schema changes.

## Rewards

`GET /learner_api/rewards-summary/{kind}/{id}/` uses the existing learner-self-or-staff permission boundary and verifies the selected enrolment exists. It calls the authoritative engagement points summary for that learner, including reserved claims, and returns up to three active rewards with remaining stock. The dashboard displays available, earned and committed points and links learners to the existing rewards page. Staff previews show the selected learner's balance without a link to redeem rewards from the staff account.

Rewards refresh through the shared live-read mechanism and retain the last successful snapshot during failures. No points are awarded and no claims are created by this dashboard section.

## Verification

Regression tests cover the five-measure average, missing data, over-target hours, review date boundaries/rescheduling, combined historical/current KSB and hour totals, learner isolation, rewards refresh/retry, cross-year timeline windows, and existing dashboard interactions. Backend tests use `SimpleTestCase` with mocked sources, which prohibits database access.
