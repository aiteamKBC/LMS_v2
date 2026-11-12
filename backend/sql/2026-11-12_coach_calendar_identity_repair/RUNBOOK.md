# Coach calendar identity repair: runbook

Not yet approved: nothing here has been run.

## The problem

`"Learner".coach_calendar_event.learner_id` holds two kinds of ID: the learner
profile ID (`"Learner".learners.id`) and the enrolment ID
(`enrolment."Created_users".id`). The two are independent sequences, so a number can
name two different people. On 2026-11-12 the Development snapshot had:

| Rows | Namespace (from `Coach.coach_calendar_event_learner_link`) |
| --- | --- |
| 179 | profile (1 also historically verified) |
| 52 | enrolment |
| 1 | unresolved: event 178, `mcr`, verified by unique email |
| 1 | no link row: event 289, an unscheduled `lms-introduction` request |

The enrolment-keyed rows came from three writers:

| Writer | Rows | Fixed by |
| --- | --- | --- |
| `login/lms_introduction.py` (always `Created_users.id`) | 25 | LMS code change |
| Learner self-booking of the first session before the profile is Active (`learner_api/calendar.py`) | 21 | LMS code change |
| Communication_Centre `callcentre/lms_booking.py` (`callcentre:` keys, raw SQL) | 6 | `external/communication_centre_calendar_profile_id.patch` in the identity bundle |

Under the old reader rule (`_record_owner_ids`, "either ID or email"), 39 events
could be matched to 32 learners other than the attendee by number alone. The LMS
code change closes that whatever the data state: an ID match never overrides
another learner's email.

## Order

1. Deploy the LMS code change. Apply the Communication_Centre patch in that
   repository through its own review.
2. Run `00_preflight_readonly.sql` on the target. Expect 52 / 52 / 0 / 0 / 0, or
   re-investigate.
3. Take a Neon restore point.
4. Run `01_repair.sql`. It changes `learner_id` only, keeps the previous values in
   `"Coach".coach_calendar_identity_repair_20261112`, and aborts unless every row
   then resolves as a profile.
5. Review events 178 and 289 by hand. Neither is changed.

Event keys keep the number they were created with (for example
`first-session:<Created_users id>:1:<date>`). They are identifiers, not ownership,
and absence reports and Graph reconciliation reference them, so they are never
rewritten.

## Rollback

`99_rollback.sql` restores each row's previous `learner_id` from the audit table.
The code change is safe with or without the repair.
