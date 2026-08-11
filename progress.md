# Progress Report

Last updated: 2026-08-11

## Requested work

The following requirements were applied to the LMS audit project:

1. Attempted quizzes must return the questions, the learner's answers, the correct answers, the score, and the pass/fail result.
2. Unattempted quizzes must not expose questions, answers, or solutions.
3. Opening a quiz activity must display its body from the learner/student perspective.
4. The Training Plan must be returned completely, exactly as available in the source data, without dropping additional fields.
5. Monthly Activity must provide Add and Edit actions for all activities, including activities originating from `Last_audit`.

## Backend changes

### Quiz activity details

- Preserved the distinction between attempted and unattempted quizzes.
- Attempted quiz responses include the quiz body, questions, learner-selected answers, correct answers, score, and pass/fail information.
- Unattempted quiz responses return the `not_attempted` state and do not include quiz questions, answers, solutions, or an attempt body.
- Added test coverage confirming that attempted quiz question data is merged correctly.
- Extended test coverage confirming that unattempted quizzes do not expose restricted quiz content.

Relevant files:

- `backend/audit_api/last_audit_ledger_views.py`
- `backend/audit_api/test_last_audit_ledger_views.py`

### Complete Training Plan payload

- Updated Training Plan normalization so that the complete original source payload is preserved.
- Each normalized module now includes its complete `components` object and its original `raw` object.
- Each normalized month includes its original `raw` object.
- The complete Training Plan response includes the full original source under `raw`.
- Deep copies are used so that normalization does not accidentally mutate the source data.
- Added tests confirming that extra fields such as planned hours and due dates remain available.

Relevant files:

- `backend/audit_api/learner_match_ledger_views.py`
- `backend/audit_api/tests.py`

## Frontend changes

### Quiz learner view

- The activity screen displays attempted quiz questions and the learner's submitted responses.
- Correct answers, learner answers, score, and pass/fail status are displayed for attempted quizzes.
- Added clear messaging for unattempted quizzes explaining that questions, correct answers, and solutions are hidden.
- Updated the quiz control wording to `View learner response` and `Hide learner response`.
- Supports both bundled quiz activities and standalone quiz activities.

Relevant file:

- `frontend/src/features/audit/learner-log-pro-copy/routes/activity.tsx`

### Training Plan display

- Extended the frontend Training Plan types to retain complete module components and raw source data.
- The learner profile now displays additional Training Plan fields dynamically instead of limiting the view to a fixed subset.
- Standard fields such as module type and status remain visible.

Relevant files:

- `frontend/src/features/audit/learner-log-pro-copy/lib/api.ts`
- `frontend/src/features/audit/learner-log-pro-copy/routes/learner.$learnerId.tsx`

### Monthly Activity Add and Edit

- Enabled `Add activity` from the learner journal.
- Enabled `Add activity` from learner search results.
- Removed the read-only restriction from `Last_audit` activity rows.
- Every activity row now exposes Edit and Delete controls.
- Editing a `Last_audit` row creates a reversible replacement overlay instead of overwriting the original audit source.
- Activities created through the audit interface continue to use normal patch updates.
- Added activities are stored through the overlay endpoint and are included in the live Monthly Activity feed.
- Replaced and deleted overlays are applied when activities are loaded.
- Monthly filters are recalculated after overlays are merged.
- Fixed cohort overlay handling so the `Last_audit` source marker is preserved and activity requests do not incorrectly fan out across the entire cohort.
- Updated cache invalidation so cohort, overlay, and activity data refresh after changes.
- Mapped reading and quiz status fields into the activity table for badges and filtering.

Relevant files:

- `frontend/src/features/audit/learner-log-pro-copy/lib/api.ts`
- `frontend/src/features/audit/learner-log-pro-copy/components/InlineActivityRow.tsx`
- `frontend/src/features/audit/learner-log-pro-copy/routes/journal.index.tsx`
- `frontend/src/features/audit/learner-log-pro-copy/routes/search.tsx`
- `frontend/src/features/audit/learner-log-pro-copy/lib/lastAuditRequests.test.ts`

## Verification completed

### Backend tests

The focused backend test run completed successfully:

```text
python manage.py test audit_api.tests.AuditTrainingPlanTests audit_api.test_last_audit_ledger_views.LastAuditLedgerMappingTests --verbosity 1
14 tests passed
```

### Frontend tests

The focused frontend request and overlay tests completed successfully:

```text
npm test -- --run src/features/audit/learner-log-pro-copy/lib/lastAuditRequests.test.ts
8 tests passed
```

### Frontend build

```text
npm run build
Build passed; 3257 modules were transformed.
```

### Live data verification

- Attempted quizzes found: 31,796.
- Unattempted quizzes found: 57,303.
- Attempted quizzes containing answer bodies: 30,949.
- Unattempted quizzes exposing answers: 0.
- A live attempted quiz returned HTTP 200, state `attempted`, an attempt body, and 30 questions.
- A live unattempted quiz returned HTTP 200, state `not_attempted`, no attempt body, and zero questions.
- A live Training Plan sample retained all 26 months and 141 modules.
- The normalized Training Plan's `raw` value matched the complete original source.

### File validation

- `git diff --check` passed for the files changed as part of this work.
- The only messages were Windows LF-to-CRLF conversion warnings; no whitespace errors were reported.

## Existing limitation in source data

- There are 580 learner-match records in the checked data.
- 519 records contain a source `aptem_training_plan`.
- 61 records have a missing or empty `aptem_training_plan` in the source.
- The application now returns the complete Training Plan whenever source data exists, but it does not fabricate a plan for records where the source contains no plan.

## Broader test-suite note

A broader backend run contained four pre-existing failures in `AptemLmsAuditPayloadTests`. Those tests use `SimpleTestCase`, while the currently modified audit payload code calls `_fetch_monthly_hours`, which accesses the database. This issue is outside the focused quiz, Training Plan, and Monthly Activity changes described above. The targeted backend and frontend test suites for this work pass.

## Current delivery status

- The changes are implemented in the local workspace.
- No database records were modified during live verification; those checks were read-only.
- No commit, push, or production deployment has been performed.
- The changes must be deployed to the target environment before they become visible there.
