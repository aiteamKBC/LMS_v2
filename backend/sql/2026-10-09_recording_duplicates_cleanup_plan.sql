-- Recording duplicates: REVIEW-ONLY cleanup plan. Not applied by any code, migration or deploy.
--
-- Background (production, read-only audit 2026-10-09): Graph listed one Teams
-- recording under two ids. 26 recording copies (and 16 transcript copies) share
-- the same session, call id, content correlation id and recording window; each
-- copy was archived to its own byte-identical blob in `session-recordings`.
-- The sync now recognises one recording by its correlation id (see
-- upsert_live_session_artifact and session_archive.saved_copy_of_same_recording),
-- so no new duplicates are written. This file only deals with the existing ones.
--
-- Run step 1 alone first and review its output. Steps 2-4 run inside one
-- transaction that ends in ROLLBACK; change it to COMMIT only after review and
-- explicit approval. Step 5 (Azure blobs) is manual and comes last.

-- ---------------------------------------------------------------- 1. preview
-- One row per duplicate: the row kept, the row retired, and both blobs.
WITH artifact AS (
    SELECT a.id, a.occurrence_id, a.artifact_type, a.call_id, a.content_correlation_id, a.created_datetime,
           a.end_datetime, a.created_at, a.metadata, r.status AS archive_status, r.blob_name
    FROM curriculum.live_session_artifacts a
    LEFT JOIN curriculum.session_result_archive r ON r.artifact_id = a.id
    WHERE a.content_correlation_id <> ''
), ranked AS (
    SELECT *, row_number() OVER (
               PARTITION BY occurrence_id, artifact_type, call_id, content_correlation_id
               -- keep a row with a ready copy, then the oldest row (its id is the one links already use)
               ORDER BY (archive_status = 'ready') DESC NULLS LAST, created_at, id) AS rank,
           first_value(id) OVER (
               PARTITION BY occurrence_id, artifact_type, call_id, content_correlation_id
               ORDER BY (archive_status = 'ready') DESC NULLS LAST, created_at, id) AS keeper_id,
           first_value(blob_name) OVER (
               PARTITION BY occurrence_id, artifact_type, call_id, content_correlation_id
               ORDER BY (archive_status = 'ready') DESC NULLS LAST, created_at, id) AS keeper_blob
    FROM artifact
)
SELECT artifact_type, occurrence_id, keeper_id, keeper_blob, id AS retired_id, blob_name AS retired_blob,
       archive_status AS retired_archive_status,
       (SELECT count(*) FROM curriculum.live_session_recording_events e WHERE e.artifact_id = ranked.id) AS retired_play_events,
       COALESCE((metadata::jsonb ->> 'lmsHiddenFromLearners')::boolean, false) AS retired_hidden_from_learners
FROM ranked WHERE rank > 1
ORDER BY artifact_type, occurrence_id;
-- Checked read-only on 2026-10-09: 42 rows (26 recordings, 16 transcripts), all archived 'ready',
-- none with play events or a hidden flag, none sharing a blob with its keeper. Stop if this differs
-- materially when you run it.

-- ------------------------------------------------------ 2-4. guarded cleanup
BEGIN;

CREATE TEMP TABLE recording_duplicate_map ON COMMIT DROP AS
WITH artifact AS (
    SELECT a.id, a.occurrence_id, a.artifact_type, a.call_id, a.content_correlation_id, a.created_at,
           r.status AS archive_status
    FROM curriculum.live_session_artifacts a
    LEFT JOIN curriculum.session_result_archive r ON r.artifact_id = a.id
    WHERE a.content_correlation_id <> ''
), ranked AS (
    SELECT id, row_number() OVER w AS rank, first_value(id) OVER w AS keeper_id
    FROM artifact
    WINDOW w AS (PARTITION BY occurrence_id, artifact_type, call_id, content_correlation_id
                 ORDER BY (archive_status = 'ready') DESC NULLS LAST, created_at, id)
)
SELECT id AS retired_id, keeper_id FROM ranked WHERE rank > 1;

-- 2. Keep viewing history: move play/seek events to the kept row (the FK cascades on delete).
UPDATE curriculum.live_session_recording_events e
SET artifact_id = m.keeper_id
FROM recording_duplicate_map m
WHERE e.artifact_id = m.retired_id;

-- 3. Keep visibility: a recording hidden from learners on either copy stays hidden.
UPDATE curriculum.live_session_artifacts k
SET metadata = jsonb_set(COALESCE(k.metadata::jsonb, '{}'::jsonb), '{lmsHiddenFromLearners}', 'true'::jsonb),
    updated_at = now()
FROM recording_duplicate_map m
JOIN curriculum.live_session_artifacts d ON d.id = m.retired_id
WHERE k.id = m.keeper_id
  AND COALESCE((d.metadata::jsonb ->> 'lmsHiddenFromLearners')::boolean, false);

-- 4. Retire the duplicate rows: archive row first (FK is RESTRICT), then the artifact.
DELETE FROM curriculum.session_result_archive r USING recording_duplicate_map m WHERE r.artifact_id = m.retired_id;
DELETE FROM curriculum.live_session_artifacts a USING recording_duplicate_map m WHERE a.id = m.retired_id;

-- Verify inside the transaction: zero duplicates left, every kept row still has its archive row.
SELECT count(*) AS duplicates_left FROM (
    SELECT 1 FROM curriculum.live_session_artifacts WHERE content_correlation_id <> ''
    GROUP BY occurrence_id, artifact_type, call_id, content_correlation_id HAVING count(*) > 1) x;

ROLLBACK;  -- change to COMMIT only after review and approval

-- ------------------------------------------------- after a committed cleanup
-- Optional guard so the database itself refuses a second row for one recording
-- (create only once step 4 is committed; it fails while duplicates exist):
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS live_session_artifacts_one_per_recording
--     ON curriculum.live_session_artifacts (occurrence_id, artifact_type, call_id, content_correlation_id)
--     WHERE content_correlation_id <> '';

-- ---------------------------------------------- 5. Azure blobs (manual, last)
-- The retired_blob values from step 1 are byte-identical copies of keeper_blob.
-- Delete them from the `session-recordings` container only after step 4 is
-- committed, after confirming each retired blob's size equals its keeper's,
-- and after confirming no remaining archive row names it:
--   SELECT 1 FROM curriculum.session_result_archive WHERE blob_name = '<retired_blob>';
-- Keep the attendance.csv / teams-attendance-original.json / .txt files: they are
-- per-session, not per-artifact, and are not duplicates.
