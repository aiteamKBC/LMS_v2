-- Run inside the caller's transaction after verifying the configured database.
-- Presentation metadata only: no curriculum, meetings or learner records change.
-- Evidence: original course 125608 inspected read-only on 27 October 2026.
-- It has 19 populated sections; the latest is dated 21 October 2026.
DO $repair$
DECLARE
    previous_payload jsonb;
    next_payload jsonb;
    policy jsonb := '{
      "version": 1,
      "mode": "available-content",
      "moduleId": "MOD-20260822F0AC1422DF9E",
      "cohortId": "APTEM-COHORT-b52bfd08a338facec3acc1dd6c5de8e0",
      "weekDates": {
        "WEEK-20260822E4981A3AC275": "2026-06-09",
        "WEEK-20260822DBC8D7E90D5A": "2026-06-10",
        "WEEK-20260822F30FDE04466B": "2026-06-17",
        "WEEK-2026082234E0059D09EF": "2026-06-24",
        "WEEK-20260822057B0505FA0E": "2026-06-24",
        "WEEK-20260822872400DA6BEF": "2026-07-01",
        "WEEK-2026082279DE8172361E": "2026-07-08",
        "WEEK-20260822CE67EB316F88": "2026-07-15",
        "WEEK-20260822EEADC41418AA": "2026-07-22",
        "WEEK-20260822841CF1D9C7CF": "2026-08-12",
        "WEEK-20260822D7F5068953DB": "2026-08-19",
        "WEEK-OLDLMS-125608-2048": "2026-08-26",
        "WEEK-OLDLMS-125608-2064": "2026-09-02",
        "WEEK-OLDLMS-125608-2075": "2026-09-09",
        "WEEK-OLDLMS-125608-2310": "2026-09-16",
        "WEEK-OLDLMS-125608-3472": "2026-09-23",
        "WEEK-OLDLMS-125608-3668": "2026-10-07",
        "WEEK-OLDLMS-125608-3705": "2026-10-14",
        "WEEK-2026102208045634692157EAD7BEB153": "2026-10-21"
      }
    }'::jsonb;
    affected integer;
BEGIN
    SELECT source_payload INTO STRICT previous_payload
    FROM curriculum.source_courses
    WHERE id=965 AND source_system='old_lms' AND source_course_ref='125608'
      AND curriculum_module_ref=policy->>'moduleId' AND deleted_at IS NULL
    FOR UPDATE;
    IF previous_payload->'weekly_display' = policy THEN
        RETURN; -- Re-running the same change is a no-op.
    END IF;
    IF previous_payload ? 'weekly_display' THEN
        RAISE EXCEPTION 'A different weekly display configuration already exists';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM curriculum.cohorts
        WHERE cohort_id=policy->>'cohortId' AND cohort_name='Jun 2026'
          AND programme_id='PROG-PCP-L6' AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'The target cohort no longer matches the verified scope';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM curriculum.modules
        WHERE module_catalogue_id=policy->>'moduleId' AND deleted_at IS NULL
          AND source_type='mba-legacy' AND source_id='125608'
          AND cohort_id=policy->>'cohortId'
    ) THEN
        RAISE EXCEPTION 'The target module source identity changed';
    END IF;
    SELECT count(*) INTO affected FROM curriculum.weeks w
    WHERE w.module_catalogue_id=policy->>'moduleId' AND w.deleted_at IS NULL
      AND policy->'weekDates' ? w.id
      AND EXISTS (SELECT 1 FROM curriculum.components c WHERE c.week_id=w.id AND c.deleted_at IS NULL);
    IF affected <> 19 THEN
        RAISE EXCEPTION 'Expected 19 populated source weeks, found %', affected;
    END IF;
    IF EXISTS (SELECT 1 FROM curriculum.live_sessions WHERE module_catalogue_id=policy->>'moduleId') THEN
        RAISE EXCEPTION 'This module now has meetings; recheck the display-only scope';
    END IF;
    next_payload := previous_payload || jsonb_build_object('weekly_display',policy);
    INSERT INTO curriculum.record_revisions
        (entity_type,entity_id,revision_no,action,module_catalogue_id,snapshot,changed_fields,actor_type,source,reason)
    SELECT 'source_course_weekly_display','965',coalesce(max(revision_no),0)+1,'configured',policy->>'moduleId',
           jsonb_build_object('before',previous_payload,'after',next_payload),
           '[{"field":"source_payload.weekly_display"}]'::jsonb,'system','scoped-repair',
           'Owner requested June content-only weekly display and verified source dates; preserve learner evidence'
    FROM curriculum.record_revisions WHERE entity_type='source_course_weekly_display' AND entity_id='965';
    UPDATE curriculum.source_courses SET source_payload=next_payload
    WHERE id=965 AND source_payload=previous_payload;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'The source metadata changed concurrently';
    END IF;
END
$repair$;
