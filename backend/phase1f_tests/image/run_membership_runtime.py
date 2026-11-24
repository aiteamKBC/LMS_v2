"""Run synthetic membership HTTP parity in network-isolated Docker, without a DB."""
import io
import json
from pathlib import Path
import subprocess
import tarfile
import uuid

BACKEND = Path(__file__).resolve().parents[2]
TEST = 'learner_api/learning_plans/tests/integration/test_membership_runtime_isolated.py'
SOURCES = (
    TEST,
    'learner_api/learning_plans/tests/parity/test_membership_caller_parity_standalone.py',
    'learner_api/learning_plans/tests/parity/test_membership_integration_standalone.py',
    'learner_api/learning_plans/domain/membership_policy.py',
    'learner_api/learning_plans/application/module_membership.py',
    'learner_api/mappers.py',
    'curriculum_api/views.py',
    'curriculum_api/learner_status_counts.py',
    'curriculum_api/learner_assignments.py',
    'curriculum_api/attendance_membership.py',
    'curriculum_api/directory/domain/placement.py',
    'curriculum_api/directory/application/status_queries.py',
    'curriculum_api/directory/application/assignment_queries.py',
    'curriculum_api/directory/infrastructure/registration_reads.py',
    'login/permissions.py',
)
FIXTURE = 'learner_api/learning_plans/tests/fixtures/legacy_snapshots/membership_preintegration_snapshot.json'


def bundle():
    files = {BACKEND / name for name in (*SOURCES, FIXTURE)}
    for path in tuple(files):
        for parent in path.parents:
            if parent == BACKEND:
                break
            marker = parent / '__init__.py'
            if marker.is_file():
                files.add(marker)
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for path in sorted(files):
            assert path.resolve().is_relative_to(BACKEND)
            archive.add(path, arcname='phase1f/backend/' + path.relative_to(BACKEND).as_posix())
    return stream.getvalue()


def run(*args, **kwargs):
    return subprocess.run(['docker', *args], check=True, **kwargs)


if __name__ == '__main__':
    payload = bundle()
    container = 'lms-membership-runtime-' + uuid.uuid4().hex[:10]
    run('run', '-d', '--name', container, '--pull', 'never', '--network', 'none',
        '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt',
        'no-new-privileges', '--entrypoint', 'sleep', 'lms-phase1f-python:3.14.3', 'infinity')
    try:
        state = json.loads(run('inspect', container, capture_output=True, text=True).stdout)[0]
        assert state['HostConfig']['NetworkMode'] == 'none'
        assert state['HostConfig']['ReadonlyRootfs']
        assert not state['Mounts'] and not state['HostConfig']['PortBindings']
        probe = b"import socket,pathlib; assert [n for _,n in socket.if_nameindex()]==['lo']; assert len(pathlib.Path('/proc/net/route').read_text().splitlines())==1; print('OS isolation PASS before Django; no PostgreSQL container')"
        run('exec', '-i', container, 'python', '-I', '-B', '-', input=probe)
        run('exec', '-i', container, 'tar', '-xf', '-', '-C', '/tmp', input=payload)
        run('exec', container, 'python', '-I', '-B', '/tmp/phase1f/backend/' + TEST)
    finally:
        run('rm', '-f', container)
