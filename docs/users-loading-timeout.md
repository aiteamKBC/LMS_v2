# Recurring Users directory timeout — 12 September 2026

The local Django ASGI server was deadlocked, causing the Users page's existing
45-second request deadline to expire. Retrying the page could not recover the
server. The fix pins `asgiref==3.12.1` in `backend/requirements.txt`; the backend
virtual environment was updated and the local server restarted on port 8000.

## Evidence

- Both direct requests to port 8000 and requests through Vite on port 3000
  timed out. Even anonymous requests and `/favicon.ico` stopped responding.
- A read-only stack inspection of the running process showed its event-loop
  thread blocked in `ThreadSensitiveContext.__aexit__ → executor.shutdown →
  threading.join`. Synchronous middleware workers were waiting for that same
  loop in `AsyncToSync → CurrentThreadExecutor.run_until_future`.
- The installed dependency was `asgiref 3.11.1`. The official
  [asgiref changelog](https://github.com/django/asgiref/blob/3.12.1/CHANGELOG.txt)
  records the matching executor-shutdown deadlock fix in 3.12.0; 3.12.1 retains
  it. No custom thread-pool patch or middleware rewrite is needed.
- Separately, a transaction explicitly marked `READ ONLY` retrieved 369
  learner directory rows in 0.455 seconds (about 190 KB of JSON), account flags
  in 0.068 seconds, 75 staff in 0.079 seconds and one employer in 0.068 seconds.
  These are data-read timings, not authenticated HTTP response timings.

## Verification

`backend/config/tests_asgi_disconnect.py` runs isolated subprocesses because
an event-loop deadlock would also prevent an asyncio timeout from firing.
It covers a cancelled sync worker returning to the async response handler,
and a real Django ASGI disconnect followed by a successful second request.

- Before the upgrade, the cancellation reproducer deadlocked and failed its
  external timeout. After the upgrade, both regression tests passed.
- 13 focused tests passed:

  ```powershell
  .\.venv\Scripts\python.exe manage.py test config.tests_asgi_disconnect config.tests_observability learner_api.tests_directory --verbosity 1
  ```

- `python -m pip check` reported no broken requirements.
- After restarting, six unauthenticated directory requests through Django and
  Vite returned the expected 401 in 0.011–0.201 seconds. These probes verify
  server responsiveness and the authentication boundary, not the signed-in UI.
- The broader `login.tests_api_gate` suite has six existing errors: learner
  fixtures lack `is_active` required by the old-OTJH access gate. The same six
  errors were reproduced with 3.11.1 installed in a separate temporary import
  directory; the active server remained on 3.12.1. Those unrelated tests and
  access-control behavior were not changed.

The requirements file retains its original UTF-16 encoding. Other installations
need to install the updated requirements and restart their backend process to
load the fixed library. No database schema or data change is required.
