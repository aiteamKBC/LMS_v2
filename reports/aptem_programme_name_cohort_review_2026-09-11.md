# Programme-name cohort source

The requested source is now `LMS.Aptem_users."Program Name"`. Learner `Start-Date` is not an input or fallback. No database changes have been applied for this latest correction.

The [new parser](../backend/scripts/aptem_programme_cohorts.py) recognizes full or abbreviated month names and two- or four-digit years anywhere in the programme name, including `Oct.25`, `May 25`, and `July 2025-`. Multiple different intake labels in one name are reported as ambiguous. Undated names are unresolved. Seven tests passed, including the nine real programme-name formats tested individually.

Running the former date-based SQL generator is disabled to prevent generating another rejected start-date plan. Historical executed SQL and backups remain available for audit.

The [programme-name preview](aptem_programme_name_cohort_preview_2026-09-11.json) contains all 35 distinct source programme-name values, including null, with exact parsed cohorts and destination match counts.

| Source category | Aptem rows | Learner email matches | Enrolment email matches |
| --- | ---: | ---: | ---: |
| Explicit month/year in programme name | 470 | 359 | 354 |
| No month/year in programme name | 120 | 7 | 6 |
| Missing programme name | 85 | 7 | 7 |

Of the 470 dated rows, 134 explicitly name **May, July or August** (68 learner matches and 64 enrolment matches). These literal labels conflict with the preceding February/June/October-only instruction. Their mapping must be resolved before another write.

The undated category includes onboarding names, general programme titles and `Project Control Professional Level 6 - Al Fanar`. Its Market Research Executive entry still has no matching live curriculum programme, as in the original import. The handling of existing assignments on undated source rows also remains to be specified.

Examples ready to apply without date calculations:

- `Marketing Manager Level 6 - Feb 2026` -> **Feb 2026**.
- `Marketing Executive Level 4 - June 2026` -> **Jun 2026**.
- `Level 6 Project Controls Professional Oct.25` -> **Oct 2025**.
- `Level 4 Marketing Executive - May 25` -> parsed **May 2025**, pending the allowed-month rule.
- `Marketing Manager Level 6 (Onboarding Stage)` -> **unresolved**, with no guessed cohort.
