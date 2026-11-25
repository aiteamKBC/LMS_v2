"""Read-only installed schema/trigger and protected evidence verification."""
import argparse
import json
from pathlib import Path
from verify_inclusion_canonical_targets import connect_development


def read():
    with connect_development() as c:
        report = {}
        report['module_hours_triggers'] = c.execute('''SELECT n.nspname,t.relname,g.tgname,pg_get_triggerdef(g.oid)
            FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname='curriculum' AND t.relname IN ('module_hours_targets','module_hours_access','module_hours_audit')
            AND NOT g.tgisinternal ORDER BY 1,2,3''').fetchall()
        report['identity_indexes'] = c.execute('''SELECT indexname,indexdef FROM pg_indexes
            WHERE schemaname='Learner' AND tablename='learner_progress_entries' AND indexname LIKE 'lpe_free_%%'
            ORDER BY indexname''').fetchall()
        report['evidence_fingerprints'] = {}
        from psycopg import sql
        for name in ('evidence_files', 'Evidence'):
            if not c.execute('SELECT to_regclass(%s)', [f'"Learner"."{name}"']).fetchone()[0]:
                report['evidence_fingerprints'][name] = {'exists': False}
                continue
            report['evidence_fingerprints'][name] = c.execute(sql.SQL('''SELECT count(*),md5(string_agg(h,'' ORDER BY h))
                FROM (SELECT md5(to_jsonb(t)::text) h FROM {} t) rows''').format(sql.Identifier('Learner', name))).fetchone()
        report['quiz_settings_counts'] = c.execute('''SELECT count(*),count(*) FILTER(WHERE grade_settings IS NOT NULL),
            count(*) FILTER(WHERE policy_enabled),count(*) FILTER(WHERE attempt_limit IS NULL) FROM curriculum.quizzes''').fetchone()
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); result = read()
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))
