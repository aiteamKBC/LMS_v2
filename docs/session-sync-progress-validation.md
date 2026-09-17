# Session synchronization progress

Implementation applied to `E:\LMS_v2` after the owner explicitly selected waiting
for the current transfer. A read-only database check confirmed the target job
was `complete`, both recording and transcript were `ready`, and there were zero
running jobs before source changes were copied. Existing uncommitted files were
hash-checked and retained in the isolated review copy. No live sync or upload
was initiated for validation.

## Result

- Staff see an accessible progress bar in both session details and the module
  session list, including the exact session being processed.
- Download and Azure upload percentages come from actual transferred bytes.
  Unknown or inconsistent totals remain indeterminate and show bytes transferred.
  Download completion is explicitly distinct from upload and sync completion.
- The number of discovered files saved is shown separately; undiscovered Teams
  files are not implied to be ready. Failed jobs retain their error and partial
  progress. A completed pass retains the notice about later Teams availability.
- Active sync refreshes saved status every five seconds, with no overlapping
  reads and no polling while hidden/offline. Normal polling remains 30 seconds.
  Refresh buttons show a busy state without remounting playing video.
- Updates older than one minute are labelled as last reported values, without
  falsely declaring the transfer failed or pretending the count is advancing.

## Storage and access

No schema change, migration, environment change or manual SQL is required.
The worker stores a small `lmsArchiveProgress` object in the existing artifact
metadata. It changes only that JSON key, preserving other metadata. Updates are
throttled to five seconds plus stage boundaries. The worker passes its owned
lease; SQL restricts updates to the same series, artifact and running lease.
Readers suppress telemetry from replaced attempts and return only public
counters, type, session number and update time to the existing staff endpoints.
Learner responses do not gain job metadata or progress information.

The upload helper adds an optional Azure SDK progress callback. Existing callers
keep their original arguments, timeouts and overwrite behaviour. Callback thread
database connections are released. Telemetry failures are logged without private
URLs and do not abort media transfer.

Existing in-flight workers cannot publish these newly added counters. Detailed
progress starts with a worker using the updated code. An old response remains
compatible and renders an indeterminate status, never a fabricated percentage.

## Validation

- `npm --prefix frontend run test:teams`: PASS, 71 tests / 9 files, both the
  original baseline, isolated implementation and final applied checkout.
- `npm --prefix frontend run test -- src/components/feature/SessionSyncStatus.test.tsx src/components/feature/SessionResults.test.tsx src/components/feature/SessionRecordingPlayer.test.tsx src/hooks/__tests__/useSavedSessionData.test.tsx src/pages/learner/video-watch/liveSessionResults.test.tsx --maxWorkers=2`:
  PASS, 38 tests / 5 files.
- Direct Python runners, using the existing main checkout's venv with `-B`:
  - `backend/curriculum_api/test_session_results_no_db.py`: 70 passed.
  - `backend/curriculum_api/test_session_transfer_progress_no_db.py`: 10 passed.
  - `backend/curriculum_api/test_session_media_no_db.py`: 9 passed.
  - `backend/curriculum_api/test_session_sync_runtime_no_db.py`: 13 passed,
    including the existing week mapping and repeat-sync resolver cases.
  - `backend/curriculum_api/test_calendar_checks_no_db.py`: 17 passed.
  - `backend/curriculum_api/test_calendar_state_no_db.py`: 27 passed.
  - `backend/curriculum_api/test_calendar_actions_no_db.py`: 33 passed.
  Total: 179 isolated backend tests. Database and external transports are mocked.
- `npm --prefix frontend run type-check`: FAIL, the same 41 diagnostics before
  and after; no new diagnostics. Existing unrelated failures remain.
- `npm --prefix frontend run lint`: FAIL, the same 133 errors and 113 warnings
  before and after, comparing paths and allowing changed line numbers.
- Changed Python syntax: PASS.
- Browser preview: the actual progress component, synthetic fixtures only;
  checked at 1200px and 390px, no mobile horizontal overflow. Screenshots:
  `session-progress-desktop.png`, `session-progress-mobile.png`. In-app Browser
  initialization failed before connection; a separate headless browser rendered
  the isolated preview instead. No user browser session or live LMS was used.
- `git apply --check --ignore-space-change E:\LMS_v2-session-progress\session-sync-progress.patch`:
  PASS against the original working files. The whitespace option handles the
  existing mixed CRLF/LF line endings; patch contents retain prior teammate edits.

Full database integration and live Teams/Azure transfer validation: **NOT RUN**.
AGENTS.md prohibits database-changing tests and live integration side effects
without the specified environment/authorization. No sync job, recording,
transcript, attendance row, meeting or upload was created or changed during tests.

## Reviewable changes

`session-sync-progress.patch` contains only this task's delta over the existing
uncommitted work. `session-sync-progress-manifest.json` records original and
updated file hashes. Recheck hashes before application; preserve any intervening
edits. Preview fixtures and local preview configuration are excluded from the
patch. No commits, pushes, pulls, PRs or deployment changes were performed.

The frontend Teams baseline, feature tests, type-check, lint and focused backend
progress tests were rerun on the applied checkout. The wider isolated backend
suites used the same source bytes as the final applied files. The screenshots
use synthetic data and are not evidence of a newly executed live transfer.
