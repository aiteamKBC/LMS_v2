# Aptem intake correction

Committed on 11 September 2026 at 11:47 UTC. Verified after commit using a fresh read-only connection.

The corrected rule is based on the learner's start month. February, June and October starts stay in that month's intake.

| Start month | Intake |
| --- | --- |
| January-February | February, same year |
| March-June | June, same year |
| July-October | October, same year |
| November-December | February, following year |

The prior import's 55 active cohorts and 126 groups are now **22 active cohorts and 84 groups**. Five required cohorts were created; 38 incorrect cohorts and 42 duplicate groups were archived. Group names retain their exact Aptem spelling. The existing authored module and its group ID were preserved.

| Programme | Active cohorts | Active groups |
| --- | ---: | ---: |
| Associate Project Manager Level 4 | 4 | 5 |
| Marketing Executive Level 4 | 6 | 24 |
| Marketing Manager Level 6 | 5 | 24 |
| Project Controls Professional Level 6 | 7 | 31 |

Changed 160 learner placements and 158 enrolment placements. Verified all 365 eligible learner placements and 359 eligible enrolment placements against the corrected rule, their groups and their programme links, with zero errors. The original import's 92 source rows with missing/unmatched programmes remain outside this correction. Coach assignments are unchanged.

Eight pure Python tests cover all twelve start months, leap days, year boundaries, duplicate merging, programme scope, existing module preservation, duplicate emails, conflicting delivery details and changed source data. PostgreSQL also planned all 39 write statements without execution before the correction was applied. Snapshot/reference checks ran before the writes, and relationship checks ran before commit. No migrations or Git commits were used.

Artifacts:

- [Executed SQL](../backend/sql/2026-09-11_correct_aptem_intakes.sql): exact correction, guarded against changed snapshots. Do not rerun after success; its preflight will reject the changed state.
- [Before snapshot](aptem_intake_correction_before_2026-09-11.json): local backup of affected placements, cohorts, groups, source fields and the existing module.
- [Correction plan](aptem_intake_correction_plan_2026-09-11.json): old-to-new cohort and group IDs.
- [Committed result](aptem_intake_correction_result_2026-09-11.json): counts and post-commit verification.
- [Planner](../backend/scripts/prepare_aptem_intake_correction.py): builds SQL from the local snapshot without making database changes.

Run the pure tests with `backend/venv/Scripts/python.exe backend/scripts/tests_aptem_intake_correction.py`.
