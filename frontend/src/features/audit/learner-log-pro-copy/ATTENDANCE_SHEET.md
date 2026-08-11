# Attendance Sheet — endpoints & frontend logic

Clicking an **attendance** record in the auditor-copy workspace should open an
**attendance details page** that shows the *attendance sheet* for that live
session: every learner assigned to that lecture on that date — **attended or
not** — matched by the shared session key.

This document is the contract + implementation guide for the frontend work. The
**backend is already built and merged** into `audit_api` (see §1). The frontend
pieces in §3 are **not built yet** — this is the spec to build against.

---

## 0. The core idea: the session key

Every attendance record has a `source_key` of the form:

```
{aptem_id}_{YYYY-MM-DD}_{lecture_slug}
   1763  _  2025-05-02 _ ray_project_management_professional_apprenticeship_pcp
```

Drop the **leading learner id** and what remains is the **session key** — the
identity shared by *every* learner assigned to that same lecture on that date:

```
2025-05-02_ray_project_management_professional_apprenticeship_pcp
```

The attendance sheet is "all `learner_attendance` rows that share this session
key". `attendance_value` (`1` = attended, `0` = assigned but absent) gives the
attended/absent flag. This is cohort-wide — it is **not** scoped to a single
programme.

---

## 1. Backend endpoints

Base path (same-origin, proxied to Django): **`/audit_api/last-audit`**
(this is `READ_BASE` in `lib/api.ts`). All are `GET`, read-only, no auth token.

### 1.1 `GET /audit_api/last-audit/attendance-sheet/` — NEW (built)

The endpoint powering this feature.

**Query params**

| param | required | description |
|-------|----------|-------------|
| `key` | yes | Any single learner's attendance key. Accepts the full `source_key` (`1763_2025-05-02_ray_...`) **or** the `att:`-prefixed activity ref the journal rows carry (`att:1763_2025-05-02_ray_...`). The backend strips the leading id itself. |

**Behaviour** — strips `key` down to the session key (id removed), then returns
every `Last_audit.learner_attendance` row sharing it, joined to
`Last_audit.learners` for display names. Attendees are ordered attended-first,
then by learner name.

**Response `200`**

```jsonc
{
  "session": {
    "session_key": "2025-05-02_ray_project_management_professional_apprenticeship_pcp",
    "date": "2025-05-02",
    "lecture_name": "Ray - Project Management Professional (Apprenticeship) - PCP",
    "module": "Ray - Project Management Professional (Apprenticeship) - PCP"
  },
  "counts": { "assigned": 17, "attended": 11, "absent": 6 },
  "items": [ /* one row per learner — shape in §2 */ ],
  "total": 17,
  "planned_total": 0.0,
  "actual_total": 27.5,
  "limit": 17,
  "offset": 0
}
```

**Errors**

| status | when | body |
|--------|------|------|
| `400` | `key` missing or not composite (no `_`) | `{ "error": "key must look like <id>_<YYYY-MM-DD>_<lecture>" }` |
| `404` | no attendance rows share that session key | `{ "error": "No attendance session for '<session_key>'." }` |
| `503` | DB read failed | `{ "error": "Could not read Last_audit attendance.", "details": "…" }` |

> Live sanity check (read-only) with a real key returned
> `counts = {assigned: 17, attended: 11, absent: 6}` and the 6 absent learners
> in the roster flagged `"not attended"`.

### 1.2 Endpoints this feature builds on (already existed)

| endpoint | purpose | how it relates |
|----------|---------|----------------|
| `GET /audit_api/last-audit/activities/?aptem_id=<id>` | one learner's full activity feed (the monthly journal). Attendance rows here already carry `activity_id = "att:{source_key}"` and `source_activity_id = "{source_key}"`. | This is where the **click originates**: the attendance row's `plan_id`/`activity_id` already contains the exact key to pass to §1.1 — no client-side key assembly needed. |
| `GET /audit_api/last-audit/activity/?component_id=<ref>` | one activity across all learners ("click an activity"). | Sibling pattern; the attendance sheet is the attendance equivalent. |
| `GET /audit_api/last-audit/cohort/` | learner list for the workspace. | Unrelated, listed for context. |

> There is also a legacy `GET /audit_api/match-ledger/attendance-session?key=…`
> in `learner_match_ledger_views.py`. **Do not use it** for this feature: it is
> hard-scoped to the "Level 6 Project Controls Professional" programme, reads
> `programme_structure` (not `learner_attendance`), and derives attended from
> the plan blob rather than `attendance_value`. The new §1.1 endpoint replaces
> it for the cross-cohort, authoritative sheet.

---

## 2. The attendee row shape (`items[]`)

Each item is already in the same shape the journal/activity-learners tables
consume, so `InlineActivityRow` renders it unchanged. Relevant fields:

| field | example | notes |
|-------|---------|-------|
| `activity_id` | `"att:1763_2025-05-02_ray_..."` | `att:` + source_key |
| `source_activity_id` | `"1763_2025-05-02_ray_..."` | raw source_key |
| `learner_id` | `2030` | **Aptem id** (kept as `learner_id` for the ledger contract) |
| `lms_learner_id` | `435` | LMS learner id (may be `null`) |
| `learner_name` | `"Amy-Marie Field"` | from `Last_audit.learners`, falls back to `Aptem learner <id>` |
| `date` | `"2025-05-02"` | session date |
| `category` | `"attendance"` | always |
| `activity` | lecture name | `lecture_name` → falls back to `module` |
| `activity_subtitle` | module | supporting context |
| `completed` | `true` / `false` | **attended flag** (from `attendance_value == 1`) |
| `timestamp_display` | `"attended"` / `"not attended"` | ready-made badge text |
| `status` | `"Present"` / `"Absent"` | source `attendance_status`, falls back per `completed` |
| `actual` | `2.5` | `activity_hours` (0 when absent/unknown) |
| `source` | `"Last_audit"` | |

---

## 3. Frontend logic to build

Feature dir: `src/features/audit/learner-log-pro-copy/`.
Router: **TanStack Router**, file-based, **hash history** (URLs live in the hash,
e.g. `…/auditor-copy#/attendance?key=…`).

### 3.1 API wrapper — `lib/api.ts`

Add a `getAttendanceSheet(key)`:

```ts
// READ_BASE = "/audit_api/last-audit"
export async function getAttendanceSheet(key: string) {
  const data = await getJson<AttendanceSheetResponse>(
    `/attendance-sheet/?key=${encodeURIComponent(key)}`,
  );
  return {
    session: data.session,
    counts: data.counts,
    // items are already the participant shape — reuse the SAME participant
    // → LearnerActivity mapper that getActivityLearners uses, so the table
    // renders them with no special-casing.
    items: data.items.map(toActivity),
  };
}
```

Add the response type (mirror §1.1):

```ts
export interface AttendanceSheetResponse {
  session: { session_key: string; date: string | null;
             lecture_name: string | null; module: string | null };
  counts: { assigned: number; attended: number; absent: number };
  items: RawParticipant[];   // same raw shape getActivityLearners maps
  total: number; planned_total: number; actual_total: number;
  limit: number; offset: number;
}
```

> The existing `getAttendanceSession` stub (which reconstructs a session from
> `getActivityLearners` and always returns `recordings: []`) can be **retired or
> repointed** to `getAttendanceSheet`. It never hit a real endpoint.

### 3.2 Make the attendance row navigate — `components/InlineActivityRow.tsx`

Currently (~line 168) the activity-name cell always links to `/activity`.
Special-case attendance so it links to the new page, passing the key the row
already carries:

```tsx
row.activity_category === "attendance" ? (
  <Link to="/attendance" search={{ key: row.plan_id /* "att:{source_key}" */ }}>
    {row.activity_unit}
  </Link>
) : (
  <Link to="/activity" search={{ learner: row.learner.toLowerCase(), activity: row.plan_id }}>
    {row.activity_unit}
  </Link>
)
```

`row.plan_id` on an attendance row is `"att:{source_key}"`; the backend accepts
that `att:` form directly, so **no key assembly is required**.

### 3.3 New route — `routes/attendance.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/attendance")({
  validateSearch: (s: Record<string, unknown>) => ({
    key: typeof s.key === "string" ? s.key : "",
  }),
  component: AttendanceSheetPage,
});
```

Then **regenerate `routeTree.gen.ts`** (TanStack codegen / `npm run dev` writes
it) so `/attendance` is registered. This is a generated file — commit the diff.

### 3.4 The page — `AttendanceSheetPage`

Layout:

1. **Header** — `session.lecture_name`, formatted `session.date`, and
   `session.module` as subtitle.
2. **Counts strip** — `assigned` · `attended` · `absent` from `counts`
   (e.g. three small stat chips; absent styled as a warning).
3. **Roster table** — the attendees. Reuse `InlineActivityRow` (or `MreTable`'s
   dormant `bySession` mode, now fed by `getAttendanceSheet`). Each row shows
   learner name + the `timestamp_display` / `status` attended/absent badge.
   Consider a filter toggle (All / Attended / Absent) over `item.completed`.
4. **Empty / error states** — `404` → "No attendance session found for this
   record"; `400` → "This record has no valid session key".

Data fetch: `useQuery`/loader keyed on `key`, calling `getAttendanceSheet(key)`.

### 3.5 What is intentionally NOT included

- **Recordings panel.** The legacy `attendance-session` endpoint returned
  (empty) recordings; this sheet does not. If a recordings/preview panel is
  wanted later, it is a separate endpoint + section, not part of this contract.

---

## 4. Verification checklist

**Backend (done):**
- `python manage.py test audit_api.test_last_audit_ledger_views` → 14 passing
  (includes `_session_key` + `_attendance_sheet_payload` roster tests).
- Live read-only call returns correct assigned/attended/absent counts.

**Frontend (to do):**
- `npm run lint` and `npm run type-check` in `frontend/`.
- Click an attendance row in the journal → lands on `#/attendance?key=att:…` →
  header + counts + roster with attended and absent learners.
- A learner known to be absent (value 0) appears in the roster flagged
  "not attended".

---

## 5. File index

| layer | file | state |
|-------|------|-------|
| backend view + pure builder | `backend/audit_api/last_audit_ledger_views.py` (`attendance_sheet`, `_attendance_sheet_payload`, `_session_key`) | **built** |
| backend route | `backend/audit_api/urls.py` (`last-audit/attendance-sheet/`) | **built** |
| backend test | `backend/audit_api/test_last_audit_ledger_views.py` | **built** |
| fe api wrapper | `frontend/src/features/audit/learner-log-pro-copy/lib/api.ts` (`getAttendanceSheet`) | to build |
| fe click | `.../components/InlineActivityRow.tsx` | to build |
| fe route | `.../routes/attendance.tsx` + `routeTree.gen.ts` | to build |
| fe page | `AttendanceSheetPage` (in the route file or a `components/` file) | to build |
