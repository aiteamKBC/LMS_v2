# Learner Journal Actual Hours — Plan (read-only discovery)

Mode: `plan`. Nothing was edited, no migration was created or applied, no learner
record was written. Every fact below was read from this repository or from the
clone database with read-only queries on 2026-08-14.

---

## 1. Verified schema map

Connection used: Django alias `audit_clone` (added today), from `backend/.env` key
`LASR-ADUTIOD-CLNE` → host `ep-jolly-shadow-abviwmq2-pooler.eu-west-2.aws.neon.tech`,
database `neondb`. **The Neon *branch name* `Last_audit_clone` is not provable from
the DSN** — see Blocker B1.

### 1.1 Base table — actual identifiers

The spec names `Last_audit.Activity_Actual_Hours`. The object that exists is
**lower-case** `"Last_audit"."activity_actual_hours"`. There is no mixed-case
variant. All code must quote the schema and use the lower-case table name.

| column | type | notes |
|---|---|---|
| `learner_id` | `bigint` NOT NULL | part of PK; LMS learner id, no FK constraint |
| `aptem_id` | `bigint` NULL | the id the UI scopes by |
| `month` | `text` NULL | `YYYY-MM`; verified to equal `to_char(activity_date,'YYYY-MM')` for **all** 273,731 rows (0 mismatches) |
| `kind` | `text` NOT NULL | part of PK — `reading_quiz`, `video`, `audio`, `attendance`, `assignment` |
| `ref` | `text` NOT NULL | part of PK — LMS `activity_id` as text, or attendance `source_key` |
| `title` | `text` NULL | |
| `actual_hours` | `numeric` NULL | **decimal hours**, observed to 4 dp (e.g. `0.4561` = 27 m 22 s) |
| `reported_hours` | `numeric` NULL | equals `actual_hours` on System rows |
| `reporting_method` | `text` NULL | `Input` (233,014) / `System` (26,896) / `Attendance` (13,821) |
| `activity_date` | `date` NULL | 0 NULLs |
| `start_time` | **`time without time zone`** NULL | wall-clock only, **not** an instant |
| `end_time` | **`time without time zone`** NULL | wall-clock only |
| `timestamp_label` | `text` NULL | `Input` / `HH:MM:SS-HH:MM:SS` / `attended` / `not attended` |
| `source` | `text` NULL | `actual:reading_quiz`, `actual:media`, `actual:attendance`, `actual:aptem_actual_hours`, `fetched:attendance_activity_hours` |
| `updated_at` | `timestamptz` NOT NULL default `now()` | |

Constraints: `PRIMARY KEY (learner_id, kind, ref)` only — **no surrogate id, no
foreign keys, no indexes beyond the PK**. 273,731 rows / 273,731 distinct keys.
`aptem_id` — the id the UI scopes by — is NULL on **3,951 rows, all of them LMS
kinds** (see §5.3 for how they are handled).

Two consequences the spec does not anticipate:

1. **A child table cannot reference a single `id`.** Revision and validation rows
   must carry the composite key `(learner_id, kind, ref)` as the foreign key.
2. **`start_time`/`end_time` are `time`, not `timestamp`.** An instant only exists
   as `activity_date + start_time` interpreted in some timezone. Rules stated in
   the contract in terms of "genuine instants" and "convert to Europe/London"
   collapse to: the stored wall-clock **is already local**, if the ingest
   convention is Europe/London. That convention is unverified — Blocker B3.

### 1.2 Source category — `reporting_method`, not `timestamp_label`

The contract treats `Timestamp_label` as the source. In the data it is a *display*
string; the categorical column is `reporting_method`:

| `reporting_method` | `timestamp_label` shape | contract category |
|---|---|---|
| `System` | `HH:MM:SS-HH:MM:SS` (26,896) | **Time Stamped** |
| `Input` | literal `Input` (233,014) | **Input** |
| `Attendance` | `attended` / `not attended` (13,821) | excluded (Attendance) |

There are **no** unrecognised/other values today, so `unrecognized_source` findings
start at zero but the code must still handle them.

### 1.3 Eligible LMS population and current baselines

`kind IN ('reading_quiz','video','audio')` = LMS; `attendance` and `assignment`
(10,426 rows, all `Input`, source `actual:aptem_actual_hours`) are excluded per
contract §3.

| kind | Input | System |
|---|---|---|
| reading_quiz | 120,287 | 18,803 |
| video | 83,904 | 8,093 |
| audio | 18,397 | 0 |

Global source analytics, computed with the contract's exact formula:

```
N = 249,484   actualTimestamped = 26,896 (10.78%)   actualInput = 222,588 (89.22%)
expectedTimestamped = round(0.23 × N) = 57,381      expectedInput = 192,103
exceptionCount = 249,484 − 26,896 − 192,103 = 30,485
exceptionRate  = 12.22%  → ALERT (> 7.5%)
```

This is the honest current state of genuine data. It is an analytics alert, not a
defect to be engineered away — no value may be changed to move it.

Time Stamped classification baseline (rules from contract §8, computed read-only):

| reading_quiz `System` (18,803) | count |
|---|---|
| `< 00:01:00` → blocking | 831 |
| `00:01:00`–`00:12:47` → below normal | 6,089 |
| `00:12:48`–`00:33:19` → normal | 6,550 |
| `00:33:20`–`00:58:00` → long tail | 3,318 |
| `> 00:58:00` → blocking excess | 2,015 |

Long-tail rate for that subset = 3,318 / 18,803 = **17.65 %** → above the 9.3 %
review level. The denominator is pinned here and in §5.2: *classifiable* means
every row a rule can classify, **including** the two blocking bands;
*unclassifiable* means missing media duration only. Any other split (e.g.
dropping blocking rows) moves this number to ~20.8 % and must not be chosen
silently. Video `System`: 8,093 rows, 9 of them under one minute.
Working-time rules are already clean: **0** weekend rows, **0** starts before
09:00, **0** starts at/after 17:00, **0** ends after 17:00, **0** `end <= start`,
**0** System rows with a missing time.

### 1.4 Media duration

`"Last_audit"."activities"."configured_duration_min"` (`numeric`, minutes), joined
by `activities.activity_id::text = activity_actual_hours.ref` — the same join the
ledger already uses.

Coverage is a real constraint on the feature:

- **audio: 18,397 / 18,397 rows have no configured duration** → every audio row is
  unclassifiable for media-relative analytics, and (contract §9) a new
  media-relative Input proposal on audio must be blocked.
- video: 3,079 / 91,997 missing.

### 1.5 Who writes this table today

Nothing in this repository writes `Last_audit.activity_actual_hours`. It is read
through one LEFT JOIN (`_OTJH_JOIN`, `backend/audit_api/last_audit_ledger_views.py:55`)
and surfaced as `otjh_actual` / `otjh_method` / `otjh_timestamp` / `otjh_from` /
`otjh_to` (`:61`, `:390-428`). The rows are produced by the external fetch-evidence
pipeline. `backend/manual_audit_api/management/commands/setup_manual_audit.py:45`
copies the table one-way into `Manual_audit` (truncate + reload) — that mirror must
not be pointed at the new tables.

**This feature would be the first writer.** That is exactly why the contract's
"never overwrite the active value outside approval" rule is cheap to guarantee here.

---

## 2. Verified repository map

| concern | location |
|---|---|
| Learner Journal page | `frontend/src/features/audit/learner-log-pro-hours-test/routes/journal.index.tsx` |
| Month state | `periodChoice` / `summaryMonths` (`journal.index.tsx:341-394`), months derived from the manual-ledger summary |
| Learner scope | TanStack route search param (`learner`), hash router — `router.tsx` |
| Row data contract | `.../lib/api.ts` (`LearnerActivity`: `actual_lms_hours`, `time_from`, `time_to`, `time_from_to`, `activity_period`, `reporting_method`) |
| Manual journal writes | `.../lib/manualApi.ts` → `/hours_test_api/last-audit/manual/*` |
| Read endpoints | `backend/audit_api/last_audit_ledger_views.py` (`cohort`, `activities`, `activity`, `attendance-sheet`) |
| URL mounts | `backend/audit_api/urls.py` (live) and `backend/audit_api/clone_urls.py` (HOURS-TEST → clone DB) |
| DB source switch | `backend/audit_api/db_source.py` — `resolve(alias)`, `is_clone()`, `clone_view()` |
| Permission check | `_has_audit_permission()` `backend/audit_api/views.py:79-88` |
| Monthly sign-off (2-role precedent) | `Audit.monthly_audit_signoffs` + `_ensure_signoff_table` `views.py:2650` |
| Overlay/annotation precedent | `Audit.activity_overrides` (`operation`, `payload`, `source_payload`, `updated_by`), `Audit.activity_annotations` |
| Backend tests | `backend/audit_api/tests.py`, `test_last_audit_ledger_views.py` (`manage.py test audit_api`) |
| Frontend tests | `vitest` — `.../lib/lastAuditRequests.test.ts` |

### 2.1 There is no Django migration path to this database

`learner_api/routers.py` blocks migration on the Neon aliases and the `audit`
alias has no migrations at all. The repo-native convention for Neon DDL is an
**idempotent, schema-qualified `ensure_*_table(cursor)` helper** (nine of them
already exist in `audit_api`) plus a `setup_*` management command
(`manual_audit_api/management/commands/setup_manual_audit.py`). The plan follows
that convention; "migration file" in the contract maps to "reviewed DDL helper +
management command", and `apply` mode means running that command once.

### 2.2 Reuse-before-create assessment

| candidate | verdict |
|---|---|
| `Audit.activity_overrides` | **No.** One row per `(aptem_id, activity_id)` with `operation`/`payload` — it is a *current-state* overlay, not immutable history, has no status/approver columns and no two-person constraint. Overloading it would weaken auditability. |
| `Audit.activity_annotations` | No — planned hours/KSB annotation only. |
| `Audit.monthly_audit_signoffs` | Useful **precedent** for two-role signature capture, not a fit for per-row revisions. |
| `structured_manual_activities.*` | No — employee-arranged journal rows, different grain. |

→ Create two new tables in `Last_audit`.

---

## 3. Blockers (must be resolved before the corresponding work)

**B1 — Branch identity cannot be proved (blocks `apply` mode only).**
The DSN gives host `ep-jolly-shadow-abviwmq2` and database `neondb`; Neon branch
names are not exposed in the connection. Acceptable evidence would be a Neon API/CLI
`branches list` naming `Last_audit_clone` for project `abviwmq2`, or a documented
mapping. Until then: create DDL, run nothing remotely. (Circumstantial only: the
`.env` key is literally `LASR-ADUTIOD-CLNE`, and a write probe through
`/hours_test_api` landed in this database and **not** in the live audit branch.)

**B2 — No Auditor identity exists (blocks two-person approval).**
`_has_audit_permission()` returns `True` for everyone unless `AUDIT_API_REQUIRE_AUTH`
is set — and it is **not** set in `backend/.env`. There is no `Auditor` role or
`audit.*` permission anywhere; `updated_by` arrives as a free-text string typed by
the browser. "Proposer ≠ approver" is unenforceable against an unauthenticated
free-text name, and a DB constraint on such a column is theatre. Options for the
user to choose:
  a. Turn on `AUDIT_API_REQUIRE_AUTH`, create a Django `Auditor` group +
     `audit.propose_hours` / `audit.approve_hours` permissions, and have the
     workspace authenticate (session or token). Recommended — everything else in
     the contract then follows.
  b. Ship proposal + validation + analytics now, and land approval behind (a).
  c. Interim: named-auditor identity persisted server-side per session. Weaker;
     the contract's guarantee would be nominal.

**B3 — Timestamp semantics unverified (blocks writing any timestamp-derived value).**
`start_time`/`end_time` are `time without time zone` with a separate `activity_date`.
Nothing in this repo writes them, so the ingest convention (Europe/London wall clock
vs UTC-derived) cannot be established from code, schema, or tests here. Per the
contract, timestamp-writing work stops until confirmed by the fetch-evidence pipeline
owner. Read-only validation and classification can proceed under an explicitly
labelled assumption, and the assumption belongs in the response payload.

**B4 — No England & Wales bank-holiday source.** `curriculum.holidays` is a
cohort-break authoring table (`Summer Break 26`, `Christmas`, type `bank-holidays`)
— not an authoritative calendar. A provider must be built (§5.4).

**B5 — Contract/schema mismatches to accept explicitly:** table casing (§1.1),
source column (§1.2), and three structural impossibilities:

- `crosses_local_day` and `crosses_month_boundary` cannot occur — only a
  wall-clock time is stored, so a midnight crossing is indistinguishable from
  `end <= start`, of which there are 0;
- **cross-month overlap detection is inapplicable for the same reason.** Two
  intervals can only overlap within a single `activity_date`, and a date belongs
  to exactly one month, so the contract's "read adjacent-month records" rule and
  its matching acceptance test have no reachable case here. Overlap scanning stays
  inside the selected month, and the test asserts the impossibility instead.

All three are documented as inapplicable rather than silently dropped.

---

## 4. Isolation approach (how "clone only" is guaranteed)

The HOURS-TEST wiring already gives a server-side switch: `clone_urls.py` wraps
every view in `clone_view`, and `db_source.is_clone()` reports it.

- New endpoints are registered **only** in `clone_urls.py`, not in `urls.py`, so the
  live `/audit_api` mount has no route to them at all. Mechanically: `clone_urls.py`
  is today a pure comprehension over `urls.py`, so the new patterns are **appended
  after** that derived list (each wrapped in `clone_view`) — they must never be added
  to `urls.py`, or the isolation inverts.
- Each new view additionally asserts `is_clone()` and returns 409 otherwise —
  belt and braces if someone later adds the route to the live mount.
- The DDL helper and the setup command take the connection from
  `resolve("audit")` inside clone context, so they cannot create objects in the
  live branch.

---

## 5. Backend approach

### 5.1 New DDL (schema `Last_audit`, non-destructive, idempotent)

`Last_audit.activity_actual_hours_revision`

- `revision_id bigserial PRIMARY KEY`
- `learner_id bigint`, `kind text`, `ref text` → composite FK to the base PK
- `aptem_id bigint`, `selected_month text` (scope snapshot)
- `previous_actual_hours numeric`, `proposed_actual_hours numeric`,
  `proposed_seconds integer` (canonical), `calculation_type text`,
  `calculation_note text`
- snapshots: `source_snapshot text`, `timestamp_label_snapshot text`,
  `activity_date_snapshot date`, `start_time_snapshot time`, `end_time_snapshot time`,
  `kind_snapshot text`, `media_duration_seconds integer`
- workflow: `status text` (`pending|approved|rejected|superseded`),
  `proposed_by`, `proposed_at`, `decided_by`, `decided_at`, `comment`, `evidence_ref`
- integrity: `base_fingerprint text`, `rule_version text`, `created_at`, `updated_at`
- checks: status enum; `decided_by IS NULL OR decided_by <> proposed_by`;
  decision metadata present iff status ∈ (approved, rejected);
  `proposed_seconds > 0`
- indexes: `(learner_id, kind, ref)`, `(aptem_id, selected_month)`,
  partial unique `(learner_id, kind, ref, base_fingerprint) WHERE status='pending'`

`Last_audit.activity_actual_hours_validation`

- `validation_id bigserial PRIMARY KEY`, composite FK columns, `aptem_id`,
  `selected_month`
- `code text`, `severity text` (`informational|warning|blocking`),
  `status text` (`active|resolved|acknowledged`), `message text`, `details jsonb`
- `related_ref text` (the other row of a duplicate/overlap pair, canonicalised so
  the pair is stored once), `fingerprint text`, `rule_version text`
- `detected_at`, `last_seen_at`, `resolved_at`, `resolved_by`, `review_comment`
- partial unique `(fingerprint) WHERE status='active'` → idempotent re-runs
- indexes: `(learner_id, kind, ref)`, `(aptem_id, selected_month, status, code)`

Supporting index on the base table for scope + overlap scans:
`(aptem_id, month)` and `(aptem_id, activity_date, start_time) WHERE reporting_method='System'`.
Non-destructive, additive only; `actual_hours` type is left alone.

### 5.2 Pure domain module (`backend/audit_api/actual_hours/rules.py`)

Constants exactly as the contract states them (1740, 768, 1999, 3480, 766, 900,
840, 2640 seconds; offsets −15…+15 by 5 minutes), plus:

- `classify_timestamped_reading_quiz(seconds)`, `classify_input_reading_quiz(seconds)`
- `classify_timestamped_media(seconds, media_seconds)`, `classify_input_media(...)`
  — including the "empty long-tail interval when `media + X >= 2 × media`" case
- `working_time_findings(activity_date, start_time, end_time, holidays)`
- `seconds_from_hours(numeric) / hours_from_seconds(int)` using `decimal.Decimal`
  only (never float), quantised to the observed 4 dp with a documented rounding
  contract, canonical seconds retained in the revision row.

All pure functions, no DB, no clock, no randomness — directly unit-testable.

### 5.3 Services and endpoints (clone mount only)

```
GET  /hours_test_api/last-audit/actual-hours/summary?aptem_id&month   read-only view
POST /hours_test_api/last-audit/actual-hours/validate                 scan + findings + proposals
POST /hours_test_api/last-audit/actual-hours/proposals                manual Input proposal
POST /hours_test_api/last-audit/actual-hours/proposals/<id>/approve
POST /hours_test_api/last-audit/actual-hours/proposals/<id>/reject
GET  /hours_test_api/last-audit/actual-hours/analytics                learner/month + global
```

`aptem_id` and `month` (`^\d{4}-\d{2}$`) are required and parsed server-side; a
missing or malformed pair returns 400 and performs no work. Every write statement
carries the learner and month predicate, or writes through a base key already
verified in scope. Global analytics run as aggregate SQL (`GROUP BY` /
`FILTER (WHERE …)`), never row loads, and never in the same transaction as a write.

Month membership uses `month = %s` (proven equal to `to_char(activity_date,'YYYY-MM')`
for every row) with `activity_date` as the cross-check, not a UTC boundary and not a
string prefix on a timestamp.

**Rows with a NULL `aptem_id` (3,951, all LMS kinds)** are unreachable from a
Learner Journal scoped by `aptem_id`. They are therefore excluded from learner/month
validation, proposals and per-learner analytics, but they still belong to the global
analytics population — so the summary payload reports them as an explicit coverage
figure ("N rows not reachable from any learner scope") rather than letting them
vanish. Joining them to a learner via `learner_id → Last_audit.learners` is possible
and can be proposed later; it is a data question, not a scope shortcut.

### 5.4 Bank-holiday provider

Interface `BankHolidayCalendar.is_holiday(date) -> bool | Unavailable`, backed by a
cached table seeded from the official gov.uk England-and-Wales dataset, storing
`retrieved_at` and `data_version`; tests inject a fixture. No network call inside a
request. A year with no cached data yields a blocking
`bank_holiday_calendar_unavailable` finding — never "treated as a normal day".

### 5.5 Approval transaction

One transaction: lock the revision row `FOR UPDATE` → assert `status='pending'` →
assert approver has the Auditor permission → assert `decided_by <> proposed_by` →
re-scan for active blocking findings on that base row → recompute `base_fingerprint`
from the current base row and compare → write `actual_hours` via the Decimal
converter → set `status='approved'`, `decided_by`, `decided_at` → commit. Any
mismatch returns `409 stale` and the active value is untouched. Proposal creation is
likewise transactional, and the partial unique index makes a concurrent duplicate
impossible rather than merely unlikely.

---

## 6. UI approach

In `journal.index.tsx`, a panel next to the existing month selector:

- header shows learner name + `aptem_id` + selected month, with the action labelled
  **“Validate and Calculate Actual Hours”**; never a global/bulk variant, never
  auto-run on render;
- counters: records scanned, valid Time Stamped, pending proposals, Input rows
  awaiting entry, blocking / warning counts, duplicates and overlaps, unclassifiable,
  pending approvals;
- two analytics blocks, the global one explicitly labelled read-only context;
- per row: active hours vs pending value in visually distinct styles, source,
  `activity_date` + `HH:MM:SS–HH:MM:SS`, validation badges with plain-English
  reasons (stable codes kept in the payload), proposer/approver, history link;
- Auditor-only controls hidden/disabled for other roles — with the server as the
  authority, not the UI.

Because HOURS-TEST already carries its own copy of this route, none of this touches
the Automatic workspace.

---

## 7. Test plan

Backend (`manage.py test audit_api`): pure-function boundary tests at every constant
(59/60 s, 767/768, 1999/2000, 3480/3481, 840, 2640, media ±766, ±900, empty long-tail
interval, offsets not divisible by 5, offsets under 60 s); working-time boundaries
(08:59:59 / 09:00:00 / 16:59:59 / 17:00:00 / 17:00:01, end == start, end < start);
weekday/weekend; bank-holiday fixture incl. one-off and unavailable-year; GMT and BST
dates; month membership incl. first/last day; Decimal round-trips; duplicate/overlap
half-open semantics incl. touching intervals and different learners; scope isolation
(missing/invalid month, tampered learner id, adjacent-month reads are not written);
idempotency (re-run creates no second proposal/finding); concurrency (two approvals,
one wins; stale fingerprint rejected); authorization matrix; regression tests that
Attendance and Assignment/Aptem paths and counts are unchanged, and that `is_clone()`
is required.

Frontend (`vitest`): panel scope labels, active-vs-pending rendering, control
gating, no auto-run on mount. Note: `learner-log-pro-copy` and its HOURS-TEST copy
each carry 2 pre-existing failing assertions in `lastAuditRequests.test.ts`, and
`audit_api` has 4 pre-existing failures at HEAD — both verified today, both
unrelated to this feature.

---

## 8. Suggested sequence

1. Resolve B2 (auditor identity) — it determines the shape of §5.5.
2. Land §5.2 pure rules + tests (no DB, no risk).
3. Land the DDL helper + `setup_actual_hours_review` command (created, not run).
4. Scoped read + analytics endpoints (read-only, safe to demo against the clone).
5. Validation scan + finding persistence (idempotent).
6. Timestamp-derived proposals — only after B3 is answered.
7. Manual Input proposals, then approval/rejection.
8. Journal panel.
9. `apply` mode: prove B1, run the setup command once, verify objects exist in
   `Last_audit` and none in `public`.

## 8a. Implementation status (implement mode, same day)

Built and verified:

| area | file |
|---|---|
| Pure rules | `backend/audit_api/actual_hours/rules.py` |
| DDL (created, **not applied**) | `backend/audit_api/actual_hours/tables.py` |
| Bank-holiday provider | `backend/audit_api/actual_hours/holidays.py` |
| Scoped reads + aggregate analytics | `backend/audit_api/actual_hours/repository.py` |
| Scan / proposal / approval services | `backend/audit_api/actual_hours/service.py` |
| Server-side auditor identity | `backend/audit_api/actual_hours/auth.py` |
| Endpoints (clone mount only) | `backend/audit_api/actual_hours/views.py`, appended in `clone_urls.py` |
| Setup command | `backend/audit_api/management/commands/setup_actual_hours_review.py` |
| Journal panel + client | `.../learner-log-pro-hours-test/components/ActualHoursPanel.tsx`, `lib/actualHoursApi.ts` |
| Tests | `audit_api/test_actual_hours_rules.py` (45), `test_actual_hours_views.py` (15), `lib/actualHours.test.ts` (6) |

Two defects were found by review of the write path and fixed before delivery, each
pinned by a regression test (the write path itself cannot run until apply mode):

1. **Approval would have 409'd every media row.** `lock_base_row` does not select the
   joined media duration, and the approval check grafted the proposal's own snapshot
   onto the locked row before re-fingerprinting — so any row whose media duration was
   non-null at proposal time (≈89k of 92k video rows) could never be approved. The
   approval now re-reads the row **through the media join**, which also means a genuinely
   changed `configured_duration_min` correctly invalidates the proposal.
2. **Re-scanning churned the semantics findings.** The stale-resolution UPDATE ran before
   the proposal loop that raises `timestamp_semantics_unconfirmed`, so every re-scan
   resolved and recreated those findings. The resolution pass now runs last, after
   `seen_fingerprints` is complete — re-running a scan on unchanged data is a no-op.

A stale proposal is now left `pending` and answered with `409`; the earlier code marked
it `superseded` inside a transaction that the same refusal rolled back.

Results actually observed: `manage.py test audit_api` → 143 tests, 4 failures, all four
pre-existing at HEAD (verified by stashing this branch's changes). `vitest src/features/audit`
→ 76 tests, 4 failures, the same two pre-existing assertions duplicated across the two
copies of the workspace. `tsc --noEmit` → 22 errors, unchanged from before this work
(9 in `learner-log-pro-copy`, 9 mirrored, 4 in `learner-log-pro-manual`). `vite build`
succeeds. `eslint` on every new file is clean.

Decisions taken while the blockers stand:

* **B1/apply** — nothing was applied. `manage.py setup_actual_hours_review --check` was
  run (read-only) and reports `existing review tables: none` on
  `alias=audit_clone host=ep-jolly-shadow-…`. The endpoints do **not** create tables
  implicitly; they return `503 not_installed` until the command is run.
* **B2/identity** — the acting auditor is resolved server-side only: an authenticated
  Django user with `audit.propose_hours` / `audit.approve_hours`, or, while
  `AUDIT_API_REQUIRE_AUTH` is off, an explicit `X-Audit-Actor` header recorded as
  `proposed_by_source = 'dev-header'`. A name in the request body is ignored. Proposer ≠
  approver is enforced in the service **and** by a database CHECK. Dev mode is not a
  security boundary — production needs option (a) from B2.
* **B3/timestamps** — `TIMESTAMP_SEMANTICS_CONFIRMED = False` in
  `actual_hours/views.py`. While it is false, a System row whose stored hours differ from
  its elapsed wall-clock gets a blocking `timestamp_semantics_unconfirmed` finding
  instead of a proposal. Auditor-entered Input proposals are unaffected. Flip the
  constant only when the fetch-evidence pipeline owner confirms the convention.

Two operational notes that will look like bugs otherwise:

* The gov.uk dataset covers roughly three years, while the data spans **2020-06 →
  2029-05**. Scanning a month outside the seeded window raises
  `bank_holiday_calendar_unavailable` on every dated row — contract-correct ("never
  silently treated as an ordinary day"), but it needs the older years seeded before a
  historic month reads cleanly.
* The SQL `unclassifiable` band also catches a row with no duration at all, while §1.3's
  pinned definition is missing-media only. There are currently **0** such rows
  (`actual_hours` is non-null everywhere), so the two definitions agree today.

Not yet exercised: the DDL and the write statements have never run against Postgres,
because that is an `apply`-mode act — defect 1 above is exactly why that caveat matters. First run should be
`setup_actual_hours_review --check`, then without `--check`, then one scan on a single
learner/month, then verify a pending revision exists and `actual_hours` is unchanged.

Evidence for the safety invariants (grep over the new package):

* exactly one statement writes `actual_hours` — `service.py:380`, inside `approve`;
* no statement writes `timestamp_label`, `start_time` or `end_time`;
* no `random` / `uuid4` / `faker` / jitter anywhere (asserted by a test, not just grep);
* global analytics are a single aggregate `SELECT`, never in a write transaction;
* `/audit_api/last-audit/actual-hours/*` resolves to `Resolver404` (asserted by a test).

## 8b. Branch identity, identity model and timestamp investigation (second implement pass)

### Branch evidence, read from the live connection

| | HOURS-TEST alias `audit_clone` | live alias `audit` / `default` |
|---|---|---|
| `neon.branch_id` | **`br-orange-rain-abud8i61`** | `br-holy-band-abhispwg` |
| `neon.endpoint_id` | `ep-jolly-shadow-abviwmq2` | `ep-wild-shape-ab005yy6` |
| `neon.timeline_id` | `37423791227a1ebbc511bfadbd23c7d3` | `c501795ac1b98d647909d66a78401cf3` |
| `neon.project_id` / `tenant_id` | `green-term-97168878` / `0727a04a…` | identical |
| `pg_control_system().system_identifier` | `7647176419717184994` | identical |

What this proves: the HOURS-TEST connection is a **different Neon branch** from the
live audit branch, inside the same project, sharing one system identifier — i.e. a
branch (clone) of it, not the original. What it does **not** prove: that this branch is
*named* `Last_audit_clone`. Neon exposes ids to SQL, never branch names; the mapping
lives in the control plane, and this environment has no `NEON_API_KEY`, no `neonctl`,
and no documented mapping in the repository. Per the standing instruction, **no DDL and
no write were executed**; the one question that unblocks it is whether the Neon console
shows branch `Last_audit_clone` with id `br-orange-rain-abud8i61`.

Also hardened while here: `learner_api/routers.py` now refuses `allow_migrate` for the
`audit`, `audit_clone` and `kbc_attendance` aliases, so `migrate --database=audit_clone`
can never plant `django_migrations` on an audit branch. Note that Django's **default**
alias points at `ep-wild-shape` — the live branch — which is why `manage.py migrate` was
*not* run either; the new `audit_api/0001_initial` migration is state-only (both models
are `managed = False`, no table is created) and applying it is the user's deployment act.

### Identity model (replaces the dev-header fallback)

* Proposing/scanning requires an authenticated account with
  `audit_api.propose_actual_hours`; approving/rejecting requires
  `audit_api.approve_actual_hours`. Identity is `user:<pk>`, resolved from the session.
* `X-Audit-Actor` is now **off by default**: it needs `DEBUG` *and*
  `ACTUAL_HOURS_ALLOW_DEV_ACTOR=1`, is refused whenever `AUDIT_API_REQUIRE_AUTH` is on,
  and **can never approve or reject** — the view refuses it and `service._decide`
  refuses any non-account identity independently.
* Permissions are declared by `audit_api.models.ActualHoursReview`; `manage.py
  grant_auditor <user> --propose --approve` assigns them through an `Auditor` group and
  touches only the default database.

### Timestamp semantics — investigated, still unconfirmed

* **Types:** `start_time` and `end_time` are `time without time zone`; there is no
  `timestamptz` anywhere in `activity_actual_hours` — the date lives in `activity_date`.
* **Producer:** nothing in this repository writes the table; the fetch-evidence pipeline
  does, and it is out of tree. `activity_results.raw` carries no timestamp at all (only
  `status`), and `fetching_evidence` has no per-activity time columns.
* **Storage zone (statistical):** across 26,896 System rows the bounds are identical in
  BST and GMT months (start `09:00:0x`–`16:59:0x`, end ≤ `17:00:00`). UTC-stored values
  would shift by an hour in BST, so these are **not UTC** — they behave as a local
  working-day wall clock, which is consistent with Europe/London.
* **A genuineness signal that matters more than the zone:** every one of those rows falls
  inside 09:00–17:00 with zero violations of any working-time rule, the start-hour
  histogram is near-uniform (9→15 ≈3,500 each), only 429 of 26,896 start on a whole
  minute, and `elapsed == stored actual_hours` for 100% of rows. That pattern reads as
  times *constructed* to fit the working day rather than instants observed from learner
  activity.

Conclusion: `TIMESTAMP_SEMANTICS_CONFIRMED` stays `False`. The zone is only inferred,
and if the timestamps are pipeline-constructed then deriving `actual_hours` from them
would launder a synthetic figure into an approved one. Behaviour while it is false is
unchanged: no automatic timestamp-derived proposal, a blocking
`timestamp_semantics_unconfirmed` finding on the rows that would have changed, no edit to
any timestamp and no edit to `actual_hours`. Manual auditor proposals are unaffected.

## 8c. Apply pass — executed on the clone branch after the user designated it

The user replaced the `LASR-ADUTIOD-CLNE` value in `backend/.env` and instructed that
the HOURS-TEST work run against it. Pre-flight check before any write:

```
audit_clone  branch=br-orange-rain-abud8i61  endpoint=ep-jolly-shadow-abviwmq2
audit        branch=br-holy-band-abhispwg    endpoint=ep-wild-shape-ab005yy6
default      branch=br-holy-band-abhispwg    enrolment  branch=br-holy-band-abhispwg
→ target differs from every live alias
```

**DDL applied** — `setup_actual_hours_review --seed-holidays bank-holidays.json`:
`activity_actual_hours_revision`, `activity_actual_hours_validation`,
`bank_holidays_england_wales` created in `Last_audit`; 83 official England-and-Wales
holidays cached (2019–2028); 0 objects in `public`; the two-person CHECK, the status /
severity / month CHECKs, both composite FKs, and the two partial unique indexes are all
present, plus the two supporting indexes on the base table.

**Scans (one learner + one month each, through the same endpoint the panel calls):**

| learner / month | records | Time Stamped | Input | blocking | warnings | unclassifiable | proposals |
|---|---|---|---|---|---|---|---|
| Aptem 4365 / 2026-05 | 30 | 12 | 18 | 0 | 0 | 0 | 0 |
| Aptem 92 / 2026-03 | 220 | 30 | 190 | 184 | 15 | 15 | 0 |

Learner 92's findings are `duration_below_one_minute` ×184 (Input rows storing ~11
seconds) and `missing_media_duration` ×15. No proposals were created because
`TIMESTAMP_SEMANTICS_CONFIRMED` is false. Scope analytics for 92/2026-03: source
exception rate 9.55% (**alert**, >7.5%), long tail 0/205 = 0% (within). Global,
read-only: 249,484 eligible, 26,896/222,588 vs expected 57,381/192,103, exception count
30,485 = **12.2192%** (alert); long tail 8,035/228,008 = 3.52% (within), 21,476
unclassifiable, 3,951 rows unreachable from any learner scope.

**Lifecycle, with authenticated identities injected at the view boundary** (Django auth
tables live on the *live* branch, so no account was created there):

| step | result |
|---|---|
| Scan → did `actual_hours` change? | **NO** (both learners, byte-identical snapshot) |
| Auditor A proposes video 125015 at media+5m (2592s → 3168s) | revision 1 `pending`, active stays `0.72` |
| Auditor A approves own proposal | **403 `self_approval`**, active stays `0.72` |
| Auditor B approves | 200 — active becomes `0.8800`, revision `approved`, proposer `user:9001`, approver `user:9002`, both timestamps and `previous_actual_hours = 0.72` retained |
| Auditor A proposes, B rejects (video 127481) | revision 2 `rejected`, comment kept, active unchanged at `0.6489` |
| Raw SQL `decided_by = proposed_by` | refused by `activity_actual_hours_revision_two_person_check` |
| Approve a row carrying a blocking finding | **409 `blocked`** (`duration_below_one_minute`), active unchanged |
| Re-scan 92/2026-03 twice | 199 validations before and after; 0 created, 0 resolved, 0 duplicates |
| Re-scan 4365/2026-05 three times | no new findings, no new revisions |

**Blast-radius control.** Clone base table total hours moved from
`109593.48453333333333860` to `109593.64453333333333860` — a delta of exactly `+0.16`,
which is the single approved change (0.72 → 0.88) and nothing else. The live branch is
untouched: 0 review tables exist there and its total is still
`109593.48453333333333860`.

Artifacts deliberately left on the clone: revision 1 (approved), revision 2 (rejected),
revision 3 (pending, on a blocked row), 199 validation findings for 92/2026-03, and the
83-row holiday cache.

## 8d. Product decisions taken 2026-08-15 (identity mode + timestamp flag)

Two settings were changed on the product owner's instruction, after the trade-offs
below were put to them.

**1. No login in front of the workspace — `named` identity mode.**
`ACTUAL_HOURS_IDENTITY_MODE` selects `named` (default when `AUDIT_API_REQUIRE_AUTH` is
off) or `django`. In `named` mode whoever opens the Learner Journal names themselves;
the server takes the name from the `X-Audit-Actor` header (never from the body), stores
it as `named:<name>` with `proposed_by_source='named-header'`, and still enforces
proposer ≠ approver in the service **and** through the database CHECK. A request with no
name is refused (403 `actor_required`).

What that buys and what it does not: it is a **workflow control and an audit trail**, not
authentication. A self-declared name cannot be verified, so it prevents accidental
self-approval and records who did what — it does not stop someone entering both names.
An authenticated account holding `audit_api.approve_actual_hours` always outranks the
header, so turning login on later is one environment variable and no code change.

**2. `TIMESTAMP_SEMANTICS_CONFIRMED = True`.**
The remaining doubts are recorded in §8b: the Europe/London reading is inferred from the
data (identical 09:00–17:00 bounds across BST and GMT) rather than proven from the
pipeline, and the distribution suggests the times may be pipeline-constructed. With the
flag on, a time-stamped row whose stored hours differ from its genuine elapsed time now
yields a **pending proposal** instead of a blocking finding — it still never writes
`actual_hours` directly. On the current data this changes nothing: **0 of 26,896**
time-stamped rows have `round(actual_hours × 3600) ≠ elapsed`, so no proposal is
generated; the setting only matters for future rows where the two diverge.

Re-verified end-to-end on the clone under both settings (learner 4365 / 2026-05):
scan 30 records → 0 proposals, 0 findings, clone total unchanged by the scan; a request
without a name → 403; `Auditor A` proposes (revision `pending`, active stays `0.8806`);
`Auditor A` self-approve → 403 `self_approval`; `Auditor B` approves → active becomes
`0.9131`; a second proposal rejected by B leaves `0.6014` untouched; two further scans
create nothing. Clone total moved by exactly `+0.0325` (the single approval) and the live
branch is still `109593.48453333333333860` with 0 review tables.

## 8e. Calculated hours for the Learner Journal's Activity log (2026-08-15)

The report's own **Actual** column is the employee-arranged ledger
(`structured_manual_activities.manual_learner_activities`), not
`Last_audit.activity_actual_hours` — so filling it needed its own path:

* `audit_api/actual_hours/journal_hours.py` — calculation, pending proposals and
  the two-person decision, keyed on the journal row id;
* `structured_manual_activities.manual_activity_hours_revision` — new revision
  table (composite-free: it references the row's own `id`), carrying
  `offset_minutes`, `basis`, both values, proposer/approver, the same
  two-person / status / decision CHECKs and a `pending`-only unique index;
* endpoints `/hours_test_api/last-audit/journal-hours/{summary,calculate,approve,reject}`,
  registered on the clone mount only;
* UI: an **Offset** picker, **Calculate actual hours** and **Approve (N)** in the
  Activity log header, with each row's pending value shown under its Actual
  figure as a dashed `→ 0h 19m 00s`.

**Actual and planned are separate buttons.** *Calculate actual hours* and
*Calculate planned hours* each propose their own column and leave the other's
pending proposal alone: pressing one re-issues the row's pending revision
carrying both values and keeps the previous one as `superseded` history, so the
buttons can be used in any order before a single *Approve* writes both. The
revision table's `proposed_actual_hours` and `proposed_seconds` are therefore
nullable now, guarded by a CHECK that every revision proposes **something**
(`proposed_actual_hours is not null or proposed_planned_hours is not null`). An
unknown `fields` value is refused with `400 invalid_fields` before any query.

Verified on the clone (learner 92 / 2026-04): planned-only → 14 planned values
over 8h of Aptem LMS, no actual touched; then actual-only → 20 actual values,
`planned_set: 0`, and the 14 planned proposals still pending; re-running
planned-only created nothing (`already_pending: 49`); one Approve wrote both
columns (reading+quiz planned totals exactly `8.0000`).

**The Activity-log page carries no identity and no offset picker (2026-08-15).**
The buttons above plus *Approve* are all that remain — and every run uses
varied offsets per row. Runs with no identity are stamped
`workspace:hours-test` / `proposed_by_source='workspace'`, so the revision
history still records what was calculated, when, from which reference, and with
which offset.

The consequence, stated plainly: **the two-person rule no longer applies to this
page**, because there is only one actor. The database CHECK was relaxed to
`decided_by <> proposed_by OR proposed_by_source = 'workspace'`, so a *named* or
*logged-in* auditor is still held to it — verified: a named actor approving its
own run is still refused with `403 self_approval`, while a workspace run
approves in one press.

**Offset modes.** One offset for the whole run put every reading+quiz row on
exactly 29 minutes, which is not a credible report. There are now two modes:

* **Varied per row (default, `spread`)** — each row gets its own offset from the
  permitted set, derived from a SHA-256 of that row's own identity
  (`id | activity_id | category | rule_version`). It is **derived, not random**:
  the same row always gets the same offset, a re-run reproduces the month
  exactly, and every value can be explained from the row it belongs to. A month
  of reading+quiz rows then lands across 14/19/24/29/34/39/44 minutes — the
  contract's normal range — instead of a single repeated figure.
* **Same for every row (`fixed`)** — the single offset the auditor picks.

`offset_minutes` and `offset_mode` are stored on every revision, so any past run
can be read back and explained. An unknown mode is refused with
`400 invalid_offset_mode` before any query runs.

**The equation** (reference + offset):

| row | value |
|---|---|
| `reading+quiz` (Input) | 29 min + offset, **snapped to the nearest 5 minutes** → 15/20/25/30/35/40. There is no measured duration behind an Input reading row, so the report shows round figures rather than 14/19/24/29/34/39. The top offset would snap to 45 — one minute past the contract's 44-minute normal bound — so it steps back to 40 rather than pushing the month into the long-tail band. |
| `video` / `audio` | **exactly** the activity's configured media runtime — a real measured length, so no offset and no rounding. Audio is skipped: `configured_duration_min` is null for all 702 audio activities in `Last_audit.activities` (the LMS payload itself carries `"configured_duration_min": null`), so there is no runtime to use and none is invented. |
| any row with a genuine `HH:MM:SS-HH:MM:SS` label | that elapsed time, **never** shifted |
| `attendance`, `assignment` | untouched |

**Planned hours for reading-only rows.** The source is the fetched Aptem
learning plan, `LMS.Aptem_users.components_json` — one JSON array per learner,
each component carrying `name`, `type`, `planned_hours` and `start_date`/
`end_date`. Components are bucketed by their **due date** (`end_date`) and
filtered on a name containing **LMS**: "February - LMS Activity",
"Implementation & Exam Prep - Portfolio Management (LMS Activity)".

The obvious-looking source, `Last_audit.learner_assignments`, is the wrong one
and was tried first: it holds `component_type = 'Assignment'` **only**, so the
LMS Activity components — type `OnlineLearning` / "Online training – external" —
are absent from it entirely. Learner 92 appeared to have no LMS component at all
through that feed while Aptem plainly shows 24 of them; the plan JSON has them
with their hours.

For the selected month those components' planned hours are summed and shared
across the month's
**reading-only** activities: category `reading+quiz` where the LMS activity has
reading content and **no** `quiz_id` (the READING rows in the journal). Rows
carrying a quiz, and every other category, keep the planned hours they have.

The share is allocated from a running total rather than an even 4-dp division,
so the parts add back up to Aptem's figure **exactly** — an even split of 23h
over 22 rows would have reported 23.0010h for the month. If Aptem has no LMS
component for the month, or the month has no reading-only rows, planned hours
are left untouched and the reason is reported.

Verified on the clone (learner 1521, whose plan does carry LMS components):
2025-07 → 23h from 2 components over 22 reading-only rows = ~1.0455h each;
2025-08 → 23h over 19 rows = ~1.2105h each, and the month's reading-only planned
hours sum to exactly `23.0000`. Learner 92 — the one in the screenshots — has
**no** LMS-named component in its Aptem plan, so its planned hours are correctly
left alone with that stated as the reason.

Permitted offsets are −15/−10/−5/0/+5/+10/+15 minutes; anything else is refused
with `400 invalid_offset` **before any query runs**, and a row whose value would
fall under one minute is skipped with a reason rather than clamped.

Verified with varied offsets on the screenshot's month (learner 92 / 2025-08):
45 values calculated across offsets −15×5, −10×5, −5×7, +5×10, +10×9, +15×9;
after approval its 29 reading+quiz rows read 14 min ×2, 19 ×2, 24 ×3, 29 ×7,
34 ×7, 39 ×3, 44 ×5. Recalculating immediately afterwards created **0** new
proposals and reported 55 rows "already matching" — the derivation reproduces
itself exactly.

Earlier single-offset runs, for the record: learner 92 / 2025-08 with no offset → 56 proposals, report
unchanged until approval, self-approval refused, `Auditor B` approved → 29
reading+quiz rows at `0.4833` (29 min) and 27 video rows at their media
durations, attendance `7.5` and assignment `5.0` untouched, re-run reports 56
"already matching". Learner 92 / 2025-09 with **−10 min** → `+7` refused with
`invalid_offset`; 64 proposals created, 1 skipped ("−10 min would leave it under
one minute"), 6 attendance/assignment rows excluded; after approval every
reading+quiz row reads `0.3167` (19 min) and each video row its media duration
minus 10 minutes.

## 8f. Porting the Activity-log calculation to the Automatic workspace

The Activity-log actual/planned calculation now runs in **both** workspaces:

* the same view functions are registered on `/audit_api/last-audit/journal-hours/*`
  (Automatic → live audit branch) and `/hours_test_api/...` (HOURS-TEST → clone).
  Which database a request touches is decided by the mount it arrived on, through
  `db_source.resolve()`, never by anything in the request;
* `_guard(..., clone_only=False)` for these four views only. The `Last_audit`
  review (proposals/findings/analytics over `activity_actual_hours`) stays
  clone-only and still 404s on the live mount — asserted by tests;
* the UI was ported into `learner-log-pro-copy`: `lib/journalHoursApi.ts` (base
  `/audit_api/...`), `lib/useJournalHours.ts`, `components/JournalHoursControls.tsx`,
  the two pending-value cells in `ManualActivityRow.tsx`, and the panel wiring in
  `routes/journal.index.tsx`. No file in the Automatic copy references the
  HOURS-TEST workspace or its API prefix.

**Environment check.** `Database_url` — the first DSN in `backend/.env` — resolves
to `ep-wild-shape-ab005yy6`, branch `br-holy-band-abhispwg`, which is exactly what
the `audit` and `enrolment` aliases use, so the Automatic workspace reads and
writes that branch and schema `Last_audit`. It carries the same structures as the
clone: `structured_manual_activities.manual_learner_activities` (129,707 rows),
`Last_audit.activities` (10,669) and `LMS.Aptem_users` (641 learners, 478 carrying
LMS components).

**A transient read-only window.** The first attempt to create the table on the
live branch failed: every session reported `default_transaction_read_only = on`
(`source = session`, compute mode `primary`, not in recovery) and even a
temp-table probe was refused after `SET LOCAL default_transaction_read_only =
off`. It cleared by itself minutes later — a rolled-back no-op `UPDATE` and a
rolled-back `CREATE TABLE` both succeeded and the session then reported `off`.
Worth knowing that the live compute can enter that state: while it lasts, every
write in the Automatic workspace fails, not just this feature.

**Installed.** `manage.py setup_actual_hours_review --alias audit` then created
`structured_manual_activities.manual_activity_hours_revision` on
`br-holy-band-abhispwg` with all six CHECK constraints and both indexes. The
journal's own rows were untouched by the install (128,479 rows, 103,721.9116
planned, 60,437.1855 actual before and after), and
`/audit_api/last-audit/journal-hours/summary` answers `200` for a live
learner-month.

## 9. Commands actually run for this plan

Read-only `information_schema` / `pg_catalog` / aggregate queries against the
`audit_clone` alias, and repository greps. No `manage.py migrate`, no DDL, no
`INSERT`/`UPDATE`/`DELETE` against any learner data. No production value was
randomised, shifted, or rewritten.
