"""Branch-verified read-only fingerprints. Outputs hashes/counts, never row data."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

from verify_inclusion_canonical_targets import connect_development
from verify_free_course_identity import verify

ROOT = Path(__file__).resolve().parents[2]


def snapshot():
    report = {}
    with connect_development() as conn:
        report['free_course'] = verify(conn)
        tables = [('curriculum', name) for name in (
            'source_activities', 'source_courses', 'source_lms_activities', 'source_lms_group_activities',
            'source_lms_groups', 'source_lms_raw_pages', 'source_materials', 'tutor_module_notifications', 'quizzes')]
        tables += [('Learner', name) for name in (
            'learner_progress_entries', 'learner_monthly_actual_cache', 'learner_journal_rows',
            'learner_quiz_attempts', 'learner_free_course_quiz_attempts')]
        report['fingerprints'] = {}
        from psycopg import sql
        for schema, name in tables:
            relation = f'"{schema}"."{name}"'
            exists = conn.execute('SELECT to_regclass(%s)', [relation]).fetchone()[0]
            if not exists:
                report['fingerprints'][relation] = {'exists': False}
                continue
            # Sort row hashes, avoiding assumptions about composite primary keys.
            hasher, count = hashlib.sha256(), 0
            with conn.cursor(name='master_fingerprint') as cursor:
                cursor.itersize = 10000
                cursor.execute(sql.SQL('SELECT md5(to_jsonb(t)::text) FROM {} t ORDER BY 1').format(sql.Identifier(schema, name)))
                for row in cursor:
                    hasher.update(row[0].encode()); count += 1
            constraints = conn.execute('''SELECT conname,contype,convalidated,pg_get_constraintdef(oid)
                FROM pg_constraint WHERE conrelid=%s::regclass ORDER BY conname''', [relation]).fetchall()
            report['fingerprints'][relation] = {'count': count, 'sha256_sorted_row_md5': hasher.hexdigest(),
                                                'constraints': constraints}
            print(f'Fingerprint captured: {schema}.{name} ({count} rows)', flush=True)
        report['retired_relations'] = {name: conn.execute('SELECT to_regclass(%s)', [name]).fetchone()[0]
            for name in ['curriculum.quiz_defaults'] + [f'"Learner".{name}' for name in (
                'free_course_hours_migration', 'free_course_hours_migration_additional', 'free_course_hours_migration_remaining')]}
        report['module_hours_tables'] = conn.execute("SELECT tablename FROM pg_tables WHERE schemaname='curriculum' AND tablename LIKE 'module_hours_%' ORDER BY 1").fetchall()
    # Reuse the previously reviewed SELECT-only raw-page audit without rewriting its old evidence.
    path = ROOT / '.local/source-catalogue-audit-20261124/audit_database.py'
    if path.exists():
        spec = importlib.util.spec_from_file_location('source_readonly_audit', path)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        report['source_catalogue'] = module.audit()
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = snapshot()
    args.output.write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')
    print('Read-only Development snapshot saved; no shared writes.')
