-- Database-only, one-time snapshots of SAVED transcript speaking intervals.
-- No dashboard/API changes, triggers, schedules, external calls or source writes.
-- PostgreSQL 14+ (range_agg). Verify the actual server/branch before applying.
-- Set lms.speaking_expected_database to the verified database name first.
-- Installation creates objects only. The explicit backfill call is separate:
--   SELECT * FROM curriculum.save_session_student_speaking();
-- Or process one occurrence: SELECT * FROM ...('occurrence-id');
-- Preview (no writes): SELECT * FROM curriculum.preview_session_student_speaking();
-- Only positively attributed speech is stored per learner; absence of a result
-- is NOT evidence of zero speech. Names are evidence for attribution, not proof
-- of identity. Unresolved/excluded speakers remain in the run's audit JSON.
-- Existing snapshots are immutable to this procedure, including unresolved ones.
-- New/corrected transcripts or later identity reviews do not refresh a snapshot.
-- Concurrent REPEATABLE READ calls can raise SQLSTATE 40001. Retry the entire
-- transaction; the retry reports already_saved, without duplicate result rows.
-- Rollback plan: stop calling the procedure; original tables are untouched.
-- Removing the new tables/functions requires a separate review and export of
-- their saved results. Do not remove or modify the original evidence tables.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
    IF current_setting('lms.speaking_expected_database', true) IS DISTINCT FROM current_database() THEN
        RAISE EXCEPTION 'Verify the server/branch and set lms.speaking_expected_database before installation';
    END IF;
    IF current_setting('server_version_num')::integer < 140000 THEN
        RAISE EXCEPTION 'PostgreSQL 14 or newer is required';
    END IF;
END
$guard$;

CREATE TABLE curriculum.live_session_speaking_runs (
    occurrence_id text PRIMARY KEY,
    live_session_id text NOT NULL,
    calculated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    calculation_version smallint NOT NULL DEFAULT 1 CHECK (calculation_version = 1),
    source_artifacts jsonb NOT NULL CHECK (jsonb_typeof(source_artifacts) = 'array'),
    source_fingerprint text NOT NULL,
    learner_result_count integer NOT NULL CHECK (learner_result_count >= 0),
    unresolved_speakers jsonb NOT NULL CHECK (jsonb_typeof(unresolved_speakers) = 'array'),
    excluded_speakers jsonb NOT NULL CHECK (jsonb_typeof(excluded_speakers) = 'array')
);

CREATE TABLE curriculum.live_session_student_speaking (
    occurrence_id text NOT NULL REFERENCES curriculum.live_session_speaking_runs(occurrence_id),
    live_session_id text NOT NULL,
    module_catalogue_id text NOT NULL,
    learner_profile_id bigint NOT NULL,
    learner_name text NOT NULL,
    speaking_seconds numeric NOT NULL CHECK (speaking_seconds > 0),
    cue_count integer NOT NULL CHECK (cue_count > 0),
    speaker_names jsonb NOT NULL CHECK (jsonb_typeof(speaker_names) = 'array'),
    match_status text NOT NULL CHECK (match_status IN ('unique_name', 'reviewed_attendance')),
    calculated_at timestamptz NOT NULL,
    PRIMARY KEY (occurrence_id, module_catalogue_id, learner_profile_id)
);
CREATE INDEX live_session_student_speaking_learner_idx
    ON curriculum.live_session_student_speaking(learner_profile_id, module_catalogue_id);

CREATE FUNCTION curriculum.speaking_name_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN btrim(regexp_replace(
    regexp_replace(lower(normalize(coalesce(value, ''), NFKC)),
        '\s+\((unverified|external|guest)\)\s*$', '', 'i'), '\s+', ' ', 'g'));

CREATE FUNCTION curriculum.preview_session_student_speaking(p_occurrence_id text DEFAULT NULL)
RETURNS TABLE (
    occurrence_id text, live_session_id text, module_catalogue_id text,
    learner_profile_id bigint, learner_name text, speaking_seconds numeric,
    cue_count integer, speaker_names jsonb, match_status text, reason text
)
LANGUAGE sql STABLE SET search_path = pg_catalog, curriculum
AS $preview$
WITH
artifacts AS MATERIALIZED (
    SELECT a.*, o.live_session_id, s.module_catalogue_id AS source_module_id,
           s.organizer_email
    FROM curriculum.live_session_artifacts a
    JOIN curriculum.live_session_occurrences o ON o.id = a.occurrence_id
    JOIN curriculum.live_sessions s ON s.id = o.live_session_id
    WHERE a.artifact_type = 'transcript'
      AND (p_occurrence_id IS NULL OR a.occurrence_id = p_occurrence_id)
),
-- Do not silently publish partial/invalid timing or invent offsets. Such a
-- session is visible as blocked and is not marked processed by the save call.
eligible AS (
    SELECT a.occurrence_id
    FROM artifacts a GROUP BY a.occurrence_id
    HAVING bool_and(coalesce(a.created_datetime IS NOT NULL
        AND a.metadata::jsonb #>> '{lmsTranscriptTimeline,version}' = '1'
        AND jsonb_typeof(a.metadata::jsonb #> '{lmsTranscriptTimeline,cues}') = 'array'
        AND a.metadata::jsonb #> '{lmsTranscriptTimeline,cues}' <> '[]'::jsonb, false))
),
sessions AS (
    SELECT DISTINCT a.occurrence_id::text, a.live_session_id::text,
           a.source_module_id::text, lower(btrim(a.organizer_email)) AS organizer_email
    FROM artifacts a
),
-- Saved registers preserve historical membership. Do not substitute today's
-- training plan or infer a learner from a different delivery/module.
roster AS MATERIALIZED (
    SELECT DISTINCT s.occurrence_id, r.module_catalogue_id::text,
        r.learner_profile_id, r.learner_name::text,
        lower(btrim(r.learner_email)) AS email,
        curriculum.speaking_name_key(r.learner_name) AS name_key
    FROM sessions s
    JOIN curriculum.live_session_learner_attendance r
      ON r.occurrence_id = s.occurrence_id OR r.attendance_source_occurrence_id = s.occurrence_id
    JOIN curriculum.modules m ON m.module_catalogue_id = r.module_catalogue_id
    WHERE r.module_catalogue_id = s.source_module_id
       OR m.teams_shared_source_module_id = s.source_module_id
),
contexts AS (
    SELECT occurrence_id, source_module_id AS module_catalogue_id FROM sessions
    UNION SELECT occurrence_id, module_catalogue_id FROM roster
),
tutors AS (
    SELECT DISTINCT c.occurrence_id, lower(btrim(m.tutor_email)) AS email,
        curriculum.speaking_name_key(m.tutor_name) AS name_key
    FROM contexts c JOIN curriculum.modules m USING (module_catalogue_id)
),
attendance_raw AS (
    SELECT a.*, lower(btrim(coalesce(nullif(a.email, ''), a.raw_data->>'emailAddress', ''))) AS source_email,
        coalesce(nullif(btrim(a.display_name), ''), nullif(a.raw_data#>>'{identity,displayName}', ''),
            a.raw_data#>>'{identity,user,displayName}', a.raw_data#>>'{identity,guest,displayName}',
            a.raw_data->>'displayName', a.raw_data->>'participantDisplayName', a.raw_data->>'name', '') AS name,
        coalesce(nullif(a.raw_data#>>'{identity,id}', ''), nullif(a.raw_data#>>'{identity,user,id}', ''),
            nullif(a.raw_data#>>'{identity,guest,id}', ''), nullif(a.raw_data#>>'{identity,phone,id}', '')) AS account_id,
        coalesce(a.raw_data#>>'{identity,tenantId}', a.raw_data#>>'{identity,user,tenantId}',
            a.raw_data#>>'{identity,guest,tenantId}', '') AS tenant_id
    FROM curriculum.live_session_attendance a JOIN sessions s ON s.occurrence_id = a.occurrence_id
),
attendance AS MATERIALIZED (
    SELECT a.*, curriculum.speaking_name_key(a.name) AS name_key,
        CASE WHEN a.account_id IS NOT NULL THEN 'account:' || lower(a.tenant_id) || ':' || a.account_id
             WHEN a.source_email <> '' THEN 'email:' || a.source_email
             ELSE 'row:' || a.id END AS identity_key
    FROM attendance_raw a
),
name_identities AS (
    SELECT a.occurrence_id, a.name_key, count(DISTINCT a.identity_key) AS identity_count
    FROM attendance a GROUP BY a.occurrence_id, a.name_key
),
attendance_targets AS MATERIALIZED (
    SELECT a.occurrence_id, c.module_catalogue_id, a.name_key, a.identity_key,
        a.source_email, rule.active AS rule_active,
        coalesce(rule.learner_profile_id, legacy.learner_profile_id, alias.learner_profile_id) AS reviewed_id,
        lower(btrim(coalesce(rule.canonical_email, legacy.canonical_email, alias.canonical_email))) AS reviewed_email
    FROM attendance a JOIN contexts c ON c.occurrence_id = a.occurrence_id
    LEFT JOIN LATERAL (
        SELECT r.* FROM curriculum.live_session_attendance_identity_rules r
        WHERE r.module_catalogue_id = c.module_catalogue_id
          AND ((r.identity_kind = 'record' AND r.identity_value = a.occurrence_id || ':' || a.id)
            OR (r.identity_kind = 'email' AND r.identity_value = a.source_email AND a.source_email <> '')
            OR (r.identity_kind = 'guest_name' AND r.identity_value = a.name_key AND a.name_key <> ''))
        ORDER BY CASE r.identity_kind WHEN 'record' THEN 0 WHEN 'email' THEN 1 ELSE 2 END LIMIT 1
    ) rule ON true
    LEFT JOIN curriculum.live_session_attendance_identity_links legacy
      ON rule.identity_kind IS NULL AND legacy.occurrence_id = a.occurrence_id AND legacy.attendance_row_id = a.id
    LEFT JOIN curriculum.live_session_attendance_aliases alias
      ON rule.identity_kind IS NULL AND legacy.id IS NULL
        AND alias.module_catalogue_id = c.module_catalogue_id AND lower(btrim(alias.alias_email)) = a.source_email
),
candidate_rows AS (
    SELECT DISTINCT a.occurrence_id, a.module_catalogue_id, a.name_key,
        r.learner_profile_id, r.learner_name,
        CASE WHEN a.reviewed_id IS NOT NULL THEN 'reviewed_attendance' ELSE 'unique_name' END AS match_status
    FROM attendance_targets a
    JOIN roster r ON r.occurrence_id = a.occurrence_id AND r.module_catalogue_id = a.module_catalogue_id
      AND CASE WHEN a.reviewed_id IS NOT NULL
          THEN r.learner_profile_id = a.reviewed_id AND r.email = a.reviewed_email
          ELSE (a.source_email <> '' AND r.email = a.source_email)
            OR (r.name_key = a.name_key AND r.name_key <> ''
                AND NOT EXISTS (SELECT 1 FROM "Learner".learners known
                    WHERE lower(btrim(known.email)) = a.source_email AND known.id <> r.learner_profile_id)) END
    WHERE a.rule_active IS DISTINCT FROM false
      AND NOT EXISTS (SELECT 1 FROM tutors t WHERE t.occurrence_id = a.occurrence_id
                      AND t.email <> '' AND t.email = a.source_email)
),
-- A unique name in one module must not hide a second learner in another module.
candidate_identity_counts AS (
    SELECT occurrence_id, name_key, count(DISTINCT learner_profile_id) AS learner_count
    FROM candidate_rows GROUP BY occurrence_id, name_key
),
raw_cues AS (
    SELECT a.occurrence_id::text, a.live_session_id::text, a.created_datetime,
           c.cue, curriculum.speaking_name_key(c.cue->>'speaker') AS name_key,
           coalesce(c.cue->>'speaker', '') AS speaker
    FROM artifacts a JOIN eligible e ON e.occurrence_id = a.occurrence_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE
        WHEN jsonb_typeof(a.metadata::jsonb#>'{lmsTranscriptTimeline,cues}') = 'array'
        THEN a.metadata::jsonb#>'{lmsTranscriptTimeline,cues}' ELSE '[]'::jsonb END) AS c(cue)
),
cue_values AS (
    SELECT c.*,
        CASE WHEN jsonb_typeof(c.cue->'start') = 'number' THEN (c.cue->>'start')::numeric END AS starts,
        CASE WHEN jsonb_typeof(c.cue->'end') = 'number' THEN (c.cue->>'end')::numeric END AS ends
    FROM raw_cues c
),
valid_cues AS (
    SELECT c.*, numrange(extract(epoch FROM c.created_datetime) + c.starts,
        extract(epoch FROM c.created_datetime) + c.ends, '[)') AS span
    FROM cue_values c WHERE c.ends > c.starts
),
speakers AS (
    SELECT c.occurrence_id, c.name_key, jsonb_agg(DISTINCT c.speaker) AS speaker_names,
        range_agg(c.span) AS spans, count(*)::integer AS cue_count
    FROM valid_cues c GROUP BY c.occurrence_id, c.name_key
),
decisions AS (
    SELECT sp.*, cx.module_catalogue_id, s.live_session_id,
        candidate.learner_profile_id, candidate.learner_name, candidate.match_status AS candidate_status,
        CASE
          WHEN sp.name_key = '' THEN 'unresolved'
          WHEN ni.identity_count > 1 OR ci.learner_count > 1 THEN 'unresolved'
          WHEN EXISTS (SELECT 1 FROM attendance_targets revoked WHERE revoked.occurrence_id = sp.occurrence_id
              AND revoked.module_catalogue_id = cx.module_catalogue_id AND revoked.name_key = sp.name_key
              AND revoked.rule_active = false) THEN 'unresolved'
          WHEN EXISTS (SELECT 1 FROM tutors t WHERE t.occurrence_id = sp.occurrence_id AND
                ((t.name_key = sp.name_key AND t.name_key <> '') OR EXISTS (
                    SELECT 1 FROM attendance a WHERE a.occurrence_id = sp.occurrence_id
                    AND a.name_key = sp.name_key AND a.source_email = t.email AND t.email <> '')))
            THEN CASE WHEN ci.learner_count > 0 THEN 'unresolved' ELSE 'excluded_tutor' END
          WHEN candidate.learner_profile_id IS NOT NULL THEN candidate.match_status
          ELSE 'unresolved' END AS decision,
        CASE
          WHEN sp.name_key = '' THEN 'missing_speaker_name'
          WHEN ni.identity_count > 1 THEN 'same_name_multiple_attendance_identities'
          WHEN ci.learner_count > 1 THEN 'same_name_multiple_learners'
          WHEN EXISTS (SELECT 1 FROM attendance_targets revoked WHERE revoked.occurrence_id = sp.occurrence_id
              AND revoked.module_catalogue_id = cx.module_catalogue_id AND revoked.name_key = sp.name_key
              AND revoked.rule_active = false) THEN 'revoked_attendance_link'
          WHEN EXISTS (SELECT 1 FROM tutors t WHERE t.occurrence_id = sp.occurrence_id AND
                ((t.name_key = sp.name_key AND t.name_key <> '') OR EXISTS (
                    SELECT 1 FROM attendance a WHERE a.occurrence_id = sp.occurrence_id
                    AND a.name_key = sp.name_key AND a.source_email = t.email AND t.email <> '')))
            THEN CASE WHEN ci.learner_count > 0 THEN 'tutor_learner_name_conflict' ELSE 'assigned_tutor' END
          WHEN candidate.learner_profile_id IS NOT NULL THEN 'unique_speaker_name_to_scoped_attendance'
          WHEN ni.identity_count IS NULL THEN 'no_matching_attendance_name'
          ELSE 'no_unambiguous_scoped_learner' END AS decision_reason
    FROM speakers sp JOIN sessions s ON s.occurrence_id = sp.occurrence_id
    JOIN contexts cx ON cx.occurrence_id = sp.occurrence_id
    LEFT JOIN name_identities ni ON ni.occurrence_id = sp.occurrence_id AND ni.name_key = sp.name_key
    LEFT JOIN candidate_identity_counts ci ON ci.occurrence_id = sp.occurrence_id AND ci.name_key = sp.name_key
    LEFT JOIN LATERAL (
        SELECT cr.learner_profile_id, min(cr.learner_name) AS learner_name,
            CASE WHEN bool_and(cr.match_status = 'reviewed_attendance') THEN 'reviewed_attendance' ELSE 'unique_name' END AS match_status
        FROM candidate_rows cr WHERE cr.occurrence_id = sp.occurrence_id
            AND cr.module_catalogue_id = cx.module_catalogue_id AND cr.name_key = sp.name_key
        GROUP BY cr.learner_profile_id
        HAVING coalesce(ci.learner_count, 0) = 1
    ) candidate ON true
),
-- Merge all names/aliases for one learner before calculating duration.
grouped AS (
    SELECT d.occurrence_id, d.live_session_id, d.module_catalogue_id,
        CASE WHEN d.decision IN ('unique_name', 'reviewed_attendance') THEN d.learner_profile_id END AS learner_profile_id,
        CASE WHEN bool_and(d.decision IN ('unique_name', 'reviewed_attendance')) THEN min(d.learner_name) ELSE '' END AS learner_name,
        range_agg(d.spans) AS spans, sum(d.cue_count)::integer AS cue_count,
        CASE WHEN bool_and(d.decision = 'reviewed_attendance') THEN 'reviewed_attendance'
            WHEN bool_and(d.decision IN ('unique_name', 'reviewed_attendance')) THEN 'unique_name'
            ELSE min(d.decision) END AS match_status,
        min(d.decision_reason) AS reason,
        jsonb_agg(d.speaker_names) AS names
    FROM decisions d
    GROUP BY d.occurrence_id, d.live_session_id, d.module_catalogue_id,
        CASE WHEN d.decision IN ('unique_name', 'reviewed_attendance') THEN d.learner_profile_id END,
        CASE WHEN d.decision IN ('unique_name', 'reviewed_attendance') THEN '' ELSE d.name_key END,
        CASE WHEN d.decision IN ('unique_name', 'reviewed_attendance') THEN '' ELSE d.decision END
)
SELECT g.occurrence_id, g.live_session_id, g.module_catalogue_id, g.learner_profile_id,
    g.learner_name, (SELECT sum(upper(r) - lower(r)) FROM unnest(g.spans) r), g.cue_count,
    (SELECT jsonb_agg(DISTINCT n.name ORDER BY n.name)
        FROM jsonb_array_elements(g.names) arr CROSS JOIN LATERAL jsonb_array_elements(arr) n(name)),
    g.match_status, g.reason
FROM grouped g
UNION ALL
SELECT s.occurrence_id, s.live_session_id, s.source_module_id, NULL::bigint, '', NULL::numeric,
    0, '[]'::jsonb, 'blocked', 'missing_or_empty_timing_or_artifact_start'
FROM sessions s WHERE NOT EXISTS (SELECT 1 FROM eligible e WHERE e.occurrence_id = s.occurrence_id)
UNION ALL
SELECT c.occurrence_id, c.live_session_id, s.source_module_id, NULL::bigint, '', NULL::numeric,
    count(*)::integer, jsonb_agg(DISTINCT c.speaker), 'blocked', 'invalid_cue_timing'
FROM cue_values c JOIN sessions s ON s.occurrence_id = c.occurrence_id
WHERE c.starts IS NULL OR c.ends IS NULL OR c.ends <= c.starts
GROUP BY c.occurrence_id, c.live_session_id, s.source_module_id
$preview$;

CREATE FUNCTION curriculum.save_session_student_speaking(p_occurrence_id text DEFAULT NULL)
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
             speaking_seconds, cue_count, speaker_names, match_status, calculated_at)
        SELECT p.occurrence_id, p.live_session_id, p.module_catalogue_id, p.learner_profile_id,
            p.learner_name, p.speaking_seconds, p.cue_count, p.speaker_names, p.match_status, calculated
        FROM jsonb_to_recordset(preview) p(occurrence_id text, live_session_id text,
            module_catalogue_id text, learner_profile_id bigint, learner_name text,
            speaking_seconds numeric, cue_count integer, speaker_names jsonb, match_status text)
        WHERE p.match_status IN ('unique_name', 'reviewed_attendance');
        learner_rows := row_count;
        outcome := 'saved'; RETURN NEXT;
    END LOOP;
END
$save$;

-- These are operator tools, not a new public/application write surface.
REVOKE ALL ON FUNCTION curriculum.speaking_name_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION curriculum.preview_session_student_speaking(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION curriculum.save_session_student_speaking(text) FROM PUBLIC;
REVOKE ALL ON TABLE curriculum.live_session_speaking_runs FROM PUBLIC;
REVOKE ALL ON TABLE curriculum.live_session_student_speaking FROM PUBLIC;

COMMIT;

-- Explicit execution after reviewing preview results and verifying the target:
-- BEGIN ISOLATION LEVEL REPEATABLE READ;
-- SET LOCAL lms.speaking_expected_database = '<verified-database-name>';
-- SELECT outcome, count(*), sum(learner_rows)
-- FROM curriculum.save_session_student_speaking() GROUP BY outcome;
-- COMMIT;
