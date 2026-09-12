# Progress Review PPTX generation

Generates a KBC-branded, 19-slide Progress Review PowerPoint for one learner
and one 12-week review period, from real data already in the database — no
fabricated numbers, no fabricated evidence. Every field that cannot be sourced
from the database is shown as the literal string `"Not available"` rather than
guessed, and every subsystem failure (an unreachable live database, a missing
column) is recorded in `source_warnings` rather than crashing the request.

## Template provenance — read this before touching pptx_generator.py

The deck is **cloned from a real template file**
(`templates/kbc_progress_review_template.pptx`), never rebuilt from scratch.
That template is itself a merge of two genuine, human-produced KBC Progress
Review decks supplied as design references:

- `Bethanie_Taylor_Grenfell_Progress_Review_Spinnaker_v2.pptx` — the primary
  source for 18 of the 19 slides (it best matches the required slide set: it's
  the only one of the two with separate KSB-Evidenced Knowledge/Skills/
  Behaviours *tables*, distinct from the Priority-KSBs-to-strengthen slide).
- `Curtis_Cooper_Progress_Review_September_2026_Updated.pptx` — contributes
  slide 2 (Progress Review Closure & Next Learning Phase), the one slide type
  Bethanie's deck didn't have. It was merged in via PowerPoint itself
  (`Presentation.Slides.InsertFromFile`), not hand-built XML, so its branding,
  fonts and cards are pixel-identical to the original.

**Everything in the template that isn't text — the KBC logo, the full-bleed
background art, the decorative banner, the rounded cards, the evidence-photo
frames — is a *freeform vector shape with a picture fill*, not a `<p:pic>`
element**, built the way design tools like Canva export to PPTX. This matters
for anyone touching `slide_cloner.py`: `python-pptx`'s own `PICTURE` shape
type never appears anywhere in this template; `picture_fill_shapes()` has to
walk into groups and check `spPr/blipFill` directly, and it's also why
generating from scratch (the original prototype in this app, before this
architecture) could never truly match the reference decks — that branding
simply isn't buildable as primitive rectangles.

**Colours are not theme-linked.** The presentation's own `<a:clrScheme>` is
the generic Office default — every colour in the deck is a direct run/shape
override. `pptx_theme.py`'s `PptxTheme` values were extracted by a frequency
scan of every `srgbClr` across both source decks' slide XML, not read from the
theme or guessed.

**Shape order is not uniform.** Most content slides carry breadcrumb/title/
subheading at shape indices 3/4/5 in that order, but the three slides sourced
from later in the Bethanie deck (SMART Targets, Professional Responsibilities,
Manager Questions) have them at 3 (title) / 4 (subheading) / 5 (breadcrumb) —
reversed — and the one Curtis-sourced slide (Closure) has breadcrumb at index
2 with entirely different indices throughout. `pptx_generator.py`'s module
docstring lists the slide order; each `_populate_*` function's own docstring
or comments flag where its indices deviate from the norm.

**Every dynamic value was verified against a rendered slide, not just read
from XML.** Development found and fixed a whole class of bugs this way that
static inspection alone missed: shapes nested inside a group whose text a
naive top-level shape loop skips entirely (bottom action bars, pill-shaped
card headers), a `header_count=1` assumption that silently preserved a
different learner's name because a shape had no separate header paragraph at
all, and progress bars built as a track+fill shape pair whose fill was never
resized — so two different learners' decks would show visually identical bar
lengths for very different percentages. See `tests_pptx_generator.py`'s
`test_no_source_deck_names_leak_into_a_different_learners_deck` and
`test_progress_bar_widths_are_proportional_to_the_real_percentage`, which
exist specifically to catch a regression of those two bug classes.

## How it fits together

```
period.py          12-week review period math (reuses coach_api's own
                    TIMETABLE_PROGRESS_REVIEW_INTERVAL / iterate_generated_schedule_dates,
                    so the PPTX and the coach calendar always agree on review dates)
review_pack.py      builds the progress_review_pack JSON from learner_api/curriculum_api
pptx_theme.py       colours/fonts extracted from the two source decks (see above)
slide_cloner.py     low-level template mutation: duplicate a slide (continuation
                    pages), replace text/table cells while preserving run
                    formatting, resize a progress-bar fill, swap an evidence photo
text_fit.py         truncation/list-capping so dynamic content can't overflow a card
evidence_images.py  fetches a learner's evidence photo for embedding (network I/O
                    isolated here so it's trivial to stub in tests)
pptx_generator.py   clones templates/kbc_progress_review_template.pptx and
                    populates its 19 slides from the pack — see its module
                    docstring for the exact slide order and shape-index map
runs.py             DB access for the three progress_review_* tables
storage.py          Azure Blob upload/download for the generated .pptx file
tables.py           idempotent CREATE TABLE for the three tables (raw SQL, no migration)
views.py / urls.py  the six /api/progress-reviews/... endpoints
```

### Updating the template design

Set `KBC_PROGRESS_REVIEW_TEMPLATE_VERSION` and drop a new
`templates/kbc_progress_review_template_<version>.pptx` file in place — see
`pptx_generator.resolve_template_path()`. This only works cleanly if the new
file's slide count and shape order matches what `pptx_generator.py` expects
(19 slides in the documented order); a structurally different template needs
the `_populate_*` functions' shape indices re-mapped against it first, the
same way this one was built (render each slide via PowerPoint COM or
LibreOffice, compare against the JSON shape dump, fix indices, re-render,
repeat — see the git history for the scripts used the first time round).

## One-time setup: create the tables

The three tables (`"Learner"."progress_review_runs"`,
`"Learner"."progress_review_source_snapshots"`,
`"Learner"."progress_review_pptx_files"`) live on Neon, which this project
manages with owner-run SQL rather than `manage.py migrate` (see the other
dated files in `backend/sql/` — every other Neon-only table in this project
works the same way). Three ways to create them, in order of preference:

1. **At deploy time**, explicitly:
   ```
   python manage.py apply_progress_review_tables --check   # see what's missing
   python manage.py apply_progress_review_tables            # create/patch it
   ```
2. **By hand in Neon**, running `backend/sql/2026-09-10_progress_review_tables.sql`
   directly (psql, the Neon SQL editor, whatever you already use to run the
   other files in `backend/sql/`).
3. **Do nothing** — the first API request that needs a table calls
   `tables.ensure_progress_review_tables()` itself. This is a safety net, not
   the recommended path (see `enrolment_api/document_tables.py` for why relying
   on it alone is risky once a later release adds a column).

All three are exactly equivalent DDL; running more than one is harmless
(`CREATE TABLE IF NOT EXISTS`).

## Azure Blob container

Generated decks are uploaded straight to `AZURE_PROGRESS_REVIEW_CONTAINER`
(default `progress-review-decks`), the same way `enrolment_api.documents`
stores generated compliance PDFs — no quarantine/scan step, because these
files are generated by the platform from data already in the database, not
uploaded by a learner. Set `AZURE_STORAGE_ACCOUNT` / `AZURE_STORAGE_KEY` (the
same credentials evidence uploads already use) for this to work; without them,
`/generate` and `/bulk-generate` return `503 PPTX storage is not configured.`

## Generating one learner's Progress Review

```
POST /api/progress-reviews/<learner_id>/generate/
Body (all optional): {"review_date": "YYYY-MM-DD"}
```

Without `review_date`, the review period is calculated automatically: the next
generated 12-week review date after the learner's last completed review, or —
if none has been completed yet — whichever generated review date the learner
has most recently reached (falling back to their very first review date if
they are still inside their first 12 weeks). See `period.resolve_review_period`
for the exact priority order.

The endpoint is staff-only (coach/admin) and refuses (`409`) unless the
learner is currently active (`LearnerProfile.lifecycle_status == "active"`).
On success it returns:

```json
{
  "reviewId": "…", "learnerId": 123, "reviewNumber": 2,
  "reviewDate": "2026-06-15", "reviewPeriodStart": "…", "reviewPeriodEnd": "…",
  "generationStatus": "completed",
  "sourceWarnings": ["Attendance register could not be reached; …"],
  "downloadUrl": "/api/progress-reviews/<reviewId>/download/"
}
```

Then fetch a short-lived download link:

```
GET /api/progress-reviews/<reviewId>/download/   ->  {"url": "https://….blob.core.windows.net/...?<sas>", "filename": "…"}
```

## Bulk-generating for every active learner

```
POST /api/progress-reviews/bulk-generate/
Body (all optional): {"learner_ids": [1, 2, 3], "review_date": "YYYY-MM-DD"}
```

Omitting `learner_ids` targets every currently-active learner
(`LearnerProfile.objects.filter(lifecycle_status="active")`). One learner's
failure (missing programme dates, storage error, generation error) is recorded
in that learner's row and never stops the rest of the batch:

```json
{"results": [
  {"reviewId": "…", "learnerId": 1, "generationStatus": "completed", "downloadUrl": "…"},
  {"learnerId": 2, "generationStatus": "failed", "error": "This learner has no programme start date recorded."}
]}
```

## Previewing before generating

Two read-only endpoints exist for the frontend's preview panel, and admit the
learner themselves as well as staff (not just staff — see `views.py`):

- `GET /api/progress-reviews/<learner_id>/periods/` — every 12-week review
  period the learner's programme generates, past and upcoming.
- `GET /api/progress-reviews/<learner_id>/pack/?review_date=YYYY-MM-DD` — the
  full `progress_review_pack` JSON for one period, without creating a run or
  spending an Azure upload. Use this to show the "missing data" warnings and
  the calculated period before committing to `/generate`.

`GET /api/progress-reviews/learners/active/` lists every active learner for a
"select learner" dropdown.

## Tests

```
DJANGO_USE_SQLITE=true DJANGO_SETTINGS_MODULE=config.settings_sqlite_test python manage.py test progress_reviews_api
```

- `tests_period.py` — the 12-week period math, in isolation.
- `tests_review_pack.py` — the KSB-coverage port of
  `frontend/src/utils/learnerJourney.ts::buildKsbProgress`, and the pack
  builder's degrade-to-`"Not available"` behaviour when a subsystem fails.
- `tests_pptx_generator.py` — the deck always has exactly 19 slides, never
  crashes on empty sections, shows a clean placeholder instead of breaking
  when an evidence image can't be fetched, resizes progress bars to the real
  percentage, and never leaks a name from either source deck into a
  differently-named learner's generated PPTX.
- `tests_views.py` — the generation pipeline's error paths (inactive learner,
  no programme dates, storage not configured, generation/upload failures) and
  that bulk-generate isolates one learner's failure from the rest.
