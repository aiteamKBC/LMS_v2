# Prioritized refactoring roadmap

Scope: proposals only for the verified `lms-ideal-architecture` branch. No migration or application modification was performed. [Findings register](evidence/findings.csv), [machine-readable sequence](evidence/migration_sequence.csv).

## Sequence and approval

P0 repairs DB01/DB02 come first, after owner-approved data rules. Clean-constraint validation DB06 can proceed independently after separate approval while mappings are resolved. P1 performance proposals need representative workload evidence before DDL. P2 key/index/ownership changes remain per-object; P3 naming work is documentation-first.

**Recommended first implementation: DB01, the four orphan week-template references**, once the curriculum owner approves the original programme mapping and downstream impact for each record. It is small and directly evidenced, but not executable until that decision exists. A separately approved single clean FK validation from DB06 is an alternative first data-preserving migration.

SQL below is documentation, not an executed migration. No code change, DDL/DML, merge or production promotion is authorized by these sketches. Every task requires its own reviewed migration, prechecks, postchecks and affected feature tests.

## 1. DB01 — P0: Repair four orphan template references

**Problem/evidence:** Existing NOT VALID FK; four unmatched non-null rows

**Affected objects:** curriculum.week_templates; curriculum.programmes

**Models, services and endpoints:** curriculum_api.models.WeekTemplate; views.curriculum_week_template_collection/detail; curriculum_api/urls.py:176-177

**Proposed correction / root-cause investigation:** Recover original programme from provenance; owner approves each mapping. Preserve before-images; update only approved stable keys. No guessed mapping.

**Data migration and compatibility:** Validation only after approved data repair and zero-orphan check; no UPDATE design until mappings are known.

**Risk:** High if mapped incorrectly: curriculum scope and downstream plans.

**Tests:** Count preservation; all four mappings correct; other programmes unchanged; invalid future references rejected; template and propagation workflows.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Restore approved before-images with version guards; stop if later edits conflict. Validation reversal requires reviewed drop/re-add, not a simple toggle.

Proposed SQL/migration boundary (not executed):

```sql
ALTER TABLE curriculum.week_templates VALIDATE CONSTRAINT week_templates_programme_id_fkey;
```

## 2. DB02 — P0: Repair malformed progress KSB tokens

**Problem/evidence:** 5830 rows fail existing no_json_tokens CHECK

**Affected objects:** Learner.learner_progress_ksbs and canonical KSB source

**Models, services and endpoints:** learner_api.models; curriculum KSB mapping/remap SQL; consuming progress APIs

**Proposed correction / root-cause investigation:** Approve source-backed rules and unresolved-case handling; preserve original values, progress links and provenance. Investigate importer recurrence in separately scoped code work.

**Data migration and compatibility:** No generic DELETE or punctuation stripping. Validation blocked until approved remediation proves zero failures.

**Risk:** High: historical attribution, evidence and progress.

**Tests:** Known valid codes unchanged; malformed-token regression; other learners unchanged; no completion/hours/signature rewrite.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Guarded restoration of before-images; preserve new provenance; reconcile later derived events rather than blindly reversing.

Proposed SQL/migration boundary (not executed):

```sql
ALTER TABLE "Learner".learner_progress_ksbs VALIDATE CONSTRAINT learner_progress_ksbs_no_json_tokens;
```

## 3. DB06 — P1: Validate one currently clean constraint

**Problem/evidence:** Ten other FKs and ten CHECKs have zero observed violations

**Affected objects:** One of 20 clean NOT VALID constraints

**Models, services and endpoints:** Per-object dependency matrix; e.g. curriculum cohort/group flows

**Proposed correction / root-cause investigation:** Fresh identity/definition/data checks, bounded locks, one constraint per migration.

**Data migration and compatibility:** Example clean FK only; no row changes. Fresh checks required immediately before execution.

**Risk:** Low/medium: validation workload and locks.

**Tests:** Same definition, convalidated=true, zero violations; affected create/update/delete paths preserve scope.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Prefer retaining stronger valid state on application rollback; restoring NOT VALID needs separately reviewed drop/re-add and locks.

Proposed SQL/migration boundary (not executed):

```sql
ALTER TABLE curriculum.cohorts VALIDATE CONSTRAINT cohorts_programme_id_fkey;
```

## 4. DB03 — P1: Investigate invalid revision-feed index

**Problem/evidence:** Invalid, ready index; Q03 uses a valid alternative

**Affected objects:** curriculum.record_revisions_feed_window_idx

**Models, services and endpoints:** curriculum_api/quality.py; system_audit/derived.py

**Proposed correction / root-cause investigation:** Determine failure cause and benchmark representative filters before choosing replacement. Retain valid existing indexes.

**Data migration and compatibility:** No DDL ready for execution. Concurrent build requires a reviewed non-atomic migration and failed-build recovery.

**Risk:** Medium: space, writes, duration and recovery.

**Tests:** Valid/ready flags; identical feed scopes/results; cold/warm plans, p95 and write overhead.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Remove only approved new replacement if rejected; preserve old valid indexes. Any old-index removal requires explicit approval.

Proposed SQL/migration boundary (not executed):

```sql
-- Exact definition is in indexes.csv; concurrent replacement design is deferred until workload review.
```

## 5. DB04 — P1: Benchmark version summary access

**Problem/evidence:** Q01 groups full history before LIMIT

**Affected objects:** curriculum.record_revisions; existing platform_read_models/outbox if selected

**Models, services and endpoints:** quality.py:1057/1091; curriculum/quality/versions endpoint

**Proposed correction / root-cause investigation:** Benchmark query alternatives and existing projection infrastructure. Agree freshness and full-search semantics before API changes.

**Data migration and compatibility:** Optional projection/backfill needs approved isolated workload, source-of-truth and rebuild rules.

**Risk:** Medium: staleness, missed updates and changed search semantics.

**Tests:** First/last revision, counts, scoped filters and search equivalence; p50/p95 and query counts; concurrency/rebuild.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Return to original read path using a reviewed switch; retain canonical history and projection evidence.

Proposed SQL/migration boundary (not executed):

```sql
-- No schema migration before benchmark chooses a concrete design.
```

## 6. DB05 — P1: Reduce repeated exact count work if measured

**Problem/evidence:** Q02 exact global counts per request

**Affected objects:** curriculum.record_revisions; curriculum.record_versions

**Models, services and endpoints:** quality.py:1139; versions endpoint

**Proposed correction / root-cause investigation:** Measure request rate and product freshness needs; consider cached exact totals or on-demand count only after contract decision.

**Data migration and compatibility:** Never silently replace exact totals with estimates.

**Risk:** Medium: response freshness semantics.

**Tests:** Counts correct after writes/retries; invalidation; p95 and payload comparison.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Restore original count path; no canonical data rollback required.

Proposed SQL/migration boundary (not executed):

```sql
-- No DDL justified by current measurement evidence.
```

## 7. DB11 — P2: Reconcile state-only migration ledger

**Problem/evidence:** One missing ledger entry; physical nullable timestamptz already exists

**Affected objects:** public.django_migrations; Learner.learner_progress_entries.deleted_at

**Models, services and endpoints:** learner_api/migrations/0020_progress_soft_archive_state.py

**Proposed correction / root-cause investigation:** Review intended deployed revision, router and runner; apply the existing state migration through the approved isolated workflow.

**Data migration and compatibility:** No fake history or blanket migrate across unverified aliases.

**Risk:** Low/medium: migration state and runner side effects.

**Tests:** Exact intended plan; ledger present; state matches existing column; archive/read compatibility.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Reviewed migration reverse/state plan; preserve existing deleted_at column and all data.

Proposed SQL/migration boundary (not executed):

```sql
-- Existing migration has database_operations=[]; no ALTER TABLE needed.
```

## 8. DB07 — P2: Establish a key for one justified table

**Problem/evidence:** 50 confirmed absences; many archive/operational tables

**Affected objects:** One owner-approved missing-PK table

**Models, services and endpoints:** Its exact consumers in dependency_matrix.csv

**Proposed correction / root-cause investigation:** Establish mutation/reference requirement, stable business key, and full NULL/duplicate checks.

**Data migration and compatibility:** Data remediation, if needed, needs approval; no history rewrite to force uniqueness.

**Risk:** Variable by owner and use.

**Tests:** Stable identity; preserved rows; intended uniqueness; external import and ORM behavior.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Remove only approved new constraint if needed, preserving data and existing uniqueness.

Proposed SQL/migration boundary (not executed):

```sql
-- Key columns undecided; no guessed ADD PRIMARY KEY.
```

## 9. DB08 — P2: Benchmark one FK access path

**Problem/evidence:** 110 conservative missing-leading-index candidates

**Affected objects:** One fk_index_candidates.csv entry

**Models, services and endpoints:** Exact join/parent-change consumers

**Proposed correction / root-cause investigation:** Review existing partial/expression/skip-scan paths and measured workload before an additive index.

**Data migration and compatibility:** No row migration; account for build and ongoing write overhead.

**Risk:** Low/medium: resource use and uncertain benefit.

**Tests:** Representative joins and isolated parent-change tests; planner alternatives; insertion/update cost.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Remove only approved newly-added index after dependency review; existing indexes untouched.

Proposed SQL/migration boundary (not executed):

```sql
-- Index columns/design deferred until workload validation.
```

## 10. DB09 — P2: Review one overlapping index group

**Problem/evidence:** 67 matching signatures; unique/PK roles can differ

**Affected objects:** One duplicate_index_candidates.csv group

**Models, services and endpoints:** DDL owners, ON CONFLICT callers and external writers

**Proposed correction / root-cause investigation:** Verify dependency, NULL uniqueness, real observation window and plans. Removal requires explicit per-object approval.

**Data migration and compatibility:** No row migration; restoration has runtime/storage cost.

**Risk:** Medium: uniqueness or access-path loss if misclassified.

**Tests:** Constraint preservation, workload equivalence and external-owner acceptance.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Rebuild captured definition; establish restoration duration before any drop.

Proposed SQL/migration boundary (not executed):

```sql
-- No DROP INDEX proposal without documented impact approval.
```

## 11. DB10/DB12 — P2: Resolve one ORM/ownership discrepancy

**Problem/evidence:** Unmanaged models, views, aliases and runtime DDL coexist

**Affected objects:** One reviewed model/catalog candidate

**Models, services and endpoints:** Specific router/model/SQL/setup/import consumers

**Proposed correction / root-cause investigation:** Confirm physical target and intended contract; assign one migration owner; preserve intentional differences.

**Data migration and compatibility:** Additive expand/contract only after concrete approved findings.

**Risk:** Variable: shared-role and integration contracts.

**Tests:** Exact payload/null behavior, roles, ownership, history and mocked external effects.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Revert approved reader/writer changes while retaining old structures and history.

Proposed SQL/migration boundary (not executed):

```sql
-- No CREATE TABLE based only on an absent model mapping.
```

## 12. DB13 — P3: Document sparse-field and naming contracts

**Problem/evidence:** 212 all-null and 166 other sparse columns in bounded profiling

**Affected objects:** Selected fields in sparse_columns.csv

**Models, services and endpoints:** Relevant forms, serializers and integrations

**Proposed correction / root-cause investigation:** Document purpose/default/null/omitted behavior. Physical naming changes remain optional.

**Data migration and compatibility:** NULL observations do not authorize data or schema removal.

**Risk:** Low for documents, potentially high for renames.

**Tests:** Contract review and API round trips; no unintended field clearing.

**Performance verification:** Record same branch-only baseline/post-check plans, row counts and relevant timing; no percentage benefit promised.

**Rollback:** Revert approved documentation/compatibility changes; keep original fields.

Proposed SQL/migration boundary (not executed):

```sql
-- Documentation first; no DROP, RENAME or default change approved.
```
