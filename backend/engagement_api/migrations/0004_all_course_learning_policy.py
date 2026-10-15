"""Add versioned settings without enabling or changing historical rewards."""
from importlib import import_module
from django.db import migrations

SQL = """
CREATE TABLE "Engagement".learning_reward_policies (
 id bigserial PRIMARY KEY,
 effective_at timestamptz NOT NULL UNIQUE,
 settings jsonb NOT NULL CHECK(jsonb_typeof(settings)='object'),
 created_by text NOT NULL
);
CREATE TRIGGER learning_reward_policies_immutable BEFORE UPDATE OR DELETE
 ON "Engagement".learning_reward_policies FOR EACH ROW
 EXECUTE FUNCTION "Engagement".shared_reward_immutable();
ALTER TABLE "Engagement".shared_reward_sessions
 DROP CONSTRAINT shared_reward_sessions_counting_mode_check;
ALTER TABLE "Engagement".shared_reward_sessions
 ADD CONSTRAINT shared_reward_sessions_counting_mode_check
 CHECK(counting_mode IN ('active_playback','active_quiz','visible_page'));
REVOKE ALL ON "Engagement".learning_reward_policies FROM PUBLIC;
CREATE OR REPLACE FUNCTION "Engagement".shared_reward_queue_progress() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "Engagement".shared_reward_outbox(progress_id,session_id)
 SELECT NEW.id,s.session_id FROM "Engagement".shared_reward_sessions s
 JOIN "Engagement".shared_reward_config c ON c.module_id=s.module_id
 JOIN "Learner".learners l ON l.id=NEW.learner_id
 WHERE s.session_id=NEW.time_tracking_session_ref AND s.profile_id=NEW.learner_id
   AND s.learner_id=l.enrolment_id::text AND c.enabled
   AND NEW.submitted_at>=c.starts_at AND s.started_at>=c.starts_at
 ON CONFLICT DO NOTHING;
 IF NOT EXISTS (SELECT 1 FROM "Engagement".shared_reward_outbox WHERE progress_id=NEW.id)
    AND NEW.kind IN ('quiz','component','video')
    AND (EXISTS (SELECT 1 FROM "Engagement".shared_reward_config
                 WHERE module_id='MOD-KBC-PMP-M01-SMR' AND enabled AND NEW.submitted_at>=starts_at)
         OR EXISTS (SELECT 1 FROM "Engagement".learning_reward_policies WHERE effective_at<=NEW.submitted_at))
 THEN
   INSERT INTO "Engagement".shared_reward_saved_progress(progress_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
"""
def validate_target(apps, schema_editor):
    import_module("engagement_api.migrations.0003_shared_reward_evidence").validate_target(apps, schema_editor)

class Migration(migrations.Migration):
    dependencies = [("engagement_api", "0003_shared_reward_evidence")]
    operations = [migrations.RunPython(validate_target, migrations.RunPython.noop),
                  migrations.RunSQL(SQL)]
