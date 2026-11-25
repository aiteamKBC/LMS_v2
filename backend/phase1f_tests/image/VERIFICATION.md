# Phase 1F test image and bounded integration verification

Verified 2026-11-18 on the existing Architecture checkout. No production files,
production requirements, environment files, Git branches or existing databases
were changed by this task. Earlier working-tree changes were preserved.

## Dependency review and image

The import-time closure was traversed statically from the seven requested
Curriculum modules, learner learning-plan/active-user paths, authentication and
middleware. Runtime-local imports discovered in the exercised invalidation path
were added to the source bundle after inspection. Final bundle: 103 Python files;
only Python sources, empty/package initializers, the immutable synthetic snapshot
and test scripts are transferred. Production settings and .env are excluded.
The Docker build context remains restricted by the existing .dockerignore to
Dockerfile, requirements.txt and constraints.txt.

| Import | Distribution/pin | Finding |
| --- | --- | --- |
| azure.core | azure-core==1.41.0 | Required at import time by upload_storage, blob_storage and evidence_storage; previously missing |
| azure.storage.blob | azure-storage-blob==12.30.0 | Required by blob_storage; previously missing |
| httpx | httpx==0.28.1 | Required by the imported login.email_azure module; email operations excluded |
| lxml.etree | lxml==6.1.1 | Required by pptx_slides; already installed transitively, now explicit |

All four pins come from backend/requirements.txt and already existed in the test
constraints. No generic `azure` package or azure-identity was added. Lazy S3/provider
operations are outside the exercised workflows; their optional packages were not
added solely to cover unrelated features. Existing Django, psycopg, channels,
requests, Redis client and document-library pins were preserved. No Python lockfile
was found in the backend; JavaScript lockfiles do not control this image.

Build PASS, public Docker Hub/PyPI only. Image lms-phase1f-python:3.14.3:
`sha256:f9e81dd6bafd22ed1cb152672456b9da2c45a714f4145a242bbad5556d51eea4`.
Python 3.14.3, Django 6.0.7, psycopg 3.3.4. pip check PASS; all 30 installed
application distributions match constraints. pip itself is base-image tooling.

Real imports PASS: curriculum_api.views, learner_assignments,
learner_status_counts, learning_storage, home_summary, programme_list,
upload_storage. No fake third-party packages or replacement views module.

## Isolation and test configuration

- PostgreSQL official postgres:18.3-bookworm; ephemeral tmpfs data and socket dirs.
- PostgreSQL container starts as sleep, with network=none. Python shares that
  network namespace. OS loopback-only interfaces and an empty IPv4 route table
  are asserted before initdb or Django. No published ports, host mounts, Docker
  socket, host credentials, environment file or externally routed interface.
- Python root filesystem is read-only; reviewed sources live in /tmp tmpfs.
- All six aliases explicitly use 127.0.0.1:5432 / phase1f and synthetic credentials.
  No host database variables are passed. Identity checked before schema creation.
  Direct drivers are equally confined by the OS network namespace.
- Actual EnrolmentRouter routes learner/login ORM to enrolment and curriculum ORM
  to default; both are the same disposable database on separate connections.
- Actual models, real login sessions/middleware/decorators and Django Client.
  Base AppConfig suppresses production ready hooks. Read-model outbox disabled;
  cache uses LocMem. No real provider, queue or Redis operations.
- Test schema is created from the real model definitions plus explicitly scoped
  normalized SQL columns needed by the readers. No production migrations run.
- Fixtures reset committed synthetic state between cases/reader variants. HTTP
  tests are not wrapped in an outer transaction that would interfere with real
  middleware connection cleanup. Request-level production transactions remain real.
- Both containers were removed after each run; no test database remains.

## Actual results

Final PostgreSQL/Django suite: **13 tests, 13 PASS, 0 FAIL, 0 SKIPPED**, 1.401s
reported by unittest (not a production performance measurement).

Coverage: canonical full GET and assignedOnly=1; real ORM ordering/JSON parity;
inherited/manual/direct/sibling membership and inactive-profile inclusion;
missing/empty targets; missing and zero registration bridges; anonymous 401 and
learner-role 403 with real stored sessions; catalogue-prefix and legacy source-ID
resolution; normalized KSB joins, duplicate codes, inactive/archived filtering;
POST assign/skip and DELETE remove/skip; persisted normalized module rows; first
assignment and inherited-delete mirror paths; actual rollback after an injected
failure following a real module-row INSERT, including restored JSON/title fields.

Old reader/policy are compiled from the hash-verified immutable pre-integration
snapshot, with original imports/globals. New reader is the actual imported
production function. Membership is not mocked. Writer failure injection is a
deliberate negative test, not a substitute for successful write tests.

Existing behavior characterized separately: inherited DELETE with no recordable
remaining plan returns 503 and rolls back. The original successful-mirror fixture
lacked a retained legacy selection; it was corrected to provide one. A separate
test retains the empty-remainder refusal and verifies both reader variants.

Earlier fixture failures involved missing model-external schema columns and
inappropriate outer test transactions; these were corrected in test code only.
Final log has no unexpected missing-import or SQL errors. Expected injected/refusal
exceptions and the documented local-cache fallback remain visible.

Prior standalone/isolated-runtime suites rerun on host: 15 + 10 + 6 + 8 = **39 PASS**.
The eight Phase 1D tests retain their existing synthetic infrastructure boundaries;
they are not counted as PostgreSQL tests. No Teams tests were selected.

## Reproduction

```powershell
docker build --tag lms-phase1f-python:3.14.3 --file backend/phase1f_tests/image/Dockerfile backend/phase1f_tests/image
python -I -B backend/phase1f_tests/image/validate_image.py
python -I -B backend/phase1f_tests/image/run_import_smoke.py
python -I -B backend/phase1f_tests/image/run_integration.py
python -I -B backend/learner_api/learning_plans/tests/unit/test_membership_policy_standalone.py
python -I -B backend/learner_api/learning_plans/tests/parity/test_membership_caller_parity_standalone.py
python -I -B backend/learner_api/learning_plans/tests/parity/test_membership_integration_standalone.py
python -I -B backend/learner_api/learning_plans/tests/parity/test_module_membership_standalone.py
python -B backend/phase1f_tests/image/run_membership_runtime.py
```

## Limits and readiness

These results establish the listed synthetic integration cases, not full LMS,
production AppConfig/signal, full Home Summary/Programme List payload, provider,
large-data performance, concurrent-writer or every week/component cascade parity.
Home Summary and Programme List were import-smoke targets; do not report their
entire HTTP workflows as tested. Background hooks remain deliberately suppressed.
Production shared-cache/outbox behavior is not established by local-cache tests.

No dependency/build/import blocker remains for these cases. G01–G05 remain open
until their separate acceptance evidence and owner approvals are satisfied.
No merge, deployment, live database access or additional architectural extraction
is authorized or performed by these tests.

## Task files

Changed: requirements.txt (four exact pins added; all existing lines retained).
Added: import_smoke.py, run_import_smoke.py, integration.py, run_integration.py,
validate_image.py, this report, integration-last.log (synthetic-only test output).
Dockerfile, constraints.txt and .dockerignore remain unchanged in this task.
