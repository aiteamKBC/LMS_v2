-- Curriculum objects the code needs that the new database does not have yet.
--
-- Target: the NEW curriculum database (Neon branch lms-ideal-architecture).
-- Not a migration: run it once, top to bottom, in one transaction. It does not
-- touch django_migrations.
--
-- What is in here: only objects from curriculum migrations written AFTER the new
-- database was built (they are not recorded in its django_migrations), and only
-- the ones confirmed missing on 2026-11-12. Every statement is guarded, so a
-- rerun changes nothing. Nothing is dropped, and no column the new design
-- removed comes back.
--
-- Data was checked before writing the constraints below: no duplicate display
-- orders, no orphan quiz links, no unknown Teams attendance statuses.
--
-- Deliberately NOT included (decisions, not gaps):
--   * live_session_learner_attendance.session_date + its triggers (0073): no code
--     reads it; the model does not declare it.
--   * modules.is_for_sale / price / currency (0079) and the free-course storage
--     projection (0080, its deleted_at columns and sync triggers): the new design
--     keeps pricing on curriculum.free_courses and the free tables standalone.
--     The code paths that still expect the old shape need a decision instead.
--   * enrolment."Staff_users" Access_extra check gaining 'free-course-authoring'
--     (0084): enrolment's table, not curriculum's.
--   * curriculum_live_learner_qr_attendance_fk switching RESTRICT -> CASCADE
--     (0085): the new design keeps RESTRICT; left as it is.

BEGIN;

-- 1. Parallel attendance provenance (migration 0084_parallel_attendance_source).
--    Without these columns every ORM read of the live register fails: Bulk
--    Attendance shows "The live session register could not be read".
ALTER TABLE curriculum.live_session_learner_attendance
    ADD COLUMN IF NOT EXISTS parallel_source_occurrence_id varchar(128),
    ADD COLUMN IF NOT EXISTS parallel_source_module_id varchar(128),
    ADD COLUMN IF NOT EXISTS parallel_previous_status varchar(16),
    ADD COLUMN IF NOT EXISTS parallel_previous_basis varchar(16),
    ADD COLUMN IF NOT EXISTS parallel_created boolean NOT NULL DEFAULT false;

-- The basis check gains 'parallel' (the current check allows the other four).
ALTER TABLE curriculum.live_session_learner_attendance
    DROP CONSTRAINT IF EXISTS curriculum_live_learner_attendance_basis_valid,
    ADD CONSTRAINT curriculum_live_learner_attendance_basis_valid
        CHECK (attendance_basis IN ('teams', 'qr', 'teams_qr', 'staff', 'parallel'));

DO $body$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'curriculum_live_parallel_source_occurrence_fk') THEN
        ALTER TABLE curriculum.live_session_learner_attendance
            ADD CONSTRAINT curriculum_live_parallel_source_occurrence_fk
            FOREIGN KEY (parallel_source_occurrence_id)
            REFERENCES curriculum.live_session_occurrences(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'curriculum_live_parallel_source_pair_valid') THEN
        ALTER TABLE curriculum.live_session_learner_attendance
            ADD CONSTRAINT curriculum_live_parallel_source_pair_valid
            CHECK ((parallel_source_occurrence_id IS NULL) = (parallel_source_module_id IS NULL));
    END IF;
    -- Teams status check (migration 0082_qr_learner_attendance_resolution).
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'curriculum_live_learner_teams_status_valid') THEN
        ALTER TABLE curriculum.live_session_learner_attendance
            ADD CONSTRAINT curriculum_live_learner_teams_status_valid
            CHECK (teams_attendance_status IS NULL OR teams_attendance_status IN ('present', 'absent'));
    END IF;
END
$body$;

CREATE UNIQUE INDEX IF NOT EXISTS curriculum_live_parallel_source_unique
    ON curriculum.live_session_learner_attendance (learner_profile_id, parallel_source_occurrence_id)
    WHERE parallel_source_occurrence_id IS NOT NULL;

-- 2. Deleting QR evidence undoes the parallel attendance it created
--    (migration 0085_qr_attendance_delete_cleanup; the FK change is left out, see above).
CREATE OR REPLACE FUNCTION curriculum.qr_attendance_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    profile_id bigint;
BEGIN
    SELECT learner.id
    INTO profile_id
    FROM "Learner".learners learner
    WHERE learner.enrolment_id = OLD.enrolment_id
    ORDER BY learner.id
    LIMIT 1;

    IF profile_id IS NOT NULL THEN
        DELETE FROM curriculum.live_session_learner_attendance
        WHERE learner_profile_id = profile_id
          AND parallel_source_occurrence_id = OLD.occurrence_id
          AND parallel_source_module_id = OLD.module_id
          AND parallel_created = true;

        UPDATE curriculum.live_session_learner_attendance
        SET attendance_status = COALESCE(parallel_previous_status, 'absent'),
            attendance_basis = COALESCE(parallel_previous_basis, 'teams'),
            parallel_source_occurrence_id = NULL,
            parallel_source_module_id = NULL,
            parallel_previous_status = NULL,
            parallel_previous_basis = NULL,
            parallel_created = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE learner_profile_id = profile_id
          AND parallel_source_occurrence_id = OLD.occurrence_id
          AND parallel_source_module_id = OLD.module_id
          AND parallel_created = false
          AND attendance_basis = 'parallel';
    END IF;

    RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS qr_attendance_delete_cleanup ON curriculum.qr_attendance;
CREATE TRIGGER qr_attendance_delete_cleanup
    AFTER DELETE ON curriculum.qr_attendance
    FOR EACH ROW EXECUTE FUNCTION curriculum.qr_attendance_delete_cleanup();

-- 3. Administrator-managed Teams calendar delegation
--    (migration 0075_teams_organization_calendar_connection).
CREATE TABLE IF NOT EXISTS curriculum.teams_organization_calendar_connections (
    tenant_id text NOT NULL,
    client_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'reauth_required', 'disconnected')),
    revision text NOT NULL,
    credential_ciphertext text,
    connected_by text NOT NULL,
    updated_by text NOT NULL,
    last_error_code text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, client_id)
);

-- 4. Module hour targets and delegated access (migration 0076_module_hours_targets).
CREATE TABLE IF NOT EXISTS curriculum.module_hours_targets (
    module_id text PRIMARY KEY,
    target_minutes integer NULL CHECK (target_minutes > 0),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_by bigint NOT NULL,
    updated_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculum.module_hours_access (
    account_id bigint PRIMARY KEY,
    can_match boolean NOT NULL DEFAULT false,
    can_manage boolean NOT NULL DEFAULT false,
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_by bigint NOT NULL,
    updated_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculum.module_hours_audit (
    id bigserial PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('target', 'access')),
    entity_id text NOT NULL,
    actor_id bigint NOT NULL,
    before_value text NOT NULL,
    after_value text NOT NULL,
    created_at timestamp with time zone NOT NULL
);

-- 5. Session video import queue and change capture
--    (migrations 0077_curriculum_video_import, 0078_curriculum_video_changes).
--    Unqualified like the other Django tables (public, beside django_migrations).
CREATE TABLE IF NOT EXISTS public.curriculum_video_import (
    id uuid NOT NULL PRIMARY KEY,
    target_kind varchar(16) NOT NULL,
    target_id varchar(128) NOT NULL,
    component_id varchar(128) NOT NULL,
    fingerprint varchar(64) NOT NULL UNIQUE,
    title text NOT NULL,
    source_url text NOT NULL,
    source_at_start text NOT NULL,
    scope jsonb NOT NULL,
    library_id varchar(32) NOT NULL,
    collection_id varchar(64) NOT NULL,
    video_id varchar(64) NOT NULL,
    status varchar(24) NOT NULL,
    error text NOT NULL,
    lease_until timestamp with time zone NULL,
    requested_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS curriculum_video_import_fingerprint_3c548ff7_like
    ON public.curriculum_video_import (fingerprint varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS curriculum_video_import_status_9b6c2815
    ON public.curriculum_video_import (status);
CREATE INDEX IF NOT EXISTS curriculum_video_import_status_9b6c2815_like
    ON public.curriculum_video_import (status varchar_pattern_ops);

CREATE TABLE IF NOT EXISTS public.curriculum_video_change (
    id bigint NOT NULL PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
    target_kind varchar(16) NOT NULL,
    target_id varchar(128) NOT NULL,
    component_id varchar(128) NOT NULL,
    previous_settings jsonb NOT NULL,
    settings jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    available_at timestamp with time zone NOT NULL,
    attempts integer NOT NULL CHECK (attempts >= 0),
    error text NOT NULL
);
CREATE INDEX IF NOT EXISTS curriculum_video_change_available_at_4be3ea4e
    ON public.curriculum_video_change (available_at);

-- Same capture as 0078, adapted to the new shape: an archived component is
-- status = 'inactive' here (there is no deleted_at / is_programme_deleted).
-- week_template_components has no status, so it is never treated as archived.
CREATE OR REPLACE FUNCTION curriculum.capture_bunny_video_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $body$
DECLARE
    current_row jsonb := to_jsonb(NEW);
    previous_row jsonb := '{}'::jsonb;
    current_settings jsonb;
    previous_settings jsonb := '{}'::jsonb;
    current_source text;
    previous_source text;
    parent_id text;
BEGIN
    IF current_row->>'type' IS DISTINCT FROM 'video'
        OR coalesce(current_row->>'status', '') = 'inactive'
    THEN RETURN NEW; END IF;
    parent_id := current_row->>TG_ARGV[1];
    IF coalesce(parent_id, '') = '' THEN RETURN NEW; END IF;
    current_settings := jsonb_build_object(
        'videoUrl', current_row->'settings_json'->'videoUrl',
        'embedCode', current_row->'settings_json'->'embedCode');
    current_source := btrim(coalesce(nullif(current_settings->>'videoUrl', ''),
                                    current_settings->>'embedCode', ''));
    IF current_source = '' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
        previous_row := to_jsonb(OLD);
        IF previous_row->>'type' = 'video'
            AND previous_row->>TG_ARGV[1] = parent_id
            AND coalesce(previous_row->>'status', '') <> 'inactive'
        THEN
            previous_settings := jsonb_build_object(
                'videoUrl', previous_row->'settings_json'->'videoUrl',
                'embedCode', previous_row->'settings_json'->'embedCode');
        END IF;
        previous_source := btrim(coalesce(nullif(previous_settings->>'videoUrl', ''),
                                         previous_settings->>'embedCode', ''));
        IF current_source = previous_source THEN RETURN NEW; END IF;
    END IF;
    INSERT INTO public.curriculum_video_change
        (target_kind, target_id, component_id, previous_settings, settings,
         created_at, available_at, attempts, error)
    VALUES (TG_ARGV[0], parent_id, current_row->>'id', previous_settings, current_settings,
            clock_timestamp(), clock_timestamp(), 0, '');
    RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION curriculum.capture_bunny_video_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS bunny_video_source_changed ON curriculum.components;
CREATE TRIGGER bunny_video_source_changed
    AFTER INSERT OR UPDATE ON curriculum.components
    FOR EACH ROW EXECUTE FUNCTION curriculum.capture_bunny_video_change('module', 'module_catalogue_id');
DROP TRIGGER IF EXISTS bunny_video_source_changed ON curriculum.week_template_components;
CREATE TRIGGER bunny_video_source_changed
    AFTER INSERT OR UPDATE ON curriculum.week_template_components
    FOR EACH ROW EXECUTE FUNCTION curriculum.capture_bunny_video_change('template', 'week_template_id');

-- 6. Free Course write prerequisites (migration 0084_free_course_authoring_prerequisites;
--    the enrolment Staff_users check is left out, see above).
CREATE TABLE IF NOT EXISTS curriculum.free_course_authoring_idempotency (
    id bigint GENERATED ALWAYS AS IDENTITY,
    staff_subject_id bigint NOT NULL,
    operation varchar(64) NOT NULL,
    idempotency_key varchar(255) NOT NULL,
    request_sha256 varchar(64) NOT NULL,
    state varchar(16) NOT NULL DEFAULT 'pending',
    course_id varchar(128),
    response_status smallint,
    response_body jsonb,
    response_etag varchar(80),
    response_location text,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    completed_at timestamptz,
    expires_at timestamptz NOT NULL DEFAULT transaction_timestamp() + interval '30 days',
    CONSTRAINT free_course_authoring_idempotency_pkey PRIMARY KEY (id),
    CONSTRAINT free_course_authoring_idempotency_actor_chk CHECK (staff_subject_id > 0),
    CONSTRAINT free_course_authoring_idempotency_operation_chk CHECK (operation = 'free_course.create.v1'),
    CONSTRAINT free_course_authoring_idempotency_key_chk CHECK (
        idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,254}$'
    ),
    CONSTRAINT free_course_authoring_idempotency_hash_chk CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT free_course_authoring_idempotency_state_chk CHECK (state IN ('pending', 'completed')),
    CONSTRAINT free_course_authoring_idempotency_expiry_chk CHECK (expires_at = created_at + interval '30 days'),
    CONSTRAINT free_course_authoring_idempotency_response_shape_chk CHECK (
        (state = 'pending' AND course_id IS NULL AND response_status IS NULL
         AND response_body IS NULL AND response_etag IS NULL
         AND response_location IS NULL AND completed_at IS NULL)
        OR
        (state = 'completed' AND course_id IS NOT NULL AND btrim(course_id) <> ''
         AND response_status = 201 AND response_body IS NOT NULL
         AND jsonb_typeof(response_body) = 'object'
         AND response_etag IS NOT NULL AND btrim(response_etag) <> ''
         AND response_location IS NOT NULL AND btrim(response_location) <> ''
         AND completed_at IS NOT NULL AND completed_at >= created_at)
    ),
    CONSTRAINT free_course_authoring_idempotency_actor_operation_key_uniq
        UNIQUE (staff_subject_id, operation, idempotency_key)
);
CREATE INDEX IF NOT EXISTS free_course_authoring_idempotency_expiry_idx
    ON curriculum.free_course_authoring_idempotency (expires_at, id)
    WHERE state = 'completed';

DO $body$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'free_courses_display_order_uniq') THEN
        ALTER TABLE curriculum.free_courses
            ADD CONSTRAINT free_courses_display_order_uniq
            UNIQUE (display_order) DEFERRABLE INITIALLY DEFERRED;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'free_course_weeks_course_display_order_uniq') THEN
        ALTER TABLE curriculum.free_course_weeks
            ADD CONSTRAINT free_course_weeks_course_display_order_uniq
            UNIQUE (course_id, display_order) DEFERRABLE INITIALLY DEFERRED;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'free_components_week_display_order_uniq') THEN
        ALTER TABLE curriculum.free_programme_components
            ADD CONSTRAINT free_components_week_display_order_uniq
            UNIQUE (free_module_id, display_order) DEFERRABLE INITIALLY DEFERRED;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_links_free_course_fk') THEN
        ALTER TABLE curriculum.quiz_course_links ADD CONSTRAINT quiz_links_free_course_fk
            FOREIGN KEY (free_course_id) REFERENCES curriculum.free_courses(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
        ALTER TABLE curriculum.quiz_course_links VALIDATE CONSTRAINT quiz_links_free_course_fk;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_links_free_week_fk') THEN
        ALTER TABLE curriculum.quiz_course_links ADD CONSTRAINT quiz_links_free_week_fk
            FOREIGN KEY (free_course_week_id) REFERENCES curriculum.free_course_weeks(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
        ALTER TABLE curriculum.quiz_course_links VALIDATE CONSTRAINT quiz_links_free_week_fk;
    END IF;
END
$body$;

CREATE UNIQUE INDEX IF NOT EXISTS quiz_course_links_canonical_quiz_uniq
    ON curriculum.quiz_course_links (quiz_id)
    WHERE free_course_id IS NOT NULL OR free_course_week_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quizzes_free_course_week_idx
    ON curriculum.quizzes (free_course_week_id, id)
    WHERE free_course_week_id IS NOT NULL;

COMMIT;

-- Check afterwards (read-only): every row should say true.
-- SELECT 'parallel columns', count(*) = 5 FROM information_schema.columns
--   WHERE table_schema = 'curriculum' AND table_name = 'live_session_learner_attendance'
--     AND column_name LIKE 'parallel_%'
-- UNION ALL SELECT 'qr cleanup trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'qr_attendance_delete_cleanup')
-- UNION ALL SELECT 'teams org calendar', to_regclass('curriculum.teams_organization_calendar_connections') IS NOT NULL
-- UNION ALL SELECT 'module hours', to_regclass('curriculum.module_hours_targets') IS NOT NULL
-- UNION ALL SELECT 'video import', to_regclass('public.curriculum_video_import') IS NOT NULL
-- UNION ALL SELECT 'video change', to_regclass('public.curriculum_video_change') IS NOT NULL
-- UNION ALL SELECT 'free course idempotency', to_regclass('curriculum.free_course_authoring_idempotency') IS NOT NULL;
