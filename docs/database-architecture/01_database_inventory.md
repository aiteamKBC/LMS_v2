# Database inventory and baseline

Scope: read-only audit of `neondb`, project `green-term-97168878`, branch `lms-ideal-architecture` / `br-raspy-sky-abvs8lq9`. Repository: `attendance_bugs` at `7804cda285f8014e47c9ddd73c7bcbb34602bbaa`. No production connection, database writes, application changes or environment changes occurred.

## Target verification and completeness

Neon control-plane metadata independently mapped the supplied URL endpoint to the approved branch. PostgreSQL returned the same `neon.branch_id`, database `neondb`, version **18.6**, and `transaction_read_only=on`. Only `LMS_REFACTOR_DATABASE_URL` was used. [Provenance](evidence/audit_provenance.json).

Neon records `init_source=parent-data`, creation `2026-10-18T20:35:47Z`, parent `br-holy-band-abhispwg`, and fork LSN `1F/187E58E0`. The observed **595 local tables in 25 table-bearing schemas** match the preliminary baseline. There are **30 non-system schemas overall**. This supports a parent-data clone, but does not certify byte-for-byte parity with production or completeness across other application database aliases: production and external databases were not connected.

## Inventory

| Object | Count |
| --- | ---: |
| Non-system schemas / schemas with local tables | 30 / 25 |
| Ordinary local tables | 595 |
| Foreign tables, metadata only | 2 |
| Views / materialized views | 36 / 0 |
| Partitioned tables / inheritance edges | 0 / 0 |
| Sequences | 261 |
| Local table columns | 8,352 |
| Columns including views/foreign tables | 9,012 |
| Primary / foreign / unique constraints | 545 / 287 / 189 |
| CHECK / NOT NULL constraints | 531 / 4,591 |
| Indexes | 1,609 |
| Triggers, including internal FK triggers | 1,165 |
| Function/procedure/aggregate catalog entries | 248 |

PostgreSQL 18 NOT NULL catalog entries are counted separately from other constraints. The total is 6,143 constraints.

All schemas: `Audit`, `Coach`, `Engagement`, `Feedback`, `LMS`, `Last_audit`, `Learner`, `MBA`, `Manual_audit`, `auth`, `backup_20260911`, `chat`, `curriculum`, `enrolment`, `fetching_evidence`, `kbc_career_identity`, `kbc_coaching_reporting`, `kbc_quality_reporting`, `kbc_sync`, `khaled_learning_hub`, `knowledge`, `ksb_mig`, `ksb_migration_archive`, `ksb_remap`, `login`, `neon_auth`, `programme_audit`, `public`, `structured_manual_activities`, `week_ghost_remediation`.

## Complete machine-readable evidence

- [Per-table inventory CSV](evidence/database_inventory.csv): all 595 local tables, estimates, safe exact counts, sizes, owner, keys and review status.
- [Schemas/ACLs](evidence/schemas.csv), [all relations](evidence/relations.csv), [every column/type/default](evidence/columns.csv), [constraints](evidence/constraints.csv), [indexes and definitions](evidence/indexes.csv).
- [Triggers](evidence/triggers.csv), [views](evidence/views.csv), [functions](evidence/functions.csv), [sequences](evidence/sequences.csv), [dependencies](evidence/dependencies.csv), [inheritance](evidence/inheritance.json).
- [Grants](evidence/privileges.csv), [default privileges](evidence/default_privileges.csv), [row-security policies](evidence/policies.json), plus schema/relation ACLs. No RLS policies were found; that alone does not establish an authorization defect.
- [Table statistics](evidence/table_statistics.csv), [index statistics](evidence/index_statistics.csv), [column statistics without value samples](evidence/column_statistics.csv).
- [Foreign-table boundaries](evidence/foreign_table_boundaries.csv): two `kbc_sync` postgres_fdw tables. No foreign-server options, user mappings or remote rows were read.

Function/view literals were redacted and definition fingerprints retained. These exports are architecture evidence, **not executable backup/restore dumps**. No learner row values, passwords, session tokens or application query text were exported.

## Method and limits

Standalone psycopg connections avoided Django startup/setup helpers. Every transaction was read-only before SQL, with bounded statement timeouts and a 1-second lock timeout. Unsupported startup options initially failed; supported transaction-local settings succeeded. A combined size query timed out; schema-sized batches subsequently collected all local table sizes. Five FK checks timed out in one batch and succeeded individually.

Exact row and NULL counts cover 541 tables of at most 32 MiB table storage. The other 54 tables retain estimates and explicit deferred status. All 595 tables have structural metadata and storage coverage. Views and foreign tables were excluded from data scans to avoid external reads or executing user-defined behavior.

Queries used separate bounded transactions, not one long global snapshot. [Final verification](evidence/final_database_verification.json) reconfirmed branch identity, read-only mode, 595 tables and 6,143 constraints. Row-level concurrent changes are not excluded. [Catalog SELECTs](evidence/catalog_queries.sql) document metadata collection; report 04 documents profiling rules. Timestamps are UTC; review timezone is Asia/Beirut.
