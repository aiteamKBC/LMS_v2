"""SELECT-only review of named Free Course migrations and their recorded ancestry."""
import importlib
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify_inclusion_canonical_targets import connect_development


def main():
    conn = connect_development()
    try:
        applied = set(conn.execute('SELECT app,name FROM django_migrations').fetchall())
        pending, seen = [], set()
        def visit(key):
            if key in applied or key in seen:
                return
            seen.add(key)
            module = importlib.import_module('.'.join([key[0], 'migrations', key[1]]))
            for dependency in module.Migration.dependencies:
                visit(dependency)
            pending.append(key)
        visit(('learner_api','0030_canonical_free_course_attempts'))
        columns = conn.execute("""SELECT table_schema,table_name,column_name,data_type,is_nullable,is_generated
            FROM information_schema.columns WHERE
            (table_schema='Learner' AND table_name IN ('subject_activity_attempts','learner_free_course_progress',
             'free_course_hours_migration','free_course_hours_migration_additional','free_course_hours_migration_remaining'))
            OR (table_schema='curriculum' AND table_name='free_course_weeks')
            ORDER BY table_schema,table_name,ordinal_position""").fetchall()
        constraints = conn.execute("""SELECT conname,pg_get_constraintdef(oid),convalidated
            FROM pg_constraint WHERE conrelid='"Learner".subject_activity_attempts'::regclass ORDER BY conname""").fetchall()
        migration = importlib.import_module('learner_api.migrations.0030_canonical_free_course_attempts')
        condition = migration.SQL.split('CHECK (',1)[1].split(');',1)[0]
        incompatible = conn.execute('SELECT count(*) FROM "Learner".subject_activity_attempts WHERE NOT ('+condition+')').fetchone()[0]
        report = dict(unrecorded_migrations=pending, columns=columns, attempt_constraints=constraints,
                      existing_attempts_violating_0030=incompatible,
                      persistent_application='BLOCKED: unrecorded prerequisites include non-idempotent installed schema and storage cutover; no replay or fake applied')
        path = Path(__file__).resolve().parents[2] / 'specs/free-course-state-alignment/migration-review-2026-11-23.json'
        path.write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps({'unrecorded_migrations':len(pending),'prerequisites':max(len(pending)-2,0),
                          'existing_attempts_violating_0030':incompatible,'report':str(path),'writes':0}))
    finally:
        conn.rollback()
        conn.close()


if __name__ == '__main__':
    main()
