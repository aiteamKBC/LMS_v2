CREATE SCHEMA "Engagement"; CREATE SCHEMA "Learner";
CREATE TABLE "Engagement".points_rules(
 id bigserial PRIMARY KEY,name varchar(255) NOT NULL,description text NOT NULL,points integer NOT NULL,
 category varchar(100) NOT NULL,frequency varchar(100) NOT NULL,trigger varchar(255) NOT NULL,
 active boolean NOT NULL,key varchar(100),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX points_rules_key_active_uniq ON "Engagement".points_rules(key) WHERE active AND key IS NOT NULL;
CREATE TABLE "Engagement".points_grants(
 id bigserial PRIMARY KEY,rule_id bigint NOT NULL REFERENCES "Engagement".points_rules(id),
 learner_id varchar(100) NOT NULL,learner_name varchar(255) NOT NULL,points integer NOT NULL,awarded_at timestamptz NOT NULL DEFAULT now(),
 event_reference varchar(255),awarded_by varchar(255),source_type varchar(20),source_id varchar(255),reason varchar(255));
CREATE UNIQUE INDEX points_grants_rule_ref_uniq ON "Engagement".points_grants(rule_id,event_reference) WHERE event_reference IS NOT NULL;
CREATE TABLE "Engagement".rewards(
 id bigserial PRIMARY KEY,name varchar(255) NOT NULL,description text NOT NULL DEFAULT '',points integer NOT NULL,
 category varchar(100) NOT NULL DEFAULT '',delivery_type varchar(20) NOT NULL,stock integer NOT NULL DEFAULT 0,
 total_claimed integer NOT NULL DEFAULT 0,image text NOT NULL DEFAULT '',popular boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE "Engagement".voucher_claims(
 id bigserial PRIMARY KEY,learner_id varchar(100) NOT NULL,learner_name varchar(255) NOT NULL,reward_id bigint NOT NULL REFERENCES "Engagement".rewards(id),
 points integer NOT NULL,status varchar(20) NOT NULL DEFAULT 'pending',requested_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by varchar(255),reviewed_at timestamptz,delivery_type varchar(20) NOT NULL,delivery_method varchar(20) NOT NULL DEFAULT '',
 delivery_detail varchar(255),delivery_instructions text);
CREATE TABLE "Engagement".events(id bigserial PRIMARY KEY);
CREATE TABLE "Engagement".event_bookings(id bigserial PRIMARY KEY,event_id bigint NOT NULL,learner_id text NOT NULL,status text NOT NULL);
CREATE TABLE "Learner".learners(id bigint PRIMARY KEY,enrolment_id bigint NOT NULL,lifecycle_status text NOT NULL,full_name text NOT NULL);
CREATE TABLE "Learner".learner_progress_entries(
 id bigserial PRIMARY KEY,learner_id bigint NOT NULL REFERENCES "Learner".learners(id),entry_order integer NOT NULL,
 kind text NOT NULL,quiz_ref text,component_ref text,module_ref text,verified_seconds integer,
 time_tracking_source text,time_tracking_session_ref text UNIQUE,started_at timestamptz,submitted_at timestamptz,
 achieved_score numeric(12,2),total_score numeric(12,2));
CREATE TABLE "Learner".learning_reflection_submissions(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,learner_id text NOT NULL,activity_id text NOT NULL,
 progress_entry_id bigint,status text NOT NULL,submitted_at timestamptz NOT NULL DEFAULT now(),
 learner_kind text NOT NULL DEFAULT 'apprenticeship',learner_name text NOT NULL DEFAULT '',
 programme_name text NOT NULL DEFAULT '',activity_type text NOT NULL DEFAULT 'component',
 activity_title text NOT NULL DEFAULT '',module_title text NOT NULL DEFAULT '',week_title text NOT NULL DEFAULT '',
 planned_otjh text NOT NULL DEFAULT '',learning_reflection text NOT NULL DEFAULT '',evidence_files jsonb,
 actual_time_hours numeric,quality_score numeric,coach_feedback text,reviewed_by text,reviewed_at timestamptz,
 component_ref text,assignment_topic_id text NOT NULL DEFAULT '',
 UNIQUE(learner_kind,learner_id,activity_type,activity_id,assignment_topic_id));
CREATE TABLE "Learner".evidence_files(id uuid PRIMARY KEY,learner_id text NOT NULL,status text NOT NULL,
 learner_kind text NOT NULL DEFAULT 'apprenticeship',original_filename text,section_ref text,uploaded_at timestamptz DEFAULT now());
