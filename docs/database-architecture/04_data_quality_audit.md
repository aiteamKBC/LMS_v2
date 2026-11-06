# Structure, normalization and data quality

Scope: verified refactor branch only; aggregate data reads and documentation. [Provenance](evidence/audit_provenance.json).

## Coverage and method

Structural metadata covers **595 local tables / 8,352 columns**. Exact profiling covers **541 tables / 7,091 columns**. For local tables at most 32 MiB, one aggregate calculated `count(*)` and `count(column)`; subtraction gives NULL counts. Batches contained at most six tables, with a six-second statement timeout. No row values were exported. Larger tables retain `pg_stats` estimates without most-common values or histogram contents. Missing statistics mean unknown, not empty.

| Observation | Count | Meaning |
| --- | ---: | --- |
| Exactly counted empty tables | 92 | Current emptiness, not non-use |
| All-NULL columns in nonempty profiled tables | 212 | Not a removal recommendation |
| Other columns at least 95% NULL | 166 | Optional/subtype semantics need review |
| Large tables without full profiles | 54 | Explicitly deferred |
| Confirmed FK orphan rows | 4 | Week-template programme relationship |
| Existing CHECK violation rows | 5,830 | Progress KSB token rule |

[All profiles](evidence/data_profiles.csv), [sparse columns](evidence/sparse_columns.csv), [every-table architecture review](evidence/table_architecture_review.csv).

## DB02 — malformed KSB tokens, P0

The exact existing `learner_progress_ksbs_no_json_tokens` predicate returned **5,830 false rows**. The rule excludes punctuation/empty-container tokens using built-in comparisons, `btrim` and `chr`. The audit evaluated an existing rule, not a new scoring/completion policy. All ten other unvalidated CHECKs returned zero violations. [Results](evidence/check_validation_results.csv).

Preserve progress history. Trace parsing and canonical source provenance, including the existing `backend/sql/2026-10-14_ksb_standards_migration/` and `backend/sql/2026-10-15_ksb_description_remap/` flows. These scripts contain writes and were not run.

Approved remediation must retain before-images/source evidence, map only where the canonical standard gives an unambiguous answer, and preserve unresolved rows explicitly. Do not strip punctuation, delete rows or recalculate history merely to make the CHECK pass. Counts describe rows, not unique learners.

## Identity duplicates and legacy sources

Exact aggregate probes found no duplicate normalized email groups in `Learner.learners` or `enrolment.Created_users`. `enrolment.Staff_users` has **five duplicate groups / six excess rows**, with intentional multi-ID handling documented in chat. Do not merge accounts or change ownership. [Probes](evidence/logical_duplicate_probes.json).

The 846 unmatched IDs in legacy `Learner.learner_ksbs` are an unresolved source-mapping candidate, not another confirmed orphan finding. Its shape differs from the guarded rollback ORM model; see report 02.

## Whole-database normalization review

[Table architecture review](evidence/table_architecture_review.csv) records every table's keys, JSON/array fields, nullability, sizes, inferred purpose and proposed handling. Purpose classifications are explicit name/metadata hypotheses requiring owner confirmation. [Same-shape candidates](evidence/same_shape_table_candidates.csv) share ordered column/type/nullability signatures; that does not prove duplicate entities or data.

- **1NF:** inspect repeated business values or entities encoded in JSON/arrays where independent identity, joins or constraints are required. Source payloads, signed snapshots and variable review forms can validly remain JSON.
- **2NF:** review partial dependencies for composite business keys, especially source/KSB mappings. A composite key alone does not justify a split.
- **3NF:** distinguish authoritative current attributes from copied historical facts. An event's learner name, accepted evidence or signed review may intentionally differ from today's profile.

Formal normal-form certification needs business functional dependencies unavailable from metadata alone. No table is falsely certified as normalized, and no blanket rewrite is proposed.

## Storage, names and retention

`curriculum.record_revisions` is the largest relation including indexes, approximately 2.81 GiB. Source raw pages, activity revisions/results, restore points and progress are also substantial. Size does not prove bloat or justify partitioning. No partitioned tables were present. Measure retention, pruning and maintenance requirements first.

Keep exact quoted mixed-case names as compatibility contracts. Archive/backup/migration-working tables need named owners and retention/restoration decisions before removal. NULL columns, empty tables and missing repository references do not authorize deletion, renaming or new defaults. Historical evidence, signatures, verified attendance and progress remain protected.
