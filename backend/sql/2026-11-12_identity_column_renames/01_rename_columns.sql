-- Identity column renames. One transaction: all succeed or nothing changes.
-- Values are untouched; only names change. Run 00 first; see RUNBOOK.md for
-- the code that must deploy in the same window.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- enrolment."Created_users".id held as text
ALTER TABLE "Engagement".voucher_claims                   RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement".recognitions                     RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement".event_bookings                   RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement".club_memberships                 RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement".club_meeting_attendance          RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement".event_attendance                 RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement".attendance_interventions         RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement".points_grants                    RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement".flash_card_views                 RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback".feedback_delivery_recipients       RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback".feedback_review_deliveries         RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback".feedback_employer_review_deliveries RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback".feedback_event_recipients          RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback".event_rsvp_recipients              RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback".feedback_responses                 RENAME COLUMN learner_id TO enrolment_id;

-- enrolment."Created_users".id
ALTER TABLE enrolment."Extended_ILR"               RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Personal_Details"    RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Ilr_Learner_Details" RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Skills_Radar"        RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Ksb_Assessments"     RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Plr"                 RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Plr_Records"         RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Policy_Acks"         RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Cv_Job"              RENAME COLUMN "Learner_id" TO enrolment_id;

-- The PLR trigger names the column in its body, which RENAME does not rewrite.
CREATE OR REPLACE FUNCTION enrolment.ensure_plr_parent_for_record()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    INSERT INTO enrolment."Wizard_Plr" ("Learner_kind", enrolment_id)
    VALUES (NEW."Learner_kind", NEW.enrolment_id)
    ON CONFLICT ("Learner_kind", enrolment_id) DO NOTHING;
    RETURN NEW;
END
$function$;

-- "Learner".learners.id (chat foreign keys; constraints follow the rename)
ALTER TABLE chat.conversations    RENAME COLUMN learner_id           TO learner_profile_id;
ALTER TABLE chat.messages         RENAME COLUMN sender_learner_id    TO sender_learner_profile_id;
ALTER TABLE chat.message_receipts RENAME COLUMN recipient_learner_id TO recipient_learner_profile_id;

COMMIT;

-- Verify (read-only): expect 27 rows, 0 remaining old names.
SELECT table_schema, table_name, column_name
FROM information_schema.columns
WHERE (table_schema IN ('Engagement', 'Feedback') AND column_name = 'enrolment_id')
   OR (table_schema = 'enrolment' AND table_name IN ('Extended_ILR', 'Wizard_Personal_Details', 'Wizard_Ilr_Learner_Details',
       'Wizard_Skills_Radar', 'Wizard_Ksb_Assessments', 'Wizard_Plr', 'Wizard_Plr_Records', 'Wizard_Policy_Acks', 'Wizard_Cv_Job')
       AND column_name = 'enrolment_id')
   OR (table_schema = 'chat' AND column_name IN ('learner_profile_id', 'sender_learner_profile_id', 'recipient_learner_profile_id'))
ORDER BY 1, 2;
