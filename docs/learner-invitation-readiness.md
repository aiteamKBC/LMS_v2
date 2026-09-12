# Learner preparation and invitation

Staff/admin can inspect the learner dashboard, assigned material, saved KSBs
and progress while the learner remains in `Delivery`. A saved profile no longer
implies `isActive: true`. Staff preview also works when there is no imported
activity history, so missing history cannot hide otherwise available data.

Commercial activation now needs all three conditions:

1. An assigned learning plan.
2. A recorded programme start date, or the assigned cohort's start date, that
   has arrived. An individual date takes priority over the cohort date.
3. A platform invitation with a successful send recorded in `Sent_at`.

Creating an account, reading/preparing data, and a failed invitation email do
not activate the programme. A successful invitation send rechecks that learner.
The invitation link still requires the learner to set their password before
password sign-in. Existing Active and terminal programme statuses are preserved.
The apprenticeship document progression is unchanged.

The staff dashboard displays **Ready to invite** when the invitation is the only
remaining condition. It displays **Invitation pending** when programme setup
also needs attention. The stored programme status remains Delivery until release.

## Read-only data verification — 12 September 2026

The readiness rules were evaluated against an in-memory snapshot obtained using
a PostgreSQL read-only transaction. No production records were changed and no
invitations were sent. The snapshot contains 369 learners:

| State | Learners |
| --- | ---: |
| Existing Active | 3 |
| Delivery, ready except for invitation | 349 |
| Delivery, plan missing | 7 |
| Delivery, cohort/start date missing | 7 |
| Delivery, both placement/date and plan missing | 2 |
| Delivery, programme starts on 1 October 2026 | 1 |

All 366 Delivery learners have a saved learner profile; 357 have a saved plan.
None of those 366 have a login account or a previously sent invitation in the
configured database. A group/cohort label alone does not guarantee that modules
have been assigned to it.

### Placement needs an owner decision

These nine records have neither a cohort nor a group recorded; do not assign a
different learner's group or infer a cohort just from their programme:

| Enrolment ID | Learner |
| --- | --- |
| 159 | JORDEN GUEST |
| 194 | Adam Edmondson |
| 275 | Ellis Smith |
| 304 | Hannah Killick |
| 372 | Lauren Sinclair |
| 397 | Martha Pitcher |
| 431 | Philip Durham |
| 437 | Rania Mohamed |
| 465 | Sienna Parkinson |

Adam Edmondson and Martha Pitcher also have no saved plan.

### Assigned groups without modules

Seven more learners have a placement but neither a saved plan nor any module IDs
on their assigned curriculum group. These belong to Associate Project Manager
Level 4; a similarly named group in a different programme is not a safe match.

| Enrolment ID | Learner | Group |
| --- | --- | --- |
| 154 | Jack Martin | AI in Project Control 2026 |
| 175 | Roy Blagg | Ray / PMP — June 2026 |
| 223 | Camila Leme Nelson | AI in Project Control 2026 |
| 234 | Chloe Howell | PCP Level 6 - October 2025 |
| 261 | Dillon Hodgkinson | AI in Project Control 2026 |
| 268 | Eleanor Cross | AI in Project Control 2026 |
| 336 | Janet Alderman | AI in Project Control 2026 |

Joshua Bowers (348) has a plan and a cohort beginning **1 October 2026**. Keep
that date rather than moving it backwards to activate him early.

Full snapshot: [readiness report](../reports/learner-invitation-readiness-2026-09-12.json).

## Optional date persistence

The UI and activation rules resolve cohort dates without a backfill. To persist
those dates for other consumers of the raw tables, the owner can run the exact
SQL in [prepare learner start dates](../backend/sql/2026-09-12_prepare_learner_start_dates.sql)
in Neon after deploying the code change. The script fills only missing dates,
preserves individual dates, and does not change any programme/account status or
plan. It does not invent placement or modules for the exceptions above.

The read-only projection of this SQL found 357 missing enrolment dates and 358
missing profile dates to fill; the extra profile is Mohamed Elmasry, whose own
recorded date is 4 November 2024. It preserves the 366 Delivery / 3 Active split.

## Validation

- 192 backend tests passed using `unittest` and Django `SimpleTestCase`, with
  both database aliases replaced by in-memory SQLite settings. No Django test
  database setup, schema creation or migration commands were run.
- 104 frontend tests passed across learner page rendering/recovery, sidebar
  gating and waiting-page copy. Includes admin/staff preview without invitation
  or historical activity, and the learner's own waiting page.
- The changed-file whitespace check passed.
- The repository-wide TypeScript check reports errors outside this change:
  `features/monthly-logs/MonthList.tsx`, `pages/admin/users/AccessPanel.test.tsx`,
  `pages/curriculum/programme-detail/SessionsTree.tsx`,
  `pages/curriculum/teams-meetings/page.tsx`,
  `pages/learner/evidence/historicalEvidence.test.tsx`, and the user/employer
  creation modals. It reported no errors in the invitation/readiness changes.

No migrations, commits, remote Git operations, database changes or real emails
were performed for this task.
