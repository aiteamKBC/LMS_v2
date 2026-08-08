# Enrolment Section — Gap Analysis

**Scope:** enrolment onboarding **reviews** + **compliance documents**, and the database layer beneath them.
**Branch:** `Enrolment_system_V2` (analysed at head `80a8937`) · **Date:** 2026-08-08
**Status:** **P0 complete** — all four fresh-deployment defects fixed, plus §6.10 A, §7.1 and §7.4.
P1 and P2 are not started. See §8 for the ticked checklist and §11 for what shipped.

> **Nothing here has been applied to a live database.** The DDL is in the `apply_*`
> commands and verified by reading and by tests; no command was run against Neon.
> Run `python manage.py apply_enrolment_schema --check` first, then `--dry-run`,
> before applying for real.

---

## 1. Scope & method

Reviewed:

- **Reviews** — `backend/learner_api/review_form.py`, `review_tables.py`, `calendar.py`,
  `frontend/src/pages/learner/onboarding/reviews/*`, `frontend/src/api/reviewForm.ts`
- **Compliance documents** — `apprenticeship_agreement.py`, `ilr_document.py`,
  `training_plan_document.py`, `written_agreement.py`, `backend/enrolment_api/documents.py`,
  `document_tables.py`, the four `frontend/src/lib/*Pdf.ts` builders and
  `frontend/src/pages/learner/compliance/*`
- **Database layer** — `models.py` (both apps), every `apply_*` / `backfill_*` management command,
  all migration directories, `backend/config/settings.py`, `learner_api/routers.py`
- **Surfacing** — `BoardPage.tsx`, `EmployerLearnerPage.tsx`, `employer_portal.py`

Findings marked **VERIFIED** were confirmed by reading the cited source directly. Everything else
comes from a systematic sweep and carries a file:line reference you can check.

### Headline

> **There are zero Django migrations for the enrolment system.** `backend/learner_api/migrations/`
> and `backend/enrolment_api/migrations/` contain only `__init__.py`. Every enrolment table's DDL
> lives in an ad-hoc `apply_*` management command or in a runtime `ensure_*_table()` call executed
> on a request path. This is deliberate — `learner_api/routers.py` returns `False` from
> `allow_migrate` for both apps — but it is the root cause of the two P0 defects below: there is no
> mechanism that guarantees a table's shape matches the model that reads it.

---

## 2. System map

### 2.1 Reviews pipeline

```
Learner books  ──▶  "Coach".coach_calendar_event   (Graph/Teams sync)
                          │  Event_key
                          ▼
                enrolment."Enrolment_Reviews"      one row per booked review
                          │  Review_id
                          ▼
        Review_Eligibility │ Review_RPL │ Review_Health_Safety   (projection, read-only reporting)
```

Three review types, all with forms: `eligibility-review`, `workspace` (RPL & Experience),
`training-plan` (Workplace Health & Safety). Sections are server-defined in
`review_form.py:39-60`. Signing parties: learner, admin, employer. When all required signatures
land, `promote_to_delivery_if_ready` moves the learner from Onboarding into Delivery.

### 2.2 Two parallel compliance-document systems

This is the single biggest structural issue in the section.

| | **System A** — dedicated tables | **System B** — generic index |
|---|---|---|
| Tables | `Apprenticeship_Agreements`, `ILR_Documents`, `Training_Plan_Documents`, `Written_Agreements` | `Enrolment_Documents` |
| Served by | `learner_api` (12 routes) | `enrolment_api/documents.py` (5 routes) |
| DDL | 4 × `apply_*_table` commands | runtime `ensure_enrolment_documents_table()` + 2 ALTER commands |
| PDF | client-side jsPDF, ephemeral | real PDF uploaded to Azure `enrolment-docs` |
| Archived? | **No — nothing is ever stored** | Yes, append-only per generation |
| Signature state | `Fully_signed` per table | `Signed` boolean |

`DOC_TYPES` (System B) already declares `apprenticeship-agreement` and `training-plan` — both of
which now *also* exist as System A tables with independent signature state. **Nothing reconciles
the two.** See G-08.

---

## 3. P0 — breaks on a fresh environment

### P0-1 · `Enrolment_Documents` SELECTs six columns its CREATE TABLE never creates — **VERIFIED**

`backend/enrolment_api/document_tables.py:33-47` creates exactly 13 columns. Not one of them is a
signature column:

```
id, Learner_kind, Learner_id, Learner_name, Doc_type, Doc_name,
Container, Blob_name, Doc_path, Content_type, Size_bytes, Signed, Generated_at
```

`backend/enrolment_api/documents.py:88-92` selects six columns that do not exist there:

```python
SELECT_COLS = (
    'id, "Doc_type", "Doc_name", "Doc_path", "Size_bytes", "Signed", "Generated_at", '
    '"Learner_signed_name", "Learner_signed_at", ("Learner_signature" is not null and "Learner_signature" <> \'\'), '
    '"Employer_signed_name", "Employer_signed_at", ("Employer_signature" is not null and "Employer_signature" <> \'\')'
)
```

Those six exist only if **two further commands are run by hand** — `apply_employer_signing` (+3)
and `apply_document_learner_signature` (+3). Both **bail out when the table is absent**
(`apply_employer_signing.py:86-91` prints an error and continues; `apply_document_learner_signature.py:48-52`
returns).

**Failure sequence on a clean deploy:** first document generated → `ensure_enrolment_documents_table()`
silently creates the *incomplete* table on the request path → every subsequent
`GET /enrolment_api/documents/<kind>/<id>/`, `sign_document` and `replace_document_file`
fails with Postgres `UndefinedColumn` → 502.

**It fails quietly in the worst place.** `employer_portal._document_signing_rows` catches the
`DatabaseError` (`employer_portal.py:252-254`) and degrades to System A rows only — so the employer
portal *looks* healthy while silently dropping its entire document signing queue.

### P0-2 · `Enrolment_Reviews` CREATE omits four columns the model declares — **VERIFIED**

`models.py:1048-1053` declares four employer columns:

```python
employer_signature          = models.TextField(db_column="Employer_signature", blank=True, default="")
employer_signed_name        = models.TextField(db_column="Employer_signed_name", blank=True, default="")
employer_signed_at          = models.DateTimeField(db_column="Employer_signed_at", null=True, blank=True)
employer_signature_required = models.BooleanField(db_column="Employer_signature_required", null=True, blank=True)
```

`apply_enrolment_reviews_table.py` has them in **neither** `CREATE_SQL` (lines 23-63) **nor**
`ADD_COLUMNS` (lines 67-102). They come only from `apply_employer_signing.py:40-48`.

On a fresh database where only the documented command was run, **every** `EnrolmentReview` query
raises `UndefinedColumn` — the whole reviews feature is dead, not degraded.

This directly contradicts the file's own docstring (lines 3-5): *"extending the model later means
adding an ADD COLUMN IF NOT EXISTS line here rather than a hand-run ALTER."* The rule is right; it
was not followed.

### P0-3 · `Created_users` has no fresh-install path — **VERIFIED**

`create_created_users_table.py:197-202` returns early when the legacy `Enrolment_Users` table is
absent — **before** its own `CREATE TABLE` at lines 212-217:

```python
src_cols = self._columns(cur, "Enrolment_Users")
if not src_cols:
    self.stdout.write(self.style.WARNING(f"{SRC} does not exist — cutover already done. Nothing to do."))
    return
# ... CREATE TABLE IF NOT EXISTS {DST} is at line 212, unreachable from here
```

The **core learner table of the entire system** can therefore only ever be created as a side effect
of a one-time legacy cutover. On a clean database, no command and no runtime path creates it.

### P0-4 · Connection-alias split: DDL and DML can target different databases — **VERIFIED**

`EnrolmentRouter` routes every `learner_api` / `enrolment_api` model read and write to the
`enrolment` alias. But these use the **default** alias:

| Runtime modules | Management commands |
|---|---|
| `apprenticeship_agreement.py:31` | `apply_apprenticeship_agreements_table.py:25` |
| `learning_plan.py:21` | `apply_ilr_documents_table.py:16` |
| `absence_reports.py:7` | `apply_training_plans_table.py:17` |
| `training_plan_document.py:111` | `apply_written_agreements_table.py:19` |
| | `apply_document_learner_signature.py:17` |
| | `apply_learning_plan_jsonb.py:19` |

This works **only** because `settings.py:211-251` collapses both resolution chains onto the single
`Database_url` key present in `.env`:

```python
DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("DATABASEURL") or os.environ.get("Database_url")
_enrolment_database_url = (os.environ.get('ENROLMENT_DATABASE_URL') or os.environ.get('Database_url')
                           or os.environ.get('DATABASEURL') or os.environ.get('DATABASE_URL'))
```

Two ways this breaks:

- **Split URLs** — set `ENROLMENT_DATABASE_URL` to a different endpoint and the four document
  tables are created on one database and queried on another → `UndefinedTable` at runtime.
- **`DJANGO_USE_SQLITE=true`** — default becomes SQLite, so `CREATE SCHEMA IF NOT EXISTS enrolment`
  in all four commands is a hard syntax error.

Compounding P0-1: `apply_document_learner_signature` probes `information_schema.columns` on the
*default* connection, so on a split deploy it reports the table as missing and exits — it can never
repair the table it exists to repair.

---

## 4. P1 — data integrity & security

### P1-1 · No authentication on any enrolment endpoint — **VERIFIED**

Grepped `backend/learner_api/` and `backend/enrolment_api/` for
`login_required|permission_classes|IsAuthenticated|authentication_classes|request.user|is_authenticated`.
**Zero matches in either app.**

Every mutating view is `@csrf_exempt` plain Django. The learner is identified purely by a path
integer (`<str:kind>/<int:learner_id>`), and the signing party is taken straight from the request
body. Consequences:

- Anyone who can reach the host can **sign** any learner's statutory Apprenticeship Agreement,
  Training Plan, Written Agreement, ILR or review — as any party — by incrementing an integer.
- Empty-signature posts **withdraw** a sign-off, so signatures can be removed as well as forged.
- Signatures gate `promote_to_delivery_if_ready`, so this drives the learner's programme status.
- `issue_*` needs no authorisation either.

The only authorisation check anywhere in the subsystem is `employer_portal_learner`'s
`learner.employer_id != employer.pk` guard (`employer_portal.py:390`).

**No actor identity is recorded.** Signatures store a free-text name only — no `signed_by_user_id`,
no timestamped audit row, no IP, no user-agent. `BoardPage.tsx:550` supplies
`auth.user?.fullName || 'Enrolment Officer'` client-side, so the literal string
`"Enrolment Officer"` can end up as the recorded signatory of a statutory document.

For statutory apprenticeship paperwork this is the most serious finding in this report.

### P1-2 · No signed copy of any System A document is ever archived

`Apprenticeship_Agreements` carries `Container`, `Blob_name`, `Doc_path`, `Size_bytes`
(`apply_apprenticeship_agreements_table.py:72-75`), read at `apprenticeship_agreement.py:213-215`
and surfaced to the UI as `document.{path, sizeBytes, stored}`. **A repo-wide grep finds no
writer.** `stored` is permanently `false`, `path` permanently `""`.

The DDL comment at lines 69-71 describes behaviour that does not exist: *"The rendered PDF —
Regenerated whenever a signature changes, so the filed document always shows the marks actually on
record."* Nothing in System A renders server-side or uploads to Azure. All four PDFs are jsPDF,
client-side, ephemeral.

**Compliance impact:** the evidence of a signed Apprenticeship Agreement, Training Plan, Written
Agreement or ILR is a base64 image column plus a client-side re-render. If the PDF builder changes,
previously "signed" documents render differently. There is no immutable filed copy for audit.

### P1-3 · No foreign keys, no CHECKs, no uniques

Across the entire `enrolment` schema the **only** real foreign keys are the three
`Review_*.Review_id → Enrolment_Reviews(id) ON DELETE CASCADE` refs
(`apply_review_detail_tables.py:29`).

- Every `(Learner_kind, Learner_id)` pair — across `Extended_ILR`, all 7 `Wizard_*` tables, all 4
  document tables, `Enrolment_Documents`, `Enrolment_Reviews` — is unconstrained. Deleting a learner
  silently orphans every compliance record.
- `Created_users.Employer_id` → `Employers.id` is a bare `integer` by explicit design.
- `Employers.Employer_group_ids` → `Organisations` is a jsonb array.
- **No CHECK on `Status`** (`'active' | 'superseded'`) — a typo'd status escapes the partial unique
  index and creates a second de-facto live document.
- **No CHECK on `Learner_kind`** (`'apprenticeship' | 'commercial'`).
- **No unique constraint** on `Created_users`, `Staff_users`, `Organisations`, `Employers` — nothing
  prevents duplicate learner or staff emails.
- **No timestamps at all** on `Created_users`, despite every other enrolment table having them.
- `Enrolment_Documents` has `Generated_at` only — no `Updated_at` — yet `documents.py:298,362,388`
  update rows in place. A replaced PDF is indistinguishable from the original by timestamp.
- `id uuid PRIMARY KEY` with **no `DEFAULT gen_random_uuid()`** on all four document tables — any
  raw-SQL insert fails on NOT NULL.
- `Fully_signed` is application-maintained with no trigger, so any out-of-band UPDATE desynchronises
  it from the signature columns.
- Detail-table `Review_id` is UNIQUE in SQL but a plain `ForeignKey` in the model
  (`models.py:1087-1092`) — the model permits what the database rejects. Should be `OneToOneField`.

### P1-4 · `Learner_kind` has three contradictory semantics

| Writer/reader | Value used |
|---|---|
| Live booking (`calendar.py:150`) | the **unvalidated URL segment**, which on the learner side comes from `localStorage` (`useMyLearner`, default `commercial:19`) |
| `backfill_enrolment_reviews.py:35-41` | **always `'commercial'`** — `SOURCE_MODELS` maps both kinds to the same model, so the first iteration always matches |
| Employer portal (`employer_portal.py:53-66`) | filters on `_learner_kind(learner)`, derived from the learner's real `learner_type` |

**Net effect:** an apprenticeship-typed learner whose reviews were booked or backfilled as
`commercial` shows **zero reviews** in the employer portal — silently, with no error.

### P1-5 · No server-side completeness check before a review is marked complete

`review_form.py:411-415` sets `Form_completed=True` whenever `finish` is truthy, regardless of
`Section_status`. `form.tsx:883` offers Finish unconditionally. A review can therefore be marked
complete — and so become signable, PDF-exportable, and count toward delivery promotion — **with
every panel blank**.

### P1-6 · Signature payloads are not validated as images

`enrolment_review_sign` accepts any `data:image/*` prefix (`review_form.py:473`). Stored values are
returned raw by `_signatures()` and rendered directly into `<img>` by `form.tsx:839` and into
`doc.addImage(..., 'PNG', ...)` by the PDF builders. Combined with P1-1, an attacker-supplied
`data:image/svg+xml,...` would be stored and rendered.

---

## 5. P2 — correctness, consistency, dead code

| ID | Finding | Location |
|---|---|---|
| G-01 | **`baselineY` is undefined** — the parameter is `lineY`. Sits in the `catch` branch for a corrupt signature, so it throws exactly when meant to recover. Implies this file is not being type-checked. **VERIFIED** | `reviewDocument.ts:250,266` |
| G-02 | Staff→form navigation 404s. `BoardPage` links to a learner-scoped route resolved from `localStorage`; backend scopes by `event_key` **and** `learner_id`, so a mismatch 404s | `BoardPage.tsx:1068`, `form.tsx:371` |
| G-03 | The shared form page hardcodes `party="learner"` — staff who do reach it would write the learner's signature | `form.tsx:859` |
| G-04 | Orphaned modules silently reduce the statutory OTJ hours figure. `_plan_modules` drops non-catalogue modules; `learning_plan._serialize` keeps them **with their hours**. The plan editor and the frozen agreement disagree, with no warning | `apprenticeship_agreement.py:100`, `training_plan_document.py:75` vs `learning_plan.py:155-158` |
| G-05 | 13 `"Learner"` schema tables have **no DDL anywhere in the repo** — `Active_users`, `Unactive_users`, `learners`, `Absence`, the progress/quiz/training-plan tables. Their shape exists only in live Neon, yet code ALTERs them assuming they exist | `models.py:804-960` |
| G-06 | `EnrolmentUser.start_date`/`end_date` declared **twice** — `DateField` at 192-193, silently overridden by `TextField` at 222-223. `ActiveUser`/`UnactiveUser` type the same columns as `DateField` | `models.py:192-193, 222-223` |
| G-07 | `Created_users."Learning_plan"` created as `text` but mapped as `SafeJSONField`; reconciled only if `apply_learning_plan_jsonb` is run. 17 other columns use `json`, not `jsonb` (no equality operator, no GIN) | `create_created_users_table.py:103,122-140` |
| G-08 | Two overlapping document systems drifting. `written-agreement` is emitted to the employer UI but **rejected by `DOC_TYPES` with 400**; `extended-ilr` and `ILR_Documents` both represent the ILR; nothing reconciles `Signed` with `Fully_signed` | `documents.py:39-48,96-98` vs `employer_portal.py:202` |
| G-09 | `include_saved` is a dead parameter — the documents list ships full signature PNGs (up to 400 KB × 3 parties × N reviews) for a view that renders only tick marks | `review_form.py:254`, `BoardPage.tsx:940-988` |
| G-10 | `_serialize_form`'s `event` argument is unused, yet `_lookup` issues a `CoachCalendarEvent` query on **every** GET, PATCH and sign | `review_form.py:289,339` |
| G-11 | `Learner_kind` is `text` in `Extended_ILR`/`Enrolment_Reviews` but `varchar(32)` in the 7 wizard and 4 document tables | multiple |
| G-12 | Party naming inconsistent for the same human: `"apprentice"` on the Agreement/Training Plan, `"learner"` on the ILR/Written Agreement. The frontend branches on document kind to compensate | `compliance/page.tsx:167-170` |
| G-13 | Naming chaos: leading-space `" Status"`, `" English_Assessments"`; trailing-space `"Username "` on `Active_users` but not `Unactive_users` (so archive/restore must translate); misspelled `"Orgnization"`; a 63-char truncated column name | `models.py:183,209,815`, `create_created_users_table.py:142` |
| G-14 | Stale references — `models.py:176,314` cite `merge_commercial_into_enrolment` and `:235` cites `apply_aptem_create_columns`. **Neither command exists** | `models.py` |
| G-15 | The learner compliance page does not surface enrolment reviews at all; once a learner leaves Onboarding the nav disappears and reviews become unreachable | `compliance/page.tsx` |
| G-16 | `frontend/src/pages/compliance/enrolment-review/page.tsx` is **100% mock data** and is a different concept (a 15-item checklist) from `Enrolment_Reviews` | `@/mocks/enrolment-review` |
| G-17 | DDL in the four table commands runs unwrapped, statement by statement. A failure between CREATE and CREATE INDEX leaves the table **without its uniqueness guarantee**. Only `apply_employer_signing` uses `transaction.atomic()` | `apply_*_table.py` |
| G-18 | `--drop` issues a bare `DROP TABLE` with no confirmation and no `--force`; only a help string warns "development only" | all four commands |
| G-19 | Error responses return the raw `DatabaseError` string, leaking schema and connection detail in a 502 body | `review_form.py:352,419,546` |
| G-20 | Dead code: `ALL_SECTIONS` (computed, never used); `MAX_SIGNATURE_CHARS` imported but unused in `employer_portal.py` and redeclared as `400_000` in **six** modules; `mappers._review_groups()` → `board.reviewDocuments` never read; `frontend/src/api/complianceDocuments.ts` has no importers | multiple |
| G-21 | **Zero test coverage.** `learner_api/tests.py` (497 lines) never imports `review_form`, `review_tables`, `EnrolmentReview` or any of the four documents. `enrolment_api/tests.py` is a 3-line stub | — |
| G-22 | `audit_api/views.py:2404` creates `unique (learner_id, programme_key, report_month, signer_role)` then lines 2422-2436 delete down to one row per learner and add `unique (learner_id)` — silently destroying the multi-month history the first constraint was designed to hold | `audit_api/views.py` |

---

## 6. Required database changes

Everything below is additive and idempotent unless flagged. Ordered by priority.

### 6.1 — P0 · Add the four employer columns to the reviews table

**Owner file:** `backend/learner_api/management/commands/apply_enrolment_reviews_table.py`

Add to `CREATE_SQL` (after the `Admin_signed_at` line):

```sql
    "Employer_signature"          text,
    "Employer_signed_name"        text,
    "Employer_signed_at"          timestamptz,
    "Employer_signature_required" boolean,
```

Add to `ADD_COLUMNS` so existing databases are patched on re-run:

```python
    # Third signing party: the learner's employer (see EnrolmentReview.employer_signature).
    ('"Employer_signature"', "text"),
    ('"Employer_signed_name"', "text"),
    ('"Employer_signed_at"', "timestamptz"),
    ('"Employer_signature_required"', "boolean"),
```

Add to `INDEXES_SQL`:

```sql
CREATE INDEX IF NOT EXISTS enrolment_reviews_employer_signed_idx
    ON enrolment."Enrolment_Reviews" ("Employer_signed_at");
```

This makes `apply_employer_signing` redundant for this table — leave it in place (it is idempotent)
but the canonical definition now lives in one file, as its docstring always intended.

### 6.2 — P0 · Add the six signature columns to the documents base DDL

**Owner file:** `backend/enrolment_api/document_tables.py`

Add inside the `create table if not exists` block (before `"Generated_at"`):

```sql
                "Learner_signature"    text,
                "Learner_signed_name"  text,
                "Learner_signed_at"    timestamptz,
                "Employer_signature"   text,
                "Employer_signed_name" text,
                "Employer_signed_at"   timestamptz,
```

Because the function runs `create table if not exists`, existing databases are unaffected — so also
add the defensive `ALTER`s to the same function so it self-heals:

```sql
alter table enrolment."Enrolment_Documents" add column if not exists "Learner_signature"    text;
alter table enrolment."Enrolment_Documents" add column if not exists "Learner_signed_name"  text;
alter table enrolment."Enrolment_Documents" add column if not exists "Learner_signed_at"    timestamptz;
alter table enrolment."Enrolment_Documents" add column if not exists "Employer_signature"   text;
alter table enrolment."Enrolment_Documents" add column if not exists "Employer_signed_name" text;
alter table enrolment."Enrolment_Documents" add column if not exists "Employer_signed_at"   timestamptz;
```

`ADD COLUMN IF NOT EXISTS` is a cheap catalogue lookup and this function is guarded by the `_READY`
module flag, so it runs at most once per process.

### 6.3 — P0 · Add an `Updated_at` column to `Enrolment_Documents`

```sql
alter table enrolment."Enrolment_Documents"
    add column if not exists "Updated_at" timestamptz not null default now();
```

Required so a replaced PDF (`documents.py:296-303`) is distinguishable from the original.

### 6.4 — P0 · Give `Created_users` a fresh-install path

**Owner file:** `backend/learner_api/management/commands/create_created_users_table.py`

Move the `CREATE TABLE IF NOT EXISTS {DST}` block (lines 208-217) **above** the
`if not src_cols: return` guard at 197-202, so the command creates the table on a clean database and
only *skips the copy step* when there is no legacy source. Recommended shape:

```python
# 1. create — always, whether or not there is a legacy table to copy from
cur.execute(f'CREATE TABLE IF NOT EXISTS {DST} (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, {col_defs})')

# 2. copy — only if the legacy table is still present
src_cols = self._columns(cur, "Enrolment_Users")
if not src_cols:
    self.stdout.write(self.style.WARNING(f"{SRC} does not exist — cutover already done. Table ensured; nothing to copy."))
    return
```

Then rename the command, or add a thin `apply_created_users_table` alias, so its name reflects that
it is now an install path and not only a cutover.

### 6.5 — P1 · Missing constraints

Apply after auditing existing rows — several of these will fail on dirty data, which is the point.

```sql
-- Status domain (all four document tables)
ALTER TABLE enrolment."Apprenticeship_Agreements"
    ADD CONSTRAINT apprenticeship_agreements_status_chk
    CHECK ("Status" IN ('active', 'superseded'));
-- repeat for "ILR_Documents", "Training_Plan_Documents", "Written_Agreements"

-- Learner_kind domain (all tables carrying it)
ALTER TABLE enrolment."Enrolment_Reviews"
    ADD CONSTRAINT enrolment_reviews_learner_kind_chk
    CHECK ("Learner_kind" IN ('apprenticeship', 'commercial'));
-- NOTE: run the P1-4 cleanup first — live booking writes an unvalidated URL segment,
-- so existing rows may hold values outside this domain.

-- UUID default, so raw-SQL inserts are possible (all four document tables)
ALTER TABLE enrolment."Apprenticeship_Agreements"
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Learner identity: one canonical email per learner / staff member
CREATE UNIQUE INDEX IF NOT EXISTS created_users_email_uniq
    ON enrolment."Created_users" (lower("Email")) WHERE "Email" IS NOT NULL AND "Email" <> '';
CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_uniq
    ON enrolment."Staff_users" (lower("Email")) WHERE "Email" IS NOT NULL AND "Email" <> '';

-- Audit timestamps on the core learner table
ALTER TABLE enrolment."Created_users"
    ADD COLUMN IF NOT EXISTS "Created_at" timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS "Updated_at" timestamptz NOT NULL DEFAULT now();
```

**Foreign keys** — add once `Created_users` is guaranteed to exist (§6.4).

**The delete action matters, and it is not the same for every table.** Cascading a learner deletion
into signed statutory paperwork would destroy the only record that the agreement was signed — the
exact problem P1-2 raises. Split them:

```sql
-- Statutory paperwork: BLOCK learner deletion while signed records exist.
-- Applies to Enrolment_Reviews, Enrolment_Documents and all four document tables.
ALTER TABLE enrolment."Enrolment_Reviews"
    ADD CONSTRAINT enrolment_reviews_learner_fk
    FOREIGN KEY ("Learner_id") REFERENCES enrolment."Created_users"(id) ON DELETE RESTRICT;

-- Wizard scratch data: safe to cascade, it is working state not evidence.
-- Applies to Extended_ILR and the 7 Wizard_* tables.
ALTER TABLE enrolment."Wizard_Personal_Details"
    ADD CONSTRAINT wizard_personal_details_learner_fk
    FOREIGN KEY ("Learner_id") REFERENCES enrolment."Created_users"(id) ON DELETE CASCADE;
```

`RESTRICT` forces an explicit decision — archive or supersede the paperwork first — rather than
silently deleting it. Note this also means learner deletion becomes a multi-step operation; the
`Active_users`/`Unactive_users` archive pattern already in use is the model to follow.

Audit for orphan rows before applying any of these — they will fail otherwise, which is the desired
signal.

### 6.6 — P1 · Keep `Fully_signed` honest

`Fully_signed` is application-maintained by `recalculate_signed()`. Either make it a generated
column, or add a trigger, or drop it and compute it in the view. Generated column is cleanest —
example for the two-party Apprenticeship Agreement:

```sql
ALTER TABLE enrolment."Apprenticeship_Agreements" DROP COLUMN "Fully_signed";
ALTER TABLE enrolment."Apprenticeship_Agreements"
    ADD COLUMN "Fully_signed" boolean GENERATED ALWAYS AS (
        "Apprentice_signature" IS NOT NULL AND "Apprentice_signature" <> ''
        AND "Employer_signature" IS NOT NULL AND "Employer_signature" <> ''
    ) STORED;
```

The three-party tables (`Training_Plan_Documents`, `Written_Agreements`) take the same shape with a
third conjunct. This makes out-of-band UPDATEs impossible to desynchronise.

> ⚠️ **This DDL must not be applied on its own.** Postgres rejects any INSERT or UPDATE that supplies
> a value for a `GENERATED ALWAYS ... STORED` column, and all four models declare `fully_signed` as a
> concrete `BooleanField` that Django writes on **every** `save()`. Apply the SQL without the model
> change and the entire issue/sign flow starts returning 500.
>
> Pair it with one of:
> - replace the `BooleanField` with `models.GeneratedField` — already used in this codebase for
>   `LearnerProfile.email_normalized` (`models.py:391`), so the pattern is established; **or**
> - drop `fully_signed` from the model entirely and delete the four `recalculate_signed()` methods
>   and their call sites, reading the value through a plain `.only()`/raw select.

### 6.7 — P1 · Model correction (no DDL)

`_ReviewDetail.review` is a `ForeignKey` but `Review_id` is UNIQUE in SQL. Change to
`OneToOneField` at `models.py:1087-1092` so the model matches the database.

### 6.8 — P2 · Type reconciliation

```sql
-- Learning_plan is read as JSON but stored as text
ALTER TABLE enrolment."Created_users"
    ALTER COLUMN "Learning_plan" TYPE jsonb USING "Learning_plan"::jsonb;
-- (this is what apply_learning_plan_jsonb.py:99 already does — fold it into the install path)

-- json → jsonb for the 17 operational columns, so they support equality and GIN
ALTER TABLE enrolment."Created_users"
    ALTER COLUMN "<column>" TYPE jsonb USING "<column>"::jsonb;

-- Learner_kind: text → varchar(32) to match the 11 sibling tables
-- NOTE: run the P1-4 cleanup first. Live booking writes an unvalidated URL segment into this
-- column, so a row longer than 32 chars will make this ALTER fail. Check before applying:
--   SELECT DISTINCT "Learner_kind", length("Learner_kind") FROM enrolment."Enrolment_Reviews";
ALTER TABLE enrolment."Enrolment_Reviews" ALTER COLUMN "Learner_kind" TYPE varchar(32);
ALTER TABLE enrolment."Extended_ILR"      ALTER COLUMN "Learner_kind" TYPE varchar(32);
```

### 6.9 — P2 · Redundant indexes

All four document tables carry both a partial unique index on `("Learner_kind","Learner_id") WHERE
"Status"='active'` and a plain index on the same leading columns. The plain index only helps for
`Status <> 'active'` lookups, which no code performs. Drop the four plain indexes.

### 6.10 — Structural recommendation: one owner for this DDL

The two P0 defects share one root cause — a table's shape is defined in one file and consumed in
another, with nothing checking they agree. Two viable fixes:

**Option A — an umbrella command (smaller change, recommended first).**
Add `apply_enrolment_schema`, which calls every `apply_*` command in dependency order and fails loudly
if any step is skipped. This removes the unenforced ordering between `apply_*_table` and
`apply_employer_signing` / `apply_document_learner_signature`, and gives deployment a single
documented step.

**Option B — adopt Django migrations for the `enrolment` schema (correct long-term).**
The models are already `managed = False` and `routers.allow_migrate` returns `False`. Moving to
`managed`-with-migrations would make `makemigrations --check` a CI gate that catches exactly the
model/DDL divergence behind P0-1 and P0-2. Larger change; needs the 13 undocumented `"Learner"`
tables (G-05) reverse-engineered into an initial migration first.

Either way, **stop creating tables on the request path.** `ensure_enrolment_documents_table()` runs
DDL during a user request, which is how the incomplete `Enrolment_Documents` table gets created in
the first place.

---

## 7. Required configuration changes

### 7.1 — Fix the mixed-case Azure env key

`settings.py:326` reads a mixed-case key while every sibling at lines 315-320 is UPPERCASE:

```python
AZURE_ENROLMENT_DOCS_CONTAINER = os.environ.get("AZURE_Enrolment_Docs_CONTAINER", "enrolment-docs")
```

Environment variables are case-sensitive on Linux, so an ops-set `AZURE_ENROLMENT_DOCS_CONTAINER` is
**silently ignored** and the default is used. `EVIDENCE_CLOUD.md:33` already flags case-mismatch as a
bug that has bitten this project. Read both keys during the transition:

```python
AZURE_ENROLMENT_DOCS_CONTAINER = (
    os.environ.get("AZURE_ENROLMENT_DOCS_CONTAINER")
    or os.environ.get("AZURE_Enrolment_Docs_CONTAINER")
    or "enrolment-docs"
)
```

### 7.2 — Make the two-database assumption explicit

`.env` currently sets only `Database_url`, so `default` and `enrolment` collapse to one endpoint and
the P0-4 alias split is invisible. Either:

- **Unify the code** — change the ten default-alias sites listed in P0-4 to `connections["enrolment"]`
  (preferred; makes the aliases genuinely independent), **or**
- **Assert the assumption** — fail loudly at startup if `DATABASES['default']` and
  `DATABASES['enrolment']` do not point at the same host while default-alias DDL still exists.

Also document that `DJANGO_USE_SQLITE=true` is incompatible with every `apply_*` command, since
`CREATE SCHEMA` is not valid SQLite.

### 7.3 — Command run order — ✅ DONE (superseded by §6.10 Option A)

**One step now:**

```
python manage.py apply_enrolment_schema             # apply
python manage.py apply_enrolment_schema --check     # report only, change nothing
python manage.py apply_enrolment_schema --dry-run   # rehearse each step, roll back
```

`apply_enrolment_schema` runs all 16 schema commands in dependency order, stops at
the first failure (later steps depend on earlier ones, so continuing would hide the
cause behind a cascade), and prints an applied/skipped/failed summary. Every
underlying command is idempotent, so re-running is safe. It refuses to start under
`DJANGO_USE_SQLITE` or without the `enrolment` alias rather than failing halfway.

The order it enforces:

```
apply_created_users_table                 # core learner table — everything keys off its ids
apply_staff_users_table
apply_employer_tables
apply_created_users_employer_id
apply_learning_plan_jsonb
apply_extended_ilr_table
apply_enrolment_wizard_tables
apply_enrolment_reviews_table
apply_review_detail_tables                # FK -> Enrolment_Reviews
apply_enrolment_documents_table           # NEW: deploy-time path, was request-path only
apply_apprenticeship_agreements_table
apply_ilr_documents_table
apply_training_plans_table
apply_written_agreements_table
apply_employer_signing                    # needs the reviews table to exist
apply_document_learner_signature          # needs Enrolment_Documents to exist
```

The last two were the unenforced ordering dependency behind P0-1 and P0-2. Both
still skip silently when their target is missing, but the P0 fixes mean neither is
load-bearing any more: the columns they add are now in the owning tables' own DDL.

### 7.4 — Baseline security settings

`SECRET_KEY` is the hardcoded `django-insecure-…` default and `DEBUG` defaults to `true`
(`settings.py:99-102`). Both must be environment-driven before this section is exposed beyond the
dev network — particularly given P1-1.

### 7.5 — `search_path` is never set

Schema qualification depends entirely on the `db_table = 'schema"."Table'` quoting trick
(`models.py:14-18`) and literal `enrolment."X"` strings in raw SQL. This is a deliberate choice to
avoid a startup option the Neon pooler may reject — worth recording so nobody "fixes" it — but it
means a missing quote silently resolves against `public`.

---

## 8. Remediation order

**P0 — before any fresh deployment** — ✅ **COMPLETE**

- [x] 6.1 Four `Employer_*` columns → `apply_enrolment_reviews_table.py` — commit `7a230a1`
- [x] 6.2 Six signature columns → `document_tables.py` base DDL + self-healing ALTERs — commit `becd1a3`
- [x] 6.3 `Updated_at` on `Enrolment_Documents` — commit `becd1a3`
- [x] 6.4 `Created_users` fresh-install path — commit `3c6879a`
- [x] 7.2 / P0-4 Connection-alias unification — **narrowed, see note below**
- [x] 7.3 Document the command run order — superseded by `apply_enrolment_schema` (§6.10 A)
- [x] 6.10 A `apply_enrolment_schema` umbrella command
- [x] 7.1 Azure env key dual-read
- [x] 7.4 `SECRET_KEY` env-driven with a production guard

> **P0-4 was narrowed on evidence.** §7.2 called for all ten default-alias sites to
> move to `connections["enrolment"]`. Only **six** did — the commands that create
> `enrolment.*` tables. The other four read `curriculum.*` and `"Learner".*`, schemas
> the router does not govern: `curriculum` is owned by `curriculum_api`, whose 11
> migrations run on `default`. Moving them would break precisely when the aliases
> diverge, which is the failure P0-4 warns about. Each now carries a comment saying
> so, and `learner_api/checks.py` raises `W002` if the aliases ever do diverge —
> the invariant is asserted rather than assumed.
>
> Fixing the alias also surfaced a latent bug: `apply_learning_plan_jsonb` wrapped its
> `ALTER` in a bare `transaction.atomic()`, which opens on `default`. With the cursor
> moved to `enrolment` the DDL would have sat outside the block it appears to be
> inside, so `--dry-run` would not have rolled it back.

**P1 — before wider exposure**

- [ ] P1-1 Authentication + authorisation on all enrolment endpoints; record `signed_by_user_id`, IP, user-agent
- [ ] P1-2 Decide the archival story — either render and store signed PDFs server-side, or remove the four dead columns and the `stored` flag that implies they work
- [ ] 6.5 CHECKs, uniques, FKs, `Created_users` timestamps
- [ ] 6.6 `Fully_signed` as a generated column
- [ ] P1-4 Settle `Learner_kind` on one derivation (the learner's own `learner_type`) and backfill
- [ ] P1-5 Server-side completeness check before `Form_completed`
- [ ] P1-6 Validate signature payloads as PNG, not any `data:image/*`
- [ ] 6.7 `ForeignKey` → `OneToOneField` on the review detail models

**P2 — quality and consistency**

- [ ] G-01 Fix `baselineY`; get this file into the type-check
- [ ] G-02 / G-03 Fix staff→form navigation and the hardcoded `party="learner"`
- [ ] G-04 Propagate orphaned modules into the frozen OTJ totals, or warn
- [ ] G-08 Reconcile the two document systems — pick one owner per document type
- [ ] 6.8 / 6.9 Type reconciliation; drop the four redundant indexes
- [ ] G-17 Wrap the four table commands in `transaction.atomic()`
- [ ] G-19 Stop returning raw `DatabaseError` strings to clients
- [ ] G-21 Test coverage for issue / supersede / sign / withdraw / promote
- [ ] G-05 Reverse-engineer the 13 undocumented `"Learner"` tables into checked-in DDL

---

## 9. By design — NOT gaps

Do not "fix" these. Each is deliberate and commented as such in source.

- **~30 intentionally blank fields** across the four documents — an enrolment officer completes them.
  Apprenticeship Agreement: standard level/version. ILR: `learnerReferenceNumber`, `ethnicity`,
  `employmentStatus`, `jobTitle`, `edrsErn` and 9 more (`ilr_document.py:22-23`: *"Fields we hold no
  source for are left blank rather than guessed"*). Training Plan: `level`, `jobTitle`, all EPA
  fields. Written Agreement: all 15 cost lines, `fundingBandValue`, all EPA fields.
- **No demotion when a signature is withdrawn.** `promote_to_delivery_if_ready` only moves forward
  (`learning_plan.py:323-325`). Removing a signature leaves the learner in Delivery — intentional.
- **`Enrolment_Documents` is append-only with no `(Learner_kind, Learner_id, Doc_type)` unique.**
  Regenerating inserts a new row so a signed-and-filed copy is never overwritten; "the current ILR"
  is the newest row. Documented at `document_tables.py:16-18`.
- **No provider signature on the Apprenticeship Agreement.** It is an apprentice↔employer contract;
  the provider is not a party. Correct per statute.
- **The Written Agreement is signed by learner/employer/provider** even though the printed template
  names employer/EPAO/provider — a deliberate, documented deviation (`written_agreement.py:9`).
- **Raw SQL rather than migrations for the Neon schemas** is a standing architectural choice
  (`routers.py` docstring). §6.10 questions it, but it is not an accident.
- **The `db_table = 'schema"."Table'` quoting trick** avoids a `search_path` startup option the Neon
  pooler may reject (`models.py:14-18`).
- **The coach progress-review subsystem** (`pages/coach/progress-reviews/`) is a *different* feature
  storing answers on `CoachCalendarEvent.review_responses`. Not in scope; do not merge with
  `Enrolment_Reviews`.

---

## 10. What shipped for P0

| Commit | Finding | Files |
|---|---|---|
| `7a230a1` | P0-2 | `apply_enrolment_reviews_table.py`, `tests_enrolment_schema.py` (new) |
| `becd1a3` | P0-1, 6.3 | `document_tables.py`, `apply_enrolment_documents_table.py` (new), `tests_document_schema.py` (new) |
| `3c6879a` | P0-3 | `create_created_users_table.py`, `apply_created_users_table.py` (new) |
| pending | P0-4, 6.10 A, 7.1, 7.4 | 6 × `apply_*` commands, `checks.py` (new), `apps.py`, `apply_enrolment_schema.py` (new), `settings.py`, 4 × comment-only |

**New files**

- `backend/learner_api/checks.py` — Django system checks for the two-database
  invariant. `W002` aliases diverged, `W001` `enrolment` alias missing, `W003`
  `DJANGO_USE_SQLITE` set for a schema command. Warnings, not errors: a split may be
  a planned migration, and silence is the failure mode worth removing, not startup.
- `backend/learner_api/management/commands/apply_enrolment_schema.py` — §6.10 A.
- `backend/learner_api/management/commands/apply_created_users_table.py` — install alias.
- `backend/enrolment_api/management/commands/apply_enrolment_documents_table.py` —
  deploy-time path for a table that previously only ever existed via a request.
- `backend/learner_api/tests_enrolment_schema.py`,
  `backend/enrolment_api/tests_document_schema.py` — 22 tests.

**Testing.** G-21 is listed under P2, but P0-1 and P0-2 were both "the DDL and the
model disagreed and nothing noticed", so the tests shipped with the fixes. They parse
the DDL as text and compare it against the model's own field list — `SimpleTestCase`,
no database, so they run under `DJANGO_USE_SQLITE` and in CI without Neon. A check
that needs a live Neon connection would not get run, which is how these defects
survived. Each was confirmed to fail against the pre-fix code before being kept.

Suite: **50 tests**, up from 28. The 1 failure + 1 error are pre-existing in
`LearnerActivityFeedFallbackTests` and unrelated to enrolment — same as baseline.

**Two tests were wrong first and got narrowed, not deleted:**

- `ADD_COLUMNS` coverage flagged four original-release columns. Correct behaviour:
  they are `NOT NULL` with no default, and `ADD COLUMN NOT NULL` without a default
  fails on a non-empty table. Exempted, with a second test asserting the exemption
  stays valid if any of them gains a default.
- The signature-column check swept in `Signed`, the original summary flag that no
  deployed database is missing. Scoped to the per-party columns.

**Not done, and why:** every P1 and P2 item. P1-1 (no authentication on any enrolment
endpoint) is the most serious finding in this report and is a design decision about
which auth mechanism this codebase adopts, not a patch — it needs its own scoping.

---

## 11. Appendix — finding index

| ID | Severity | Title | Primary location |
|---|---|---|---|
| P0-1 | P0 | `Enrolment_Documents` selects 6 uncreated columns | `document_tables.py:33-47` / `documents.py:88-92` |
| P0-2 | P0 | `Enrolment_Reviews` CREATE omits 4 model columns | `apply_enrolment_reviews_table.py:23-102` |
| P0-3 | P0 | `Created_users` has no fresh-install path | `create_created_users_table.py:197-202` |
| P0-4 | P0 | Connection-alias split | 10 sites; `settings.py:211-251` |
| P1-1 | P1 | No authentication on any enrolment endpoint | `learner_api/`, `enrolment_api/` |
| P1-2 | P1 | No signed copy archived; 4 dead columns | `apply_apprenticeship_agreements_table.py:72-75` |
| P1-3 | P1 | No FKs / CHECKs / uniques / timestamps | schema-wide |
| P1-4 | P1 | `Learner_kind` has 3 contradictory semantics | `calendar.py:150`, `backfill_enrolment_reviews.py:35-41` |
| P1-5 | P1 | No completeness check before `Form_completed` | `review_form.py:411-415` |
| P1-6 | P1 | Signature payloads not validated as images | `review_form.py:473` |
| G-01 | P2 | `baselineY` undefined | `reviewDocument.ts:266` |
| G-02 | P2 | Staff→form navigation 404s | `BoardPage.tsx:1068` |
| G-03 | P2 | Form hardcodes `party="learner"` | `form.tsx:859` |
| G-04 | P2 | Orphaned modules reduce OTJ hours silently | `apprenticeship_agreement.py:100` |
| G-05 | P2 | 13 `"Learner"` tables have no DDL in repo | `models.py:804-960` |
| G-06 | P2 | `start_date`/`end_date` declared twice | `models.py:192-193, 222-223` |
| G-07 | P2 | `text`/`json` vs `jsonb` mismatches | `create_created_users_table.py:103,122-140` |
| G-08 | P2 | Two document systems drifting | `documents.py:39-48` |
| G-09 | P2 | Documents list ships full signature PNGs | `review_form.py:254` |
| G-10 | P2 | Dead `event` arg drives a query per request | `review_form.py:289,339` |
| G-11 | P2 | `Learner_kind` type inconsistent | multiple |
| G-12 | P2 | Party naming inconsistent | `compliance/page.tsx:167-170` |
| G-13 | P2 | Column-name chaos | `models.py:183,209,815` |
| G-14 | P2 | Stale command references | `models.py:176,235,314` |
| G-15 | P2 | Reviews unreachable after Onboarding | `compliance/page.tsx` |
| G-16 | P2 | Compliance enrolment-review page is mock data | `pages/compliance/enrolment-review/` |
| G-17 | P2 | Table DDL not transactional | `apply_*_table.py` |
| G-18 | P2 | `--drop` has no confirmation | `apply_*_table.py` |
| G-19 | P2 | Raw `DatabaseError` leaked to clients | `review_form.py:352,419,546` |
| G-20 | P2 | Dead code across 6 modules | multiple |
| G-21 | P2 | Zero test coverage | `tests.py` |
| G-22 | P2 | Audit signoff table: contradictory uniques | `audit_api/views.py:2404,2422-2436` |
