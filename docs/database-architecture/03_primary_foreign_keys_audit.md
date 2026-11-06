# Primary keys, foreign keys and uniqueness

Scope: read-only verified branch audit. [Provenance](evidence/audit_provenance.json).

## Primary keys

**545 of 595 local tables have a PK; 50 do not.** The absence is catalog-confirmed. Whether a backup, source snapshot or migration working table requires a new key remains a business/operational decision. [Complete missing-PK report](evidence/missing_primary_keys.csv).

Do not synthesize IDs across historical snapshots merely for uniformity. For each table requiring mutation or references, establish a stable key, then run full NULL/duplicate checks. Existing unique constraints may already identify rows but have different NULL semantics. Retention and external-consumer review come before any archive changes.

## Foreign keys and indexes

There are **287 FKs**. **110** lack a valid unconditional B-tree whose leading equality key columns cover the FK under the audit's conservative rule. Included columns are not key columns; partial, invalid and not-ready indexes do not satisfy that rule. This is not 110 proven slow queries. Partial/expression alternatives, compatible access methods and skip-scan plans require individual review. [Candidates](evidence/fk_index_candidates.csv).

PostgreSQL does not automatically create the child-side FK index. Evaluate actual joins and parent-change workload against write/storage overhead before adding one. [PostgreSQL constraints documentation](https://www.postgresql.org/docs/18/ddl-constraints.html).

## Unvalidated and invalid objects

| Category | Count | Result |
| --- | ---: | --- |
| Unvalidated FK | 11 | All checked; one has 4 orphan rows |
| Unvalidated CHECK | 11 | All checked; one has 5,830 violating rows |
| Invalid index | 1 | `curriculum.record_revisions_feed_window_idx` |
| Confirmed missing required FK | 0 | One unresolved legacy candidate; no global guarantee |

Ten other FKs and ten other CHECKs were clean at observation time. They remain unvalidated in the catalog. Fresh checks and approved DDL are required to validate them. [Constraint list](evidence/unvalidated_constraints.csv), [CHECK results](evidence/check_validation_results.csv).

The invalid index is `indisready=true`, `indisvalid=false`, and occupies 165,969,920 bytes (about 158.3 MiB). Its failure cause was not established. Existing valid access paths must remain while investigating a replacement. Invalidity alone does not prove user-facing slowness.

## Resolved uniqueness candidates

- `Coach.coach_calendar_event` is a view over `Learner.coach_calendar_event`. Valid unique indexes on the base table enforce `event_key` and `operation_id`. Missing indexes on a view are not missing uniqueness.
- `Learner.learners.email` has a stored generated `email_normalized` column with a valid unique index. A simple raw-column comparison misses that design.
- Staff normalized emails contain five duplicate groups, but `backend/chat/models.py:48` explicitly supports multiple staff IDs per email. This is not permission to merge identities or add UNIQUE.

The raw [ORM unique candidates](evidence/orm_missing_unique_candidates.csv) remain traceable; [reviewed dispositions](evidence/reviewed_dispositions.csv) override their provisional interpretation.

## Gate for a new key

1. Confirm entity/identifier meaning with code and external owners.
2. Prove full-data uniqueness/non-NULL or zero orphans, including deferred large tables.
3. Review locks, migration ownership, ORM deletion behavior and API null/empty contracts.
4. Approve one migration with before-state, pre/post checks and honest rollback limits.

No index or key was added, removed or modified during this audit.
