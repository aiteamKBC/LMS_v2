# LMS Actual Hours — product requirements

Authoritative business rules for the `xcode-lms-actual-hours` skill. Read this
file in full before implementing or reviewing.

Every constant below is tagged:

- **[GROUNDED]** — traced to the KBC LMS codebase or the learner-journal audit
  report. Do not change without checking the cited source.
- **[STATED]** — given directly by the skill author (the 23%/77%, 7.5% and 9.3%
  figures).
- **[ASSUMED]** — not stated anywhere; a defensible default that the product
  owner must confirm. Every assumed value is listed again in
  [Assumptions to confirm](#assumptions-to-confirm) and must be expressed as a
  single named constant so it can be corrected in one edit.

---

## 0. Integrity contract

These records are real submitted learner evidence used in apprenticeship
funding audits. The rules in this document exist to **validate and report**.

| Allowed | Forbidden |
|---|---|
| Classify a record as normal / long-tail / requires-review / invalid | Rewrite hours so a cohort hits a target percentage |
| Derive duration from genuine `timestampFrom`/`timestampTo` and genuine pauses | Synthesise a timestamp because one is missing |
| Raise a flag on a record | Delete or silently correct a flagged record |
| Store an auditor-approved override **alongside** the source value | Overwrite the source value in place |
| Report observed vs target percentages | Treat a target as a generation rule |

The observed percentages (§6) are diagnostics. A run that reports
`timeStamped = 41%` against a 77% target is a *finding*, not a defect to be
fixed by editing rows.

---

## 1. Domain model

### 1.1 Activity type

Five categories, matching the LMS ledger's `category` check constraint
[GROUNDED: `backend/audit_api/manual_ledger_views.py:110-112`,
`SOURCE_CATEGORIES` / `CATEGORIES` at lines 70-71]:

```swift
enum LMSActivityType: String, Codable, CaseIterable {
    case attendance          // register-driven, fixed session block
    case video               // source-fetched media
    case audio               // source-fetched media
    case readingQuiz         // "reading+quiz" — combined reading + quiz activity
    case assignment          // Aptem assignment, hand-typed, no source table
}
```

Wire values must round-trip the ledger strings exactly:
`attendance`, `video`, `audio`, `reading+quiz`, `assignment`.

`video`, `audio` and `readingQuiz` are the three *retrievable* categories — they
have a source table and can carry genuine timestamps. `attendance` comes from the
register. `assignment` has no source table at all.

### 1.2 Actual-hours source

[GROUNDED: `backend/audit_api/learner_match_ledger_views.py:2675-2681`]

```swift
enum ActualHoursSource: String, Codable {
    case timeStamped   // both timestampFrom and timestampTo are present
    case input         // hours were entered without a timestamp pair
}
```

Derivation rule — this is the *only* way the source may be assigned:

1. If `timestampFrom != nil && timestampTo != nil` → `.timeStamped`.
   Display label is `"HH:mm–HH:mm"` in Europe/London.
2. Else if `declaredSeconds > 0` → `.input`. Display label is the literal
   `"input"`.
3. Else → no source; the row carries no actual hours.

Assignment rows are always `.input`
[GROUNDED: `backend/audit_api/evidence_explorer_views.py:579` inserts
`timestamp_label` = `'input'`].

Never infer `.timeStamped` from a duration, a title, or a date alone.

### 1.3 Record

```swift
struct LMSActivityRecord: Identifiable, Codable {
    let id: UUID
    let aptemLearnerID: Int
    let activityType: LMSActivityType
    let activityDate: DateComponents      // Europe/London calendar date
    let month: String                     // "YYYY-MM"
    let title: String

    let plannedSeconds: Int
    let declaredSeconds: Int              // submitted Actual Hours, as stored
    let timestampFrom: Date?
    let timestampTo: Date?
    let pauses: [ActivityPause]           // genuine recorded pauses only

    let aptemActualSeconds: Int?          // Aptem's own figure, for comparison
    let attendanceMark: AttendanceMark?   // present / absent / nil
    let mediaDurationSeconds: Int?        // asset length, when known

    let revisions: [ActualHoursRevision]  // append-only, never pruned
}

struct ActivityPause: Codable {
    let startedAt: Date
    let endedAt: Date
}
```

`declaredSeconds` is immutable after submission. An approved override lives in
`revisions` and is projected on read (§5.5) — it never replaces this field.

---

## 2. Constants

Use integer seconds throughout. No `Double` accumulation, no `TimeInterval`
arithmetic for stored values.

```swift
enum LMSActualHoursConstants {
    // MARK: Calendar
    static let timeZoneIdentifier = "Europe/London"                 // [GROUNDED: skill body]

    // MARK: Session blocks
    static let attendanceSessionSeconds        = 9_000   // 2.5 h   [GROUNDED: ATTENDANCE_SESSION_HOURS, manual_ledger_views.py:81]
    static let liveSessionSeconds              = 7_200   // 2.0 h   [GROUNDED: LIVE_SESSION_HOURS, audit_api/views.py:39]

    // MARK: Absolute bounds
    static let maxActualSecondsPerRecord       = 180_000 // 50 h    [GROUNDED: CHECK (actual_hours BETWEEN 0 AND 50)]
    static let maxPlannedSecondsPerRecord      = 180_000 // 50 h    [GROUNDED: same constraint]

    // MARK: Working hours
    static let workingDayStartHour             = 8       // 08:00   [ASSUMED]
    static let workingDayEndHour               = 18      // 18:00   [ASSUMED]
    static let maxWorkdaySeconds               = 28_800  // 8 h     [ASSUMED — backs FETCHED_ATTENDANCE_OVER_WORKDAY]
    static let workingWeekdays: Set<Int>       = [2,3,4,5,6]        // Mon–Fri, Gregorian [ASSUMED]

    // MARK: Analytics targets — comparison only, never generation
    static let targetTimeStampedShare          = 0.77    // 77 %    [STATED, mapping ASSUMED]
    static let targetInputShare                = 0.23    // 23 %    [STATED, mapping ASSUMED]
    static let targetSourceExceptionRate       = 0.075   // 7.5 %   [STATED]
    static let targetLongTailShare             = 0.093   // 9.3 %   [STATED]

    // MARK: Ledger window
    static let ledgerEndMonth                  = "2026-08"         // [GROUNDED: LEDGER_END_MONTH]
}
```

### 2.1 Duration classification bands

All bands are inclusive, in seconds, and **[ASSUMED]** unless marked. They
classify; they never clamp.

| Activity type | Normal | Long tail | Requires review | Invalid |
|---|---|---|---|---|
| `readingQuiz` | 300 … 5 400 (5 min – 1.5 h) | 5 401 … 14 400 (– 4 h) | 14 401 … 180 000 | < 0, > 180 000 |
| `video` | 120 … 7 200 (2 min – 2 h) | 7 201 … 18 000 (– 5 h) | 18 001 … 180 000 | < 0, > 180 000 |
| `audio` | 120 … 7 200 | 7 201 … 18 000 | 18 001 … 180 000 | < 0, > 180 000 |
| `attendance` | exactly 9 000 [GROUNDED] | — | any other non-zero value | < 0, > 180 000 |
| `assignment` | 900 … 28 800 (15 min – 8 h) | 28 801 … 72 000 (– 20 h) | 72 001 … 180 000 | < 0, > 180 000 |

A record classified `longTail` is a legitimate record. It contributes to the
9.3 % long-tail analytic (§6.4) and is not a defect.

```swift
enum DurationClassification: String, Codable {
    case normal, longTail, requiresReview, invalid
}
```

---

## 3. Duration derivation

### 3.1 Time Stamped

```
derivedSeconds = (timestampTo − timestampFrom) − Σ genuine pause durations
```

Rules:

- Both endpoints required. One endpoint alone never yields a derived duration.
- `timestampTo < timestampFrom` → `.invalid` with `.timestampsOutOfOrder`.
  [GROUNDED: `learner_match_ledger_views.py:2673-2674` rejects this]
- Mixed timezone awareness between the two endpoints → `.invalid` with
  `.timestampStyleMismatch`.
  [GROUNDED: `learner_match_ledger_views.py:2668-2669`]
- Pauses outside `[timestampFrom, timestampTo]`, or overlapping each other, are
  flagged `.pauseOutsideWindow` / `.overlappingPauses`. Do not drop or merge
  them silently; report and exclude the out-of-window portion from the
  subtraction, keeping the raw pause list intact.
- Net negative after pause subtraction → `.invalid` with `.pausesExceedWindow`.

`derivedSeconds` and `declaredSeconds` are both retained. A mismatch beyond
tolerance is flagged, not reconciled:

```swift
static let declaredVsDerivedToleranceSeconds = 60   // [ASSUMED]
```

### 3.2 Input

No derivation is possible. `derivedSeconds` is `nil`. `declaredSeconds` is
classified against the band table (§2.1) and cross-checked against Aptem (§4.2)
and the monthly bound (§4.3).

### 3.3 Attendance

Attendance logic is **not** re-derived by this feature.
`attendanceSessionSeconds` (2.5 h) is the awarded block for a `present` mark; an
`absent` mark keeps planned hours and awards none
[GROUNDED: comment at `manual_ledger_views.py:79-81`]. The validator only
*checks* consistency and raises §4 flags. It never recomputes attendance hours.

### 3.4 Media duration

When `mediaDurationSeconds` is known, `declaredSeconds` materially exceeding it
is flagged `.exceedsMediaDuration`:

```swift
static let mediaOverrunToleranceRatio = 1.10   // [ASSUMED]
```

---

## 4. Validation flags

Flag identifiers mirror the audit report's finding codes so Swift output
reconciles with the existing Python audit
[GROUNDED: `reports/learner-journal-audit-2026-08-11/learner_journal_suspicious_data_2026-08-11.md`].

```swift
enum ActualHoursFlag: String, Codable, CaseIterable {
    // Report-aligned findings
    case futureActivityHasProgress        // FUTURE_ACTIVITY_HAS_PROGRESS
    case claimedGreaterThanAptemActual    // CLAIMED_GT_APTEM_ACTUAL
    case claimedOverMonthlyBound          // CLAIMED_OVER_MONTHLY_BOUND
    case titleDateMismatch                // TITLE_DATE_MISMATCH
    case invalidDateInActivityTitle       // INVALID_DATE_IN_ACTIVITY_TITLE
    case systemTimestampBankHoliday       // SYSTEM_TIMESTAMP_BANK_HOLIDAY
    case presentAttendanceMissingHours    // PRESENT_ATTENDANCE_MISSING_HOURS
    case attendanceOverWorkday            // FETCHED_ATTENDANCE_OVER_WORKDAY
    case attendanceOverSessionNorm        // FETCHED_ATTENDANCE_OVER_SESSION_NORM

    // Timestamp integrity
    case timestampsOutOfOrder
    case timestampStyleMismatch
    case pauseOutsideWindow
    case overlappingPauses
    case pausesExceedWindow
    case declaredDerivedMismatch

    // Source integrity
    case sourceExceptionMissingTimestamps // labelled timeStamped, no timestamp pair
    case sourceExceptionUnexpectedInput   // retrievable category with no timestamps
    case exceedsMediaDuration

    // Working hours
    case outsideWorkingHours
    case weekendActivity
    case exceedsAbsoluteMaximum
    case afterLedgerEndMonth
}
```

Severity, matching the report's scale: `.critical`, `.high`, `.medium`, `.low`.
`futureActivityHasProgress`, `claimedGreaterThanAptemActual` and every
`invalid`-producing flag are at least `.high`.

### 4.1 Future activity

An `activityDate` after "today" in Europe/London that carries
`declaredSeconds > 0` → `.futureActivityHasProgress`, severity `.critical`.
Compare *calendar dates* in Europe/London, never UTC instants.

### 4.2 Aptem comparison

`declaredSeconds > aptemActualSeconds` (when Aptem's figure exists) →
`.claimedGreaterThanAptemActual`. Existing Aptem logic is untouched; this is a
read-only comparison.

### 4.3 Monthly bound

Sum of `declaredSeconds` for a learner-month exceeding the learner's planned
monthly bound → `.claimedOverMonthlyBound` on every contributing record. The
bound comes from the existing plan projection; do not invent one.

### 4.4 Title/date agreement

A date parsed out of `title` that disagrees with `activityDate` →
`.titleDateMismatch`. A date string in the title that is not a real calendar
date → `.invalidDateInActivityTitle`.

### 4.5 Working hours and bank holidays

`UKWorkingHoursValidator` uses a `Calendar` whose `timeZone` is
`TimeZone(identifier: "Europe/London")`. A fixed UTC offset is a defect — it
breaks across the BST/GMT transition.

- Timestamps outside `workingDayStartHour ..< workingDayEndHour` →
  `.outsideWorkingHours`, severity `.medium`.
- Timestamps on a Saturday or Sunday → `.weekendActivity`, severity `.medium`.
- **System-generated** timestamps on a UK bank holiday →
  `.systemTimestampBankHoliday`. The authoritative calendar is
  `https://www.gov.uk/bank-holidays.json`, `england-and-wales` division
  [GROUNDED: report line 35].

Bank-holiday data requirements:

- Cache the fetched calendar locally; never hardcode a year's dates as the only
  source.
- If the calendar is unavailable, return `.unknown` for the bank-holiday check
  and record it — do not treat "unknown" as "not a bank holiday".

Learner-entered work on evenings, weekends and holidays is legitimate. These
flags surface *system* timestamps that fall where automated capture should not
have run.

### 4.6 Attendance-specific

- `attendanceMark == .present` with `declaredSeconds == 0` →
  `.presentAttendanceMissingHours`.
- Attendance `declaredSeconds > maxWorkdaySeconds` → `.attendanceOverWorkday`.
- Attendance `declaredSeconds != attendanceSessionSeconds` →
  `.attendanceOverSessionNorm` (report code covers the over-norm direction;
  under-norm is `.medium`).

### 4.7 Structured result

```swift
struct ActualHoursValidation {
    let recordID: UUID
    let source: ActualHoursSource?
    let declaredSeconds: Int
    let derivedSeconds: Int?
    let classification: DurationClassification
    let flags: [FlaggedFinding]
    let bankHolidayCheck: TernaryResult   // .yes / .no / .unknown

    var isValid: Bool { classification != .invalid }
}

struct FlaggedFinding: Codable {
    let flag: ActualHoursFlag
    let severity: Severity
    let detail: String            // human-readable evidence, no mutation
}
```

Return this one value. Do not return loose `Bool` pairs, and do not throw for
data findings — throw only for programmer error (a nil timezone, a malformed
band table).

---

## 5. Authorization, override, approval

### 5.1 Roles

```swift
enum LMSRole: String, Codable { case learner, coach, employer, auditor, admin }
```

### 5.2 Who may propose

Only `.auditor` may propose a change to a submitted Actual Hours value.
Enforcement lives in `ActualHoursApprovalService` — the domain layer — and is
covered by a unit test that calls the service directly with a non-auditor
principal. A disabled SwiftUI button is not enforcement.

```swift
enum ActualHoursAuthorizationError: Error {
    case notAnAuditor
    case selfApprovalForbidden
    case revisionNotPending
    case recordNotFound
}
```

### 5.3 Revision

```swift
struct ActualHoursRevision: Identifiable, Codable {
    let id: UUID
    let recordID: UUID
    let proposedSeconds: Int
    let previousSeconds: Int          // the value live at proposal time
    let proposedBy: UserID
    let proposedAt: Date
    let reason: String?               // optional
    let evidenceReferences: [String]  // optional
    var state: RevisionState
    var decidedBy: UserID?
    var decidedAt: Date?
    var decisionNote: String?
}

enum RevisionState: String, Codable { case pending, approved, rejected }
```

`reason` and `evidenceReferences` are optional by requirement. Do not add a
validation that rejects an empty reason.

### 5.4 Second-person approval

- A `pending` revision has no effect on any read, export, or analytic.
- Approval requires an `.auditor` **different from** `proposedBy`.
  `decidedBy == proposedBy` → `.selfApprovalForbidden`, regardless of role.
- Rejection follows the same authorization rule and is retained permanently.
- Only `pending` revisions may be decided. Re-deciding → `.revisionNotPending`.
- Deleting or editing a revision is not an available operation. There is no
  purge, no cascade delete, no "cleanup" migration.

### 5.5 Effective value

```
effectiveSeconds = revisions
    .filter { $0.state == .approved }
    .max(by: { $0.decidedAt < $1.decidedAt })?
    .proposedSeconds
    ?? declaredSeconds
```

Both values are exposed. Any export or auditor-facing view shows
`declaredSeconds` (source), `effectiveSeconds` (live), and the revision chain.

---

## 6. Analytics

`LMSActualHoursAnalyticsService` is pure: records in, report out, no writes.
Percentages are computed over a stated denominator; an empty denominator yields
`nil`, never `0%`.

```swift
struct ActualHoursAnalyticsReport {
    let totalRecords: Int
    let observed: Observed
    let targets: Targets            // separate struct — never merged
    var variances: [Variance]       // observed − target, reported only
}
```

### 6.1 Source split

```
timeStampedShare = count(source == .timeStamped) / totalWithSource
inputShare       = count(source == .input)       / totalWithSource
```

Targets: `targetTimeStampedShare` 77 %, `targetInputShare` 23 %.

> **Confirm the mapping.** The 23 % / 77 % split is stated; which side is Time
> Stamped is not. The default here assigns 77 % to Time Stamped on the reasoning
> that the three retrievable categories carry genuine timestamps while
> assignment and manual rows are `input`. If the intended split is the reverse,
> swap the two constants in §2 — no other code changes.

### 6.2 Source exception rate

A *source exception* is a record whose source label contradicts its evidence:

- labelled `.timeStamped` without a usable timestamp pair
  (`.sourceExceptionMissingTimestamps`), or
- a retrievable category (`video`, `audio`, `readingQuiz`) resolved to `.input`
  (`.sourceExceptionUnexpectedInput`).

```
sourceExceptionRate = count(records with either flag) / totalWithSource
```

Target: `targetSourceExceptionRate` ≤ 7.5 %. Exceeding it is a reporting
finding about data capture, not a licence to relabel rows.

### 6.3 Classification distribution

Count and percentage for each of `normal`, `longTail`, `requiresReview`,
`invalid`, over `totalRecords`. The four counts must sum to `totalRecords` —
assert this in a test.

### 6.4 Long tail

`longTailShare = count(classification == .longTail) / totalRecords`, target
`targetLongTailShare` 9.3 %.

### 6.5 Reporting rule

The report renders observed and target side by side with the variance. It
exposes no mutating API. No code path may read a target and then write a record.

---

## 7. Edge cases

| Case | Required behavior |
|---|---|
| `declaredSeconds == 0`, no timestamps | No source; excluded from §6.1/§6.2 denominators; not invalid |
| `declaredSeconds < 0` | `.invalid` + `.exceedsAbsoluteMaximum` is wrong — use `.invalid` with a negative-value detail; never `abs()` |
| `declaredSeconds > 180 000` | `.invalid` + `.exceedsAbsoluteMaximum`; retain the value as submitted |
| Only `timestampFrom` present | Source is `.input` if hours > 0; `derivedSeconds` stays `nil`; flag `.sourceExceptionMissingTimestamps` for a retrievable category |
| `timestampTo == timestampFrom` | `derivedSeconds == 0`; classified per band (0 is outside every normal band) |
| Activity spans midnight | Legal. Derive across the boundary; working-hours check evaluates both endpoints |
| Activity spans the BST↔GMT change | Derive from instants, not wall clock. A 01:00→02:00 GMT-end window is 7 200 s, not 3 600 s. Test both transitions |
| `month` disagrees with `activityDate` | `.titleDateMismatch` sibling: flag `.monthDateMismatch`; use `activityDate` for date logic |
| `month > ledgerEndMonth` | `.afterLedgerEndMonth` |
| Bank-holiday JSON unreachable | `bankHolidayCheck == .unknown`; surface in the report; never silently `.no` |
| Duplicate approved revisions with equal `decidedAt` | Tie-break on `id` deterministically; assert stability in a test |
| Record with a pending revision | All reads and analytics use `declaredSeconds` |

---

## 8. Testing matrix

Every row is a required unit test.

### 8.1 Source derivation

| Input | Expected |
|---|---|
| both timestamps, hours > 0 | `.timeStamped`, label `"HH:mm–HH:mm"` |
| no timestamps, hours > 0 | `.input`, label `"input"` |
| no timestamps, hours == 0 | source `nil`, no label |
| `to` before `from` | `.invalid`, `.timestampsOutOfOrder` |
| one aware / one naive timestamp | `.invalid`, `.timestampStyleMismatch` |
| assignment with both timestamps | `.input` — assignments never derive |

### 8.2 Band boundaries

For each activity type, test the exact edges of §2.1: `lower − 1`, `lower`,
`upper`, `upper + 1` for the normal band and the long-tail band. Attendance:
`8_999`, `9_000`, `9_001`.

### 8.3 Pauses

| Input | Expected |
|---|---|
| one pause fully inside the window | subtracted from `derivedSeconds` |
| pause partially outside | `.pauseOutsideWindow`; only the in-window part subtracted; raw list intact |
| two overlapping pauses | `.overlappingPauses`; no double subtraction |
| pauses summing beyond the window | `.invalid`, `.pausesExceedWindow` |

### 8.4 Europe/London

| Input | Expected |
|---|---|
| 2026-03-29 00:30 → 02:30 local (BST start) | 3 600 s derived — one hour is skipped |
| 2026-10-25 01:00 → 02:00 local (GMT return) | 7 200 s derived — one hour repeats |
| 07:59 and 08:00 timestamps | `.outsideWorkingHours` for the first only |
| 17:59 and 18:00 timestamps | `.outsideWorkingHours` for the second only |
| Saturday timestamp | `.weekendActivity` |
| Boxing Day system timestamp | `.systemTimestampBankHoliday` |
| bank-holiday fetch fails | `.unknown`, no flag, reported |
| validator built with a fixed +0000/+0100 offset | test asserts the calendar's `timeZone` identifier is `"Europe/London"` |

### 8.5 Authorization and approval

| Scenario | Expected |
|---|---|
| learner / coach / employer proposes | `.notAnAuditor`, no revision created |
| auditor proposes | `pending` revision, `declaredSeconds` unchanged |
| pending revision present | `effectiveSeconds == declaredSeconds` |
| proposer approves own revision | `.selfApprovalForbidden` |
| second auditor approves | `effectiveSeconds == proposedSeconds`; `declaredSeconds` unchanged |
| second auditor rejects | `effectiveSeconds == declaredSeconds`; rejection retained |
| approve an already-approved revision | `.revisionNotPending` |
| revision with `nil` reason and no evidence | succeeds |
| two sequential approved revisions | latest `decidedAt` wins; both retained |

### 8.6 Analytics

| Scenario | Expected |
|---|---|
| empty record set | every share `nil`; no divide-by-zero |
| all four classifications present | counts sum to `totalRecords` |
| observed 41 % vs 77 % target | variance reported; **no record mutated** — assert deep equality of the input set before and after |
| mixed source-exception records | rate matches the hand-computed fraction |

### 8.7 Integrity regression tests

These exist to catch a future refactor that "helpfully" normalises data:

- Run the full validator and analytics pipeline over a fixture set, then assert
  the fixture set is byte-for-byte unchanged.
- Assert no production type exposes a setter for `declaredSeconds`,
  `timestampFrom`, `timestampTo`, `attendanceMark`, or `aptemActualSeconds`.
- Assert the revision array has no removal path.

---

## 9. Assumptions to confirm

| # | Assumption | Where | If wrong |
|---|---|---|---|
| 1 | 77 % is the **Time Stamped** share and 23 % the **Input** share | §2, §6.1 | Swap the two constants |
| 2 | Working day is 08:00–18:00 Europe/London | §2 | Change two constants |
| 3 | Working week is Mon–Fri | §2 | Change `workingWeekdays` |
| 4 | Workday cap behind `FETCHED_ATTENDANCE_OVER_WORKDAY` is 8 h | §2 | Change `maxWorkdaySeconds` — the real value lives in the Python audit script that produced the report, not in the repo |
| 5 | Reading/Quiz normal band 5 min – 1.5 h; long tail to 4 h | §2.1 | Edit the band table |
| 6 | Video/Audio normal band 2 min – 2 h; long tail to 5 h | §2.1 | Edit the band table |
| 7 | Assignment normal band 15 min – 8 h; long tail to 20 h | §2.1 | Edit the band table |
| 8 | Declared-vs-derived tolerance 60 s | §3.1 | Change one constant |
| 9 | Media overrun tolerance 110 % | §3.4 | Change one constant |
| 10 | Bank-holiday division is `england-and-wales` | §4.5 | Change the division key |

Items 5–7 determine the observed long-tail percentage directly. Until they are
confirmed, treat any comparison against the 9.3 % target as provisional and say
so in the report.
