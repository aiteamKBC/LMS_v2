-- MANUAL, ONE-OFF CLEANUP. This is not a migration and is never run automatically.
-- Target: ID 53, exact title 'End-of-Module Learner (T)', this version only.
-- 1. Select the intended database/branch and take a restorable backup first.
-- 2. Run this WHOLE file unchanged: preview only, no DELETE statements execute.
-- 3. Review the result and notices. To delete, set apply_delete to true below
--    and set expected_response_count to the preview's response_count. Rerun all.
-- Existing responses and answers are permanently removed in delete mode.
-- Any exception aborts the entire transaction. Never bypass a failed guard.
-- The Feedback and Learner.support_tickets tables must be in this same database.
-- Files, correspondence, Quality tickets, other versions and shared dependencies
-- require a separate review; this script stops if it finds them.
-- No learner, enrolment, module, attendance or source review records are deleted.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- The preview is deliberately aggregate-only: no learner identities or answers.
SELECT current_database() AS database_name, f.id, f.title, f.form_type,
       f.status, f.version, f.is_current,
       (SELECT count(*) FROM "Feedback".feedback_responses r WHERE r.form_id = f.id) AS response_count,
       (SELECT count(*) FROM "Feedback".feedback_responses r WHERE r.form_id = f.id AND r.status = 'completed') AS completed_responses,
       (SELECT count(*) FROM "Feedback".feedback_answers a JOIN "Feedback".feedback_responses r ON r.id = a.response_id WHERE r.form_id = f.id) AS answer_count,
       (SELECT count(*) FROM "Feedback".feedback_assignments a WHERE a.form_id = f.id) AS manual_assignments,
       (SELECT count(*) FROM "Feedback".feedback_deliveries d WHERE d.form_id = f.id) AS deliveries,
       (SELECT count(*) FROM "Feedback".feedback_delivery_recipients r JOIN "Feedback".feedback_deliveries d ON d.id = r.delivery_id WHERE d.form_id = f.id) AS delivery_recipients
FROM "Feedback".feedback_forms f
WHERE f.id = 53;

DO $cleanup$
DECLARE
    apply_delete boolean := false;         -- Change to true ONLY for deletion.
    expected_response_count bigint := NULL; -- Copy response_count from preview.
    target_id constant bigint := 53;
    target_title constant text := 'End-of-Module Learner (T)';
    target_form record;
    dependency record;
    dependency_count bigint;
    response_count bigint;
    deleted_count bigint;
BEGIN
    IF apply_delete THEN
        -- Freeze the form and its existing children while rechecking the scope.
        -- Foreign-key inserts referencing these rows wait until this completes.
        PERFORM 1 FROM "Feedback".feedback_forms WHERE id = target_id FOR UPDATE;
        PERFORM 1 FROM "Feedback".feedback_form_sections WHERE form_id = target_id FOR UPDATE;
        PERFORM q.id FROM "Feedback".feedback_questions q
          JOIN "Feedback".feedback_form_sections s ON s.id = q.section_id
          WHERE s.form_id = target_id FOR UPDATE OF q;
        PERFORM 1 FROM "Feedback".feedback_responses WHERE form_id = target_id FOR UPDATE;
        PERFORM 1 FROM "Feedback".feedback_deliveries WHERE form_id = target_id FOR UPDATE;
        PERFORM r.id FROM "Feedback".feedback_delivery_recipients r
          JOIN "Feedback".feedback_deliveries d ON d.id = r.delivery_id
          WHERE d.form_id = target_id FOR UPDATE OF r;
    END IF;

    SELECT * INTO target_form FROM "Feedback".feedback_forms WHERE id = target_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Form 53 does not exist in this database. Nothing deleted.';
    END IF;
    IF target_form.title IS DISTINCT FROM target_title THEN
        RAISE EXCEPTION 'ID 53 has a different title. Nothing deleted.';
    END IF;
    IF target_form.form_type NOT IN ('general', 'end_module') THEN
        RAISE EXCEPTION 'Unexpected form type %. Review its workflow before deleting.', target_form.form_type;
    END IF;
    IF EXISTS (SELECT 1 FROM "Feedback".feedback_forms
               WHERE id <> target_id AND (template_key = target_form.template_key
                                          OR previous_version_id = target_id))
       OR target_form.previous_version_id IS NOT NULL THEN
        RAISE EXCEPTION 'Other form versions are linked. This script deletes only ID 53; review the version family first.';
    END IF;

    -- Do not remove correspondence, blob metadata or other workflows as a cascade.
    FOR dependency IN SELECT * FROM (VALUES
        ('feedback_response_emails'),
        ('feedback_uploads'),
        ('feedback_review_deliveries'),
        ('feedback_employer_review_deliveries'),
        ('feedback_event_campaigns'),
        ('event_rsvp_campaigns'),
        ('feedback_delivery_question_overrides')
    ) AS dependencies(table_name)
    LOOP
        IF to_regclass(format('"Feedback".%I', dependency.table_name)) IS NULL THEN
            CONTINUE;
        END IF;
        IF dependency.table_name IN ('feedback_response_emails', 'feedback_uploads') THEN
            EXECUTE format('SELECT count(*) FROM "Feedback".%I WHERE response_id IN
                (SELECT id FROM "Feedback".feedback_responses WHERE form_id = $1)', dependency.table_name)
                INTO dependency_count USING target_id;
        ELSIF dependency.table_name = 'feedback_delivery_question_overrides' THEN
            EXECUTE 'SELECT count(*) FROM "Feedback".feedback_delivery_question_overrides o
                WHERE recipient_id IN (SELECT r.id FROM "Feedback".feedback_delivery_recipients r
                    JOIN "Feedback".feedback_deliveries d ON d.id = r.delivery_id WHERE d.form_id = $1)
                OR original_question_id IN (SELECT q.id FROM "Feedback".feedback_questions q
                    JOIN "Feedback".feedback_form_sections s ON s.id = q.section_id WHERE s.form_id = $1)
                OR replacement_question_id IN (SELECT q.id FROM "Feedback".feedback_questions q
                    JOIN "Feedback".feedback_form_sections s ON s.id = q.section_id WHERE s.form_id = $1)'
                INTO dependency_count USING target_id;
        ELSE
            EXECUTE format('SELECT count(*) FROM "Feedback".%I WHERE form_id = $1', dependency.table_name)
                INTO dependency_count USING target_id;
        END IF;
        IF dependency_count > 0 THEN
            RAISE EXCEPTION 'Found % linked rows in %. Review these records separately; nothing deleted.', dependency_count, dependency.table_name;
        END IF;
    END LOOP;

    -- Quality tickets use a deterministic response UUID and descriptive text,
    -- rather than a database FK. Check their local source before deleting responses.
    IF to_regclass('"Learner".support_tickets') IS NULL THEN
        RAISE EXCEPTION 'Cannot check linked Quality tickets in this database. Nothing deleted.';
    END IF;
    EXECUTE 'SELECT count(*) FROM "Learner".support_tickets t
        JOIN "Feedback".feedback_responses r ON
          starts_with(coalesce(t.data->>''description'', ''''),
                      ''Negative feedback response #'' || r.id::text || '' requires Quality Team review.'')
        WHERE r.form_id = $1' INTO dependency_count USING target_id;
    IF dependency_count > 0 THEN
        RAISE EXCEPTION 'Found % linked Quality tickets. Review local and technicalsupport copies first; nothing deleted.', dependency_count;
    END IF;

    IF EXISTS (
        SELECT 1 FROM "Feedback".feedback_answers a
        JOIN "Feedback".feedback_questions q ON q.id = a.question_id
        JOIN "Feedback".feedback_form_sections s ON s.id = q.section_id
        JOIN "Feedback".feedback_responses r ON r.id = a.response_id
        WHERE s.form_id = target_id AND r.form_id <> target_id
    ) THEN
        RAISE EXCEPTION 'Other forms have answers referencing these questions. Nothing deleted.';
    END IF;

    SELECT count(*) INTO response_count FROM "Feedback".feedback_responses WHERE form_id = target_id;
    IF NOT apply_delete THEN
        RAISE NOTICE 'PREVIEW ONLY: form 53 has % responses. No data changed. Review the preview and backup before enabling deletion.', response_count;
        RETURN;
    END IF;
    IF expected_response_count IS NULL OR expected_response_count <> response_count THEN
        RAISE EXCEPTION 'Expected response count does not match current count (%). Run preview again; nothing deleted.', response_count;
    END IF;

    -- Reject new cascade/SET NULL/SET DEFAULT paths outside this scoped cleanup.
    IF EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class parent ON parent.oid = c.confrelid
        JOIN pg_namespace pn ON pn.oid = parent.relnamespace
        JOIN pg_class child ON child.oid = c.conrelid
        JOIN pg_namespace cn ON cn.oid = child.relnamespace
        WHERE c.contype = 'f' AND c.confdeltype IN ('c', 'n', 'd')
          AND pn.nspname = 'Feedback'
          AND parent.relname IN ('feedback_forms', 'feedback_form_sections', 'feedback_questions',
              'feedback_responses', 'feedback_answers', 'feedback_assignments', 'feedback_deliveries',
              'feedback_delivery_recipients', 'feedback_delivery_questions')
          AND NOT (c.confdeltype = 'c' AND cn.nspname = 'Feedback' AND (parent.relname, child.relname) IN (
              ('feedback_forms', 'feedback_form_sections'), ('feedback_forms', 'feedback_assignments'),
              ('feedback_form_sections', 'feedback_questions'), ('feedback_responses', 'feedback_answers'),
              ('feedback_responses', 'feedback_uploads'), ('feedback_deliveries', 'feedback_delivery_recipients'),
              ('feedback_deliveries', 'feedback_delivery_questions')))
    ) THEN
        RAISE EXCEPTION 'An unreviewed cascading relationship exists. Nothing deleted.';
    END IF;

    DELETE FROM "Feedback".feedback_answers
      WHERE response_id IN (SELECT id FROM "Feedback".feedback_responses WHERE form_id = target_id);
    DELETE FROM "Feedback".feedback_responses WHERE form_id = target_id;
    IF to_regclass('"Feedback".feedback_delivery_questions') IS NOT NULL THEN
        EXECUTE 'DELETE FROM "Feedback".feedback_delivery_questions WHERE delivery_id IN
            (SELECT id FROM "Feedback".feedback_deliveries WHERE form_id = $1)' USING target_id;
    END IF;
    DELETE FROM "Feedback".feedback_delivery_recipients
      WHERE delivery_id IN (SELECT id FROM "Feedback".feedback_deliveries WHERE form_id = target_id);
    DELETE FROM "Feedback".feedback_deliveries WHERE form_id = target_id;
    DELETE FROM "Feedback".feedback_assignments WHERE form_id = target_id;
    DELETE FROM "Feedback".feedback_questions
      WHERE section_id IN (SELECT id FROM "Feedback".feedback_form_sections WHERE form_id = target_id);
    DELETE FROM "Feedback".feedback_form_sections WHERE form_id = target_id;
    DELETE FROM "Feedback".feedback_forms WHERE id = target_id AND title = target_title;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    IF deleted_count <> 1 THEN
        RAISE EXCEPTION 'Expected to delete exactly one form; transaction cancelled.';
    END IF;
    RAISE NOTICE 'Deleted only form 53 and its scoped feedback records, including % responses.', response_count;
END;
$cleanup$;

COMMIT;

-- Preview mode: 1 / original count. Successful delete mode: 0 / 0.
SELECT (SELECT count(*) FROM "Feedback".feedback_forms WHERE id = 53) AS remaining_forms,
       (SELECT count(*) FROM "Feedback".feedback_responses WHERE form_id = 53) AS remaining_responses;
