# LMS performance audit — 2026-09-01

Scope: whole stack. Written after a report that `/curriculum/programmes/<id>?tab=delivery`
was consistently slow to load.

**Verification legend**

- **[V]** — read the code and confirmed the behaviour directly.
- **[S]** — reported by a survey sweep, not individually re-read. Confirm before acting.

Nothing here has been applied except the one change noted under "Already done".

---

## Already done

`CURRICULUM_CACHE_TTL_SECONDS` raised from 300 to 1800 in `curriculum_api/views.py:64`.
This only stops idle expiry from forcing a cold rebuild every five minutes. It does
**not** stop a write to one programme from cold-loading every other programme — see
"Deferred" below.

---

## Status of the existing plan

`backend/claude-code-prompt-lms-db-performance-v2.md` contains real
`pg_stat_user_tables` measurements: ~10 billion rows read sequentially across five
tables, and branch egress of 516 GB against a 2.7 GB database (the dataset has crossed
the wire ~190x).

**It was never executed. [V]** `docs/perf/` did not exist before this file, and nothing
in `backend/sql/` touches any of the eight named tables.

### Correction to that plan's diagnosis [V]

The plan attributes `ilr_learning_deliveries` (386,513 seq scans, only 1,202 index scans
in its lifetime) to "a client-side loop, almost certainly an n8n node iterating items or
a Django `for` loop".

That is wrong. It is a `JOIN LATERAL` at `backend/audit_api/manual_ledger_views.py:245`
that runs once per `Aptem_users` row — a per-row scan expressed in SQL, which produces
the same "many cheap scans" signature as a client loop.

This matters because the predicates are function-wrapped:

```sql
WHERE lower(btrim(delivery.email)) = lower(btrim(aptem."Email"))
   OR lower(btrim(concat_ws(' ', delivery.given_names, delivery.family_name)))
      = lower(btrim(aptem."FullName"))
```

No plain btree index on `email` can ever serve this. The plan's Phase 2 would have added
one and measured no improvement. It needs **expression** indexes, and the `OR` means
Postgres will want two of them plus a BitmapOr.

`break_periods` (11.6M scans of a 34-row table) has **zero references anywhere in the
Django codebase [V]** — it is n8n-owned, confirming the plan's instinct that it needs a
workflow fix, not a code fix.

---

## Tier 1 — verified showstoppers

### 1. `GET /coach/timetable` reads the whole 39 MB components table [V]

`backend/coach_api/views.py:4678`

```python
for component in authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, ensure_tables=False):
    if clean_text(component.get("type")).lower() != "live_session":
        continue
```

No `where`, no `columns`. It pulls ~18k rows / 39 MB — 24 MB of which is
`settings_json` — across the wire from Neon, then discards all but the `live_session`
rows and reads three columns from those.

`authoring_fetch_all`'s own docstring (`curriculum_api/views.py:10718-10730`) measures
this exact case at **~90-175 s** versus well under a second for a narrowed read.

Reached from `@require_GET coach_timetable` (`:6130`) via `collect_generated_timetable`
→ `collect_live_session_events` (`:4661`), and from the schedule/book POST handlers via
`find_generated_timetable_event` (`:5351`).

Fix:

```python
authoring_fetch_all(
    AUTHORING_COMPONENTS_TABLE,
    "lower(coalesce(type,'')) = 'live_session'",
    columns=['id', 'type', 'week_id', 'live_sessions_link'],
    ensure_tables=False,
)
```

Adjacent unbounded `select *` in the same function: `:4673` (weeks), `:4701` and `:4842`
(live_session_occurrences), `:4817` (modules). [S]

### 2. `.exists()` defeats a prefetch that was deliberately added [V]

`backend/learner_api/models.py:688`

```python
[choice.answer_ref for choice in answer.chosen_answers.all()]
if answer.chosen_answers.exists()
else answer.chosen_answer_ref
```

`.all()` on the value side is served from the prefetch cache. `.exists()` on the
condition side **never** is — it issues a fresh `SELECT EXISTS` per quiz answer, even
for the callers that carefully prefetched (`coach_api/views.py:1177-1178`,
`learner_api/learner_detail.py:100-101`).

Consumers: `coach_api/views.py:1493` (`serialize_caseload_learner`, once per learner in a
caseload), `:2470`, `learner_api/learner_detail.py:868`.

Cost: one round trip per quiz answer per learner — hundreds to thousands on
`GET /coach/caseload` and `/coach/dashboard`.

Fix: test the list that is already being built — `if answer.chosen_answers.all()`.

### 3. 16 DDL statements on every manual-audit request, including GETs [V]

`backend/manual_audit_api/plan_tables.py:35` — `ensure_plan_tables(cur)` issues 16
sequential `create table if not exists` / `alter table` statements and has **no
process-level ready flag**. Called from 26 sites: `plan_pickers.py` (9, all GET
pickers), `plan_views.py` (15), `plan_projection.py` (1).

Cost: ~16 round trips (0.5-1.5 s against Neon) added to every manual-audit request.

Fix: copy the `_READY` guard from `enrolment_api/document_tables.py:47-49` or
`curriculum_api/views.py:9915`.

### 4. The batching layer is written, tested, and never installed [V]

`frontend/src/lib/apiGetBatching.ts:172` exports `installApiGetBatching()`, covered by
`lib/__tests__/apiGetBatching.test.ts`. **The only non-test references are the test
file.** `frontend/src/main.tsx` does not call it.

Every curriculum page fires 4-9 independent GETs within ~12 ms of mount. This module
collapses them into one `POST /coach_api/_batch/`.

Fix: call it in `main.tsx` before `createRoot(...).render(...)`.

### 5. The shared curriculum cache is switched off in practice [V]

`backend/config/settings.py:327` is explicitly built to "share expensive curriculum
payloads between Django workers in production" via Redis when `CACHE_URL` or `REDIS_URL`
is set. **Neither is set in `backend/.env`**, so it falls back to `LocMemCache` —
per-process.

Every worker therefore rebuilds its own copy of the ~13 s curriculum payload, and the
cross-worker staleness described in the `cached_curriculum_value` docstring
(`curriculum_api/views.py:300-312`) is live rather than hypothetical.

Config change only, no code. Probably the cheapest large win available.

---

## Tier 2 — database

### Missing indexes on the measured hotspots [V for predicates, S for absence]

The predicates below were read from the code. Their *absence* as indexes is inferred
from the plan document's measurements (average rows read per scan equals the full
table), not verified against the live database — the Neon connector is not authorized
in this session. Write them with `IF NOT EXISTS` so they are safe either way.

**`fetching_evidence.evidence_items`** — 4.09 billion tuples read, 85,468 scans, 48,826
rows. `backend/audit_api/evidence_explorer_views.py:128` filters `WHERE learner_id = %s`.
This is a live user path: `last-audit/evidence/list`, called from Learner Log Pro, so
every auditor opening a learner scans the whole table.

**`structured_manual_activities.manual_learner_activities`** — 3.36 billion tuples,
167,484 rows. Two causes:

1. A correlated subquery **inside the SELECT list** at
   `evidence_explorer_views.py:145-149`, re-scanning the table once per evidence row
   returned. A learner with 200 evidence items triggers 200 full scans in one request.
   Predicate: `aptem_id`, `deleted_at IS NULL`, `source_ref` (two equality branches under
   an `OR`).
2. `backend/audit_api/actual_hours/journal_hours.py:325` —
   `where m.aptem_id = %s and m.month = %s and m.deleted_at is null`.

**`Manual_audit.activity_results`** — joined on `(learner_id, activity_id)` at
`backend/manual_audit_api/plan_projection.py:453-454`.

**`Audit.ilr_learning_deliveries`** — needs expression indexes, see the correction above.

Per the plan's own rules: `CREATE INDEX CONCURRENTLY` always, build on
`br-sparkling-art-ab64k0zx` first, `EXPLAIN (ANALYZE, BUFFERS)` before and after,
`ANALYZE` after creation, double-quote the mixed-case schemas.

### `select *` on the heavy components table is opt-out, not opt-in [V]

`authoring_fetch_all` (`curriculum_api/views.py:10716`) supports `columns=` /
`exclude_columns=`, but only **5 of 145** calls use either, and only **2 of ~25** reads
of the components table do.

The worst is `curriculum_api/views.py:15539`, which reads every component in every
*other* module (`module_catalogue_id <> %s`) — nearly the whole 39 MB table — purely to
find which ones reference a quiz inside their JSON. That filter belongs in SQL:

```sql
where module_catalogue_id <> %s and settings_json->>'linkedQuizId' = ANY(%s)
```

---

## Tier 3 — backend round trips [S]

Ranked. Each needs a quick read before acting.

| Where | Problem | Cost |
|---|---|---|
| `audit_api/views.py:2650` | `_ensure_signoff_table` runs DDL **plus a table-wide dedup DELETE** inside a GET (`learner_audit`, `:2040`) | 4 trips + an anti-join DELETE per audit read |
| `coach_api/views.py:6577` | `sync_learner_absence_counts_from_details` does ~120 sequential UPDATEs inside `@require_GET coach_attendance` | ~120 write trips on a read |
| `curriculum_api/views.py:18174` | `coverage_response` opens no `curriculum_read_scope()`, so every `@scoped_curriculum_read` helper below it is a no-op. Backs 8 GET endpoints (`:20499-20546`). Its sibling at `:19919` does open one, and its docstring records the difference: "43 queries and ~14 s" | ~40 queries → ~8 |
| `curriculum_api/views.py:20092` | `scope_learner_roster_payload`, same omission, 6 endpoints | same shape |
| `curriculum_api/views.py:8479` | `build_skills_england_standards` neither scoped nor cached at helper level; `all_profile_required_ksbs` (`:8666`) re-reads `ksb_profiles` per profile in a loop | N full-table reads → 1 |
| `coach_api` (whole app) | Never opens `curriculum_read_scope()` at all, though it imports the scoped helpers (`:66`). Note `_CURRICULUM_READ_SCOPE` is a `threading.local`, so the scope must open *inside* each worker fn, not around the `ThreadPoolExecutor` | memoisation entirely absent |
| `quiz_api/views.py:1930`, `:1741` | On `GET /quizzes`: pulls `settings_json`, an N+1 `_quiz_module_options` per quiz, and a `save()` per quiz — writes in a read path | N+1 reads + N writes |
| `learner_api/media_proxy.py:167`, `:225` | Up to 36 unindexed `LIKE '%…%'` scans per media asset (3 aliases x 12 tables) | 36 → 1 with a UNION ALL |
| `learner_api/views.py:252` | `tutor_learners` prefetch omits `progress_entries__quiz_answers__chosen_answers` / `__correct_answers`, so Tier 1 item 2 bites hardest here | 1 + ~3 queries per answer |
| `coach_api/views.py:4748` | `fetch_cohort_selected_holidays` queried once per distinct cohort inside a module loop | ~20-60 trips |
| `audit_api/views.py` (`:2130`, `:579`, `:701`, `:828`) | Uncached `information_schema` probes on every audit read | 6-10 trips per page load |
| `learner_api/learner_detail.py:1074-1100` | Introspection N+1: one `information_schema.columns` query per candidate table | ~25 trips |
| `login/platform_admin.py:754-760` | 24 sequential COUNTs; one `values().annotate()` would do | 24 → 1 |

Write paths with per-row round trips (lower frequency, but a bulk save can be 100+
sequential trips): `manual_audit_api/plan_views.py` (`:332`, `:361-373`, `:873-900`,
`:1120-1159`, `:1523`), `audit_api/manual_ledger_views.py:2683-2708`,
`audit_api/actual_hours/journal_hours.py:477`, `curriculum_api/programme_audit.py:987`,
`curriculum_api/tutor_notifications.py:181`, `learner_api/active_users.py:504-511`. All
want multi-row `VALUES` / `execute_values` / `bulk_create`.

O(n²) Python, no DB cost but real CPU: `audit_api/views.py:1051`,
`curriculum_api/views.py:19344-19382`, `:6511-6570`, `:13799-13847`.

---

## Tier 4 — frontend load path [S unless marked]

Route-level code splitting is already done properly (`src/router/config.tsx`, every page
`lazy()`), and `src/lib/curriculumApi.ts:1748-1811` has a good multi-tier cache with
in-flight dedup that already neutralises StrictMode doubling for curriculum endpoints.
What is left:

**Auth gate serialises the whole cold load. [V]** `RequireAuth`
(`frontend/src/components/feature/RequireAuth.tsx:37`) returns a skeleton until
`isInitialized`, which only flips after `apiMe()` resolves. Because it renders
`<Outlet/>`, the lazy page chunk does not *start* downloading until `/login_api/me/`
comes back. So a cold curriculum load is strictly: entry JS → `/me` → page chunk (up to
~300 KB) → first curriculum request. **This is what the original screenshot showed** —
two `/me` calls finishing around 280 ms, and the detail request not starting until
roughly 1.2 s in. Fix: start the matched route's chunk in parallel with `/me`.

**Supplemental fetches gated behind the slow one.**
`pages/curriculum/programme-detail/page.tsx:901` awaits the detail call, and only at
`:914` starts `Promise.all([coaches, tutors, programmes, ksbFrameworks, holidays])` —
none of which depend on the detail payload. Same shape in
`hooks/useCurriculumEntities.ts:77` → `:107`, affecting six curriculum pages
(`teams-meetings`, `module-workspace`, `cohort-workspace`, `group-workspace`, `groups`,
`cohorts`, `holidays`). Every one pays `a + b` instead of `max(a, b)`.

**KSB coverage is fetched twice, and each attempt is a serial id loop.**
`programme-detail/page.tsx:1955-1966` fires before `ksbSets`/`standards` have landed,
then again when they do — and coverage is the most expensive endpoint class here.
`:1925-1932` then tries up to 5 candidate ids **one after another**, each a full round
trip. Identical pattern in `loadLearnerRoster` at `:1976-1983`. Fix: gate the effect, and
use `Promise.any` over the candidates.

**`TrainingPlanPage` nested serial awaits.** `pages/delivery/TrainingPlanPage.tsx:164-189`
— 8 modules x 6 weeks is 56 strictly sequential HTTP requests.

**`fetchCurriculumStats()` exists and has zero call sites. [V]**
`lib/curriculumApi.ts:1969`. Meanwhile `pages/curriculum/hubs/page.tsx:127-128` and
`pages/workspace/curriculum/page.tsx:114-115` pull the full compact overview *and* the
full programmes list to render `.length` counters.

**`skipCache: true` on hot pages.** `programmes/page.tsx:269` and
`module-builder/page.tsx:307-308` bypass the 30 s cache on every mount, including
Back-navigation. `module-builder:344` also runs a full compact overview ungated — its
deps are `undefined` at mount, so it always fires.

**Render-blocking CSS.** `frontend/src/index.css:1-2` has two Google Fonts `@import`s; a
CSS `@import` is a *chained* blocking request discovered only after the 352 KB built
stylesheet downloads, and DM Sans is already loaded in `index.html:18`. Two cdnjs
stylesheets (~160 KB, Font Awesome + Remix Icon) load from an origin with no
`preconnect`. No `manualChunks` in `vite.config.ts:76-88`; current output is 364 chunks /
9.4 MB. `xlsx` (424 KB) is statically imported at
`components/feature/KsbFrameworkManager.tsx:2` though used only in two export handlers —
the codebase already does this correctly elsewhere (`module-builder/ksbExcel.ts:237`).

**Per-keystroke network.** `pages/curriculum/quiz-xml/page.tsx:1916` — search input with
no debounce drives `loadQuizzes` via a `useCallback` dep, firing a request per character
on raw `fetch()` calls that bypass the cache layer entirely.

**Polling.** `pages/workspace/tutor/page.tsx:87` ticks `setNow` **every second**,
re-rendering the page. `components/feature/AssignmentEvidence.tsx:84` polls every 10 s
with `[files, load]` deps, so it tears down and rebuilds its interval each cycle, and
renders once per evidence component. `pages/messages/page.tsx:231` and `:392` are two
independent 15 s pollers on one page.

**Memoisation gaps**, all sitting between correctly-memoized siblings:
`programme-detail/page.tsx:2502-2533` (eleven full passes over the heatmap/modules per
render), `module-builder/page.tsx:849-873`, `checkpoints/page.tsx:283-289`,
`hubs/page.tsx:137-142`, `programmes/page.tsx:310-319`. Nothing under `pages/curriculum/`
uses `React.memo` — notably `SessionsTree.tsx` (553 lines).

**Hygiene:** `programme-detail/page.tsx.tmp` is a 4,220-line orphan copy of the page.
`programmes/page.tsx:3125` defines `ProgrammeStructureEditor` (~200 lines, with its own
data hooks) that is never rendered. `features/audit/` holds four near-identical forks
each with a 1,600-line `api.ts`, so any fix there needs applying four times.

---

## Configuration

- **`DJANGO_DEBUG=True` in `backend/.env`. [V]** If that file ever reaches production,
  Django retains every SQL query in `connection.queries` for the process lifetime —
  steady memory growth and slowdown, plus detailed error pages. Confirm the VPS
  overrides it.
- **`CACHE_URL` / `REDIS_URL` unset** — see Tier 1 item 5.
- Connection handling is **already right**: psycopg3 pooling on by default, sensible idle
  retirement and connect timeouts for Neon (`settings.py:58-79`). Nothing to do.

---

## Deferred

**Per-programme cache invalidation.** `invalidate_curriculum_cache()`
(`curriculum_api/views.py:90-116`) bumps one global epoch that is baked into every cache
key (`shared_curriculum_cache_key`, `:295`). So any write anywhere makes every cached
payload for every programme unreachable at once. Scoping this properly needs a parallel
per-programme epoch table plus an identifier-to-canonical-programme resolution step
*before* the cache lookup — the detail endpoint accepts id, sourceId, config identity,
slug or name, and only resolves them after doing the expensive build it is trying to
avoid. Real work, and it touches code with a history of subtle stale-data bugs. Not
attempted.

---

## Suggested order

1. `installApiGetBatching()` in `main.tsx` — one line, collapses the mount storm everywhere.
2. Narrow the components read at `coach_api/views.py:4678`.
3. `.all()` instead of `.exists()` at `learner_api/models.py:688`.
4. `_READY` flags: `manual_audit_api/plan_tables.py:35`, `audit_api/views.py:2650`.
5. Set `CACHE_URL` in production.
6. Un-serialise the two frontend waterfalls (`programme-detail/page.tsx:901`, `useCurriculumEntities.ts:77`).
7. The four indexes in Tier 2, on the safe branch first, with before/after `EXPLAIN`.
8. Everything else, by the tables above.
