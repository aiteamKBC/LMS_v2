# SSOT 20 Learners — Row-level Dry-run Plan

**Mode:** Read-only; no SSOT/Aptem/Journal/Attendance write performed  
**Database:** `neondb`  
**Duration basis:** Aptem `spent_time` is stored in minutes and converted to seconds

The `Evidence potential` column is an upper-bound from accepted Evidence whose current SSOT lineage is absent or shorter. It is not an approval to write; Journal, Attendance, Azure content, date, and overlap checks remain mandatory.

| Aptem ID | Learner | Current deficit | Evidence potential | Potential rows | Outside/blocked | Lineage zero | Duration conflicts |
|---:|---|---:|---:|---:|---:|---:|---:|
| 17038 | Stephen Handley | 90:16:38 | 175:50:00 | 28 | 0 | 13 | 0 |
| 806 | Kieran Smith | 87:36:24 | 195:11:00 | 80 | 3 | 0 | 0 |
| 18756 | Kenneth George | 85:06:53 | 150:00:00 | 12 | 0 | 5 | 0 |
| 4115 | Emily Thornhill | 77:10:23 | 297:45:00 | 135 | 0 | 128 | 10 |
| 10624 | Adam Anson | 74:47:10 | 124:20:00 | 5 | 0 | 3 | 2 |
| 17753 | Shelley Hart | 33:42:55 | 107:45:00 | 34 | 0 | 5 | 1 |
| 16474 | Sophie Lee | 33:17:43 | 69:00:00 | 4 | 0 | 8 | 1 |
| 18000 | Rowan Aldhous | 27:52:48 | 228:35:00 | 29 | 0 | 9 | 0 |
| 1797 | Kelly Davies | 25:50:48 | 82:16:00 | 30 | 2 | 0 | 0 |
| 16001 | Eve Waite | 23:41:21 | 72:00:00 | 21 | 0 | 31 | 5 |
| 16742 | Davide Aimo | 20:21:24 | 64:45:00 | 17 | 0 | 17 | 0 |
| 652 | Emma Ford | 15:31:44 | 116:12:00 | 24 | 1 | 0 | 0 |
| 14183 | Christelle Welland | 15:22:17 | 120:45:00 | 15 | 0 | 2 | 0 |
| 17254 | Tom Lowes | 14:11:21 | 159:00:00 | 17 | 0 | 7 | 0 |
| 10208 | Beatrice Piazza | 10:46:43 | 213:59:00 | 36 | 0 | 11 | 2 |
| 3598 | Francesca Milton | 09:57:38 | 142:30:00 | 26 | 0 | 14 | 2 |
| 17429 | Adrianna Mika | 05:25:47 | 116:00:00 | 17 | 0 | 5 | 0 |
| 16221 | Ian Moore | 04:38:43 | 81:39:00 | 57 | 0 | 46 | 1 |
| 17045 | Adam Graver | 04:31:30 | 28:15:00 | 6 | 0 | 5 | 1 |
| 18587 | Tayla Flynn | 03:09:52 | 112:00:00 | 4 | 0 | 4 | 1 |

## Interpretation

- Every learner has enough *potential* Evidence hours on paper to cover the current deficit.
- `Potential rows` are not all new rows: many are existing SSOT lineage with zero or conflicting duration and must be repaired through the official idempotent path.
- Rows outside period, with unverified evidence content, or with unresolved alternate-source matches remain blocked/review.
- No row is approved for write by this report alone.

## Required gate before write

1. Verify the Evidence file/Note through the approved Azure/document path.
2. Confirm no Journal/Attendance/Old-LMS duplicate, including cross-kind matches.
3. Allocate valid London timestamps within Start/End, Break, weekday/holiday, overlap, daily, weekly (13.5h), and monthly limits.
4. Obtain explicit approval for the exact row-level action list.
