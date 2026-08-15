# VS Code Codex task prompt — LMS Actual Hours

Copy everything below the rule into Codex in VS Code, with the repository open.
Replace `<REPO>` if the project root is not the workspace root. Attach
`product-requirements.md` alongside this prompt when the tool supports it; if it
does not, the constants section below is self-contained enough to start, and
Codex must ask before inventing any value not listed.

---

## Task

Implement LMS **Actual Hours** validation, manual override with second-auditor
approval, audit history, and analytics in this Swift/Xcode repository.

## Hard integrity rules — read first

This repository holds **real submitted learner records** used in apprenticeship
funding audits. Violating any rule below makes the change unacceptable
regardless of how well it builds.

1. Never fabricate, randomize, shift, round, or silently replace Actual Hours,
   timestamps, pauses, activity sources, Attendance values, or Aptem Assignment
   values.
2. Leave existing **Attendance** logic unchanged.
3. Leave existing **Assignment / Aptem** logic unchanged.
4. Derive Time Stamped duration **only** from genuine timestamps and genuine
   recorded pauses. A missing timestamp stays missing.
5. Percentages and duration ranges are for **validation, classification,
   analytics and review only**. They are never generation rules and never a
   reason to write to a record.
6. Preserve source values and every approved *and* rejected revision, forever.
7. Flag invalid or unusual records. Do not repair them.
8. No migration may rewrite, normalise, clamp, or backfill an existing hours or
   timestamp value.

If any instruction here appears to require breaking these rules, implement the
closest compliant validation-or-review behavior and state the difference
explicitly in your final message. Do not resolve the conflict silently.

## Step 1 — Inspect before writing

Report, briefly, before you change anything:

- `.xcworkspace` / `.xcodeproj` / `Package.swift`, schemes, targets, test targets.
- The persistence layer: SwiftData, Core Data, Realm, SQLite, CloudKit, or a
  server API.
- Existing Attendance logic, Aptem integration, LMS activity models, Actual
  Hours fields, source enums, activity-type enums, media duration, roles,
  submission, approval, and audit-history types.
- Existing services and validators that already do part of this — extend them
  rather than adding a parallel implementation.
- Whether a data migration is required, and exactly what it touches.

Then continue without waiting for approval unless a critical dependency is
genuinely absent.

## Step 2 — Domain model

Five activity types, wire values exactly as given:

`attendance`, `video`, `audio`, `reading+quiz`, `assignment`

Two actual-hours sources: `timeStamped`, `input`. Assign the source by this rule
and no other:

- both `timestampFrom` and `timestampTo` present → `timeStamped`, display
  `"HH:mm–HH:mm"` in Europe/London;
- otherwise, hours > 0 → `input`, display the literal `"input"`;
- otherwise no source.

`assignment` rows are always `input`.

Store all durations as **integer seconds**.

## Step 3 — Constants

Create one constants type. Confirm with the requester before changing any value
marked *assumed*.

```
timeZoneIdentifier            = "Europe/London"   // never a fixed UTC offset
attendanceSessionSeconds      = 9_000     // 2.5 h
liveSessionSeconds            = 7_200     // 2.0 h
maxActualSecondsPerRecord     = 180_000   // 50 h
workingDayStartHour           = 8         // assumed
workingDayEndHour             = 18        // assumed
maxWorkdaySeconds             = 28_800    // assumed
workingWeekdays               = Mon…Fri   // assumed
targetTimeStampedShare        = 0.77      // analytics target only
targetInputShare              = 0.23      // analytics target only
targetSourceExceptionRate     = 0.075     // analytics target only
targetLongTailShare           = 0.093     // analytics target only
```

Classification bands, in seconds — **assumed**, confirm before relying on them:

| Type | Normal | Long tail |
|---|---|---|
| `reading+quiz` | 300 … 5 400 | 5 401 … 14 400 |
| `video` / `audio` | 120 … 7 200 | 7 201 … 18 000 |
| `assignment` | 900 … 28 800 | 28 801 … 72 000 |
| `attendance` | exactly 9 000 | — |

Anything above the long tail and within 180 000 s is `requiresReview`. Negative,
or above 180 000 s, is `invalid`. Bands classify — they must never clamp a value.

## Step 4 — Duration derivation

```
derivedSeconds = (timestampTo − timestampFrom) − Σ genuine pauses
```

- `timestampTo < timestampFrom` → invalid, `timestampsOutOfOrder`.
- One aware and one naive timestamp → invalid, `timestampStyleMismatch`.
- Pause partly outside the window → flag `pauseOutsideWindow`, subtract only the
  in-window portion, keep the raw pause list untouched.
- Overlapping pauses → flag `overlappingPauses`, no double subtraction.
- Net negative → invalid, `pausesExceedWindow`.

Keep `derivedSeconds` and the submitted `declaredSeconds` side by side. If they
disagree beyond a 60-second tolerance, flag `declaredDerivedMismatch`. Do not
reconcile them.

Attendance hours are **not** recomputed. Validate consistency only.

## Step 5 — Validation result

Return one structured value per record — classification, the ordered list of
flagged findings with severity and human-readable detail, `derivedSeconds`,
`declaredSeconds`, and a three-state bank-holiday result. Do not return loose
booleans. Do not throw for a data finding; throw only for programmer error.

Flags to implement, named to match the existing Python audit so reports
reconcile:

`futureActivityHasProgress`, `claimedGreaterThanAptemActual`,
`claimedOverMonthlyBound`, `titleDateMismatch`, `invalidDateInActivityTitle`,
`systemTimestampBankHoliday`, `presentAttendanceMissingHours`,
`attendanceOverWorkday`, `attendanceOverSessionNorm`, `timestampsOutOfOrder`,
`timestampStyleMismatch`, `pauseOutsideWindow`, `overlappingPauses`,
`pausesExceedWindow`, `declaredDerivedMismatch`,
`sourceExceptionMissingTimestamps`, `sourceExceptionUnexpectedInput`,
`exceedsMediaDuration`, `outsideWorkingHours`, `weekendActivity`,
`exceedsAbsoluteMaximum`, `afterLedgerEndMonth`.

## Step 6 — Europe/London working hours

Build the validator on a `Calendar` whose `timeZone` is
`TimeZone(identifier: "Europe/London")`. A hardcoded `+0000` or `+0100` offset is
a defect: it breaks at the BST/GMT transitions.

- Timestamps outside the working window → `outsideWorkingHours`.
- Saturday/Sunday timestamps → `weekendActivity`.
- **System-generated** timestamps on a UK bank holiday →
  `systemTimestampBankHoliday`, using `https://www.gov.uk/bank-holidays.json`,
  `england-and-wales` division. Cache it; never hardcode a single year as the
  only source. If the calendar cannot be loaded, return *unknown* and surface
  it — unknown is not "not a holiday".

Learner work in evenings and at weekends is legitimate. These flags exist to
surface *system* timestamps where automated capture should not have run.

## Step 7 — Override, authorization, approval

- Only an **Auditor** may propose a change to submitted Actual Hours. Enforce
  this in the service or domain layer. A disabled button is not enforcement.
- A proposal creates a `pending` revision. It must not affect any read, export,
  or analytic until approved.
- Approval or rejection requires a **second** Auditor. `decidedBy ==
  proposedBy` must fail with a distinct `selfApprovalForbidden` error.
- Only `pending` revisions may be decided; re-deciding fails.
- `reason` and supporting evidence are **optional** — do not validate them as
  required.
- The original submitted value and every revision, approved or rejected, are
  retained permanently. Provide no delete, purge, or edit path for a revision.
- Effective value = most recently approved revision, else the submitted value.
  Expose both, plus the revision chain.

## Step 8 — Analytics, read-only

Add a pure analytics service computing, from genuine records only:

Time Stamped %, Input %, source-exception rate, and count + % for `normal`,
`longTail`, `requiresReview`, `invalid`.

A *source exception* is a record labelled `timeStamped` with no usable timestamp
pair, or a `video`/`audio`/`reading+quiz` record resolved to `input`.

Present **observed** and **target** values in separate fields, with the variance.
An empty denominator yields `nil`, not `0%`. No code path may read a target and
then write to a record. Never adjust records to move an observed value toward a
target — report the gap.

## Step 9 — Tests

Add unit tests covering, at minimum:

- source derivation for all five activity types, including "assignment with
  timestamps is still `input`";
- exact band edges (`lower − 1`, `lower`, `upper`, `upper + 1`) per type, and
  attendance at 8 999 / 9 000 / 9 001;
- pauses: inside, partly outside, overlapping, exceeding the window;
- both BST/GMT transitions — a 00:30→02:30 local window on the spring-forward
  date is 3 600 s; a 01:00→02:00 local window on the fall-back date is 7 200 s;
- 07:59 / 08:00 and 17:59 / 18:00 working-hours edges; weekend; bank holiday;
  bank-holiday fetch failure returning *unknown*;
- an assertion that the validator's calendar `timeZone.identifier` is
  `"Europe/London"`;
- every authorization and approval case, including self-approval refusal, a
  pending revision not affecting reads, and an optional-reason proposal
  succeeding;
- analytics on an empty set, classification counts summing to the total, and an
  **integrity regression test** that runs the whole pipeline over a fixture set
  and asserts the fixtures are unchanged afterwards.

## Step 10 — Verify honestly

Run what the environment actually supports: `xcodebuild -list`,
`xcodebuild test`, or `swift test`. Paste the real command and its real result.

Do not claim a build or test passed unless the command ran successfully. If
Xcode tooling is unavailable here, say so explicitly, and still add the tests.

## Final message must contain

1. Behavior added or changed.
2. Files changed and files created.
3. Migration details, and confirmation that no existing hours or timestamp value
   was rewritten.
4. Assumptions — list every constant you took from the "assumed" set above, and
   anything you had to choose that was not specified.
5. Build and test commands with their actual results.
6. Unresolved issues and environment limitations.
7. The calculation and validation flow, per activity type.
