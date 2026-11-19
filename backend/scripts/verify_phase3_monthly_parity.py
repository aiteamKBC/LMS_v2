"""Compare pre/post Phase 3 Monthly payloads against read-only PostgreSQL."""
import argparse
from contextlib import ExitStack
import hashlib
import inspect
import json
import logging
import os
from pathlib import Path
import sys
from unittest.mock import patch


def compiled_previous(function, replacement):
    source = inspect.getsource(function)
    old, new = replacement
    if source.count(old) != 1:
        raise RuntimeError(f'Expected one Phase 3 source marker in {function.__name__}')
    namespace = {}
    exec(compile(source.replace(old, new), 'phase2-' + function.__name__, 'exec'),
         function.__globals__, namespace)
    return namespace[function.__name__]


def normalized(payload):
    value = dict(payload)
    # This timestamp is derived from the wall clock, not learner data.
    value.pop('refreshAt', None)
    return json.dumps(value, sort_keys=True, separators=(',', ':'), default=str).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--example', action='append', required=True,
                        help='kind:enrolment-id; identifiers are not emitted')
    parser.add_argument('--month', required=True)
    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    sys.argv = [sys.argv[0], 'shell']
    from django.conf import settings
    for config in settings.DATABASES.values():
        if config['ENGINE'] != 'django.db.backends.postgresql':
            raise RuntimeError('PostgreSQL required')
        config['HOST'] = config.get('HOST', '').replace('-pooler.', '.')
        config.setdefault('OPTIONS', {}).pop('pool', None)
        config['OPTIONS']['options'] = (
            '-c default_transaction_read_only=on -c statement_timeout=90000'
        )
        config['OPTIONS']['connect_timeout'] = 10
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}

    import django
    # Read-only projection parity does not exercise audit registration.
    with patch('system_audit.writes.register_model'):
        django.setup()
    logging.disable(logging.CRITICAL)

    from django.db import connections
    from django.test import RequestFactory
    from curriculum_api import curriculum_names
    from learner_api import dashboard_tabs, journal_sources
    from learner_api import training_plan_dashboard as schedule
    from learner_api.learner_detail import SOURCE_MODELS
    from learner_api.training_plan_dashboard import TRAINING_PLAN_SOURCE_FIELDS

    for alias in ('default', 'enrolment'):
        with connections[alias].cursor() as cursor:
            cursor.execute("SELECT current_database(),current_setting('transaction_read_only')")
            database, read_only = cursor.fetchone()
            if not database or read_only != 'on':
                raise RuntimeError('Read-only verification failed')

    previous_dashboard = compiled_previous(
        schedule.read_dashboard,
        ("            elif not compact_monthly:\n", "            else:\n"),
    )

    def read(kind, pk, previous):
        source = SOURCE_MODELS[kind].all_learners.only(*dict.fromkeys([
            *TRAINING_PLAN_SOURCE_FIELDS, 'username', 'employer_id',
            'learning_plan', 'training_plan',
        ])).get(pk=pk)
        with ExitStack() as stack:
            stack.enter_context(patch('requests.sessions.Session.request',
                                      side_effect=AssertionError('HTTP forbidden')))
            stack.enter_context(patch('urllib.request.urlopen',
                                      side_effect=AssertionError('HTTP forbidden')))
            stack.enter_context(journal_sources.learner_journal_reads())
            if previous:
                stack.enter_context(patch.object(
                    schedule, 'read_dashboard', previous_dashboard,
                ))
            curriculum_names.begin_request()
            try:
                return dashboard_tabs.read_tab(
                    source, kind, 'monthly',
                    RequestFactory().get('/monthly/', {'month': args.month, 'version': '2'}),
                )
            finally:
                curriculum_names.end_request()

    results = []
    for index, example in enumerate(args.example):
        kind, raw_pk = example.split(':', 1)
        if kind not in SOURCE_MODELS or not raw_pk.isdigit():
            parser.error('--example requires a supported kind and numeric enrolment ID')
        before = normalized(read(kind, int(raw_pk), True))
        after = normalized(read(kind, int(raw_pk), False))
        results.append({
            'sample': index,
            'kind': kind,
            'equal': before == after,
            'before_bytes': len(before),
            'after_bytes': len(after),
            'before_sha256': hashlib.sha256(before).hexdigest(),
            'after_sha256': hashlib.sha256(after).hexdigest(),
            'http_status': 200,
        })
    print(json.dumps({'read_only': True, 'results': results}, indent=2))


if __name__ == '__main__':
    main()
