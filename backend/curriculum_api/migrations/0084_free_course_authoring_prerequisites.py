"""Concurrency and permission prerequisites for canonical Free Course writes."""
from django.db import migrations


FORWARD = r'''
ALTER TABLE enrolment."Staff_users"
    DROP CONSTRAINT staff_users_access_extra_check;
ALTER TABLE enrolment."Staff_users"
    ADD CONSTRAINT staff_users_access_extra_check CHECK (
        "Access_extra" IS NULL OR btrim("Access_extra") = '' OR
        string_to_array(replace(lower(btrim("Access_extra")), ' ', ''), ',')
        <@ ARRAY['support','enrolment','curriculum','coach','tutor',
                 'record-monitor','advanced-admin','super-admin',
                 'free-course-authoring']::text[]
    ) NOT VALID;
ALTER TABLE enrolment."Staff_users"
    VALIDATE CONSTRAINT staff_users_access_extra_check;

CREATE TABLE curriculum.free_course_authoring_idempotency (
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
CREATE INDEX free_course_authoring_idempotency_expiry_idx
    ON curriculum.free_course_authoring_idempotency (expires_at, id)
    WHERE state = 'completed';

ALTER TABLE curriculum.free_courses
    ADD CONSTRAINT free_courses_display_order_uniq
    UNIQUE (display_order) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE curriculum.free_course_weeks
    ADD CONSTRAINT free_course_weeks_course_display_order_uniq
    UNIQUE (course_id, display_order) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE curriculum.free_programme_components
    ADD CONSTRAINT free_components_week_display_order_uniq
    UNIQUE (free_module_id, display_order) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE curriculum.quizzes
    ADD COLUMN IF NOT EXISTS free_course_week_id varchar(128);
ALTER TABLE curriculum.quiz_course_links
    ADD COLUMN IF NOT EXISTS free_course_id varchar(128),
    ADD COLUMN IF NOT EXISTS free_course_week_id varchar(128);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quizzes_free_course_week_fk') THEN
        ALTER TABLE curriculum.quizzes ADD CONSTRAINT quizzes_free_course_week_fk
            FOREIGN KEY (free_course_week_id) REFERENCES curriculum.free_course_weeks(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quiz_links_free_course_fk') THEN
        ALTER TABLE curriculum.quiz_course_links ADD CONSTRAINT quiz_links_free_course_fk
            FOREIGN KEY (free_course_id) REFERENCES curriculum.free_courses(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quiz_links_free_week_fk') THEN
        ALTER TABLE curriculum.quiz_course_links ADD CONSTRAINT quiz_links_free_week_fk
            FOREIGN KEY (free_course_week_id) REFERENCES curriculum.free_course_weeks(id)
            ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
ALTER TABLE curriculum.quizzes VALIDATE CONSTRAINT quizzes_free_course_week_fk;
ALTER TABLE curriculum.quiz_course_links VALIDATE CONSTRAINT quiz_links_free_course_fk;
ALTER TABLE curriculum.quiz_course_links VALIDATE CONSTRAINT quiz_links_free_week_fk;
CREATE UNIQUE INDEX quiz_course_links_canonical_quiz_uniq
    ON curriculum.quiz_course_links (quiz_id)
    WHERE free_course_id IS NOT NULL OR free_course_week_id IS NOT NULL;
CREATE INDEX quizzes_free_course_week_idx
    ON curriculum.quizzes (free_course_week_id, id)
    WHERE free_course_week_id IS NOT NULL;
'''


REVERSE = r'''
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM curriculum.free_course_authoring_idempotency) THEN
        RAISE EXCEPTION 'Rollback refused: Free Course idempotency records exist';
    END IF;
    IF EXISTS (
        SELECT 1 FROM enrolment."Staff_users"
        WHERE "Access_extra" IS NOT NULL AND btrim("Access_extra") <> ''
          AND NOT (string_to_array(replace(lower(btrim("Access_extra")), ' ', ''), ',')
                   <@ ARRAY['enrolment','curriculum','coach','tutor','record-monitor',
                            'super-admin','advanced-admin']::text[])
    ) THEN
        RAISE EXCEPTION 'Rollback refused: unsupported Access_extra grants exist';
    END IF;
END $$;
ALTER TABLE curriculum.free_programme_components
    DROP CONSTRAINT free_components_week_display_order_uniq;
DROP INDEX curriculum.quizzes_free_course_week_idx;
DROP INDEX curriculum.quiz_course_links_canonical_quiz_uniq;
ALTER TABLE curriculum.quiz_course_links DROP CONSTRAINT quiz_links_free_week_fk;
ALTER TABLE curriculum.quiz_course_links DROP CONSTRAINT quiz_links_free_course_fk;
ALTER TABLE curriculum.quizzes DROP CONSTRAINT quizzes_free_course_week_fk;
ALTER TABLE curriculum.free_course_weeks
    DROP CONSTRAINT free_course_weeks_course_display_order_uniq;
ALTER TABLE curriculum.free_courses
    DROP CONSTRAINT free_courses_display_order_uniq;
DROP TABLE curriculum.free_course_authoring_idempotency;
ALTER TABLE enrolment."Staff_users"
    DROP CONSTRAINT staff_users_access_extra_check;
ALTER TABLE enrolment."Staff_users"
    ADD CONSTRAINT staff_users_access_extra_check CHECK (
        "Access_extra" IS NULL OR btrim("Access_extra") = '' OR
        string_to_array(replace(lower(btrim("Access_extra")), ' ', ''), ',')
        <@ ARRAY['enrolment','curriculum','coach','tutor','record-monitor',
                 'super-admin','advanced-admin']::text[]
    ) NOT VALID;
ALTER TABLE enrolment."Staff_users"
    VALIDATE CONSTRAINT staff_users_access_extra_check;
'''


class Migration(migrations.Migration):
    atomic = True
    dependencies = [
        ('curriculum_api', '0083_merge_web_points_qr_attendance'),
        ('learner_api', '0025_legacy_quiz_retake_grants'),
    ]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
