# Staff Responses table

The Responses tab uses one Related activity column for every Feedback type:

- Live sessions: saved lecture title, lecture date and tutor.
- MCM, Progress Review, employer Progress Review and EPA: saved review title and Coach name, without a Completed date inside this cell. Employer responses also identify the related learner unless the form is anonymous. Assigned, Started and Submitted remain separate columns.
- Mid-module and end-module: saved module name.
- Events and RSVP: event title and recorded event date, including legacy display dates.
- General feedback: General feedback. Missing historical context is explicitly marked as not recorded.

Respondent identifies the learner or employer. Existing form/version-family, status and respondent search filters remain; the tutor filter applies to lectures and resets when the selected form changes.

The Coach filter uses review `activity.coachName` values in the selected form/version-family scope. Names are trimmed, deduplicated and sorted. All coaches retains responses with missing names and other activity types; selecting a name shows matching reviews only. The filter hides when the form scope contains no review activity. Changing form resets Coach and Tutor; selecting one of these role filters resets the other. Status and respondent search continue to combine with the selected coach.

Assigned appears before Started and Submitted and uses the recorded assignment time, formatted in Europe/London. It is separate from the activity date and response dates:

- Lectures/modules: the matching learner's delivery recipient `assigned_at`, including historical revoked recipients.
- Learner/employer reviews: the linked review delivery's `assigned_at`.
- General: the earliest matching individual or all-learners assignment, consistent with learner assignment selection.
- Post-event: the later of recipient creation and this form's campaign creation, since the roster is shared across forms. RSVP: recipient creation. These are assignment dates, independent of invitation emails/retries.
- Missing assignment history: Not recorded. No date is fabricated from response start, submission, review completion or mutable update timestamps.

The collection adds optional `assignedAt` alongside `activity` and prefetches assignment records to avoid a query for each response. Detail and PDF payloads remain unchanged.

Only the staff response collection adds optional `activity` context. Existing response fields, the response detail endpoint, detail dialog and PDF export are unchanged. Collection access remains staff-only. The context is read from the response's linked records without synchronization or writes. No SQL or migration is required.

For reviews, `activity.coachName` reads the current imported `"Learner".reviews.reviewer_name` through the saved delivery's `source_review_id`. One parameterized query loads the names for the listed review sources only; duplicate source IDs are read once and non-review lists do not issue this query. Missing/blank names display Coach: Not recorded. This is a read of the source reviewer, not an assignment-time snapshot, and deliberately does not substitute the local overlay's `owner_email` or a learner's current coach. No ownership, completion or delivery rules change.

## Validation — 7 November 2026

From the repository root:

```powershell
npm --prefix frontend run type-check
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend test -- --run --maxWorkers=1 src/pages/engagement/feedback/page.test.tsx src/features/feedback/feedbackResponsePdf.test.ts src/api/feedback.test.ts src/features/feedback/FeedbackDashboard.test.tsx src/features/feedback/FeedbackInsights.test.tsx src/pages/learner/feedback/page.test.tsx src/pages/learner/feedback/form/page.test.tsx src/pages/employer/EmployerFeedbackPage.test.tsx
```

Type-check, lint and build passed. The eight frontend suites passed **77 tests**. Build warnings report dependency `eval`, large chunks and plugin timings; they did not fail the build.

From `backend`, using verified SQLite-only settings and mocked database/external operations:

```powershell
.\.venv\Scripts\python.exe manage.py test engagement_api.tests_response_activity engagement_api.tests_epa_feedback_schema engagement_api.tests_feedback_visibility engagement_api.tests_review_feedback engagement_api.tests_employer_feedback engagement_api.tests.FeedbackValidationTests engagement_api.tests_module_feedback engagement_api.tests_event_feedback engagement_api.tests_post_lecture_bank engagement_api.tests_public_lecture_feedback engagement_api.tests_feedback_question_scoring engagement_api.tests_feedback_analytics --settings=config.settings_sqlite_test --noinput
```

**282 tests passed**, including context for all types, anonymous employer identity, staff-only collection access and unchanged default response payloads.

Chrome inspection used the local production preview with all API calls mocked and external requests blocked. All ten types rendered, the tutor filter reset/hid for EPA, the response dialog opened with Export PDF, and the mobile table scrolled within its container. No browser runtime errors were observed. This does not verify live application data.

Teams baseline and expanded Teams checks: **NOT REQUIRED**; no Teams files or their consumed contracts changed. Live Teams: **NOT RUN**. No application database changes or deployment were performed; review and deployment through merged main remain outstanding.

## Assigned column follow-up validation — 7 November 2026

```powershell
# From backend; verified SQLite-only settings and mocked I/O.
.\.venv\Scripts\python.exe manage.py test engagement_api.tests_response_activity engagement_api.tests.FeedbackValidationTests engagement_api.tests_post_lecture_bank engagement_api.tests_review_feedback engagement_api.tests_employer_feedback engagement_api.tests_module_feedback engagement_api.tests_event_feedback --settings=config.settings_sqlite_test --noinput

# From the repository root.
npm --prefix frontend test -- --run --maxWorkers=1 src/pages/engagement/feedback/page.test.tsx src/features/feedback/feedbackResponsePdf.test.ts src/api/feedback.test.ts
npm --prefix frontend run type-check
npm --prefix frontend run lint
npm --prefix frontend run build
```

Backend: **178 passed**. Frontend: **25 passed** across three suites, including assignment vs activity/start/submission dates, missing dates and British summer-time formatting. Type-check, lint and build passed, with the same dependency/chunk/timing warnings described above. The changed test file also passed a final direct ESLint check after its tutor assertion was scoped to the activity cell. Chrome inspection with mocked APIs displayed all eight headers, nine recorded assignment dates and one missing-history label without browser runtime errors. No SQL, application database writes or deployment were needed. Teams checks remain NOT REQUIRED and Live Teams NOT RUN.

## Coach display follow-up validation — 7 November 2026

The user selected Coach only under the review title, retaining Assigned, Started and Submitted without adding a Review completed column. The same five commands in the Assigned follow-up above were rerun: **181 backend tests passed**, **25 frontend tests passed**, and type-check, lint and build passed. The additional backend cases cover one source-name query for the listed review IDs, no query for non-review/unlinked responses, missing names, correct name-to-review mapping and unchanged default detail payloads. Frontend cases cover all four review feedback types, missing Coach names and absence of Completed inside their activity cells. The initial backend run exposed a test-only connection mock teardown error; replacing the module's connection reference with a mock preserved Django's database access guard and the full rerun passed.

Chrome inspection of the local production build with all APIs mocked confirmed Coach names for MCM/PR/employer PR, Coach: Not recorded for a missing EPA name, unchanged eight column headers, and retained lecture date/Tutor. No browser runtime errors were observed. The build emitted the dependency/chunk/timing warnings already documented. `git diff --check` passed. Live source database data was not accessed or changed, and no SQL, migration or deployment was performed. Teams baseline and expanded checks remain NOT REQUIRED; Live Teams NOT RUN.

## Coach filter follow-up validation — 7 November 2026

Only the staff Responses table, its existing tests and this document changed for the filter follow-up. No API/backend/schema changes were needed. From the repository root:

```powershell
npm --prefix frontend test -- --run --maxWorkers=1 src/pages/engagement/feedback/page.test.tsx src/features/feedback/feedbackResponsePdf.test.ts src/api/feedback.test.ts
npm --prefix frontend run type-check
npm --prefix frontend run lint
npm --prefix frontend run build
```

The three frontend suites passed **27 tests**. Added cases cover all four review feedback types, sorted unique trimmed names, missing names, independent non-review activity, form/version-family switching, mutually exclusive Coach/Tutor selections, status/search combinations and empty results. Type-check, lint and build passed; build warnings are the same dependency/chunk/timing categories documented above. Chrome inspection with mocked APIs confirmed three matching reviews for a selected coach, hiding/resetting Coach for a lecture form, returning to All coaches, and wrapped mobile controls with no runtime errors. `git diff --check` passed. Backend tests were not rerun because no backend code or contracts changed. Teams baseline and expanded Teams checks: NOT REQUIRED. Live Teams: NOT RUN. No database writes, SQL or deployment were performed; review and deployment through merged main remain outstanding.
