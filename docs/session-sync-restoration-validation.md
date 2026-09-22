# Session synchronization restoration — 17 September 2026

## Outcome and scope

Manual staff/admin Sync now wakes a worker scoped to the requested meeting immediately after the queue transaction commits. The WSGI/ASGI HTTP entrypoints start a periodic worker on their first request; it continues while the service runs, independently of an open Teams page. Existing queue leases, retry policy, archived-file reuse, attendance eligibility and occurrence tracking are retained. No historical result is moved or recalculated by this code change.

The request still returns HTTP 202 rather than claiming that Microsoft or Azure finished. Session and module views refresh saved status after the request and show processing/failure/completion. Saved video elements remain mounted during refresh. Learner and preview views do not expose staff job errors.

Implementation: `backend/curriculum_api/session_sync_runtime.py`, `session_results.py`, `backend/config/asgi.py`, `wsgi.py`, the frontend session-results API/components and module session view. The Teams-page change only corrects its obsolete comment; automatic imports belong to the server. See [operating instructions](../backend/SESSION_RESULTS_OPERATIONS.md#background-execution).

The working tree was clean before this task. No commits, remote Git operations, migration files, database changes, deployment, live imports, meetings or uploads were performed.

## Verification

| Command | Result |
| --- | --- |
| `npm --prefix frontend run test:teams` | PASS before and after implementation: 71 tests, 9 files |
| `npm --prefix frontend run test -- src/components/feature/SessionResults.test.tsx src/components/feature/SessionRecordingPlayer.test.tsx src/hooks/__tests__/useSavedSessionData.test.tsx src/pages/learner/video-watch/liveSessionResults.test.tsx --maxWorkers=2` | PASS: 30 tests, 4 files |
| `python -B backend/curriculum_api/test_session_results_no_db.py` | PASS: 68 tests |
| `python -B backend/curriculum_api/test_session_sync_runtime_no_db.py` | PASS: 13 tests, including execution of the two existing week-selection/resync regression cases |
| `python -B backend/curriculum_api/test_calendar_checks_no_db.py` | PASS: 17 tests |
| `python -B backend/curriculum_api/test_calendar_state_no_db.py` | PASS: 27 tests |
| `python -B backend/curriculum_api/test_calendar_actions_no_db.py` | PASS: 33 tests |
| `backend/.venv/Scripts/python.exe -B -m unittest discover -s backend/config -p tests_asgi_disconnect.py` | PASS: 2 tests; isolated settings with no database or application imports |
| `npm --prefix frontend run type-check` | FAIL: the same 41 diagnostics before/after; diagnostic comparison unchanged |
| `npm --prefix frontend run lint` | FAIL: the same 133 errors and 113 warnings before/after; comparison unchanged after normalizing line positions |
| `npm --prefix frontend run build -- --outDir "$env:TEMP/LMS-session-sync-20260917-build"` | PASS; build output outside repository; dynamic-import and plugin-timing warnings |
| Python AST parse of six changed/new Python files | PASS; no application imports |
| `git -c core.safecrlf=false diff --check` | PASS |

Two existing frontend assertions intentionally changed: after Sync the UI now immediately reads saved status, adding one GET. The tests still assert lazy session-detail loading and one explicit sync POST. No test was skipped. An initial focused run found the second old call-count expectation; it was updated to assert the authorized immediate refresh and the final run passed.

Backend checks use AST-extracted real functions, injected transports and database/storage doubles, or an isolated Django HTTP application with `DATABASES={}`. They cover dispatch after commit, failed starts, bounded/coalesced manual dispatch, periodic retries, request pass-through, staff/learner boundaries, worker leases, archived-video reuse and the existing Week 12 versus Week 6 tracker cases. They do not prove production SQL execution, Microsoft permission grants or Azure availability.

## Remaining acceptance gates

- Expanded Django/database integration: **BLOCKED / NOT RUN**. The repository runner provisions schema/data, which AGENTS.md prohibits. Owner-run verification remains necessary for applicable curriculum Teams/attendance suites and connected coach/learner integration suites in an explicitly authorized isolated environment.
- Live Teams, Azure transfer/playback and deployed browser validation: **NOT RUN**. No verified database-backed server was started.
- Repository type-check and lint remain failed as recorded above; unrelated files were preserved.
- Owner deployment/restart is still required. Deploy backend and frontend together, then allow the first HTTP request to start automatic processing. Existing archive/job tables and Graph/Azure credentials are prerequisites; this change requires no new SQL. A deployment using the existing external scheduler can disable only the new periodic loop with `SESSION_RESULTS_AUTOMATIC=false`. No runtime environment was changed here.

Automatic probes occur every 60 seconds after a pass, with the existing five-minute minimum between completed-series checks. Microsoft may publish attendance, recordings and transcripts separately. Manual dispatch has two concurrent slots per serving process; overflow stays in the durable queue. The web service must remain running and support background threads. Existing database leases and retry/backoff continue to govern crash recovery and failures.
