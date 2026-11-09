# Step 9 — `map_ksbs` and `add_lesson_content`

## 9A `map_ksbs(component_id, mappings:[{ksb_code, classification: main|secondary|possible,
##      weight_class: hard|soft|possible, weight>0}])`
9.1 Validate: component exists, not archived; codes in programme standard (Step 7.3 logic shared);
    enums; weight > 0; reuse `validate_ksb_mapping_payload` rules; duplicate code in payload → error;
    code already mapped → becomes an UPDATE of that mapping (shown in preview as "change S2: soft → hard").
9.2 Impact: if the module is used by any active cohort (via cohort/group module assignment), call
    `curriculum/modules/<id>/learner-ksb-impact/` (or week-level) and include in preview:
    "Module used by 2 active cohorts. Mapping changes apply to FUTURE completions only; 37 learners who already
    completed this component keep their old KSB record."
9.3 Apply via `curriculum/components/<id>/ksb-mappings/` (create) and `curriculum/ksb-mappings/<id>/` (update).
    Removal of mappings is NOT supported in v1 (tell the user to remove in the Module Builder).
9.4 Remember mappings are stored twice (component JSON + table) — use the endpoint that keeps both in sync;
    verify after apply by re-reading structure.

## 9B `add_lesson_content(week_id, component_id? | new_component:{title}, title, body_markdown,
##      expected_otjh_minutes?)`
9.5 Validate: week exists, not archived; Markdown only (A8 rules from 7.6); size cap 50 KB.
    Existing component with content → preview shows it will be REPLACED with a diff summary; require
    `replace_existing:true` in args, else error.
9.6 Apply via existing component create/update endpoint; status draft where the model supports it.
9.7 Find how the Module Builder stores rich content (HTML vs Markdown) for components. If it stores HTML,
    convert Markdown → sanitised HTML server-side using the same sanitiser the app already uses (search for
    bleach/nh3/DOMPurify equivalents); if none exists, STOP and report — do not add an unsanitised path.

## Tests
Mapping create/update; wrong standard; live-cohort impact text; double-storage consistency;
lesson create; replace without flag refused; HTML/script refused.

## Acceptance checklist
- [ ] KSB coverage tool reflects new mappings after apply.
