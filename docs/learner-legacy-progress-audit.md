# Learner courses and completion verification — 12 September 2026

All 369 enrolment records were examined against the 54 pages of the original
LMS schema API (1,076 source accounts). The audit fetched every page, then used
the production reader to verify each stored source ID and its expected email.
The database connections enforced read-only transactions; the remote calls were
HTTP GET. No invitations, activation updates, imports or database writes ran.

367 learners have verified live source identities. Aya Aya Test (101) has no
Aptem identity and uses her current platform activity. Ellis Smith (275) remains
an identity exception, described below. The frontend and backend comparison
passed for all 369 records; Ellis's comparison covers the retained historical
snapshot, not a verified live account.

## Results and files

- [Per-learner CSV](../reports/learner-legacy-progress-2026-09-12.csv): total,
  completed, not completed and percentage, plus verification state.
- [Detailed JSON](../reports/learner-legacy-progress-2026-09-12.json): each course,
  its complete/incomplete activity IDs, assigned current modules and component
  IDs, source changes, preserved achievements and exceptions.

The source contains 15,061 learner/activity placements absent from the stored
mirror and 16,276 positive completions absent from it. For verified live courses,
2,438 obsolete mirror placements are replaced by the current inventory. These
are learner/course/activity counts, not unique catalogue activity counts.

249 existing positive completions remain preserved even though the current
source result alone does not complete them. This follows the existing rule that
a later failed attempt or reset does not revoke an earned completion. They are
listed explicitly in the JSON. Martha Pitcher (397) retains one historical-only
course, 125608; it is labelled historical in the audit.

Across the historical/live inventory there are 225,916 placements: 94,914
completed and 131,002 not completed. After unioning explicitly linked native
components and their saved achievements, the programme totals are 355,945
activities and 95,089 completed. The report records each learner separately;
these aggregate counts are verification totals, not one learner's progress.

Examples after combining both systems:

| Learner | Completed | Total | Progress |
| --- | ---: | ---: | ---: |
| Aya Aya Test (101) | 16 | 153 | 10.46% |
| Mohamed Elmasry (125) | 1,392 | 4,422 | 31.48% |
| Amy-Marie Field (133) | 54 | 1,706 | 3.17% |
| Joanna Jagla (342) | 481 | 1,904 | 25.26% |

## Corrections

1. Repeated lecture placements of the same activity no longer reject the entire
   learner's live response. 182 learners initially hit this rejection. An
   activity counts once per course; conflicting lecture dates stay unresolved.
2. A verified alias uses its own stored original email. A primary account may
   also use its verified current canonical email. IDs and emails are still
   checked together; source email/name similarity never creates a new mapping.
3. Local attempts and their history are scoped by enrolment, Aptem ID, course
   and activity. The optimistic frontend update uses the full activity key.
   The present database has one submitted local legacy attempt; the audit found
   no existing cross-course false completion from that attempt.
4. Programme totals read the same live inventory as Modules. Native component
   completion includes saved imported achievements; OTJ additions still include
   only direct current-platform time, preserving the accepted historical hours.
5. The activity response supplies explicit exported component lineage, scoped
   to the learner's assigned modules and courses. The frontend uses those IDs
   to merge duplicate representations even when a module has been renamed.
   Cover metadata continues to manage current artwork independently.
6. Source page reads allow 45 seconds; valid live responses exceeded the former
   15-second limit. Only the student-activity and metrics transports receive a
   bounded three-minute deadline for multi-account/course reads. Ordinary
   learner requests retain their 45-second deadline. Existing snapshots remain
   visible while refreshing. Upstream failure still falls back to the stored
   historical snapshot; a successful offline audit does not guarantee source
   availability on a future request. Modules explicitly labels that fallback
   as saved previous learning and offers retry.

## Source exceptions

**Ellis Smith — enrolment 275, Aptem 6333, source account 1034.** The verified
stored email is `ellis@bdmhtools.co.uk`. The source returns
`aburn.bluediamond@gmail.com`, with display name `aburn-bluediamondgmail-com`.
There is insufficient evidence to adopt that account. The existing historical
data remains available, but its live identity is not verified. The owner was
asked to confirm Ellis's correct old account. No speculative identity update
or SQL was generated.

**Conflicting quiz attachment — course 80625, activity 112193.** The source
repeats the reading “P4-Risk, Governance & Monitoring Resource Use” with quiz
108168 on 21 January 2026 and quiz 112336 on 4 February 2026. The results use the
same course/activity key and do not identify which attached quiz they grade.
Content and recorded completion/history remain visible. New attempts on this
activity cannot select an arbitrary quiz answer key: the player asks the
programme team to confirm the correct quiz. Affected enrolments:
134, 158, 187, 233, 270, 286, 292, 344, 363 and 377.

## Reproduce without database writes

From `backend`, using the configured original-LMS credentials:

```powershell
.venv/Scripts/python.exe scripts/audit_legacy_progress.py --fetch
.venv/Scripts/python.exe scripts/audit_legacy_progress.py --database
.venv/Scripts/python.exe scripts/audit_legacy_progress.py --analyse --frontend
```

Snapshots stay under ignored `.cache/legacy-progress-audit`; they omit API keys
and quiz answers. Fetching resumes missing pages. For a new dated audit, archive
the cache first rather than mixing new and previously fetched pages. The
analysis switches all Django DB aliases to in-memory settings and exercises
the production identity selection, source overlay, completion and totals code
offline. It never invokes a learner detail endpoint that may synchronize data.

From `frontend`, verify the actual cards reducer against all prepared cases:

```powershell
npm exec -- vitest run scripts/legacy-progress-audit.test.ts --maxWorkers=2
```

The private snapshot test is skipped when its generated cache is absent.
Verification completed: 369 per-learner frontend/backend comparisons, 130
targeted backend tests, and the related frontend regression suites. No database
schema change or owner-run SQL is required for the implemented fixes.

Fresh production-reader probes also succeeded against the live API: Mohamed
Elmasry returned 44 courses/4,082 legacy activities; Amy-Marie Field returned
7/1,101 in 25.08 seconds, and Joanna Jagla returned 7/881 in 21.86 seconds. The
last two had timed out with the former 15-second source timeout. The live SQL
lineage query matched the offline audit for these same three learners.

`npm run type-check` still reports existing errors outside these changes in
MonthList, AccessPanel.test, SessionsTree, teams-meetings, historicalEvidence.test,
CreateEmployerModal and CreateUserModal. It reported no errors in the changed
progress readers, cards or transport code. The targeted tests passed; the full
project TypeScript check is not clean.
