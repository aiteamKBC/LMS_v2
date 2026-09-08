# Previous learning record / student transition

## Inspected architecture (7 September 2026)

The platform authenticates `login.LoginAccount` through the `kbc_session`
cookie. `subject_type=learner, subject_id` identifies a row of
`enrolment."Created_users"`. A read-only Neon inspection confirmed `aptem_id`
is nullable **text**, `id` is integer and `Email` is text. The stored Aptem ID,
not an ID or email supplied by the browser, selects the historical learner.
Blank Aptem IDs follow the existing new-learner journey. Invalid/ambiguous
links fail closed with a support message.

The existing React shell is `WorkspaceShell`, with shared `Header`, `Sidebar`,
`Panel`, `StatusBadge` and button styles. Authentication uses fetch and React
Router; audit features already use React Query and `signature_pad` is installed.
The enrolment SignaturePad currently produces a typed-name signature, so this
feature adds drawn/uploaded capture without changing enrolment signing.

## Sources of truth

The following tables and columns were checked in the live database using SELECT
only. No schema/data changes were executed.

| Data | Source |
| --- | --- |
| Signed-in student and legacy link | `enrolment."Created_users" (id, Email, aptem_id)` |
| Historical identity, programme, assigned coach | `"Last_audit".learners (aptem_id, learner_id, learner_email, coach_email)` |
| Month activities, notes, accepted hours | `structured_manual_activities.manual_learner_activities` |
| Documents | `structured_manual_activities.manual_activity_documents` |
| Associated results | `"Last_audit".activity_results`, scoped to the historical LMS learner |
| Signatures | `"Audit".monthly_audit_signoffs` |
| Month finalization | Latest `structured_manual_activities.manual_month_finalization_events` (`finalized` / `reopened`) |
| Pending changes | `structured_manual_activities.manual_activity_hours_revision` (`status=pending`) |

The supplied audit paths remain the integration contract. Student/transition
calls are scoped before any historical data is read. They do not invoke the
old `_ensure_*` helpers, which execute DDL even during GET requests. The
finalization table exists in Neon but its URL/view was absent from this checkout.

| Existing path | Transition use |
| --- | --- |
| `GET /audit_api/last-audit/cohort/` | Own learner for a student; assigned, paginated learners for coaches |
| `GET /audit_api/last-audit/manual/summary` | Required months, signatures, completion and live totals |
| `GET /audit_api/last-audit/manual/rows?month=YYYY-MM` | Live read-only activities, documents and linked results |
| `GET /audit_api/last-audit/manual/finalization?month=YYYY-MM` | Current month completion and signatures |
| `GET /audit_api/learners/{aptem_id}/signoff/?month=YYYY-MM` | New student and coach signatures |
| `POST /audit_api/learners/{aptem_id}/signoff/` | Authenticated caller's drawn/uploaded signature |
| `POST /audit_api/last-audit/manual/finalization` | Student Complete, or admin Reopen with a reason |

Staff use `transition=1` and the assigned `aptem_id` to select this contract.
Existing audit workspace requests without that flag retain their handlers.
Student requests always use the protected transition contract, even without
the flag. A student-provided Aptem ID is checked against the session's stored
link; it never selects a different learner. Student activity writes on the
shared rows URL are rejected. The historical `{learner_id}` signoff URL segment
contains the **Aptem ID**, as in the existing audit implementation.

Additional endpoints under `/audit_api/old-otjh/` provide the current student's
summary, explicit start, CSRF token, admin month refresh, and protected files.
GET requests do not create transition records. The frontend sends an idempotent
start POST on first review, including when opening a month bookmark directly.

Only transition metadata and an append-only event log require new tables.
Activity/document rows are never copied. Required months are the actual saved
activity months through **2026-08**, frozen when review starts. New source
months inside that period require an explicit admin refresh; edits to the rows
in existing months are immediately visible. Empty legacy records remain blocked
for coach assistance, rather than granting access through an empty `all()`.

New signatures use a separate programme key and audit version within the
existing signoff table. Historical signatures are neither exposed nor counted.
New images are decoded and re-encoded as PNG, kept in private file storage,
and served only through an authenticated, owner-scoped endpoint. Raw SVG,
oversized/corrupt images, client-selected signing roles and other learners' IDs
are refused. An external data correction does not remove signatures or require
re-signing; each signing event retains its original digest.

Finalization reads the live event table, not the stored snapshot. New
finalization events store only a digest and metadata in `snapshot`, not copies
of activities/documents. A complete month has both new signatures and a latest
`finalized` event. Writes lock the transition record; completing again adds no
duplicate finalization event. No new locks/triggers prevent other systems from
editing historical rows. External `reopened` events are reflected on refresh.
Both existing automatic-import signature checks exclude the new transition
audit version, so these new signatures do not suppress shared-source imports.
The transition's completion is calculated from the live signatures/finalization
events on every request; `completed_at` metadata is recorded by signing/completion
writes and is not used as an access shortcut.

## Deployment and verification

1. Review and manually run `backend/sql/2026-09-07_old_otjh_transition.sql` in
   Neon. There are no Django migrations or automatic schema setup calls.
2. Set `OLD_OTJH_ENABLED=true` in the backend environment after provisioning.
   It defaults off so deploying code before SQL does not interrupt learners.
3. Use the existing private Azure enrolment documents container when Azure is
   configured. Local development stores signatures under
   `backend/private_media/old-otjh`, outside publicly served MEDIA_ROOT.
4. A linked learner lands on `/old-otjh` with LMS and Previous learning record
   cards. LMS opens directly only when every required month is complete and
   signed by both parties. Otherwise it asks the learner to contact their coach.
5. Coaches/super-admins use `/old-otjh/coach`; coaches are scoped to the
   historical learner's assigned coach email and their live Staff_users grant.
6. Verify two separate authenticated accounts, live source edits, rejected
   cross-learner URLs, invalid uploads, pending revisions and repeated Complete.
   GET responses are private/no-store and open pages refetch every 7 seconds.

The backend gate also applies to the batch dispatcher. Tests use mocked
repositories and no database creation, migrations or production writes.

### Local activation check (7 September 2026)

The local backend `.env` now enables `OLD_OTJH_ENABLED=true`. A read-only
check confirmed the linked account is marked `hasLegacyRecord=true` and the
learning API gate refuses access. The owner subsequently explicitly authorized
an exception to manual SQL execution for this provisioning step. The SQL above
was executed against the configured Neon enrolment database in one committed
transaction, creating both metadata tables and their event index. No source
tables were altered. This exception does not change the repository's standing
rules for subsequent database work.

Post-provisioning checks used a read-only transaction: the real account's
summary returned 23 months, zero completed months, and `needs_start=true`;
the summary loaded in 0.63 seconds. Reading the latest available month returned
85 source activities. LMS access now returns 403 `transition_required`, rather
than the earlier missing-table 503. The learner's first portal visit initializes
their review through the existing start endpoint; verification did not submit
signatures or mark any month complete.

The portal renders both cards immediately, including while its summary is
loading or unavailable. A browser check with mocked API responses confirmed
that signed-in login visits and direct LMS bookmarks reach the portal without
requesting the heavy learner-detail API. The real server log measured that
detail request at 18.56 seconds; this check does not claim to optimize the
detail endpoint itself. A duplicate agent-started development server was
stopped; the owner's backend on port 8001 remains in use.

The activation regression checks passed: 72 backend tests without database
setup, 48 frontend tests, and scoped ESLint. Browser verification intercepted
API calls and performed no production writes.

## Initial implementation verification results

- **71 backend tests passed**: 43 transition tests and 28 existing API gate tests.
  Django system checks passed with the local SQLite settings and no DB setup.
- **54 frontend tests passed** across transition, signature capture, route
  access, authentication and existing learner navigation suites.
- Production `npm run build` passed. Targeted ESLint on every changed frontend
  source file passed with zero warnings.
- The full repository lint still reports **104 errors and 83 warnings** outside
  these changes. Full TypeScript checking reports four existing errors:
  `SessionsTree.tsx:693` (duplicate JSX prop), `teams-meetings/page.tsx:1106`
  (duplicate property), and `video-watch/page.tsx:594,597` (`lastAudioTickAt`
  undefined). No transition feature type errors were reported.
- Eleven source-query checks passed against Neon inside a **read-only**
  transaction, using nonexistent test identifiers. No records or credentials
  were printed, and no writes or SQL provisioning were executed.
- Headless Edge checked the actual built React application at desktop 1440px
  and mobile 390px: login redirect, both cards, direct LMS gate, month details,
  drawn signature preview/confirmation, external edits appearing through the
  seven-second poll while preserving the signature, coach list and coach image
  upload. Every API response was mocked; there were no production writes or
  browser JavaScript errors. Screenshots are in the ignored local directory
  `frontend/.cache/old-otjh-screenshots/`.

Run the backend checks from `backend/` without a Django database test runner:

```powershell
@'
import os, sys, unittest
os.environ['DJANGO_USE_SQLITE'] = 'true'
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings'
import django
django.setup()
from django.test import override_settings
suite = unittest.defaultTestLoader.loadTestsFromNames([
    'old_otjh.tests', 'login.tests_api_gate',
])
with override_settings(ALLOWED_HOSTS=['testserver', 'localhost']):
    result = unittest.TextTestRunner(verbosity=1).run(suite)
sys.exit(not result.wasSuccessful())
'@ | & '.venv\Scripts\python.exe' -B -
```

Run the frontend checks from `frontend/`:

```powershell
npm run test -- src/features/old-otjh src/lib/__tests__/routeAccess.test.ts src/hooks/__tests__/useAuth.test.tsx src/hooks/__tests__/useLearnerNavGate.test.tsx
npm run build
```

The feature remains disabled in checked-in defaults; local activation and
the completed, explicitly authorized provisioning are recorded above. A final
end-to-end signing check using separate real learner and coach sessions and
private storage remains a deployment check. Automated browser verification
intercepts writes and does not submit real signatures or complete real months.

## Report interface update (7 September 2026)

The existing `/old-otjh` routes now present a learner journal using the current
KBC shell, panels, typography, theme tokens and shared modal. The design system's
semantic primary action color is retained. There are no new API routes, schema
changes, copied activity tables or production fixtures in this update.

- `frontend/src/features/old-otjh/page.tsx` preserves the two-card portal and
  coach list. Open LMS refreshes the shared summary query before deciding
  whether to navigate or display the transition dialog.
- `TransitionDialog.tsx` shows actual completed/remaining counts, an empty bar
  at zero, the assigned coach and an email link only when valid data exists.
  It navigates to the first outstanding required month. Connection errors have
  a distinct retry state; complete learners enter LMS directly.
- `MonthReport.tsx` provides required-month navigation, the report, a learner/
  coach sign-off table and an explicit completion confirmation. Successful
  completion refreshes the summary and advances to the next outstanding month.
  The backend still decides which actions are allowed.
- `ReportSections.tsx`, `report.ts` and `report.module.css` implement the
  profile, hours summary and grouped activity table. Attachments remain inside
  their activity row, with the existing protected Open/Download endpoints.
  Tablet/mobile rows reflow in the same DOM. Scoped styles override the global
  table minimum width, fixed cell heights and no-wrap behavior for these two
  tables; accessible hidden headers stay inside the workspace scroll area.
- `SignatureCapture.tsx` keeps the current draw/upload/preview/confirm flow.
  A draft retains its starting digest through seven-second refetches, remote
  signature changes, temporary errors and pending revisions. It resets after
  the user's successful save, explicit clear/mode change or month navigation.
  Stored signatures are not invalidated by source edits. Completed months
  remain read-only and continue polling source data.
- Shared `components/ui/ProgressMetric.tsx` correctly renders zero progress.
  `pages/users/components/Modal.tsx` adds a labelled dialog and restores focus
  to an explicitly supplied trigger after an asynchronous check.
- `backend/old_otjh/repository.py` and `service.py` enrich the existing scoped
  responses with the fields below. `api.ts` describes those response fields.
  Regression coverage is in `oldOtjh.test.tsx`, `SignatureCapture.test.tsx`,
  `report.test.ts` and `backend/old_otjh/tests.py`.

### Added report fields and their meaning

| UI/API field | Live source and meaning |
| --- | --- |
| `training_plan_target` | The selected month's entry in `"Last_audit".learners.planned_hours_monthly`, the existing manual audit contract's monthly training-plan target. Only finite, nonnegative values are used. Activity planned hours are never substituted. |
| `total_actual_hours` | Sum of the current nondeleted `structured_manual_activities.manual_learner_activities.actual_hours` for the authenticated learner and month, regardless of acceptance. |
| Accepted actual / Not accepted | Existing backend sums of those rows filtered by `accepted`. They remain separate from activity completion and quiz results. |
| Coach name / `coach_email` | Assigned coach fields on the uniquely matched `"Last_audit".learners` record, exposed through the existing learner/coach authorization scope. |
| `profile.start_date`, `profile.planned_end_date` | `fetching_evidence.aptem_cv_contracts_probe.program_start_date` and `planned_end_date`, matched by the authenticated Aptem ID and exact normalized programme name. Conflicting date pairs produce unavailable values. |
| `profile.first_evidence_date` | Existing audit report definition: earliest valid evidence date on/after the matched programme start, from `fetching_evidence.learner_evidence` with `"Audit".learner_evidence_overrides`, including uploads, excluding deleted/archived and welcome material. An unknown programme start leaves this unavailable. |
| Activity `group_name` | `"Last_audit".groups.group_name`, joined by the activity row's existing `group_id`. |
| Activity `component_name` | `fetching_evidence.evidence_items.component_name`, only for an exact `ev:<evidence_id>` reference scoped by the same Aptem learner ID. |
| Activity `ksb_codes` | Explicit `evidence_items.ksb_codes`, or the activity's `"Last_audit".activities.raw.live_lms_component.ksbs` mapping. Codes are validated and deduplicated; titles are never used to infer codes. |
| Activity `duration_minutes` | Existing audit `_duration_min_sql` definition on `"Last_audit".activities`: configured duration, with its validated audio metadata fallback. This describes content length, not accepted learner hours. |
| Actual/planned duration display | Original decimal hours formatted once to the nearest minute, with minute rollover. Seconds are not invented from rounded hours. Backend totals are formatted after aggregation. |

No verified page-count field or parent/child relationship was available in this
contract. Page badges remain conditional on an explicit value, and activities
are not indented based on title similarity. KSB codes are absent on some source
rows, including the three learner months checked below; these display `—`.
There is no separate "LMS actual" metric because the existing total covers
multiple activity categories; it is labelled "Total actual" in the footer.
Missing profile values and targets display `—`, not a fabricated date or zero.

### Verification of the interface update

- **75 backend tests passed**, without database setup or migrations, including
  gate/batch protection, identity scope, signature roles, external source edits,
  completion, monthly target semantics and explicit KSB normalization.
- **64 frontend tests passed** across seven suites: the feature, login,
  authentication, route access and the existing CreateStaffModal. The final
  feature-only rerun passed all **24** feature tests.
- Scoped ESLint passed. Production Vite build passed. Full application
  TypeScript checking retains the four pre-existing errors listed above; it is
  not reported as passing. No feature type errors were reported.
- Read-only Neon checks compared the enriched rows with the summary for
  September 2024 (2 rows), August 2025 (21) and July 2026 (85): row IDs were
  unique, row counts matched, and actual-hour totals matched. Duration metadata
  was present on 6 and 25 rows in the latter two months. The selected learner's
  programme dates and first-evidence date were available. These are observations
  at verification time; the shared source continues to change externally.
- Headless Edge exercised the current local React application with scoped real
  read-only response fixtures and intercepted **all** API writes. It verified
  dialog counts, Escape/focus restoration, outstanding-month navigation, actual
  polling with an unchanged canvas/preview, the original draft digest on submit,
  stable workspace scroll position, and unclipped mobile/tablet tables. This
  tests the browser behavior; it does not claim a real signature was submitted.
- Desktop/mobile screenshots are in the ignored local directory
  `frontend/.cache/old-otjh-ui/`: `portal.png`, `dialog.png`,
  `month-desktop.png`, `activity-desktop.png`, `signoff.png`,
  `month-mobile.png`, `activity-mobile.png`, `dialog-mobile.png` and
  `activity-tablet.png`. The local Playwright verification script is
  `verify.mjs` in that directory. Fixtures are never bundled into the app.

## Embedded activities and coach signing (8 September 2026)

The latest request explicitly enables embedded activity content. Clicking an
activity title expands its content inside the report. Only the opened row is
loaded, and only its selected material/document is mounted. Reading/quiz
bundles expose all of the source's referenced parts in their stored order.
Seven-second refreshes keep the active viewer mounted. Document Open buttons
use this viewer; Download still uses the protected original endpoint.

`GET /audit_api/last-audit/manual/rows` now accepts an optional `activity_id`
identifying a **manual report row**, alongside the existing month and transition
parameters. The existing account/Aptem/coach scope is resolved first; the row
must belong to that learner and required month and must not be deleted. The
service then reads only its referenced `"Last_audit".activities` definitions.
This does not call the legacy activity ledger's schema setup or participant
queries. No new route, migration, source copy or database change is needed.

Sources: `video_iframe_url`, `reading_iframe_url`, `reading_text_body`, and
`raw.audio.iframe_url` from the activity definition; `rq:<group>:<id>:...`
references supply bundled parts. The existing `_activity_content_url` helper
normalizes content URLs. Stored quiz attempts use the existing normalized quiz
payload, with `activity_results` restricted to the current historical learner
and exact group. Viewing a past quiz does not create another attempt or add
learning hours.

`ActivityExpansion.tsx` and `ContentPreview.tsx` provide source iframe/media
viewers and document previews. Google links use the existing embed converter;
direct audio/video files use native players. Private PDF/image/media files are
fetched with the existing session and previewed using revocable local blob URLs.
DOCX uses the installed Mammoth browser renderer; HTML is sanitized and placed
in a script-free iframe sandbox. Private files are never published or sent to
an Office/Google conversion service. Unsupported files retain Download, and
external hosts that forbid framing retain an Open in new tab action.

Coach draw/upload already used the shared SignatureCapture component. It is
now explicitly explained in the opposite party's empty signature cell and
covered by coach-route and real-browser tests: the coach signs from their own
account at `/old-otjh/coach`, selecting the learner/month. The learner cannot
submit a coach signature. Completed months remain read-only. Signing and
completion responses now retain protected document URLs, avoiding a temporary
loss of attachment actions until the next poll.

Verification: 79 backend tests and 30 feature frontend tests passed; scoped
ESLint and production build passed. Application TypeScript checking still
reports only the four pre-existing errors documented above. Read-only Neon checks confirmed content for
video, audio, reading/quiz and a three-part bundle. Headless Edge verified lazy
loading, part switching, stable iframes through polling, PDF preview even when
the original response is an attachment, private DOCX conversion, mobile layout, and both coach drawing
and upload/confirmation flows. All browser API writes and external frame loads
were intercepted; no actual signatures or completion events were written.
The local test script and screenshots are in `frontend/.cache/old-otjh-ui/`:
`verify-embedded.mjs`, `embedded-activity.png`, `embedded-document.png`,
`embedded-mobile.png`, `coach-draw.png`, and `coach-upload.png`.

The requested section order is now fixed: Attendance, Activities, Assignments,
then Report sign-off. The grouping helper recognizes attendance by category or
the stored `att:` reference; other non-assignment rows remain in Activities.
It preserves the source order within each group and omits empty groups. The
design handoff prompt is `docs/old-otjh-lovable-prompt.md`.

## Lovable presentation integration — 8 September 2026

Adapted the owner's Learning Journal design from Lovable project
`349261e0-baaf-463e-aac0-24a65f191150`, revision
`3fc59c15d7a051f21d68b6ce0919b82f575fba90`. The source was read through the
Lovable connector; the reference was its portal, month list, report, sign-off
components and stylesheet. No remote project edits or publishing were needed.

The existing portal now has the purple welcome banner, progress ring, two
workspace cards and transition summary. The month cards show the existing
server signature statuses. The report uses a purple learner panel, hour/date
cards, then separate Attendance, Activities and Assignments tables followed by
Report sign-off. Every source row, attachment and metadata field remains
available; grouping and order within each group still use `groupActivities`.

The learner and coach sign-off rows open the existing SignatureCapture in a
compact dialog. Drawing/upload, preview, explicit confirmation, server signer
identity, original draft digest and submission handlers are preserved. Closing
the dialog keeps the draft; reopening restores the drawing, including on a
smaller screen. A normal poll keeps the open canvas and iframe mounted.

Presentation lives in `design.module.css`, `report.module.css`,
`RecordDesign.tsx` and the existing feature components. The shared Modal only
adds an optional `className` for feature styling. Existing KBC navigation,
fonts, authentication and React Router remain in place. Lovable's demo role
switch, mock data, local completion state and TanStack route setup were not
imported. No dependencies, backend, API contracts, database records, access
gates, required month rules or completion permissions changed for this redesign.

Validation: 32 feature tests pass, scoped ESLint passes, and the production
build succeeds. Browser checks used intercepted API responses and cached
read-only source fixtures: portal/locked dialog, zero progress, navigation,
all three report sections, lazy iframe content, private PDF/DOCX previews,
learner/coach draw and upload flows, pending-draft preservation, original digest
submission, keyboard focus and layouts at 1440, 768, 390 and 320 pixels. No real
signature or completion writes were made. Screenshots and browser scripts are
local under `frontend/.cache/old-otjh-ui/lovable-*` and `verify-lovable*.mjs`.

The whole-project TypeScript check still reports the four existing errors
outside this feature: duplicate JSX attribute in
`src/pages/curriculum/programme-detail/SessionsTree.tsx:693`, duplicate object
property in `src/pages/curriculum/teams-meetings/page.tsx:1106`, and two missing
`lastAudioTickAt` references in `src/pages/learner/video-watch/page.tsx:594,597`.

## Content restoration and signing preflight — 8 September 2026

The transition material reader now also reads the original material snapshots
and exact linked evidence. It renders saved quiz attempts in a sandboxed iframe,
preserves bundle parts, and uses the legacy same-group reading companions.
Private Word, PDF, image, media and reflection previews remain scoped to the
learner/month. Office presentations and spreadsheets use the existing audit
Office viewer with a short-lived read URL issued only after authorization.

`GET /audit_api/old-otjh/content-check/?month=YYYY-MM[&aptem_id=...]` checks source
availability in the background, separately from report loading. Signing and
completion require a successful check for the current record digest; the backend
rechecks before any write. The check reports missing material names. Source
requests have timeouts, bounded concurrency, brief caches and an authentication
backoff. No master source key reaches the browser. Stored signatures and completed
months are not rewritten or invalidated.

`GET /audit_api/old-otjh/source-documents/{row_id}/{evidence_id}/{file|report|note}/`
reads only evidence explicitly referenced by an authorized assignment row. Both
this route and the existing document route accept `preview=office` for the
existing Office preview contract. No source attachment copies or database writes
are performed by any of these GET handlers.

Full cohort findings and remaining source/configuration blockers are documented
in `reports/old-otjh-content-review-2026-09-08.md`, with a metadata coverage JSON
and per-row issues CSV beside it. The initial material-schema authentication
failure was resolved by installing the owner-supplied key in the ignored local
backend environment and restarting port 8001. Recovery remains incomplete for
materials whose original source itself returns missing-content responses.

The content reader additionally uses the exact learner/component records in
`Audit.learner_match` (including retained graded quiz bodies) and
`Audit.learner_match_market_research_l4`. It does not import whole learner
structures or replace the arranged ledger. Shared definition edits take
precedence over old material snapshots. A fallback never selects another
learner's answers or a conflicting group-specific attempt.

`GET /audit_api/old-otjh/material-documents/{row_id}/{material_id}/?month=YYYY-MM`
serves an existing source backup only when the authenticated learner/assigned
coach may read that month, the active row explicitly references this material,
and the source marks its non-empty backup available. Original source API and storage
credentials remain server-side. The browser previews the file inside
the same activity section. Availability checks verify backup existence when it
is needed as a fallback; no new backup or database row is created.

Provider URL handling is scoped to this feature in `previewUrl.ts`: Drive access
keys, Docs sheet selection, YouTube start points, Spotify players, Vimeo unlisted
hashes and Office document viewers. The source check also verifies the original
KBC file behind Office URLs, rather than accepting a successful Office shell as
proof that its file exists. Read-only recovery verification covers 158 additional
quiz rows; seven existing source PDFs were checked readable, with 382 arranged
rows able to use those files as fallbacks. Current validation is 95 backend and
51 frontend tests, scoped lint and production build; the four existing unrelated
TypeScript errors remain.


## Source-wide preview verification (8 September 2026)

The PDF adapter unwraps Office URLs using source content type even when the
actual signed endpoint has no filename extension. Native PDF frames omit the
plugin-blocking sandbox; Office frames specifically permit their renderer's
form submission. Quiz definitions and actual saved attempts are separate API
fields; definitions alone cannot satisfy the signing content check.

`live_attempts.py` reads missing original quiz answers directly. The source API
supports pagination, not email/student filters. `source_page_hints.json` is a
routing optimization containing IDs/page numbers only. The returned learner ID,
group and activity must match before answers are used. A 30-second process cache
contains linked learners only; no source data is imported or persisted. Source
page movement beyond the checked neighbours fails closed and requires refreshing
the routing hints. Primary shared-table answers remain authoritative.

ZIP members, OpenDocument files and files with incomplete MIME/extension metadata
have additional inline previews. Large archives are limited to 50 MB inline;
unsupported members and Outlook messages keep original downloads. The complete
cohort coverage, network/storage checks, actual browser verification and remaining
source gaps are documented in `reports/old-otjh-content-review-2026-09-08.md`.

## Record signing and live updates (8 September 2026)

The owner changed the completion rule: the learner's signature completes the
previous learning record. A coach signature is optional and must never be
invented or copied from the learner. The following behavior supersedes the
earlier requirement for both signatures and a separate completion action.

**Sign all months** appears in the month list and inside every month report for
writers. Record monitoring stays read-only. The capture opens immediately using
the already loaded required month list. It accepts one drawn or uploaded image,
shows a preview and asks for confirmation covering the entire record. It does
not fetch individual months, download materials, call signing readiness checks,
or wait for the current report's material check. Included months can be viewed
in a collapsed list; the signature controls are available immediately.

`POST /audit_api/old-otjh/sign-months/` accepts multipart fields:

- `months`: a JSON array of `YYYY-MM` strings covering the entire required scope.
- `signature`: the PNG/JPEG capture, sanitized and re-encoded on the server.
- `confirmed=true` and `capture_method=draw|upload`.
- Coaches select the existing authorized `aptem_id` query scope. Learner identity
  and signing role always come from the authenticated session.

Older payloads containing per-month snapshot objects receive a refresh-required
error. The old readiness GET is retained for compatibility but is not used by
the current capture UI.

Saving validates the complete month scope again under the learner transition
lock. A changed required list rejects the request so the user can refresh and
confirm the new scope. Each outstanding required month receives the learner's
signature where missing and a finalization event. The month and overall record
become Complete immediately, timestamps are saved, and LMS access opens. Already
complete months and saved signature images are preserved on retries. A coach
capture alone does not complete an unsigned learner record.

Bulk signing intentionally does not block on missing materials, missing source
rows or pending activity revisions. These source conditions remain visible;
they are not altered or marked resolved. The signing/finalization audit metadata
records `material_check_performed: false`, `completion_rule: learner_signature`
and a monthly-summary receipt. It does not claim that document availability or
individual activity bodies were verified. The existing individual-month signing
and review actions retain their material checks; Sign all months is available
independently of them.

The capture image is uploaded once and shared only across this learner's monthly
signoffs. Private file authorization allows multiple months with the same
learner and signing role; cross-learner or cross-role ownership is rejected.
Each month still has its own signing and completion audit events. Signature,
finalization, learner-profile and transition updates use one DB transaction.
Failure rolls back the writes and cleans up the new uploaded image. A concurrent
completion preserves the first saved signatures and deletes the unused upload.

The learner's confirmed capture is also saved as a sanitized
`data:image/png;base64,...` string in
`enrolment."Created_users"."Learner_signature"`, with `Learner_signature_name`
and `Learner_signature_saved_at`. It is updated once per successful learner
capture, not once per month. Coaches do not overwrite this learner field.
The existing columns and signoff indexes were verified with read-only queries;
no schema update is required. This saved profile capture never auto-signs
unrelated reports.

The application uses this parameterized profile update when saving:

```sql
UPDATE enrolment."Created_users"
SET "Learner_signature"=%s,
    "Learner_signature_name"=%s,
    "Learner_signature_saved_at"=now()
WHERE id=%s AND ltrim(btrim(aptem_id), '0')=%s
RETURNING id;
```

An open report reads lightweight signature state every three seconds while
active. Signature changes refresh the report and summary, including automatic
completion, without clearing a pending draft. Month/activity data refreshes every
seven seconds, summaries every fifteen seconds, with refresh on focus. The query
provider keeps inactive queries in memory for two minutes across navigation and
resets on account change. Source edits from other systems remain readable.

Validation: 133 backend tests and 73 frontend tests pass. An isolated browser
scenario covers 23 months, both entry buttons, instant capture without any
readiness requests, one learner submission, all-month completion with no coach
signature, LMS access, locked signatures, live coach display and mobile layout.
The capture appeared in 200 ms in that mocked scenario, which is not a guarantee
of production latency. Verification made no real signature, profile or completion
writes. Browser screenshots/scripts are under `frontend/.cache/old-otjh-ui/fast-*`
and `verify-fast-signing.mjs`.

## Assigned coach booking link

The transition dialog supports **Book a session** beside the coach's email
contact. It opens the configured public booking page in a new tab, keeping the
learner's record open. The summary exposes only the assigned coach's
`coach_booking_url`, resolved by their current `Last_audit.learners.coach_email`.
Changing the source assignment changes the link on the next summary refresh.
Names are never used to guess a booking URL.

The college-supplied 13-coach catalogue is stored at
`backend/old_otjh/data/coach_bookings.json` and ships with the backend. Each entry
retains the supplied website `id`, name, slug, booking page and all four
session-specific link fields (including nulls and query strings). The website
IDs are not enrolment staff IDs. An added `email` field was verified against the
source coach records, including Adey / Adeyemi Adeshina and the two separate
Omar coaches. Only exact, case-insensitive email matching is used at runtime.

**Book a session** opens the coach's `booking_page_url`, where the learner can
choose the session type. This requires no environment setup, SQL or Graph
connection after deployment. Include the `data` directory when deploying the
backend. The other session URLs remain available in the catalogue for future
use; they are not replaced or inferred.

Optionally set `OLD_OTJH_COACH_BOOKING_URLS` in the backend environment to a JSON
object to override individual coaches' URLs. A matching override takes priority;
a null value disables that coach's booking link. Other coaches continue using
the bundled catalogue. Example (illustrative values only):

```dotenv
OLD_OTJH_COACH_BOOKING_URLS={"coach@example.org":"https://example.org/book/coach"}
```

Restart the backend after changing the catalogue or environment setting.
Unknown coaches, malformed or ambiguous configuration keep the email fallback;
no placeholder booking button is shown. Link resolution adds no database or
network requests. No credentials are sent to the frontend. Existing coach
assignments, activity data, signing and completion rules are unchanged.

Read-only verification on 8 September 2026 matched all 368 active enrolment-linked
learners to a configured coach page, with zero unmatched coach emails. All 13
supplied records and their original URL fields were preserved. The learner
summary was checked against the real source and the dialog was exercised with
that response in an isolated browser. Backend tests: 140 passed; focused frontend
tests: 8 passed. Verification did not book any appointments or write database data.
