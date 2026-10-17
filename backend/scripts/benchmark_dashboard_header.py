"""Read-only A/B Header projection benchmark; emits no learner data or SQL params.

Run from backend with an existing environment. --baseline-root must point to a
checkout of the pre-change repository. No Django test runner, server, migrations
or external HTTP calls are used. Timings exclude HTTP/authentication middleware.
"""
import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import gzip
import importlib.util
import json
import logging
import os
from pathlib import Path
import sys
from time import perf_counter
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--env-file', type=Path)
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--trace-functions', action='store_true', help='Inventory app function calls; adds profiling overhead.')
    parser.add_argument('--weekly', action='store_true', help='Also measure the integrated read-only Weekly V2 projection.')
    parser.add_argument('--weekly-only', action='store_true', help='Skip paired Header reads when diagnosing Weekly.')
    parser.add_argument('--explain-source', action='store_true', help='Read-only EXPLAIN ANALYZE of projected enrolment reads.')
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    if args.env_file:
        for line in args.env_file.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    from django.conf import settings
    # Direct connections are necessary for session-level read-only guarantees.
    # Apply at startup on EVERY alias, including any used by a nested helper.
    for config in settings.DATABASES.values():
        if config['ENGINE'] != 'django.db.backends.postgresql':
            raise RuntimeError('This benchmark requires PostgreSQL aliases only.')
        config['HOST'] = config.get('HOST', '').replace('-pooler.', '.')
        options = config.setdefault('OPTIONS', {})
        options.pop('pool', None)
        options['options'] = '-c default_transaction_read_only=on -c statement_timeout=15000'
        config['CONN_MAX_AGE'] = 0
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
    import django
    django.setup()
    logging.disable(logging.CRITICAL)
    from django.db import connections
    from learner_api import dashboard_header as optimized, journal_sources
    from learner_api.projection_performance import ProjectionPerformance
    from django.http import JsonResponse

    # Only Header aliases are opened up front. Other aliases inherit the same
    # read-only startup setting and are included in the execute wrappers.
    targets = {}
    for alias in ('default', 'enrolment'):
        with connections[alias].cursor() as cursor:
            cursor.execute('SHOW transaction_read_only')
            if cursor.fetchone()[0] != 'on':
                raise RuntimeError('Read-only enforcement failed.')
            cursor.execute('SELECT current_database()')
            targets[alias] = cursor.fetchone()[0]  # kept in memory, not emitted
    spec = importlib.util.spec_from_file_location('learner_api._header_baseline',
        args.baseline_root / 'backend/learner_api/dashboard_header.py')
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT id,kind FROM (
            SELECT u.id,lower(u."Learner_type") AS kind,
                row_number() OVER (PARTITION BY lower(u."Learner_type") ORDER BY u.id) AS position
            FROM enrolment."Created_users" u JOIN "Learner".learners l ON l.enrolment_id=u.id
            WHERE lower(coalesce(u."Programme_status",''))='active'
              AND EXISTS (SELECT 1 FROM "Learner".learner_training_plan_modules m WHERE m.learner_id=l.id)
              AND lower(u."Learner_type") IN ('commercial','apprenticeship')
        ) samples WHERE position<=2 ORDER BY kind,id''')
        samples = cursor.fetchall()
    now = datetime.now(timezone.utc)
    records = []
    source_plans = []
    if args.explain_source:
        allowed = {'Node Type', 'Relation Name', 'Index Name', 'Actual Startup Time', 'Actual Total Time',
                   'Actual Rows', 'Actual Loops', 'Plan Rows', 'Plan Width', 'Planning Time', 'Execution Time',
                   'Shared Hit Blocks', 'Shared Read Blocks'}
        def safe_plan(value):
            if isinstance(value, list):
                return [safe_plan(item) for item in value]
            return {key: safe_plan(item) if key in ('Plan', 'Plans') else item
                    for key, item in value.items() if key in allowed or key in ('Plan', 'Plans')}
        for sample, (pk, kind) in enumerate(samples):
            captured = []
            def capture(fn, sql, params, many, context):
                captured.append((sql, params))
                return fn(sql, params, many, context)
            with connections['enrolment'].execute_wrapper(capture):
                optimized.read_header_source(optimized.SOURCE_MODELS[kind], pk)
            with connections['enrolment'].cursor() as cursor:
                sql, params = captured[0]
                cursor.execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, params)
                plan = cursor.fetchone()[0]
                if isinstance(plan, str):
                    plan = json.loads(plan)
                cursor.execute('SELECT octet_length("Training_plan"::text), octet_length("Learning_plan"::text) '
                               'FROM enrolment."Created_users" WHERE id=%s', [pk])
                sizes = cursor.fetchone()
            source_plans.append({'sample': sample, 'plan': safe_plan(plan),
                                 'stored_training_plan_bytes': sizes[0], 'stored_learning_plan_bytes': sizes[1]})
    for sample, (pk, kind) in enumerate(samples):
        if args.weekly_only:
            break
        for run in range(args.runs):
            payloads = {}
            # Alternate ordering to reduce systematic warm-cache bias.
            variants = [('baseline', baseline), ('optimized', optimized)]
            for variant, module in variants if run % 2 == 0 else reversed(variants):
                measurement = ProjectionPerformance('header-benchmark', kind=kind, learner_id='redacted')
                queries = []
                functions = {}
                def trace(frame, event, arg):
                    if event == 'call' and '/backend/' in frame.f_code.co_filename.replace('\\', '/'):
                        name = f"{frame.f_globals.get('__name__', '')}.{frame.f_code.co_name}"
                        functions[name] = functions.get(name, 0) + 1
                def wrapper(alias):
                    def execute(fn, sql, params, many, context):
                        started = perf_counter()
                        try:
                            return measurement.execute_for(alias, fn, sql, params, many, context)
                        finally:
                            queries.append({'alias': alias, 'sql': sql, 'ms': round((perf_counter()-started)*1000, 3),
                                            'rows': context['cursor'].rowcount})
                    return execute
                with ExitStack() as stack:
                    for connection in connections.all():
                        stack.enter_context(connection.execute_wrapper(wrapper(connection.alias)))
                    stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('HTTP forbidden')))
                    stack.enter_context(patch('urllib.request.urlopen', side_effect=AssertionError('HTTP forbidden')))
                    stack.enter_context(journal_sources.learner_journal_reads())
                    if args.trace_functions:
                        sys.setprofile(trace)
                        stack.callback(sys.setprofile, None)
                    if hasattr(module, 'read_header_source'):
                        source = module.read_header_source(module.SOURCE_MODELS[kind], pk)
                    else:
                        source = module.SOURCE_MODELS[kind].all_learners.only(*dict.fromkeys(module.HEADER_SOURCE_FIELDS)).get(pk=pk)
                    payload = module.build_dashboard_header(source, kind, pk, now=now)
                    payloads[variant] = payload
                    raw = JsonResponse(module.compact_header(payload) if hasattr(module, 'compact_header') else payload).content
                record = {'sample': sample, 'kind': kind, 'run': run, 'variant': variant, **measurement.fields(),
                          'raw_bytes': len(raw), 'gzip_bytes': len(gzip.compress(raw, mtime=0)), 'queries': queries}
                if args.trace_functions:
                    record['functions'] = dict(sorted(functions.items()))
                records.append(record)
                print(json.dumps({key: value for key, value in record.items() if key not in ('queries', 'functions')}), flush=True)
            if JsonResponse(payloads['baseline']).content != JsonResponse(payloads['optimized']).content:
                raise AssertionError('Legacy payload parity failed; payloads deliberately not printed.')
    weekly_records = []
    if args.weekly:
        from learner_api import dashboard_weekly as weekly
        for sample, (pk, kind) in enumerate(samples):
            for run in range(args.runs):
                measurement = ProjectionPerformance('weekly-benchmark', kind=kind, learner_id='redacted')
                weekly_queries = []
                def weekly_wrapper(alias):
                    def execute(fn, sql, params, many, context):
                        started = perf_counter()
                        try:
                            return measurement.execute_for(alias, fn, sql, params, many, context)
                        finally:
                            weekly_queries.append({'alias': alias, 'sql': sql,
                                'ms': round((perf_counter() - started) * 1000, 3), 'rows': context['cursor'].rowcount})
                    return execute
                with ExitStack() as stack:
                    for connection in connections.all():
                        stack.enter_context(connection.execute_wrapper(weekly_wrapper(connection.alias)))
                    stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('HTTP forbidden')))
                    stack.enter_context(patch('urllib.request.urlopen', side_effect=AssertionError('HTTP forbidden')))
                    stack.enter_context(journal_sources.learner_journal_reads())
                    source = weekly.assignment_projection(weekly.SOURCE_MODELS[kind].all_learners.only(
                        *weekly.WEEKLY_SOURCE_FIELDS)).get(pk=pk)
                    source.training_plan = source._weekly_training_plan
                    source.learning_plan = source._weekly_learning_plan
                    try:
                        raw = JsonResponse(weekly.compact_weekly(weekly.read_dashboard_weekly(source, pk))).content
                    except Exception as error:
                        import traceback
                        weekly_records.append({'sample': sample, 'run': run, 'error_type': type(error).__name__,
                            'frames': [{'file': Path(frame.filename).name, 'line': frame.lineno, 'function': frame.name}
                                       for frame in traceback.extract_tb(error.__traceback__)]})
                        continue
                record = {'sample': sample, 'run': run, **measurement.fields(),
                          'raw_bytes': len(raw), 'gzip_bytes': len(gzip.compress(raw, mtime=0))}
                weekly_records.append(record)
                print(json.dumps(record), flush=True)
                record['queries'] = weekly_queries
    args.output.write_text(json.dumps({'scope': 'projection-only; active sampled learners; no HTTP/auth timing',
        'legacy_payload_parity': True if records else None, 'read_only_aliases_configured': list(connections),
        'read_only_aliases_verified': list(targets), 'function_tracing_enabled': args.trace_functions,
        'records': records, 'weekly_records': weekly_records, 'source_plans': source_plans}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Driver messages can contain runtime connection information.
        print(f'Benchmark failed: {type(error).__name__}; no report written.', file=sys.stderr)
        raise SystemExit(1)
