-- ROLLBACK ONLY. Not an apply step. Reverses 01 exactly; values were never
-- changed, so this restores the previous schema with no data loss.
-- Redeploy the previous code (with db_column shims) in the same window.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE chat.conversations    RENAME COLUMN learner_profile_id           TO learner_id;
ALTER TABLE chat.messages         RENAME COLUMN sender_learner_profile_id    TO sender_learner_id;
ALTER TABLE chat.message_receipts RENAME COLUMN recipient_learner_profile_id TO recipient_learner_id;

ALTER TABLE enrolment."Extended_ILR"               RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Personal_Details"    RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Ilr_Learner_Details" RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Skills_Radar"        RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Ksb_Assessments"     RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Plr"                 RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Plr_Records"         RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Policy_Acks"         RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Cv_Job"              RENAME COLUMN enrolment_id TO "Learner_id";

-- Original body, captured read-only from the live database on 2026-11-12.
CREATE OR REPLACE FUNCTION enrolment.ensure_plr_parent_for_record()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    INSERT INTO enrolment."Wizard_Plr" ("Learner_kind", "Learner_id")
    VALUES (NEW."Learner_kind", NEW."Learner_id")
    ON CONFLICT ("Learner_kind", "Learner_id") DO NOTHING;
    RETURN NEW;
END
$function$;

ALTER TABLE "Engagement".voucher_claims                   RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement".recognitions                     RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement".event_bookings                   RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement".club_memberships                 RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement".club_meeting_attendance          RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement".event_attendance                 RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement".attendance_interventions         RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement".points_grants                    RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement".flash_card_views                 RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback".feedback_delivery_recipients       RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback".feedback_review_deliveries         RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback".feedback_employer_review_deliveries RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback".feedback_event_recipients          RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback".event_rsvp_recipients              RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback".feedback_responses                 RENAME COLUMN enrolment_id TO learner_id;

COMMIT;
