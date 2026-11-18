-- STAGING ONLY: extra activity migration rehearsal for LMS ideal architecture.
-- DO NOT RUN until backend readers/writers are updated and verified.
-- Preserves source reflection submissions; no DELETE/UPDATE of source rows.
-- Existing extra_activities.learner_id references enrolment.Created_users, NOT Learner.learners.
-- Keep enrolment identity in learner_id and explicitly retain canonical identity separately.
BEGIN;
ALTER TABLE "Learner".extra_activities
  ADD COLUMN IF NOT EXISTS canonical_learner_id bigint REFERENCES "Learner".learners(id) ON DELETE RESTRICT;
ALTER TABLE "Learner".extra_activities
  ADD COLUMN IF NOT EXISTS source_reflection_id uuid REFERENCES "Learner".learning_reflection_submissions(id) ON DELETE RESTRICT;
ALTER TABLE "Learner".extra_activities
  ADD COLUMN IF NOT EXISTS reflection_payload jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS extra_activities_source_reflection_uidx
  ON "Learner".extra_activities(source_reflection_id)
  WHERE source_reflection_id IS NOT NULL;
-- Original constraint rejected 0-minute drafts (11 of 18 drafts).
-- Only drafts may be zero; submitted/approved items retain positive duration.
ALTER TABLE "Learner".extra_activities
  DROP CONSTRAINT IF EXISTS extra_activities_requested_minutes_check;
ALTER TABLE "Learner".extra_activities
  ADD CONSTRAINT extra_activities_requested_minutes_check
  CHECK (
    (status = 'draft' AND requested_minutes BETWEEN 0 AND 1440)
    OR (status <> 'draft' AND requested_minutes BETWEEN 1 AND 1440)
  );
-- Stop if any source identity is unresolved; never silently assign the wrong learner.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Learner".learning_reflection_submissions r
    LEFT JOIN "Learner".learners l ON l.id=r.learner_id
    LEFT JOIN enrolment."Created_users" e ON e.id=l.enrolment_id
    WHERE r.activity_type='extra_activity'
      AND (l.id IS NULL OR e.id IS NULL
           OR r.legacy_enrolment_id IS DISTINCT FROM l.enrolment_id::text)
  ) THEN
    RAISE EXCEPTION 'Extra activity learner identity mismatch; migration aborted';
  END IF;
END $$;
INSERT INTO "Learner".extra_activities (
 id, learner_kind, learner_id, canonical_learner_id, source_reflection_id,
 title, description, activity_type, activity_date, requested_minutes,
 approved_minutes, status, review_note, reviewed_by, reviewed_at, submitted_at,
 files, history, progress_entry_id, version, created_at, updated_at, reflection_payload
)
SELECT
 substring(r.activity_id FROM 7)::uuid,
 r.learner_kind, l.enrolment_id, r.learner_id, r.id,
 COALESCE(NULLIF(btrim(r.activity_title),''),'Untitled extra activity'),
 r.learning_reflection, 'other', r.date_completed,
 round(r.actual_time_hours::numeric*60)::integer,
 CASE WHEN r.status='accepted' THEN round(r.actual_time_hours::numeric*60)::integer ELSE NULL END,
 CASE r.status WHEN 'accepted' THEN 'approved'
               WHEN 'submitted_for_tutor_review' THEN 'pending'
               WHEN 'draft' THEN 'draft' END,
 COALESCE(r.coach_feedback,''), COALESCE(r.reviewed_by,''),r.reviewed_at,r.submitted_at,
 CASE WHEN jsonb_typeof(r.evidence_files)='array' THEN r.evidence_files ELSE '[]'::jsonb END,
 jsonb_build_array(jsonb_build_object('event','migrated_from_reflection','source_reflection_id',r.id,
   'original_status',r.status,'migrated_at',CURRENT_TIMESTAMP)),
 r.progress_entry_id,0,r.submitted_at,r.submitted_at,to_jsonb(r)
FROM "Learner".learning_reflection_submissions r
JOIN "Learner".learners l ON l.id=r.learner_id
WHERE r.activity_type='extra_activity'
ON CONFLICT (id) DO NOTHING;
-- Must be 1:1; collisions or missing rows cause rollback.
DO $$
DECLARE expected int; linked int;
BEGIN
  SELECT count(*) INTO expected FROM "Learner".learning_reflection_submissions
  WHERE activity_type='extra_activity';
  SELECT count(*) INTO linked FROM "Learner".extra_activities e
  JOIN "Learner".learning_reflection_submissions r ON r.id=e.source_reflection_id
  WHERE r.activity_type='extra_activity' AND e.canonical_learner_id=r.learner_id;
  IF linked <> expected THEN
    RAISE EXCEPTION 'Migration incomplete: linked % of expected %',linked,expected;
  END IF;
END $$;
COMMIT;
-- READ-ONLY verification after migration:
-- SELECT status,count(*) FROM "Learner".extra_activities WHERE source_reflection_id IS NOT NULL GROUP BY 1;
-- SELECT count(*) FROM "Learner".learning_reflection_submissions WHERE activity_type='extra_activity';
