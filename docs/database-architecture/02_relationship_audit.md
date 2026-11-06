# Relationship and integrity audit

Scope: the verified `lms-ideal-architecture` branch only. Analysis and documentation; no changes. [Provenance](evidence/audit_provenance.json).

## Confirmed relationship defect

**DB01 — P0:** `curriculum.week_templates.programme_id` has **4 non-null rows without a matching `curriculum.programmes.programme_id`**. The existing `week_templates_programme_id_fkey` is `NOT VALID`. This is a violation of an existing relationship, not a missing FK. [Per-constraint evidence](evidence/fk_integrity_checks.csv).

The catalog has 287 FKs. Bounded anti-joins completed for **260**; **27 validated FKs** remain unscanned due to size bounds. All **11 unvalidated FKs** were checked. The other ten returned zero unmatched non-null rows at observation time. No constraint was validated in PostgreSQL by this audit.

Required correction: recover each template's original programme from provenance, approve the mapping, preserve before-images, update only approved stable keys, then validate the existing FK. If ownership is unresolved, retain the records and document that state. Do not delete them, invent a programme, or match records by coincidental numeric IDs. Template collection/detail endpoints and learner-plan propagation need later regression checks.

## Missing FK assessment

**Confirmed missing required FKs: 0.** This means none established by this audit, not proof that none are missing.

One resolvable ORM declaration lacks its corresponding FK: `LearnerKsb.learner` points from `Learner.learner_ksbs.learner_id` to `Learner.learners.id`. A bounded aggregate found **846 unmatched IDs out of 1,241 rows**, but this is not a confirmed orphan count:

- The physical legacy table has composite PK `(learner_id, category, code)` and different fields from the rollback ORM model.
- `learner_ksbs_relation_exists()` checks the required legacy columns before using that model (`backend/learner_api/models.py:68`).
- The current canonical KSB assignment graph uses `learner_ksb_assignments` and `curriculum.ksb_profile_versions`. Legacy source IDs may belong to a different namespace.

Classify this as **suspected issue requiring verification**. Do not add a CASCADE FK or rewrite IDs until the source owner confirms their meaning. [ORM candidate](evidence/orm_missing_fk_candidates.csv), [aggregate evidence](evidence/legacy_ksb_candidate_check.json).

[Identifier-column triage](evidence/unenforced_identifier_columns.csv) lists `_id`/`_uuid` columns without catalog FK participation and deliberately assigns no target. Polymorphic, external and historical identifiers can be legitimate. Names alone do not establish a relationship.

## Relationship semantics

[Constraint definitions](evidence/constraints.csv) preserve ordered columns, referenced tables, validation, MATCH semantics, deferrability, ON DELETE and ON UPDATE. Action codes: `a=NO ACTION`, `r=RESTRICT`, `c=CASCADE`, `n=SET NULL`, `d=SET DEFAULT`. No action was changed. Review history, attendance and signed-review retention before changing cascades; there is no blanket replacement policy.

[Cross-type FK pairs](evidence/fk_identifier_type_differences.csv) are potential improvements, not necessarily invalid relationships. Compatible cross-type equality is possible. Confirm range, casts, serializers and all writers before changing either type.

The FK graph has **three self-reference components**: `Feedback.feedback_forms`, `knowledge.sections`, and `structured_manual_activities.manual_month_restore_points`. No multi-table strongly connected component was found. Hierarchy and restore lineage can justify self-reference. [Cycle evidence](evidence/fk_cycles.csv).

## Dependency boundaries

[All-table dependency matrix](evidence/dependency_matrix.csv) and [source locations](evidence/table_code_references.csv) are static evidence, not a complete runtime call graph. URLconf associations within an application are labeled candidates. External BI, sync/import jobs, other applications and direct SQL writers remain unverified. Both foreign tables were cataloged without accessing their server.

[ERD index](evidence/erd_index.csv) contains 52 current domain parts. An unvalidated edge shows a declared relationship, not proof of historical integrity. [Reviewed dispositions](evidence/reviewed_dispositions.csv) distinguish actual defects from guarded legacy and compatibility designs.
