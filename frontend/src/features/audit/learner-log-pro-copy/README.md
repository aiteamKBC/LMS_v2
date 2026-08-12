# Auditor-copy OTJH workspace — Last_audit migration

> Current state (2026-08-12): everything is same-origin Django. Reads come from
> `/audit_api/last-audit/` (normalized `"Last_audit"` schema). The **monthly
> journal is now employee-arranged**: original planned hours come from
> `Last_audit.learners.planned_hours_monthly`, and the activity log lists only
> rows employees add via `/audit_api/last-audit/manual/*` (schema
> `structured_manual_activities`, see `lib/manualApi.ts`). Actual hours have no
> automatic source. Assignment rows take evidence uploads (Azure container
> `learner-assignments`), and every activity row opens the `/ledger` route:
> definition (iframe / reading / quiz body) + all employee-arranged participant
> rows. The external `fetch-evidence.kentbusinesscollege.net` write service is
> no longer called from anywhere in this workspace.

The endpoint flow is:

```text
Last_audit.learners (580 Aptem identities; optional learner_id = LMS id)
    LEFT JOIN group_learners + groups + LMS activity_results
    -> GET /audit_api/last-audit/cohort/

Last_audit.activity_results + activities
Last_audit.learner_attendance (linked from AiTeamKBC.kbc_attendance by Aptem ID)
    -> GET /audit_api/last-audit/activities/?aptem_id=<id>
    -> GET /audit_api/last-audit/activity/?component_id=la:<group>:<activity>
    -> GET /audit_api/last-audit/activity/?component_id=att:<source_key>
```

Attendance rows use the source `lecture_name` as the Activity/Lecture name,
with `module` retained as supporting context and `date` as the real attendance
date. Refresh the mirror with `python manage.py sync_last_audit_attendance`.

The cohort is Aptem-first and reads only `Last_audit.learners`: all Aptem rows
remain visible. LMS activities attach through the optional, unique
`learner_id`; an Aptem learner without it receives `lms_not_matched` and never
inherits another learner's LMS activity rows.

The notes below describe the preceding OTJH feed and are retained as migration
context for write/annotation features that have not moved yet.

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

### 4. Writes

The legacy external `POST /api/otjh/edit/` (fetch-evidence) call has been
**removed**. All writes are same-origin Django:

- **Row edits on the read-only mirror** — reversible replacement overlays via
  `/audit_api/match-ledger/activity-overrides` (`updateActivityRow` /
  `deleteActivityRow` / `createActivity` in `lib/api.ts`).
- **Employee-arranged journal rows** — CRUD on
  `/audit_api/last-audit/manual/rows`, assignment uploads on
  `/audit_api/last-audit/manual/documents` (`lib/manualApi.ts`), stored in the
  `structured_manual_activities` schema.

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
