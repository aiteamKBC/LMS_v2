# PMI-SP Scheduling Professional — SSOT-style report

**Write scope:** PMI-SP Scheduling Professional / G1-W / Feb 2026 only.  
**Tutor:** Andrew Millington  
**Coach:** Patryk Zajac; Mohamed Elmasry has individual coach Adeyemi Adeshina.  
**Learners:** 18  
**Read timestamp:** 2026-10-04, Europe/London.  
**Write run:** `activity_sync_runs.id=1718`; user-authorized exception for Evidence `36745`.  
**Comparison rule:** `Aptem` is all locally mirrored Accepted Evidence for the learner. `SSOT` is accepted local progress history, not SP-module-only hours.

## Group — PMI-SP G1-W

- **Aptem:** 5,359:42:00.
- **SSOT after approved write:** 6,429:06:33.
- **Difference:** +1,069:24:33.
- **LMS Activity excluded:** 0 rows / 0:00:00.
- **Confirmed duplicate:** 0 exact LMS Activity duplicates.
- **Status:** `REVIEW` — the approved Evidence was written, but nine other candidates and timestamp issues remain unresolved.

| Aptem ID | الطالب | Aptem | SSOT | الفرق |
|---:|---|---:|---:|---:|
| 7796 | Ali Arshad | 216:40:00 | 219:40:00 | +3:00:00 |
| 9752 | Elizabeth Pardoe | 270:06:00 | 304:24:47 | +34:18:47 |
| 9920 | Hannah Doyle | 274:31:00 | 325:40:56 | +51:09:56 |
| 9280 | James Molloy | 58:43:00 | 71:55:17 | +13:12:17 |
| 6524 | John Bridges | 239:04:00 | 239:04:00 | 0:00:00 |
| 6245 | Laura Harris | 361:37:00 | 372:14:13 | +10:37:13 |
| 6296 | Liam Roberts | 305:41:00 | 372:44:10 | +67:03:10 |
| 6224 | Michael Owen | 221:26:00 | 344:19:46 | +122:53:46 |
| 6492 | Milena Fallows | 319:20:00 | 340:20:46 | +21:00:46 |
| 92 | Mohamed Elmasry | 962:34:00 | 1,591:18:52 | +628:44:52 |
| 9862 | Olha Miniailenko | 286:06:00 | 286:36:00 | +0:30:00 |
| 7217 | Paige Hodgson | 59:33:00 | 62:03:00 | +2:30:00 |
| 6115 | Patricia Gourley | 341:54:00 | 396:33:18 | +54:39:18 |
| 7495 | Rebecca Edwards | 135:47:00 | 140:17:00 | +4:30:00 |
| 10803 | Rhiannon Dalton | 474:43:00 | 489:18:53 | +14:35:53 |
| 6329 | Roy Hillson | 322:29:00 | 322:59:00 | +0:30:00 |
| 9919 | Thomas Farthing | 261:34:00 | 298:12:35 | +36:38:35 |
| 9918 | Timothy White | 247:54:00 | 251:24:00 | +3:30:00 |
| **الإجمالي** | **18** | **5,359:42:00** | **6,429:06:33** | **+1,069:24:33** |

## Approved write

| Evidence | Learner | Aptem minutes | SSOT added | Result |
|---:|---|---:|---:|---|
| 36745 | Hannah Doyle / 9920 | 180 | 3:00:00 | One Aptem Additional row and one Azure report document created idempotently |

- Source: `aptem`, `evidence:36745`.
- The run's audited candidate list contains exactly `[36745]`; its generic `scope=80` field is inherited from the reusable second-pass runner and does not represent additional writes.
- Azure container: `fetch-aptem-evidences`; existing assessment-report blob reused; no upload.
- Azure document: one PDF link; verified present in Azure and stored with `source_document_id=evidence:36745:report`.
- Timestamp allocation is explicitly labelled `تقديري — يحتاج اعتماد`: 2:47:40 on 2026-04-20 and 0:12:20 on 2026-05-11. The source Evidence date was a Sunday, so no weekend hours were written.
- No LMS Activity, Journal, Attendance, Old LMS, or Aptem mirror row was modified.

## Remaining review items

The following Accepted Additional candidates were not written:

`34514, 34519, 40116, 40123, 40126, 47552, 34718, 37774, 55480`

Reasons: TOIL/nonstandard time type, missing explicit allocation, aggregate duration conflict, or daily/weekly timestamp limits. They remain available for a separate business decision and must not be counted automatically.

Known timestamp findings in the wider inventory remain: one bank-holiday event (`55254`), seven daily over-8-hour events, three weekly over-12-hour events, and no monthly over-45-hour event. These do not belong to the approved write and remain `REVIEW`.

## Validation

- Database post-write verification: source, progress parent, reporting segments, document link, and totals verified read-only.
- Idempotence check: rerun preview finds Evidence `36745` as already represented and proposes 0 new rows.
- Azure blob property check: PASS; PDF exists and is `application/pdf`.
- Teams baseline: PASS — 9 files, 105 tests.
- Live Teams: NOT RUN.

## Administrative close — option A

- Administrative close audit: `activity_sync_runs.id=1720`.
- Closeout status: `completed_with_issues` / `REVIEW-BLOCKED exceptions retained`.
- No additional hours were added by the closeout, and no LMS rows were excluded.
- Curriculum module/group status was not changed; the close is an audit/reconciliation close only.
- The nine unresolved Evidence IDs remain preserved for a future separately approved review.

**Final decision:** Administratively closed with exceptions. It is not marked `READY` for a clean hours closure while the nine Evidence candidates and timestamp findings remain unresolved.
