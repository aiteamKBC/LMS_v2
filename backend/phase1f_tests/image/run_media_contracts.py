"""Bundle reviewed media tests and run in Docker without any network or database."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_import_smoke import BACKEND, TARGETS, bundle

TARGETS += ['curriculum_api.' + name for name in (
    'catalogue.tests.tests_pptx_slides', 'catalogue.tests.tests_slide_fallback', 'catalogue.tests.tests_office_preview', 'catalogue.tests.tests_upload_storage',
    'catalogue.tests.test_media_delivery_boundary_no_db', 'catalogue.tests.tests_ai_material',
)]


def run(*args, **kwargs):
    return subprocess.run(['docker', *args], check=True, **kwargs)


if __name__ == '__main__':
    stream = io.BytesIO(bundle())
    with tarfile.open(fileobj=stream, mode='a') as archive:
        archive.add(Path(__file__).with_name('media_contracts.py'), arcname='phase1f/media_contracts.py')
        fixture = 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/media_delivery_snapshot.json'
        archive.add(BACKEND / fixture, arcname='phase1f/backend/' + fixture)
    container = 'lms-media-contracts-' + uuid.uuid4().hex[:10]
    run('run', '-d', '--name', container, '--pull', 'never', '--network', 'none',
        '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt',
        'no-new-privileges', '--entrypoint', 'sleep', 'lms-phase1f-python:3.14.3', 'infinity')
    try:
        state = json.loads(run('inspect', container, capture_output=True, text=True).stdout)[0]
        assert state['HostConfig']['NetworkMode'] == 'none'
        assert state['HostConfig']['ReadonlyRootfs']
        assert not state['Mounts'] and not state['HostConfig']['PortBindings']
        probe = b"import socket,pathlib; assert [n for _,n in socket.if_nameindex()]==['lo']; assert len(pathlib.Path('/proc/net/route').read_text().splitlines())==1; print('OS isolation PASS before Django; no database')"
        run('exec', '-i', container, 'python', '-I', '-B', '-', input=probe)
        run('exec', '-i', container, 'tar', '-xf', '-', '-C', '/tmp', input=stream.getvalue())
        run('exec', container, 'python', '-I', '-B', '/tmp/phase1f/media_contracts.py')
    finally:
        run('rm', '-f', container)
