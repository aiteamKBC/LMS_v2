"""Build reviewable sibling patches without writing to either sibling checkout."""
import difflib
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'specs/lms-master-completion'


def diff(path, before, after):
    return ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
        fromfile='a/' + path if before else '/dev/null', tofile='b/' + path))


def prepare():
    evidence = {}
    guard = """-- Development only. Prepared, not executed by this task.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
 IF current_database()<>'neondb' OR current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-raspy-sky-abvs8lq9'
 THEN RAISE EXCEPTION 'Wrong Development destination'; END IF;
END $guard$;
"""
    (OUT / 'Development-module-hours.sql').write_text(guard +
        (ROOT / 'backend/curriculum_api/module_hours_workflow.sql').read_text() + '\nCOMMIT;\n', encoding='utf-8')
    (OUT / 'Development-source-sync-baselines.sql').write_text(guard +
        (OUT / 'patch_sources/source_sync_baselines.sql').read_text() + '\nCOMMIT;\n', encoding='utf-8')
    repo = ROOT.parent / 'LMS'
    path = 'backend/learner_api/management/commands/migrate_activity_runtime_to_ssot.py'
    before = (repo / path).read_text(encoding='utf-8')
    block = '''    "source_lms_activities": (
        '"Last_audit".activities', 'curriculum.source_lms_activities',
    ),
'''
    assert before.count(block) == 1
    after = before.replace(block, '').replace('    "source_lms_group_learners": (', block + '    "source_lms_group_learners": (')
    patch = diff(path, before, after)
    (OUT / 'patch_sources/migrate_activity_runtime_to_ssot.py').write_text(after, encoding='utf-8')
    for source, target in [
        ('source_catalogue_refresh.py', 'backend/learner_api/source_catalogue_refresh.py'),
        ('refresh_source_catalogue.py', 'backend/learner_api/management/commands/refresh_source_catalogue.py'),
        ('source_sync_baselines.sql', 'backend/sql/source_sync_baselines.sql')]:
        patch += diff(target, '', (OUT / 'patch_sources' / source).read_text(encoding='utf-8'))
    (OUT / 'LMS-source-sync.patch').write_text(patch, encoding='utf-8')
    worker_path = 'backend/audit_api/management/commands/sync_lms_material_backups.py'
    worker_before = (repo / worker_path).read_text(encoding='utf-8')
    worker_after = worker_before.replace('                           material.page_count_status,',
        '                           material.page_count_status,\n                           material.page_count,\n                           material.page_count_error,')
    worker_after = worker_after.replace('            if options["page_counts_only"]:\n                conditions.extend([',
        '            if options["page_counts_only"]:\n                conditions.extend([\n'
        '                    "a.page_count IS NULL",\n'
        '                    "coalesce(a.page_count_error, \'\') NOT ILIKE \'%%HTTP 404%%\'",')
    worker_after = worker_after.replace('            params = []',
        '            conditions.append("coalesce(a.page_count_error, \'\') NOT ILIKE \'%%HTTP 404%%\'")\n            params = []')
    worker_after = worker_after.replace('a.last_checked_at NULLS FIRST, a.activity_id\n                """,\n                params,',
        'a.last_checked_at NULLS FIRST, a.activity_id\n                LIMIT %s\n                """,\n                [*params, limit or None],')
    assert worker_after != worker_before and 'LIMIT %s' in worker_after
    (OUT / 'patch_sources/sync_lms_material_backups.py').write_text(worker_after, encoding='utf-8')
    (OUT / 'LMS-material-worker.patch').write_text(diff(worker_path, worker_before, worker_after), encoding='utf-8')
    evidence['LMS'] = {'commit': subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD']).decode().strip(),
                       'source_sha256': hashlib.sha256(before.encode()).hexdigest()}
    repo = ROOT.parent / 'fetch-evidence'
    path = 'backend/evidence/management/commands/sync_last_audit.py'
    before = (repo / path).read_text(encoding='utf-8')
    after = before.replace('from django.db import connection', 'from django.db import connection, transaction')
    after = after.replace('_store_raw_page(cursor, page, per_page, payload)\n\n        counts',
                          '_store_raw_page(cursor, page, per_page, payload)\n        counts')
    for indent in (12, 8):
        pad = ' ' * indent
        block = '\n'.join(pad + line for line in [
            'with connection.cursor() as cursor:', '    _store_raw_page(cursor, page, per_page, payload)',
            'counts = (', '    upsert_activity_definitions(payload)', '    if definitions_only else upsert_payload(payload)', ')'])
        assert after.count(block) == 1
        replacement = pad + 'with transaction.atomic(using=connection.alias):\n' + '\n'.join('    ' + line for line in block.splitlines())
        after = after.replace(block, replacement)
    (OUT / 'patch_sources/sync_last_audit.py').write_text(after, encoding='utf-8')
    (OUT / 'fetch-evidence-page-atomicity.patch').write_text(diff(path, before, after), encoding='utf-8')
    evidence['fetch-evidence'] = {'commit': subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD']).decode().strip(),
                                  'source_sha256': hashlib.sha256(before.encode()).hexdigest()}
    (OUT / 'sibling-patch-provenance.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')


if __name__ == '__main__':
    prepare()
