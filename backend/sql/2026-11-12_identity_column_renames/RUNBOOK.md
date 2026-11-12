# Identity column renames: runbook

Renames 27 identity columns so their names say which ID they hold. No value
changes, no table drops. Not yet approved: nothing here has been run.

## Covered

| Group | Tables | Old column | New column | Holds |
| --- | --- | --- | --- | --- |
| Engagement/Feedback | 15 | `learner_id` | `enrolment_id` | `enrolment."Created_users".id` as text |
| Enrolment wizard/ILR | 9 | `"Learner_id"` | `enrolment_id` | `enrolment."Created_users".id` |
| Chat | 3 | `learner_id`, `sender_learner_id`, `recipient_learner_id` | `*_profile_id` | `"Learner".learners.id` |

## Deliberately not covered

- **Coach tables** (`coach_calendar_event` and nine others). The Python names
  are already renamed (state-only migration `coach_api 0040`), but the
  columns stay `learner_id`. `coach_calendar_event` mixes profile and
  enrolment IDs in live data (52 of 233 rows on 2026-11-12), so a column
  named `learner_profile_id` would be false until its writers and data are
  fixed.
- **learner_api review/document tables** (`"Learner_id"` on reviews, ILR,
  training plan, agreements): Python names only for now.

## Order

1. Merge and deploy the code with `db_column` shims (the current change).
   Apply the state-only migrations: `coach_api 0040`, `engagement_api 0013`,
   `enrolment_api 0003`. They issue no SQL.
2. On the target, apply `engagement_api` up to `0012` first. On 2026-11-12
   Development stopped at `0007`, and recorded it under its older name
   `0007_feedbackdeliveryquestion_feedbackreviewdelivery`; the repository now names
   that migration `0008_…` and adds a new `0007_feedback_lecture_creation_guard`. So
   `migrate` will run `0007` (a new trigger guarding lecture feedback deliveries,
   added 2026-10-27), `0008` (state only, no SQL), both `0009`s, `0010` (creates
   `feedback_employer_review_deliveries`), `0011` and `0012`. All DDL is
   `IF NOT EXISTS` or replace-in-place. The preflight checks the two things that could
   reject existing data: form types outside the new CHECK list, and duplicate general
   responses. These must run before step 5, because `0010` builds an index on
   `learner_id` by name. The orphan history row under the old `0007` name is
   harmless: Django ignores names it doesn't know.
3. Run `00_preflight_readonly.sql`. Every row `ok`, no function rows.
4. Take a Neon restore point.
5. In one maintenance window:
   - run `01_rename_columns.sql`;
   - deploy the follow-up code that removes the shims (engagement
     `db_column='learner_id'`, enrolment `db_column="Learner_id"`, chat
     `db_column` back to the `*_profile_id` names) with its matching
     state-only migrations;
   - restart services (`systemctl restart 'lms-*.service'`).
   Code with shims cannot read renamed columns and vice versa, so these
   steps go together.
6. Run the verify query at the end of `01`. Smoke-test chat, events/RSVP,
   rewards, feedback forms and the enrolment wizard.

## Rollback

`99_rollback.sql` reverses `01` exactly (values never changed), then
redeploy the shim code. If the restore point is needed instead, restore and
redeploy the shim code.
