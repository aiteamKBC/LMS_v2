-- Merge the seven authored Programme Expectations activities into the
-- 11 September MSP week, preserving their component IDs and learner progress.
-- Retire only the duplicate, untracked live card and its now-empty week.
-- Order the remaining 16 weeks by their own saved Teams occurrence dates.
-- The source week and card are soft-deleted; historical reward sessions stay
-- untouched, including their original week label.
BEGIN;

DO $$
DECLARE
    module_id constant text := 'MOD-20260930110509069516DE05CBE11E6E';
    series_id constant text := 'LIVE-71DA0E41CC7B4BFB83C9037E35845E21';
    source_id constant text := 'WEEK-20260930110508622KC9DEZ';
    target_id constant text := 'WEEK-202609301105086237YECUN';
    duplicate_id constant text := 'COMP-202610151540280729GJAG5';
    source_week curriculum.weeks%ROWTYPE;
    target_week curriculum.weeks%ROWTYPE;
    n integer;
    linked_count integer;
    occurrence_count integer;
    mapped_week_count integer;
BEGIN
    -- Serialise with normal Module Builder saves, then recheck the live rows.
    PERFORM 1 FROM curriculum.modules
     WHERE module_catalogue_id = module_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MSP module unavailable'; END IF;

    SELECT * INTO source_week FROM curriculum.weeks
     WHERE id = source_id AND module_catalogue_id = module_id
       AND deleted_at IS NULL AND title = 'programme expectations' FOR UPDATE;
    SELECT * INTO target_week FROM curriculum.weeks
     WHERE id = target_id AND module_catalogue_id = module_id
       AND deleted_at IS NULL AND title LIKE 'Week 02:%' FOR UPDATE;
    IF source_week.id IS NULL OR target_week.id IS NULL
       OR source_week.summary NOT LIKE 'Module calendar week 1.%'
       OR source_week.display_order <> 1 OR target_week.display_order <> 2 THEN
        RAISE EXCEPTION 'MSP week structure changed; review before merging';
    END IF;

    SELECT count(*) INTO n FROM curriculum.weeks
     WHERE module_catalogue_id = module_id AND deleted_at IS NULL;
    IF n <> 17 THEN RAISE EXCEPTION 'Expected 17 live MSP weeks; found %', n; END IF;
    SELECT count(*) INTO n FROM curriculum.components
     WHERE module_catalogue_id = module_id AND week_id = source_id AND deleted_at IS NULL;
    IF n <> 8 THEN RAISE EXCEPTION 'MSP source activities changed; found %', n; END IF;
    SELECT count(*) INTO n FROM curriculum.components
     WHERE module_catalogue_id = module_id AND week_id = target_id AND deleted_at IS NULL;
    IF n <> 67 THEN RAISE EXCEPTION 'MSP destination activities changed; found %', n; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM curriculum.components c
         WHERE c.id = duplicate_id AND c.module_catalogue_id = module_id
           AND c.week_id = source_id AND c.deleted_at IS NULL
           AND c.type = 'live_session'
           AND COALESCE(c.settings_json->>'teamsLiveSessionId', '') = ''
           AND COALESCE(c.settings_json->>'teamsOccurrenceId', '') = ''
    ) THEN RAISE EXCEPTION 'MSP duplicate live card changed'; END IF;
    SELECT count(*) INTO n FROM curriculum.ksb_mappings k
     JOIN curriculum.components c ON c.id = k.component_id
     WHERE k.module_catalogue_id = module_id AND k.week_id = source_id
       AND k.deleted_at IS NULL AND c.deleted_at IS NULL
       AND c.week_id = source_id AND c.id <> duplicate_id;
    IF n <> 22 THEN RAISE EXCEPTION 'MSP active KSB mappings changed; found %', n; END IF;

    -- Keep the welcome and guide activities before the existing Principles
    -- content, without changing either group's internal order.
    UPDATE curriculum.components SET display_order = display_order + 7,
           updated_at = now()
     WHERE module_catalogue_id = module_id AND week_id = target_id
       AND deleted_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 67 THEN RAISE EXCEPTION 'MSP destination changed during merge'; END IF;

    UPDATE curriculum.components SET week_id = target_id, updated_at = now()
     WHERE module_catalogue_id = module_id AND week_id = source_id
       AND deleted_at IS NULL AND id <> duplicate_id AND type <> 'live_session'
       AND display_order BETWEEN 0 AND 6;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 7 THEN RAISE EXCEPTION 'MSP source activities changed during merge'; END IF;

    UPDATE curriculum.ksb_mappings k SET week_id = target_id, updated_at = now()
     WHERE k.module_catalogue_id = module_id AND k.week_id = source_id
       AND k.deleted_at IS NULL AND k.component_id IN (
           SELECT c.id FROM curriculum.components c
            WHERE c.module_catalogue_id = module_id AND c.week_id = target_id
              AND c.deleted_at IS NULL AND c.display_order BETWEEN 0 AND 6);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 22 THEN RAISE EXCEPTION 'MSP KSB mapping count changed during merge'; END IF;

    -- Preserve the original prose as an archived before-image. Copy its
    -- substance into the destination without the now-incorrect week-1 label.
    UPDATE curriculum.weeks
       SET summary = target_week.summary || E'\n\nProgramme expectations: ' ||
                     regexp_replace(source_week.summary, '^Module calendar week 1[.] *', '', 'i'),
           learning_outcomes = target_week.learning_outcomes || source_week.learning_outcomes,
           updated_at = now()
     WHERE id = target_id AND module_catalogue_id = module_id;

    UPDATE curriculum.components
       SET deleted_at = now(), deleted_by = 'msp-week-merge',
           deleted_via_parent = NULL, updated_at = now()
     WHERE id = duplicate_id AND module_catalogue_id = module_id
       AND week_id = source_id AND deleted_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'MSP duplicate card changed during merge'; END IF;
    SELECT count(*) INTO n FROM curriculum.components
     WHERE module_catalogue_id = module_id AND week_id = source_id AND deleted_at IS NULL;
    IF n <> 0 THEN RAISE EXCEPTION 'MSP source week still has live content'; END IF;

    UPDATE curriculum.weeks
       SET deleted_at = now(), deleted_by = 'msp-week-merge',
           deleted_via_parent = NULL, updated_at = now()
     WHERE id = source_id AND module_catalogue_id = module_id AND deleted_at IS NULL;

    -- The surviving 16 cards must form a complete one-to-one link to the
    -- 16 scheduled Teams occurrences. Do not rank a partial or duplicate set.
    SELECT count(*), count(DISTINCT o.id), count(DISTINCT w.id)
      INTO linked_count, occurrence_count, mapped_week_count
      FROM curriculum.weeks w
      JOIN curriculum.components c ON c.week_id = w.id
      JOIN curriculum.live_session_occurrences o
        ON o.id = c.settings_json->>'teamsOccurrenceId'
     WHERE w.module_catalogue_id = module_id AND w.deleted_at IS NULL
       AND c.module_catalogue_id = module_id AND c.deleted_at IS NULL
       AND c.type = 'live_session' AND o.live_session_id = series_id
       AND c.settings_json->>'teamsLiveSessionId' = series_id
       AND NULLIF(c.settings_json->>'teamsSessionNumber', '')::integer = o.session_number;
    IF linked_count <> 16 OR occurrence_count <> 16 OR mapped_week_count <> 16 THEN
        RAISE EXCEPTION 'MSP Teams mapping changed: %, %, %',
            linked_count, occurrence_count, mapped_week_count;
    END IF;

    WITH ranked AS (
        SELECT w.id, row_number() OVER (ORDER BY o.scheduled_start, o.id) - 1 AS new_order
          FROM curriculum.weeks w
          JOIN curriculum.components c ON c.week_id = w.id
          JOIN curriculum.live_session_occurrences o
            ON o.id = c.settings_json->>'teamsOccurrenceId'
         WHERE w.module_catalogue_id = module_id AND w.deleted_at IS NULL
           AND c.module_catalogue_id = module_id AND c.deleted_at IS NULL
           AND c.type = 'live_session' AND o.live_session_id = series_id
           AND c.settings_json->>'teamsLiveSessionId' = series_id
           AND NULLIF(c.settings_json->>'teamsSessionNumber', '')::integer = o.session_number
    )
    UPDATE curriculum.weeks w
       SET display_order = ranked.new_order,
           week_number = ranked.new_order + 1,
           updated_at = now()
      FROM ranked WHERE w.id = ranked.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 16 THEN RAISE EXCEPTION 'MSP Teams week mapping incomplete; updated %', n; END IF;

    -- Make the revised structure visible to the LMS's shared authoring cache.
    UPDATE curriculum.cache_epoch SET epoch = epoch + 1 WHERE id = 1;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'Curriculum cache epoch unavailable'; END IF;
END $$;

COMMIT;
