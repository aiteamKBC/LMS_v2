# Step 10 — Structure tools (Phase C — only after Phase B pilot feedback)

## Goal
Create programme / cohort / group / module skeletons safely. No updates to existing items, no deletes.

## Shared rules
- Look-up first: normalised-name match (case/space/punctuation-insensitive) within scope → REFUSE and return the
  existing item ("Programme 'Digital Marketing L3' already exists (id …). Did you mean to add a cohort to it?").
  This is required because `POST curriculum/programmes/` silently UPSERTS by name and the module POST can
  resolve to an existing module.
- Never send client-chosen ids (deleted-id remint risk) — server generates ids.
- Never call `programmes/tree/` (tree-save). Use single-entity endpoints only.
- Status always draft/planned; never active/published.
- Parent must exist and not be archived.

## Tasks
10.1 `create_programme(name, level, description?, ksb_standard_source_id?, required_otjh_hours?)`
     - `ksb_standard_source_id` must be an existing `standard:*` source (provide `list_ksb_standards()` read tool
       for choosing it). No manual/legacy profiles.
     - Preview shows all fields; warns if no standard chosen ("quizzes can't be KSB-mapped until one is applied").
     - Apply: `POST curriculum/programmes/` ONLY after re-confirming (inside apply, re-check name doesn't exist —
       race protection) since the endpoint upserts.
10.2 `create_cohort(programme_id, name, start_date, duration_months?: 24, holiday_ids?, epa?)`
     - Preview shows the server-computed practical end date: compute via the same function
       (`cohort_practical_end_date`) in validate, read-only, so the user confirms the real dates.
     - Dates: start not more than 1 year in past (warning) / end after start.
     - Apply: `POST curriculum/programmes/<id>/cohorts/`.
10.3 `create_group(cohort_id, name, coach_name?, weekday?, start_time?, end_time?)`
     - Coach must match EXACTLY one active staff member with coach access (resolve via existing
       `canonical_staff_assignment_name` logic) — ambiguous/unknown → error listing candidates by name only.
     - Time format validation, end > start.
     - Apply: `POST curriculum/cohorts/<id>/groups/`.
10.4 `create_module(programme_id, title, description?, weeks?:[{title, components?:[{title, type}]}])`
     - Programme required (never "Unassigned programme").
     - Max 52 weeks, 30 components/week.
     - Apply: `POST curriculum/modules/` with explicit programme id (avoid the 40 alias fields; send only the
       canonical ones the Module Builder sends — copy its payload shape from `frontend/src/lib/curriculumApi.ts`).
       Then weeks/components via the structure endpoint WITHOUT removal flags (`partialTree`/`modulesPartial`
       semantics: additive). Verify the structure endpoint is additive; if it replaces, STOP and report.
     - Status draft.
10.5 Optional `assign_module_to_cohort_group` — NOT in v1 unless reviewed (it triggers training-plan sync for
     learners). Document why it's excluded.

## Tests
Duplicate name refused (incl. different case/spacing); archived parent refused; race (name created between
preview and apply) refused at apply; coach ambiguous; cohort end date matches server calc; module created as
draft with weeks; no removal flags ever sent (dispatcher scrubber test).

## Acceptance checklist
- [ ] From Claude: "Create a new cohort Jan-27 for Digital Marketing L3 with two groups on Tue and Thu, coach X"
      → one preview listing cohort + 2 groups → apply → visible in curriculum UI as planned.

## Implementation notes (2026-11-11)

Implemented in `mcp_api/tools/structure.py`, behind `MCP_STRUCTURE_CREATION_ENABLED` (default off).
Tests: `mcp_api/tests/test_structure.py`.

The tools are `list_ksb_standards` (read-only), `create_programme`, `create_cohort`, `create_group` and
`create_module`.

**Upsert guard.** The programme, cohort and group creates silently UPDATE an existing record with the same
name; a cohort upsert even blanks its start date. The module create returns an existing module with the same
title, and can create a programme by name. So every tool:
- refuses a name already used in its scope, using the LMS's own key (lower case, letters and digits only);
- re-checks that at apply time, to catch a race;
- sends explicit parent ids and names, and never client ids;
- accepts only `201 created: true`. Anything else raises inside the default-DB transaction and is rolled back.

**Per entity**
- **Programme.** Programmes have no not-live state: the LMS maps draft and planned to active. The preview says
  so. A standard from `list_ksb_standards` is sent as `ksbProfileSourceId: "standard:<id>"` in the create
  itself, so no programme PATCH is allowlisted.
- **Cohort.** The preview end date comes from `cohort_practical_end_date`, the LMS's own rule, and the
  response must match it. A start date more than a year ago gives a warning. Status follows the dates.
- **Group.** The coach must match exactly one name in `curriculum/coaches/` (case and spacing ignored);
  otherwise the tool refuses and lists candidates by name. The LMS itself would store any text. Times are
  HH:MM, and the end must be after the start. New groups are `planned`.
- **Module.** Uses the authoring branch: `moduleType: authoring`, `status: draft`, roster `inherited`, empty
  weeks. A cohort and group are optional but must be given together. If one is given, the preview warns that
  the group's learners will see the module.

**10.5 `assign_module_to_cohort_group` is not built.** Placing a module in a group changes what that group's
learners see, so it stays a reviewed action in the LMS.

**Allowlist**
- Added: POST `programmes/`, `programmes/<id>/cohorts/`, `cohorts/<id>/groups/`, `modules/`; GET
  `standards/`, `standards/<id>/`, `coaches/`.
- Still never allowed: `programmes/tree/` and any PATCH or DELETE on these entities.
- [ ] Acceptance: not yet run against a real database.
