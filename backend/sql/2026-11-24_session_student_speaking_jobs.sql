-- Apply after the speaking snapshot and percentage SQL files. Operator-only.
-- Pin the actual endpoint/branch and set lms.speaking_expected_database first.
-- Independent durable receipts/retries; never modifies Teams/session jobs,
-- attendance, transcript metadata, archived files or existing speaking snapshots.
-- Called by the EXISTING session worker, not a trigger or a new timer.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
    IF current_setting('lms.speaking_expected_database', true) IS DISTINCT FROM current_database() THEN
        RAISE EXCEPTION 'Verify the server/branch and set lms.speaking_expected_database before installation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='curriculum' AND table_name='live_session_student_speaking'
          AND column_name='speaking_percentage' AND is_nullable='NO') THEN
        RAISE EXCEPTION 'Install speaking snapshots and percentages first';
    END IF;
END
$guard$;

CREATE TABLE curriculum.live_session_speaking_jobs (
    occurrence_id text PRIMARY KEY,
    live_session_id text NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','retry','complete')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    requested_at timestamptz NOT NULL DEFAULT now(),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    last_error text NOT NULL DEFAULT ''
);
CREATE INDEX live_session_speaking_jobs_due_idx
    ON curriculum.live_session_speaking_jobs(next_attempt_at, occurrence_id)
    WHERE state IN ('pending','retry');

CREATE FUNCTION curriculum.process_new_session_student_speaking(
    p_series_ids text[] DEFAULT NULL, p_limit integer DEFAULT 10
)
RETURNS TABLE (processed integer, completed integer, retrying integer)
LANGUAGE plpgsql SET search_path = pg_catalog, curriculum
AS $jobs$
DECLARE
    job record;
    verdict text;
    failure_code text;
    batch_limit integer := greatest(1, least(coalesce(p_limit,10),100));
BEGIN
    IF current_setting('lms.speaking_expected_database',true) IS DISTINCT FROM current_database() THEN
        RAISE EXCEPTION 'Verify database before processing speaking jobs';
    END IF;
    IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN
        RAISE EXCEPTION 'Run speaking jobs in a REPEATABLE READ transaction';
    END IF;
    -- Discovery is bounded and excludes snapshots BEFORE any cue parsing. No
    -- global save() call: each actual calculation receives ONE occurrence ID.
    INSERT INTO curriculum.live_session_speaking_jobs(occurrence_id,live_session_id)
    SELECT o.id,o.live_session_id FROM curriculum.live_session_occurrences o
    WHERE (p_series_ids IS NULL OR o.live_session_id=ANY(p_series_ids))
      AND EXISTS (SELECT 1 FROM curriculum.live_session_artifacts a
                  WHERE a.occurrence_id=o.id AND a.artifact_type='transcript')
      AND NOT EXISTS (SELECT 1 FROM curriculum.live_session_speaking_runs r WHERE r.occurrence_id=o.id)
      AND NOT EXISTS (SELECT 1 FROM curriculum.live_session_speaking_jobs j WHERE j.occurrence_id=o.id)
    ORDER BY o.id LIMIT batch_limit
    ON CONFLICT(occurrence_id) DO NOTHING;

    processed := 0; completed := 0; retrying := 0;
    FOR job IN
        SELECT j.* FROM curriculum.live_session_speaking_jobs j
        WHERE j.state IN ('pending','retry') AND j.next_attempt_at<=now()
          AND (p_series_ids IS NULL OR j.live_session_id=ANY(p_series_ids))
        ORDER BY j.next_attempt_at,j.occurrence_id
        LIMIT batch_limit FOR UPDATE OF j SKIP LOCKED
    LOOP
        processed := processed+1;
        verdict := NULL;
        failure_code := '';
        IF EXISTS (SELECT 1 FROM curriculum.live_session_speaking_runs r WHERE r.occurrence_id=job.occurrence_id) THEN
            verdict := 'already_saved';
        -- Recheck on every attempt: a partially saved transcript/report must
        -- never become an immutable, incomplete student snapshot.
        ELSIF NOT EXISTS (
            SELECT 1 FROM curriculum.live_session_occurrences o
            JOIN curriculum.live_sessions s ON s.id=o.live_session_id
            WHERE o.id=job.occurrence_id AND o.live_session_id=job.live_session_id
              AND coalesce(o.attendance_report_id,'')<>''
              AND EXISTS (SELECT 1 FROM curriculum.live_session_learner_attendance r
                JOIN curriculum.modules m ON m.module_catalogue_id=r.module_catalogue_id
                WHERE (r.occurrence_id=o.id OR r.attendance_source_occurrence_id=o.id)
                  AND (r.module_catalogue_id=s.module_catalogue_id
                       OR m.teams_shared_source_module_id=s.module_catalogue_id))
              AND EXISTS (SELECT 1 FROM curriculum.live_session_artifacts a
                          WHERE a.occurrence_id=o.id AND a.artifact_type='transcript')
              AND NOT EXISTS (
                SELECT 1 FROM curriculum.live_session_artifacts a
                LEFT JOIN curriculum.session_result_archive ar
                  ON ar.artifact_id=a.id AND ar.occurrence_id=a.occurrence_id
                WHERE a.occurrence_id=o.id AND a.artifact_type='transcript'
                  AND (ar.status IS DISTINCT FROM 'ready'
                       OR coalesce(btrim(ar.transcript_text),'')=''))
        ) THEN
            failure_code := 'saved_transcript_or_attendance_not_ready';
        ELSE
            BEGIN
                SELECT saved.outcome INTO verdict
                FROM curriculum.save_session_student_speaking(job.occurrence_id) saved;
                IF verdict IS NULL OR verdict NOT IN ('saved','already_saved') THEN
                    failure_code := 'saved_transcript_timing_not_ready';
                END IF;
            EXCEPTION WHEN OTHERS THEN
                -- The inner savepoint rolls back incomplete snapshots. Only an
                -- SQLSTATE is persisted: never names, SQL, exception text/URLs.
                GET STACKED DIAGNOSTICS failure_code = RETURNED_SQLSTATE;
                failure_code := 'calculation_sqlstate_' || failure_code;
                verdict := NULL;
            END;
        END IF;
        IF verdict IN ('saved','already_saved') THEN
            UPDATE curriculum.live_session_speaking_jobs
            SET state='complete',attempts=attempts+1,finished_at=clock_timestamp(),last_error=''
            WHERE occurrence_id=job.occurrence_id;
            completed := completed+1;
        ELSE
            UPDATE curriculum.live_session_speaking_jobs
            SET state='retry',attempts=attempts+1,last_error=failure_code,
                next_attempt_at=now()+least(interval '6 hours',
                    interval '5 minutes'*power(2,least(attempts,7)))
            WHERE occurrence_id=job.occurrence_id;
            retrying := retrying+1;
        END IF;
    END LOOP;
    RETURN NEXT;
END
$jobs$;

REVOKE ALL ON TABLE curriculum.live_session_speaking_jobs FROM PUBLIC;
REVOKE ALL ON FUNCTION curriculum.process_new_session_student_speaking(text[],integer) FROM PUBLIC;
COMMIT;

-- Operational status, no learner identities:
-- SELECT state,count(*),min(next_attempt_at),max(attempts)
-- FROM curriculum.live_session_speaking_jobs GROUP BY state;
-- Stop automatic work by rolling back the worker change via reviewed main.
-- Keep receipts/results for audit. Removing these new objects is a separate
-- reviewed operation; never drop the original source or snapshot tables.
