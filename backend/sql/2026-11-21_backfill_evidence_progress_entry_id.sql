-- PREPARED ONLY: do not execute without explicit database-team approval.
-- Verified read-only on Neon Development branch lms-ideal-architecture on 2026-11-21.
-- Expected population: 165 unique matches, 8 ambiguous files, 29 unmatched files.
-- Expected unique candidate distribution:
-- assignment 34, live_session 26, podcast 9, powerpoint 31, reading 35, video 30.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

LOCK TABLE "Learner".evidence_files IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "Learner".learner_progress_entries IN SHARE MODE;
LOCK TABLE "Learner".learner_training_plan_components IN SHARE MODE;
LOCK TABLE curriculum.components IN SHARE MODE;

CREATE TEMP TABLE evidence_progress_backfill_population ON COMMIT DROP AS
WITH target_evidence AS (
    SELECT
        evidence.id AS evidence_id,
        evidence.learner_profile_id,
        evidence.plan_component_id,
        evidence.section_ref
    FROM "Learner".evidence_files evidence
    WHERE evidence.progress_entry_id IS NULL
      AND evidence.learner_profile_id IS NOT NULL
      AND evidence.plan_component_id IS NOT NULL
), eligible_matches AS (
    SELECT
        target.evidence_id,
        progress.id AS progress_entry_id,
        component.type AS component_type
    FROM target_evidence target
    JOIN "Learner".learner_progress_entries progress
      ON progress.learner_id = target.learner_profile_id
     AND progress.plan_component_id = target.plan_component_id
     AND progress.deleted_at IS NULL
     AND progress.accepted IS TRUE
    JOIN "Learner".learner_training_plan_components plan_component
      ON plan_component.id = target.plan_component_id
    JOIN curriculum.components component
      ON component.id = plan_component.curriculum_component_id
     AND component.id = target.section_ref
     AND component.id = progress.component_ref
)
SELECT
    target.evidence_id,
    count(eligible.progress_entry_id)::integer AS match_count,
    min(eligible.progress_entry_id) AS progress_entry_id,
    min(eligible.component_type) AS component_type
FROM target_evidence target
LEFT JOIN eligible_matches eligible ON eligible.evidence_id = target.evidence_id
GROUP BY target.evidence_id;

CREATE TEMP TABLE evidence_progress_backfill_candidates ON COMMIT DROP AS
SELECT evidence_id, progress_entry_id, component_type
FROM evidence_progress_backfill_population
WHERE match_count = 1;

DO $guard$
DECLARE
    population_count integer;
    candidate_count integer;
    ambiguous_count integer;
    unmatched_count integer;
    candidate_distribution jsonb;
    updated_count integer;
BEGIN
    SELECT
        count(*),
        count(*) FILTER (WHERE match_count = 1),
        count(*) FILTER (WHERE match_count > 1),
        count(*) FILTER (WHERE match_count = 0)
      INTO population_count, candidate_count, ambiguous_count, unmatched_count
      FROM evidence_progress_backfill_population;

    IF population_count <> 202 THEN
        RAISE EXCEPTION 'Evidence progress backfill aborted: expected 202 target files, found %',
            population_count;
    END IF;

    IF candidate_count <> 165 THEN
        RAISE EXCEPTION 'Evidence progress backfill aborted: expected 165 unique candidates, found %',
            candidate_count;
    END IF;

    IF ambiguous_count <> 8 THEN
        RAISE EXCEPTION 'Evidence progress backfill aborted: expected 8 ambiguous files, found %',
            ambiguous_count;
    END IF;

    IF unmatched_count <> 29 THEN
        RAISE EXCEPTION 'Evidence progress backfill aborted: expected 29 unmatched files, found %',
            unmatched_count;
    END IF;

    SELECT jsonb_object_agg(component_type, type_count ORDER BY component_type)
      INTO candidate_distribution
      FROM (
          SELECT component_type, count(*) AS type_count
          FROM evidence_progress_backfill_candidates
          GROUP BY component_type
      ) counts;

    IF candidate_distribution IS DISTINCT FROM '{
        "assignment": 34,
        "live_session": 26,
        "podcast": 9,
        "powerpoint": 31,
        "reading": 35,
        "video": 30
    }'::jsonb THEN
        RAISE EXCEPTION 'Evidence progress backfill aborted: candidate distribution changed: %',
            candidate_distribution;
    END IF;

    UPDATE "Learner".evidence_files evidence
       SET progress_entry_id = candidate.progress_entry_id
      FROM evidence_progress_backfill_candidates candidate
      JOIN "Learner".learner_progress_entries progress
        ON progress.id = candidate.progress_entry_id
       AND progress.deleted_at IS NULL
       AND progress.accepted IS TRUE
      JOIN "Learner".learner_training_plan_components plan_component
        ON plan_component.id = progress.plan_component_id
      JOIN curriculum.components component
        ON component.id = plan_component.curriculum_component_id
       AND component.id = progress.component_ref
       AND component.type = candidate.component_type
     WHERE evidence.id = candidate.evidence_id
       AND evidence.progress_entry_id IS NULL
       AND evidence.learner_profile_id = progress.learner_id
       AND evidence.plan_component_id = progress.plan_component_id
       AND evidence.section_ref = component.id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count <> 165 THEN
        RAISE EXCEPTION 'Evidence progress backfill aborted: expected 165 updates, updated %',
            updated_count;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM evidence_progress_backfill_candidates candidate
        JOIN "Learner".evidence_files evidence ON evidence.id = candidate.evidence_id
        WHERE evidence.progress_entry_id IS DISTINCT FROM candidate.progress_entry_id
    ) THEN
        RAISE EXCEPTION 'Evidence progress backfill aborted: post-update verification failed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM evidence_progress_backfill_population population
        JOIN "Learner".evidence_files evidence ON evidence.id = population.evidence_id
        WHERE population.match_count <> 1
          AND evidence.progress_entry_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Evidence progress backfill aborted: an ambiguous or unmatched file was updated';
    END IF;
END
$guard$;

COMMIT;
