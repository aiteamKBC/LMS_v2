"""Read-only aggregate inspection of canonical Free Course identity availability."""
import json
from verify_inclusion_canonical_targets import connect_development

with connect_development() as db:
    for name, query in {
        'settings_keys': '''SELECT key,count(*) FROM curriculum.free_programme_components c,
            LATERAL jsonb_object_keys(c.settings_json) key GROUP BY key ORDER BY key''',
        'canonical_source_matches': '''SELECT count(*),count(DISTINCT s.canonical_progress_id),
            count(*) FILTER (WHERE p.deleted_at IS NULL),sum(p.actual_seconds) FILTER (WHERE p.accepted AND p.deleted_at IS NULL)
            FROM curriculum.free_programme_components c JOIN "Learner".learner_activity_sources s
            ON s.source_catalog_activity_id::text=c.settings_json->>'legacySourceActivityId'
            JOIN "Learner".learner_progress_entries p ON p.id=s.canonical_progress_id AND p.learner_id=s.learner_id''',
        'direct_links': '''SELECT count(*),count(*) FILTER (WHERE p.deleted_at IS NULL),
            count(*) FILTER (WHERE p.accepted IS TRUE),sum(p.actual_seconds) FILTER (WHERE p.accepted AND p.deleted_at IS NULL)
            FROM "Learner".learner_progress_entries p JOIN curriculum.free_programme_components c
            ON c.id=p.component_ref OR c.id=p.curriculum_component_ref''',
        'source_links': '''SELECT count(*) FROM "Learner".learner_activity_sources s
            JOIN curriculum.free_programme_components c ON c.id=s.curriculum_component_ref''',
        'component_columns': "SELECT column_name FROM information_schema.columns WHERE table_schema='curriculum' AND table_name='free_programme_components'",
        'backup_relations': """SELECT table_schema,table_name FROM information_schema.tables
            WHERE table_schema='refactor_backup' OR table_name ILIKE '%snapshot%'
            OR table_name ILIKE '%historical%component%' ORDER BY 1,2""",
    }.items():
        print(name, json.dumps(db.execute(query).fetchall(), default=str))
    columns = db.execute("""SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns
        WHERE (table_schema='refactor_backup' AND (table_name LIKE '%free_course%' OR table_name LIKE 'fc_%'
        OR table_name LIKE 'safeguarding_%')) OR (table_schema IN ('Learner','curriculum')
        AND table_name IN ('historical_components','learner_progress_historical_components')) ORDER BY 1,2,ordinal_position""").fetchall()
    print('backup_columns', json.dumps(columns))
