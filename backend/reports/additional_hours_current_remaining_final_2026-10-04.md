# Current Below-Aptem Additional Hours Reconciliation — 2026-10-04

## Scope

- Original supplied scope: 89 learners.
- Comparison: live SSOT accepted actual seconds versus live Aptem accepted positive evidence minutes.
- Only Aptem `Additional job activity` evidence was eligible for this pass.
- Aptem mirror, LMS Activity rows, Assignments, Journal, Old LMS, and Attendance were not modified.

## Applied write

The approved one-pass reconciliation was applied in sync runs `1690`–`1695`, `1697`,
`1698`–`1704`, and the two existing-source repairs `1713`–`1715`:

- 20 accepted Additional Evidence items represented.
- 970,200 seconds (`269:30:00`) counted by those Evidence IDs.
- 18 new Additional source rows plus 2 existing source rows repaired in place.
- 74 reporting segments.
- 34 Azure evidence documents linked idempotently.
- 0 LMS/Assignment/Journal rows excluded or changed.
- No hard delete; original evidence blobs were preserved.

Evidence IDs written: `44757`, `9029`, `28434`, `16351`, `20566`, `31096`, `35431`, `41499`,
`25443`, `27691`, `7016`, `26124`, `44535`, `36233`, `44675`, `6353`, `16133`, `36469`,
`45607`, `47747`.

## Current result

- 23 learners are equal to or above Aptem.
- 66 learners remain below Aptem.
- A fresh post-write dry run found 0 new safe candidates in the reviewed set; the write is idempotent.
- The current totals include all live accepted SSOT rows, including a previously completed independent run (`1689`).

## Blocked or excluded

- Aptem ID `1132` — Liberty Gascoigne: evidence `39888` (360 minutes) has no valid weekday capacity under the configured date/cap rules.
- Aptem ID `1521` — Lauren Kent: evidence IDs `28481`, `30534`, `30535`, `30658`, `35715` have no valid weekday capacity under the configured date/cap rules.
- Aptem ID `1277` — Neil Gamble: evidence `44763` excluded because its date is outside the learner Start/End window.
- Aptem ID `1168` — Parisa Borghei: evidence `23652` excluded because its completion date is before Start Date.
- Aptem ID `1000` — Joanna Farn: evidence `25515` (120 hours) cannot be fully distributed within the remaining valid capacity.
- Evidence `45607` and `47747` contain multiple activity lines; the full file plus assessment report was checked and the line totals exactly matched Aptem.
- `45607` (32 hours) and `47747` (31 hours) were repaired in their existing source rows; no duplicate source IDs were created.
- Evidence `24402` and `24432` fall before learner `5144`'s Start Date and were not counted.
- Evidence `36480` and `51076` are already represented by journal-linked rows (one has an explicit 12-hour monthly-cap decision); adding Aptem rows would double count those events.
- Evidence `46678`, `46715`, `55164`, and `55701` are represented by existing aggregate parents with active reporting segments; no second set of hours was inserted.
- Evidence `23753` and `44756` still have duration conflicts between the Aptem claim and attached content.
- Evidence `44536` remains image-only without extractable duration support. The written image-only items (`6353`, `7016`, `26124`, `44535`, `44675`) were accepted only where the paired assessment report supplied the reviewed duration basis.
- Evidence `39938` has a Note/external link but no Azure file or report blob.
- The latest read-only audit found 2 Azure blob references that could not be streamed and 16 image-only blobs with no extractable text; these remain review items.

The remaining items are `REVIEW`/blocked; they were not force-written because doing so would either
duplicate an active aggregate/journal event, violate the learner date window, or invent duration/timestamps.

## Integrity checks

- New progress rows: 18; total `743400` seconds.
- Repaired existing source/parent rows: 2; additional `226800` seconds.
- Reporting segments for the full pass: 74; total `970200` seconds.
- Azure documents linked for the full pass: 34.
- Duplicate active `evidence:<id>` sources in the 89-learner scope: 0.
- Negative active progress rows: 0.
- Non-Aptem/non-Additional rows in these runs: 0.

## Validation

- `npm --prefix frontend run test:teams` — PASS (9 files, 105 tests).
- `python -m unittest test_reconcile_aptem_evidence.py` — PASS (17 tests).

The group is **not ready for closure** while the 66 below-Aptem learners and the remaining
blocked/unsupported evidence cases remain unresolved.
