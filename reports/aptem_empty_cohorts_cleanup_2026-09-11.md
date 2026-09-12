# Superseded cohort cleanup

Permanently deleted **38 superseded cohorts** and their **42 unused archived duplicate groups** on 11 September 2026 at 12:08 UTC, as requested. These were exactly the records archived by the earlier intake correction, identified by the saved correction plan and `deleted_by = 'aptem_intake_correction'`.

Before deletion, all records were backed up locally and checked for references in learner/enrolment placements, modules, attendance, reflections, progress, week templates, coach group lists and cohort group lists. No references remained. Both ID references and programme-scoped cohort-name references were checked. There were no foreign keys or deletion triggers on the two curriculum tables.

The deletion ran in one transaction with snapshot guards, reference guards and locks on the relevant tables. Fingerprints confirmed that other cohorts, other groups, learner placements, enrolment placements and the attached module remained unchanged. A fresh read-only connection confirmed that the 38 cohort rows and 42 group rows are absent. **22 active imported cohorts and 84 active groups remain.**

- [Executed SQL](../backend/sql/2026-09-11_delete_superseded_empty_cohorts.sql)
- [Backup of deleted rows](aptem_empty_cohorts_before_delete_2026-09-11.json)
- [Committed result and verification](aptem_empty_cohorts_deletion_result_2026-09-11.json)

The separate request to derive assignments from programme names remains pending the interpretation of explicit May/July/August labels and names without an intake. This cleanup did not select or apply either mapping policy. See the [programme-name preview review](aptem_programme_name_cohort_review_2026-09-11.md).
