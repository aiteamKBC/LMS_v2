# Previous learning content review ? 8 September 2026

Reviewed all **101,735 arranged report rows for 368 linked learners**, through
August 2026. SQL and source/storage requests were read-only. No source rows,
signatures, finalizations, database schemas, or migrations were changed.

## Changes applied

- PDF source endpoints often have no `.pdf` extension. They were incorrectly
  sent to Office, which displayed ?File not found? even though the PDF existed.
  The reader now unwraps the actual PDF URL and uses the browser's PDF iframe
  without the sandbox restriction that blocks its native renderer. This viewer
  applies to **30,320 arranged PDF rows** in the coverage snapshot.
- Office's Word, PowerPoint and Excel renderers submit a form inside the iframe.
  Forms are now allowed specifically for the Office viewer, resolving its blank
  inner frame. Other external frames retain their existing form restriction.
- Video/audio previews permit the providers' media playback capability. Existing
  Drive resource keys, YouTube timing, Spotify embed and Vimeo handling remain.
- Source checks verify the file behind Office and the audio behind KBC's audio
  player, reject empty lesson/login/homepage responses and inspect the specified
  SharePoint source. Current material URLs, authored source bodies and existing
  verified backups provide fallbacks for the same material identity.
- The original source was paginated completely: **54 pages**, containing all
  368 linked learners. It exposes **728 additional graded quiz attempts for
  128 learners** beyond the shared table's saved answers. The reader now fetches
  missing attempts directly by exact learner, group and activity IDs. One real
  end-to-end resolver check recovered a 14-question attempt from the live API.
- The API ignores `student_id` and `email` filters. Both the new reader and the
  existing learner schema proxy now filter returned data locally. No first-row
  assumption or cross-learner/group answer substitution is permitted.
- Original quiz questions/options can be displayed separately when a saved
  attempt is absent. Source solutions are never presented as student answers.
  A score without saved answers does not pass the content gate.
- The existing seven verified source PDFs and 158 retained quiz-row recoveries
  remain available. Explicit missing reading companions now stay visible, and
  the completion check includes the same companion materials as the preview.
- ZIP evidence now has a file selector with inline previews for supported
  members. OpenDocument text/spreadsheets render inside the report, including
  ODT paragraphs, tables and embedded PNG/JPEG images. File signatures recover
  Office/PDF previews where source filenames or MIME metadata are missing.
- Large archive responses have a 50 MB inline preview limit and stop buffering
  after the limit. Original downloads remain available. File responses expose
  their length so oversized archives can be rejected before full buffering.

## Verification scope

**6,674 unique original material URLs** were requested. Initial results were:

| Result | URLs |
| --- | ---: |
| Actual file bytes verified | 3,347 |
| Authored text verified | 156 |
| External player shell received; playback not established by HTTP | 3,073 |
| Login/homepage redirect | 77 |
| HTTP error | 13 |
| Network error | 4 |
| Embedding denied | 3 |
| Empty lesson | 1 |

A further source refresh inspected 100 affected/reference materials: 40 supplied
file bytes, 29 supplied an external player, and 21 supplied authored text. The
remaining results included unavailable definitions, missing/empty lesson bodies
and empty/missing lesson bodies. These are material-level results, not 90 newly fixed
learner rows. A text fallback is not proof that a missing video itself plays.

All **11,242 distinct blobs referenced by 11,803 linked/projected documents** were
present, non-empty and readable through storage metadata requests. This does
not mean that every arranged assignment has a document: absent references are
reported separately below. The archive/OpenDocument audit read 133 distinct
files: 128 passed integrity/size checks and five exceed the inline preview limit.
Six Outlook `.msg` evidence files remain available as original downloads; they
are not rendered as email messages inside a browser iframe.

Headless Edge tested the actual report shell with intercepted internal API
responses, avoiding real signing/completion writes. It verified saved quiz
questions, stable iframe nodes through polling, mobile layout, both signing
roles, actual source PDF/Word/PowerPoint/Excel/text previews, KBC audio metadata,
and YouTube playback reaching readyState 4. Original ZIP/ODT/ODS/DOCX evidence
also passed browser preview checks. External requests used a clean browser
context, not a user's authenticated Google/Microsoft session.

**An HTTP 200 player shell is not proof of playback.** The entire cohort's
source references were checked, but every external video was not played in a
browser. Provider access restrictions and missing originals cannot be repaired
by substituting unrelated material or invented student answers.

## Remaining source records

The accompanying JSON and CSV identify each affected row, learner Aptem ID,
month and source reference. They contain no API keys, signed URLs, email
addresses or quiz answers.

| Coverage state | Arranged rows |
| --- | ---: |
| Material available through source/fallback | 70,201 |
| Saved quiz available | 8,576 |
| Attendance register record | 9,143 |
| Evidence document/reflection available | 6,240 |
| Quiz with no saved learner answers available | 6,620 |
| Material unavailable | 98 |
| Assignment with no active linked/referenced evidence | 857 |

The 7,575 unresolved rows cover 332 learners and 1,653 learner-month pairs. Some
quizzes may never have been attempted; absence of answers is not evidence that
the student completed them. Original questions remain separately reviewable.

For example, the fresh source viewers for Business Environment Live Session
(51072) and Lecture 6: Agile Troubleshooting (51077) return HTTP 404 with
`kbc_text_lesson_not_found`. APM Book (58260) returns a title-only lesson body.
The actual 108-row November report still has two missing-material issues.
Signing and completion remain paused while the relevant source content check
fails; existing saved signatures/completion events are retained.

## Runtime and checks

The working source API key remains only in the ignored backend environment.
No other pasted credentials were installed. Shared database changes are read
again on normal refresh/poll. Live fallback pages/definitions use a short private
process cache (30 seconds), not imported database records. `source_page_hints.json`
contains page-routing IDs only; responses are independently checked for the
exact learner, and adjacent pages are tried when a hint moves. It is not a
source of answers or authorization.

95 backend tests and 51 frontend feature tests pass, alongside scoped ESLint and
the production build. Full-project TypeScript checking retains the four known
errors outside this feature. No commits, remote operations, migrations, or
production writes were performed.
