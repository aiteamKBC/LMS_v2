-- Identity column renames: read-only preflight. Run on the exact target first.
-- Every row must say ok. Any other row: stop, do not run 01.
BEGIN READ ONLY;

WITH expected(schema_name, table_name, old_column, new_column) AS (VALUES
  ('Engagement', 'voucher_claims',                       'learner_id', 'enrolment_id'),
  ('Engagement', 'recognitions',                         'learner_id', 'enrolment_id'),
  ('Engagement', 'event_bookings',                       'learner_id', 'enrolment_id'),
  ('Engagement', 'club_memberships',                     'learner_id', 'enrolment_id'),
  ('Engagement', 'club_meeting_attendance',              'learner_id', 'enrolment_id'),
  ('Engagement', 'event_attendance',                     'learner_id', 'enrolment_id'),
  ('Engagement', 'attendance_interventions',             'learner_id', 'enrolment_id'),
  ('Engagement', 'points_grants',                        'learner_id', 'enrolment_id'),
  ('Engagement', 'flash_card_views',                     'learner_id', 'enrolment_id'),
  ('Feedback',   'feedback_delivery_recipients',         'learner_id', 'enrolment_id'),
  ('Feedback',   'feedback_review_deliveries',           'learner_id', 'enrolment_id'),
  ('Feedback',   'feedback_employer_review_deliveries',  'learner_id', 'enrolment_id'),
  ('Feedback',   'feedback_event_recipients',            'learner_id', 'enrolment_id'),
  ('Feedback',   'event_rsvp_recipients',                'learner_id', 'enrolment_id'),
  ('Feedback',   'feedback_responses',                   'learner_id', 'enrolment_id'),
  ('enrolment',  'Extended_ILR',                         'Learner_id', 'enrolment_id'),
  ('enrolment',  'Wizard_Personal_Details',              'Learner_id', 'enrolment_id'),
  ('enrolment',  'Wizard_Ilr_Learner_Details',           'Learner_id', 'enrolment_id'),
  ('enrolment',  'Wizard_Skills_Radar',                  'Learner_id', 'enrolment_id'),
  ('enrolment',  'Wizard_Ksb_Assessments',               'Learner_id', 'enrolment_id'),
  ('enrolment',  'Wizard_Plr',                           'Learner_id', 'enrolment_id'),
  ('enrolment',  'Wizard_Plr_Records',                   'Learner_id', 'enrolment_id'),
  ('enrolment',  'Wizard_Policy_Acks',                   'Learner_id', 'enrolment_id'),
  ('enrolment',  'Wizard_Cv_Job',                        'Learner_id', 'enrolment_id'),
  ('chat',       'conversations',                        'learner_id',           'learner_profile_id'),
  ('chat',       'messages',                             'sender_learner_id',    'sender_learner_profile_id'),
  ('chat',       'message_receipts',                     'recipient_learner_id', 'recipient_learner_profile_id')
)
SELECT * FROM (
SELECT e.schema_name, e.table_name,
       CASE
         WHEN to_regclass(format('%I.%I', e.schema_name, e.table_name)) IS NULL
           THEN 'STOP: table missing (apply engagement_api 0010-0012 first if Feedback)'
         WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns c
                          WHERE c.table_schema = e.schema_name AND c.table_name = e.table_name AND c.column_name = e.old_column)
           THEN 'STOP: old column absent (already renamed?)'
         WHEN EXISTS (SELECT 1 FROM information_schema.columns c
                      WHERE c.table_schema = e.schema_name AND c.table_name = e.table_name AND c.column_name = e.new_column)
           THEN 'STOP: new column already exists'
         ELSE 'ok'
       END AS status
FROM expected e
) checks
ORDER BY status <> 'ok' DESC, schema_name, table_name;

-- The identity migrations must already be recorded (they are state-only).
SELECT app, name,
       CASE WHEN EXISTS (SELECT 1 FROM django_migrations m WHERE m.app = x.app AND m.name = x.name)
            THEN 'ok' ELSE 'STOP: apply this state-only migration first' END AS status
FROM (VALUES ('engagement_api', '0013_rename_learner_id_to_enrolment_id'),
             ('enrolment_api',  '0003_rename_learner_id_to_enrolment_id')) AS x(app, name);

-- engagement_api 0007-0012 must be applied BEFORE 01: 0010 creates
-- feedback_employer_review_deliveries and an index naming learner_id.
-- (On 2026-11-12 Development stopped at 0007, recorded under its older name
-- 0007_feedbackdeliveryquestion_feedbackreviewdelivery.) Expect one row per
-- migration, every status ok.
SELECT x.name,
       CASE WHEN EXISTS (SELECT 1 FROM django_migrations m WHERE m.app = 'engagement_api' AND m.name = x.name)
            THEN 'ok' ELSE 'STOP: run migrate engagement_api 0012 first' END AS status
FROM (VALUES ('0007_feedback_lecture_creation_guard'), ('0008_feedbackdeliveryquestion_feedbackreviewdelivery'),
             ('0009_feedback_lecture_question_override'), ('0009_lecture_tutor_snapshot'),
             ('0010_employer_review_feedback'), ('0011_public_lecture_feedback'),
             ('0012_epa_review_feedback')) AS x(name);

-- Before running those migrations: data they would reject. Expect 0 and 0.
SELECT
  (SELECT count(*) FROM "Feedback".feedback_forms
    WHERE form_type NOT IN ('general', 'post_lecture', 'post_event', 'event_rsvp', 'post_mcm_review',
                            'post_progress_review', 'post_progress_review_employer', 'post_epa_review',
                            'mid_module', 'end_module')) AS form_types_0012_rejects,
  (SELECT count(*) FROM (
     SELECT form_id, learner_id FROM "Feedback".feedback_responses
      WHERE delivery_id IS NULL AND event_recipient_id IS NULL AND rsvp_recipient_id IS NULL
        AND review_delivery_id IS NULL
      GROUP BY 1, 2 HAVING count(*) > 1) d) AS duplicates_0010_unique_index_rejects;

-- Function bodies are not rewritten by RENAME COLUMN. 01 replaces the one
-- known body; any other row listed here must be handled before running 01.
SELECT n.nspname, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND p.proname <> 'ensure_plr_parent_for_record'
  AND (p.prosrc ~* '(voucher_claims|recognitions|event_bookings|club_memberships|club_meeting_attendance|event_attendance|attendance_interventions|points_grants|flash_card_views|feedback_delivery_recipients|feedback_review_deliveries|feedback_employer_review_deliveries|feedback_event_recipients|event_rsvp_recipients|feedback_responses|Extended_ILR|Wizard_|chat\.(conversations|messages|message_receipts))'
       AND p.prosrc ~* '(learner_id)');

ROLLBACK;
