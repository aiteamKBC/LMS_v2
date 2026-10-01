# LMS performance and shared read-model operations

This document is the safe rollout order for the performance diagnostics,
transactional outbox, and shared read models. None of the feature flags below
should be enabled on Production until the migration and parity checks have
passed on a fresh Neon child branch.

## What is implemented

- Browser navigation diagnostics for server-allowlisted accounts only.
- One 14-day `platform_performance_samples` table. It stores route templates and
  timing/count data, never account IDs, request payloads, query strings, or concrete
  record IDs.
- One generic `platform_read_models` table. Each
  `(model_key, scope_type, scope_id)` is overwritten with `UPSERT`; it is not a
  history of snapshots.
- One transactional `platform_read_model_outbox` table with leases, retries,
  cross-batch scope coalescing, dead-letter status, and seven-day cleanup of
  processed rows. A change that arrives while a scope is rebuilding remains
  pending for the next pass.
- A durable worker command. Redis is used only by the fail-open response/read-model
  caches; Postgres remains the source used when Redis is unavailable.
- Coach Dashboard registration as `coach.dashboard`, with the existing API shape
  and legacy snapshot table retained as the rollback path.
- Learner Home registration as `learner.home`, scoped by learner kind and enrolment
  ID (for example `commercial:499`). Reads keep the existing API payload, serve the
  latest Postgres projection when Redis is unavailable, and enqueue a refresh on a
  stale or missing projection.
- Curriculum Home registration as `curriculum.home`, with one `operational` and
  one `all` scope in the same generic table. Each row contains the exact compact
  Overview and enriched Programmes responses built from one source snapshot.
  Curriculum writes enqueue one coalesced refresh pair per request; stale or
  missing reads retain the legacy live-query fallback behind a feature flag.

Read models for Admin/Enrolment, Tutor, Employer, and Record Monitor
are deliberately not pre-created. Diagnostics and N+1/index work decide which
aggregate pages still need one.

Every new domain integration must call `enqueue_read_model_event` inside the same
`transaction.atomic(using=...)` block as its authoritative write. Coach's existing
autocommit paths additionally enqueue after a successful request and use bounded
reconciliation; migrate those write services into explicit transactions before
removing the legacy snapshot fallback.

## Required before branch validation

Only the Neon Project ID is needed to create a fresh child branch. Do not send a
password or connection string. Create the branch from current Production and use
its direct (unpooled) connection for Django migrations and `EXPLAIN ANALYZE`.

Apply the additive schema on the child branch:

```bash
python manage.py migrate read_models
python manage.py check
```

Do not run speculative index migrations. Capture `EXPLAIN (ANALYZE, BUFFERS)`
before and after each candidate index on the child branch, including representative
large-account data and write-cost checks.

## Diagnostic rollout

Set these values only in the relevant deployment environment:

```text
PERFORMANCE_DIAGNOSTICS=true
PERFORMANCE_DIAGNOSTIC_ACCOUNT_IDS=<comma-separated login account ids>
PERFORMANCE_SAMPLE_RETENTION_DAYS=14
```

The browser cannot opt itself in. The server exposes SQL timing headers and accepts
samples only for those account IDs. Use a representative heavy account for each
workspace in this order: Coach, Learner apprenticeship, Learner commercial,
Curriculum, Super Admin, Enrolment, Tutor, Employer, Record Monitor.

The super-admin report endpoint is:

```text
GET /curriculum_api/performance/report/?days=14
GET /curriculum_api/performance/report/?days=14&workspace=coach
```

A page passes only with at least five warm samples, warm page-ready p95 at or below
2.5 seconds, cache-hit API p95 at or below 500 ms (or successful API p95 where no
endpoint exposes cache status), no failed initial request, and at most eight initial
GETs. Query counts must also remain bounded as row counts grow.

## Coach staged rollout

1. Keep all new flags false and migrate the additive tables.
2. Start one continuously supervised worker:

   ```bash
   python manage.py process_read_model_events --forever --limit 100 --poll-seconds 2
   ```

   During a canary, a worker can be restricted without touching unrelated
   queued models: `--model learner.home` (or `--model coach.dashboard`).

3. Enable event capture and dual writing, while reads still use the legacy path:

   ```text
   READ_MODEL_OUTBOX_ENABLED=true
   READ_MODEL_DUAL_WRITE_ENABLED=true
   COACH_DASHBOARD_SHARED_READ_MODEL_ENABLED=false
   READ_MODEL_WORKER_LEASE_SECONDS=300
   READ_MODEL_OUTBOX_RETENTION_DAYS=7
   ```

4. Backfill each test Coach scope on the child branch:

   ```bash
   python manage.py rebuild_read_model --model coach.dashboard --scope-type coach --scope-id coach@example.com
   ```

5. Compare legacy and shared payloads for the same Coach, including create, update,
   delete, transaction rollback, repeated events, Redis outage, and worker restart.
6. Enable `COACH_DASHBOARD_SHARED_READ_MODEL_ENABLED=true` behind the deployment
   feature flag for test accounts/canary traffic, then expand gradually.
7. On any mismatch, turn only the shared-read flag off. The API immediately falls
   back to the existing snapshot/live query path.

Do not remove `coach_dashboard_snapshot` until the Production canary has passed the
same parity and performance budget for an agreed observation period.

## Learner Home staged rollout

The same worker and outbox serve this model; no learner-specific table or worker is
required. Build and validate a canary scope on the child branch first:

```bash
python manage.py rebuild_read_model --model learner.home --scope-type learner --scope-id commercial:499
```

Then enable event capture while reads remain live. Only after payload parity and
the warm request budget pass should canary reads use:

```text
READ_MODEL_OUTBOX_ENABLED=true
LEARNER_HOME_SHARED_READ_MODEL_ENABLED=true
LEARNER_HOME_READ_MODEL_TTL_SECONDS=30
```

Writes to learner identity/profile, training-plan modules, progress, and absence
recovery enqueue the same scoped row. Raw-SQL sources that do not emit Django
signals are covered by stale-read refresh and bounded reconciliation; keep that
reconciliation enabled until those write paths publish explicit outbox events.

## Curriculum Home staged rollout

Curriculum uses two rows, not per-page tables. Build both visibility scopes on a
verified Neon child branch before switching reads:

```bash
python manage.py rebuild_read_model --model curriculum.home --scope-type curriculum --scope-id operational
python manage.py rebuild_read_model --model curriculum.home --scope-type curriculum --scope-id all
```

Then run the worker with `READ_MODEL_OUTBOX_ENABLED=true` while the read flag stays
false. After exact payload comparison for both scopes, enable canary reads with:

```text
CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=true
CURRICULUM_HOME_READ_MODEL_TTL_SECONDS=30
```

`Cache-Control: no-cache`, `skipCache`, and timestamped post-save reads bypass the
projection and preserve the existing read-after-write behaviour. Turning the flag
off immediately restores the existing cache/live-query path.

## Deployment boundary

This repository now provides the worker command, not the VPS service definition.
Production activation still requires a real supervisor (for example systemd),
restart policy, health monitoring, application environment, and Redis availability.
If the worker stops, outbox events remain durable and stale leases are reclaimed.
If Redis stops, reads fall back to the latest valid Postgres read model.

Run bounded reconciliation periodically only after the outbox and worker are live;
it is a lost-event safety net, not the primary refresh mechanism:

```bash
python manage.py reconcile_read_models --model coach.dashboard --limit 100 --max-age-seconds 30
```

Production write tests must use records and accounts explicitly named `PERF TEST`.
Until those exist, Production diagnostics are read-only.

## Neon child-branch validation (2026-09-28)

Validation was performed only on child branch `perf-read-models-20260928`
(`br-shy-morning-abc5pwqk`), created from Production at HEAD and configured to
expire on 2026-10-12 at 18:00 UTC. Production was not migrated or written to.

The branch contains 10,000 synthetic `PERF TEST` read models, 50,000 outbox
events, and 50,000 performance samples for scale testing. Four real Coach v3
legacy snapshots were copied into the generic table on this branch; full JSON,
schema-version, and refresh-timestamp comparison returned zero mismatches.

Measured `EXPLAIN ANALYZE` results on the branch:

| Operation | Forced sequential baseline | Indexed |
| --- | ---: | ---: |
| Read one scoped model | 0.990 ms | 0.073 ms |
| Find duplicate events for one scope | 7.061 ms | 0.044 ms |
| Claim 100 ready events with `SKIP LOCKED` | 19.293 ms | 0.254 ms |
| Read 14-day Coach telemetry (6,250 rows) | 8.794 ms | 4.364 ms |
| Find expired telemetry | 10.772 ms | 0.024 ms |

The original outbox claim index was rejected because PostgreSQL scanned and
sorted all 50,000 events. Migration `0002_optimize_outbox_claim_index` replaces it
with the partial `platform_outbox_ready_idx` and orders claims by
`available_at, created_at`. Inserting 10,000 pending events measured 82.237 ms
without this index and 117.171 ms with it: about 0.0035 ms extra per event for a
roughly 76x faster claim query. Temporary write-benchmark rows were deleted.

The processed-event purge remains a bounded hourly maintenance query (6.628 ms
at 50,000 rows), so no extra write-maintained purge index was added. Re-evaluate
only if real retained outbox volume makes that query material.

### Coach live-build profile

Read-only profiling used the largest existing Coach snapshot on the same child
branch (32 learners). The complete background build fell from 69.582 seconds to
18.600 seconds (about 73% faster), with 37 SQL queries and 15.238 seconds of
measured database time. This is refresh-worker time, not the warm page-read
budget; warm requests read one already-built Postgres/Redis projection.

The main verified reductions were:

- Imported review selection now projects only fields consumed by the dashboard:
  19,437,219 bytes became 393,312 bytes for the same 590 source rows, about 98%
  less database transfer.
- Latest learner activity now selects at most the newest progress and feed
  candidate per learner in SQL. Its measured stage fell from 4.617 seconds to
  0.146 seconds for the 32-learner Coach, about 97% faster.
- The historical KSB fallback query is skipped for learners whose canonical KSB
  projection is ready. All 32 learners in the profiled caseload were ready, so a
  redundant result set of about 161,000 rows was avoided.

Read-only parity checks against the pre-optimization selectors returned zero
mismatches for all 590 imported review events and all 32 latest-activity results.
The activity check includes the established timestamp tie-break order, which is
now reproduced in SQL without loading the full learner histories.

Monthly risk history and canonical metric construction remain the largest
background stages. They are intentionally left on the worker path until exact
parity tests justify a deeper SQL aggregation; they do not belong on the warm
request path.

Local validation passed 19 read-model tests, including overwrite-in-place,
delete, transaction rollback, constant query count for small/large payloads,
event coalescing within and beyond a claim batch, preservation of changes that
arrive during refresh, retry, stale-worker recovery, Redis failure fallback, and
retention. `makemigrations read_models --check --dry-run` and `manage.py check`
also passed.

This proves the schema and index design, not the end-user page budget. Page p95,
initial GET counts, and per-workspace SQL counts still require deploying the
diagnostic code for allowlisted test accounts and collecting the warm samples
listed above. Redis, the continuously supervised worker, and Production canary
activation remain deployment-stage work.

### Learner Home live/read-model profile

Read-only profiling used a representative commercial learner on the same child
branch after removing duplicate assignment reads and batching review overrides.
The live Home projection returned the same JSON as the stored shared model. The
live path used 32 SQL queries and took 4.019 seconds; the Postgres fallback read
used one SQL query and took 387 ms, with Redis deliberately unavailable. This
passes the API cache-hit budget without relying on Redis. A warm Redis hit should
avoid even that database query, but must still be measured during deployment.

The Training Plan dashboard did not receive a read model: after N+1/query-shape
work its warm query count fell from 23 to 17 and observed response time was within
the 2.5-second budget. Learner Home remained above budget after query reductions,
which is why only Home received this additional projection.

### Curriculum Home live/read-model profile (2026-09-29)

Validation was performed only on child branch `learner-ssot-runtime-20260929`
(`br-frosty-dew-abs5e93q`). The shared read-model migrations and the two
`curriculum.home` scope rows were written there; Production was not changed.

The first compact Overview profile took 112.297 seconds. Restricting the
Curriculum component read to the nine columns consumed by KSB coverage reduced it
to 59.088 seconds. Replacing the programme cards' full learner activity-history
join with a totals-only, KSB-filtered query removed nine SQL statements and made
the former 18-second KSB reads use the existing `learner_progress_ksbs_code_idx`;
no new index was added. A later cold live build used for parity took 27.377
seconds, confirming that the remaining cost is primarily Python aggregation over
37,155 components rather than an indexable request-path query.

The persisted `operational` projection matched a fresh legacy build exactly for
both response slices (same Overview, same seven Programmes, and the same canonical
SHA-256 digest). With Redis deliberately unavailable, a repeated-process profile
returned the approximately 403 KB Overview from a cold connection in 1.015
seconds, from the same warmed Postgres connection in 191.3 ms, and from the
application cache in 8.0 ms. The Postgres paths used one SQL query and the cache
hit used none. These local measurements pass the request-path budgets, but
deployed p95 still has to be measured through the real pooled connection. Redis
and the supervised worker remain deployment-stage requirements, not local
assumptions.

### Super Admin workspace profile (2026-09-29)

The Admin landing page starts three parallel GETs: overview, recent audit, and
system status. On the verified child branch the overview originally executed
six small aggregate statements inside six redundant transaction wrappers. Over
Neon that meant 18 protocol-level SQL operations and a 1.29–1.42 second warm
response. Optional-query isolation now opens a savepoint only when the caller is
already inside a transaction; normal autocommit requests need no wrapper.

After the change, the overview used six SQL operations and measured 395–413 ms
warm (1.086 seconds on a deliberately closed connection). Audit measured
332–348 ms and system status 185–192 ms. The page therefore remains at three
initial GETs and every warm API is within the 500 ms budget. No Admin read model
was added: it would duplicate already-cheap, current control-plane values.

The Enrolment/Compliance workspace is not yet a live-data performance target.
Its dashboard source is fixture-backed and is not registered in the application
router; the related pages likewise use static mock constants. Per the agreed
scope, mock/static pages do not receive database telemetry or read models. They
must first be connected to real APIs and routed before meaningful request or SQL
budgets can be measured.

### Tutor workspace profile (2026-09-29)

The heaviest linked Tutor on the child branch had 32 assigned modules. Its
landing page makes one initial workspace GET; module structures are deliberately
loaded only when a card is opened. Repeated warm workspace reads used four SQL
queries, returned about 19.9 KB, and measured 337–456 ms. Query count is fixed:
one staff-directory lookup, one assignment scan, one batched upcoming-session
lookup, and one batched module-details lookup.

An attempted one-query reuse reduced the warm count to three, but changed the
database-defined module ordering and therefore failed exact payload parity. It
was rejected and reverted. The existing endpoint already passes the request and
SQL-shape budgets, so Tutor receives no shared read model.

### Employer workspace status (2026-09-29)

`/workspace/employer` currently imports a fixed learner profile and declares its
OTJH, attendance, evidence, and review rows as frontend constants. It performs
no initial API or SQL reads, so a database read model would cache invented data
rather than improve a real request. The separately routed admin employer portal
does use live APIs, but it is not the signed-in Employer landing workspace.
Employer performance work is therefore deferred until that landing page is
wired to the real employer scope and identity.

### Record Monitor live/read-model profile (2026-09-29)

Validation was performed only on child branch `learner-ssot-runtime-20260929`
(`br-frosty-dew-abs5e93q`). Production was not migrated or written to. The
Record Monitor uses one shared row (`record.monitor`, `record-monitor`,
`global`) and `UPSERT`s that row; it does not append historical snapshots.

The first cohort query contained two correlated count subqueries. On 368 active
learners PostgreSQL rescanned `Created_users` 368 times: `EXPLAIN ANALYZE`
reported 82.6 ms and 29,619 shared-buffer hits. Replacing those subqueries with
two grouped CTEs and joins preserved the exact result while reducing the same
query to 2.5 ms and 262 shared-buffer hits. Existing indexes were sufficient;
no speculative index was added.

The complete live projection still needs six independent source reads and was
observed at roughly 0.7â€“1.4 seconds warm depending on Neon/network latency, so
it warranted a read model after the SQL-level N+1 was removed. The child row
contains 368 records (about 521 KB of JSON). A fresh live snapshot and the
stored row matched exactly, and six response comparisons passed for page 1,
page 2, completed/not-started statuses, programme filtering, and search.

The request path now uses zero SQL queries on an application-cache hit (4â€“5.4
ms locally) and one constant SQL query when falling back to Postgres (223 ms on
an already-open connection). A deliberately closed connection took longer and
is not the warm-request budget. Redis connection/read waits are capped at 200
ms with no in-request retry, and a five-second circuit breaker prevents every
request from repeating a failed cache attempt; the latest valid Postgres row is
still served.

Previous-record writes enqueue the refresh event inside the same `enrolment`
transaction. `Created_users` model saves/deletes also enqueue the global scope.
Raw audit/source imports that bypass Django models remain protected by the
30-second stale read and bounded reconciliation until those importers emit an
explicit outbox event.

The complete child-branch lifecycle was exercised: bounded reconciliation
enqueued one stale scope, the worker claimed and coalesced it, rebuilt the row,
and finished with one processed event and zero pending/retry events.

Build the row before canary reads, then enable outbox/worker and the read flag:

```bash
python manage.py rebuild_read_model --model record.monitor --scope-type record-monitor --scope-id global
python manage.py reconcile_read_models --model record.monitor --limit 1 --max-age-seconds 30
```

```text
READ_MODEL_OUTBOX_ENABLED=true
RECORD_MONITOR_SHARED_READ_MODEL_ENABLED=true
RECORD_MONITOR_READ_MODEL_TTL_SECONDS=30
```

Turning `RECORD_MONITOR_SHARED_READ_MODEL_ENABLED` off immediately restores the
six-query live path without changing the endpoint or frontend response shape.
