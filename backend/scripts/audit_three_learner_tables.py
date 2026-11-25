"""Read-only Development integrity and complete historical hash diagnostics.

Print aggregates only. Never export snapshot contents or learner identities.
An encoding match is evidence, not proof of an original writer's contract.
"""
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sys

from verify_inclusion_canonical_targets import connect_development

TABLES = ('source_lms_attendance', 'learner_attendance_details', 'learner_month_restore_points')


def main():
    with connect_development() as db:
        report = {'branch': 'br-raspy-sky-abvs8lq9', 'read_only': True}
        schema = {}
        for table in TABLES:
            rel = f'"Learner".{table}'
            report[table] = db.execute(f'''SELECT count(*),count(*) FILTER (WHERE NOT EXISTS
                (SELECT 1 FROM "Learner".learners l WHERE l.id=t.learner_id)),
                md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text))) FROM {rel} t''').fetchone()
            schema[table] = {
                'columns': db.execute('''SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
                    pg_get_expr(d.adbin,d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d
                    ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=%s::regclass
                    AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum''', [rel]).fetchall(),
                'constraints': db.execute('''SELECT conname,contype,pg_get_constraintdef(oid),convalidated
                    FROM pg_constraint WHERE conrelid=%s::regclass AND contype<>'n' ''', [rel]).fetchall(),
                'indexes': db.execute('''SELECT c.relname,pg_get_indexdef(i.indexrelid)
                    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=%s::regclass''', [rel]).fetchall(),
                'triggers': db.execute('''SELECT pg_get_triggerdef(oid),tgfoid::regprocedure::text,tgenabled
                    FROM pg_trigger WHERE tgrelid=%s::regclass AND NOT tgisinternal''', [rel]).fetchall(),
            }
        report['indexes'] = db.execute('''SELECT count(*),count(*) FILTER(WHERE indisvalid AND indisready)
            FROM pg_index WHERE indrelid=ANY(%s::regclass[])''', [[f'"Learner".{t}' for t in TABLES]]).fetchone()
        report['fk_indexes'] = db.execute('''SELECT count(*),count(*) FILTER(WHERE EXISTS(
            SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indisready
            AND i.indpred IS NULL AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1] @> c.conkey))
            FROM pg_constraint c WHERE c.contype='f' AND c.conrelid=ANY(%s::regclass[])''',
            [[f'"Learner".{t}' for t in TABLES]]).fetchone()
        report['progress_links'] = db.execute('''SELECT count(*),count(*) FILTER(WHERE a.source_key IS NULL
            OR a.learner_id<>p.learner_id OR a.aptem_id IS DISTINCT FROM l.aptem_id),
            md5(string_agg(md5(jsonb_build_array(p.id,p.learner_id,p.kbc_attendance_key)::text),'' ORDER BY p.id))
            FROM "Learner".learner_progress_entries p LEFT JOIN "Learner".source_lms_attendance a
            ON a.source_key=p.kbc_attendance_key LEFT JOIN "Learner".learners l ON l.id=p.learner_id
            WHERE p.kbc_attendance_key IS NOT NULL''').fetchone()
        report['historical_month_exceptions'] = db.execute('''SELECT count(*) FROM "Learner".learner_month_restore_points
            WHERE report_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' ''').fetchone()[0]
        report['enabled_triggers'] = db.execute('''SELECT p.proname,t.tgname,t.tgenabled
            FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='Learner' AND p.proname IN ('link_progress_kbc_attendance','monthly_actual_event_17')
            ORDER BY 1,2''').fetchall()
        schema_path = next((arg for arg in sys.argv[1:] if not arg.startswith('--')), None)
        if schema_path:
            Path(schema_path).write_text(json.dumps(schema), encoding='utf-8')
        if '--integrity-only' in sys.argv:
            print(json.dumps(report, indent=2))
            return
        groups = defaultdict(Counter)
        with db.cursor(name='snapshots') as cur:
            cur.execute('''SELECT source_system,point_kind,snapshot_hash,snapshot,snapshot::text,row_count,document_count
                FROM "Learner".learner_month_restore_points ORDER BY id''')
            for source, kind, digest, snapshot, pg_text, rows, docs in cur:
                shape = ','.join(sorted(snapshot)) if isinstance(snapshot, dict) else type(snapshot).__name__
                counts = groups[(source, kind, shape)]
                counts['total'] += 1
                candidates = {'postgres-jsonb-text': pg_text}
                for ascii_only in (True, False):
                    for compact in (True, False):
                        candidates[f'python-sorted-ascii={ascii_only}-compact={compact}'] = json.dumps(
                            snapshot, sort_keys=True, ensure_ascii=ascii_only,
                            separators=(',', ':') if compact else None, default=str)
                if isinstance(snapshot, str):
                    candidates['raw-string'] = snapshot
                matches = [name for name, value in candidates.items()
                           if hashlib.sha256(value.encode()).hexdigest() == digest]
                counts['hash_matched' if matches else 'hash_unresolved'] += 1
                for name in matches:
                    counts[name] += 1
                if isinstance(snapshot, dict) and isinstance(snapshot.get('progress'), list):
                    counts['progress_row_count_match' if len(snapshot['progress']) == rows
                           else 'progress_row_count_mismatch'] += 1
        report['snapshots'] = [{'source': s, 'kind': k, 'keys': keys, **counts}
                               for (s,k,keys),counts in sorted(groups.items())]
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
