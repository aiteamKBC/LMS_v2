# Coach calendar recordings: SharePoint only

The Curriculum workspace opens `/curriculum/coaching-recordings`; the coach workspace opens `/coach/recordings`. Both use the same screen. Curriculum access can select registered LMS coaches; coach access is limited to the signed-in coach. The learner popup reads the selected coach's current LMS caseload, bookings and MCM/PR completion states.

Every Microsoft calendar event keeps its original title, whether or not it matches an LMS booking or learner. **Ready to action** is the initial filter and requires an ended meeting with a verified playable Microsoft recording. **Upcoming** shows future meetings; **All meetings** combines the meeting states. Invitations never prove actual attendance.

## One recording source

Coach calendar recordings remain in Microsoft 365 (SharePoint/OneDrive). The authorized LMS endpoint streams the source recording for inline playback or attachment download and supports single byte ranges and seeking. ASGI uses an async iterator to avoid buffering the whole video. App credentials and preauthenticated Microsoft URLs are not exposed to the browser. Authorization, coach ownership, recording identity and occurrence dates are checked on the server.

This workflow does not upload recordings to Azure, read Azure inventory, generate Azure SAS URLs or fall back to an old Azure copy. The existing Microsoft Entra/Azure application still supplies Microsoft Graph authentication; this does not require using Azure Blob Storage. Existing lecture recording/storage workflows are separate and unchanged.

Historical archive job rows and previously copied files are retained. They are not used by this screen, claimed by its workers or deleted automatically. Old `--kind archive` and archive-preparation commands explicitly fail before accessing media/storage. The optional legacy backfill command now always imports metadata only; `--metadata-only` is accepted for compatibility.

## Fast snapshots and evidence

The page uses `background=1`. Each calendar request returns one durable database snapshot without Microsoft I/O; it does not wait for every calendar or recording check. The UI uses pending snapshots immediately. Unchanged pending checks back off from 5 seconds to 2 minutes; new results reset that delay. Completed views revalidate every 5 minutes. Automatic reads pause in hidden/offline tabs and while a meeting drawer is open. Returning resumes the existing deadline: only an overdue check runs immediately, and repeated focus events do not add requests. Identical in-flight reads share one request, including development StrictMode remounts; completed reads are not cached in the client and still revalidate authorization on the next check. Refresh calendars remains immediate and is disabled while a calendar read is already running. A transient refresh error retains the last visible results with an explicit error and backs off from 1 to 5 minutes; access revocation discards them. Pending work is labelled separately from an active HTTP read, without a continuously spinning loader.

Scheduled refreshes of previously successful calendar/recording snapshots do not
mean that initial loading is unfinished. The existing `sync.pending`,
`pendingCalendars` and `pendingEvidence` fields retain their broader background-work
meaning. Additive `initialPendingCalendars` and `initialPendingEvidence` count only
pending jobs that have no successful saved result. The page uses those counts to
choose initial-loading labels and fast polling; maintenance alone uses the quiet
five-minute interval and displays saved results plus the last calendar check.
Clients connected to an older API retain the previous pending interpretation.
Failed accounts remain separate visible issues. Worker budgets, retry deadlines,
provider refresh intervals and saved evidence are unchanged by this distinction.

Live job state, current staff grants, the coach directory, learner ownership and bookings are checked on every request. Large last-success calendar/file JSON is batch-cached by database, job and success timestamp, so unchanged polling does not repeatedly transfer it from the database. A newer successful job automatically selects a new cache key. A cached month also serves contained day/week requests. A cache outage falls back to the durable database snapshots. An authenticated unchanged response uses HTTP304 before regenerating meeting matches and signed references; changed large responses support gzip. Signed references renew at least every 30 minutes. No user-specific response is reused without current server-side authorization and reconciliation.

Clients that send `X-Coaching-Delta: 1` with a previously authorized snapshot version receive changed meetings and explicit removed-meeting keys rather than the whole month. The client verifies the base version before merging. Fingerprints are isolated by database, current staff identity, grants, roster hash and query, retain at most three versions for two minutes, and fall back to a complete current response if the cursor is missing or evicted. Reference renewal sends fresh tokens. Existing clients without the opt-in header continue receiving complete calendar responses.

There are separate calendar, recording-discovery and on-demand attendance workers, with a global PostgreSQL budget of three active jobs and at most one calendar job, two recording jobs or one attendance job. Thus slow mailboxes cannot occupy all recording-discovery slots. Attendance/report expansion starts only when an authorized user opens a meeting, and cannot block a playable recording. Successful attendance imports preserve the existing actual-report store; a failed attendance read does not replace its saved evidence. There is no archive worker. Workers start only on an explicit authenticated coaching request, not on module import or routine tests. `COACH_RECORDINGS_AUTOMATIC=false` disables web workers when an environment uses its own scheduler.

Calendar windows near the present refresh every five minutes; historical windows refresh daily. Recording metadata refreshes every five minutes for the last two days, hourly for the preceding week and daily for older meetings. Recurring meetings reuse verified meeting-target lookups (10 minutes) and paged recording lists (5 minutes), still filtering each occurrence independently. A successful MP4 availability probe is retained for 24 hours for the same recording ID; actual playback/download rechecks provider identity and content. Source removal or permission failures remain visible at delivery. An unopened attendance report is not evidence of absence.

These intervals bound polling rather than promising instant Microsoft change notifications. The first visit to a previously unseen month still needs a background scan; cached meetings and ready files remain usable while it runs. Invalid Microsoft accounts/mailboxes require account correction and remain separately reported. Directory hashes avoid retransmitting an unchanged coach/learner list, selecting one coach restricts the caseload, and failed checks are never presented as a complete empty calendar.

Provider-confirmed missing calendars, unavailable mailboxes and denied calendar
access share their existing 24-hour retry deadline across that coach's date
windows. Visiting another day does not repeat the same failed mailbox request.
Queued windows pause too; running leases and saved successful data remain intact.
Temporary timeouts/throttling retain their bounded retry behavior. Explicit
Refresh calendars bypasses the pause after an account correction; a newer
successful calendar check clears the older account failure for subsequent reads.
This does not remove LMS coaches, change their email, provision a Microsoft
mailbox or grant app access. Those account issues require an administrator.

All coaches and a selected/own coach use the mini calendar and hourly day/week
calendar; month view remains available. The all-coach day view groups calendars
into named coach columns, four coaches per page, with explicit counts. Column
paging uses already-loaded meetings without calendar/evidence requests. Bounded
week/month previews retain shown/total counts and Show more. Meetings keep their
separate calendar occurrence identities, including invitations in multiple
coaches' calendars. Selecting a meeting opens its recordings/attendance drawer.

The page displays a compact availability summary and explicit partial-result
indicator. Sync & booking details opens the saved errors and LMS booking
comparison on demand without fetching them again. Unmatched bookings are not
proof of cancellation or absence; comparisons remain provisional while calendar
checks run or the snapshot is incomplete. Account corrections and explicit
rechecks remain distinct from ordinary meeting review.

Saved transcripts continue to feed keyword/quality analysis, scoped to the Microsoft event and occurrence. The keyword reader first checks the existing artifact store and can also use the same scoped Coaching Session transcript or a recently verified Microsoft transcript. Keyword analysis itself makes no Microsoft or AI requests. Missing evidence is a prerequisite, separate from a service failure. This change does not rewrite transcripts, review types, bookings, attendance, learner progress or sanctions.

## Setup and operation

Verify the actual database and Microsoft tenant before write operations; never print credentials. Existing nullable-FK snapshot tables must be present. Apply the additive calendar-index migration (which depends on the earlier job and quality-cache migrations):

```text
python manage.py migrate coach_api 0029_coaching_calendar_index
python manage.py backfill_coaching_calendar_index --all-coaches --start 2026-10-01 --end 2026-10-31 --dry-run
python manage.py backfill_coaching_calendar_index --all-coaches --start 2026-10-01 --end 2026-10-31
python manage.py process_coaching_recordings --kind metadata --limit 100
```

A serving process processes queued windows automatically. When web workers are disabled, schedule the metadata processor. `--coach-email` limits it to one registered coach. Failed attempted jobs cause an unsuccessful exit and retain retry state. Old archive rows remain inert; no Azure container or storage preparation is required.

### Prepared calendar index

`CoachingCalendarIndex` records a complete saved window and its successful source
generation. `CoachingCalendarMeeting` stores only the metadata used to display and
match its occurrences: title, UTC dates, cancellation, invited addresses and Teams
join link. Invitation bodies and unrelated Microsoft metadata are omitted. No
video, access token, transcript, booking, attendance history or learner progress is
copied into these tables.

Successful calendar jobs atomically publish their saved generation and its index.
A failed publication rolls back the success update and retains the previous
complete snapshot. A stale worker claim cannot replace the index. HTTP reads use
one joined query for the selected coach/window generations and date overlaps;
successful empty calendars remain distinct from an absent or stale index. Windows
not indexed yet fall back to their retained saved source. Index data is considered
only after the existing current-staff, grants and caseload checks.

`backfill_coaching_calendar_index` prepares existing saved snapshots without
Microsoft requests or video transfer. It requires one registered `--coach-email`
or explicit `--all-coaches`, an inclusive range of at most 31 days, and a maximum
saved-window count (`--limit`, default 100, maximum 500). Dry run performs reads
only. Each window is locked against concurrent source completion and rebuilt
idempotently in a short transaction. It never fetches missing windows or changes
the source jobs, bookings or evidence. Ranges in the examples are explicit;
replace them with the intended period.

This stage improves saved-calendar reads only. Calendar discovery still uses the
existing polling workers, and recording/attendance discovery and delivery keep
their existing authorization. True Microsoft Graph delta synchronization and a
separate continuously scheduled worker remain a later implementation stage.

Optional bounded metadata backfill:

```text
python manage.py sync_coaching_calendar_media --all-coaches --recent-days 7 --time-zone Europe/London --dry-run
python manage.py sync_coaching_calendar_media --coach-email coach@example.invalid --start 2026-10-01 --end 2026-10-21 --time-zone Europe/London
```

Replace the synthetic email. Dry run checks LMS coach/date scope without contacting Microsoft or writing evidence. Local dates are inclusive, maximum 31 days, in the selected business time zone with daylight-saving handling. A limited pass reports the next offset and exits incomplete. Re-run a stable explicit scope for recovery. Neither command creates meetings or invitations or transfers recording files.

## Saved Coaching Session evidence

Opening a meeting first loads recordings and attendance (`part=attendance`).
An available local report does not wait for or query the external source. Missing
local attendance uses an attendance-only source read. Transcript and AI buttons
load `part=evidence` only when opened and reuse that result across the two buttons;
attendance polls do not transfer transcript/report bodies. Each section has its
own correctly scoped source cache. The default combined response remains available
for existing callers. Source reads use the existing `COACHING_SESSIONS_DATABASE_URL`
in a read-only transaction (3-second connection timeout and a bounded statement
timeout). Calendar listing does not query this source. It matches
the calendar owner, event ID and occurrence; a worker-verified online meeting
ID can resolve an organizer's calendar copy. Ambiguous matches are withheld.
Titles, learner names and dates alone never establish identity.

Opening Transcript explicitly opts into `checkMicrosoft=1`. The endpoint first
uses saved Coaching Session evidence, then a local artifact for the same owner,
Graph event and overlapping occurrence, or a recently verified transcript cache.
If none exists, it reads transcript metadata and VTT from Microsoft for the
worker-verified online meeting and occurrence only. Calendar listing, attendance,
AI report preview and keyword checks do not start this provider read. Microsoft
requests are bounded to four metadata pages and five transcript parts. A
30-second budget is checked before additional requests; an in-flight metadata
request retains the existing 25-second Graph timeout, and content has a
15-second timeout and 2 MiB limit per part.
Concurrent reads coalesce within a worker; successful text is cached for ten
minutes, and missing/failed checks for one minute. Cache keys include database,
tenant, owner, event and occurrence. Downloads recheck current authorization and
can recover an expired or different-worker cache using the same explicit flag.
Nothing is written to either database or generated by AI. A Microsoft transcript
does not establish that an original Coaching Session analysis exists; its saved
report state remains separate and visible. Missing, denied and temporarily failed
Microsoft reads remain distinct, with a manual recheck.

The drawer reads the original `dashboard_sessions_cache` evidence after the
meeting/owner/occurrence is verified. Its UTC-based `md5(concat_ws(...))` session
identity is the same one used by Coaching Session. Current learner scope applies
before selecting source rows. Saved dashboard transcripts take precedence; the
existing ingest tables remain a fallback when no original dashboard row exists.
Only completed saved analysis is exposed. The authenticated LMS transcript/JSON
exports remain available. This integration does not generate AI reports,
copy recordings to Azure or modify the source. Coach report scope is checked
against the current caseload's stable Aptem identities on every request;
Curriculum retains its existing all-coach access. Source responses have a
60-second private read cache and source failures have a 15-second cooldown.

When the calendar coach differs from the Microsoft organizer, a report can be
stored under the organizer's normalized meeting row. The resolver also checks
these original dashboard rows using the worker-verified online meeting identity
and UTC occurrence. It requires the dashboard case-owner email to match the
calendar coach, and applies the current learner scope before returning anything.
This also recovers a report when the coach's own normalized meeting copy exists
but has no linked report. Multiple source calendar copies with the same online
identity and exact start are read in one bounded query; differing uncertain
occurrences remain withheld. No name, title or learner/date-only association is
used, and source attendance/ingest ownership rules are not broadened. The private
saved-source cache generation is v4 so old empty results do not survive this fix.

Verified LMS attendance remains authoritative for the drawer. If it is missing,
the matched source's synced attendance reports supply actual participant rows;
overlapping device visits are unioned. Existing LMS reports saved under a native
booking key also remain usable for the same owner, Graph event and occurrence.
No invitation or missing report is treated as proof of absence. Missing,
unavailable and ambiguous saved evidence remain distinct visible states.

## Calendar categories and report presentation

Curriculum lectures are hidden by default, with a local Show lectures / subjects
toggle. Their identities come from existing curriculum occurrences (Graph event
or canonical Teams link and exact UTC times), read in one cached batch. Unknown
subjects are retained under Other. Confirmed coaching bookings keep their known
MCM/PR/Support category; otherwise explicit calendar-title phrases provide a
display category only. A title never establishes evidence or booking identity.
No booking type or scheduled meeting is changed. Category inputs participate in
calendar version checks so a changed curriculum mapping can invalidate a snapshot.

The meeting-type filter starts at All types and presents MCM and PR (Progress
Review) first, followed by Student Support and Other. Calendar collection has no
meeting-type/title filter: unmatched meetings, non-Teams appointments, all-day
events and unfamiliar titles are retained. Types and status are separate filters;
Ready to action still shows ended meetings with playable recordings, while All
meetings includes the other states. Lectures remain an explicit local display
toggle. Neither a missing recording nor a missing learner match removes an event
from the all-status view. Calendar times stay chronological within coach columns.

Transcript and AI analysis now offer Preview PDF and Download PDF in the LMS.
`GET /coach_api/coaching-recordings/pdf` returns actual `application/pdf` bytes
from ReportLab, using saved Coaching Session values and the original report's
branded sections. The source site's Export PDF is browser printing, rather than a
stored PDF endpoint. The local report includes its session context, saved evidence,
AI quality findings, every saved QA quote and an opening transcript excerpt. A
separate full transcript PDF retains every verified turn and available timestamp.
Rendering does not run AI or recalculate sign-off, booking or actual attendance.

Every PDF request rechecks the current role, coach, learner scope, signed occurrence
and selected saved analysis ID. Missing, pending or foreign reports never become
fabricated PDFs. Only a PDF read requests the source's whitelisted session context;
normal evidence/calendar requests do not transfer those extra fields. Source JSON
loaders returning objects or strings are both supported. An explicitly requested
transcript can reuse the verified Microsoft fallback independently of a missing
source AI report. PDF rendering has no network side effects or external assets.

PDF bytes are cached for ten minutes by database, owner, event, occurrence and
complete selected evidence fingerprint. The client fetches one protected PDF on
Preview or Download, validates its MIME and signature, and reuses that blob for
both actions while the section remains open. Closing the section/meeting releases its object URL and
aborts pending reads. Preview opens a separate responsive PDF dialog above the
meeting drawer. Escape closes the PDF first and restores focus to Preview; the
meeting drawer remains open. The existing PDF.js page/zoom viewer renders the PDF itself
in this popup, including mobile browsers, without an external source iframe
or a raw text transcript. The shared viewer retains its learner default label;
coaching passes an explicit accessible label. Download remains a direct .pdf file.
Coaching opts into scrollable zoom up to 400% for readable mobile text. Other
viewer consumers retain their existing zoom range and layout by default. The
popup's Download action reuses the same protected blob without another fetch.

The optional meeting-type/keyword review is closed initially. Opening recordings,
attendance or source report sections does not request this separate local check.
An occurrence missing from Coaching Session is shown separately from a source
outage or an ambiguous match. Its Microsoft transcript can still be reviewed on
the explicit Transcript action. Recording readiness is independent of whether a
source transcript or AI report exists.

MCM and PR show their saved Coaching Session AI report action. Other meeting
types (including Student Support, EPA and optional lectures) show a neutral
"MCM & PR only" explanation instead of an unavailable AI action or a promised
release date. A verified report already returned for a mixed meeting remains
accessible; calendar categorisation never grants or revokes evidence access.
Transcript lookup and PDF preview/download remain available for every category.
Opening Transcript checks Microsoft when no saved transcript exists, including
when the drawer already received an empty saved-evidence result. If an AI source
read is in flight, it completes first; Microsoft is checked only if needed. Reads
are not duplicated when collapsing sections, and they never reload calendars or
attendance. A recording is not proof that a transcript was published. Missing
transcripts, denied reads and source outages retain separate states; another
occurrence's transcript is never substituted.

An empty AI result does not establish denied access. The drawer states that no
saved AI report is linked to the verified occurrence yet, and offers a scoped
saved-report refresh without reloading attendance or calendars. Keep this
distinct from authentication failures, an unavailable source and a genuinely
unfinished saved report. Never fill a missing occurrence with an earlier report
for the same learner, or generate new AI when the user requests an existing PDF.

## Validation limits

Calendar access alone does not establish access to recordings or attendance; check the configured application's effective permissions and organizer access policy if Microsoft rejects evidence reads. A source removed or no longer accessible in Microsoft cannot be played through this page. Events deleted before discovery cannot be reconstructed from unavailable Microsoft data.

Verify the same coach, original meeting title, occurrence dates, actual participants, playback, seek and download after deployment. Confirm that another coach cannot access the recording. Signed references expire; refresh the calendar to renew them. Mocked tests do not prove live tenant availability or full playback in a signed-in user's browser. Diagnose DNS failures separately without changing tenant access or disabling TLS checks.

## Persistent meeting links (24 October 2026)

Calendar rows now include an additive `meetingId` field. The 32-character public
ID is a deterministic digest of normalized coach, provider event ID and UTC
occurrence start, with length-prefixed inputs. It is a locator, never an access
credential. Changing the title or duration does not change it; different coaches
and recurrence starts have different IDs. A rescheduled start requires the new
occurrence link. No new table, data copy, schema migration or Graph call is needed.

The calendar URL preserves the date, view, time zone, coach/learner filters,
status, type, matching filter and lecture toggle. Opening a meeting adds
`meeting=<id>` and `on=<calendar-day-containing-the-occurrence>`; opening its
Transcript or AI section adds `tab=transcript` or `tab=analysis`. `on` is separate
from the week/month anchor date so a Friday meeting can reopen from a calendar
anchored on Monday. Valid IANA zones from another device are preserved. Signed
references, video URLs and report bodies are never written to the browser URL.

Example shape (replace the sample ID by the value returned by the calendar):

```text
/curriculum/coaching-recordings?date=2026-10-20&view=week&zone=Europe%2FLondon&status=ready&meeting=<id>&on=2026-10-23&tab=analysis
```

The same behavior applies to `/coach/recordings`, with the existing coach-only
server scope. Back/Forward restore the selected meeting and section without a
calendar refetch. Status/type/tab changes remain local; date/range/coach/zone
changes retain the existing bounded calendar-read behavior. Closing a drawer
removes only its meeting/tab parameters and preserves filters.

On a fresh direct visit, the page can use:

```text
GET /coach_api/coaching-recordings/meetings/<id>?date=YYYY-MM-DD&timeZone=Europe/London
```

The endpoint checks the current staff grants and coach scope, reads one day
from the existing thin projection and uses the newest complete snapshot covering
that day. An older overlapping snapshot cannot resurrect a removed occurrence.
It returns the verified meeting, coach/learner display metadata, existing media
summary and a newly signed reference. It never queues work or scans Microsoft
calendars. No transcript, AI body, PDF or video is fetched by this endpoint.
Invalid links return 400; absent/moved/inaccessible occurrences return 404;
storage failures return 503. They remain explicit in the UI with Retry/Close.

Client direct-link reads share in-flight requests and use a 15-second cache,
bounded to 12 entries and cleared by the existing global auth invalidation.
Explicit retry invalidates that key. Calendar data already in memory opens its
meeting without this extra lookup. PDF preview/download stays an explicit action.

Verification: isolated SQLite tests cover ID stability, owner/occurrence
separation, newest/empty snapshots, one-query lookup, renewed references, current
role checks and DST boundaries. The actual ORM SELECT was compiled for PostgreSQL
without a connection, then executed read-only through MCP on the verified LMS
project/branch; exactly one existing occurrence resolved. Direct TCP validation
from the execution machine failed due to network reachability, so it was not
represented as a successful local connection or live HTTP test.

Synthetic browser tests use the actual page and BrowserRouter with intercepted
APIs: Refresh preserves the filters/meeting/AI section and renews the reference;
Back/Forward cause zero extra calendar reads. One calendar and one direct-meeting
read occur on reload; PDFs/videos are not fetched automatically. Desktop/mobile
layout was inspected. No live Teams operations, paid AI calls or database writes
were performed for the link feature. No listed Teams file or its shared API was
changed, so Teams baseline/expanded checks are not required for this change.

The Curriculum resolver also retains learners from other coaches when their
addresses are present in the server-saved invitation. It fetches only those
profiles in addition to the current coach's caseload. Coach-only users retain
their existing caseload boundary; URL parameters cannot broaden it.

Local validation for the link feature:

- Backend: **222 PASS**, using the verified private SQLite/LocMemCache runner
  for `coach_api.test_recordings_links`, `test_quality_reviews`,
  `test_recordings_api`, `test_recordings_saved_evidence`, `test_recordings_pdf`,
  `test_recordings_evidence_api`, `test_recordings_response_cache`,
  `test_recordings_index` and `test_recordings_jobs`.
- Frontend: **203 PASS** across 17 files, using
  `npx vitest run src/pages/coaching-recordings src/api/coachingRecordings.test.ts src/api/coachingQualityReviews.test.ts src/pages/learner/monthly-submission/AssignmentPdfPreview.test.tsx src/lib/__tests__/coachFetch.test.ts --maxWorkers=2 --reporter=dot`.
- `npm --prefix frontend run type-check`: **PASS**.
- ESLint on the changed client/page/drawer/evidence/location modules and their
  tests, with `--max-warnings 0`: **PASS**.
- `npm --prefix frontend run build`: **PASS**, with dependency eval/chunk-size
  and plugin-timing diagnostics reported by the existing build configuration.
- `git diff --check`: **PASS**. Synthetic BrowserRouter checks also passed with
  a shared America/New_York URL on a device with a different default zone.

Live Teams: **NOT RUN**. Application PR review/merge/deployment has not been
performed. The responsible Coaching Session maintainer owns creation/linking
of missing AI reports; this link change does not generate or modify them.

## Read-only live verification — 25 October 2026

The existing Microsoft app was used for GET-only calendar reads for all 23
registered coach accounts, limited to 22–24 October in **Africa/Cairo**. All event
IDs in the 18 accessible calendars matched the corresponding saved calendar
projections for that period. Asmaa's calendar contained nine events (four on
22 October and five on 23 October), all present in the saved projection.
This is a bounded-period completeness check, not a claim about all historical
dates or accounts. Four accounts returned calendar-not-found and one returned
mailbox-unavailable; those require account/mailbox correction, not a UI filter.

The verified Coaching Session database contained nine completed saved AI reports
and transcripts for that period. All nine matched an LMS discovery job using the
coach, worker-verified online-meeting identity and occurrence. Three source
reports were stored under a different organizer's calendar copy. There were no
saved dashboard report rows for Asmaa in that period; her playable recordings
do not establish that an Aptem completion/AI report has been saved upstream.

The verification generated no AI, changed no source data, downloaded no video
or PDF, and sent no messages. It did not validate authenticated end-user PDF
delivery, playback, seek or attendance expansion in a live browser. Those remain
separate checks after reviewed deployment. Raw evidence and private runtime
probe inputs are excluded from Git.
