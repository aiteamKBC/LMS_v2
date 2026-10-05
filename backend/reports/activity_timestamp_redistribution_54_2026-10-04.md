# Activity timestamp redistribution — 54 learners

Database: `neondb`
Mode: read-only dry run
Fingerprint: `7bae4ba1bcd0b7db9ab02f48d35c78d7070581b705fd73796bd6fae28310e313`

## Summary

| Status | Rows | Hours |
|---|---:|---:|
| `PRESERVED_ATTENDANCE_WITH_TIME` | 352 | 1274:37:22 |
| `PRESERVED_BLOCKED` | 138 | 638:01:10 |
| `READY` | 9645 | 9896:22:34 |
| `TIME_MISSING` | 625 | 1577:30:00 |

## Totals

- SSOT Accepted before: **12870:26:47**
- Old LMS proposed addition: **0:00:00**
- SSOT Accepted after: **12870:26:47**
- Aptem accepted benchmark: **10764:11:00**
- After minus Aptem: **2106:15:47**

Reviewed Old-LMS candidates considered: **4086**
Blockers: **763**

## Rules

- Attendance rows and Attendance source tables were not changed.
- Old Schema and Aptem mirror are read-only.
- No hard delete: existing segment rows are updated or retained; new rows are inserted only when needed.
- Every scheduled interval equals actual_seconds exactly.
- Daily 8h/8 activities, monthly 45h, weekday/holiday/lecture/break/cutoff checks applied.
- Date-only Attendance is `TIME_MISSING`, not fabricated.

## First blockers

- `TIME_MISSING` learner `17825` progress `878889` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `17825` progress `878890` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `17825` progress `878891` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `17825` progress `878892` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `17825` progress `878893` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491413` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `1797` progress `574646` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `1797` progress `574650` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `1797` progress `574651` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `1797` progress `574652` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `1797` progress `574656` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `1797` progress `574657` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `1797` progress `574660` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491457` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491459` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491496` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491497` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491498` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491499` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491549` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491550` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491551` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491552` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527474` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527475` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491576` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491577` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491578` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491598` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491599` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491600` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527501` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527502` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527503` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491606` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491607` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491608` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491609` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491611` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491612` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491614` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491615` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491616` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491617` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491618` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527556` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `5144` progress `491624` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527520` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527521` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527522` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527523` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527555` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527557` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437552` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437553` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437582` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437584` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437585` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437623` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437624` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437625` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437655` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437656` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437658` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437662` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437663` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437664` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437665` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437667` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437668` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437669` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437670` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437672` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437673` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437674` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437675` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437676` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437678` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437679` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437680` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437681` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437683` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437684` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437685` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437686` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437688` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `4407` progress `437689` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527613` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527645` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `806` progress `527646` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `17045` progress `448952` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `1428` progress `540642` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `16001` progress `473044` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `16001` progress `473045` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `16001` progress `473046` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `17429` progress `449321` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `17922` progress `449505` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `16001` progress `473047` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `16001` progress `473048` ref `` — Attendance has a date/status but no original start/end.
- `TIME_MISSING` learner `16001` progress `473039` ref `` — Attendance has a date/status but no original start/end.
