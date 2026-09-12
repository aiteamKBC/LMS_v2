# Learner data and media verification — 12 September 2026

The audit covers the existing 369 learner records. Their course and completion
reconciliation remains in [the progress audit](learner-legacy-progress-audit.md).
There are 367 verified original-LMS identities, one native-only learner, and one
unresolved original identity (Ellis, enrolment 275). That identity has not been
guessed or reassigned. The previously reported conflicting quiz definition also
still needs programme-team confirmation.

## What was checked

- Refetched content from all 54 source API pages, retaining only the content
  inventories of the 103 courses relevant to this roster: 9,789 distinct source
  activities. Source learner answers and credentials are omitted from this cache.
- Matched every learner's current module IDs and legacy course/activity IDs to
  their media links. The CSV contains one row for each of the 369 learners.
- Listed the curriculum blob container and checked every distinct upload used
  by their assigned native modules: **1,630 files, none missing or empty**.
  This verifies storage presence and size, not that every page of every file has
  been visually inspected. Two missing uploads and one empty upload elsewhere
  in the wider catalogue are outside these learners' assigned modules.
- Opened real curriculum PDF, PPTX, DOCX, XLSX, MP3 and legacy DOC content using
  the production React viewers. PDF and slide paging worked, documents rendered,
  and actual MP3 playback advanced. YouTube and Spotify showed their provider
  players. Screenshots and the private browser results are under the ignored
  `.cache/legacy-progress-audit/` directory.
- Checked original external links with bounded HTTP GETs and retained response
  status, content type and framing headers. These include reading references
  as well as media: a failed reference link is not automatically a broken lesson.
  See the JSON/CSV report for coverage and outstanding source checks.
- Completed **7,277 HTTP checks**, consolidating provider URLs by verified file
  or video ID. The final batch skipped hosts that rate-limited requests
  (`drive.google.com` and `www.quinnmethod.co.uk`); their remaining links are
  explicitly marked unverified rather than passed.

## Fixes made

**Drive videos with downloads disabled.** The original Drive file tested allows
its preview to load but refuses download access. The native video stream therefore
failed and previously left a black player. `VideoPlayer` now falls back to the
same file's Drive preview after a stream error, retaining its resource key. The
preview and its controls were visually verified. The isolated browser did not
confirm advancing Drive playback; that remains an external-provider limitation
to check in a browser with the user's normal Google access. No playback time or
completion is invented by entering the fallback.

**Authenticated Office uploads.** Legacy Word documents now use the existing
authenticated `?preview=1` upload route. That route supplies Office with a
temporary read URL, so Office can render the private file. The actual two-page
Financial Appraisal DOC rendered successfully in the browser. PDF and PPTX
continue using the existing local document renderer, while DOCX/XLSX retain
their existing inline parsers.

## Limits and outstanding checks

**Seven source attachments are confirmed missing, affecting 16 learners.** Each
was retried using a fresh material-schema response. The original API labels
these attachments `available`, but its actual file endpoint still returns 404.
The expected attachment IDs have no blob copy in our curriculum container.

| Source activity | Attachment | Course | Learners affected |
| --- | --- | --- | --- |
| 80164 | 80163 | Marketing Essentials Certificate (51561) | 1 |
| 80166 | 80165 | Marketing Essentials Certificate (51561) | 1 |
| 80169 | 80168 | Marketing Essentials Certificate (51561) | 1 |
| 80172 | 80171 | Marketing Essentials Certificate (51561) | 1 |
| 145457 | 145456 | Charl-Social Media (125589) | 15 |
| 145460 | 145459 | Charl-Social Media (125589) | 15 |
| 145465 | 145464 | Charl-Social Media (125589) | 15 |

These are four Marketing Essentials documents/decks and three Social Media
revision PDFs. Their exact filenames and enrolment IDs are in the JSON report,
and the CSV flags the affected students. The original files need restoration
at the source or replacement with verified copies. A similarly named document
under a different attachment ID was not substituted on filename alone.

Google returned HTTP 429 during bulk checks. Its batch was stopped; subsequent
checks skip a rate-limited host rather than continuing to request it. A 200
response only establishes that a source answered: it does not prove that its
video played, that a private resource is available to every student, or that an
external website permits framing. The report deliberately distinguishes stored
files, reachable links, rate-limited links, errors and untested URLs. Alternate
Drive/YouTube URLs for a checked file/video ID are labelled separately as
`same_provider_resource_reachable`; they are not claimed as exact-URL iframe
tests. Drive resource keys remain part of that identity.

Learner activation, invitations and completed/not-completed records were not
changed by this media audit. The eight current Aptem Withdrawn statuses remain
covered by their separate status integration and tests. No database writes,
migrations, commits, pushes or invitations were performed.

The browser checks use an isolated page importing the real components and real
file bytes. Platform API writes are blocked. They do not constitute a signed-in,
end-to-end check of every learner account; existing ownership and access tests
cover those gates without creating sessions or writing learner records.

## Validation and repeatability

- 440 frontend tests passed, including all 369 learner progress fixtures,
  material completion, Drive fallback and document URL routing.
- 128 backend tests passed with every Django database alias replaced by an
  in-memory SQLite configuration. No test database creation or migrations ran.
- The isolated My Learning page check passed at 1920, 1440, 1024, 768, 390 and
  320 pixels, including opening a lesson.
- The full TypeScript check still reports the pre-existing errors in MonthList,
  AccessPanel's test, SessionsTree, teams-meetings, historicalEvidence's tests
  and the CreateEmployer/CreateUser modals. It reports no errors in the changed
  player or document-routing files.

Reports:

The final learner-scoped inventory has 11,913 distinct media/reference URLs:
2,864 resolve to verified non-empty storage, 5,126 answered successfully,
355 have a checked equivalent provider file/video ID, 3,464 remain unverified
because their providers rate-limited requests, and 104 returned an error or
could not be verified. These are URL counts, not numbers of students or
distinct uploaded files. The seven missing attachments above are the confirmed
source-file subset of those outstanding checks.

- `reports/learner-media-verification-2026-09-12.csv`: per-learner coverage.
- `reports/learner-media-verification-2026-09-12.json`: resource references and
  coverage states, omitting signed source URLs and API credentials.

After preparing the progress audit caches, run from `backend`:

```powershell
.venv/Scripts/python scripts/audit_learner_media.py --database --fetch --inventory --storage --probe --recover_missing --report
.venv/Scripts/python scripts/audit_learner_media.py --browser_fixtures
```

Then, with the frontend dev server on port 3000, from `frontend`:

```powershell
node scripts/learner-media-smoke.mjs
```

The media audit resumes existing source-page and HTTP caches. Previously
rate-limited providers remain explicitly unverified. It never treats elapsed
time or a successful request to another source as proof that those links work.
