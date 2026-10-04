# Old LMS → SSOT reconciliation (54 learners)

Database: `neondb`  
Mode: post-write verification dry run; this report generation was read-only.

Fingerprint: `8b262a1b0bfb23b752a80001a9d226f16b7b530e3b4b3fe027639cd6de68bb32`

## Summary

| Status | Rows | Hours |
|---|---:|---:|
| `ATTENDANCE_DURATION_CONFLICT` | 659 | 1647:30:00 |
| `BLOCKED_BREAK` | 233 | 95:27:04 |
| `BLOCKED_OUTSIDE` | 120 | 18:03:23 |
| `BLOCKED_TIMESTAMP_CAP` | 1283 | 1018:02:14 |
| `EVIDENCE_DURATION_CONFLICT` | 1 | 5:00:00 |
| `NEW_ESTIMATED` | 2794 | 1789:31:37 |
| `NEW_LEGITIMATE` | 9 | 4:27:26 |
| `REF_DURATION_CONFLICT` | 2230 | 1395:49:27 |
| `REF_EXACT_DURATION` | 1176 | 654:21:34 |
| `REF_MONTH_CONFLICT` | 385 | 233:49:50 |
| `REF_MONTH_CONFLICT_EXACT` | 30 | 11:24:27 |
| `SOURCE_REF_DURATION_CONFLICT` | 272 | 123:40:25 |
| `SOURCE_REF_EXACT` | 14 | 4:04:12 |
| `SOURCE_REF_OTHER_MONTH_CONFLICT` | 36 | 9:58:34 |
| `SOURCE_REF_OTHER_MONTH_EXACT` | 2 | 0:11:03 |

## Corrected 5358 cohort

| Status | Rows | Hours |
|---|---:|---:|
| `BLOCKED_BREAK` | 204 | 78:42:13 |
| `BLOCKED_OUTSIDE` | 112 | 10:37:23 |
| `BLOCKED_TIMESTAMP_CAP` | 1177 | 827:48:26 |
| `NEW_ESTIMATED` | 2429 | 1389:16:37 |
| `NEW_LEGITIMATE` | 9 | 4:27:26 |
| `REF_DURATION_CONFLICT` | 21 | 7:01:07 |
| `REF_EXACT_DURATION` | 725 | 424:24:28 |
| `REF_MONTH_CONFLICT` | 363 | 114:12:25 |
| `REF_MONTH_CONFLICT_EXACT` | 27 | 9:56:15 |
| `SOURCE_REF_DURATION_CONFLICT` | 241 | 107:08:37 |
| `SOURCE_REF_EXACT` | 14 | 4:04:12 |
| `SOURCE_REF_OTHER_MONTH_CONFLICT` | 34 | 9:24:58 |
| `SOURCE_REF_OTHER_MONTH_EXACT` | 2 | 0:11:03 |

Zero-hour rows ignored: **14267**
Previously approved alternate-source rows skipped: **104**

## Important controls

- Old Schema and Aptem mirror were not modified.
- Existing SSOT references in another month are review-only; no duplicate is inserted.
- Duration conflicts are not auto-resolved.
- Estimated timestamps require explicit approval before apply.
- Apply requires this fingerprint and the verified database name.

## Files

- CSV: `old_lms_ssot_reconciliation_54_2026-10-04.csv`
- JSON: `old_lms_ssot_reconciliation_54_2026-10-04.json`
