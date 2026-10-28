# Phase 4G.3 - Local Isolated Learner HTTP Benchmark

Date: 2026-10-28 (Africa/Cairo)

## A. Final Verdict

**BLOCKED**

No HTTP timing was collected. The host has no local PostgreSQL server, client
tools, service, process, or listener, and no existing container runtime. The
task explicitly forbids installing system infrastructure without approval and
forbids using SQLite for PostgreSQL performance claims, so database creation,
migrations, fixtures, authentication and HTTP sampling were not attempted.

Safe local-only bootstrap, connection guards, settings and preflight tooling
were prepared and tested without contacting Neon.

## B. Local Environment

Detected:

- Windows host
- Python 3.14.6
- Django 6.0.7
- psycopg 3.3.4
- localhost networking available

Not available:

- `postgres`, `psql`, `pg_isready`, `createdb`, `dropdb`
- PostgreSQL Windows service or process
- listener on ports 5432-5435
- Docker or Podman
- usable WSL distribution
- existing disposable PostgreSQL database

PostgreSQL version, server identity and migration compatibility are therefore
**NOT VERIFIED**.

### Prepared isolation

`config.settings_local_benchmark` now bootstraps before normal Django settings
and requires an explicit URL named
`lms_learner_benchmark_local_<unique-suffix>` on `localhost`, `127.0.0.1` or
`::1`. It clears Neon/remote aliases, libpq fallbacks and external secrets,
disables background jobs, remote cache/storage/email integrations, configures
only `default` and `enrolment`, and installs network/database guards before
`django.setup()`.

The direct psycopg, psycopg classmethod, async psycopg and optional psycopg2
paths reject non-loopback hosts and wrong database names. After connecting,
they verify `current_database()` and `inet_server_addr()`.

Independent kernel/container network isolation remains unavailable. The Python
guard is tested but is not claimed as a complete host boundary.

## C. Synthetic Dataset

No local database exists, so all counts are zero:

| Shape | Learners | Progress rows | Other fixture rows |
|---|---:|---:|---:|
| Small | 0 | 0 | 0 |
| Median | 0 | 0 | 0 |
| Large | 0 | 0 | 0 |
| Maximum representative | 0 | 0 | 0 |

The Phase 4G.2 fixture runbook was inspected as the future local reference but
none of its SQL was executed. Engagement trigger containment and actual created
row counts remain **NOT VERIFIED** on local PostgreSQL.

## D. Authentication

No synthetic LoginAccount, enrolment identity, Learner profile or session was
created. Real middleware/session/canonical identity resolution was not executed
over HTTP. Existing focused authentication and permission tests passed, but
they are not a substitute for the requested local authenticated session.

## E. HTTP Benchmark Results

No server was started and no localhost HTTP request was made.

| Page | Endpoint | Dataset | HTTP p50 | HTTP p95 | SQL Count | DB Time | Payload |
|---|---|---|---:|---:|---:|---:|---:|
| All requested pages | Not run | None | N/A | N/A | N/A | N/A | N/A |

Source discovery prepared the following read candidates for a future run:

- Home: learner summary, `overview-week?...section=home-summary`, and
  `training-plan-dashboard?...section=upcoming`.
- Dashboard: header/bootstrap, weekly plan, monthly plan, tab and training
  module routes.
- My Learning: catalogue, search, upcoming and module detail.
- Learner Detail: detail and summary.
- Learning Plan: learning plan, weekly learning and training-plan dashboard.
- Evidence and Reviews: learner evidence, review history and review sessions.

Every route still requires local fixture-backed side-effect classification
before sampling; source discovery alone is not proof that a GET is read-only.

## F. Bottleneck Ranking

No ranking is produced. There are no HTTP, SQL, serialization, query-count or
payload measurements, so ranking historical results would fabricate evidence.

## G. Query-Level Analysis

No query trace or execution plan was captured. PostgreSQL-specific index, N+1,
round-trip and serialization conclusions remain **NOT VERIFIED**.

## H. Security Tests

Passed:

- `python manage.py test config.test_test_isolation_no_db config.tests_test_branch_guard --verbosity=1`
  - 44/44 passed.
- `python manage.py test login.test_selectors_no_db login.tests_learner_progress_gate learner_api.test_curriculum_lookup_permissions_no_db --verbosity=1`
  - 56/56 passed.
- AST parsing of the five Phase 4G.3 Python files
  - 5/5 passed.
- `python -B reports/preflight_phase4g3_local.py`
  - correctly failed closed with `ImproperlyConfigured` because no explicit
    local disposable PostgreSQL URL was supplied; no remote access attempted.
- The same preflight with a synthetic `127.0.0.1` disposable URL
  - configured only `default` and `enrolment` on the expected local database,
    then returned `OperationalError` because no server was listening; no remote
    access attempted.

The new cases prove that Neon/remote URLs, shared database names, `0.0.0.0`,
opaque libpq options, wrong database names and remote HTTP destinations are
rejected. A fresh-process settings test proves remote DB/Redis/Azure/Microsoft
inputs are scrubbed and only two loopback PostgreSQL aliases survive.

Skipped/blocked:

- local PostgreSQL startup, migration and schema verification;
- fixture creation and trigger verification;
- real login/session and ownership HTTP tests;
- localhost server and timing samples;
- independent OS/container egress test;
- Teams baseline and expanded Teams checks: **NOT REQUIRED**, no Teams file
  was edited.

## I. Limitations

Even after local PostgreSQL becomes available, local synthetic p50/p95 will not
represent Neon compute wake-up, network latency, pooling, deployed worker
contention, production data distributions, cache topology or Production p95.
This run has the additional limitation that it contains no measurements at all.

## J. Recommended Next Optimisation

None can be selected yet. The next action is infrastructure enablement, not a
business-logic optimisation: provide an approved existing local PostgreSQL
installation or container runtime, then create the uniquely named disposable
database and run the prepared preflight before migrations or fixtures.

## K. Changed Files

- `backend/config/local_benchmark.py` - local URL validation, environment
  sanitisation and pre-Django isolation bootstrap.
- `backend/config/settings_local_benchmark.py` - dedicated local benchmark
  Django settings.
- `backend/config/test_isolation.py` - loopback-only local benchmark mode and
  live connection identity verification.
- `backend/config/test_test_isolation_no_db.py` - local/remote negative tests
  and fresh-process settings test.
- `backend/reports/preflight_phase4g3_local.py` - sanitised local PostgreSQL
  readiness check.
- this report.

No production business-logic or frontend file was changed by Phase 4G.3.

## L. Safety Confirmation

- Neon access: **NONE** during Phase 4G.3.
- Production access: **NONE**.
- `lms-ideal-architecture` access: **NONE**.
- `lms_ideal_test` access: **NONE**.
- External Teams/Graph/Azure/SMTP calls: **NONE**.
- Real Learner records or copied personal data: **NONE**.
- Local database writes: **NONE**; no local database exists.
- Remote migrations: **NONE**.
- HTTP load: **NONE**.
- Git branch/worktree creation or switch: **NONE**.
- Commit/push: **NONE**.
- `AGENTS.md`: not modified by Phase 4G.3; its pre-existing change was
  preserved.
