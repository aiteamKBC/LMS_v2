"""Disposable, loopback-only PostgreSQL and Django; never uses host settings."""
import subprocess
import time
import uuid
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_import_smoke import bundle

SUFFIX = uuid.uuid4().hex[:10]
PG = 'lms-phase1f-postgres-' + SUFFIX
APP = 'lms-phase1f-django-' + SUFFIX
def run(*args, **kwargs):
    return subprocess.run(['docker', *args], check=True, **kwargs)

if __name__ == '__main__':
    payload = bundle()
    created = []
    try:
        run('run', '-d', '--name', PG, '--network', 'none', '--tmpfs', '/var/lib/postgresql',
            '--tmpfs', '/var/run/postgresql', '--entrypoint', 'sleep', 'postgres:18.3-bookworm', 'infinity')
        created.append(PG)
        run('run', '-d', '--name', APP, '--network', 'container:' + PG, '--read-only', '--tmpfs', '/tmp',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'sleep',
            'lms-phase1f-python:3.14.3', 'infinity')
        created.append(APP)
        run('inspect', PG, APP, '--format',
            '{{.Name}} network={{.HostConfig.NetworkMode}} ports={{json .HostConfig.PortBindings}} mounts={{json .Mounts}}')
        probe = b"import socket,pathlib; assert [n for _,n in socket.if_nameindex()]==['lo']; assert len(pathlib.Path('/proc/net/route').read_text().splitlines())==1; print('OS isolation PASS before initdb/Django')"
        run('exec', '-i', APP, 'python', '-I', '-B', '-', input=probe)
        run('exec', '-i', APP, 'tar', '-xf', '-', '-C', '/tmp', input=payload)
        # No password/host environment inherited: disposable credentials only.
        run('exec', '-d', '-e', 'POSTGRES_PASSWORD=phase1f-synthetic', '-e', 'POSTGRES_DB=phase1f',
            PG, 'docker-entrypoint.sh', 'postgres', '-c', 'listen_addresses=127.0.0.1')
        for _ in range(30):
            ready = subprocess.run(['docker','exec',PG,'pg_isready','-h','127.0.0.1','-U','postgres','-d','phase1f'], capture_output=True)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Disposable PostgreSQL did not become ready')
        run('exec', APP, 'python', '-I', '-B', '/tmp/phase1f/integration.py',
            '--learning-plans-only')
    finally:
        for name in reversed(created):
            subprocess.run(['docker', 'rm', '-f', name], check=False)
