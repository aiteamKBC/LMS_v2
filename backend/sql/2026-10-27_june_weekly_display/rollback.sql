-- Restore only the exact audited metadata version; refuse to overwrite newer work.
-- Run inside a verified transaction. No learner/curriculum/meeting changes.
DO $rollback$
DECLARE
    current_payload jsonb;
    saved record;
BEGIN
    SELECT source_payload INTO STRICT current_payload
    FROM curriculum.source_courses WHERE id=965 AND source_course_ref='125608' FOR UPDATE;
    SELECT * INTO STRICT saved FROM curriculum.record_revisions
    WHERE entity_type='source_course_weekly_display' AND entity_id='965'
    ORDER BY revision_no DESC LIMIT 1;
    IF saved.action <> 'configured' OR current_payload IS DISTINCT FROM saved.snapshot->'after' THEN
        RAISE EXCEPTION 'The display metadata changed after this repair; review before rollback';
    END IF;
    UPDATE curriculum.source_courses SET source_payload=saved.snapshot->'before' WHERE id=965;
    INSERT INTO curriculum.record_revisions
        (entity_type,entity_id,revision_no,action,module_catalogue_id,snapshot,changed_fields,actor_type,source,reason)
    VALUES ('source_course_weekly_display','965',saved.revision_no+1,'rolled_back',saved.module_catalogue_id,
            jsonb_build_object('before',current_payload,'after',saved.snapshot->'before'),
            '[{"field":"source_payload.weekly_display"}]'::jsonb,'system','scoped-repair',
            'Rollback of the audited June weekly display metadata');
END
$rollback$;
