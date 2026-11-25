"""Read-only Development evidence; emits counts and fingerprints, never learner data."""
import json
import sys
from pathlib import Path
from verify_inclusion_canonical_targets import connect_development


def verify():
    with connect_development() as db:
        result = {'identity': db.execute("SELECT current_database(),current_setting('neon.branch_id'),current_setting('transaction_read_only')").fetchone()}
        names = ['curriculum.quiz_defaults'] + ['"Learner".' + name for name in (
            'free_course_hours_migration', 'free_course_hours_migration_additional', 'free_course_hours_migration_remaining')]
        result['existence'] = {name: db.execute('SELECT to_regclass(%s)::text', [name]).fetchone()[0] for name in names}
        result['quizzes'] = db.execute('''SELECT count(*),count(*) FILTER (WHERE policy_enabled),
            count(*) FILTER (WHERE NOT policy_enabled),count(*) FILTER (WHERE grade_settings IS NOT NULL),
            md5(string_agg(to_jsonb(q)::text,'|' ORDER BY id)) FROM curriculum.quizzes q''').fetchone()
        result['columns'] = db.execute("""SELECT table_name,column_name FROM information_schema.columns
            WHERE table_schema='Learner' AND table_name IN ('learner_progress_entries','learner_activity_sources',
            'learner_free_course_progress','free_course_hours_migration') ORDER BY table_name,ordinal_position""").fetchall()
        for table in ('quiz_questions','quiz_answers'):
            result[table] = db.execute(f"SELECT count(*),md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)) FROM curriculum.{table} t").fetchone()
        result['migration_rows'] = {name: db.execute(f'SELECT count(*) FROM {name}').fetchone()[0]
            for name in names[1:] if result['existence'][name]}
        for table in ('learner_progress_entries', 'learner_activity_sources', 'subject_activity_attempts',
                      'learner_free_course_progress', 'learner_progress_historical_components'):
            result[table] = db.execute(f'''SELECT count(*),md5(string_agg(fingerprint,'' ORDER BY fingerprint))
                FROM (SELECT md5(to_jsonb(t)::text) AS fingerprint FROM "Learner".{table} t) rows''').fetchone()
        result['completed_hours'] = db.execute('''SELECT count(*),md5(string_agg(
            md5(jsonb_build_array(id,completed_hours)::text),'' ORDER BY id)) FROM "Learner".learners''').fetchone()
        return result


if __name__ == '__main__':
    result = verify()
    path = Path(sys.argv[1])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
