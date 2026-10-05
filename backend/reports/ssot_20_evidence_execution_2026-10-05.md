# SSOT evidence recovery — current 20 learners

**Run date:** 2026-10-05  
**Database:** `neondb` (verified)  
**Mode:** scoped Write completed, followed by read-only verification  
**Scope:** Aptem IDs `17038, 806, 18756, 4115, 10624, 17753, 16474, 18000, 1797, 16001, 16742, 652, 14183, 17254, 10208, 3598, 17429, 16221, 17045, 18587`  
**Limits:** 8 hours/day, 13.5 hours/week, 45 hours/month; Europe/London; weekdays; break/period/overlap checks.

## What was written

- Accepted Aptem Evidence was reviewed against existing SSOT, Journal, Attendance, Old Schema and learner period.
- Only evidence with a defensible source, readable evidence/Note audit, valid period date and no alternate represented event was written.
- The write path used one transaction per learner/month, advisory locking, an idempotency run key, SSOT source lineage, reporting segments and existing Azure blob references.
- Aptem mirror, Journal, Attendance and Old Schema were not modified.
- Existing Azure document keys were reused; no duplicate active source/document keys were created.
- 72 completed reconciliation run records cover the scoped batches; they account for 144 parent/source upserts and 1,383,660 seconds (`384:21:00`) of recovered/confirmed SSOT hours.
- The final read-only dry run has **0 additional safe candidates** (`SELECTED=0`), so no further write is justified without a new business decision.

## Final comparison

| Aptem ID | Learner | Aptem | SSOT | Difference (SSOT − Aptem) | Status |
|---:|---|---:|---:|---:|---|
| 652 | Emma Ford | 223:55:00 | 224:23:16 | +00:28:16 | AT/ABOVE |
| 806 | Kieran Smith | 367:10:00 | 347:28:36 | -19:41:24 | BELOW |
| 1797 | Kelly Davies | 167:04:00 | 167:04:12 | +00:00:12 | AT/ABOVE |
| 3598 | Francesca Milton | 512:01:00 | 512:03:22 | +00:02:22 | AT/ABOVE |
| 4115 | Emily Thornhill | 409:45:00 | 374:04:37 | -35:40:23 | BELOW |
| 10208 | Beatrice Piazza | 295:29:00 | 295:31:17 | +00:02:17 | AT/ABOVE |
| 10624 | Adam Anson | 160:50:00 | 086:02:50 | -74:47:10 | BELOW |
| 14183 | Christelle Welland | 155:26:00 | 156:03:43 | +00:37:43 | AT/ABOVE |
| 16001 | Eve Waite | 167:51:00 | 144:09:39 | -23:41:21 | BELOW |
| 16221 | Ian Moore | 116:24:00 | 118:11:17 | +01:47:17 | AT/ABOVE |
| 16474 | Sophie Lee | 140:05:00 | 134:47:17 | -05:17:43 | BELOW |
| 16742 | Davide Aimo | 079:14:00 | 059:22:36 | -19:51:24 | BELOW |
| 17038 | Stephen Handley | 178:20:00 | 172:23:22 | -05:56:38 | BELOW |
| 17045 | Adam Graver | 047:30:00 | 042:58:30 | -04:31:30 | BELOW |
| 17254 | Tom Lowes | 159:13:00 | 160:01:39 | +00:48:39 | AT/ABOVE |
| 17429 | Adrianna Mika | 120:30:00 | 122:34:13 | +02:04:13 | AT/ABOVE |
| 17753 | Shelley Hart | 147:56:00 | 148:13:05 | +00:17:05 | AT/ABOVE |
| 18000 | Rowan Aldhous | 233:35:00 | 205:42:12 | -27:52:48 | BELOW |
| 18587 | Tayla Flynn | 139:26:00 | 136:16:08 | -03:09:52 | BELOW |
| 18756 | Kenneth George | 173:18:00 | 097:11:07 | -76:06:53 | BELOW |

**Totals:** Aptem `3995:02:00`; SSOT `3704:32:58`; difference `-290:29:02` (11 learners below; total deficit by learner `296:37:06`, with positive overages offsetting the aggregate).

## Remaining blockers

- `ATTENDANCE_REVIEW`: 24 evidence rows / 4,170 minutes. Lecture/live-session evidence has no confirmed same-lecture Attendance match for this learner; it is not added from title/date alone.
- `CONTENT_REVIEW`: 3 rows / 6,225 minutes. The existing evidence-content audit does not establish readable duration/date content; no automatic hours were invented.
- `BLOCKED_OUTSIDE_PERIOD`: 5 rows / 450 minutes.
- `SKIP_EXISTING_SEGMENTS`: 103 rows / 20,720 minutes. Existing SSOT lineage/segments are already attached to the evidence family; creating another parent would duplicate the event.
- `JOURNAL_TITLE_DATE_MATCH`, `SSOT_TITLE_DATE_MATCH`, `OLD_TITLE_DATE_MATCH` and `ATTENDANCE_LECTURE_DATE_MATCH` rows were retained as represented events, not added again.
- Eight timestamp-cap candidates remain blocked under the approved limits. Several are 30–35-hour single evidence items in months already near the 45-hour cap; adding them would violate the declared monthly rule.

## Decision

`REVIEW` — 9 learners are at/above Aptem. The remaining 11 require one of: confirmed Attendance/lecture identity, a readable evidence duration/date, a corrected source lineage, or an explicit change to the 45-hour monthly/timestamp policy. No further automatic Write is safe under the current rules.
