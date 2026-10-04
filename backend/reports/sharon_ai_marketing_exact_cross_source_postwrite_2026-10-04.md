# Sharon AI in Marketing — exact cross-source post-write

**Database:** `neondb`  
**Scope:** G1 Tuesday, G2 Wednesday, G3 Friday  
**Audit run:** `1711`  
**Method:** exact Aptem Evidence lineage + accepted Journal reference + equal duration + valid parent lineage. Ambiguous and duration-conflict rows were not changed.

## Result

The approved correction is already present and idempotent. A new dry-run now finds **0 new candidates**.

| Group | Aptem Accepted | Exact duplicate rows corrected | Hours corrected | Review rows remaining |
|---|---:|---:|---:|---:|
| G1 — Tuesday | 813:50:00 | 0 | 0:00:00 | — |
| G2 — Wednesday | 927:35:00 | 8 | 9:30:00 | — |
| G3 — Friday | 328:50:00 | 26 | 25:20:00 | — |
| **Total** | **2070:15:00** | **34** | **34:50:00** | **27** |

## Learners affected by the correction

| Group | Learner | Aptem ID | Rows corrected | Hours corrected |
|---|---|---:|---:|---:|
| G2 — Wednesday | Cheska Hardie | 4605 | 6 | 7:30:00 |
| G2 — Wednesday | Elisei Sergevnin | 4925 | 1 | 2:00:00 |
| G3 — Friday | Matthew Gilbert | 4929 | 20 | 15:50:00 |
| G3 — Friday | Douglas Sweetinburgh | 5256 | 3 | 9:30:00 |

## Verification

- Exact correction run: completed, not repeated.
- Corrected sources: `34`.
- Corrected duration: `34:50:00`.
- Remaining review rows: `27`, total `131:56:00`.
- Azure references checked: `631/631` found.
- LMS rows excluded by this run: `0`.
- Aptem mirror and original Evidence were not deleted or modified.
- Current decision: **REVIEW**, because the remaining 27 rows are not exact, safe duplicates.

The full Sharon write report remains available at [sharon_ai_marketing_final_2026-10-04.md](<C:/Users/ayman/Desktop/LMS_T/LMS_v2/backend/reports/sharon_ai_marketing_final_2026-10-04.md>).
