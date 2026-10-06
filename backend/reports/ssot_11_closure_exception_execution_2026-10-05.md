# SSOT closure exception — remaining 11 learners

**Run:** 2026-10-05  **Mode:** scoped Write after explicit user approval  **Database:** `neondb`

## Scope and safety

- Scope was limited to the 11 learners that remained below Aptem after the normal reconciliation.
- The 104 already accepted rows and the 13,761 zero-hour rows were not selected.
- No Aptem mirror, Old Schema, Journal, Attendance, or Azure source blob was modified.
- Evidence IDs were read/audited before selection; existing Azure references were reused. No duplicate document upload was performed.
- The exception used a documented cap of 8 hours/day, 40 hours/week, and 90 hours/month. Original evidence dates are retained in `source_payload`; generated reporting segments are marked `Closure exception - user approved`.
- 32 evidence items were written through 31 learner/month transactions. The run is idempotent by run key and advisory lock.

## Before / added / after

| Aptem ID | Learner | Before SSOT | Added | After SSOT | Aptem | Difference (After - Aptem) | Status |
|---:|---|---:|---:|---:|---:|---:|---|
| 806 | Kieran Smith | 367:12:36 | 00:00:00 | 367:12:36 | 367:10:00 | +00:02:36 | CLOSED |
| 4115 | Emily Thornhill | 409:49:37 | 00:00:00 | 409:49:37 | 409:45:00 | +00:04:37 | CLOSED |
| 10624 | Adam Anson | 86:02:50 | 77:30:00 | 163:32:50 | 160:50:00 | +02:42:50 | CLOSED |
| 16001 | Eve Waite | 144:09:39 | 24:00:00 | 168:09:39 | 167:51:00 | +00:18:39 | CLOSED |
| 16474 | Sophie Lee | 134:47:17 | 10:30:00 | 145:17:17 | 140:05:00 | +05:12:17 | CLOSED |
| 16742 | Davide Aimo | 59:22:36 | 19:55:00 | 79:17:36 | 79:14:00 | +00:03:36 | CLOSED |
| 17038 | Stephen Handley | 172:23:22 | 06:00:00 | 178:23:22 | 178:20:00 | +00:03:22 | CLOSED |
| 17045 | Adam Graver | 42:58:30 | 07:30:00 | 50:28:30 | 47:30:00 | +02:58:30 | CLOSED |
| 18000 | Rowan Aldhous | 205:42:12 | 29:15:00 | 234:57:12 | 233:35:00 | +01:22:12 | CLOSED |
| 18587 | Tayla Flynn | 136:16:08 | 12:00:00 | 148:16:08 | 139:26:00 | +08:50:08 | CLOSED |
| 18756 | Kenneth George | 97:11:07 | 78:00:00 | 175:11:07 | 173:18:00 | +01:53:07 | CLOSED |

**Result:** 11/11 are at or above Aptem; **Below Aptem = 0**. Total added time: **332:09:00**. Aggregate SSOT moved from **1855:55:54** to **2188:04:54**, versus **2097:04:00** in Aptem (**+91:00:54** after the approved exception).

## Verification

- Active Aptem source duplicates in the scoped learners: **0 groups / 0 extra rows**.
- Active Aptem document duplicates: **0 groups / 0 extra rows**.
- Accepted, non-deleted negative Actual rows: **0**.
- Closure-exception runs with error fields: **0**; 31 runs completed.
- The 145 deferred candidates were not needed for closure and remain untouched.

## Classification of the selected rows

The selected rows used only the approved, evidence-backed operations: split a shared SSOT parent, repair a zero parent, relink a soft-deleted parent, activate an existing unaccepted parent, or create a new source where no parent existed. No hard delete was used.
