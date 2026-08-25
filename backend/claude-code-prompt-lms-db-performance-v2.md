# Claude Code Prompt — LMS Neon Database Performance (v2, evidence-based)

> Supersedes v1, which targeted `curriculum.components`. That table has been measured and cleared.
> Fill in the `<<FILL IN>>` values before pasting into Claude Code.

---

## ROLE

You are a senior PostgreSQL performance engineer working across the KBC LMS Django codebase and its n8n automation layer. Your task is to eliminate a small number of catastrophic sequential-scan query patterns that have been positively identified by measurement. You are **not** doing open-ended optimisation, and you are not re-diagnosing what has already been diagnosed.

## ENVIRONMENT

- **Neon project:** `LMS` — project ID `green-term-97168878`
- **Region:** `aws-eu-west-2` · **Postgres 18** · autoscale 0.25–8 CU, no autosuspend
- **Production branch:** `br-holy-band-abhispwg` (default, primary, **not protected**)
- **Safe working branch:** `br-sparkling-art-ab64k0zx` (`LMS-D-Amgad`)
- **Database:** `neondb` — 228 tables across schemas including `curriculum`, `fetching_evidence`, `structured_manual_activities`, `Audit`, `Last_audit`, `Manual_audit`, `Learner`, `MBA`
- **App:** Django + DRF, Gunicorn, Vite/React frontend, OpenLiteSpeed on Hostinger VPS `srv1915049`
- **Automation:** n8n instance also queries this database directly
- Note the **mixed-case schema names** (`Audit`, `Last_audit`, `Manual_audit`) — they require double-quoting in SQL.

**Fill in:**
- Django repo path: `<<FILL IN>>`
- n8n workflow export path, if available locally: `<<FILL IN>>`
- Which schemas the Django app owns vs. which are n8n-only: `<<FILL IN if known, otherwise determine in Phase 0>>`

---

## GROUND TRUTH — ALREADY MEASURED, DO NOT RE-LITIGATE

Taken from `pg_stat_user_tables` on the production branch:

| Table | seq_scan | seq_tup_read | idx_scan | est_rows | heap |
|---|---:|---:|---:|---:|---|
| `fetching_evidence.evidence_items` | 85,468 | **4,087,060,554** | 833,328 | 48,826 | 107 MB |
| `structured_manual_activities.manual_learner_activities` | 53,940 | **3,355,422,278** | 6,794,790 | 167,484 | 44 MB |
| `structured_manual_activities.manual_activity_hours_revision` | 24,731 | **1,214,028,968** | 640,503 | 77,503 | 28 MB |
| `Last_audit.activity_results` | 7,060 | **999,975,724** | 77,228,974 | 284,805 | 206 MB |
| `Manual_audit.activity_actual_hours` | 1,489 | **372,000,462** | 19,000 | 273,731 | 37 MB |
| `Last_audit.activity_actual_hours` | 2,430 | 233,117,295 | 68,203,690 | 273,731 | 37 MB |
| `Audit.ilr_learning_deliveries` | **386,513** | 411,985,264 | 1,202 | 1,066 | 1272 kB |
| `fetching_evidence.break_periods` | **11,637,307** | 394,350,089 | 49 | 34 | 8192 bytes |

Two distinct failure modes are present:

- **Mode A — unindexed scans of medium tables.** `evidence_items`, `manual_learner_activities`, `manual_activity_hours_revision`, `activity_results`, `activity_actual_hours`. Roughly 10 billion rows read sequentially. Average rows per scan ≈ full table each time, meaning no usable index for the predicate.
- **Mode B — per-row query loops.** `break_periods` (11.6M scans of a 34-row, single-page table) and `ilr_learning_deliveries` (386k scans of 1,066 rows, only 1,202 index scans ever). The scans themselves are cheap; the **call frequency** is the defect. This is a client-side loop, almost certainly an n8n node iterating items or a Django `for` loop issuing a query per iteration.

Supporting facts:

- Branch egress: **516,913,569,073 bytes** against a 2.7 GB logical size — the dataset has effectively crossed the wire ~190×.
- `curriculum.components`: 17,861 rows, 37 MB, **9 indexes**, 91.1% index scans, autovacuumed today. **Measured and cleared. It is not the problem.**
- `curriculum.components.settings_json` averages **774 bytes/row** vs ~48 for `title` — ~90% of row width, shipped on every `SELECT *`.
- `pg_stat_statements` is **not installed**, so exact query text is unknown.

---

## PHASE 0 — IDENTIFY THE QUERIES (no changes to data or schema)

**0.1 — Install statement tracking.** Requires human approval before running. Ask, then:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Let it collect during a normal working period, then:

```sql
SELECT calls, round(mean_exec_time::numeric,2) AS avg_ms,
       round(total_exec_time::numeric) AS total_ms, rows, query
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 30;

SELECT calls, round(mean_exec_time::numeric,3) AS avg_ms, query
FROM pg_stat_statements
ORDER BY calls DESC LIMIT 30;
```

The second query finds Mode B. Expect `break_periods` and `ilr_learning_deliveries` near the top by call count with sub-millisecond averages.

**0.2 — Locate the callers in code.** Grep the Django repo for each of the eight tables above and for their model names. For each hit, record: file, line, whether it sits inside a loop or comprehension, and whether it is Django ORM or `raw()`/`cursor.execute()`.

**0.3 — Establish ownership.** For each of the eight tables, determine whether it is queried by Django, by n8n, or both. State how you determined it. **If a table is n8n-only, do not modify application code for it — produce a written remediation note for the workflow owner instead.**

**0.4 — Capture the predicates.** For each Mode A table, list the exact `WHERE` / `JOIN` columns from the queries found in 0.1 and 0.2. You need these before you can propose a single index.

### ⛔ STOP GATE 1

Write `docs/perf/db-hotspots-baseline.md` containing: the eight tables, the exact offending query text, the calling code location, the owner (Django / n8n), and the predicate columns. Present a proposed fix per table.

**Do not create indexes or change code until this is reviewed and approved.**

---

## PHASE 1 — MODE B: KILL THE QUERY LOOPS (highest value, lowest risk)

Eliminating 11.6M + 386k round trips will recover more wall-clock time than any index.

- **Django:** replace per-iteration queries with a single query plus an in-memory dict keyed on the lookup column. `break_periods` has 34 rows — load it once per request and cache it; do not query it per learner, per activity, or per week.
- **n8n:** replace "Postgres node inside a Loop Over Items" with a single query using `= ANY($1)` over a collected ID array, or a `WHERE id IN (...)` built from the batch. Deliver the corrected SQL and the node restructure as a written spec — do not attempt to edit the live workflow.

Measure: re-check `seq_scan` on both tables before and after over a comparable window.

## PHASE 2 — MODE A: INDEX THE REAL HOTSPOTS

Only after Phase 0.4 gives you actual predicate columns. For each proposed index, state the specific query it serves and the expected plan change.

Rules:
- `CREATE INDEX CONCURRENTLY` always. Never a bare `CREATE INDEX` on these tables.
- Build and verify on `br-sparkling-art-ab64k0zx` first, with `EXPLAIN (ANALYZE, BUFFERS)` before and after.
- Prefer composite indexes matching the full predicate over several single-column indexes.
- Use partial indexes where the query always filters on a status/deleted flag.
- Remember to double-quote mixed-case schemas: `"Last_audit".activity_results`.
- After creating an index, run `ANALYZE` on the table so the planner sees it.

Target the largest `seq_tup_read` first: `evidence_items`, then `manual_learner_activities`, then `manual_activity_hours_revision`.

## PHASE 3 — PAYLOAD REDUCTION

- Add `.defer("settings_json")` or explicit `.only(...)` to `curriculum.components` list/tree serializers. Verify no serializer field reads `settings_json` before deferring.
- Audit the Mode A queries for `SELECT *` where only a few columns are consumed, and for missing `LIMIT` on unbounded reads.
- Re-measure branch egress after a comparable period.

## PHASE 4 — INDEX CLEANUP ON `curriculum.components`

Two indexes are provably redundant. Drop them **concurrently**, in a reversible migration:

```sql
-- strict prefix of curriculum_components_module_week_order_idx; 1 scan lifetime
DROP INDEX CONCURRENTLY IF EXISTS curriculum.idx_authoring_components_module_week_order;

-- plain btree on a boolean, 4 of 17,861 rows true; 2 scans lifetime
DROP INDEX CONCURRENTLY IF EXISTS curriculum.curriculum_components_programme_deleted_idx;
```

Also validate the two `NOT VALID` CHECK constraints so the planner can rely on them:

```sql
ALTER TABLE curriculum.components VALIDATE CONSTRAINT chk_authoring_component_otjh_nonnegative;
ALTER TABLE curriculum.components VALIDATE CONSTRAINT chk_authoring_component_points_nonnegative;
```

Before dropping, confirm the scan counts are still near zero — they may have been created recently.

## PHASE 5 — VERIFY

```sql
SELECT pg_stat_reset();  -- requires approval; resets ALL statistics
```

Then, after a comparable working period, re-run the `pg_stat_user_tables` query from Ground Truth and produce a before/after table for all eight hotspots.

---

## HARD CONSTRAINTS

**MUST**
- Work on branch `br-sparkling-art-ab64k0zx` for all experiments; touch `br-holy-band-abhispwg` only with explicit per-change approval
- Use `CONCURRENTLY` for every index create and drop
- Express Django-owned schema changes as migrations with `atomic = False` and reverse operations
- Ask before any `CREATE EXTENSION`, `pg_stat_reset()`, or write to production
- Report before/after numbers for every change; one change at a time
- Double-quote mixed-case schema identifiers
- Treat n8n-owned tables as read-only from the codebase; deliver written specs instead

**MUST NOT**
- Spend effort on `curriculum.components` beyond Phases 3 and 4. It has been measured: 17,861 rows, 9 indexes, 91% index scans. If you believe otherwise, produce the measurement and stop.
- Propose partitioning, sharding, table splitting, or migrating off PostgreSQL. None of these tables exceeds 371 MB.
- Change the `VARCHAR(128)` primary keys anywhere in this task
- Run `VACUUM FULL`, `REINDEX` without `CONCURRENTLY`, or any table-rewriting operation on the production branch during working hours
- Add Redis or view-level caching as a substitute for fixing a query
- Create an index without naming the specific query it serves
- Modify frontend code

---

## DELIVERABLES

1. `docs/perf/db-hotspots-baseline.md` — Phase 0 findings: query text, callers, owners, predicates
2. `docs/perf/db-hotspots-remediation.md` — every change, with before/after `seq_scan` / `seq_tup_read` / `total_exec_time`
3. Django migrations for index changes, with reverse SQL
4. `docs/perf/n8n-workflow-fixes.md` — written specs for any n8n-owned remediation, including corrected SQL
5. A VPS verification checklist for `srv1915049` post-deploy

## SUCCESS CRITERIA

- `break_periods` and `ilr_learning_deliveries` seq_scan counts drop by orders of magnitude
- Combined `seq_tup_read` across the five Mode A tables falls by >90%
- Every index added is traceable to a named query in `pg_stat_statements`
- Branch egress per working day measurably reduced
- No change made to `curriculum.components` beyond deferring `settings_json` and dropping the two dead indexes

**Begin with Phase 0.1 and ask for approval before installing the extension.**
