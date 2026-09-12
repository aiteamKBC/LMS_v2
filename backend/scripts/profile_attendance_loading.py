"""Read-only attendance timings. Usage: python scripts/profile_attendance_loading.py 125.

All PostgreSQL connections are read-only. Output contains timings, counts and a
payload fingerprint, never learner names, email addresses, content or credentials.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
from time import perf_counter
from unittest.mock import patch
from contextlib import ExitStack

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
os.environ['CURRICULUM_WARM'] = 'false'

from django.conf import settings

for config in settings.DATABASES.values():
    if config['ENGINE'].endswith('postgresql'):
        options = config.setdefault('OPTIONS', {})
        options['options'] = options.get('options', '') + ' -c default_transaction_read_only=on'

import django
import psycopg

django.setup()

from django.db import connections
from learner_api import attendance, attendance_lectures as workspace
from learner_api import attendance_mode

connect = psycopg.connect


def readonly_connect(*args, **kwargs):
    kwargs['options'] = kwargs.get('options', '') + ' -c default_transaction_read_only=on'
    return connect(*args, **kwargs)


def measured(name, function):
    def run(*args, **kwargs):
        start = perf_counter()
        try:
            return function(*args, **kwargs)
        finally:
            print(json.dumps({'stage': name, 'seconds': round(perf_counter() - start, 4)}), flush=True)
    return run


def read_source(learner_id):
    manager = workspace.SOURCE_MODELS['commercial'].all_learners
    fields = getattr(workspace, 'ATTENDANCE_SOURCE_FIELDS', None)
    if fields:
        manager = manager.only(*fields)
    return manager.get(pk=learner_id)


def canonical(value):
    if isinstance(value, dict):
        return {key: canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        return sorted((canonical(item) for item in value), key=lambda item: json.dumps(item, sort_keys=True, default=str))
    return value


if __name__ == '__main__':
    learner_id = int(sys.argv[1])
    with ExitStack() as stack:
        stack.enter_context(patch.object(psycopg, 'connect', readonly_connect))
        for module, names in (
            (workspace, ('lecture_register', 'read_native_occurrences', 'read_legacy_metadata', 'read_native_components', 'build_lectures')),
            (attendance, ('fetch_kbc_attendance_rows', 'fetch_verified_teams_attendance_rows')),
            (attendance_mode, ('read_mode',)),
        ):
            for name in names:
                stack.enter_context(patch.object(module, name, measured(name, getattr(module, name))))
        for run in range(2):
            start = perf_counter()
            source = measured('source_lookup', read_source)(learner_id)
            payload = workspace.read_workspace(source, 'commercial')
            encoded = json.dumps(payload, sort_keys=True, default=str).encode()
            print(json.dumps({
                'run': run + 1, 'total_seconds': round(perf_counter() - start, 4),
                'lectures': len(payload['lectures']), 'bytes': len(encoded),
                'fingerprint': hashlib.sha256(json.dumps(canonical(payload), sort_keys=True, default=str).encode()).hexdigest(),
            }), flush=True)
    connections.close_all()
