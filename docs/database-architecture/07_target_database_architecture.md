# Proposed target database architecture

Scope: proposal only, grounded in the verified branch audit. No implementation approved or performed. [Findings register](evidence/findings.csv).

## Design decision

Retain existing domain schemas, entity identities and stable table/API names. Strengthen integrity, ownership and migration control incrementally. Evidence supports targeted repairs; it does not justify replacing 595 tables or merging every learner/source identifier into one identity namespace.

This is a reviewable architecture proposal, **not production-readiness certification**. External-consumer verification, representative workload, deferred scans, remediation rules and implementation tests remain gates.

## Proposed ownership

These are responsibilities to assign, not claims about current team ownership.

| Domain / existing schemas | Authoritative responsibility | Preserve |
| --- | --- | --- |
| `enrolment`, `Learner`, `login` | Enrolment, permanent learner and authentication identity | Distinct IDs, normalized emails, staff multi-ID behavior |
| `curriculum` | Programme/module/week/component definitions and source catalog | Versioning, scope and learner-plan propagation |
| `Learner`, `Coach`, `Feedback`, `Engagement` | Progress, review lifecycle and engagement facts | Signed snapshots, meeting identities, compatibility views |
| Audit/manual/reporting schemas | Accepted audit facts and evidence provenance; derived reports | Independent aliases, imports, verified hours and history |
| `fetching_evidence`, `kbc_sync`, source tables | External IDs, imports and reconciliation | Raw evidence, source namespaces and remote boundaries |
| `public`, `chat`, `knowledge`, `neon_auth`, specialized domains | Platform, projections, communications/content | Existing providers and access contracts |
| Backup, KSB migration/remap and remediation schemas | Recovery/migration lineage | Retention, restoration and external-consumer decisions |

The [table architecture matrix](evidence/table_architecture_review.csv) covers **every table**, including specialized domains, with current shape and proposed handling. A PostgreSQL owner role is not a business owner.

## Required corrections

1. **DB01:** repair four template programme references using approved mappings, then validate the existing FK.
2. **DB02:** resolve 5,830 invalid KSB-token rows with provenance-backed rules preserving history, then validate the existing CHECK.
3. **DB03:** investigate the invalid index and approve a valid replacement only after workload comparison; retain existing valid access paths.
4. **DB06:** validate the remaining 20 currently clean constraints in separate bounded tasks with fresh prechecks.
5. **DB11:** reconcile the state-only Django migration ledger through the established workflow.

## Recommended improvements

- Register one authoritative writer/migration owner per table, including unmanaged ORM, raw SQL, runtime form builders and external writers.
- Keep source identity, permanent identity and authentication identity explicit. Preserve existing UUID and normalized-email protection.
- Treat signed reviews, attendance evidence, revisions and restore points as historical facts. Corrections need traceable provenance, not silent recalculation.
- Benchmark existing read-model/outbox infrastructure for expensive summaries before introducing new projection tables or frameworks.
- Review 110 FK access candidates and 67 overlapping index groups with actual workload, constraints and external consumers.
- Let field contracts determine defaults/NOT NULL, not current NULL percentages.

## Current versus proposed structures

| Object | Current | Proposed after approval |
| --- | --- | --- |
| `week_templates.programme_id` | Existing NOT VALID FK, four orphans | Same column/type/target; approved repair and valid FK |
| `learner_progress_ksbs.ksb_code` | Existing NOT VALID CHECK, 5,830 failures | Same history/entity; approved remediation and valid CHECK |
| Twenty clean NOT VALID constraints | Current aggregate checks pass | Same definitions, individually validated |
| Revision-feed index | Invalid covering index plus valid alternatives | Workload-justified valid path; exact choice deferred |
| Coach calendar view | Compatibility layer over Learner table | Preserve view and base uniqueness |
| Fifty no-PK tables | Mixed source/archive/operational purposes | Keys only where an owner proves the requirement |
| Remaining tables | Inventory-defined fields/types/defaults | Preserve contracts; only targeted approved changes |

Physical renaming, new schemas, JSON extraction, table merges, partitioning and archive deletion are optional and deferred. They need measurable benefit, owner decisions and compatibility plans. No source table is obsolete merely because it lacks local references.

## Current and proposed ERDs

[ERD index](evidence/erd_index.csv) links **52 current and 52 proposed Mermaid parts**, covering 595 local table entities and 287 catalog FK edges. Proposed diagrams intentionally retain current physical topology: the first changes repair and validate existing contracts instead of inventing new entities/relationships. Proposed comments state this; `UNVALIDATED` labels retain baseline evidence until approved tasks resolve them.

Identifiers use `schema__table`. Attributes show key columns only; full fields are in [columns](evidence/columns.csv). No-key tables have no fabricated attributes. Cross-schema parents repeat as context; use owned-table counts, not total node appearances. Views/functions appear in dependency evidence rather than masquerading as physical-table FK edges.

## Adoption gates

Approve remediation rules; identify external writers; complete relevant deferred checks; demonstrate model/API correctness and representative performance; review and implement one task at a time on the verified branch. Any later production release requires separate authorization and the repository's reviewed-main deployment controls. This proposal authorizes no production connection, merge or deployment.
