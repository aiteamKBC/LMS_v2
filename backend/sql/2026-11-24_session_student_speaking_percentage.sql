-- Apply ONCE after 2026-11-24_session_student_speaking.sql.
-- Verify endpoint/branch and set lms.speaking_expected_database first.
-- Adds each learner's percentage of ATTRIBUTED STUDENT speaking seconds in the
-- same occurrence AND module. Tutors and unresolved voices are not denominators.
-- Backfills saved results without recalculating speech or changing old fields.
-- Future save calls compute the same percentage. No automatic jobs are added.
-- Rounded to two decimal places; group totals can differ slightly from 100.
-- Keep a private pre-change schema backup for restoring the previous function.
-- Rollback (separate reviewed operation): restore the previous save function and
-- remove only speaking_percentage; source durations and run records are retained.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
    previous_body text;
BEGIN
    IF current_setting('lms.speaking_expected_database', true) IS DISTINCT FROM current_database() THEN
        RAISE EXCEPTION 'Verify the server/branch and set lms.speaking_expected_database before installation';
    END IF;
    SELECT prosrc INTO previous_body FROM pg_proc
        WHERE oid = 'curriculum.save_session_student_speaking(text)'::regprocedure;
    IF md5(previous_body) IS DISTINCT FROM '2a58b3aa20245982d460afdf18eb51df' THEN
        RAISE EXCEPTION 'Existing save function differs from the reviewed baseline; preserve and review it';
    END IF;
END
$guard$;

ALTER TABLE curriculum.live_session_student_speaking
    ADD COLUMN speaking_percentage numeric(5,2);

WITH percentages AS (
    SELECT occurrence_id, module_catalogue_id, learner_profile_id,
        round(100 * speaking_seconds / sum(speaking_seconds) OVER (
            PARTITION BY occurrence_id, module_catalogue_id), 2) AS percentage
    FROM curriculum.live_session_student_speaking
)
UPDATE curriculum.live_session_student_speaking target
SET speaking_percentage = p.percentage
FROM percentages p
WHERE target.occurrence_id = p.occurrence_id
  AND target.module_catalogue_id = p.module_catalogue_id
  AND target.learner_profile_id = p.learner_profile_id;

ALTER TABLE curriculum.live_session_student_speaking
    ALTER COLUMN speaking_percentage SET NOT NULL,
    ADD CONSTRAINT live_session_student_speaking_percentage_range
        CHECK (speaking_percentage >= 0 AND speaking_percentage <= 100);

COMMENT ON COLUMN curriculum.live_session_student_speaking.speaking_percentage IS
    'Percent of attributed student speaking seconds within this occurrence and module; excludes tutors and unresolved voices; rounded to 2 decimal places.';

CREATE OR REPLACE FUNCTION curriculum.save_session_student_speaking(p_occurrence_id text DEFAULT NULL)
RETURNS TABLE (saved_occurrence_id text, outcome text, learner_rows integer)
LANGUAGE plpgsql SET search_path = pg_catalog, curriculum
AS $save$
DECLARE
    session_row record;
    preview jsonb;
    artifacts jsonb;
    fingerprint text;
    calculated timestamptz;
    row_count integer;
BEGIN
    IF current_setting('lms.speaking_expected_database', true) IS DISTINCT FROM current_database() THEN
        RAISE EXCEPTION 'Verify the server/branch and set lms.speaking_expected_database before saving';
    END IF;
    -- Stable source snapshot, without locking or updating original LMS tables.
    IF current_setting('transaction_isolation') NOT IN ('repeatable read', 'serializable') THEN
        RAISE EXCEPTION 'Run saving in a REPEATABLE READ transaction';
    END IF;
    FOR session_row IN
        SELECT DISTINCT a.occurrence_id::text AS id, o.live_session_id::text AS series
        FROM curriculum.live_session_artifacts a
        JOIN curriculum.live_session_occurrences o ON o.id = a.occurrence_id
        WHERE a.artifact_type = 'transcript'
            AND (p_occurrence_id IS NULL OR a.occurrence_id = p_occurrence_id)
        ORDER BY a.occurrence_id::text
    LOOP
        -- Serialise this feature only. Unique keys are the final race guard.
        PERFORM pg_advisory_xact_lock(hashtextextended('student-speaking:' || session_row.id, 0));
        saved_occurrence_id := session_row.id;
        learner_rows := 0;
        IF EXISTS (SELECT 1 FROM curriculum.live_session_speaking_runs r WHERE r.occurrence_id = session_row.id) THEN
            outcome := 'already_saved'; RETURN NEXT; CONTINUE;
        END IF;
        SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO preview
        FROM curriculum.preview_session_student_speaking(session_row.id) p;
        IF preview = '[]'::jsonb OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(preview) p WHERE p->>'match_status' = 'blocked'
        ) THEN
            outcome := 'blocked_invalid_source'; RETURN NEXT; CONTINUE;
        END IF;
        SELECT jsonb_agg(jsonb_build_object('artifact_id', a.id, 'created_datetime', a.created_datetime,
            'cue_count', jsonb_array_length(a.metadata::jsonb#>'{lmsTranscriptTimeline,cues}'),
            'timeline_md5', md5((a.metadata::jsonb->'lmsTranscriptTimeline')::text)) ORDER BY a.id),
            md5(string_agg(a.id || ':' || extract(epoch FROM a.created_datetime)::text || ':' ||
                (a.metadata::jsonb->'lmsTranscriptTimeline')::text, '|' ORDER BY a.id))
        INTO artifacts, fingerprint
        FROM curriculum.live_session_artifacts a
        WHERE a.occurrence_id = session_row.id AND a.artifact_type = 'transcript';
        calculated := clock_timestamp();
        SELECT count(*)::integer INTO row_count FROM jsonb_array_elements(preview) p
            WHERE p->>'match_status' IN ('unique_name', 'reviewed_attendance');
        INSERT INTO curriculum.live_session_speaking_runs
            (occurrence_id, live_session_id, calculated_at, source_artifacts, source_fingerprint,
             learner_result_count, unresolved_speakers, excluded_speakers)
        VALUES (session_row.id, session_row.series, calculated, artifacts, fingerprint, row_count,
            (SELECT coalesce(jsonb_agg(p), '[]'::jsonb) FROM jsonb_array_elements(preview) p WHERE p->>'match_status' = 'unresolved'),
            (SELECT coalesce(jsonb_agg(p), '[]'::jsonb) FROM jsonb_array_elements(preview) p WHERE p->>'match_status' = 'excluded_tutor'))
        ON CONFLICT (occurrence_id) DO NOTHING;
        IF NOT FOUND THEN
            outcome := 'already_saved'; RETURN NEXT; CONTINUE;
        END IF;
        INSERT INTO curriculum.live_session_student_speaking
            (occurrence_id, live_session_id, module_catalogue_id, learner_profile_id, learner_name,
             speaking_seconds, cue_count, speaker_names, match_status, calculated_at, speaking_percentage)
        SELECT p.occurrence_id, p.live_session_id, p.module_catalogue_id, p.learner_profile_id,
            p.learner_name, p.speaking_seconds, p.cue_count, p.speaker_names, p.match_status, calculated,
            round(100 * p.speaking_seconds / sum(p.speaking_seconds) OVER (
                PARTITION BY p.occurrence_id, p.module_catalogue_id), 2)
        FROM jsonb_to_recordset(preview) p(occurrence_id text, live_session_id text,
            module_catalogue_id text, learner_profile_id bigint, learner_name text,
            speaking_seconds numeric, cue_count integer, speaker_names jsonb, match_status text)
        WHERE p.match_status IN ('unique_name', 'reviewed_attendance');
        learner_rows := row_count;
        outcome := 'saved'; RETURN NEXT;
    END LOOP;
END
$save$;

-- CREATE OR REPLACE preserves the existing function's owner/ACL. No grants added.
COMMIT;

-- Read-only verification (do not require an exact 100 after individual rounding):
-- SELECT occurrence_id, module_catalogue_id, sum(speaking_percentage)
-- FROM curriculum.live_session_student_speaking GROUP BY occurrence_id,module_catalogue_id;
