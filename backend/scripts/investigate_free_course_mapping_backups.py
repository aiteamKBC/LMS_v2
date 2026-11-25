"""SELECT-only recovery counts; no raw snapshots or learner identities are exported."""
import json
from pathlib import Path
from verify_inclusion_canonical_targets import connect_development

TABLES = {
    'free_course_migration_20261110': ('legacy_progress_id', 'free_course_id', 'free_component_id'),
    'fc_895_mapping_20261112': ('legacy_progress_id', 'free_course_ref', 'free_component_ref'),
    'safeguarding_free_progress_migration_20261112': ('legacy_progress_id', 'free_course_id', 'free_component_id'),
    'safeguarding_holly_inactive_20261112': ('legacy_progress_id', 'free_course_id', 'free_component_id'),
    'safeguarding_quiz_migration_20261112': ('legacy_progress_id', 'free_course_id', 'free_component_id'),
}


def investigate():
    report = {}
    with connect_development() as db:
        for table, (progress, course, component) in TABLES.items():
            report[table] = db.execute(f'''SELECT count(*),count(DISTINCT m.{progress}),
                count(*) FILTER (WHERE p.id IS NULL),count(*) FILTER (WHERE c.id IS NULL),
                count(*) FILTER (WHERE p.learner_id IS DISTINCT FROM m.learner_id),
                count(*) FILTER (WHERE w.course_id IS DISTINCT FROM m.{course})
                FROM refactor_backup.{table} m
                LEFT JOIN "Learner".learner_progress_entries p ON p.id=m.{progress}
                LEFT JOIN curriculum.free_programme_components c ON c.id=m.{component}
                LEFT JOIN curriculum.free_course_weeks w ON w.id=c.free_module_id''').fetchone()
        union = ' UNION '.join(f'SELECT {p} AS progress_id,learner_id,{c} AS course_id,{a} AS component_id FROM refactor_backup.{t}'
                               for t,(p,c,a) in TABLES.items())
        report['union'] = db.execute('WITH mappings AS (' + union + ''') SELECT count(*),count(DISTINCT progress_id),
            count(*) FILTER (WHERE p.id IS NOT NULL AND c.id IS NOT NULL AND p.learner_id=m.learner_id AND w.course_id=m.course_id),
            count(*) FILTER (WHERE p.deleted_at IS NOT NULL),
            coalesce(sum(p.actual_seconds) FILTER (WHERE p.deleted_at IS NULL AND p.accepted),0)
            FROM mappings m LEFT JOIN "Learner".learner_progress_entries p ON p.id=m.progress_id
            LEFT JOIN curriculum.free_programme_components c ON c.id=m.component_id
            LEFT JOIN curriculum.free_course_weeks w ON w.id=c.free_module_id''').fetchone()
        report['ambiguous_progress_ids'] = db.execute('WITH mappings AS ('+union+''')
            SELECT count(*) FROM (SELECT progress_id FROM mappings GROUP BY progress_id HAVING count(*)>1) ambiguous''').fetchone()[0]
        report['snapshot_sources'] = db.execute("""SELECT table_name,column_name FROM information_schema.columns
            WHERE (column_name IN ('old_progress_id','legacy_progress_id','free_component_id','free_course_id','original_progress','original_record'))
            AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2""").fetchall()
        report['canonical_key_recovery'] = db.execute('''WITH candidates AS (
            SELECT m.legacy_progress_id, count(DISTINCT p.id) AS matches
            FROM refactor_backup.fc_895_mapping_20261112 m
            JOIN refactor_backup.fc_895_progress_20261112 b ON b.id=m.legacy_progress_id
            LEFT JOIN "Learner".learner_progress_entries p ON p.learner_id=m.learner_id
              AND NULLIF(b.canonical_activity_key,'') IS NOT NULL AND p.canonical_activity_key=b.canonical_activity_key
            GROUP BY m.legacy_progress_id)
            SELECT count(*),count(*) FILTER (WHERE matches=1),count(*) FILTER (WHERE matches>1),
                   count(*) FILTER (WHERE matches=0) FROM candidates''').fetchone()
        report['canonical_source_recovery'] = db.execute('''WITH candidates AS (
            SELECT m.legacy_progress_id, count(DISTINCT p.id) AS matches
            FROM refactor_backup.fc_895_mapping_20261112 m
            JOIN refactor_backup.fc_895_progress_20261112 b ON b.id=m.legacy_progress_id
            LEFT JOIN "Learner".learner_progress_entries p ON p.learner_id=m.learner_id
              AND NULLIF(b.source_activity_id,'') IS NOT NULL AND p.source_activity_id=b.source_activity_id
              AND p.source_system=b.source_system AND p.source_attempt_key IS NOT DISTINCT FROM b.source_attempt_key
            GROUP BY m.legacy_progress_id)
            SELECT count(*),count(*) FILTER (WHERE matches=1),count(*) FILTER (WHERE matches>1),
                   count(*) FILTER (WHERE matches=0) FROM candidates''').fetchone()
        report['historical_component_links'] = db.execute('''SELECT count(*) FROM "Learner".learner_progress_historical_components h
            JOIN curriculum.historical_components c ON c.id=h.historical_component_ref
            JOIN curriculum.free_programme_components f ON f.settings_json->>'legacySourceActivityId'=c.source_catalog_activity_id::text''').fetchone()[0]
        report['current_free_course_scope'] = db.execute('''SELECT count(*),count(DISTINCT learner_id),count(DISTINCT free_course_ref)
            FROM "Learner".learner_free_courses''').fetchone()
        report['attempt_identity_counts'] = db.execute('''SELECT count(*),count(*) FILTER (WHERE free_component_ref IS NOT NULL),
            count(*) FILTER (WHERE free_component_ref IS NULL AND source_activity_fk IS NOT NULL)
            FROM "Learner".subject_activity_attempts''').fetchone()
        report['ledger_free_course_payload_mentions'] = db.execute('''SELECT count(*) FROM "Learner".learner_progress_entries
            WHERE source_payload::text LIKE '%FREECOURSE%' ''').fetchone()[0]
        report['original_790_manifest_available'] = False
        report['original_790_recovery_status'] = 'Unverifiable: no surviving manifest identifies the original 790 progress-to-Free-Course pairs; backup counts refer to a different historical population.'
    return report


if __name__ == '__main__':
    report = investigate()
    Path('specs/remove-quiz-defaults/free-course-backup-counts.json').write_text(json.dumps(report,indent=2,default=str),encoding='utf-8')
    print(json.dumps(report,default=str))
