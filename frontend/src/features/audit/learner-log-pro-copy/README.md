# Auditor-copy OTJH workspace — data source

This workspace (`/workspace/auditor-copy`) shows PLANNED vs ACTUAL off-the-job
hours for the 6 **Level 6 Project Controls Professional** apprentices and lets an
auditor drill into the underlying activity evidence.

Its read data comes from a live, pre-flattened + server-cached evidence API. All
fetching + transforming into the UI's type contract lives in
[`lib/api.ts`](./lib/api.ts). CORS is open on the service, so the browser calls it
directly (no Vite proxy needed).

**Base URL:** `https://fetch-evidence.kentbusinesscollege.net`

## Endpoints consumed

### 1. `GET /api/otjh/cohort/`

The whole cohort in one small (~19 KB) payload. Drives the cohort table
(`getLearners`), the journal's monthly stats + OTJH breakdown card, learner
profiles (`getLearnerProfile`), and the month/period + category filter options.

```jsonc
{
  "learners": [
    {
      "aptem_id": 92,
      "learner_name": "Mohamed Elmasry",
      "programme": "Level 6 Project Controls Professional",
      "withdrawn": false,
      "planned_total": 543.5,
      "actual_total": 743.2,
      "flags": [],                 // e.g. ["withdrawn"], ["no_attendance_recorded"]
      "months": [
        { "month": "2024-10", "label": "October 2024",
          "planned": 11.0, "actual": 11.37,
          "att_actual": 0, "asg_actual": 5.0, "media_actual": 4.12, "bundle_actual": 2.25 }
      ]
    }
  ]
}
```

**Flags** surface as badges in the cohort table:
- `withdrawn` — learner left the programme (shown via the programme-status chip).
- `no_attendance_recorded` — attendance sessions exist but none were marked attended.

### 2. `GET /api/otjh/activities/?aptem_id=<int>[&month=YYYY-MM]`

One learner's evidence rows (a whole month is ~50–80 KB). `month` is optional —
omit it for all of a learner's activities. Drives the activity-log / month
evidence tables (`getLearnerActivities`) and the activity-detail page.

```jsonc
{
  "aptem_id": 92, "learner_name": "Mohamed Elmasry",
  "month": "2026-07", "count": 57,
  "activities": [
    {
      "activity_id": 136478,
      "learner_id": 92, "learner_name": "Mohamed Elmasry",
      "date": "2026-07-01",
      "month": "2026-07", "month_label": "July 2026",
      "category": "audio",                    // attendance | assignment | video | audio | reading+quiz
      "activity": "Lecture 21: … (Audio)",
      "planned": 0, "actual": 0,              // hours
      "timestamp_from": null, "timestamp_to": null,
      "timestamp_display": "",                // rendered verbatim in the Timestamp column
      "completed": false,
      "ksbs": { "K": [], "S": [], "B": [] },  // may be null; items carry code + description
      "iframe_url": "https://…"               // may be null; opens the activity
    }
  ]
}
```

Errors: `400 {"error":"aptem_id (int) is required"}`, `404 {"error":"no PCP learner <id>"}`.

**Timestamp column** is rendered exactly from `timestamp_display`:

| Row kind | `timestamp_display` |
| --- | --- |
| attendance | `attended` / `not attended` |
| assignment, input reading bundle | `input` |
| completed media / timestamped bundle | `HH:MM–HH:MM` |
| not-yet-completed | `` (empty) |

### 3. `GET /api/otjh/activity/?component_id=<id>`

The Activity Detail view (`/activity` route → `getActivityDetail`). Returns the
activity, its sub-activities (`items[]`, for reading+quiz bundles) and every
learner who has it (`participants[]`).

```jsonc
{
  "component_id": 50560,
  "activity": "Lecture 3: Business Environment (Reading & Quiz)",
  "category": "reading+quiz",                 // or video | audio | attendance | assignment
  "participant_count": 4, "completed_count": 1,
  "items": [
    { "component_id": 51336, "title": "…", "activity": "… (Quiz)",
      "material_type": "quiz", "iframe_url": "https://…" }
  ],
  "item_count": 3,
  "participants": [
    { "learner_id": 92, "learner_name": "Mohamed Elmasry", "found_as": "bundle",
      "activity": "…", "completed": false, "actual": 2.25, "planned": 5,
      "month": "2024-10", "date": "2024-10-01", "timestamp_display": "input",
      "item_title": null }
  ]
}
```

Each `items[]` entry is itself clickable → drills into
`/api/otjh/activity/?component_id=<item.component_id>` to show that item's own
participants. The snapshot's **Mapped KSBs** still come from the `/activities`
row payload (endpoint 2), not this one.

### 4. `POST /api/otjh/edit/`  (write)

Edits whitelisted fields (`editActivity` / `EditPatch`). CORS + OPTIONS preflight
are handled server-side.

```jsonc
{ "aptem_id": 92, "component_id": 50560,
  "patch": { /* only whitelisted fields */ },
  "apply_shared_to_all": false }              // true → push shared fields to every participant
```

| Scope | Fields |
| --- | --- |
| per-learner (applies to `aptem_id`'s row) | `planned_hours`, `actual_hours`, `started_at` (ISO), `completed_at` (ISO), `journal`, `attended` (attendance only — auto-sets 2.5/0 + timestamp) |
| shared (activity-level; broadcast with `apply_shared_to_all:true`) | `front_end_name`, `description`, `auditor_notes`, `ksb_notes`, `auditor_ksbs` (array), `edited_by` |

Response: `{ "ok": true, "changed": {…}, "also_applied_to": [learner ids] }`.
Errors: `400` for a non-whitelisted field (returns the allowed list) / bad body,
`404` for an unknown learner/activity. `actual_hours` edits keep the underlying
OTJH in sync. After a successful edit the UI calls `invalidateOtjhCaches()` and
invalidates the cohort/activities/activity-detail react-query keys so every view
refetches fresh (the server busts its own cache too).

The Activity Detail UI: the aside is an activity-level editor (name, planned
hours for the primary learner, auditor KSB notes, edited-by, + "apply shared
fields to all learners"); each participant row has an inline editor (planned,
actual / attended, started/completed times, journal) that POSTs just that
learner's row with optimistic update + a toast.

## Caching notes

- The cohort is fetched **once per session** (module-level promise) and reused.
- Each `(learner, month)` activity page is cached in a module-level `Map`, so the
  cohort table's activity counts and the activity-log tables share the same
  network calls. Counts are only computed when a month is selected (cheap month
  pages); the "All months" cohort view skips that fan-out.

## What the live (read-only) API does **not** cover

These stay pointed at the existing Django `/audit_api` endpoints:

- **Activity annotations** (auditor planned-hours override + notes) —
  `getActivityAnnotation` / `saveActivityAnnotation` → `/audit_api/match-ledger/…`.
- **Monthly sign-off** (learner + coach signatures) → `/audit_api/learners/<id>/signoff/`
  (see `src/features/audit/api.ts`).

The richer learner-profile sections (skills radar, contracts, certifications,
employer, training plan) and graded quiz bodies have no source in the live feed
and render as each page's own empty state.
