# System-wide Audit Trail — architecture and coverage assessment

Status: **assessment complete; reading half delivered, writing half outstanding.**
Nothing here has been applied to a database — the one SQL file is written and
unapplied. No migration exists. No existing write path has been modified, and no
business logic has changed.

This is the answer to "what would it take to run the Curriculum Audit Trail
across the whole LMS", written before anything was changed, because the shape of
the answer depends on facts about this codebase that are not obvious from the
outside — chiefly that the five database aliases are not five databases.

---

## 1. Database ownership — verified, not assumed

`config/settings.py` builds up to five aliases. They are **not** five physical
databases, and that single fact decides the whole outbox design.

| Alias | Physical database | Written by | Writable? | Django migrations |
|---|---|---|---|---|
| `default` | Primary Neon database (`DATABASE_URL`) | `curriculum_api`, `coach_api`, `engagement_api`, `quiz_api`, `chat`, `progress_reviews_api`, `old_otjh`, `django.contrib.*` | Yes | Yes |
| `enrolment` | **The same physical Neon database as `default`** | `learner_api`, `enrolment_api`, `login` (routed by `EnrolmentRouter`) | Yes | Never — `allow_migrate` returns `False`, all models `managed = False` |
| `audit` | **The same physical Neon database as `enrolment`** | `audit_api`, `login.admin_evidence` — raw cursors resolved through `audit_api/db_source.py` | Yes (hours edits) | Never |
| `audit_clone` | A separate Neon **branch** — the HOURS-TEST sandbox | `audit_api` mounted under `/hours_test_api/` | Yes, deliberately isolated from live data | Never |
| `kbc_attendance` | The AiTeamKBC database (`public.kbc_attendance`) | `audit_api` | **No — read-only**, verified: every access is a `SELECT FROM` | Never |

Two sources confirm the collapsing:

* `config/settings.py:543-551` — `ENROLMENT_DATABASE_URL` falls back through
  `Database_url` / `DATABASEURL` to `DATABASE_URL`, and the comment beside the
  test-database override states plainly that "`default` and `enrolment` are
  usually the same Neon database".
* `audit_api/db_source.py:14-18` — "`audit` and `enrolment` are two aliases over
  the same physical Neon database".

### What follows from that

**There is one writable production database.** `default`, `enrolment` and
`audit` are three names for it. So the audit outbox does not need a distributed
transaction, a two-phase commit or a dual-write: the outbox row can be inserted
**inside the same transaction as the business write**, on the same connection,
and is therefore atomic with it by construction. If the write rolls back, the
outbox row rolls back with it. If the process dies after commit, the outbox row
is already durable and the relay picks it up.

Two aliases sit outside that:

* `kbc_attendance` — read-only. Nothing to audit.
* `audit_clone` — the HOURS-TEST sandbox, whose entire purpose is that nothing
  written in it reaches live data. Its writes are recorded, on a best-effort
  `on_commit` rather than through the outbox, and tagged `sandbox` so they can
  never be read as changes to live records. Routing them through the outbox
  would mean a cross-database insert — exactly the dual-write this design avoids
  — to make a sandbox's edits look as durable as production's.

---

## 2. Transaction management — what is there today

* **`ATOMIC_REQUESTS` is not set.** There is no implicit per-request
  transaction; each handler opens its own.
* **236 `transaction.atomic()` sites** across the apps
  (`learner_api` 78, `curriculum_api` 71, `login` 28, `audit_api` 17,
  `manual_audit_api` 14, `coach_api` 13, `chat` 6, `engagement_api` 5,
  `enrolment_api` 4, `quiz_api` 4, `old_otjh` 1).
* **`curriculum_api/versioning.py` already solves the rollback problem
  correctly**, and its solution is the one to generalise:
  * `record_rows()` buffers into a thread-local, keyed by entity identity, so a
    save that rewrites the same row many times produces one revision.
  * `arm_flush()` registers `transaction.on_commit(flush_pending)` when inside
    an atomic block, and calls it directly when not. A rollback drops the
    callback and the buffer is discarded — the log can never claim a change that
    did not commit.
  * `flush_pending()` writes inside a nested `atomic()` (a SAVEPOINT) so a
    failed history write cannot poison the caller's transaction.

**The one gap in that mechanism:** `arm_flush` calls
`transaction.on_commit(flush_pending)` with no `using=`, which registers against
`default`. A write committed on `enrolment` would fire the callback at the wrong
commit boundary. In production the two aliases are the same database so this has
never bitten, but the shared layer must pass `using=` explicitly rather than
inherit a latent bug.

---

## 3. Write-path inventory

Counted across all non-test Python in the backend. Regex counts are marked as
such: they are upper bounds used to size the work, **not** the coverage report.
The coverage report in section 8 is generated from an explicit registry, because
a number produced by a regex is not audit evidence.

| App | `.save()` | `.objects.create*` | QuerySet `.update()`※ | `.delete()` | `bulk_*` | raw INSERT | raw UPDATE | raw DELETE |
|---|---|---|---|---|---|---|---|---|
| `curriculum_api` | 5 | 0 | 75 | 3 | 0 | 35 | 60 | 15 |
| `learner_api` | 51 | 20 | 74 | 7 | 6 | 25 | 34 | 6 |
| `audit_api` | 0 | 1 | 4 | 0 | 0 | 27 | 20 | 3 |
| `manual_audit_api` | 0 | 0 | 1 | 0 | 0 | 29 | 4 | 8 |
| `coach_api` | 16 | 3 | 16 | 1 | 0 | 4 | 7 | 1 |
| `login` | 16 | 10 | 6 | 5 | 0 | 2 | 5 | 0 |
| `engagement_api` | 14 | 16 | 5 | 5 | 0 | 0 | 0 | 0 |
| `quiz_api` | 11 | 9 | 1 | 3 | 0 | 1 | 0 | 3 |
| `chat` | 7 | 4 | 3 | 0 | 0 | 0 | 0 | 0 |
| `old_otjh` | 4 | 0 | 6 | 4 | 0 | 4 | 2 | 0 |
| `enrolment_api` | 3 | 8 | 1 | 3 | 0 | 1 | 1 | 0 |
| `progress_reviews_api` | 1 | 0 | 0 | 0 | 0 | 3 | 0 | 0 |

※ The `.update()` and many-to-many counts are the least reliable: `.update(` and
`.add(` also match dict and list operations. They are listed to size the work,
and every one is confirmed by reading before it is instrumented.

**The dominant shape is raw SQL, not the ORM.** `curriculum_api` alone makes 914
`cursor.execute` calls. This is why the existing curriculum audit works the way
it does: it does not hook the ORM at all, it hooks one choke-point helper
(`views.authoring_upsert` → `versioning.record_rows`) that every authoring write
already passes through. Thirteen tables are registered in `VERSIONED_TABLES`,
and that registry — not a signal — is what makes the curriculum auditable.

---

## 4. Why Django signals are not sufficient on their own

Taking your instruction 4 in order, with what each path actually does:

| Write path | `pre_save`/`post_save` | `pre_delete`/`post_delete` | Covered by signals? |
|---|---|---|---|
| `Model.save()` | fires | — | **Yes** |
| `Manager.create()`, `get_or_create`, `update_or_create` | fires | — | **Yes** |
| `Model.delete()` | — | fires | **Yes** |
| `QuerySet.delete()` | — | fires per collected object | **Mostly** — Django's fast-delete path deletes without instantiating, and fires nothing |
| `QuerySet.update()` | — | — | **No — silent** |
| `bulk_create()` | — | — | **No — silent** |
| `bulk_update()` | — | — | **No — silent** |
| `QuerySet._raw_delete()` | — | — | **No — silent** |
| Many-to-many `add/remove/set/clear` | — | — | **No** — needs `m2m_changed` |
| `cursor.execute("insert…")` | — | — | **No — silent** |

So the capture layer is four mechanisms, not one:

1. **`pre_save` / `post_save` / `post_delete`** — the instance paths. `pre_save`
   reads the stored row for that pk to produce a real before/after.
2. **`m2m_changed`** — relationship changes, recorded as a field whose before and
   after are id sets.
3. **An audited `QuerySet` / `Manager`** — overriding `update`, `bulk_create`,
   `bulk_update` and `delete` so the bulk paths announce themselves. Opt-in per
   model, so no queryset behaviour changes anywhere it is not registered.
4. **A raw-SQL choke-point helper** — the same shape as
   `versioning.record_rows`: the caller hands over the rows its statement
   returned, and nothing extra is read. This is how the ~200 raw INSERT/UPDATE/
   DELETE sites get covered, and it is the only one that requires touching
   existing call sites.

Mechanisms 1–3 need no change to any handler. Mechanism 4 does, and it is the
long tail — which is precisely what the coverage report in section 8 exists to
track honestly rather than imply is finished.

---

## 5. The transactional outbox

```
  business write  ─┐
                   ├─ ONE transaction, ONE connection ─→ commit
  outbox insert   ─┘
                                │
                                ▼
                   relay (management command / request-tail)
                                │
                                ▼
                   system_audit.record_revisions   ← idempotent on event_id
```

* **Atomic by construction.** Because the writable aliases are one physical
  database, the outbox insert happens on the caller's own connection inside the
  caller's own transaction. There is no window in which the record is saved and
  the audit event is not. A rollback takes both.
* **Idempotent.** Every event carries a client-generated `event_id` (UUID).
  The relay inserts with `ON CONFLICT (event_id) DO NOTHING`, so a relay that
  crashes mid-batch and re-runs cannot duplicate. The buffer is keyed by
  `(entity_type, entity_id)` within a transaction, so a row touched repeatedly
  in one save yields one event, exactly as `record_rows` already does.
* **Never on the hot path.** The relay is a separate pass. A failure to relay
  leaves rows in the outbox to be picked up next time; it never fails a request,
  and it never silently drops — an unrelayed backlog is visible and reportable.
* **Rollback-safe by the existing pattern.** The buffer/`on_commit` design from
  `versioning.arm_flush` is lifted verbatim, with `using=` passed explicitly.

---

## 6. Volume and retention

Curriculum alone shows over 1.2 million recorded actions in a 30-day window.
System-wide capture without a retention rule is not viable, so the rule is part
of the design rather than a later cleanup.

**Configurable, per event class, with per-workspace overrides** where a
compliance requirement needs longer:

| Event class | Default retention |
|---|---|
| Page visits (`page_view`) | 90 days |
| Read actions (search, filter, sort, export, download, tab, print) | 90 days |
| Create / update / delete revisions | 12 months |
| Any workspace with a longer statutory requirement | per-workspace override, longer only — never shorter |

**No full snapshots where a diff will do.** The shared log stores the fields that
moved, not the record. A create stores the field set it came into existence
with; a delete stores the key fields needed to identify what went, not the whole
row. This is a deliberate difference from `curriculum.record_revisions`, which
keeps snapshots and will continue to — see section 7.

**Nothing is silently truncated.** Where a value is too large to store, the row
records the field, the fact that it changed, and an explicit
`value omitted: too large` marker — the same honest-gap approach
`versioning.safe_metadata` already takes. A reader is never shown a shortened
value that looks complete.

Indexes, pagination and cleanup: `(occurred_at)`, `(actor_email, occurred_at)`,
`(workspace, occurred_at)`, `(entity_type, entity_id, occurred_at)`; every read
windowed and paged; cleanup as an explicit management command, never an implicit
side effect of a read.

---

## 7. Sensitive information

Every workspace is auditable, Safeguarding included. What differs is not
*whether* a change is recorded but *which* of its values are readable.

Every event, in every workspace, always records:

* who changed it (account, resolved server-side from the session, never from the
  request body),
* when,
* which record (workspace, entity type, entity id),
* what kind of operation,
* **which fields changed** — by name.

Before/after **values** appear only where the field is on an allowlist for that
entity. Everything else records the field name with its values replaced by a
redaction marker. Safeguarding case content, evidence documents, learner
personal data and anything credential-shaped default to names-only, and are
opted in field by field rather than opted out.

Access is role-gated at the endpoint, not only in the UI: the existing RBAC
entry restricts the audit trail to `auditor`, `compliance`, `tenant-admin` and
`super-admin`, and `/admin/audit-trail` enforces the same server-side.

---

## 8. Coverage report

The point of this section is that it stays honest while the work is incomplete.
It is generated from the registry of instrumented write paths — not from a
regex, and not from an assumption that registering an app finished it.

Each workspace reports, per mechanism: covered, partial, or not yet — with the
specific write paths still outstanding named. A workspace is only "fully
audited" when every path in section 3 for its apps is either instrumented or
explicitly recorded as out of scope with a reason.

### People — visits, duration, searches, filters, exports

**Complete for every workspace.** Two layers, both LMS-wide:

* **Visits** — the router reports every SPA route except the excluded list; the
  server resolves each URL against `system_audit/pages.py` and stores the page,
  the workspace and the record id it names.
* **Searches, filters, sorts, exports, prints** — `frontend/src/lib/
  activityCapture.ts`, one delegated listener on the document. Before it, the
  only components that reported an action were Curriculum Studio's own, so
  every other workspace showed people opening pages and never doing anything on
  them. The two shared toolkits (`EntityFilterBar`, `FilterToolbar`) report
  themselves by name and are marked `data-audit="manual"`; everything else is
  read from the DOM. A control the listener cannot identify is left alone — an
  unrecorded action is a gap, a mis-recorded one is a false statement.

  It records an input only when that input is recognisably a search or filter,
  never a password, and never inside `data-audit="off"`. Guarded by
  `src/lib/__tests__/activityCapture.test.ts`, which asserts both edges.

| Workspace | Routes in the table | Recorded |
|---|---|---|
| Curriculum Studio | 35 | ✅ |
| Learner | 47 | ✅ except the content runner (deliberate — section below) |
| Coach | 26 | ✅ |
| Employer | 19 | ✅ |
| Leadership | 18 | ✅ |
| QA | 18 | ✅ |
| Admin | 18 | ✅ |
| MIS | 14 | ✅ |
| Engagement | 13 | ✅ |
| Platform | 12 | ✅ |
| Tutor | 11 | ✅ |
| Safeguarding | 10 | ✅ |
| Audit | 10 | ✅ |
| Support | 6 | ✅ |
| Finance | 5 | ✅ |

Deliberately not recorded, and the only things that are: the signed-out pages
(`/login`, the password and certificate routes — `login."Login_audit"` owns that
half properly) and the learner content runner (`/learner/quiz|video|component|
historical-assignment|monthly-submission/…`). A route not in the table above is
still recorded; it is labelled from its last segment and attributed to its
workspace, so a page that ships tomorrow is in the trail tomorrow.

### Changes — create, update, delete, who, before/after

**Four workspaces, by ORM capture.** The pages say which, rather than letting an
empty feed read as "nobody changed anything": `changeWorkspaces` is now derived
from `system_audit.writes.WORKSPACE_BY_ENTITY` rather than hard-coded, so the
Audit Trail starts speaking for a workspace on the day it is wired in.

| Workspace | Records audited | Mechanism | Status |
|---|---|---|---|
| Curriculum Studio | 13 entity types | raw SQL → `record_rows` | ✅ with before/after |
| Admin (enrolment) | `learner_record`, `staff_record` | ORM signals on `enrolment` | ✅ with before/after, personal fields redacted |
| Employer | `employer_contact`, `organisation` | ORM signals on `enrolment` | ✅ with before/after, contact details redacted |
| Coach | `coach_meeting`, `absence_report` | ORM signals on `default` | ✅ with before/after, notes redacted |
| Learner progress | — | 326 raw SQL statements in `learner_api` | ⬜ raw-SQL choke points outstanding |
| Coach (raw SQL) | — | 106 statements in `coach_api` | ⬜ outstanding |
| Engagement, Audit, Manual audit, Quiz, Chat, Old OTJH, Progress reviews | — | — | ⬜ not started |

What "ORM signals" covers and does not: `post_save`, `post_delete` and
`m2m_changed` see `.save()`, `objects.create()` and link changes.
`QuerySet.update()`, `bulk_create()`, `bulk_update()` and the fast-delete path
emit no signal at all — `system_audit.writes.AuditedQuerySet` handles those and
is available, but is not yet attached to any model's manager, so a bulk write on
a registered model is currently **not** recorded. That is the first thing to
close, and it is named here rather than left to be discovered.

Raw SQL in `coach_api` and `learner_api` is unaffected by signals and needs its
choke points instrumented with `writes.record_table_rows`, app by app.

---

## 9. Implementation order

Incremental, each step independently verifiable, none of them changing business
logic:

1. **Reading half, system-wide. ✅ done.** `system_audit/pages.py` (every SPA
   route, its workspace, and its record id, resolved server-side),
   `system_audit/activity.py` (recording and reading, workspace-scoped),
   `frontend/src/lib/activityTrail.ts` (the widened recorder), and
   `sql/2026-09-20_activity_events_workspace.sql` for the column — **not yet
   applied**; everything works without it and says which reading it is doing.
   Touches no save path anywhere.
2. **The shared pages. ✅ done.** `frontend/src/features/audit-trail/` holds one
   implementation; `/admin/audit-trail` and `/curriculum/audit-trail` are two
   scopes onto it, and a test asserts each asks for what it claims to show.
3. **Actions system-wide. ✅ done.** `frontend/src/lib/activityCapture.ts`
   closes the half of the reading side that only Curriculum Studio had: one
   delegated listener, no per-workspace call sites, no page opted in.
4. **The shared write layer. ✅ done.** `system_audit/writes.py` (registry,
   redaction, ORM signal capture, `AuditedQuerySet`) and
   `system_audit/records.py` (which records are audited and which of their
   fields may be shown). No new table: `curriculum.record_revisions` is already
   generic — its own comment says so — and its name is historical exactly as
   `curriculum.activity_events`'s is.

   One correctness fix had to land first. `versioning.arm_flush` asked
   `connection` — always `default` — whether a transaction was open, and
   registered `on_commit` there. Harmless while every audited write used that
   one connection; wrong the moment `learner_api` writes on `enrolment`, because
   its revision would have been written immediately and kept even if that
   transaction rolled back. The buffer is now per connection and the callback is
   registered against the alias the write actually used.
5. **Bulk and raw-SQL capture.** ⬜ next. Attach `AuditedQuerySet` to the
   registered models' managers, then instrument the raw-SQL choke points in
   `coach_api` and `learner_api`, one app at a time, coverage table updated as
   each lands.

`curriculum.record_revisions`, `VERSIONED_TABLES`, `versioning.py` and both
existing curriculum audit pages keep working exactly as they do now throughout.
The curriculum is not migrated onto the shared log; the shared log is read
alongside it, and the Changes feed merges the two.
