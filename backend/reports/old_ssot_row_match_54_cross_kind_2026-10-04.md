# Old Schema ? SSOT row match ? kind migration aware

**Run:** 2026-10-04 ? **Mode:** read-only ? **Database:** `neondb` ? **Writes:** none

## Revised rule

`kind` is no longer a hard gate because SSOT/Read Model migrations can change `kind` (for example `actual:media` numeric refs to SSOT `material:<id>`, or reading/quiz variants). The hard identity gate is `aptem_id + month`; then typed source references are matched across kinds. Title+date is only accepted with a strong normalized title and is never inferred from duration alone. SSOT sync timestamps are excluded.

## Totals

| Scope | Rows | Hours |
|---|---:|---:|
| Old Schema | 23,615 | 7861:59:54 |
| SSOT accepted/non-deleted | 8,461 | 9560:58:29 |
| SSOT ? Old |  | **1698:58:35** |

## Classification summary

| Classification | Rows | Old hours | Matched SSOT hours |
|---|---:|---:|---:|
| `NO_MATCH` | 20,615 | 6805:26:58 | 00:00:00 |
| `TYPED_REF_MATCH` | 2,999 | 1052:42:38 | 720:44:24 |
| `TYPED_REF_DURATION_CONFLICT_CROSS_KIND` | 1 | 03:52:52 | 00:15:00 |

## Per learner

| Aptem ID | Learner | Old total | Matched SSOT | SSOT?Old (matched) | Cross-kind old hours | Old rows |
|---:|---|---:|---:|---:|---:|---:|
| 75 | Rania Mohamed | 156:31:07 | 47:42:36 | 108:48:31 | 00:00:00 | 379 |
| 652 | Emma Ford | 101:35:34 | 42:35:59 | 58:59:35 | 00:00:00 | 470 |
| 806 | Kieran Smith | 256:21:06 | 00:00:00 | 256:21:06 | 00:00:00 | 531 |
| 1268 | James Clifford | 272:25:00 | 00:00:00 | 272:25:00 | 00:00:00 | 977 |
| 1428 | Tinotenda Marodza | 200:40:00 | 03:41:26 | 196:58:34 | 00:00:00 | 523 |
| 1797 | Kelly Davies | 63:55:12 | 00:00:00 | 63:55:12 | 00:00:00 | 356 |
| 3274 | Katherine Bedford | 233:44:39 | 00:00:00 | 233:44:39 | 00:00:00 | 732 |
| 3487 | Robert Bowen | 314:28:33 | 224:22:21 | 90:06:12 | 03:52:52 | 1,047 |
| 3598 | Francesca Milton | 276:48:52 | 23:36:44 | 253:12:08 | 00:00:00 | 730 |
| 4115 | Emily Thornhill | 288:02:35 | 16:41:33 | 271:21:02 | 00:00:00 | 629 |
| 4407 | Andrew Wright | 326:49:38 | 36:16:00 | 290:33:38 | 00:00:00 | 747 |
| 5144 | Edirisinghege Wimalaratne | 267:38:02 | 04:48:34 | 262:49:28 | 00:00:00 | 626 |
| 6105 | Eleanor Cross | 182:11:33 | 00:00:00 | 182:11:33 | 00:00:00 | 463 |
| 6203 | Hayley Nicholson | 262:19:00 | 10:14:05 | 252:04:55 | 00:00:00 | 584 |
| 6240 | Yuri Michaels | 222:10:53 | 09:32:47 | 212:38:06 | 00:00:00 | 581 |
| 6254 | Gulzhazira Suiessinova | 223:14:57 | 00:00:00 | 223:14:57 | 00:00:00 | 545 |
| 6333 | Ellis Smith | 248:07:23 | 00:00:00 | 248:07:23 | 00:00:00 | 468 |
| 6378 | Clowance Lawton | 284:14:28 | 11:05:02 | 273:09:26 | 00:00:00 | 585 |
| 6436 | Darren Roberts | 254:27:24 | 00:00:00 | 254:27:24 | 00:00:00 | 489 |
| 6473 | Holly Smith | 239:54:18 | 00:00:00 | 239:54:18 | 00:00:00 | 488 |
| 6498 | Connor Hickey | 220:54:55 | 00:00:00 | 220:54:55 | 00:00:00 | 485 |
| 8162 | Maxine Budd | 220:25:28 | 00:00:00 | 220:25:28 | 00:00:00 | 485 |
| 8530 | Yasmin Pritchard | 238:30:02 | 12:25:07 | 226:04:55 | 00:00:00 | 582 |
| 8580 | Karin Jones | 217:18:49 | 00:00:00 | 217:18:49 | 00:00:00 | 498 |
| 8635 | Nathan Hogan | 208:30:45 | 00:00:00 | 208:30:45 | 00:00:00 | 498 |
| 8861 | Janet Alderman | 205:10:09 | 08:05:00 | 197:05:09 | 00:00:00 | 452 |
| 8903 | Agnes Becsei | 255:14:11 | 00:00:00 | 255:14:11 | 00:00:00 | 498 |
| 10071 | Emily Whyte | 210:48:33 | 00:00:00 | 210:48:33 | 00:00:00 | 498 |
| 10208 | Beatrice Piazza | 204:53:57 | 31:37:16 | 173:16:41 | 00:00:00 | 623 |
| 10624 | Adam Anson | 20:50:00 | 00:00:00 | 20:50:00 | 00:00:00 | 19 |
| 14183 | Christelle Welland | 61:47:07 | 06:20:00 | 55:27:07 | 00:00:00 | 291 |
| 14235 | Quinton Welland | 56:20:02 | 00:27:55 | 55:52:07 | 00:00:00 | 290 |
| 15794 | Francis Slobodian | 62:30:04 | 00:00:00 | 62:30:04 | 00:00:00 | 291 |
| 15796 | Aneta Taylor | 61:02:48 | 00:00:00 | 61:02:48 | 00:00:00 | 291 |
| 16001 | Eve Waite | 65:55:20 | 00:00:00 | 65:55:20 | 00:00:00 | 272 |
| 16221 | Ian Moore | 56:17:50 | 00:00:00 | 56:17:50 | 00:00:00 | 464 |
| 16474 | Sophie Lee | 40:24:52 | 05:11:13 | 35:13:39 | 00:00:00 | 392 |
| 16476 | Kimberley Gurney | 53:27:53 | 18:11:05 | 35:16:48 | 00:00:00 | 403 |
| 16742 | Davide Aimo | 14:00:00 | 00:00:00 | 14:00:00 | 00:00:00 | 27 |
| 16749 | Hasan Syed Mohammed Salam | 43:45:48 | 02:30:00 | 41:15:48 | 00:00:00 | 393 |
| 17038 | Stephen Handley | 63:53:15 | 00:00:00 | 63:53:15 | 00:00:00 | 291 |
| 17045 | Adam Graver | 12:16:57 | 04:23:17 | 07:53:40 | 00:00:00 | 255 |
| 17129 | Gemma Sellars | 63:16:17 | 00:00:00 | 63:16:17 | 00:00:00 | 291 |
| 17254 | Tom Lowes | 44:26:01 | 26:57:15 | 17:28:46 | 00:00:00 | 393 |
| 17424 | Leanne Howell | 64:53:06 | 00:00:00 | 64:53:06 | 00:00:00 | 291 |
| 17429 | Adrianna Mika | 38:57:48 | 34:35:00 | 04:22:48 | 00:00:00 | 258 |
| 17753 | Shelley Hart | 33:46:44 | 07:33:36 | 26:13:08 | 00:00:00 | 390 |
| 17825 | Isabella Francis | 39:04:00 | 06:05:00 | 32:59:00 | 00:00:00 | 393 |
| 17922 | Harry Myers | 32:29:24 | 16:33:20 | 15:56:04 | 00:00:00 | 258 |
| 17930 | Kimberley Hatch | 56:06:23 | 33:07:20 | 22:59:03 | 00:00:00 | 393 |
| 18000 | Rowan Aldhous | 127:59:00 | 75:04:53 | 52:54:07 | 00:00:00 | 286 |
| 18587 | Tayla Flynn | 27:00:00 | 00:00:00 | 27:00:00 | 00:00:00 | 19 |
| 18756 | Kenneth George | 39:48:55 | 00:00:00 | 39:48:55 | 00:00:00 | 138 |
| 18962 | Pareesa Tai | 24:15:51 | 01:15:00 | 23:00:51 | 00:00:00 | 257 |

## Interpretation

`NO_MATCH` is still only a candidate list. It cannot be called missing until Attendance, Journal, Aptem Evidence, date boundaries, and duplicate source rows are checked. Cross-kind typed-reference matches remain eligible for review; the single cross-kind match in this scope has a duration conflict (Old 03:52:52 vs SSOT 00:15:00), so it is not an automatic merge. No row was written or excluded.

Full row-level CSV: [`old_ssot_row_match_54_cross_kind_2026-10-04.csv`](<C:\Users\ayman\Desktop\LMS_T\LMS_v2\backend\reports\old_ssot_row_match_54_cross_kind_2026-10-04.csv>)
