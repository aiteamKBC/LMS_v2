# Learner runtime recovery follow-up

Date: 29 October 2026 (Africa/Cairo)  
Scope: continuation of `learner_post_oct29_full_regression_report.md`  
Verdict: **PARTIALLY VERIFIED**

## 1. Executive result

The local backend is connected to the intended `lms_ideal_test` Neon branch through the scoped `lms_local_runtime` role. Both Django aliases resolve to the same verified endpoint and database. No Production or architecture database was contacted.

The active backend process still predates the Calendar and Attendance source fixes. It was started at 14:40:06 and the two source files were modified at 15:37-15:39. The launcher deliberately invokes Django with `--noreload`, so the browser cannot be testing those later edits until the process is restarted.

The Calendar, Attendance and optional coach-phone column-permission failures were repaired with the three approved column-level grants. The grants were verified both in the granting transaction and through the runtime role. The old backend was then replaced with the same pinned launcher, and real authenticated HTTP checks returned 200 for Header, Calendar and both Attendance reads.

One previous schema conclusion is corrected: `curriculum.learner_review_additions` is **present** on `lms_ideal_test`. It appeared absent because the runtime role has no table or column privilege, and the project's schema gate lists `information_schema.tables`, which hides relations for which the current role has no privilege.

## 2. Confirmed runtime identity

Sanitized launcher verification returned:

- Branch: `lms_ideal_test`
- Branch ID: `br-orange-shadow-abm8uwwe`
- Endpoint ID: `ep-dawn-block-ab5vob3x`
- Database: `neondb`
- Role: `lms_local_runtime`
- Aliases: `default`, `enrolment`
- Authentication writes: scoped
- Learner writes: denied

The launcher pins these values in `backend/run_lms_ideal_test_server.py:20-24` and checks both aliases in `backend/run_lms_ideal_test_server.py:187-220`. The live listener is PID `22520`, started at `2026-10-29 14:40:06 +03:00`, from:

```text
python.exe -B .\run_lms_ideal_test_server.py
```

The launcher replaces this with `manage.py runserver 127.0.0.1:8000 --noreload` at `backend/run_lms_ideal_test_server.py:223-236`.

## 3. Exact permission findings

Read-only catalog inspection was run through both aliases. Results were identical:

- `USAGE` is already granted on schemas `Coach`, `enrolment`, and `curriculum`.
- Table-level `SELECT` is false for all three blocker tables.
- Column-level `SELECT` is false for every column in all three blocker tables.

The requests need only these columns:

| Relation | Required columns | Evidence and effect |
|---|---|---|
| `Coach.coach_meeting_attendance` | `event_key`, `role`, `is_current`, `total_attendance_seconds` | Calendar outcome query at `backend/coach_api/meeting_outcomes.py:52-63`; catch-up query at `backend/learner_api/catchup_outcomes.py:21-29`. Missing access causes Calendar 502 and a caught Attendance failure. |
| `enrolment.Employers` | `id`, `Email` | Attendance manager lookup at `backend/learner_api/attendance_mode.py:32-41`. The query is now projected to these two columns only. Missing access causes Attendance 502. |
| `enrolment.Staff_users` | `id`, `Email`, `Phone_number` | Optional coach-phone lookup at `backend/learner_api/training_plan_dashboard.py:249-258`. `first()` orders by the primary key. Missing access is caught, so the header remains 200 but the phone is omitted and a 42501 is logged. |

### Executed minimum SQL

The following was executed by the owner role only after re-verifying branch ID `br-orange-shadow-abm8uwwe`, endpoint `ep-dawn-block-ab5vob3x`, database `neondb`, role `lms_local_runtime`, the exact table columns, and the previous absence of SELECT permission:

```sql
BEGIN;

GRANT SELECT (event_key, role, is_current, total_attendance_seconds)
ON TABLE "Coach".coach_meeting_attendance
TO lms_local_runtime;

GRANT SELECT (id, "Email")
ON TABLE enrolment."Employers"
TO lms_local_runtime;

GRANT SELECT (id, "Email", "Phone_number")
ON TABLE enrolment."Staff_users"
TO lms_local_runtime;

COMMIT;
```

Security impact:

- No write privilege, ownership, schema creation, role membership, or unrelated table access is added.
- Meeting access excludes learner names, emails, raw Graph payloads, report IDs, and attendance record IDs.
- Employer access excludes names, address, phone, groups, signature and audit timestamps.
- Staff access excludes account status, role/access fields, signatures, personal details and organization fields.
- These grants are sufficient for the current SQL projections but do not authorize broader ORM hydration in future code.

Post-commit verification through `lms_local_runtime` confirmed:

- Exactly the reviewed columns report `SELECT = true`.
- Table-level `SELECT` remains false for every relation.
- `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` remain false for every relation.
- Read-only zero-row SELECTs using each exact projection execute successfully.

Suggested read-only verification after an approved grant:

```sql
SELECT
  has_column_privilege('lms_local_runtime', '"Coach".coach_meeting_attendance', 'event_key', 'SELECT') AS meeting_event_key,
  has_column_privilege('lms_local_runtime', 'enrolment."Employers"', 'Email', 'SELECT') AS employer_email,
  has_column_privilege('lms_local_runtime', 'enrolment."Staff_users"', 'Phone_number', 'SELECT') AS staff_phone;
```

## 4. Source compatibility verification

Calendar now loads only `id`, `username`, `email`, `aptem_id`, and `programme_status` from the source row (`backend/learner_api/calendar.py:49,1573`). It no longer hydrates the missing `Created_users." Status"` column.

Calendar profile resolution uses `canonical_learning.profile()` and `profile_from_owner()` (`backend/learner_api/calendar.py:52-62`). The canonical projection joins `Learner.learners.programme_id` to `curriculum.programmes`; it does not select missing `Learner.learners.programme`. The normalized programme ID/name mapping is covered at `backend/learner_api/test_programme_reference_no_db.py:27-64`.

Attendance removes `programme` from `ATTENDANCE_SOURCE_FIELDS` (`backend/learner_api/attendance_lectures.py:32-33`) and calls the existing read-only programme adapter after the projected source load (`backend/learner_api/attendance_lectures.py:1252-1255`). The adapter resolves normalized `Created_users.programme_id` to the curriculum display name and preserves the legacy-column fallback only for schemas that still use it.

This follow-up also tightened the Attendance employer lookup to `.only('id', 'email')` at `backend/learner_api/attendance_mode.py:32-41`, avoiding unnecessary access to employer address, signature and profile data. Its projection test is at `backend/learner_api/tests_attendance_lectures.py:1248`.

## 5. Runtime restart result

Before termination, port 8000 was rechecked and still belonged to PID `22520` running the expected `backend/.venv/Scripts/python.exe -B .\run_lms_ideal_test_server.py`. Only that PID was stopped. Port 8000 was confirmed free, then the same pinned launcher was started.

The replacement listener is PID `26788`, started at `2026-10-29 16:06:47 +03:00`, with the same command. Startup reported the expected branch, endpoint, database and runtime role; Django system checks reported zero issues. The existing 185-unapplied-migrations warning was not acted on.

The executed procedure was:

1. Reconfirm the exact listener and command:

   ```powershell
   $listener = Get-NetTCPConnection -State Listen -LocalPort 8000 | Select-Object -First 1
   Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" |
     Select-Object ProcessId, CreationDate, CommandLine
   ```

2. Stop it with `Ctrl+C` in the PowerShell window that launched it. If that window is unavailable, first reconfirm that the owner is still PID `22520` and the command is the verified launcher, then use the scoped non-forced stop:

   ```powershell
   Stop-Process -Id 22520
   ```

3. Confirm port 8000 is free:

   ```powershell
   Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue
   ```

4. Start exactly the pinned launcher:

   ```powershell
   cd D:\aiTeam\LMS_v2\backend
   .\.venv\Scripts\python.exe -B .\run_lms_ideal_test_server.py
   ```

5. Require its sanitized startup JSON to show branch ID `br-orange-shadow-abm8uwwe`, database `neondb`, endpoint `ep-dawn-block-ab5vob3x`, and role `lms_local_runtime` before using the UI.

The new process still uses `--noreload` internally; that is expected. This restart loaded the current files once.

## 6. Reviews table finding

`curriculum.learner_review_additions` and its primary/unique/supporting indexes exist on the target branch. All 13 columns currently report `SELECT = false` for `lms_local_runtime`.

The false “missing table” diagnosis arose because `schema_gate._existence_query()` and `_listing_query()` use `information_schema.tables` (`backend/curriculum_api/schema_gate.py:153-175`). PostgreSQL omits a table from that view when the current role has no privilege on it. The gate therefore raises `SchemaNotProvisioned` even though the catalog relation exists.

The table is the canonical store for coach-created additional Reviews. It is used by `ensure_learner_review_additions_table()` (`backend/curriculum_api/review_instances.py:276-285`) and merged into the learner's generated Review occurrences by `resolve_learner_manual_occurrences()` (`backend/curriculum_api/review_instances.py:580-613`). Generated programme Reviews continue because the manual-addition reader catches the failure and returns an empty list.

There is no alternate table or canonical replacement. The repository contains the forward SQL at `backend/sql/2026-09-15_curriculum_learner_review_additions.sql`; no Django migration for this table was found. The SQL has already been applied on this branch, so table creation or migration is not required here.

Current read functions use `SELECT *`. Enabling manual additions for this role would therefore need table-wide `SELECT`, or a separate reviewed source projection before a narrower column grant. No such grant or source expansion was made in this task. This is not a core page-load blocker because of the fail-safe, but it is a functional release blocker if coach-created additional Reviews must appear to learners.

## 7. Tests and runtime checks

Safe focused tests used `DJANGO_USE_SQLITE=1` and only `SimpleTestCase`; no Neon test database or learner data was created or modified.

- **PASS: 81/81** focused tests covering Builder dates, Training Plan dashboard, Attendance learner lookup, Attendance mode, Calendar/programme projection, and the new Employer projection.
- A broader invocation ran 91 test methods and recorded **13 failure entries**, all in `test_historical_cross_role_routes`. Every failure was `DatabaseOperationForbidden`: that SimpleTestCase harness did not mock the now-reached reconciliation query. It is test-harness drift, not a PostgreSQL or assertion mismatch. No Neon query was allowed by that runner. A pass count is deliberately not inferred from `91 - 13`, because several entries are subtest failures within the same test method.
- `git diff --check`: PASS.

An approved synthetic learner session was created through the normal auth session mechanism without using a password or modifying Learner data. It was revoked in a `finally` block. Final verification found zero active synthetic sessions and one revoked test session.

Actual HTTP requests were sent to the restarted backend on `127.0.0.1:8000`:

| Path | Current evidence | State |
|---|---|---|
| Login/session | Synthetic server-side session resolved and was revoked afterward; anonymous requests returned 401 | VERIFIED for this synthetic session |
| Home | Prior isolated 200 | Not authenticated HTTP verified in this follow-up |
| Dashboard Header | Actual HTTP 200 in 6.517 s; required minimal-header contract present | VERIFIED for learner 101 |
| Weekly | Prior isolated 200 | Not authenticated HTTP verified |
| Monthly | Prior isolated 200, very slow | Not authenticated HTTP verified |
| Overview | Prior isolated 200 | Not authenticated HTTP verified |
| Training Plan | Prior isolated 200 | Not authenticated HTTP verified |
| My Learning | Prior isolated 200 | Not authenticated HTTP verified |
| Quiz | Unit/frontend coverage only | NOT TESTED at authenticated runtime |
| Student Activity | Prior isolated 200 | Not authenticated HTTP verified |
| Calendar | Actual HTTP 200 in 13.000 s; `learner`, `events`, and `bookingCalendar` contract present; 272 events | VERIFIED for learner 101 |
| Attendance lectures | Actual HTTP 200 in 16.352 s; full workspace contract present; 142 lectures | VERIFIED for learner 101 |
| Attendance summary | Actual HTTP 200 in 20.584 s; JSON `attendance` contract present | VERIFIED for learner 101 |
| Evidence | No safe runtime check | NOT TESTED |
| Reviews | Generated Reviews fail safe; manual additions hidden | PARTIAL / permission blocked |

Permission-boundary HTTP results:

- Anonymous Header, Calendar and Attendance lectures: 401.
- The authenticated learner requesting learner ID 102 for Header, Calendar and Attendance lectures: 404, preserving cross-learner non-disclosure.
- Self Header, Calendar, Attendance lectures and Attendance summary: 200.
- No tested request returned 502 or 503.
- Captured Django output for the tested paths contains no SQLSTATE 42501 or 42703 and no database-error traceback from the three repaired relations.
- Header's `coach.phone` was absent in this learner's payload, but the endpoint completed without the former Staff_users permission error; absence remains a valid optional-field result.

## 8. Changes made in this follow-up

- `backend/learner_api/attendance_mode.py`: projected Employer lookup to `id` and `Email` only.
- `backend/learner_api/tests_attendance_lectures.py`: added a regression test for that exact projection.
- `backend/reports/learner_runtime_recovery_followup.md`: this report.

The three reviewed column-level SELECT grants and the approved backend restart were performed. One short-lived synthetic auth session was issued and revoked. No schema change, migration, Learner-data write, Production/architecture access, branch, worktree, commit or push was performed.

## 9. Remaining gate and final verdict

Final verdict: **PARTIALLY VERIFIED**.

The approved recovery scope is complete: the grants are exact, the intended runtime was restarted, the three affected surfaces now return successful real HTTP responses, and anonymous/cross-learner boundaries remain closed.

Remaining blockers outside the approved repair:

1. `curriculum.learner_review_additions` still has no runtime SELECT permission. The table exists, but manual coach-created Review additions are omitted and warnings/tracebacks are logged on Header and Calendar reads. Generated Reviews continue.
2. The successful reads remain slow: Header 6.5 s, Calendar 13.0 s, Attendance lectures 16.4 s, and Attendance summary 20.6 s. This follow-up intentionally starts no new performance phase.
3. Other Learner routes retain their earlier isolated/unit-only coverage and were not converted into authenticated HTTP verification by this narrow repair.
