# Query performance and index audit

Scope: verified refactor branch only. Plain EXPLAIN and read-only statistics; no EXPLAIN ANALYZE, index changes, maintenance commands or workload replay. [Provenance](evidence/audit_provenance.json).

## What is established

**Zero application-runtime bottlenecks were measured. Three high-priority investigation items are evidenced:** one invalid index (DB03), full-history grouping (DB04), and repeated exact global counts (DB05). Planner costs are estimates in planner units, not milliseconds.

`pg_stat_statements` exists, with reset timestamp `2026-10-18T20:55:36.870161Z`. Fresh branch statistics include this audit's catalog/integrity queries. Production workload was not accessed. These cumulative counts do not establish real application frequency or unused indexes. [Statistics](evidence/statement_statistics.csv), [reset record](evidence/statement_statistics_info.json), [query classification without text](evidence/statement_classification.csv).

This limitation follows the [PostgreSQL statistics documentation](https://www.postgresql.org/docs/18/monitoring-stats.html). No production latency, frequency or percentage improvement is invented.

## Significant query matrix

| ID | Source | Plan / concern | Representative calls, mean and total time |
| --- | --- | --- | --- |
| Q01 / DB04 | `quality.py:1091` | Full-history GROUP BY before LIMIT; parallel sequential scan; total cost 422640.32 | Unavailable |
| Q02 / DB05 | `quality.py:1139` | Global exact counts via index-only scan aggregates; total cost 84314.15 | Unavailable |
| Q03 / DB03 | `quality.py:454`, `system_audit/derived.py` | Bounded feed projection uses valid `record_revisions_created_idx`; LIMIT cost 89.09 | Not executed |

[Optimization matrix](evidence/query_optimization_matrix.csv), [exact SQL and JSON plans](evidence/query_plans.json). Q01/Q02 reproduce the default source query shapes. Q03 uses a fixed synthetic cutoff and narrow feed projection; it is **not the complete hybrid endpoint**. All plans used EXPLAIN without ANALYZE.

### DB03: invalid index

`curriculum.record_revisions_feed_window_idx` is invalid and ready, occupying 165,969,920 bytes. It keys descending `created_at`, includes feed fields, and has a changed-fields predicate. Q03 still uses the valid `record_revisions_created_idx`. Invalidity is confirmed; a major user-facing latency regression is not proved.

Investigate the failed-build cause and intended predicate, compare valid alternatives across realistic filters, then approve a replacement only if justified. Retain existing valid indexes. Costs include temporary disk use, write amplification and recovery time. No removal is authorized by this finding.

### DB04: aggregate before limiting

`curriculum_quality_versions()` groups all revisions by entity and sorts by last change before LIMIT 200. The plan estimates broad scan/aggregate work. A maintained per-entity summary may help, but must preserve first/last change, revision counts, named versions, scope and history. Existing `platform_read_models` / outbox infrastructure is a candidate, not a mandate for another framework.

The source also applies `search` in Python after limiting summaries. Whether search should cover all historical entities is a product decision; record it separately and do not silently change the contract during tuning. Test result and pagination equivalence.

### DB05: repeated exact global totals

The endpoint counts all rows in `record_revisions` and `record_versions` on each request. Q02 uses indexes but still traverses entries. Measure frequency and freshness requirements before introducing cached exact totals or on-demand counts. Do not silently substitute estimates. Staleness and extra write maintenance are trade-offs.

## Wider triage

- [110 FK index candidates](evidence/fk_index_candidates.csv): conservative structural rule, not proven bottlenecks.
- [67 overlapping groups](evidence/duplicate_index_candidates.csv): uniqueness, PK ownership and NULL semantics may differ.
- [Per-candidate index recommendations](evidence/index_recommendations.csv): validation and rollback considerations.
- [Code-pattern index](evidence/code_patterns.csv): raw SQL, `fetchall`, materialization, eager loading, JSON aggregation, bulk writes and transaction locations. Pattern matches alone do not establish N+1 or unbounded endpoint defects.

For example, `LearnerProfile.activity_feed_entries()` materializes progress if not prefetched (`backend/learner_api/models.py:867`); other paths use eager loading. Trace endpoint/caseload and measure queries before changing pagination. There is no blanket N+1 finding.

## Required performance validation

Use branch-only representative scenarios with synthetic identities and mocked Graph/mail/storage. Record query counts, p50/p95, payload sizes, rows and cold/warm observations. Bounded EXPLAIN ANALYZE may be considered only after verifying execution safety. Include workers/imports, not just UI reads.

A locks/waits snapshot did not establish ongoing contention and cannot exclude intermittent locks. Do not drop indexes based on zero branch scans, install extensions, refresh statistics, run VACUUM FULL or alter compute settings as an audit shortcut.
