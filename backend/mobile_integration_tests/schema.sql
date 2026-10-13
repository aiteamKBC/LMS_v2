-- Additive reward evidence. The existing Engagement wallet remains authoritative.
-- Install only after verifying default/enrolment point to the same intended database.
CREATE TABLE "Engagement".shared_reward_config (
 module_id text PRIMARY KEY,
 enabled boolean NOT NULL DEFAULT false,
 starts_at timestamptz,
 programme_start date,
 module_end date,
 semester_end date,
 masterclass_event_id bigint REFERENCES "Engagement".events(id),
 updated_by text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (NOT enabled OR starts_at IS NOT NULL)
);
CREATE TABLE "Engagement".shared_reward_sessions (
 session_id text PRIMARY KEY,
 learner_id text NOT NULL,
 learner_kind text NOT NULL CHECK(learner_kind IN ('apprenticeship','commercial')),
 profile_id bigint NOT NULL,
 component_id text NOT NULL,
 module_id text NOT NULL REFERENCES "Engagement".shared_reward_config(module_id),
 week_id text NOT NULL,
 activity_kind text NOT NULL CHECK(activity_kind IN ('component','video','quiz')),
 activity_id text NOT NULL,
 counting_mode text NOT NULL CHECK(counting_mode IN ('active_playback','active_quiz')),
 started_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 token_sha256 char(64) NOT NULL,
 review_required boolean NOT NULL,
 component_type text NOT NULL,
 component_title text NOT NULL,
 module_title text NOT NULL,
 week_title text NOT NULL,
 last_sequence integer NOT NULL DEFAULT 0,
 last_end_offset_ms bigint NOT NULL DEFAULT 0,
 observed_ms bigint NOT NULL DEFAULT 0,
 CHECK(expires_at>started_at),
 CHECK(last_sequence>=0 AND last_end_offset_ms>=0 AND observed_ms>=0)
);
CREATE INDEX shared_reward_sessions_owner ON "Engagement".shared_reward_sessions(learner_id,started_at);
CREATE TABLE "Engagement".shared_reward_observations (
 event_id text PRIMARY KEY,
 session_id text NOT NULL REFERENCES "Engagement".shared_reward_sessions(session_id),
 sequence integer NOT NULL CHECK(sequence>0),
 payload_sha256 char(64) NOT NULL,
 intervals jsonb NOT NULL CHECK(jsonb_typeof(intervals)='array'),
 observed_ms bigint NOT NULL CHECK(observed_ms>=0),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(session_id,sequence)
);
CREATE TABLE "Engagement".shared_reward_outbox (
 progress_id bigint PRIMARY KEY,
 session_id text NOT NULL UNIQUE REFERENCES "Engagement".shared_reward_sessions(session_id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','waiting_review','done','rejected')),
 attempts integer NOT NULL DEFAULT 0,
 reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz,
 completed_at timestamptz
);
CREATE TABLE "Engagement".shared_reward_acceptances (
 session_id text PRIMARY KEY REFERENCES "Engagement".shared_reward_sessions(session_id),
 progress_id bigint NOT NULL UNIQUE,
 accepted_ms bigint NOT NULL CHECK(accepted_ms>=0),
 accepted_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(reason='canonical_saved_study'),
 policy_version text NOT NULL
);
CREATE TABLE "Engagement".shared_reward_saved_progress (
 progress_id bigint PRIMARY KEY,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','waiting_review','done','not_scoped')),
 module_id text,
 component_id text,
 attempts integer NOT NULL DEFAULT 0,
 checked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL DEFAULT ''
);
CREATE TABLE "Engagement".shared_reward_active_intervals (
 receipt_id text PRIMARY KEY,
 session_id text NOT NULL REFERENCES "Engagement".shared_reward_acceptances(session_id),
 learner_id text NOT NULL,
 active_start timestamptz NOT NULL,
 active_end timestamptz NOT NULL,
 CHECK(active_end>active_start AND active_end<=active_start+interval '5 seconds')
);
CREATE INDEX shared_reward_intervals_owner ON "Engagement".shared_reward_active_intervals(learner_id,active_start);
CREATE TABLE "Engagement".shared_reward_bonus_verifications (
 id text PRIMARY KEY,
 learner_id text NOT NULL,
 module_id text NOT NULL REFERENCES "Engagement".shared_reward_config(module_id),
 opportunity text NOT NULL,
 scope_key text NOT NULL,
 evidence_reference text NOT NULL,
 completion_date date NOT NULL,
 verified_by text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now(),
 points integer NOT NULL CHECK(points>0),
 grant_id bigint REFERENCES "Engagement".points_grants(id),
 UNIQUE(learner_id,scope_key)
);
CREATE TABLE "Engagement".shared_reward_voucher_options (
 reward_id bigint PRIMARY KEY REFERENCES "Engagement".rewards(id),
 amount_gbp integer NOT NULL CHECK(amount_gbp>0),
 enabled boolean NOT NULL DEFAULT false,
 UNIQUE(amount_gbp)
);
CREATE TABLE "Engagement".shared_reward_voucher_requests (
 request_id text PRIMARY KEY,
 learner_id text NOT NULL,
 amount_gbp integer NOT NULL CHECK(amount_gbp>0),
 claim_id bigint NOT NULL UNIQUE REFERENCES "Engagement".voucher_claims(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "Engagement".shared_reward_leaderboard_optins (
 learner_id text NOT NULL,
 module_id text NOT NULL REFERENCES "Engagement".shared_reward_config(module_id),
 display_name varchar(80) NOT NULL,
 opted_in boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(learner_id,module_id)
);
CREATE TABLE "Engagement".shared_reward_award_links (
 grant_id bigint PRIMARY KEY REFERENCES "Engagement".points_grants(id),
 module_id text NOT NULL REFERENCES "Engagement".shared_reward_config(module_id),
 source_reference text NOT NULL
);
CREATE OR REPLACE FUNCTION "Engagement".shared_reward_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'shared_reward_evidence_is_immutable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER shared_reward_observations_immutable BEFORE UPDATE OR DELETE
 ON "Engagement".shared_reward_observations FOR EACH ROW EXECUTE FUNCTION "Engagement".shared_reward_immutable();
CREATE TRIGGER shared_reward_acceptances_immutable BEFORE UPDATE OR DELETE
 ON "Engagement".shared_reward_acceptances FOR EACH ROW EXECUTE FUNCTION "Engagement".shared_reward_immutable();
CREATE TRIGGER shared_reward_intervals_immutable BEFORE UPDATE OR DELETE
 ON "Engagement".shared_reward_active_intervals FOR EACH ROW EXECUTE FUNCTION "Engagement".shared_reward_immutable();
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
    AND EXISTS (SELECT 1 FROM "Engagement".shared_reward_config
                WHERE module_id='MOD-KBC-PMP-M01-SMR' AND enabled AND NEW.submitted_at>=starts_at)
 THEN
   INSERT INTO "Engagement".shared_reward_saved_progress(progress_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shared_reward_progress_outbox AFTER INSERT
 ON "Learner".learner_progress_entries FOR EACH ROW EXECUTE FUNCTION "Engagement".shared_reward_queue_progress();
REVOKE ALL ON "Engagement".shared_reward_config,
 "Engagement".shared_reward_sessions, "Engagement".shared_reward_observations,
 "Engagement".shared_reward_outbox, "Engagement".shared_reward_acceptances,
 "Engagement".shared_reward_saved_progress,
 "Engagement".shared_reward_active_intervals, "Engagement".shared_reward_bonus_verifications,
 "Engagement".shared_reward_voucher_options, "Engagement".shared_reward_voucher_requests,
 "Engagement".shared_reward_leaderboard_optins, "Engagement".shared_reward_award_links FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "Engagement".shared_reward_immutable(),
 "Engagement".shared_reward_queue_progress() FROM PUBLIC;
