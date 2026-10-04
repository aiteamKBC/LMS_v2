# Ray–MSP Jan 2026 + SK Management — Additional Hours Reconciliation Dry Run

- **Mode:** Read-only; no database, Aptem mirror, Azure, LMS Activity, or Assignment write was performed.
- **Purpose:** Verify exact source identity, Additional Evidence eligibility, Azure references, and comparison arithmetic before any approval gate.
- **Database:** `neondb` (connection details intentionally omitted).

## Quality gates

- Active source identities unique: **PASS**
- Comparison arithmetic reconciles: **PASS**
- Write performed: **NO**

## Explicit negative cases

| Aptem ID | Learner | Aptem comparison | SSOT | Difference | Decision |
|---:|---|---:|---:|---:|---|
| 382 | Safaa Mohamed | 456:15:00 | 153:03:27 | -303:11:33 | BLOCKED |
  - Reason: Accepted Additional Evidence 14645 is note-only, has no file/report blob, and its 2025-11-12 date is outside the current learner period (start 2026-08-17; end missing).
| 1564 | Robert Bawden | 53:15:00 | 47:50:00 | -5:25:00 | BLOCKED |
  - Reason: No Accepted Additional job activity Evidence exists for this learner; the -05:25:00 gap has no eligible source to add and no exact duplicate to exclude.

## Ray – MSP Jan 2026

- Coach: Patryk Zajac
- Roster: 26 learners
- Canonical group mapping: present
- Aptem raw accepted: **5842:59:00**
- Aptem comparison basis: **3757:54:00**
- SSOT accepted: **5773:47:33**
- Difference (SSOT − comparison): **2015:53:33**
- Additional Evidence rows: 28 total; 25 paid/OJT; 3 outside paid/OJT filter
- Exact active duplicate source keys: 0

| Aptem ID | Learner | Aptem comparison | SSOT | Difference | Additional rows | Decision |
|---:|---|---:|---:|---:|---:|---|
| 6254 | Gulzhazira Suiessinova | 210:51:00 | 284:51:00 | 74:00:00 | 6 | READY |
| 6310 | Leah Lewis | 8:50:00 | 47:16:17 | 38:26:17 | 0 | READY |
| 6329 | Roy Hillson | 284:59:00 | 322:59:00 | 38:00:00 | 0 | READY |
| 6425 | John O'Connor | 131:35:00 | 193:35:00 | 62:00:00 | 1 | READY |
| 6436 | Darren Roberts | 242:17:00 | 324:47:00 | 82:30:00 | 0 | READY |
| 6473 | Holly Smith | 141:15:00 | 270:49:03 | 129:34:03 | 2 | READY |
| 6498 | Connor Hickey | 57:20:00 | 219:20:00 | 162:00:00 | 0 | READY |
| 6524 | John Bridges | 113:04:00 | 239:04:00 | 126:00:00 | 1 | READY |
| 6536 | Hilary Chapman | 5:00:00 | 65:00:00 | 60:00:00 | 2 | READY |
| 6563 | Georgina Grace | 168:01:00 | 230:31:00 | 62:30:00 | 0 | READY |
| 6703 | Claire Watkins | 178:38:00 | 241:08:13 | 62:30:13 | 3 | READY |
| 6732 | Mark Jackson | 450:55:00 | 522:55:00 | 72:00:00 | 0 | REVIEW |
| 6753 | Ahmad Reshad Walizada | 84:41:00 | 155:39:00 | 70:58:00 | 0 | READY |
| 7217 | Paige Hodgson | 14:33:00 | 62:03:00 | 47:30:00 | 0 | READY |
| 7495 | Rebecca Edwards | 19:17:00 | 140:17:00 | 121:00:00 | 1 | READY |
| 7796 | Ali Arshad | 146:40:00 | 219:40:00 | 73:00:00 | 0 | READY |
| 8162 | Maxine Budd | 132:27:00 | 201:07:00 | 68:40:00 | 4 | READY |
| 8170 | Barry Harwell | 1:49:00 | 66:19:00 | 64:30:00 | 0 | READY |
| 8580 | Karin Jones | 117:08:00 | 230:23:00 | 113:15:00 | 2 | READY |
| 8635 | Nathan Hogan | 194:07:00 | 258:07:00 | 64:00:00 | 1 | READY |
| 8903 | Agnes Becsei | 278:41:00 | 350:41:00 | 72:00:00 | 0 | READY |
| 9314 | Sunday Onuh | 168:10:00 | 239:10:00 | 71:00:00 | 1 | READY |
| 9862 | Olha Miniailenko | 213:36:00 | 286:36:00 | 73:00:00 | 4 | READY |
| 9866 | Colin Pepper | 203:50:00 | 270:50:00 | 67:00:00 | 0 | READY |
| 9918 | Timothy White | 177:54:00 | 251:24:00 | 73:30:00 | 0 | READY |
| 10071 | Emily Whyte | 12:16:00 | 79:16:00 | 67:00:00 | 0 | READY |
| **Total** | **26** | **3757:54:00** | **5773:47:33** | **2015:53:33** | **28** | — |

### Duplicate source keys

None found among active source rows.

## SK Management (supplied roster)

- Coach: Not supplied
- Roster: 38 learners
- Canonical group mapping: not asserted; supplied roster only
- Aptem raw accepted: **13415:45:00**
- Aptem comparison basis: **13415:45:00**
- SSOT accepted: **16899:07:36**
- Difference (SSOT − comparison): **3483:22:36**
- Additional Evidence rows: 354 total; 313 paid/OJT; 41 outside paid/OJT filter
- Exact active duplicate source keys: 0

| Aptem ID | Learner | Aptem comparison | SSOT | Difference | Additional rows | Decision |
|---:|---|---:|---:|---:|---:|---|
| 1767 | Akmal Khan | 356:37:00 | 466:17:07 | 109:40:07 | 8 | BLOCKED |
| 1770 | Alice Wilkinson | 276:48:00 | 298:09:03 | 21:21:03 | 7 | REVIEW |
| 2030 | Amy-Marie Field | 183:42:00 | 217:42:00 | 34:00:00 | 6 | READY |
| 2800 | Ashleigh Alden | 439:49:00 | 612:29:28 | 172:40:28 | 0 | READY |
| 14610 | Ashley Nunes | 129:34:00 | 129:29:28 | -0:04:32 | 0 | READY |
| 2199 | Israel Odumesi | 339:06:00 | 350:04:23 | 10:58:23 | 19 | REVIEW |
| 1763 | Jamie Fox | 472:44:00 | 561:53:58 | 89:09:58 | 5 | BLOCKED |
| 1122 | Josef Firestone | 373:00:00 | 480:24:20 | 107:24:20 | 5 | READY |
| 1786 | Liam McGuire | 402:21:00 | 450:51:00 | 48:30:00 | 9 | READY |
| 1757 | Melissa Clennell | 329:19:00 | 371:38:30 | 42:19:30 | 16 | BLOCKED |
| 92 | Mohamed Elmasry | 962:34:00 | 1591:18:52 | 628:44:52 | 20 | REVIEW |
| 1769 | Natalja Garkaja | 353:32:00 | 494:47:23 | 141:15:23 | 6 | BLOCKED |
| 1696 | Nick Barnwell | 380:57:00 | 461:27:00 | 80:30:00 | 11 | READY |
| 1698 | Prakhar Singhal | 583:31:00 | 711:31:46 | 128:00:46 | 2 | BLOCKED |
| 2170 | Russell Merry | 328:56:00 | 581:51:02 | 252:55:02 | 3 | BLOCKED |
| 471 | Shabbir Molai | 529:16:00 | 617:51:00 | 88:35:00 | 30 | READY |
| 2429 | Stephen Burns | 175:52:00 | 217:21:24 | 41:29:24 | 0 | READY |
| 1761 | Stephen Gutteridge | 307:48:00 | 445:47:55 | 137:59:55 | 5 | READY |
| 1411 | Barry McLaughlin | 110:02:00 | 120:34:33 | 10:32:33 | 1 | READY |
| 3404 | Lauren Jewitt | 600:33:00 | 734:48:05 | 134:15:05 | 38 | REVIEW |
| 87 | Steven A'Hara | 710:33:00 | 732:47:00 | 22:14:00 | 21 | READY |
| 382 | Safaa Mohamed | 456:15:00 | 153:03:27 | -303:11:33 | 1 | BLOCKED |
| 1565 | Harley Fullager | 50:00:00 | 58:00:00 | 8:00:00 | 0 | READY |
| 1564 | Robert Bawden | 53:15:00 | 47:50:00 | -5:25:00 | 0 | READY |
| 1039 | Benjamin Simmonds | 261:20:00 | 371:16:54 | 109:56:54 | 1 | BLOCKED |
| 1212 | Bethany Grover | 352:34:00 | 356:11:44 | 3:37:44 | 39 | BLOCKED |
| 1426 | Daniel Jones | 424:06:00 | 604:17:50 | 180:11:50 | 12 | BLOCKED |
| 1230 | Jake Meadwell | 389:46:00 | 393:09:23 | 3:23:23 | 19 | BLOCKED |
| 1119 | Jamie Scott | 280:50:00 | 367:50:00 | 87:00:00 | 3 | READY |
| 1281 | Josh Bunyan | 180:27:00 | 186:49:16 | 6:22:16 | 3 | BLOCKED |
| 1900 | Kayleigh Hill | 587:28:00 | 621:54:45 | 34:26:45 | 3 | BLOCKED |
| 3117 | Komal Akhtar | 214:00:00 | 275:08:17 | 61:08:17 | 7 | BLOCKED |
| 1504 | Lisa Bardrick | 212:59:00 | 306:58:30 | 93:59:30 | 20 | BLOCKED |
| 1759 | Lukasz Skarlak | 380:20:00 | 489:41:52 | 109:21:52 | 14 | READY |
| 1456 | Marson Kwan | 371:22:00 | 373:14:23 | 1:52:23 | 4 | READY |
| 2144 | Monty Douglass | 379:34:00 | 679:56:15 | 300:22:15 | 3 | BLOCKED |
| 2324 | Simon Fennell | 151:48:00 | 364:00:49 | 212:12:49 | 2 | READY |
| 1424 | Theppana Mahanuthasan | 323:07:00 | 600:38:54 | 277:31:54 | 11 | BLOCKED |
| **Total** | **38** | **13415:45:00** | **16899:07:36** | **3483:22:36** | **354** | — |

### Duplicate source keys

None found among active source rows.

## Decision and approval gate

- The two supplied scopes are not silently merged. SK Management is reported as an explicit roster because current learner group fields are mixed or missing.
- No LMS Activity or Assignment row is selected for exclusion by this dry run.
- No Additional row is auto-added from a name/date/amount similarity. Candidate rows with missing exact lineage, duration conflicts, missing period, or missing Azure file remain `REVIEW`/`BLOCKED`.
- Before a write, approve the exact learner/evidence rows and any source-row soft exclusions shown in the JSON report.
