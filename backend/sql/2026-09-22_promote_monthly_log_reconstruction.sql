-- Promote the formula-backed Monthly Logs projection into the canonical journal.
--
-- SAFETY:
--   * This script is scoped to the 13 agreed Aptem IDs and August 2026.
--   * It never overwrites a non-zero hour, a non-empty KSB mapping, or a row
--     with an approved hours revision.
--   * It keeps the provisional records as audit history and marks them
--     "promoted" instead of deleting them.
--   * This copy is the approved promotion and ends with COMMIT. Conflicting
--     or invalid rows remain unresolved instead of being moved or duplicated.
--
-- Run against the same Neon database that contains the structured_manual_activities
-- schema. Do not run this through the LMS application connection pool while a
-- learner is signing a record.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

LOCK TABLE structured_manual_activities.manual_learner_activities
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE _monthly_log_promotion_meta ON COMMIT DROP AS
SELECT gen_random_uuid() AS run_id,
       'sql-promote-formula-reconstruction-2026-08'::text AS actor;

-- Resolve a provisional entry to its canonical row where possible. The
-- payload id handles the historical row:<id> fallback; source_ref handles
-- normal manual rows and imported LMS rows already present in the journal.
CREATE TEMP TABLE _monthly_log_promotion ON COMMIT DROP AS
SELECT p.id AS provisional_id,
       p.aptem_id,
       p.month,
       p.source_ref,
       p.payload,
       p.provisional_fields,
       p.formula_rule,
       COALESCE(by_ref.id, by_payload_id.id) AS canonical_id
FROM structured_manual_activities.monthly_log_provisional_rows p
LEFT JOIN structured_manual_activities.manual_learner_activities by_ref
  ON by_ref.aptem_id = p.aptem_id
 AND by_ref.month = p.month
 AND by_ref.source_ref = p.source_ref
 AND by_ref.deleted_at IS NULL
LEFT JOIN structured_manual_activities.manual_learner_activities by_payload_id
  ON by_payload_id.aptem_id = p.aptem_id
 AND by_payload_id.deleted_at IS NULL
 AND by_payload_id.id = CASE
       WHEN p.payload->>'id' ~ '^[0-9]+$' THEN (p.payload->>'id')::bigint
       ELSE NULL
     END
WHERE p.status = 'provisional'
  AND p.aptem_id = ANY (ARRAY[
    4605,4778,4737,4937,4765,4579,4275,
    4336,4124,4445,4626,4841,4002
  ]::bigint[])
  AND p.month <= '2026-08';

CREATE INDEX _monthly_log_promotion_id_idx
  ON _monthly_log_promotion (provisional_id);
CREATE INDEX _monthly_log_promotion_canonical_idx
  ON _monthly_log_promotion (canonical_id);
ALTER TABLE _monthly_log_promotion
  ADD COLUMN was_inserted boolean NOT NULL DEFAULT false;

-- PRE-FLIGHT: these counts should be reviewed before the promotion statements.
SELECT
  count(*) AS provisional_rows,
  count(*) FILTER (WHERE canonical_id IS NOT NULL) AS rows_already_in_journal,
  count(*) FILTER (WHERE canonical_id IS NULL AND source_ref LIKE 'la:%'
    AND payload->>'category' IN ('attendance','video','audio','reading+quiz','assignment')
    AND NULLIF(payload->>'title', '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM structured_manual_activities.manual_learner_activities existing
      WHERE existing.aptem_id = _monthly_log_promotion.aptem_id
        AND existing.deleted_at IS NULL
        AND structured_manual_activities.lms_material_activity_ids(existing.source_ref, existing.activity_id)
            && structured_manual_activities.lms_material_activity_ids(
                 _monthly_log_promotion.source_ref,
                 CASE WHEN _monthly_log_promotion.payload->>'activity_id' ~ '^[0-9]+$'
                      THEN (_monthly_log_promotion.payload->>'activity_id')::bigint END)
    )) AS LMS_rows_to_insert,
  count(*) FILTER (WHERE canonical_id IS NULL AND source_ref LIKE 'la:%'
    AND (payload->>'category' NOT IN ('attendance','video','audio','reading+quiz','assignment')
         OR NULLIF(payload->>'title', '') IS NULL)) AS invalid_lms_rows,
  count(*) FILTER (WHERE canonical_id IS NULL AND source_ref LIKE 'la:%'
    AND EXISTS (
      SELECT 1
      FROM structured_manual_activities.manual_learner_activities existing
      WHERE existing.aptem_id = _monthly_log_promotion.aptem_id
        AND existing.deleted_at IS NULL
        AND structured_manual_activities.lms_material_activity_ids(existing.source_ref, existing.activity_id)
            && structured_manual_activities.lms_material_activity_ids(
                 _monthly_log_promotion.source_ref,
                 CASE WHEN _monthly_log_promotion.payload->>'activity_id' ~ '^[0-9]+$'
                      THEN (_monthly_log_promotion.payload->>'activity_id')::bigint END)
    )) AS conflicting_lms_rows,
  count(*) FILTER (WHERE canonical_id IS NULL AND source_ref NOT LIKE 'la:%') AS unresolved_rows,
  count(*) FILTER (WHERE provisional_fields @> '["actual"]'::jsonb) AS actual_fields,
  count(*) FILTER (WHERE provisional_fields @> '["planned"]'::jsonb) AS planned_fields,
  count(*) FILTER (WHERE provisional_fields @> '["ksb"]'::jsonb) AS ksb_fields
FROM _monthly_log_promotion;

-- LMS-projected activities that have no manual row yet become ordinary journal
-- rows before their KSB mappings are stored. If the same LMS material already
-- exists under another source_ref/month, the trigger correctly treats it as a
-- duplicate; those rows remain unresolved instead of being moved or duplicated.
WITH inserted AS (
  INSERT INTO structured_manual_activities.manual_learner_activities (
    aptem_id, learner_id, month, category, source_ref, group_id, activity_id,
    title, activity_date, activity_time, planned_hours, actual_hours,
    timestamp_label, completion_note, accepted, created_by, updated_by,
    activity_date_manual_override, merge_source_snapshot
  )
  SELECT
    p.aptem_id,
    l.learner_id,
    p.month,
    p.payload->>'category',
    p.source_ref,
    CASE WHEN p.payload->>'group_id' ~ '^[0-9]+$'
         THEN (p.payload->>'group_id')::bigint END,
    CASE WHEN p.payload->>'activity_id' ~ '^[0-9]+$'
         THEN (p.payload->>'activity_id')::bigint END,
    NULLIF(p.payload->>'title', ''),
    CASE WHEN p.payload->>'activity_date' ~ '^\d{4}-\d{2}-\d{2}$'
         THEN (p.payload->>'activity_date')::date END,
    CASE WHEN p.payload->>'activity_time' ~ '^\d{2}:\d{2}(:\d{2})?$'
         THEN (p.payload->>'activity_time')::time END,
    GREATEST(COALESCE(NULLIF(p.payload->>'planned_hours','')::numeric, 0), 0),
    GREATEST(COALESCE(NULLIF(p.payload->>'actual_hours','')::numeric, 0), 0),
    COALESCE(p.payload->>'timestamp_label', ''),
    NULLIF(p.payload->>'completion_note', ''),
    CASE WHEN lower(COALESCE(p.payload->>'accepted','true')) IN ('true','t','1')
         THEN true ELSE false END,
    meta.actor,
    meta.actor,
    false,
    jsonb_build_object(
      'promotion_source', 'monthly_log_provisional_rows',
      'provisional_id', p.provisional_id,
      'provisional_run_id', meta.run_id,
      'formula_rule', p.formula_rule
    )
  FROM _monthly_log_promotion p
  CROSS JOIN _monthly_log_promotion_meta meta
  LEFT JOIN "Last_audit".learners l ON l.aptem_id = p.aptem_id
  WHERE p.canonical_id IS NULL
    AND p.source_ref LIKE 'la:%'
    AND p.payload->>'category' IN ('attendance','video','audio','reading+quiz','assignment')
    AND NULLIF(p.payload->>'title', '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM structured_manual_activities.manual_learner_activities existing
      WHERE existing.aptem_id = p.aptem_id
        AND existing.month = p.month
        AND existing.source_ref = p.source_ref
        AND existing.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM structured_manual_activities.manual_learner_activities existing_material
      WHERE existing_material.aptem_id = p.aptem_id
        AND existing_material.deleted_at IS NULL
        AND structured_manual_activities.lms_material_activity_ids(
              existing_material.source_ref, existing_material.activity_id)
            && structured_manual_activities.lms_material_activity_ids(
              p.source_ref,
              CASE WHEN p.payload->>'activity_id' ~ '^[0-9]+$'
                   THEN (p.payload->>'activity_id')::bigint END)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM _monthly_log_promotion earlier
      WHERE earlier.provisional_id < p.provisional_id
        AND earlier.canonical_id IS NULL
        AND earlier.source_ref LIKE 'la:%'
        AND earlier.aptem_id = p.aptem_id
        AND structured_manual_activities.lms_material_activity_ids(
              earlier.source_ref,
              CASE WHEN earlier.payload->>'activity_id' ~ '^[0-9]+$'
                   THEN (earlier.payload->>'activity_id')::bigint END)
            && structured_manual_activities.lms_material_activity_ids(
              p.source_ref,
              CASE WHEN p.payload->>'activity_id' ~ '^[0-9]+$'
                   THEN (p.payload->>'activity_id')::bigint END)
    )
  RETURNING id, aptem_id, month, source_ref
)
UPDATE _monthly_log_promotion p
SET canonical_id = inserted.id,
    was_inserted = true
FROM inserted
WHERE inserted.aptem_id = p.aptem_id
  AND inserted.month = p.month
  AND inserted.source_ref = p.source_ref;

-- Capture the old values before applying the field-level promotion. This is
-- what makes the audit rows below reviewable and prevents silent overwrites.
CREATE TEMP TABLE _monthly_log_promotion_changes ON COMMIT DROP AS
SELECT p.*,
       m.planned_hours AS old_planned_hours,
       m.actual_hours AS old_actual_hours,
       k.ksbs AS old_ksbs,
       r_planned.revision_id AS approved_planned_revision,
       r_actual.revision_id AS approved_actual_revision
FROM _monthly_log_promotion p
JOIN structured_manual_activities.manual_learner_activities m
  ON m.id = p.canonical_id
 AND m.aptem_id = p.aptem_id
 AND m.deleted_at IS NULL
LEFT JOIN structured_manual_activities.learner_journal_row_ksbs k
  ON k.row_id = m.id
 AND k.aptem_id = m.aptem_id
LEFT JOIN LATERAL (
  SELECT revision_id
  FROM structured_manual_activities.manual_activity_hours_revision r
  WHERE r.row_id = m.id AND r.aptem_id = m.aptem_id
    AND r.status = 'approved' AND r.proposed_planned_hours IS NOT NULL
  ORDER BY r.revision_id DESC LIMIT 1
) r_planned ON true
LEFT JOIN LATERAL (
  SELECT revision_id
  FROM structured_manual_activities.manual_activity_hours_revision r
  WHERE r.row_id = m.id AND r.aptem_id = m.aptem_id
    AND r.status = 'approved' AND r.proposed_actual_hours IS NOT NULL
  ORDER BY r.revision_id DESC LIMIT 1
) r_actual ON true;

-- Hours are promoted only into an empty canonical field and only when there
-- is no approved revision for that field.
UPDATE structured_manual_activities.manual_learner_activities m
SET planned_hours = GREATEST(COALESCE(NULLIF(c.payload->>'planned_hours','')::numeric, 0), 0),
    updated_by = meta.actor,
    updated_at = now()
FROM _monthly_log_promotion_changes c
CROSS JOIN _monthly_log_promotion_meta meta
WHERE m.id = c.canonical_id
  AND c.provisional_fields @> '["planned"]'::jsonb
  AND c.old_planned_hours = 0
  AND c.approved_planned_revision IS NULL;

UPDATE structured_manual_activities.manual_learner_activities m
SET actual_hours = GREATEST(COALESCE(NULLIF(c.payload->>'actual_hours','')::numeric, 0), 0),
    updated_by = meta.actor,
    updated_at = now()
FROM _monthly_log_promotion_changes c
CROSS JOIN _monthly_log_promotion_meta meta
WHERE m.id = c.canonical_id
  AND c.provisional_fields @> '["actual"]'::jsonb
  AND c.old_actual_hours = 0
  AND c.approved_actual_revision IS NULL;

-- KSBs are written only when the row-level mapping is empty. Existing KSB
-- history wins; no learner/activity mapping is replaced by this statement.
INSERT INTO structured_manual_activities.learner_journal_row_ksbs
  (row_id, aptem_id, ksbs, version, created_by, updated_by)
SELECT c.canonical_id,
       c.aptem_id,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('code', codes.code) ORDER BY codes.ord)
         FROM jsonb_array_elements_text(c.payload->'ksb_codes') WITH ORDINALITY AS codes(code, ord)
       ), '[]'::jsonb),
       1,
       meta.actor,
       meta.actor
FROM _monthly_log_promotion_changes c
CROSS JOIN _monthly_log_promotion_meta meta
WHERE c.provisional_fields @> '["ksb"]'::jsonb
  AND jsonb_typeof(c.payload->'ksb_codes') = 'array'
  AND jsonb_array_length(c.payload->'ksb_codes') > 0
ON CONFLICT (row_id) DO UPDATE
SET ksbs = CASE
             WHEN structured_manual_activities.learner_journal_row_ksbs.ksbs IS NULL
               OR structured_manual_activities.learner_journal_row_ksbs.ksbs = '[]'::jsonb
             THEN EXCLUDED.ksbs
             ELSE structured_manual_activities.learner_journal_row_ksbs.ksbs
           END,
    version = structured_manual_activities.learner_journal_row_ksbs.version + 1,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

-- Audit every promoted row/field; the source snapshot remains available in
-- both the audit table and the retained provisional record.
INSERT INTO structured_manual_activities.monthly_log_reconciliation_audit
  (run_id, row_id, aptem_id, month, field, old_value, new_value,
   source, status, reason, created_by)
SELECT meta.run_id, c.canonical_id, c.aptem_id, c.month, 'planned',
       to_jsonb(c.old_planned_hours),
       to_jsonb(GREATEST(COALESCE(NULLIF(c.payload->>'planned_hours','')::numeric, 0), 0)),
       c.formula_rule, 'applied', 'promoted_from_formula_reconstruction', meta.actor
FROM _monthly_log_promotion_changes c
CROSS JOIN _monthly_log_promotion_meta meta
WHERE c.provisional_fields @> '["planned"]'::jsonb
  AND c.old_planned_hours = 0
  AND c.approved_planned_revision IS NULL
UNION ALL
SELECT meta.run_id, c.canonical_id, c.aptem_id, c.month, 'actual',
       to_jsonb(c.old_actual_hours),
       to_jsonb(GREATEST(COALESCE(NULLIF(c.payload->>'actual_hours','')::numeric, 0), 0)),
       c.formula_rule, 'applied', 'promoted_from_formula_reconstruction', meta.actor
FROM _monthly_log_promotion_changes c
CROSS JOIN _monthly_log_promotion_meta meta
WHERE c.provisional_fields @> '["actual"]'::jsonb
  AND c.old_actual_hours = 0
  AND c.approved_actual_revision IS NULL
UNION ALL
SELECT meta.run_id, c.canonical_id, c.aptem_id, c.month, 'ksb',
       COALESCE(c.old_ksbs, '[]'::jsonb),
       COALESCE(c.payload->'ksb_codes', '[]'::jsonb),
       c.formula_rule, 'applied', 'promoted_from_formula_reconstruction', meta.actor
FROM _monthly_log_promotion_changes c
CROSS JOIN _monthly_log_promotion_meta meta
WHERE c.provisional_fields @> '["ksb"]'::jsonb
  AND jsonb_typeof(c.payload->'ksb_codes') = 'array'
  AND jsonb_array_length(c.payload->'ksb_codes') > 0
UNION ALL
SELECT meta.run_id, c.canonical_id, c.aptem_id, c.month, 'row_insert',
       NULL,
       c.payload,
       'lms_projection', 'applied', 'promoted_from_formula_reconstruction', meta.actor
FROM _monthly_log_promotion_changes c
CROSS JOIN _monthly_log_promotion_meta meta
WHERE c.source_ref LIKE 'la:%'
  AND c.old_planned_hours IS NOT NULL
  AND c.old_actual_hours IS NOT NULL
  AND c.provisional_id IS NOT NULL
  AND c.was_inserted;

-- Do not delete the source layer. Mark only rows that now have a canonical
-- target; unresolved row:<id> entries remain visible for a later review.
UPDATE structured_manual_activities.monthly_log_provisional_rows p
SET status = 'promoted', updated_at = now()
FROM _monthly_log_promotion_changes c
WHERE p.id = c.provisional_id;

-- POST-FLIGHT: review these counts and the unresolved list before COMMIT.
SELECT
  count(*) AS promoted_rows,
  (SELECT count(*) FROM _monthly_log_promotion WHERE canonical_id IS NULL) AS unresolved_rows,
  count(*) FILTER (WHERE provisional_fields @> '["actual"]'::jsonb) AS actual_candidates,
  count(*) FILTER (WHERE provisional_fields @> '["planned"]'::jsonb) AS planned_candidates,
  count(*) FILTER (WHERE provisional_fields @> '["ksb"]'::jsonb) AS ksb_candidates
FROM _monthly_log_promotion_changes;

SELECT provisional_id, aptem_id, month, source_ref
FROM _monthly_log_promotion
WHERE canonical_id IS NULL
ORDER BY aptem_id, month, provisional_id;

-- Approved: commit the safe canonical promotion. Conflicting/invalid rows
-- remain in the unresolved result set and retain their source-layer record.
COMMIT;
