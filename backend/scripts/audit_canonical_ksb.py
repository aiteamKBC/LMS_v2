"""Read-only Development schema evidence and a classified lexical inventory.

Writes local audit artifacts only. No application startup, migrations, external
services, learner records, connection strings, or credentials in output.
"""
import json
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify_inclusion_canonical_targets import connect_development
from curriculum_api.source_activity_ksbs import relation
from learner_api.ksb_domain import official_progress_relation

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'specs' / 'ksb-canonical-architecture'
TABLES = {
    'curriculum.ksb_standard_versions': 5,
    'curriculum.ksb_standard_definitions': 235,
    'curriculum.ksb_component_mappings': 22855,
    'curriculum.ksb_source_activity_mappings': 67795,
    'Learner.ksb_learner_activity_mappings': 24955,
    'Learner.ksb_learner_progress': 342125,
}
OLD = (
    'standard_versions', 'standard_ksbs', 'ksb_mappings', 'source_activity_ksbs',
    'learner_activity_ksbs', 'learner_progress_ksbs', 'ksb_definitions',
    'ksb_profile_versions', 'source_activity_ksbs_normalized', 'learner_ksb_assignments',
    'learner_progress_ksb_exclusions', 'learner_journal_row_ksbs', 'aptem_component_ksbs',
    'ksb_profile_source_id', 'ksb_definition_id',
)


def inventory():
    paths = subprocess.check_output(['git','ls-files','-z'], cwd=ROOT).decode().split('\0')
    pattern = re.compile(r'\b(' + '|'.join(map(re.escape,OLD)) + r')\b')
    found = []
    for name in paths:
        path = ROOT / name
        # Source inventory only; data dumps and generated JSON are not runtime
        # dependencies and may contain learner data. SQL archives remain a
        # separate migration/operations review, not a claimed completed audit.
        if path.suffix not in {'.py','.ts','.tsx','.yml','.yaml','.sh','.ps1'}:
            continue
        if '/migrations/' in name:
            kind = 'historical migration - do not edit'
        elif '/sql/' in name or '/reports/' in name or '/scripts/' in name:
            kind = 'operational or historical script - invocation review required'
        elif '/test' in name or '/__tests__/' in name or '.test.' in name:
            kind = 'test fixture or assertion'
        elif path.suffix == '.md':
            kind = 'documentation'
        else:
            kind = 'runtime candidate - semantic review required'
        data = path.read_bytes()
        content = data.decode('utf-16' if data.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8-sig')
        for number,line in enumerate(content.splitlines(),1):
            tokens = sorted(set(pattern.findall(line)))
            if tokens:
                found.append({'path':name,'line':number,'symbols':tokens,'classification':kind})
    return found


def database():
    with connect_development() as db:
        identity = db.execute("SELECT current_database(),current_setting('neon.project_id'),"
            "current_setting('neon.branch_id'),current_setting('transaction_read_only')").fetchone()
        assert identity == ('neondb','green-term-97168878','br-raspy-sky-abvs8lq9','on')
        evidence = {'identity':identity,'tables':{}}
        for name,expected in TABLES.items():
            schema,table = name.split('.')
            count = db.execute(f'SELECT count(*) FROM "{schema}"."{table}"').fetchone()[0]
            evidence['tables'][name] = {'expected_count':expected,'count':count,'matches':count==expected,
                'columns':db.execute('''SELECT column_name,data_type,is_nullable,column_default,
                    is_generated,generation_expression,is_identity,identity_generation
                    FROM information_schema.columns WHERE table_schema=%s AND table_name=%s
                    ORDER BY ordinal_position''',[schema,table]).fetchall(),
                'constraints':db.execute('''SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint
                    WHERE conrelid=%s::regclass ORDER BY conname''',[f'"{schema}"."{table}"']).fetchall(),
                'indexes':db.execute('SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=%s AND tablename=%s ORDER BY indexname',[schema,table]).fetchall()}
        queries = {
            'journal_ksb_guards': '''SELECT t.tgname,pg_get_triggerdef(t.oid),pg_get_functiondef(t.tgfoid)
                FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='Learner' AND c.relname IN
                    ('ksb_learner_progress','learner_journal_rows','learner_progress_entries')
                  AND NOT t.tgisinternal ORDER BY c.relname,t.tgname''',
            'ksb_relations':'''SELECT table_schema,table_name,table_type FROM information_schema.tables
                WHERE table_schema IN ('Learner','curriculum') AND table_name LIKE '%ksb%' ORDER BY 1,2''',
            'component_status': 'SELECT status,count(*) FROM curriculum.ksb_component_mappings GROUP BY 1',
            'source_status': 'SELECT mapping_status,count(*) FROM curriculum.ksb_source_activity_mappings GROUP BY 1',
            'source_projection': f"SELECT item->>'resolutionStatus',count(*) FROM {relation()} k CROSS JOIN LATERAL jsonb_array_elements(k.ksbs) item GROUP BY 1",
            'learner_activity_sources': 'SELECT source_kind,count(*) FROM "Learner".ksb_learner_activity_mappings GROUP BY 1',
            'progress_status': 'SELECT mapping_status,is_excluded,count(*) FROM "Learner".ksb_learner_progress GROUP BY 1,2',
            'eligible_progress_links': f'SELECT count(*) FROM {official_progress_relation()} k',
            'learner_pins': 'SELECT count(*) FROM "Learner".learners WHERE standard_ref IS NOT NULL AND standard_version IS NOT NULL',
            'pin_reference_conflicts': '''SELECT count(*) FROM "Learner".learners l JOIN curriculum.programmes p
                ON p.programme_id=l.programme_id WHERE l.standard_ref IS NOT NULL AND p.standard_ref IS DISTINCT FROM l.standard_ref''',
            'journal_snapshot_count': 'SELECT count(*) FROM "Learner".learner_journal_rows WHERE ksb_snapshot IS NOT NULL',
            'views': '''SELECT viewname,definition FROM pg_views WHERE schemaname='curriculum'
                AND viewname IN ('component_ksb_weighting','component_learning_lineage','component_learning_summary') ORDER BY viewname''',
        }
        for key,sql in queries.items():
            evidence[key] = db.execute(sql).fetchall()
        return evidence


def main():
    DEST.mkdir(parents=True,exist_ok=True)
    evidence = database()
    (DEST/'database-evidence.json').write_text(json.dumps(evidence,indent=2,default=str)+'\n',encoding='utf-8')
    entries = inventory()
    (DEST/'legacy-inventory.json').write_text(json.dumps(entries,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'database_identity':evidence['identity'],
        'baseline_counts_match':all(t['matches'] for t in evidence['tables'].values()),
        'inventory_locations':len(entries),
        'runtime_candidate_files':len({e['path'] for e in entries if e['classification'].startswith('runtime')}),
        'evidence_directory':str(DEST)}))


if __name__ == '__main__':
    main()
