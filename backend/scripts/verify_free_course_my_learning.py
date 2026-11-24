"""Read-only Development baseline for unified My Learning. Never migrates data."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.verify_inclusion_canonical_targets import connect_development
from learner_api.free_course_hours import HOURS_SQL, activity_seconds

BRIDGES = ('free_course_hours_migration','free_course_hours_migration_additional','free_course_hours_migration_remaining')
MAPPINGS = ' UNION ALL '.join(f'SELECT old_progress_id,learner_id,free_course_id,free_component_id FROM "Learner".{name}' for name in BRIDGES)


def verify(c):
    counts = c.execute('''SELECT
      (SELECT count(*) FROM curriculum.free_courses),
      (SELECT count(*) FROM "Learner".learner_free_courses),
      (SELECT count(DISTINCT learner_id) FROM "Learner".learner_free_courses),
      (SELECT count(DISTINCT free_course_ref) FROM "Learner".learner_free_courses),
      (SELECT count(*) FROM "Learner".learner_free_course_progress),
      (SELECT count(*) FROM "Learner".learner_free_course_progress WHERE status='active' AND deleted_at IS NULL)''').fetchone()
    invalid = c.execute('''SELECT
      (SELECT count(*) FROM (SELECT learner_id,free_course_ref FROM "Learner".learner_free_courses GROUP BY 1,2 HAVING count(*)>1) x),
      (SELECT count(*) FROM "Learner".learner_free_course_progress p
       LEFT JOIN "Learner".learners l ON l.id=p.learner_id
       LEFT JOIN curriculum.free_programme_components a ON a.id=p.component_ref
       LEFT JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
       LEFT JOIN curriculum.free_courses f ON f.id=p.free_course_ref
       WHERE l.id IS NULL OR a.id IS NULL OR f.id IS NULL OR w.course_id IS DISTINCT FROM p.free_course_ref),
      (SELECT count(*) FROM "Learner".learner_free_course_progress p WHERE p.status='active' AND p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM "Learner".learner_free_courses e WHERE e.learner_id=p.learner_id AND e.free_course_ref=p.free_course_ref))''').fetchone()
    assert invalid == (0,0,0), 'Assignment/progress ownership inconsistency'
    bridge_counts = {}
    for name in BRIDGES:
        row = c.execute(f'''SELECT count(*),count(*) FILTER(WHERE p.id IS NULL),
          count(*) FILTER(WHERE to_jsonb(p) IS DISTINCT FROM m.original_progress)
          FROM "Learner".{name} m LEFT JOIN "Learner".learner_progress_entries p
          ON p.id=m.old_progress_id AND p.learner_id=m.learner_id''').fetchone()
        assert row[1:] == (0,0), 'Missing or changed historical ledger snapshot'
        bridge_counts[name] = row[0]
    ledger = c.execute('WITH m AS ('+MAPPINGS+''') SELECT count(*),count(DISTINCT m.old_progress_id),
      count(*) FILTER(WHERE p.accepted AND p.deleted_at IS NULL),
      coalesce(sum(p.actual_seconds) FILTER(WHERE p.accepted AND p.deleted_at IS NULL),0),
      count(*) FILTER(WHERE p.deleted_at IS NOT NULL)
      FROM m JOIN "Learner".learner_progress_entries p ON p.id=m.old_progress_id AND p.learner_id=m.learner_id''').fetchone()
    assert ledger[0] == ledger[1], 'Duplicate cross-bridge ledger identity'
    ownership = c.execute('WITH m AS ('+MAPPINGS+''') SELECT count(*) FROM m
      LEFT JOIN curriculum.free_programme_components a ON a.id=m.free_component_id
      LEFT JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
      WHERE a.id IS NULL OR w.course_id IS DISTINCT FROM m.free_course_id''').fetchone()[0]
    assert ownership == 0, 'Historical bridge has invalid canonical component ownership'
    all_courses = [row[0] for row in c.execute('SELECT id FROM curriculum.free_courses')]
    owners = [row[0] for row in c.execute('SELECT DISTINCT learner_id FROM "Learner".learner_free_courses')]
    bulk_sql = HOURS_SQL.replace('m.learner_id=%s', 'm.learner_id=ANY(%s)')
    visible = sum(activity_seconds(c.execute(bulk_sql,[owners,all_courses]).fetchall()).values())
    withdrawn = c.execute('SELECT count(*) FROM "Learner".learner_free_courses WHERE learner_id=1000').fetchone()[0]
    unassigned = [row[0] for row in c.execute('''SELECT id FROM curriculum.free_courses f WHERE NOT EXISTS
      (SELECT 1 FROM "Learner".learner_free_courses e WHERE e.learner_id=1000 AND e.free_course_ref=f.id)''')]
    assert not c.execute(HOURS_SQL,[1000,unassigned]).fetchall(), 'Historical hours must not grant unassigned access'
    duplicates = c.execute('''SELECT count(*) FROM curriculum.source_courses s WHERE s.source_system='old_lms'
      AND EXISTS (SELECT 1 FROM curriculum.free_courses f
        WHERE lower(regexp_replace(trim(f.course_name),'\\s+',' ','g'))=lower(regexp_replace(trim(s.source_course_title),'\\s+',' ','g')))''').fetchone()[0]
    assert duplicates == 0, 'Old LMS exact normalized title duplicates remain'
    fingerprints = {}
    for table in ('learner_free_courses','learner_free_course_progress','subject_activity_attempts',
                  'learner_quiz_answers','learner_quiz_chosen_answers','learner_quiz_correct_answers'):
        fingerprints[table] = c.execute(f'''SELECT count(*),md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY to_jsonb(t)::text)) FROM "Learner".{table} t''').fetchone()
    attempt_columns = dict(c.execute('''SELECT column_name,is_nullable FROM information_schema.columns
      WHERE table_schema='Learner' AND table_name='subject_activity_attempts' ''').fetchall())
    needs_migration = any(attempt_columns.get(field) != 'YES' for field in ('enrolment_id','aptem_id','group_id','activity_id'))
    quiz_counts = c.execute('''SELECT count(*),count(*) FILTER(WHERE q.id IS NULL),
      count(*) FILTER(WHERE q.status='published') FROM curriculum.free_programme_components a
      JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
      LEFT JOIN curriculum.quizzes q ON q.id=CASE WHEN a.settings_json->>'linkedQuizId' ~ '^[0-9]+$'
        THEN (a.settings_json->>'linkedQuizId')::bigint END
      WHERE a.type ILIKE '%quiz%' AND a.deleted_at IS NULL AND w.deleted_at IS NULL AND w.status='active' ''').fetchone()
    return dict(courses=counts[0],assignments=counts[1],assigned_learners=counts[2],assigned_courses=counts[3],
                progress_records=counts[4],active_progress=counts[5],bridges=bridge_counts,
                historical_records=ledger[0],active_accepted_records=ledger[2],accepted_seconds=int(ledger[3]),
                deleted_history_preserved=ledger[4],visible_enrolled_seconds=visible,
                canonical_attempt_write_migration_required=needs_migration,
                withdrawn_learner_existing_assignments=withdrawn,
                quiz_activities=quiz_counts[0],quiz_activities_without_linked_quiz=quiz_counts[1],published_quiz_activities=quiz_counts[2],
                orphaned_or_duplicate_records=list(invalid),old_lms_title_duplicates=duplicates,
                preservation_fingerprints=fingerprints)


if __name__ == '__main__':
    connection = connect_development()
    try:
        print(json.dumps(verify(connection),sort_keys=True))
    finally:
        connection.rollback()
        connection.close()
