"""READ ONLY source preparation/preview. No real-record apply or rollback mode."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from uuid import uuid4

from scripts.prepare_empty_plan_repair import seal
from learner_api.services.contact_backfill import prepare_manifest, SOURCE, PROFILE, SCHEMA

PROJECT = "green-term-97168878"
BRANCH = "br-raspy-sky-abvs8lq9"
PRIVATE = Path.home() / '.codex/private/lms-f01-contact-backfill'


def main(envelope):
    import psycopg
    mode = envelope.get('mode', 'preview')
    if (envelope.get('project_id'), envelope.get('branch_id')) != (PROJECT, BRANCH) or mode not in {'preview', 'recheck'}:
        raise RuntimeError('Only pinned read-only preview is supported')
    with psycopg.connect(envelope['connection_url'], options='-c default_transaction_read_only=on') as connection:
        connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        connection.execute("SET LOCAL statement_timeout='30s'")
        if connection.execute("SELECT current_database(),current_setting('neon.branch_id',true),current_setting('transaction_read_only')").fetchone() != ('neondb', BRANCH, 'on'):
            raise RuntimeError('Read-only source identity mismatch')
        if mode == 'recheck':
            path = Path(envelope['manifest']).resolve()
            if path.parent != PRIVATE.resolve() or hashlib.sha256(path.read_bytes()).hexdigest() != envelope['sha256']:
                raise RuntimeError('Frozen manifest integrity mismatch')
            manifest = json.loads(seal(path.read_bytes(), decrypt=True))
            if (manifest['project_id'], manifest['branch_id'], manifest['database']) != (PROJECT, BRANCH, 'neondb'):
                raise RuntimeError('Frozen manifest environment mismatch')
            if connection.execute(SCHEMA).fetchone()[0] != manifest['schema_digest']:
                raise RuntimeError('Frozen schema mismatch')
            sources = {r[0]: r for r in connection.execute(SOURCE + ' WHERE id=ANY(%s)',
                       [[r['source_id'] for r in manifest['rows']]]).fetchall()}
            profiles = {r[0]: r for r in connection.execute(PROFILE + ' WHERE id=ANY(%s)',
                        [[r['profile_id'] for r in manifest['rows']]]).fetchall()}
            for row in manifest['rows']:
                source = sources.get(row['source_id'])
                profile = profiles.get(row['profile_id'])
                if (not source or not profile or source[7] != row['source_digest'] or profile[8] != row['target_digest']
                        or str(source[1]) != row['uuid'] or str(profile[2]) != row['uuid'] or profile[1] != row['source_id']):
                    raise RuntimeError('Frozen candidate drift')
            print(json.dumps(dict(readonly_recheck='PASS', fixed_candidates=len(manifest['rows']), applied=False)), flush=True)
            return
        with connection.cursor() as cursor:
            manifest = prepare_manifest(cursor)
        manifest.update(project_id=PROJECT, branch_id=BRANCH, database='neondb',
                        captured_at=connection.execute('SELECT transaction_timestamp()').fetchone()[0].isoformat())
    raw = json.dumps(manifest, sort_keys=True).encode()
    PRIVATE.mkdir(parents=True, exist_ok=True)
    path = PRIVATE / ('contact-preview-' + uuid4().hex + '.dpapi')
    with path.open('xb') as file:
        file.write(seal(raw))
    if seal(path.read_bytes(), decrypt=True) != raw:
        raise RuntimeError('Encrypted manifest roundtrip failed')
    summary = dict(counts=manifest['counts'], encrypted_manifest=str(path),
                   sha256=hashlib.sha256(path.read_bytes()).hexdigest(), branch=BRANCH,
                   captured_at=manifest['captured_at'], mode='READ ONLY preview', applied=False)
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    try:
        if os.name != 'nt':
            raise RuntimeError('Windows current-user DPAPI required')
        if sys.stdin.isatty():
            import msvcrt
            handle = msvcrt.get_osfhandle(sys.stdin.fileno()); mode = wintypes.DWORD()
            if not ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)) or not ctypes.windll.kernel32.SetConsoleMode(handle, mode.value & ~4):
                raise RuntimeError('Cannot disable private stdin echo')
        print('READY_FOR_PRIVATE_STDIN', flush=True)
        main(json.loads(sys.stdin.readline()))
    except Exception as exc:
        print(json.dumps(dict(status='FAIL', error_type=type(exc).__name__)), flush=True)
        sys.exit(1)
