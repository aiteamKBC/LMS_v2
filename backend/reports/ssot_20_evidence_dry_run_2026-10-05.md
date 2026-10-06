# SSOT 20 Learners — Evidence Dry Run

**Run date:** 2026-10-05  
**Mode:** Read-only; no database write performed  
**Database:** `neondb`  
**Scope:** 20 learners currently below Aptem within the 54-learner roster

## What was read

- `fetching_evidence.evidence_items` — accepted Aptem Evidence and `spent_time`.
- `Learner.learner_progress_entries` — accepted, non-deleted SSOT actual seconds.
- `Learner.learner_activity_sources` — source lineage and duplicate guard.
- `Learner.learner_activity_reporting_segments` — existing timestamps.
- `Learner.learner_journal_rows` — alternate Journal records.
- `Learner.source_lms_attendance` — attendance/lecture cross-check.
- `Learner.source_lms_actual_hours` — Old Schema comparison.

## Current totals

| Measure | Value |
|---|---:|
| Learners below Aptem | 20 |
| Aptem accepted positive Evidence | 876 rows / 3995:02:00 |
| Aptem total for all 54 | 10764:11:00 |
| SSOT total for all 54 | 12870:26:47 |
| Current deficit across the 20 | 663:20:02 |

## Evidence classification

| Classification | Rows | Evidence hours | Meaning |
|---|---:|---:|---|
| `ALREADY_REPRESENTED` | 33 | 120:05:00 | Do not add |
| `LINEAGE_ZERO_HOURS` | 279 | 1605:44:00 | Existing SSOT lineage; repair candidate, not a new row |
| `DURATION_CONFLICT` | 243 | 1219:40:00 | Requires source-based duration decision |
| `ATTENDANCE_REVIEW` | 94 | 230:45:00 | Requires Lecture Name/date cross-learner check |
| `ALTERNATE_JOURNAL_POSITIVE` | 49 | 200:30:00 | Verify whether Journal is already represented |
| `JOURNAL_ZERO_OR_METADATA_ONLY` | 20 | 54:00:00 | No positive alternate hours found |
| `NEW_EVIDENCE_CANDIDATE` | 152 | 554:48:00 | No Evidence-ID lineage found; still needs final checks |
| `BLOCKED_OUTSIDE_PERIOD` | 6 | 09:30:00 | Outside Aptem Start/End; not eligible automatically |

## Additional Hours scan

- Accepted Additional Evidence in this 20-learner scope: **30 rows / 178:45:00**.
- Already represented exactly in SSOT: **22 rows / 131:30:00**.
- Source/lineage or duration review: **8 rows**.
- Additional Hours alone cannot close the whole deficit; the broader Evidence reconciliation is required.

## Write status

No `learner_progress_entries`, `learner_activity_sources`, segments, documents, Journal rows, Attendance rows, or Aptem mirror rows were changed.

The next write, if approved, must use the official backend path, one learner/month transaction at a time, with idempotency and audit history.
