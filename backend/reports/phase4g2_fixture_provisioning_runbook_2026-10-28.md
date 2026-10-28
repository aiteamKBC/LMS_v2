# Phase 4G.2 Fixture Provisioning and Cleanup Runbook

Status: **PREPARED, NOT EXECUTED**

This runbook is limited to Neon project `green-term-97168878`, branch
`lms_ideal_test` (`br-orange-shadow-abm8uwwe`), database `neondb`. It does not
authorise a fixture write, a `SECURITY DEFINER` function, a grant, or a branch
extension. Those operations require a separate approval immediately before
execution.

## Fixed inputs and output

The provision operation accepts only:

- `namespace`: `phase4g_` followed by a canonical lowercase UUID without
  braces. It is used for every synthetic ref and display value.
- `token_hash`: 64 lowercase hexadecimal characters containing only the
  SHA-256 digest of a client-generated random session token. Plaintext never
  enters PostgreSQL or a report.
- `expires_at`: between 30 and 90 minutes after database `clock_timestamp()`.

The derived email is `<namespace>@example.invalid`. The operation returns one
immutable JSON receipt containing the namespace, database/branch/endpoint,
created timestamp, the seven singleton IDs, and the ordered 357 progress IDs.
The receipt contains neither credentials nor the plaintext session token.

## Provision preflight (one transaction)

1. Take `pg_advisory_xact_lock(hashtextextended('phase4g.fixture', 0))`.
2. Reject unless `current_database()='neondb'`,
   `current_setting('neon.branch_id', true)='br-orange-shadow-abm8uwwe'`, and
   `current_setting('neon.endpoint_id', true)='ep-dawn-block-ab5vob3x'`.
3. Reject a malformed namespace, token hash or expiry.
4. Reject if the email, namespace, token hash, enrolment UUID, programme,
   cohort, group, module ref, week ref or component ref already exists.
5. Snapshot the exact sequences used by the eight target tables and counts in
   `login` audit/invitation/reset tables, Learner attendance/read-model tables,
   and Engagement reward outbox/saved-progress tables. These values are only
   for containment assertions; they are not cleanup selectors.

## Exact insert manifest

Insert exactly 364 rows in this order, using `RETURNING id` after every step:

1. One `enrolment."Created_users"`: generated UUID; `Learner_type` and `Type`
   `apprenticeship`; `Username` and `Email` set to the reserved email;
   `Programme`, `Cohort`, `Group`, and `Status` namespaced/active;
   `Invite_to_platform=false`; no employer, invitation, phone or real-person
   data; `Learning_plan` contains only the single namespaced module/week/
   component; `Free_courses=[]`.
2. One `"Learner".learners`: same UUID/email, `enrolment_id` from step 1,
   namespaced full name/programme/cohort/group, active lifecycle,
   `learner_type='apprenticeship'`, and the same one-component learning plan.
   Then set only the step-1 row's `learner_id` to this returned ID.
3. One `login."Login_accounts"`: `Subject_type='learner'`, `Subject_id` from
   step 1, `Role='learner'`, reserved email, `Password_hash=''`, active, zero
   failed attempts.
4. One `login."Login_sessions"`: account ID from step 3, supplied token hash,
   supplied expiry, `Last_seen_at=Expires_at`, `Remember=false`, loopback-only
   metadata.
5. One `"Learner".learner_training_plan_modules`: learner ID from step 2,
   position 0 and namespaced ref/title; curriculum FK is null.
6. One `"Learner".learner_training_plan_weeks`: module ID from step 5,
   position 0 and namespaced ref/title; curriculum FK is null.
7. One `"Learner".learner_training_plan_components`: week ID from step 6,
   position 0, namespaced ref/title, `component_type='component'`; curriculum
   FK is null.
8. 357 `"Learner".learner_progress_entries`: learner/component IDs from steps
   2/7, `entry_order=1..357`, `kind='component'`, namespaced refs/titles,
   `component_type='component'`, `submitted_at=NULL`,
   `time_tracking_session_ref=''`, `source_system=''`,
   `source_activity_id=''`, `source_attempt_key=''`,
   `canonical_activity_key=''`, `source_payload={}`,
   `kbc_attendance_key=NULL`, and no evidence or real-content reference.

The null `submitted_at`, empty time-tracking session and null attendance key
are mandatory trigger-containment values. Current metadata shows one reward
policy, 31 enabled reward configurations and 364 reward sessions. The active
Engagement trigger would therefore be unsafe if those values changed.

## Provision containment assertions before commit

Reject and roll back unless all of these are true:

- returned IDs are distinct and the eight-table insert count is exactly 364;
- all relationships point only to receipt IDs and all 357 entry orders exist;
- the reserved email/namespace resolve to exactly one enrolment, Learner,
  account and session;
- zero `Engagement.shared_reward_outbox` and
  `Engagement.shared_reward_saved_progress` rows reference the progress IDs;
- zero attendance link is set on any progress row;
- no invitation, password reset, login audit, attendance, reward, read-model,
  notification or external-integration row was added for the receipt identity;
- no target row refers to a real curriculum, employer, coach or learner row.

Any failed assertion raises an exception, so the whole transaction rolls back.

## Cleanup preflight and exact order

Cleanup accepts only the original receipt. It takes the same advisory lock and
repeats the exact database/branch/endpoint check. It rejects a changed receipt,
wrong cardinality, namespace mismatch, missing target row, or any target row
whose identity/relationship no longer matches the receipt.

Before deletion, it must explicitly assert that no non-receipt dependent row
references the enrolment, profile, account, plan or progress IDs. This includes
all current foreign-key consumers in `Coach`, `Learner`, `chat`, `curriculum`,
`enrolment` and `login`, plus both Engagement trigger targets. Unknown/new
foreign keys are detected by comparing the live `pg_constraint` dependency
set with the reviewed dependency-set fingerprint; a mismatch aborts cleanup.

Delete by exact primary-key arrays only, never by email/title pattern and never
by wildcard or discovered cascade:

1. 357 progress IDs;
2. the plan component ID;
3. the plan week ID;
4. the plan module ID;
5. the session ID;
6. the account ID;
7. clear only the receipt enrolment's circular `learner_id`, then delete the
   Learner profile ID;
8. delete the enrolment ID.

After each step, require the exact expected affected-row count. Before commit,
verify zero residue by every receipt ID and namespace key, zero dependent rows,
and zero Engagement/attendance/read-model side effects. Sequence advancement is
expected and is not reset. Any unknown dependency or row-count mismatch aborts
cleanup for manual inspection; it never broadens deletion.

## Capability design (still unapproved)

If separately approved, the reviewed implementation is two owner-defined,
fixed-body functions in a locked `benchmark_admin` schema with
`SET search_path=pg_catalog`. `lms_fixture_provisioner` receives only schema
USAGE and EXECUTE on those exact signatures; it receives no table, sequence,
schema-create, role, or general function privileges. The provisioner currently
has no password and no such functions/grants exist, so this runbook cannot
mutate the branch as delivered.
