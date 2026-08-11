# Learner Journal suspicious-data report

Generated for **2026-08-11**. Engineering is permitted through **2026-08-01**; later rows must be fetched-source values.

Total findings: **6,913**

## Severity summary

| Severity | Findings |
|---|---:|
| CRITICAL | 551 |
| HIGH | 5,806 |
| MEDIUM | 556 |
| LOW | 0 |

## Finding summary

| Issue | Findings |
|---|---:|
| `FUTURE_ACTIVITY_HAS_PROGRESS` | 3,166 |
| `CLAIMED_GT_APTEM_ACTUAL` | 2,492 |
| `CLAIMED_OVER_MONTHLY_BOUND` | 490 |
| `TITLE_DATE_MISMATCH` | 454 |
| `SYSTEM_TIMESTAMP_BANK_HOLIDAY` | 125 |
| `PRESENT_ATTENDANCE_MISSING_HOURS` | 102 |
| `FETCHED_ATTENDANCE_OVER_WORKDAY` | 61 |
| `FETCHED_ATTENDANCE_OVER_SESSION_NORM` | 20 |
| `INVALID_DATE_IN_ACTIVITY_TITLE` | 3 |

## Interpretation

- `ENGINEERED_VALUE_AFTER_CUTOFF` and `INVALID_ACTIVITY_YEAR` should remain zero after remediation.
- Fetched attendance is reported exactly after the cutoff; large or contradictory values are highlighted, not altered.
- Future progress, title/date mismatches, and monthly comparisons are potential anomalies requiring source review; they are not automatically corrections.
- Bank-holiday checks use the authoritative GOV.UK calendar: https://www.gov.uk/bank-holidays.json
- The CSV contains the complete row-level evidence and comparison values.
