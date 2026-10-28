# Complete Backend Runtime Isolation Verification

Date: 2026-10-27  
Branch: `fix/api-endpoints`  
Mode: strict read-only audit; no fixture provisioning  
Verdict: **BLOCKED**

## A. Runtime Isolation Verdict

The benchmark runtime now fails closed around the exact Neon branch metadata,
all configured Django aliases, direct psycopg entry points, common Python HTTP
clients, SMTP, and raw Python sockets. A real Django startup reached only
`lms_ideal_test`, and a real in-process WSGI request preserved the API
authentication gate.

Provisioning and authenticated benchmarking are nevertheless **BLOCKED**. The
verified Neon endpoint is a read-write endpoint, and the credential behind
`LMS_IDEAL_TEST` belongs to a role with `CREATEDB`, `CREATEROLE`, `REPLICATION`,
`BYPASSRLS`, and DML privileges on the learner identity table. The current
read-only guarantee is a client/session default (`default_transaction_read_only=on`),
not a least-privilege database role or immutable database boundary. No write
probe was made because this task explicitly forbids database writes.

The network guard is also process-level Python instrumentation, not an
OS/container egress policy. It covers the application clients and raw database
drivers found in the audited runtime, but a future native extension or spawned
process could bypass it. Therefore the acceptance condition that only the test
branch is reachable cannot be proven as a hard runtime property.

## B. Database Connection Inventory

| Mechanism | Destination source in normal runtime | Benchmark protection | Result |
|---|---|---|---|
| Django `default` | `DATABASE_URL`, `DATABASEURL`, or `Database_url` | Constructed only from `LMS_IDEAL_TEST`; exact host, database, endpoint ID, branch ID, and branch name checked before connection and again from PostgreSQL | Verified on `br-orange-shadow-abm8uwwe` |
| Django `enrolment` | `ENROLMENT_DATABASE_URL` and legacy fallbacks | Same single benchmark DSN as `default`; no legacy fallback | Verified on `br-orange-shadow-abm8uwwe` |
| `EnrolmentRouter` | Routes `learner_api`, `enrolment_api`, and `login` to `enrolment` | Target alias is one of the two verified aliases | Protected |
| Optional Django aliases | assistant/ticketing, audit, audit clone, attendance, learner-auth reader, safeguarding, assessment/coaching sources | Suppressed during `.env` loading, required blank, and runtime rejects any alias other than `default`/`enrolment` | Disabled |
| `connections[...]` and ORM `.using(...)` | Registered Django aliases | Cannot name an unregistered alias; connection-created hook re-verifies every PostgreSQL connection | Protected |
| `psycopg.connect` | DSN/kwargs/libpq environment | Module function wrapped; exact host, port, database and read-only option checked; live connection checks database and Neon branch | Protected in this process |
| `psycopg.Connection.connect` | Direct classmethod and pool internals | Separately wrapped to prevent bypass of the module alias | Protected in this process |
| `psycopg.AsyncConnection.connect` | Async direct calls | Separately wrapped with async live identity/read-only verification | Protected in this process |
| `psycopg2.connect` | Future/optional dependency | Wrapped if importable; package is not installed in the audited environment | Protected if loaded after guard installation |
| Django psycopg pool | `OPTIONS.pool` | Disabled in benchmark mode | Disabled |
| `psycopg_pool` | Direct pool consumers | Installed, but no reachable Learner request creates it; classmethod guard covers connections made after guard installation | Limited/process-level |
| SQLAlchemy | Engine URL | Not installed and no backend engine creation found | Not present |
| Scripts, management commands, migrations | Their own CLI/env inputs | Not imported or launched by WSGI startup; runtime schema bootstrap is disabled | Out of request runtime |

The direct and pooled hostnames are accepted only when they belong to endpoint
`ep-dawn-block-ab5vob3x`; Django normalises the benchmark DSN to the direct
hostname. A same-host/wrong-database target, parent branch metadata, production
URL, opaque `PGSERVICE`, or hidden libpq environment destination is rejected.

## C. External Integration Inventory

| Integration | Reachable implementation | Benchmark isolation status |
|---|---|---|
| Azure Blob Storage / evidence / materials / recordings | Azure SDK and generated SAS URLs | Storage credentials are cleared; socket/DNS guard blocks Azure hosts. SAS/open/download endpoints are excluded from the benchmark. |
| Microsoft Graph / Teams / OAuth / mail | `httpx`, `requests`, Graph helpers | Azure mail and background sync flags are disabled; HTTP and socket guards reject Graph destinations. |
| SMTP / Django email | SMTP backend and mail helpers | LocMem email backend is forced; direct SMTP connect is blocked. |
| Webhooks and other HTTP | `requests`, sync/async `httpx`, `urllib` | Deny-by-default; only localhost and the exact Neon endpoint are permitted. Mutating remote HTTP methods also need an explicit mutation switch. |
| Google Drive / CalDAV / Google Calendar | `urllib` and `httpx` | Blocked by HTTP/socket guard; corresponding refresh/media endpoints are excluded. |
| Redis cache / Channels | Redis URLs from environment | Replaced by LocMem cache and in-memory channel layer. |
| OpenAI / KBC LMS services | SDK/HTTP credentials and URLs | API keys cleared; external network blocked. |
| Mobile push/calendar writes | release flags and provider clients | Explicitly forced off. |
| Background/scheduled work | curriculum warm, holidays, catch-up reminders, session result worker, coach snapshot/recording refresh | Explicitly forced off. No thread appeared at startup or after the request. |
| Read-model outbox and dual writes | signal/outbox handlers | Outbox, dual-write, and Learner Home shared read-model flags forced off. |
| Demo session bootstrap | login bridge | Explicitly forced off. |

Python-level blocking was adversarially exercised against fake Azure, Graph,
webhook, SMTP, and PostgreSQL destinations. Native subprocess network access is
not constrained by this policy and remains a reported limitation.

## D. Runtime Verification

The controlled probe `reports/verify_backend_runtime_isolation.py` was run in a
fresh process with benchmark mode enabled and `LMS_IDEAL_TEST` loaded locally
without printing its value. No server socket was opened.

Observed runtime evidence:

- Django completed `django.setup()` with only `default` and `enrolment`.
- Both aliases were configured for the direct endpoint
  `ep-dawn-block-ab5vob3x.eu-west-2.aws.neon.tech`, database `neondb`.
- PostgreSQL reported branch `br-orange-shadow-abm8uwwe`, endpoint
  `ep-dawn-block-ab5vob3x`, and `transaction_read_only=on` for both aliases.
- `pg_is_in_recovery()` was false, confirming this is not an inherently
  read-only replica.
- Runtime schema bootstrap, read-model outbox, dual writes, mobile push, and
  mobile calendar writes were false.
- Cache, Channels, and email used in-memory backends.
- Thread inventory was exactly `MainThread` before setup, after setup, and
  after the request.
- A real WSGI GET to
  `/learner_api/learner-summary/apprenticeship/1/` without a session returned
  `401 Unauthorized` (64 bytes), proving the authentication gate was active.
- The probe executed SELECT statements only. No migrations, mutations,
  synthetic rows, external calls, or listening server were used.

An authenticated request was not executed because no test-owned identity or
recoverable synthetic session exists. Existing inherited Learners were not
impersonated. Consequently object-level permission execution in a live request
remains unverified, despite focused permission tests passing.

## E. GET Safety Matrix

`SAFE TO BENCHMARK` below means source-traced as read-only under the hardened
benchmark settings, with a test-owned session whose heartbeat is suppressed.
It does not mean an authenticated runtime sample was taken in this task.
LocMem cache writes and in-process instrumentation are allowed and disappear
with the process.

| Phase 4G endpoint | Classification | Side-effect finding |
|---|---|---|
| `GET /learner_api/learner-summary/<kind>/<id>/` | SAFE TO BENCHMARK | Database reads only; auth/object ownership required. |
| `GET /learner_api/overview-week/<kind>/<id>/?section=home-summary` | SAFE TO BENCHMARK | Compact read path; shared read-model enqueue is disabled. |
| `GET /learner_api/overview-week/<kind>/<id>/?section=home` | UNSAFE TO BENCHMARK | Can enqueue a read-model refresh when that feature is enabled; use `home-summary`. |
| `GET /learner_api/training-plan-dashboard/<kind>/<id>/?section=upcoming` | SAFE TO BENCHMARK | Database projection only. |
| `GET /learner_api/dashboard/<kind>/<id>/header/minimal/` | SAFE TO BENCHMARK | Database projection only. |
| `GET /learner_api/dashboard/<kind>/<id>/weekly/plan/` and `.../<week_id>/` | SAFE TO BENCHMARK | Read-only weekly projections; process-local cache/metrics only. |
| `GET /learner_api/dashboard/<kind>/<id>/overview/` | SAFE TO BENCHMARK | Database projection only. |
| `GET /learner_api/dashboard/<kind>/<id>/monthly/plan/` | SAFE TO BENCHMARK | Database projection only. |
| `GET /learner_api/dashboard/<kind>/<id>/training/` and `training/modules/<module_id>/` | SAFE TO BENCHMARK | Database projection only. |
| `GET /learner_api/my-learning/<kind>/<id>/` | SAFE TO BENCHMARK | Catalogue read; local cache/instrumentation only. |
| `GET .../my-learning/.../search/` | SAFE TO BENCHMARK | Paginated reads only. |
| `GET .../my-learning/.../upcoming/` | SAFE TO BENCHMARK | Database projection only. |
| `GET .../my-learning/.../modules/<subject_id>/` | SAFE TO BENCHMARK | Stored local content reads; no old-LMS fetch. |
| `GET /learner_api/learner-detail/<kind>/<id>/?content=summary` | SAFE TO BENCHMARK | Explicit `read_only=True` projection. |
| `GET /learner_api/learner-detail/<kind>/<id>/?content=activity|reading|quiz` | SAFE TO BENCHMARK | Explicit read-only/detail branches; storage/media URLs must not be followed. |
| `GET /learner_api/learner-detail/<kind>/<id>/` (full default) | UNSAFE TO BENCHMARK | Full builder retains historical lifecycle/plan hydration/identity-healing write paths. |
| `GET /learner_api/metrics/<kind>/<id>/` | SAFE TO BENCHMARK | Database reads only. |
| `GET /learner_api/student-activity/<kind>/<id>/?view=my-learning` | SAFE TO BENCHMARK | Stored activity/progress reads only. Attempt start/submit routes are writes and excluded. |
| `GET /learner_api/learning-plan/<id>/` | SAFE TO BENCHMARK | Method branches before PATCH/PUT save path. |
| `GET /learner_api/evidence/<kind>/<id>/` | SAFE TO BENCHMARK | Metadata reads only. |
| `GET /learner_api/evidence/<kind>/<id>/<file_id>/download/` | UNSAFE TO BENCHMARK | Mints an Azure SAS capability; credentials are cleared in benchmark mode. |
| `GET /learner_api/evidence/<kind>/<id>/historical/` and detail | SAFE TO BENCHMARK | Database metadata/history reads only. |
| `GET .../historical/<source>/<source_id>/open/` | UNSAFE TO BENCHMARK | Mints Azure read/download SAS capabilities. |
| `GET /learner_api/review-sessions/<kind>/<id>/?content=summary` | SAFE TO BENCHMARK | Summary/database reads only. |
| `GET /learner_api/review-history/<kind>/<id>/` | SAFE TO BENCHMARK | History/database reads only; PDF/artifact/open routes excluded. |
| Calendar availability/refresh, attendance settlement, media proxy, file/PDF open routes | NOT VERIFIED | They can call Graph/Google/CalDAV/Azure or enter mutation paths and are not Phase 4G safe endpoints. |

Every authenticated request can normally update login-session heartbeat fields.
The proposed synthetic session must set `Last_seen_at=Expires_at` so the
benchmark does not enter that write path. That fixture was not created here.

## F. Tests

| Check | Result |
|---|---|
| `python manage.py test config.test_test_isolation_no_db config.tests_test_branch_guard --verbosity=1` | **39/39 passed** in 22.106s |
| `python manage.py test login.test_selectors_no_db login.tests_learner_progress_gate learner_api.test_curriculum_lookup_permissions_no_db --verbosity=1` | **56/56 passed** in 0.127s |
| Real Django startup + read-only probe | **PASS** for startup, alias identity, read-only session state, background-thread absence, and anonymous `401` |
| Authenticated Learner request | **NOT RUN**; no test-owned identity/session exists |
| Intentional database write rejection | **NOT RUN**; prohibited by this strict read-only task |
| Teams baseline / expanded Teams checks | **NOT REQUIRED**; no Teams-listed file was edited |
| Frontend tests | **NOT REQUIRED**; no frontend file or response contract changed |

Adversarial coverage includes production URL rejection, parent-branch metadata
rejection, wrong alias/database rejection, `.env` suppression, libpq environment
fallbacks, opaque service rejection, psycopg module/class/async bypasses,
Azure/Graph/webhook/SMTP denial, background startup denial, correct target
acceptance, and secret redaction.

## G. Remaining Risks

1. The database credential is privileged and the endpoint is writable. A code
   path that obtains the same credential outside the Python guard, or explicitly
   changes transaction mode, could write to the branch.
2. Python monkeypatching is not an OS/container network boundary. Native code,
   a newly introduced transport, or a subprocess could bypass it.
3. No authenticated WSGI request has exercised real session lookup, canonical
   Learner identity, and object-level ownership together.
4. No intentional write was attempted, so server rejection of an actual DML
   statement has not been demonstrated.
5. The exact GET paths are source-classified, not measured end-to-end. New
   side effects added later require renewed tracing/tests.
6. The target branch was created from parent data. It is isolated from
   Production writes but contains inherited data; existing users must not be
   used as benchmark identities.

No unguarded Python database or HTTP mechanism reachable from the audited
Learner request runtime was found. The unresolved risks are boundary strength
and missing authenticated runtime evidence, not a known observed Production
connection.

## H. Provisioning Readiness

**NOT SAFE — DO NOT PROVISION THE 364 SYNTHETIC ROWS.** No rows were created.

Before provisioning:

1. Create/use a dedicated benchmark database role without `CREATEDB`,
   `CREATEROLE`, `REPLICATION`, or `BYPASSRLS`, and with database/table grants
   limited to the benchmark plan.
2. Separate the narrowly scoped fixture writer from the read-only benchmark
   runtime credential. The benchmark process itself should have SELECT-only
   privileges and an enforced read-only connection policy.
3. Add an OS/container egress allowlist (localhost plus the exact verified Neon
   endpoint), or document and approve an equivalent infrastructure boundary.
4. Re-run this probe and demonstrate one authenticated, test-owned safe GET
   with no database mutation, external call, or background work.
5. Only then authorise the exact transactional 364-row insert and receipt-based
   cleanup in a separate write-controlled operation.

Safety record for this task: zero Neon writes, zero migrations, zero synthetic
fixtures, zero Production connections, zero external service calls, zero
commits, zero pushes, no branch/worktree changes, and no edit to `AGENTS.md`.

