"""Read-only Monthly audit. SQL parameters and learner payloads are never emitted."""
import argparse
from contextlib import ExitStack
import gzip
import hashlib
import json
import logging
import os
from pathlib import Path
import sys
import subprocess
import types
from time import perf_counter
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--runs', type=int, default=2)
    parser.add_argument('--baseline', action='store_true', help='Read Monthly implementation from local HEAD without changing files.')
    parser.add_argument('--version', choices=('1', '2'), default='1', help='Opt-in Monthly wire contract.')
    parser.add_argument('--max-samples', type=int, default=0, help='Zero selects every available stratum.')
    parser.add_argument('--sample-start', type=int, default=0, help='Skip previously measured strata.')
    parser.add_argument('--month', action='append', help='Repeat for selected YYYY-MM values; default includes the year transition.')
    args = parser.parse_args()
    if args.runs < 1:
        parser.error('--runs must be positive')
    if min(args.max_samples, args.sample_start) < 0:
        parser.error('Sample limits must be nonnegative')
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    sys.argv = [sys.argv[0], 'shell']
    from django.conf import settings
    for config in settings.DATABASES.values():
        if config['ENGINE'] != 'django.db.backends.postgresql':
            raise RuntimeError('PostgreSQL required')
        config['HOST'] = config.get('HOST', '').replace('-pooler.', '.')
        config.setdefault('OPTIONS', {}).pop('pool', None)
        config['OPTIONS']['options'] = '-c default_transaction_read_only=on -c statement_timeout=20000'
        config['OPTIONS']['connect_timeout'] = 10
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
    import django
    django.setup()
    logging.disable(logging.CRITICAL)
    from django.db import connections
    from django.http import JsonResponse
    from django.test import RequestFactory
    from learner_api import dashboard_tabs, journal_sources
    from learner_api.learner_detail import SOURCE_MODELS
    from learner_api.training_plan_dashboard import TRAINING_PLAN_SOURCE_FIELDS
    from learner_api.projection_performance import ProjectionPerformance
    from learner_api import dashboard_monthly
    if args.baseline:
        code = subprocess.run(['git', 'show', 'HEAD:backend/learner_api/dashboard_monthly.py'],
                              cwd=Path(__file__).resolve().parents[2], check=True,
                              capture_output=True, text=True).stdout
        baseline = types.ModuleType('learner_api._monthly_baseline')
        baseline.__package__ = 'learner_api'
        exec(compile(code, 'monthly-baseline', 'exec'), baseline.__dict__)
        dashboard_monthly.read_monthly = baseline.read_monthly
    connection_times = {}
    for alias in ('default', 'enrolment'):
        print('Verifying read-only connection: ' + alias, flush=True)
        started = perf_counter()
        with connections[alias].cursor() as cursor:
            cursor.execute("SELECT current_database(),current_setting('transaction_read_only')")
            target, readonly = cursor.fetchone()
            if not target or readonly != 'on':
                raise RuntimeError('Read-only verification failed')
        connection_times[alias] = round((perf_counter() - started) * 1000, 3)
    print('Selecting anonymous representative samples', flush=True)
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''WITH candidates AS (
            SELECT u.id,lower(u."Learner_type") AS kind,
              CASE WHEN EXISTS(SELECT 1 FROM "Learner".learner_progress_entries p
                WHERE p.learner_id=l.id AND p.deleted_at IS NULL AND p.source_system='old_lms')
                THEN 'legacy' ELSE 'native' END AS lineage
            FROM enrolment."Created_users" u JOIN "Learner".learners l ON l.enrolment_id=u.id
            WHERE lower(u."Learner_type")=ANY(%s)
              AND lower(coalesce(u."Programme_status",''))='active'
              AND EXISTS(SELECT 1 FROM "Learner".learner_training_plan_modules m WHERE m.learner_id=l.id)
        ), ranked AS (SELECT *,row_number() OVER(PARTITION BY kind,lineage ORDER BY id) AS position
                     FROM candidates)
        SELECT id,kind,lineage FROM ranked WHERE position=1 ORDER BY kind,lineage''', [list(SOURCE_MODELS)])
        samples = cursor.fetchall()
        # Some learner types have source-only assignments or no active delivery
        # yet. Do not silently exclude those strata from a global audit.
        for kind in SOURCE_MODELS:
            for lineage in ('legacy', 'native'):
                if any(k == kind and stored == lineage for _, k, stored in samples):
                    continue
                cursor.execute('''SELECT u.id FROM enrolment."Created_users" u
                    JOIN "Learner".learners l ON l.enrolment_id=u.id
                    WHERE lower(u."Learner_type")=%s
                      AND (CASE WHEN EXISTS(SELECT 1 FROM "Learner".learner_progress_entries p
                        WHERE p.learner_id=l.id AND p.deleted_at IS NULL AND p.source_system='old_lms')
                        THEN 'legacy' ELSE 'native' END)=%s
                    ORDER BY (lower(coalesce(u."Programme_status",''))='active') DESC,
                        EXISTS(SELECT 1 FROM "Learner".learner_training_plan_modules m WHERE m.learner_id=l.id) DESC,
                        u.id LIMIT 1''', [kind, lineage])
                candidate = cursor.fetchone()
                if candidate:
                    samples.append((candidate[0], kind, lineage))
                else:
                    print(f'No matching learner for stratum: {kind}, {lineage}', flush=True)
    samples = samples[args.sample_start:]
    if args.max_samples:
        samples = samples[:args.max_samples]
    records = []
    from django.utils import timezone
    from learner_api.dashboard_monthly import shift_month, validate_month, UK
    current = timezone.localdate(timezone=UK).strftime('%Y-%m')
    months = tuple(validate_month(value) for value in args.month) if args.month else (
        current, current[:4] + '-12', shift_month(current[:4] + '-12', 1))
    for sample, (pk, kind, lineage) in enumerate(samples, start=args.sample_start):
        for month in dict.fromkeys(months):
            for run in range(args.runs):
                print(f'Reading sample {sample}, {kind}, {lineage}, {month}, run {run}', flush=True)
                measurement = ProjectionPerformance('monthly-benchmark', kind=kind, learner_id='redacted')
                queries = []
                def wrapper(alias):
                    def execute(fn, sql, params, many, context):
                        started = perf_counter()
                        try:
                            return measurement.execute_for(alias, fn, sql, params, many, context)
                        finally:
                            queries.append({'alias': alias, 'sql': sql, 'ms': round((perf_counter() - started) * 1000, 3)})
                            args.output.write_text(json.dumps({'connection_verification_ms': connection_times,
                                'records': records, 'in_progress': {**record, 'queries': queries}}, indent=2))
                    return execute
                record = {'sample': sample, 'kind': kind, 'lineage': lineage, 'month': month, 'run': run,
                          'variant': 'baseline' if args.baseline else 'optimized', 'version': args.version}
                with ExitStack() as stack:
                    for connection in connections.all():
                        stack.enter_context(connection.execute_wrapper(wrapper(connection.alias)))
                    stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('HTTP forbidden')))
                    stack.enter_context(patch('urllib.request.urlopen', side_effect=AssertionError('HTTP forbidden')))
                    stack.enter_context(journal_sources.learner_journal_reads())
                    from learner_api import canonical_learning, training_plan_dashboard, attendance_lectures, overview_week
                    for module, name in ((canonical_learning, 'entries_for'), (canonical_learning, 'targets_for'),
                            (dashboard_tabs, 'learning_projection'), (training_plan_dashboard, 'read_dashboard'),
                            (attendance_lectures, 'read_workspace'), (overview_week, 'read_week')):
                        original = getattr(module, name)
                        def timed(*values, _original=original, _name=name, **options):
                            with measurement.stage(_name):
                                return _original(*values, **options)
                        stack.enter_context(patch.object(module, name, timed))
                    try:
                        source = SOURCE_MODELS[kind].all_learners.only(*dict.fromkeys([
                            *TRAINING_PLAN_SOURCE_FIELDS, 'username', 'employer_id', 'learning_plan', 'training_plan'])).get(pk=pk)
                        payload = dashboard_tabs.read_tab(source, kind, 'monthly', RequestFactory().get('/monthly/', {'month': month, 'version': args.version}))
                        started = perf_counter()
                        raw = JsonResponse(payload).content
                        record.update(serialization_ms=round((perf_counter() - started) * 1000, 3),
                                      raw_bytes=len(raw), gzip_bytes=len(gzip.compress(raw, mtime=0)),
                                      payload_sha256=hashlib.sha256(raw).hexdigest())
                    except Exception as error:
                        record['error_type'] = type(error).__name__
                record.update(measurement.fields(), queries=queries)
                records.append(record)
                args.output.write_text(json.dumps({'connection_verification_ms': connection_times, 'records': records}, indent=2))
                print(json.dumps({k: v for k, v in record.items() if k != 'queries'}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Benchmark failed: ' + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
