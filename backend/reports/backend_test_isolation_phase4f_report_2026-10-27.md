# Phase 4F — Backend Test Isolation and External Side-Effect Protection

Date: 2026-10-27 (Africa/Cairo)  
Workspace: current `fix/api-endpoints` checkout  
Scope: backend test infrastructure and the affected Learner/storage tests only

## A. Implementation Verdict

**FIXED AND VERIFIED** for the supported Django `manage.py test`, pytest, and Django-configured unittest entry points.

Default backend unit tests now fail closed before remote DNS, socket, HTTP, SMTP, or psycopg access; use SQLite plus process-local cache/channel/email backends; and cannot silently fall back to configured remote database or Redis values. Explicit read-only PostgreSQL and controlled integration modes remain available, but neither mode was enabled or connected during this phase.

The guarantee is process-local. A test that deliberately launches an unguarded child executable such as `curl` is outside Python monkey-patch coverage and remains a documented limitation in section K.

## B. Root Cause

`SubjectBuilderCoverTests.test_builder_image_save_only_updates_artwork` mocked the curriculum database connection, cache invalidation, and authoring save, but did not mock `curriculum_api.views.upload_storage.store`. Production code had changed from persisting the submitted data URI directly to decoding it and delegating to the storage adapter. Because real Azure settings were available in the developer process, the call continued through:

```text
tests_student_activity.SubjectBuilderCoverTests
  -> curriculum_api.views.curriculum_module_detail
  -> curriculum_api.upload_storage.store
  -> learner_api.evidence_storage.upload_blob
  -> Azure Blob SDK transport
  -> kbcdocs.blob.core.windows.net
```

There was no process-wide network boundary, so the incomplete high-level mock was the only intended protection and the SDK escaped it.

## C. External Integration Inventory

The table groups clients that share credentials/transports. Test consumers are representative because the network boundary protects the process rather than relying on a finite test-name list.

| Integration | Client module / credential source | Test consumers | Possible side effects | Protection after Phase 4F |
|---|---|---|---|---|
| Azure Blob Storage | `learner_api/evidence_storage.py`, `curriculum_api/upload_storage.py`, `knowledge_base/storage.py`, `progress_reviews_api/storage.py`, audit/manual-audit document helpers, recording/session archives; Azure account/key and container settings | Curriculum upload/storage, learner evidence/material/profile/photo, knowledge-base, reviews, recordings and audit tests | Create/overwrite/delete/copy blobs, create containers, issue SAS URLs, download private content | Expected calls use fake clients/mocks; unit mode blocks the Azure hostname at HTTP, DNS and socket layers |
| Microsoft Graph / Teams / Outlook / Bookings | `login/email_azure.py`, `login/microsoft_sso.py`, `learner_api/calendar_connections.py`, `coach_api/views.py`, `curriculum_api/teams_*`, recording/calendar modules; dedicated Microsoft/Graph environment settings | Login, mail, calendar, booking, meeting, attendance, recording and notification suites | Send mail/invitations, create/update/cancel meetings, read mail/calendar/recordings, alter booking state | Azure mail kill switch is forced off in unit mode; HTTP/socket boundary blocks Graph; explicit integration allowlist and mutation switch are required |
| Google OAuth / Drive / Calendar | `learner_api/google_drive_api.py`, `learner_api/calendar_connections.py`; Google OAuth settings | Drive recovery/media and calendar connection tests | OAuth token exchange, file download/upload, calendar access | External HTTP/DNS/socket blocked by default; only exact integration destinations can be opted in |
| External REST/legacy LMS | `old_otjh/content.py`, `old_otjh/live_attempts.py`, `learner_api/lms_schema.py`, media/source helpers, curriculum England holidays, enrolment postcode lookup, Aptem signed reviews, migration/repair scripts | Old-LMS, postcode, holiday, media, source and reconciliation tests | Remote reads plus service-specific writes in scripts/APIs | `requests`, `httpx`, `urllib.urlopen`, DNS and socket guards; opener-based calls are caught by the lower socket/DNS boundary |
| Mobile push / webhooks | `mobile_comms/push.py`, malware/Event Grid-related handlers and service callbacks | Mobile communications and malware tests | Push delivery and outbound callback acknowledgement | HTTP/socket boundary blocks outbound calls; inbound test requests remain local |
| OpenAI / AI providers | `coach_api/ai_marking.py`, `coach_api/recordings_quality.py`, `coach_api/views.py`, `engagement_api/ai.py`, `knowledge_base/providers.py`, `learner_api/reflection_ai.py`, `audit_api/evidence_classifier.py` | AI marking, summaries, engagement, knowledge-base and evidence-classification tests | Paid inference requests and provider logging | HTTP/DNS/socket guard blocks provider access; existing fake clients remain usable |
| SMTP / Django email | Django email backend plus any direct `smtplib` user; Graph mail is listed separately | Login/invitation/reset/notification tests | Real email delivery | Unit mode forces locmem email and `AZURE_MAIL_ENABLED=false`; direct remote SMTP is blocked |
| Redis cache / Channels | `config/cache_backends.py`, Channels/Redis settings | Cache, dashboard, curriculum and websocket tests | Read/write/flush shared cache, publish channel messages | Unit mode ignores configured remote Redis and uses LocMem cache plus InMemory channel layer; socket boundary is the backstop |
| PostgreSQL / Neon | Django aliases in `config/settings.py`, direct `psycopg` use in runners/scripts; database URL environment settings | Most database-backed tests and performance scripts | Reads, DML, DDL, migrations, test database create/drop | Unit mode forces SQLite and validates every alias; direct remote psycopg is blocked; read-only and writable modes have separate gates and Neon branch verification |
| S3-compatible storage / external queues | No active boto3/async queue client was found in backend Python dependencies inspected for this phase | None found | Object mutation or remote job publication if introduced later | Raw DNS/socket guard would block ordinary Python transports, but a future client must receive an explicit regression test |

Secrets are still loaded by existing production modules in their normal way. The isolation errors show only the client type and destination host/port; they never include URLs with credentials, DSNs, tokens, usernames, or learner data.

## D. Implemented Isolation Architecture

`config.test_isolation` is the single policy and transport boundary.

### Unit mode — default

- Activated automatically by `manage.py test`, pytest `conftest.py`, recognised unittest entry points, direct `test_*.py` entry points that configure Django, or `LMS_TEST_ACTIVE=true`.
- Permits loopback/local sockets needed by Django live-server tests.
- Rejects every non-local destination through guarded DNS resolution, raw socket `connect`/`connect_ex`, `requests`, synchronous and asynchronous `httpx`, `urllib.request.urlopen`, SMTP, and `psycopg.connect`.
- Forces SQLite, LocMem cache, InMemory Channels, locmem email, and the Azure Graph mail kill switch.
- Validates all Django database aliases before setup.

### PostgreSQL read-only mode

- Requires `LMS_TEST_MODE=postgres-read-only`.
- Requires `LMS_IDEAL_TEST` to be a PostgreSQL URL plus exact endpoint and branch IDs.
- Allows only that exact Neon host/port (pooler/direct forms for the same endpoint).
- Requires `default_transaction_read_only=on` before connecting and confirms `transaction_read_only`, `current_database()`, and `neon.branch_id` after connecting.
- Refuses `manage.py test`, because Django test setup can create, migrate, flush, or otherwise write. This mode is for bounded SELECT/EXPLAIN tooling and the prepared local profiling server only.

### Controlled integration mode

- Requires `LMS_TEST_MODE=integration` and an exact host/port allowlist; wildcards, paths, and credentials in allowlist entries are rejected.
- Safe HTTP methods and mutations have separate gates. Mutations require `LMS_TEST_ALLOW_EXTERNAL_MUTATIONS=true`.
- Remote PostgreSQL access additionally requires `LMS_TEST_ALLOW_DATABASE_WRITES=true`, a configured expected Neon branch ID, and the existing verified security-test-branch runner.
- The existing runner verifies the actual Neon branch in a read-only preflight before Django database setup and still requires its existing `--keepdb` safeguards.

No live integration mode was enabled in Phase 4F.

## E. Database Isolation

Default unit-test settings ignore `DATABASE_URL` and all other remote aliases by selecting SQLite before Django builds database connections. A regression assertion confirms every configured alias is SQLite in the default mode. `assert_unit_database_aliases` independently rejects any remote alias that is injected later. Direct `psycopg.connect` calls are rejected before connection setup and their error messages redact the supplied DSN credentials.

The dedicated Neon branch is not treated as disposable and `LMS_IDEAL_TEST` is not treated as write authorisation. Read-only mode and controlled writable integration mode are deliberately separate. This phase made no PostgreSQL connection, migration, fixture write, DDL, DML, cleanup, or schema/data change.

## F. Azure Regression

The affected builder-cover test now replaces `curriculum_api.views.upload_storage.store` with a deterministic fake path and asserts the persisted/public response URL. It additionally patches the lower `learner_api.evidence_storage.upload_blob` boundary to raise if it is reached, then asserts that it was never called. This preserves the intended database/cache/response assertions without skipping the test.

The process-wide guard independently proves that Azure Blob DNS is blocked below the SDK. Therefore another missing Azure SDK mock fails before a remote connection rather than creating a blob.

## G. Tests

Final focused validation:

| Command / group | Result |
|---|---:|
| Combined focused Phase 4F suite: isolation, branch guards, storage, `tests_student_activity`, canonical activity/progress, curriculum permission, and My Learning search modules | **267 passed**, 0 failed, 0 skipped, 49.105s |
| `python manage.py test learner_api.tests_my_learning_diagnostics_no_db config.tests_observability --verbosity=1` | **17 passed**, 0 failed, 0 skipped |
| Exact Azure regression (also included in the 266-test run) | **1 passed** |

The combined command was:

```text
backend\.venv\Scripts\python.exe backend\manage.py test config.test_test_isolation_no_db config.tests_test_branch_guard curriculum_api.tests_upload_storage curriculum_api.test_module_cover_storage_no_db curriculum_api.test_free_course_cover_storage_no_db learner_api.tests_student_activity learner_api.tests_my_learning_no_db learner_api.tests_my_learning_performance_no_db learner_api.tests_my_learning_remaining_latency_no_db learner_api.test_canonical_learning_no_db.CanonicalLearningTests learner_api.test_canonical_learning_no_db.ImportedQuizProjectionTests learner_api.test_canonical_learning_no_db.PreviewDocumentLoadingTests learner_api.test_canonical_metrics_bulk_no_db learner_api.test_curriculum_lookup_permissions_no_db learner_api.test_my_learning_search_no_db --verbosity=0
```

Expected warning/error logs from mocked storage failure-response cases appeared, but the suite exited 0. No test was skipped. An intermediate run exposed ten stale `tests_student_activity` mocks/expectations; those test-only fixtures were updated to the current canonical projection and all 36 tests in that module pass in the final run. The isolation suite also starts a fresh child Python process with synthetic remote PostgreSQL and Redis environment values and proves that unit settings still select SQLite/LocMem/InMemory backends without connecting.

Not executed: the broad backend suite, any live Azure/Graph/Teams/Google/OpenAI/SMTP integration, any Neon write/integration suite, and the Phase 4G HTTP benchmark. Frontend tests were outside this backend-only phase. Teams baseline and expanded Teams checks were **NOT REQUIRED** because no Teams trigger file or shared Teams contract was edited.

## H. Side-Effect Verification

Regression tests demonstrated blocking for:

- Azure Blob hostname resolution;
- Microsoft Graph through asynchronous HTTP;
- arbitrary external HTTPS through `requests` and `urllib`;
- remote SMTP;
- raw external IP sockets;
- remote PostgreSQL through `psycopg`, with credential redaction.

They also demonstrated that loopback sockets still work. Storage behavior was exercised with fake Azure service clients/adapters. Unit settings were checked for SQLite, LocMem cache, InMemory Channels and locmem email. No external resource was intentionally created, modified, retrieved, or deleted in Phase 4F; this conclusion is based on the enforced local boundary and test paths, not on querying live cloud inventories.

## I. Existing Azure Blob

The prior Phase 4E synthetic object remains untouched:

- container: `curriculum-uploads`
- blob key: `MOD-1/cover/cover-20261027141856626247.png`
- reported size: 5 bytes

Manual cleanup remains optional/necessary according to the Azure storage owner's retention decision. Phase 4F did not retrieve or delete it and did not inspect unrelated objects.

## J. Changed Files

- `backend/config/test_isolation.py` — central modes, destination policy, transport guards, database validation and redacted errors.
- `backend/config/test_runner.py` — Django runner boundary for unit/read-only/integration modes.
- `backend/config/test_test_isolation_no_db.py` — fail-closed network/database/configuration regression coverage.
- `backend/conftest.py` — pytest entry point for the same guard.
- `backend/manage.py` — installs the guard before Django initialisation for tests and the prepared read-only local server.
- `backend/config/settings.py` — unit-only SQLite/cache/channel/email isolation and explicit execution-mode gates.
- `backend/learner_api/tests_student_activity.py` — fake storage regression and current canonical-projection test fixtures/expectations.
- `backend/reports/backend_test_isolation_phase4f_report_2026-10-27.md` — this evidence and Phase 4G runbook.

No production business logic, API response contract, frontend source, migration, schema, or data was changed. Existing unrelated worktree changes were preserved. No commit or push was created.

## K. Remaining Limitations

- Python monkey patches cannot contain a deliberately spawned unguarded executable/process (`curl`, PowerShell web cmdlets, a separately launched Python without the test environment). CI should eventually add operating-system/container egress controls for defence in depth.
- Already-imported high-level callables can bypass a high-level patch, which is why DNS/socket are also guarded. Native extensions that open their own sockets outside Python's socket module need their own adapter test; none was found in the inspected active backend clients.
- `aiohttp`, `asyncpg`, boto3/S3 and external queue clients are not installed/used by the inspected backend. The low-level boundary helps for normal Python sockets, but adding one requires a focused self-test rather than assuming coverage.
- The boundary is installed for supported project runners. A pure unittest module that never imports Django/settings, never loads `backend/conftest.py`, and is started without `LMS_TEST_ACTIVE=true` cannot be automatically detected from inside the application.
- Read-only Neon branch identity verification is implemented but was not executed against Neon in this phase, by design. Live integration capability is configuration-tested only.
- The full backend suite was not run because the task explicitly required focused tests after proving isolation; unreviewed live-integration suites remain opt-in.

## L. Phase 4G Readiness

**READY WITH CONDITIONS**

The safe server route is prepared, but a valid test-owned authenticated identity/session is still unavailable. Do not copy a production cookie or create a Neon user without explicit approval.

For a future approved run, set placeholders to the verified branch values without printing them:

```powershell
$env:LMS_TEST_MODE = 'postgres-read-only'
$env:RUN_APP_ON_TEST_BRANCH = 'true'
$env:LMS_TEST_POSTGRES_ENDPOINT_ID = '<approved-neon-endpoint-id>'
$env:LMS_TEST_POSTGRES_BRANCH_ID = '<approved-neon-branch-id>'
$env:LMS_IDEAL_TEST = '<approved-direct-postgresql-url>'
$env:security_Database_url = $env:LMS_IDEAL_TEST
$env:DATABASE_URL = $env:LMS_IDEAL_TEST
$env:Database_url = $env:LMS_IDEAL_TEST
$env:ENROLMENT_DATABASE_URL = $env:LMS_IDEAL_TEST
$env:AUDIT_DATABASE_URL = ''
$env:AUDIT_CLONE_DATABASE_URL = ''
$env:KBC_ATTENDANCE_DATABASE_URL = ''
$env:PERFORMANCE_DIAGNOSTICS = 'true'
$env:LMS_MY_LEARNING_TRACE = '1'
backend\.venv\Scripts\python.exe backend\manage.py runserver 127.0.0.1:8001 --noreload
```

This route binds locally, allowlists only the approved Neon endpoint, makes every Django PostgreSQL alias transaction-read-only, and confirms the actual database/branch on connection. All other external integrations remain blocked. Normal login and server-side object-level permission checks must be used with an approved pre-existing test-owned account.

Measurement plan after that identity prerequisite is satisfied:

1. Send authenticated loopback GETs only; record the response `X-Request-ID` and correlate it with request/projection logs.
2. Read `Server-Timing` and `X-DB-Query-Count` for request wall, Django client DB time, application time and query count.
3. For My Learning catalogue, use the loopback-only `LMS_MY_LEARNING_TRACE=1` stages for serialization time, stage timings and per-alias DB client time. Do not claim PostgreSQL server time from client timing.
4. Capture response bytes client-side both without compression and with `Accept-Encoding: gzip`; do not store response bodies or learner identifiers in reports.
5. Use a separate approved bounded read-only script for SQL fingerprints and safe `EXPLAIN` (no `ANALYZE` on protected data unless separately authorised).

The Phase 4G benchmark itself was **not run**.
