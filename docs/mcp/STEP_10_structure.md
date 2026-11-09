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
