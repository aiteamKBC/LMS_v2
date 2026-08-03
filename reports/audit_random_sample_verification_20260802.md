# Audit Random Sample Verification

Generated: 2026-08-02

## Scope

This test compared what the Audit UI payload would display against the exact raw database sources currently wired for the report:

- LMS month/week/activity source: `Audit.learner_match.programme_structure`
- Attendance source expected by current no-fallback code: `KBCDATABASE.public.kbc_attendence`
- Assignment source expected by current no-fallback code: `fetching_attendence.public.assessment_fetch`

No fallback data source was used for the checks.

## Source Availability

| Source | Status | Notes |
| --- | --- | --- |
| `Audit.learner_match.programme_structure` | Available | 617 learner rows with non-empty programme structure were found. |
| `KBCDATABASE.public.kbc_attendence` | Not found | The configured KBC database connection works, but this exact table name was not present. Nearby diagnostic table found: `public.kbc_attendance`. It was not used as a fallback. |
| `fetching_attendence.public.assessment_fetch` | Not configured | No `ASSESSMENT_FETCH_DATABASE_URL` or `FETCHING_ATTENDENCE_DATABASE` connection was configured. |

## Random Sample Results

### 1. Craig Norris, Learner ID 6481

Programme: Marketing Executive Level 4 - Feb 2026

| Check | Raw DB | UI Payload | Result |
| --- | ---: | ---: | --- |
| Past months | 9 | 9 | Pass |
| Weeks | 0 | 0 | Pass |
| LMS components | 0 | 0 | Pass |
| Completed LMS components | 0 | 0 | Pass |
| Attendance rows | 0 | 0 | Pass |
| Assignment rows | 0 | 0 | Pass |

### 2. Sue Stafford, Learner ID 515

Programme: Level 6 Project Controls Professional

| Check | Raw DB | UI Payload | Result |
| --- | ---: | ---: | --- |
| Past months | 25 | 25 | Pass |
| Weeks | 127 | 127 | Pass |
| LMS components | 1378 | 1378 | Pass |
| Completed LMS components | 439 | 439 | Pass |
| Attendance rows | 0 | 0 | Pass |
| Assignment rows | 0 | 0 | Pass |

First sampled UI weeks:

| Week key | Week title | LMS items | Attendance | Assignments | Sample titles |
| --- | --- | ---: | ---: | ---: | --- |
| `2026-06-01` | 1-7 Jun | 99 | 0 | 0 | Part 1- PMO Structure &amp; Fit- 12-6-2026; Part 1 - Podcast; P1 - PPT- PMO Structure &amp; Fit |
| `2026-05-01` | 1-7 May | 23 | 0 | 0 | P1-PMP Revision Session \|\|\| -Q1-Q18; P2-PMP Revision Session \|\|\| -Q19-Q30; P1-MS Project - for beginners A3 |
| `2026-04-01` | 1-7 Apr | 53 | 0 | 0 | P1-Assurance, Risk &amp; Control; Power Point 1: Assurance, Risk &amp; Control; P2-The Three Lines Of Defence |

### 3. Daniel Warren, Learner ID 14196

Programme: Project Controls Professional Level 6 - June 2026

| Check | Raw DB | UI Payload | Result |
| --- | ---: | ---: | --- |
| Past months | 4 | 4 | Pass |
| Weeks | 1 | 1 | Pass |
| LMS components | 4 | 4 | Pass |
| Completed LMS components | 0 | 0 | Pass |
| Attendance rows | 0 | 0 | Pass |
| Assignment rows | 0 | 0 | Pass |

First sampled UI week:

| Week key | Week title | LMS items | Attendance | Assignments | Sample titles |
| --- | --- | ---: | ---: | ---: | --- |
| `2026-06-01` | 1-7 Jun | 4 | 0 | 0 | Part 1 : Programme and Portfolio Management; P1-PPT-Programme and Portfolio Management; Part 2 : The Six Principles |

### 4. Daisy Treloar, Learner ID 2415

Programme: Marketing Executive Level 4 - Feb 2026

| Check | Raw DB | UI Payload | Result |
| --- | ---: | ---: | --- |
| Past months | 9 | 9 | Pass |
| Weeks | 1 | 1 | Pass |
| LMS components | 1 | 1 | Pass |
| Completed LMS components | 0 | 0 | Pass |
| Attendance rows | 0 | 0 | Pass |
| Assignment rows | 0 | 0 | Pass |

First sampled UI week:

| Week key | Week title | LMS items | Attendance | Assignments | Sample titles |
| --- | --- | ---: | ---: | ---: | --- |
| `2026-05-01` | 1-7 May | 1 | 0 | 0 | Apprentice Charter Agreement with the Marketing Executive Level 4 |

### 5. Mark Jackson, Learner ID 6732

Programme: Project Controls Professional Level 6 - Feb 2026

| Check | Raw DB | UI Payload | Result |
| --- | ---: | ---: | --- |
| Past months | 9 | 9 | Pass |
| Weeks | 31 | 31 | Pass |
| LMS components | 179 | 179 | Pass |
| Completed LMS components | 114 | 114 | Pass |
| Attendance rows | 0 | 0 | Pass |
| Assignment rows | 0 | 0 | Pass |

First sampled UI weeks:

| Week key | Week title | LMS items | Attendance | Assignments | Sample titles |
| --- | --- | ---: | ---: | ---: | --- |
| `2026-07-01` | 1-7 Jul | 40 | 0 | 0 | PPT- L21-Plan resource management + estimate resources; roles, responsibilities, RAM/RACI; P1-Plan resource management + estimate resources; P2-Roles, responsibilities, RAM/RACI |
| `2026-06-01` | 1-7 Jun | 26 | 0 | 0 | PPT-L17-Monitor &amp; Control Costs Inputs, Tools &amp; Techniques and Outputs; P1-Where We Are In The Finance Journey; P2-CPI &amp; SPI Dashboard |
| `2026-05-01` | 1-7 May | 33 | 0 | 0 | P1-PMP Revision Session \|\|\| -Q1-Q18; P2-PMP Revision Session \|\|\| -Q19-Q30; P1-Schedule Domain |

## Conclusion

For the five random learners sampled, the LMS months, weeks, component counts, and completed component counts displayed by the Audit payload matched the raw `Audit.learner_match.programme_structure` data exactly.

Attendance and assignment checks passed only as zero-to-zero because the exact no-fallback sources were unavailable in this environment:

- `public.kbc_attendence` was not found.
- `fetching_attendence.public.assessment_fetch` was not configured.

Before relying on attendance/assignment sections in production, confirm the exact attendance table name and configure the exact assessment database connection. The diagnostic scan found `public.kbc_attendance`, but it was not used because fallback behavior is disabled.
