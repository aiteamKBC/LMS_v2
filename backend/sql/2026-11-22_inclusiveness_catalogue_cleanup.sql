-- AUDIT REFERENCE: Development cleanup completed externally and verified 2026-11-22.
-- Retained to document reviewed scope and preservation guards; no rerun required.
-- This file was not executed by the coding agent. Never execute on Production.
-- psql -X -v ON_ERROR_STOP=1 -f backend/sql/2026-11-22_inclusiveness_catalogue_cleanup.sql
-- Deploy/test the Free Course hours reader first. Keep free_course_hours_migration:
-- it is the reviewed identity bridge; ledger rows remain the hours authority.
-- No enrollment, completion, ledger identity or hours writes. Reruns are no-ops.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $cleanup$
DECLARE
    source_ids bigint[] := ARRAY[984,985,986,987,988,989,990];
    old_refs text[] := ARRAY['147095','147098','147100','147102','147104','147106','147108'];
    courses text[] := ARRAY[
        'FREECOURSE-KBC-INC-M01-20260917','FREECOURSE-KBC-INC-M02-20260917',
        'FREECOURSE-KBC-INC-M03-20260917','FREECOURSE-KBC-INC-M04-20260917',
        'FREECOURSE-KBC-INC-M05-20260917','FREECOURSE-KBC-INC-M06-20260917',
        'FREECOURSE-KBC-INC-M07-20260917'];
    ledger_before jsonb;
    completion_before jsonb;
    enrollment_before jsonb;
    mapping_before jsonb;
    sources_before jsonb;
    history_before jsonb;
    history_ids text[];
    target_count integer;
BEGIN
    IF current_database() <> 'neondb'
       OR current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-raspy-sky-abvs8lq9' THEN
        RAISE EXCEPTION 'Refusing cleanup outside approved Neon Development';
    END IF;

    -- Serialize the small reviewed cleanup and prevent concurrent changed mappings,
    -- new references or progress writes from invalidating pre/post comparisons.
    LOCK TABLE "Learner".free_course_hours_migration,
        "Learner".learner_progress_entries,"Learner".learner_free_course_progress,
        "Learner".learner_free_courses,"Learner".learner_activity_sources,
        "Learner".learner_source_course_memberships,"Learner".subject_activity_attempts,
        "Learner".learner_progress_historical_components,
        curriculum.source_courses,curriculum.source_activities,curriculum.historical_components,
        curriculum.free_programme_components,curriculum.free_course_weeks
        IN SHARE ROW EXCLUSIVE MODE;

    IF (SELECT count(*) FROM "Learner".free_course_hours_migration) <> 488
       OR EXISTS (SELECT 1 FROM "Learner".free_course_hours_migration
           WHERE learner_id NOT IN (272,1000) OR NOT free_course_id=ANY(courses))
       OR EXISTS (SELECT 1 FROM "Learner".free_course_hours_migration
           GROUP BY learner_id,free_component_id HAVING count(*)<>1)
       OR EXISTS (SELECT 1 FROM "Learner".free_course_hours_migration m
           LEFT JOIN "Learner".learner_progress_entries p
             ON p.id=m.old_progress_id AND p.learner_id=m.learner_id
           LEFT JOIN curriculum.free_programme_components a ON a.id=m.free_component_id
           LEFT JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
           WHERE p.id IS NULL OR to_jsonb(p) IS DISTINCT FROM m.original_progress
              OR p.accepted IS DISTINCT FROM m.accepted
              OR p.actual_seconds IS DISTINCT FROM m.actual_seconds
              OR p.deleted_at IS NOT NULL OR a.id IS NULL OR a.deleted_at IS NOT NULL
              OR w.course_id IS DISTINCT FROM m.free_course_id
              OR w.deleted_at IS NOT NULL OR w.status IS DISTINCT FROM 'active') THEN
        RAISE EXCEPTION 'Mapping, content ownership or original ledger drift: review before cleanup';
    END IF;
    IF (SELECT count(*) FROM "Learner".free_course_hours_migration WHERE learner_id=272 AND accepted IS TRUE)<>244
       OR (SELECT sum(actual_seconds) FROM "Learner".free_course_hours_migration WHERE learner_id=272 AND accepted IS TRUE) IS DISTINCT FROM 137310::numeric
       OR (SELECT count(*) FROM "Learner".free_course_hours_migration WHERE learner_id=1000 AND accepted IS FALSE AND actual_seconds IS NULL)<>244 THEN
        RAISE EXCEPTION 'Expected acceptance/seconds baseline differs';
    END IF;
    IF (SELECT count(*) FROM "Learner".learner_free_courses WHERE learner_id=272 AND free_course_ref=ANY(courses))<>7
       OR (SELECT count(DISTINCT free_course_ref) FROM "Learner".learner_free_courses WHERE learner_id=272 AND free_course_ref=ANY(courses))<>7
       OR EXISTS (SELECT 1 FROM "Learner".learner_free_courses WHERE learner_id=1000 AND free_course_ref=ANY(courses))
       OR (SELECT count(*) FROM "Learner".free_course_hours_migration m
           JOIN "Learner".learner_free_course_progress p
             ON p.learner_id=m.learner_id AND p.free_course_ref=m.free_course_id AND p.component_ref=m.free_component_id
           WHERE m.learner_id=272 AND p.is_completed AND p.status='active' AND p.deleted_at IS NULL)<>244
       OR EXISTS (SELECT 1 FROM "Learner".learner_free_course_progress WHERE learner_id=1000 AND free_course_ref=ANY(courses)) THEN
        RAISE EXCEPTION 'Enrollment/completion baseline differs';
    END IF;

    SELECT count(*) INTO target_count FROM curriculum.source_courses WHERE id=ANY(source_ids);
    IF target_count NOT IN (0,7) OR EXISTS (
        SELECT 1 FROM curriculum.source_courses c WHERE c.id=ANY(source_ids)
        AND (c.source_system<>'old_lms' OR c.source_course_ref IS DISTINCT FROM old_refs[array_position(source_ids,c.id)])) THEN
        RAISE EXCEPTION 'Unexpected or partially removed source courses';
    END IF;
    IF target_count=7 AND (
        (SELECT count(*) FROM "Learner".learner_source_course_memberships WHERE source_course_id=ANY(source_ids))<>14
        OR (SELECT count(*) FROM curriculum.source_activities WHERE source_course_id=ANY(source_ids))<>331
        OR (SELECT count(*) FROM "Learner".learner_activity_sources s
            JOIN curriculum.source_activities a ON a.id=s.source_catalog_activity_id
            JOIN "Learner".free_course_hours_migration m ON m.old_progress_id=s.canonical_progress_id AND m.learner_id=s.learner_id
            WHERE a.source_course_id=ANY(source_ids)
              AND m.free_course_id=courses[array_position(source_ids,a.source_course_id)])<>488
    ) THEN RAISE EXCEPTION 'Source coverage or course mapping differs'; END IF;

    -- Refuse shared/unreviewed dependencies. Do not disable constraints or cascade
    -- through unknown tables. Known SET NULL links are preserved below.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f' AND (
        (confrelid='curriculum.source_courses'::regclass AND NOT (
          (conrelid='"Learner".learner_source_course_memberships'::regclass AND confdeltype='r') OR
          (conrelid='curriculum.source_activities'::regclass AND confdeltype='c') OR
          (conrelid='curriculum.historical_components'::regclass AND confdeltype='n'))) OR
        (confrelid='curriculum.source_activities'::regclass AND NOT (
          (conrelid='"Learner".learner_activity_sources'::regclass AND confdeltype='n') OR
          (conrelid='curriculum.historical_components'::regclass AND confdeltype='n') OR
          (conrelid='"Learner".subject_activity_attempts'::regclass AND confdeltype='r')))))
       OR EXISTS (SELECT 1 FROM "Learner".learner_source_course_memberships
           WHERE source_course_id=ANY(source_ids) AND learner_id NOT IN (272,1000))
       OR EXISTS (SELECT 1 FROM "Learner".subject_activity_attempts t
           JOIN curriculum.source_activities a ON a.id=t.source_activity_fk WHERE a.source_course_id=ANY(source_ids))
       OR EXISTS (SELECT 1 FROM "Learner".learner_activity_sources s
           JOIN curriculum.source_activities a ON a.id=s.source_catalog_activity_id
           WHERE a.source_course_id=ANY(source_ids) AND NOT EXISTS (
               SELECT 1 FROM "Learner".free_course_hours_migration m
               WHERE m.old_progress_id=s.canonical_progress_id AND m.learner_id=s.learner_id))
       OR EXISTS (SELECT 1 FROM "Learner".learner_progress_historical_components h
           JOIN curriculum.historical_components c ON c.id=h.historical_component_ref
           WHERE (c.source_course_id=ANY(source_ids) OR c.source_catalog_activity_id IN (
               SELECT id FROM curriculum.source_activities WHERE source_course_id=ANY(source_ids))) AND NOT EXISTS (
               SELECT 1 FROM "Learner".free_course_hours_migration m WHERE m.old_progress_id=h.progress_id)) THEN
        RAISE EXCEPTION 'Unexpected/shared dependency: no cleanup authorized';
    END IF;

    SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO ledger_before
      FROM "Learner".learner_progress_entries p JOIN "Learner".free_course_hours_migration m ON m.old_progress_id=p.id;
    SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO completion_before
      FROM "Learner".learner_free_course_progress p WHERE learner_id IN (272,1000);
    SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO enrollment_before
      FROM "Learner".learner_free_courses p WHERE learner_id IN (272,1000);
    SELECT jsonb_agg(to_jsonb(m) ORDER BY old_progress_id) INTO mapping_before FROM "Learner".free_course_hours_migration m;
    SELECT jsonb_agg(to_jsonb(s)-'source_catalog_activity_id' ORDER BY s.id) INTO sources_before
      FROM "Learner".learner_activity_sources s JOIN "Learner".free_course_hours_migration m ON m.old_progress_id=s.canonical_progress_id;
    SELECT array_agg(id ORDER BY id) INTO history_ids FROM curriculum.historical_components
      WHERE source_course_id=ANY(source_ids) OR source_catalog_activity_id IN (
          SELECT id FROM curriculum.source_activities WHERE source_course_id=ANY(source_ids));
    SELECT jsonb_agg(to_jsonb(h)-'source_catalog_activity_id'-'source_course_id' ORDER BY id) INTO history_before
      FROM curriculum.historical_components h WHERE id=ANY(history_ids);

    -- Precisely scoped catalogue cleanup. The 488 ledger records and all source
    -- evidence/historical components survive. FK SET NULL detaches catalogue only.
    DELETE FROM "Learner".learner_source_course_memberships WHERE source_course_id=ANY(source_ids);
    DELETE FROM curriculum.source_activities WHERE source_course_id=ANY(source_ids);
    DELETE FROM curriculum.source_courses WHERE id=ANY(source_ids);

    IF ledger_before IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id)
        FROM "Learner".learner_progress_entries p JOIN "Learner".free_course_hours_migration m ON m.old_progress_id=p.id)
       OR completion_before IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id)
        FROM "Learner".learner_free_course_progress p WHERE learner_id IN (272,1000))
       OR enrollment_before IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id)
        FROM "Learner".learner_free_courses p WHERE learner_id IN (272,1000))
       OR mapping_before IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(m) ORDER BY old_progress_id) FROM "Learner".free_course_hours_migration m)
       OR sources_before IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s)-'source_catalog_activity_id' ORDER BY s.id)
        FROM "Learner".learner_activity_sources s JOIN "Learner".free_course_hours_migration m ON m.old_progress_id=s.canonical_progress_id)
       OR history_before IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(h)-'source_catalog_activity_id'-'source_course_id' ORDER BY id)
        FROM curriculum.historical_components h WHERE id=ANY(history_ids)) THEN
        RAISE EXCEPTION 'Preservation check failed; entire cleanup rolled back';
    END IF;
    IF EXISTS (SELECT 1 FROM curriculum.source_courses WHERE id=ANY(source_ids))
       OR EXISTS (SELECT 1 FROM curriculum.source_activities WHERE source_course_id=ANY(source_ids))
       OR EXISTS (SELECT 1 FROM "Learner".learner_source_course_memberships WHERE source_course_id=ANY(source_ids))
       OR (SELECT sum(p.actual_seconds) FROM "Learner".learner_progress_entries p
          JOIN "Learner".free_course_hours_migration m ON m.old_progress_id=p.id AND m.learner_id=p.learner_id
          WHERE p.accepted IS TRUE AND p.deleted_at IS NULL) IS DISTINCT FROM 137310::numeric THEN
        RAISE EXCEPTION 'Post-delete catalogue/hours verification failed';
    END IF;
    RAISE NOTICE 'Verified: 488 ledger rows preserved; 137310 accepted seconds; no completion/enrollment changes; removed % courses',target_count;
END;
$cleanup$;
COMMIT;
