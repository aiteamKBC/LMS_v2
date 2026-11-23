-- AUDIT REFERENCE ONLY: user completed the Development cleanup externally.
-- Superseded by verify_free_course_my_learning.py; do not execute this old snapshot.
-- PREPARED ONLY, NOT EXECUTED. Development only; never Production.
-- BLOCKED: 72 activity results reference course 902 memberships; four subject
-- attempts reference course 980 activities. Resolve preservation separately.
-- Do not delete evidence or remove guards to force this transaction to pass.
-- Includes 18 identity-confirmed duplicates; excludes 13 title-only candidates.
-- Keep BOTH hours bridges. Deploy/test the reader first. Take a Development
-- restore point before separately authorized execution with ON_ERROR_STOP=1.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $cleanup$
DECLARE
  source_ids bigint[] := ARRAY[871,901,902,903,904,905,980,996,997,998,1000,1005,1010,1015,1016,1018,2749,2750];
  protected_tables text[] := ARRAY[
    '"Learner".learner_progress_entries','"Learner".learner_free_course_progress',
    '"Learner".learner_free_courses','"Learner".free_course_hours_migration',
    '"Learner".free_course_hours_migration_additional','"Learner".learner_progress_historical_components',
    '"Learner".subject_activity_attempts','"Learner".source_lms_activity_results',
    '"Learner".learner_quiz_answers','"Learner".learner_quiz_chosen_answers',
    '"Learner".learner_quiz_correct_answers','"Learner".learner_quiz_grade_corrections',
    'curriculum.free_courses','curriculum.free_course_weeks','curriculum.free_programme_components',
    'curriculum.quizzes','curriculum.quiz_questions','curriculum.quiz_answers',
    'curriculum.quiz_component_links','curriculum.quiz_course_links','curriculum.source_reading_quiz_pairs'];
  before_hashes jsonb := '{}'::jsonb;
  relation_name text;
  row_hash text;
  evidence_before text;
  history_before text;
BEGIN
  IF current_database()<>'neondb' OR current_setting('neon.branch_id',true)
     IS DISTINCT FROM 'br-raspy-sky-abvs8lq9' THEN
    RAISE EXCEPTION 'Refusing cleanup outside verified Development';
  END IF;
  FOREACH relation_name IN ARRAY protected_tables LOOP
    EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE',relation_name);
  END LOOP;
  LOCK TABLE curriculum.source_courses,curriculum.source_activities,
    "Learner".learner_source_course_memberships,"Learner".learner_activity_sources,
    curriculum.historical_components IN SHARE ROW EXCLUSIVE MODE;

  -- Review every inbound FK, including memberships (not just catalogue FKs).
  -- Full definitions, child and parent tables must match the inspected inventory.
  IF EXISTS (
    WITH expected(child,parent,definition) AS (VALUES
      ('curriculum.source_activities','curriculum.source_courses','FOREIGN KEY (source_course_id) REFERENCES curriculum.source_courses(id) ON DELETE CASCADE'),
      ('curriculum.historical_components','curriculum.source_courses','FOREIGN KEY (source_course_id) REFERENCES curriculum.source_courses(id) ON DELETE SET NULL'),
      ('curriculum.historical_components','curriculum.source_activities','FOREIGN KEY (source_catalog_activity_id) REFERENCES curriculum.source_activities(id) ON DELETE SET NULL'),
      ('"Learner".learner_activity_sources','curriculum.source_activities','FOREIGN KEY (source_catalog_activity_id) REFERENCES curriculum.source_activities(id) ON DELETE SET NULL'),
      ('"Learner".learner_source_course_memberships','curriculum.source_courses','FOREIGN KEY (source_course_id) REFERENCES curriculum.source_courses(id) ON DELETE RESTRICT'),
      ('"Learner".subject_activity_attempts','curriculum.source_activities','FOREIGN KEY (source_activity_fk) REFERENCES curriculum.source_activities(id) ON DELETE RESTRICT'),
      ('"Learner".source_lms_activity_results','"Learner".learner_source_course_memberships','FOREIGN KEY (membership_id) REFERENCES "Learner".learner_source_course_memberships(id) ON DELETE RESTRICT')
    ), actual AS (
      SELECT conrelid::regclass::text child,confrelid::regclass::text parent,pg_get_constraintdef(oid) definition
      FROM pg_constraint WHERE contype='f' AND confrelid IN
        ('curriculum.source_courses'::regclass,'curriculum.source_activities'::regclass,
         '"Learner".learner_source_course_memberships'::regclass)
    ) SELECT 1 FROM ((SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
      UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)) drift
  ) THEN RAISE EXCEPTION 'Foreign key inventory drift; review again'; END IF;

  IF EXISTS (SELECT 1 FROM "Learner".source_lms_activity_results r
      JOIN "Learner".learner_source_course_memberships m ON m.id=r.membership_id
      WHERE m.source_course_id=ANY(source_ids)) OR EXISTS (
      SELECT 1 FROM "Learner".subject_activity_attempts t
      JOIN curriculum.source_activities a ON a.id=t.source_activity_fk
      WHERE a.source_course_id=ANY(source_ids)) THEN
    RAISE EXCEPTION 'BLOCKED: preserve historical results/attempts before catalogue removal';
  END IF;

  IF (SELECT count(*) FROM "Learner".free_course_hours_migration_additional)<>289
    OR EXISTS (SELECT 1 FROM "Learner".free_course_hours_migration_additional m
      LEFT JOIN "Learner".learner_progress_entries p ON p.id=m.old_progress_id AND p.learner_id=m.learner_id
      LEFT JOIN curriculum.free_programme_components a ON a.id=m.free_component_id
      LEFT JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
      WHERE p.id IS NULL OR to_jsonb(p) IS DISTINCT FROM m.original_progress
      OR a.id IS NULL OR w.course_id IS DISTINCT FROM m.free_course_id)
    OR (SELECT sum(p.actual_seconds) FROM "Learner".learner_progress_entries p
      JOIN "Learner".free_course_hours_migration_additional m ON m.old_progress_id=p.id
      WHERE p.accepted IS TRUE AND p.deleted_at IS NULL) IS DISTINCT FROM 68427::numeric
    OR (SELECT count(*) FROM "Learner".learner_progress_entries p
      JOIN "Learner".free_course_hours_migration_additional m ON m.old_progress_id=p.id
      WHERE p.accepted IS TRUE AND p.deleted_at IS NULL)<>54 THEN
    RAISE EXCEPTION 'Additional ledger snapshot/ownership/seconds drift';
  END IF;
  IF EXISTS (SELECT 1 FROM "Learner".learner_activity_sources s
    JOIN curriculum.source_activities a ON a.id=s.source_catalog_activity_id
    WHERE a.source_course_id=ANY(source_ids) AND s.canonical_progress_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Learner".free_course_hours_migration m
      WHERE m.old_progress_id=s.canonical_progress_id AND m.learner_id=s.learner_id)
    AND NOT EXISTS (SELECT 1 FROM "Learner".free_course_hours_migration_additional m
      WHERE m.old_progress_id=s.canonical_progress_id AND m.learner_id=s.learner_id)) THEN
    RAISE EXCEPTION 'Unmapped canonical progress; retain catalogue';
  END IF;
  IF EXISTS (SELECT 1 FROM "Learner".learner_progress_historical_components h
    JOIN curriculum.historical_components a ON a.id=h.historical_component_ref
    WHERE (a.source_course_id=ANY(source_ids) OR a.source_catalog_activity_id IN
      (SELECT id FROM curriculum.source_activities WHERE source_course_id=ANY(source_ids)))
    AND NOT EXISTS (SELECT 1 FROM "Learner".free_course_hours_migration m WHERE m.old_progress_id=h.progress_id)
    AND NOT EXISTS (SELECT 1 FROM "Learner".free_course_hours_migration_additional m WHERE m.old_progress_id=h.progress_id)) THEN
    RAISE EXCEPTION 'Unmapped historical ledger evidence; retain catalogue';
  END IF;
  -- Exact source identities; no title matching in a destructive statement.
  IF (SELECT count(*) FROM curriculum.source_courses s JOIN (VALUES
    (871,'old_lms','90915'),(901,'old_lms','87129'),(902,'old_lms','87435'),
    (903,'old_lms','88351'),(904,'old_lms','88465'),(905,'old_lms','89379'),(980,'old_lms','89537'),
    (996,'new_lms','MOD-2026082201FB8A2E96D3'),(997,'new_lms','MOD-2026082202DCF4E837EF'),
    (998,'new_lms','MOD-202608220A19E33C5552'),(1000,'new_lms','MOD-202608220C12A5ED2D52'),
    (1005,'new_lms','MOD-202608225900AF6B327D'),(1010,'new_lms','MOD-20260822899D822C193B'),
    (1015,'new_lms','MOD-20260822BEAC7D9F6ED6'),(1016,'new_lms','MOD-20260822CF33C7A02E36'),
    (1018,'new_lms','MOD-20260822E35A9F7DFC21'),(2749,'old_lms','168330'),
    (2750,'new_lms','MOD-KBC-ALWI-CONSULTANCY')) e(id,system,ref)
    ON s.id=e.id AND s.source_system=e.system AND s.source_course_ref=e.ref)<>18 THEN
    RAISE EXCEPTION 'Reviewed source identity drift or already cleaned; audit again';
  END IF;

  FOREACH relation_name IN ARRAY protected_tables LOOP
    EXECUTE format('SELECT md5(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY to_jsonb(t)::text)) FROM %s t',relation_name) INTO row_hash;
    before_hashes := before_hashes || jsonb_build_object(relation_name,row_hash);
  END LOOP;
  SELECT md5(string_agg(md5((to_jsonb(t)-'source_catalog_activity_id')::text),''
    ORDER BY (to_jsonb(t)-'source_catalog_activity_id')::text)) INTO evidence_before
    FROM "Learner".learner_activity_sources t;
  SELECT md5(string_agg(md5((to_jsonb(t)-'source_catalog_activity_id'-'source_course_id')::text),''
    ORDER BY (to_jsonb(t)-'source_catalog_activity_id'-'source_course_id')::text)) INTO history_before
    FROM curriculum.historical_components t;

  -- Only catalogue and duplicate memberships. Existing SET NULL actions detach
  -- catalogue references; all historical evidence and original ledger IDs survive.
  DELETE FROM "Learner".learner_source_course_memberships WHERE source_course_id=ANY(source_ids);
  DELETE FROM curriculum.source_activities WHERE source_course_id=ANY(source_ids);
  DELETE FROM curriculum.source_courses WHERE id=ANY(source_ids);

  FOREACH relation_name IN ARRAY protected_tables LOOP
    EXECUTE format('SELECT md5(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY to_jsonb(t)::text)) FROM %s t',relation_name) INTO row_hash;
    IF (before_hashes->>relation_name) IS DISTINCT FROM row_hash THEN
      RAISE EXCEPTION 'Preservation failed for %; rollback required',relation_name;
    END IF;
  END LOOP;
  IF evidence_before IS DISTINCT FROM (SELECT md5(string_agg(md5((to_jsonb(t)-'source_catalog_activity_id')::text),''
    ORDER BY (to_jsonb(t)-'source_catalog_activity_id')::text)) FROM "Learner".learner_activity_sources t)
    OR history_before IS DISTINCT FROM (SELECT md5(string_agg(md5((to_jsonb(t)-'source_catalog_activity_id'-'source_course_id')::text),''
    ORDER BY (to_jsonb(t)-'source_catalog_activity_id'-'source_course_id')::text)) FROM curriculum.historical_components t) THEN
    RAISE EXCEPTION 'Historical evidence changed beyond reviewed catalogue detachment';
  END IF;
  IF EXISTS (SELECT 1 FROM curriculum.source_courses WHERE id=ANY(source_ids))
    OR EXISTS (SELECT 1 FROM curriculum.source_activities WHERE source_course_id=ANY(source_ids))
    OR EXISTS (SELECT 1 FROM "Learner".learner_source_course_memberships WHERE source_course_id=ANY(source_ids)) THEN
    RAISE EXCEPTION 'Catalogue cleanup incomplete';
  END IF;
END;
$cleanup$;
COMMIT;
