-- Curriculum Review foreign-key hardening.
--
-- The orphan audit was clean before this migration was applied to Neon.
-- The constraints intentionally use the default NO ACTION delete behaviour:
-- Review instances, answers, signatures, and lifecycle audit rows are
-- historical records and must not disappear through cascading deletes.
--
-- NOT VALID keeps the initial constraint install short; each constraint is
-- validated in the same transaction after it is created. The guards make the
-- script safe to re-run against an installation where the constraints already
-- exist.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'review_sections_review_fk'
          AND n.nspname = 'curriculum'
    ) THEN
        ALTER TABLE curriculum.review_sections
            ADD CONSTRAINT review_sections_review_fk
            FOREIGN KEY (review_id)
            REFERENCES curriculum.review_templates(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'review_fields_review_fk'
          AND n.nspname = 'curriculum'
    ) THEN
        ALTER TABLE curriculum.review_fields
            ADD CONSTRAINT review_fields_review_fk
            FOREIGN KEY (review_id)
            REFERENCES curriculum.review_templates(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'review_fields_section_fk'
          AND n.nspname = 'curriculum'
    ) THEN
        ALTER TABLE curriculum.review_fields
            ADD CONSTRAINT review_fields_section_fk
            FOREIGN KEY (section_id)
            REFERENCES curriculum.review_sections(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'review_occurrence_overrides_review_fk'
          AND n.nspname = 'curriculum'
    ) THEN
        ALTER TABLE curriculum.review_occurrence_overrides
            ADD CONSTRAINT review_occurrence_overrides_review_fk
            FOREIGN KEY (review_id)
            REFERENCES curriculum.review_templates(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'review_instances_template_fk'
          AND n.nspname = 'curriculum'
    ) THEN
        ALTER TABLE curriculum.review_instances
            ADD CONSTRAINT review_instances_template_fk
            FOREIGN KEY (review_template_id)
            REFERENCES curriculum.review_templates(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'review_instance_answers_instance_fk'
          AND n.nspname = 'curriculum'
    ) THEN
        ALTER TABLE curriculum.review_instance_answers
            ADD CONSTRAINT review_instance_answers_instance_fk
            FOREIGN KEY (review_instance_id)
            REFERENCES curriculum.review_instances(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'review_instance_signatures_instance_fk'
          AND n.nspname = 'curriculum'
    ) THEN
        ALTER TABLE curriculum.review_instance_signatures
            ADD CONSTRAINT review_instance_signatures_instance_fk
            FOREIGN KEY (review_instance_id)
            REFERENCES curriculum.review_instances(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'review_instance_manual_overrides_instance_fk'
          AND n.nspname = 'curriculum'
    ) THEN
        ALTER TABLE curriculum.review_instance_manual_overrides
            ADD CONSTRAINT review_instance_manual_overrides_instance_fk
            FOREIGN KEY (review_instance_id)
            REFERENCES curriculum.review_instances(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'review_instance_reopens_instance_fk'
          AND n.nspname = 'curriculum'
    ) THEN
        ALTER TABLE curriculum.review_instance_reopens
            ADD CONSTRAINT review_instance_reopens_instance_fk
            FOREIGN KEY (review_instance_id)
            REFERENCES curriculum.review_instances(id)
            NOT VALID;
    END IF;

    IF to_regclass('curriculum.learner_review_additions') IS NOT NULL
       AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'learner_review_additions_template_fk'
          AND n.nspname = 'curriculum'
    ) THEN
        ALTER TABLE curriculum.learner_review_additions
            ADD CONSTRAINT learner_review_additions_template_fk
            FOREIGN KEY (review_template_id)
            REFERENCES curriculum.review_templates(id)
            NOT VALID;
    END IF;

END $$;

ALTER TABLE curriculum.review_sections
    VALIDATE CONSTRAINT review_sections_review_fk;

ALTER TABLE curriculum.review_fields
    VALIDATE CONSTRAINT review_fields_review_fk;

ALTER TABLE curriculum.review_fields
    VALIDATE CONSTRAINT review_fields_section_fk;

ALTER TABLE curriculum.review_occurrence_overrides
    VALIDATE CONSTRAINT review_occurrence_overrides_review_fk;

ALTER TABLE curriculum.review_instances
    VALIDATE CONSTRAINT review_instances_template_fk;

ALTER TABLE curriculum.review_instance_answers
    VALIDATE CONSTRAINT review_instance_answers_instance_fk;

ALTER TABLE curriculum.review_instance_signatures
    VALIDATE CONSTRAINT review_instance_signatures_instance_fk;

ALTER TABLE curriculum.review_instance_manual_overrides
    VALIDATE CONSTRAINT review_instance_manual_overrides_instance_fk;

ALTER TABLE curriculum.review_instance_reopens
    VALIDATE CONSTRAINT review_instance_reopens_instance_fk;

DO $$
BEGIN
    IF to_regclass('curriculum.learner_review_additions') IS NOT NULL THEN
        ALTER TABLE curriculum.learner_review_additions
            VALIDATE CONSTRAINT learner_review_additions_template_fk;
    END IF;
END $$;

COMMIT;
