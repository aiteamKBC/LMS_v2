"""Read-only Development audit. Never executes the prepared cleanup transaction."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.verify_inclusion_canonical_targets import connect_development
from learner_api.free_course_hours import HOURS_SQL, SUPPORTED_COURSES, activity_seconds

BRIDGE = '''SELECT old_progress_id,learner_id,free_course_id,free_component_id
 FROM "Learner".free_course_hours_migration UNION
 SELECT old_progress_id,learner_id,free_course_id,free_component_id
 FROM "Learner".free_course_hours_migration_additional'''

# Titles discover candidates only. Confirmation uses reviewed ledger mappings,
# canonical module IDs, migration backup identities or explicit source metadata.
CANDIDATES = '''SELECT DISTINCT s.id,s.source_system,s.source_course_ref,f.id
 FROM curriculum.source_courses s JOIN curriculum.free_courses f ON
 lower(trim(s.source_course_title))=lower(trim(f.course_name))
 OR EXISTS (SELECT 1 FROM "Learner".free_course_hours_migration_additional m
            WHERE m.old_course_id=s.id AND m.free_course_id=f.id)
 OR (s.source_system='new_lms' AND f.id IN ('FREECOURSE-MM-'||s.source_course_ref,
 'FREECOURSE-MBA-'||s.source_course_ref)) ORDER BY s.id,f.id'''

FK_SQL = '''SELECT conname,conrelid::regclass::text,confrelid::regclass::text,
 pg_get_constraintdef(oid) FROM pg_constraint WHERE contype='f' AND confrelid IN
 ('curriculum.source_courses'::regclass,'curriculum.source_activities'::regclass,
 '"Learner".learner_source_course_memberships'::regclass) ORDER BY conname'''


def verify(c):
    baseline = c.execute('''SELECT count(*),count(*) FILTER(WHERE p.deleted_at IS NULL AND p.accepted),
      sum(p.actual_seconds) FILTER(WHERE p.deleted_at IS NULL AND p.accepted),
      count(*) FILTER(WHERE p.deleted_at IS NOT NULL),
      count(*) FILTER(WHERE to_jsonb(p)=m.original_progress)
      FROM "Learner".free_course_hours_migration_additional m
      LEFT JOIN "Learner".learner_progress_entries p ON p.id=m.old_progress_id AND p.learner_id=m.learner_id''').fetchone()
    assert baseline == (289,54,68427,120,289), 'Additional ledger snapshot drift'
    assert c.execute('SELECT count(*) FROM curriculum.free_courses').fetchone()[0] == 28
    conflicts = c.execute('WITH m AS ('+BRIDGE+''') SELECT count(*) FROM
      (SELECT old_progress_id FROM m GROUP BY old_progress_id HAVING count(*)>1) x''').fetchone()[0]
    assert conflicts == 0, 'Conflicting ledger attribution'
    invalid = c.execute('WITH m AS ('+BRIDGE+''') SELECT count(*) FROM m
      LEFT JOIN curriculum.free_programme_components a ON a.id=m.free_component_id
      LEFT JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
      WHERE a.id IS NULL OR w.course_id IS DISTINCT FROM m.free_course_id''').fetchone()[0]
    assert invalid == 0, 'Missing canonical component ownership'
    pairs = set(c.execute('SELECT DISTINCT old_course_id,free_course_id FROM "Learner".free_course_hours_migration_additional').fetchall())
    backups = set(c.execute('SELECT DISTINCT old_module_ref,free_course_id FROM refactor_backup.free_course_migration_20261110').fetchall())
    metadata = set(c.execute('''SELECT DISTINCT a.settings_json->>'masterstudy_course_id',w.course_id
      FROM curriculum.free_programme_components a JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
      WHERE a.settings_json->>'masterstudy_course_id' IS NOT NULL''').fetchall())
    confirmed, unresolved = [], []
    for source, system, ref, course in c.execute(CANDIDATES):
        evidence = ((source,course) in pairs or
                    (system=='old_lms' and (ref,course) in metadata) or
                    (system=='new_lms' and ((ref,course) in backups or
                     course in ('FREECOURSE-MM-'+ref,'FREECOURSE-MBA-'+ref) or
                     (ref=='MOD-KBC-ALWI-CONSULTANCY' and course=='FREECOURSE-KBC-ALWI-CONSULTANCY'))))
        (confirmed if evidence else unresolved).append([source,system,ref,course])
    ids = [row[0] for row in confirmed]
    dependencies = c.execute('''SELECT
      (SELECT count(*) FROM curriculum.source_activities WHERE source_course_id=ANY(%s)),
      (SELECT count(*) FROM "Learner".learner_source_course_memberships WHERE source_course_id=ANY(%s)),
      (SELECT count(*) FROM "Learner".source_lms_activity_results r JOIN "Learner".learner_source_course_memberships m
       ON m.id=r.membership_id WHERE m.source_course_id=ANY(%s)),
      (SELECT count(*) FROM "Learner".subject_activity_attempts t JOIN curriculum.source_activities a
       ON a.id=t.source_activity_fk WHERE a.source_course_id=ANY(%s))''',[ids]*4).fetchone()
    unmapped = c.execute('WITH m AS ('+BRIDGE+''') SELECT count(*) FROM "Learner".learner_activity_sources s
      JOIN curriculum.source_activities a ON a.id=s.source_catalog_activity_id
      WHERE a.source_course_id=ANY(%s) AND s.canonical_progress_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM m WHERE m.old_progress_id=s.canonical_progress_id AND m.learner_id=s.learner_id)''',[ids]).fetchone()[0]
    owners = c.execute('WITH m AS ('+BRIDGE+') SELECT DISTINCT learner_id FROM m').fetchall()
    visible_seconds = 0
    for (owner,) in owners:
        actual = activity_seconds(c.execute(HOURS_SQL,[owner,sorted(SUPPORTED_COURSES)]).fetchall())
        expected = c.execute('WITH m AS ('+BRIDGE+''') SELECT coalesce(sum(p.actual_seconds),0)
          FROM m JOIN "Learner".learner_progress_entries p ON p.id=m.old_progress_id AND p.learner_id=m.learner_id
          JOIN curriculum.free_programme_components a ON a.id=m.free_component_id AND a.deleted_at IS NULL
          JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id AND w.course_id=m.free_course_id
          WHERE m.learner_id=%s AND w.deleted_at IS NULL AND w.status='active'
          AND p.accepted IS TRUE AND p.deleted_at IS NULL AND EXISTS
          (SELECT 1 FROM "Learner".learner_free_courses e WHERE e.learner_id=m.learner_id AND e.free_course_ref=m.free_course_id)''',[owner]).fetchone()[0]
        assert sum(actual.values()) == expected, 'Enrolled ledger attribution differs'
        visible_seconds += sum(actual.values())
    fingerprints = {}
    for table in ('"Learner".learner_free_courses','"Learner".learner_free_course_progress',
                  '"Learner".learner_quiz_answers','"Learner".learner_quiz_chosen_answers',
                  '"Learner".learner_quiz_correct_answers','"Learner".learner_quiz_grade_corrections',
                  'curriculum.free_courses','curriculum.free_course_weeks','curriculum.free_programme_components'):
        fingerprints[table] = c.execute('SELECT count(*),md5(string_agg(md5(to_jsonb(t)::text),\'\' ORDER BY to_jsonb(t)::text)) FROM '+table+' t').fetchone()
    return dict(additional_records=baseline[0],active_accepted_records=baseline[1],accepted_seconds=int(baseline[2]),
                soft_deleted_preserved=baseline[3],unchanged_original_rows=baseline[4],canonical_courses=28,
                conflicting_mappings=conflicts,invalid_component_owners=invalid,
                confirmed=confirmed,unresolved_title_candidates=unresolved,foreign_keys=c.execute(FK_SQL).fetchall(),
                dependencies=dict(activities=dependencies[0],memberships=dependencies[1],membership_results=dependencies[2],subject_attempts=dependencies[3]),
                unmapped_ledger_sources=unmapped,visible_enrolled_seconds=visible_seconds,
                preservation_fingerprints=fingerprints)


if __name__ == '__main__':
    connection = connect_development()
    try:
        print(json.dumps(verify(connection),sort_keys=True))
    finally:
        connection.rollback()
        connection.close()
