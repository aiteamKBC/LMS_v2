# Old Schema ? SSOT missing-candidate validation ? 54 learners

**Run:** 2026-10-04  **Mode:** read-only dry run  **Database:** `neondb`  **Writes:** none

This report validates only the `NO_MATCH` candidates from the kind-migration-aware cross-kind dry run. A candidate is labelled `CONFIRMED_MISSING` only after checking accepted Journal, positive Attendance, accepted Aptem Evidence metadata, and date validity. A complete learner start/end boundary is also required; otherwise the row is blocked for review. No row was inserted, updated, excluded, or soft-deleted.

## Sources checked

- Old candidate rows: `Learner.source_lms_actual_hours` and the cross-kind candidate CSV; `actual_hours` is compared in minutes.
- SSOT candidates: the preceding cross-kind report already performed one-to-one typed-reference matching with kind treated as soft. This pass validates only its `NO_MATCH` rows.
- Journal: accepted, non-deleted rows from `Learner.learner_journal_rows`, using exact `source_ref`/`activity_id` or exact normalized title + activity date.
- Attendance: positive `activity_hours`/present rows from `Learner.source_lms_attendance`, plus joined `Learner.learner_attendance_details`; matched by source reference or exact title + date.
- Aptem Evidence: `fetching_evidence.evidence_items` with `evidence_status=Accepted` and `spent_time>0`; matched by component ID or title/date/month metadata. Blob contents/SAS/iframe were not opened in this database-only pass.
- Dates: Old `activity_date` only; checked against learner start/end, Europe/London calendar weekday, and parsed Break in Learning intervals from `Learner.aptem_cv_contracts_probe`.

## Validation summary

| Status | Rows | Old hours | Meaning |
|---|---:|---:|---|
| `BLOCKED_DATE_BOUNDARY_UNKNOWN` | 160 | 345:20:15 | Positive row has no complete learner start/end boundary in the database; date validity cannot be confirmed. |
| `BLOCKED_DATE_IN_BREAK` | 32 | 24:14:51 | Date falls in a parsed Break in Learning interval. |
| `BLOCKED_DATE_OUTSIDE_LEARNING_PERIOD` | 27 | 34:20:00 | Date is outside learner start/end; not eligible for automatic missing classification. |
| `BLOCKED_DATE_OUTSIDE_LEARNING_PERIOD+WEEKEND` | 1 | 00:48:54 | Date is outside learner period and on a weekend. |
| `BLOCKED_DATE_WEEKEND` | 50 | 438:45:48 | Date is Saturday/Sunday; not eligible for automatic missing classification. |
| `BLOCKED_OLD_ROW_AMBIGUOUS` | 5,358 | 2987:15:10 | The Old row identity is not unique from the available fields; cannot safely attribute title/date or confirm missing. |
| `CONFIRMED_MISSING` | 769 | 998:55:48 | Positive Old hours; no alternate source found; unique row and known start/end/date passed period/weekend/break checks. Still a dry-run candidate, not a write instruction. |
| `NOT_HOURS` | 13,761 | 00:00:00 | Old actual_hours is zero; it cannot be a missing-hours candidate. |
| `NOT_MISSING_ALTERNATE_SOURCE` | 104 | 850:41:12 | Equivalent accepted Journal/Attendance/Aptem Evidence source found with matching duration; do not add hours a second time. |
| `REVIEW_ALTERNATE_DURATION_CONFLICT` | 353 | 1125:05:00 | Journal/Attendance/Aptem Evidence equivalent exists, but duration differs or multiple evidence rows are possible; manual reconciliation required. |

**Candidate input:** 20,615 `NO_MATCH` rows.  **Rows with positive Old hours eligible after all checks:** 769 (998:55:48).

### Alternate-source detections (positive Old-hour candidates)

| Source | Candidate rows with an equivalent |
|---|---:|
| `JOURNAL` | 0 |
| `ATTENDANCE` | 339 |
| `APTEM_EVIDENCE` | 191 |

### Date flags

| Flag | Rows |
|---|---:|
| `DATE_MISSING` | 5,358 |
| `IN_BREAK` | 486 |
| `OUTSIDE_LEARNING_PERIOD` | 4,666 |
| `WEEKEND` | 2,246 |

## Per learner

| Aptem ID | Learner | Candidate rows | Positive Old hours | Confirmed missing | Review duration | Alternate source | Blocked date/identity | Zero-hour |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 75 | Rania Mohamed | 241 | 110:56:31 | 9 / 07:09:09 | 15 / 40:00:00 | 4 / 11:30:00 | 66 | 147 |
| 652 | Emma Ford | 347 | 47:35:37 | 0 / 00:00:00 | 0 / 00:00:00 | 5 / 08:00:00 | 43 | 299 |
| 806 | Kieran Smith | 175 | 104:38:41 | 0 / 00:00:00 | 5 / 17:20:00 | 3 / 09:00:00 | 84 | 83 |
| 1268 | James Clifford | 890 | 249:52:27 | 75 / 71:53:42 | 1 / 02:30:00 | 0 / 00:00:00 | 404 | 410 |
| 1428 | Tinotenda Marodza | 517 | 198:21:35 | 16 / 40:00:00 | 8 / 20:00:00 | 0 / 00:00:00 | 249 | 244 |
| 1797 | Kelly Davies | 356 | 63:55:12 | 23 / 29:25:12 | 2 / 11:30:00 | 2 / 08:00:00 | 4 | 325 |
| 3274 | Katherine Bedford | 608 | 180:52:45 | 0 / 00:00:00 | 13 / 39:05:00 | 0 / 00:00:00 | 273 | 322 |
| 3487 | Robert Bowen | 641 | 185:12:44 | 80 / 97:12:18 | 0 / 00:00:00 | 0 / 00:00:00 | 249 | 312 |
| 3598 | Francesca Milton | 76 | 80:34:12 | 6 / 15:00:00 | 22 / 57:30:00 | 0 / 00:00:00 | 18 | 30 |
| 4115 | Emily Thornhill | 568 | 275:10:03 | 14 / 32:35:24 | 15 / 37:30:00 | 2 / 10:13:12 | 306 | 231 |
| 4407 | Andrew Wright | 669 | 299:03:42 | 14 / 35:00:00 | 23 / 58:00:00 | 0 / 00:00:00 | 328 | 304 |
| 5144 | Edirisinghege Wimalaratne | 504 | 222:46:43 | 0 / 00:00:00 | 25 / 97:55:00 | 1 / 04:00:00 | 220 | 258 |
| 6105 | Eleanor Cross | 413 | 169:19:15 | 0 / 00:00:00 | 8 / 20:00:00 | 1 / 01:00:00 | 133 | 271 |
| 6203 | Hayley Nicholson | 569 | 251:27:32 | 11 / 27:30:00 | 13 / 32:30:00 | 2 / 20:00:00 | 225 | 318 |
| 6240 | Yuri Michaels | 565 | 222:04:52 | 21 / 53:48:36 | 18 / 45:00:00 | 2 / 24:00:00 | 225 | 299 |
| 6254 | Gulzhazira Suiessinova | 545 | 223:14:57 | 9 / 16:37:21 | 14 / 35:00:00 | 4 / 37:31:12 | 167 | 351 |
| 6333 | Ellis Smith | 468 | 248:07:23 | 22 / 55:00:00 | 1 / 41:30:00 | 1 / 18:00:00 | 230 | 214 |
| 6378 | Clowance Lawton | 564 | 281:37:43 | 8 / 18:06:09 | 19 / 94:00:00 | 3 / 41:23:24 | 231 | 303 |
| 6436 | Darren Roberts | 489 | 254:27:24 | 11 / 20:03:27 | 16 / 40:00:00 | 2 / 32:00:00 | 194 | 266 |
| 6473 | Holly Smith | 488 | 239:54:18 | 42 / 88:21:27 | 9 / 22:30:00 | 0 / 00:00:00 | 129 | 308 |
| 6498 | Connor Hickey | 485 | 220:54:55 | 21 / 37:02:15 | 4 / 10:00:00 | 3 / 44:00:00 | 150 | 307 |
| 8162 | Maxine Budd | 485 | 220:25:28 | 9 / 12:50:42 | 14 / 35:00:00 | 1 / 00:30:36 | 175 | 286 |
| 8530 | Yasmin Pritchard | 560 | 232:01:36 | 121 / 79:54:27 | 8 / 38:00:00 | 3 / 33:30:00 | 111 | 317 |
| 8580 | Karin Jones | 498 | 217:18:49 | 13 / 21:04:57 | 14 / 35:00:00 | 3 / 46:30:00 | 190 | 278 |
| 8635 | Nathan Hogan | 498 | 208:30:45 | 52 / 62:25:57 | 7 / 17:30:00 | 2 / 12:00:00 | 155 | 282 |
| 8861 | Janet Alderman | 358 | 137:46:21 | 0 / 00:00:00 | 2 / 05:00:00 | 2 / 03:10:12 | 92 | 262 |
| 8903 | Agnes Becsei | 498 | 255:14:11 | 0 / 00:00:00 | 18 / 45:00:00 | 5 / 74:58:12 | 231 | 244 |
| 10071 | Emily Whyte | 498 | 210:48:33 | 60 / 47:42:00 | 7 / 17:30:00 | 0 / 00:00:00 | 167 | 264 |
| 10208 | Beatrice Piazza | 585 | 193:22:07 | 4 / 10:00:00 | 12 / 45:45:00 | 5 / 68:56:24 | 152 | 412 |
| 10624 | Adam Anson | 19 | 20:50:00 | 0 / 00:00:00 | 0 / 00:00:00 | 2 / 20:30:00 | 1 | 16 |
| 14183 | Christelle Welland | 279 | 44:39:46 | 0 / 00:00:00 | 0 / 00:00:00 | 2 / 12:10:00 | 11 | 266 |
| 14235 | Quinton Welland | 284 | 47:47:48 | 0 / 00:00:00 | 2 / 05:00:00 | 2 / 13:00:00 | 7 | 273 |
| 15794 | Francis Slobodian | 291 | 62:30:04 | 0 / 00:00:00 | 5 / 12:30:00 | 1 / 01:00:00 | 11 | 274 |
| 15796 | Aneta Taylor | 291 | 61:02:48 | 0 / 00:00:00 | 2 / 05:00:00 | 1 / 01:00:00 | 12 | 276 |
| 16001 | Eve Waite | 272 | 65:55:20 | 33 / 11:44:24 | 5 / 21:30:00 | 0 / 00:00:00 | 50 | 184 |
| 16221 | Ian Moore | 462 | 54:50:36 | 0 / 00:00:00 | 4 / 10:00:00 | 3 / 23:00:00 | 24 | 431 |
| 16474 | Sophie Lee | 374 | 36:55:00 | 3 / 07:30:00 | 1 / 11:00:00 | 1 / 17:30:00 | 8 | 361 |
| 16476 | Kimberley Gurney | 340 | 43:00:30 | 4 / 10:00:00 | 2 / 30:30:00 | 1 / 01:00:00 | 18 | 315 |
| 16742 | Davide Aimo | 27 | 14:00:00 | 0 / 00:00:00 | 0 / 00:00:00 | 2 / 14:00:00 | 0 | 25 |
| 16749 | Hasan Syed Mohammed Salam | 387 | 42:59:36 | 12 / 16:09:36 | 0 / 00:00:00 | 2 / 26:30:00 | 1 | 372 |
| 17038 | Stephen Handley | 250 | 31:20:00 | 0 / 00:00:00 | 3 / 07:30:00 | 3 / 12:00:00 | 26 | 218 |
| 17045 | Adam Graver | 241 | 10:02:28 | 23 / 02:11:15 | 1 / 02:30:00 | 1 / 03:00:00 | 4 | 212 |
| 17129 | Gemma Sellars | 280 | 53:39:32 | 0 / 00:00:00 | 1 / 02:30:00 | 3 / 16:00:00 | 11 | 265 |
| 17254 | Tom Lowes | 347 | 32:20:01 | 4 / 10:00:00 | 0 / 00:00:00 | 2 / 11:00:00 | 58 | 283 |
| 17424 | Leanne Howell | 288 | 63:00:36 | 0 / 00:00:00 | 5 / 19:00:00 | 2 / 13:00:00 | 11 | 270 |
| 17429 | Adrianna Mika | 159 | 25:02:10 | 3 / 07:30:00 | 3 / 11:00:00 | 0 / 00:00:00 | 39 | 114 |
| 17753 | Shelley Hart | 379 | 30:45:16 | 1 / 02:30:00 | 0 / 00:00:00 | 2 / 26:00:00 | 6 | 370 |
| 17825 | Isabella Francis | 388 | 39:04:00 | 4 / 10:00:00 | 0 / 00:00:00 | 3 / 22:30:00 | 8 | 373 |
| 17922 | Harry Myers | 212 | 24:03:23 | 4 / 10:00:00 | 0 / 00:00:00 | 3 / 05:00:00 | 44 | 161 |
| 17930 | Kimberley Hatch | 362 | 29:50:02 | 4 / 10:00:00 | 0 / 00:00:00 | 2 / 17:30:00 | 18 | 338 |
| 18000 | Rowan Aldhous | 131 | 84:04:04 | 5 / 12:30:00 | 3 / 07:30:00 | 4 / 61:48:00 | 9 | 110 |
| 18587 | Tayla Flynn | 19 | 27:00:00 | 0 / 00:00:00 | 1 / 14:00:00 | 2 / 13:00:00 | 0 | 16 |
| 18756 | Kenneth George | 120 | 31:04:22 | 0 / 00:00:00 | 2 / 05:00:00 | 2 / 09:00:00 | 7 | 109 |
| 18962 | Pareesa Tai | 255 | 24:03:15 | 28 / 10:07:30 | 0 / 00:00:00 | 2 / 03:00:00 | 43 | 182 |

## Decision and limits

- `CONFIRMED_MISSING` here means **confirmed as a validated candidate for review**, not permission to insert SSOT hours. Before any write, show the row list and obtain explicit approval under the reconciliation gate.
- Rows with a source equivalent but a duration mismatch or multiple possible evidence rows remain `REVIEW_ALTERNATE_DURATION_CONFLICT`; do not sum both sources.
- Evidence metadata was checked from the mirror. Azure blob opening, SAS generation, file scanning, and iframe verification were not performed in this pass; any evidence-dependent acceptance still requires that separate check.
- No Attendance/Journals/Aptem mirror records were changed. No SSOT row was created or deleted.

Full row-level CSV: [`old_ssot_missing_validation_54_2026-10-04.csv`](backend\reports\old_ssot_missing_validation_54_2026-10-04.csv)
