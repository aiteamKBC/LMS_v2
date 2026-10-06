# Old Schema ? SSOT row-level match ? 54 learners

**Run:** 2026-10-04 ? **Mode:** read-only ? **Database:** `neondb` ? **Writes:** none

> **Superseded for final reconciliation:** this first pass used `kind-family` as a hard candidate gate. Because the SSOT/Read Model can migrate an activity to another kind, use `old_ssot_row_match_54_cross_kind_2026-10-04.md` for the kind-migration-aware dry run. No data change was made.

## Matching rule

One-to-one matching within the same `aptem_id + month + kind-family`; keys are exact reference, activity date (excluding SSOT sync timestamp), and normalized title. Duration only labels exact vs conflict. SSOT filter: `accepted IS TRUE AND deleted_at IS NULL.

## Totals

| Scope | Rows | Hours |
|---|---:|---:|
| Old Schema `source_lms_actual_hours` | 23,615 | 7861:59:54 |
| SSOT `learner_progress_entries` (accepted, non-deleted) | 8,461 | 9560:58:29 |
| SSOT ? Old |  | **1698:58:35** |

## Classification summary

| Classification | Rows | Old hours | Matched SSOT hours | Difference |
|---|---:|---:|---:|---:|
| `OLD_NOT_IN_SSOT` | 20,261 | 6497:17:16 | 00:00:00 | 6497:17:16 |
| `REF_MATCH_DURATION_CONFLICT` | 2,331 | 885:03:05 | 996:51:52 | 111:48:47 |
| `DATE_MATCH_DURATION_CONFLICT` | 216 | 218:24:42 | 195:22:40 | 23:02:02 |
| `EXACT_REF_DURATION` | 655 | 114:03:45 | 114:03:45 | 00:00:00 |
| `TITLE_MATCH_DURATION_CONFLICT` | 17 | 60:45:00 | 43:20:00 | 17:25:00 |
| `EXACT_TITLE_DURATION` | 10 | 31:00:00 | 31:00:00 | 00:00:00 |
| `EXACT_DATE_DURATION` | 48 | 30:33:51 | 30:33:51 | 00:00:00 |
| `DUPLICATE_OLD_REF` | 77 | 24:54:49 | 00:00:00 | 24:54:49 |

## Per learner

| Aptem ID | Learner | Old total | Matched SSOT | SSOT ? Old | Old not matched | Ambiguous | Duration conflicts | Old rows |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 75 | Rania Mohamed | 156:31:07 | 45:34:36 | 110:56:31 | 109:31:09 | 00:00:00 | 00:00:00 | 379 |
| 652 | Emma Ford | 101:35:34 | 42:35:59 | 58:59:35 | 47:35:37 | 00:00:00 | 40:18:58 | 470 |
| 806 | Kieran Smith | 256:21:06 | 23:00:00 | 233:21:06 | 95:08:41 | 00:00:00 | 159:12:25 | 531 |
| 1268 | James Clifford | 272:25:00 | 00:00:00 | 272:25:00 | 249:52:27 | 00:00:00 | 22:32:33 | 977 |
| 1428 | Tinotenda Marodza | 200:40:00 | 29:41:26 | 170:58:34 | 197:53:54 | 00:00:00 | 01:50:44 | 523 |
| 1797 | Kelly Davies | 63:55:12 | 02:30:00 | 61:25:12 | 63:55:12 | 00:00:00 | 00:00:00 | 356 |
| 3274 | Katherine Bedford | 233:44:39 | 02:00:00 | 231:44:39 | 180:52:45 | 00:00:00 | 52:51:54 | 732 |
| 3487 | Robert Bowen | 314:28:33 | 224:07:21 | 90:21:12 | 180:50:01 | 00:00:00 | 101:48:36 | 1,047 |
| 3598 | Francesca Milton | 276:48:52 | 355:09:44 | 78:20:52 | 77:19:52 | 00:00:00 | 173:22:16 | 730 |
| 4115 | Emily Thornhill | 288:02:35 | 40:27:56 | 247:34:39 | 257:27:56 | 00:00:00 | 28:33:14 | 629 |
| 4407 | Andrew Wright | 326:49:38 | 36:34:00 | 290:15:38 | 291:25:11 | 00:00:00 | 25:56:11 | 747 |
| 5144 | Edirisinghege Wimalaratne | 267:38:02 | 31:03:48 | 236:34:14 | 188:54:18 | 00:00:00 | 77:53:10 | 626 |
| 6105 | Eleanor Cross | 182:11:33 | 01:12:00 | 180:59:33 | 165:58:35 | 00:00:00 | 16:12:58 | 463 |
| 6203 | Hayley Nicholson | 262:19:00 | 15:29:49 | 246:49:11 | 235:32:55 | 00:00:00 | 24:58:17 | 584 |
| 6240 | Yuri Michaels | 222:10:53 | 13:25:39 | 208:45:14 | 210:31:10 | 00:00:00 | 11:34:54 | 581 |
| 6254 | Gulzhazira Suiessinova | 223:14:57 | 00:00:00 | 223:14:57 | 223:14:57 | 00:00:00 | 00:00:00 | 545 |
| 6333 | Ellis Smith | 248:07:23 | 02:30:00 | 245:37:23 | 248:07:23 | 00:00:00 | 00:00:00 | 468 |
| 6378 | Clowance Lawton | 284:14:28 | 14:31:54 | 269:42:34 | 280:41:46 | 00:00:00 | 03:19:03 | 585 |
| 6436 | Darren Roberts | 254:27:24 | 00:00:00 | 254:27:24 | 254:27:24 | 00:00:00 | 00:00:00 | 489 |
| 6473 | Holly Smith | 239:54:18 | 00:00:00 | 239:54:18 | 239:54:18 | 00:00:00 | 00:00:00 | 488 |
| 6498 | Connor Hickey | 220:54:55 | 00:00:00 | 220:54:55 | 220:54:55 | 00:00:00 | 00:00:00 | 485 |
| 8162 | Maxine Budd | 220:25:28 | 00:00:00 | 220:25:28 | 220:25:28 | 00:00:00 | 00:00:00 | 485 |
| 8530 | Yasmin Pritchard | 238:30:02 | 23:14:23 | 215:15:39 | 228:08:45 | 00:00:00 | 06:55:49 | 582 |
| 8580 | Karin Jones | 217:18:49 | 00:00:00 | 217:18:49 | 217:18:49 | 00:00:00 | 00:00:00 | 498 |
| 8635 | Nathan Hogan | 208:30:45 | 00:00:00 | 208:30:45 | 208:30:45 | 00:00:00 | 00:00:00 | 498 |
| 8861 | Janet Alderman | 205:10:09 | 03:50:00 | 201:20:09 | 140:57:26 | 00:00:00 | 64:12:43 | 452 |
| 8903 | Agnes Becsei | 255:14:11 | 00:00:00 | 255:14:11 | 255:14:11 | 00:00:00 | 00:00:00 | 498 |
| 10071 | Emily Whyte | 210:48:33 | 00:00:00 | 210:48:33 | 210:48:33 | 00:00:00 | 00:00:00 | 498 |
| 10208 | Beatrice Piazza | 204:53:57 | 37:28:01 | 167:25:56 | 170:36:25 | 00:00:00 | 32:47:36 | 623 |
| 10624 | Adam Anson | 20:50:00 | 00:00:00 | 20:50:00 | 20:50:00 | 00:00:00 | 00:00:00 | 19 |
| 14183 | Christelle Welland | 61:47:07 | 18:51:00 | 42:56:07 | 32:39:46 | 00:00:00 | 29:07:21 | 291 |
| 14235 | Quinton Welland | 56:20:02 | 13:51:55 | 42:28:07 | 47:47:48 | 00:00:00 | 08:04:19 | 290 |
| 15794 | Francis Slobodian | 62:30:04 | 03:00:00 | 59:30:04 | 62:30:04 | 00:00:00 | 00:00:00 | 291 |
| 15796 | Aneta Taylor | 61:02:48 | 12:00:00 | 49:02:48 | 60:02:48 | 00:00:00 | 01:00:00 | 291 |
| 16001 | Eve Waite | 65:55:20 | 34:00:00 | 31:55:20 | 54:25:20 | 00:00:00 | 00:00:00 | 272 |
| 16221 | Ian Moore | 56:17:50 | 14:00:00 | 42:17:50 | 53:50:36 | 00:00:00 | 02:27:14 | 464 |
| 16474 | Sophie Lee | 40:24:52 | 37:23:48 | 03:01:04 | 14:25:00 | 00:00:00 | 20:59:52 | 392 |
| 16476 | Kimberley Gurney | 53:27:53 | 33:15:05 | 20:12:48 | 43:00:30 | 00:00:00 | 10:27:23 | 403 |
| 16742 | Davide Aimo | 14:00:00 | 00:00:00 | 14:00:00 | 14:00:00 | 00:00:00 | 00:00:00 | 27 |
| 16749 | Hasan Syed Mohammed Salam | 43:45:48 | 03:42:00 | 40:03:48 | 39:54:48 | 00:00:00 | 03:51:00 | 393 |
| 17038 | Stephen Handley | 63:53:15 | 00:00:00 | 63:53:15 | 30:20:00 | 00:00:00 | 33:33:15 | 291 |
| 17045 | Adam Graver | 12:16:57 | 08:36:23 | 03:40:34 | 06:51:58 | 00:00:00 | 01:50:42 | 255 |
| 17129 | Gemma Sellars | 63:16:17 | 02:21:00 | 60:55:17 | 27:06:56 | 00:00:00 | 36:09:21 | 291 |
| 17254 | Tom Lowes | 44:26:01 | 27:14:59 | 17:11:02 | 32:40:15 | 00:00:00 | 11:45:46 | 393 |
| 17424 | Leanne Howell | 64:53:06 | 13:12:00 | 51:41:06 | 51:18:03 | 00:00:00 | 13:35:03 | 291 |
| 17429 | Adrianna Mika | 38:57:48 | 41:33:00 | 02:35:12 | 21:14:54 | 00:00:00 | 13:13:54 | 258 |
| 17753 | Shelley Hart | 33:46:44 | 21:33:36 | 12:13:08 | 30:45:16 | 00:00:00 | 02:51:25 | 390 |
| 17825 | Isabella Francis | 39:04:00 | 06:23:00 | 32:41:00 | 23:14:45 | 00:00:00 | 15:49:15 | 393 |
| 17922 | Harry Myers | 32:29:24 | 26:06:20 | 06:23:04 | 15:09:12 | 00:00:00 | 08:04:24 | 258 |
| 17930 | Kimberley Hatch | 56:06:23 | 57:53:33 | 01:47:10 | 08:20:02 | 00:00:00 | 25:06:21 | 393 |
| 18000 | Rowan Aldhous | 127:59:00 | 79:36:53 | 48:22:07 | 84:33:32 | 00:00:00 | 41:55:00 | 286 |
| 18587 | Tayla Flynn | 27:00:00 | 00:00:00 | 27:00:00 | 13:00:00 | 00:00:00 | 14:00:00 | 19 |
| 18756 | Kenneth George | 39:48:55 | 05:36:00 | 34:12:55 | 14:01:40 | 00:00:00 | 25:47:15 | 138 |
| 18962 | Pareesa Tai | 24:15:51 | 06:35:00 | 17:40:51 | 23:03:15 | 00:00:00 | 00:12:36 | 257 |

## Source fields

- Old: `Learner.source_lms_actual_hours` (`aptem_id`, `month`, `kind`, `ref`, `title`, `actual_hours`, `activity_date`, `source`).
- SSOT: `Learner.learner_progress_entries` joined to `Learner.learners` (`aptem_id`, `reporting_month`, `kind`, `source_activity_id`, titles, `source_payload`, `actual_seconds`, `source_system`).
- **Important:** `source_system` in the row-level CSV is `Learner.learner_progress_entries.source_system`; `Learner.learner_monthly_targets.source_system` was not used in this comparison. Monthly targets are target/budget provenance, not the actual-hours source.
- No Attendance/Azure API call was needed for this database comparison.

## Full row-level detail
CSV: [`old_ssot_row_match_54_2026-10-04.csv`](<C:\Users\ayman\Desktop\LMS_T\LMS_v2\backend\reports\old_ssot_row_match_54_2026-10-04.csv>)

No writes, exclusions, or soft-deletes were performed.
