"""Read-only Training/Overview audit. SQL parameters and learner payloads are never emitted."""
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
    parser.add_argument('--statement-timeout-ms', type=int, default=20000)
    parser.add_argument('--baseline-root', type=Path, help='Saved pre-task dashboard reader directory.')
    parser.add_argument('--paired', action='store_true', help='Compare saved/current readers within read-only repeatable-read snapshots.')
    parser.add_argument('--example', help='Optional kind:enrolment-id regression selection; never emitted.')
    parser.add_argument('--max-samples', type=int, default=0, help='Zero selects every available stratum.')
    parser.add_argument('--sample-start', type=int, default=0, help='Skip previously measured strata.')
    parser.add_argument('--tab', action='append', choices=('training','training-detail','overview'), help='Default: both independent tabs.')
    args = parser.parse_args()
    if args.runs < 1:
        parser.error('--runs must be positive')
    if args.statement_timeout_ms < 1:
        parser.error('--statement-timeout-ms must be positive')
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
        config['OPTIONS']['options'] = f'-c default_transaction_read_only=on -c statement_timeout={args.statement_timeout_ms}'
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
    from learner_api.training_plan_dashboard import TRAINING_PLAN_SOURCE_FIELDS, TRAINING_PLAN_PROFILE_FIELDS
    from learner_api.projection_performance import ProjectionPerformance
    from learner_api import dashboard_training, dashboard_overview
    current_readers = {'training': dashboard_training.read_training, 'overview': dashboard_overview.read_overview,
                       'tab': dashboard_tabs.read_tab}
    baselines = {}
    if args.baseline_root:
        import importlib.util
        def saved(name):
            spec = importlib.util.spec_from_file_location('learner_api._saved_' + name, args.baseline_root / (name + '.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        training = saved('dashboard_training')
        overview = saved('dashboard_overview')
        overview.module_rows = training.module_rows
        baselines = {'training': training.read_training, 'overview': overview.read_overview,
                     'tab': saved('dashboard_tabs').read_tab}
    if args.paired and not baselines:
        parser.error('--paired requires --baseline-root')
    variants = [('baseline', baselines), ('current', current_readers)] if args.paired else [
        ('baseline', baselines) if baselines else ('current', current_readers)]
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
    if args.example:
        example_kind, example_pk = args.example.split(':', 1)
        if example_kind not in SOURCE_MODELS or not example_pk.isdigit():
            parser.error('--example requires a supported kind and numeric enrolment ID')
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('SELECT CASE WHEN EXISTS(SELECT 1 FROM "Learner".learner_progress_entries p '
                'JOIN "Learner".learners l ON l.id=p.learner_id WHERE l.enrolment_id=%s '
                "AND p.deleted_at IS NULL AND p.source_system='old_lms') THEN 'legacy' ELSE 'native' END", [int(example_pk)])
            lineage = cursor.fetchone()[0]
        samples = [(int(example_pk), example_kind, lineage)]
    samples = samples[args.sample_start:]
    if args.max_samples:
        samples = samples[:args.max_samples]
    records = []
    tabs = args.tab or ['training', 'training-detail', 'overview']
    if 'training-detail' in tabs and 'training' not in tabs:
        tabs.insert(0, 'training')
    selections = {}
    for sample, (pk, kind, lineage) in enumerate(samples, start=args.sample_start):
        for tab in dict.fromkeys(tabs):
            for run in range(args.runs):
                from django.db import transaction
                with ExitStack() as snapshots:
                    if args.paired:
                        for alias in ('default', 'enrolment'):
                            snapshots.enter_context(transaction.atomic(using=alias))
                            with connections[alias].cursor() as cursor:
                                cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                    payloads = {}
                    ordered = variants if run % 2 == 0 else list(reversed(variants))
                    for variant, readers in ordered:
                        print(f'Reading sample {sample}, {kind}, {lineage}, {tab}, run {run}', flush=True)
                        measurement = ProjectionPerformance('tabs-benchmark', kind=kind, learner_id='redacted')
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
                        record = {'sample': sample, 'kind': kind, 'lineage': lineage, 'tab': tab, 'run': run,
                                  'variant': variant}
                        with ExitStack() as stack:
                            if args.paired:
                                for alias in ('default', 'enrolment'):
                                    stack.enter_context(transaction.atomic(using=alias))
                            stack.enter_context(patch.object(dashboard_training, 'read_training', readers['training']))
                            stack.enter_context(patch.object(dashboard_overview, 'read_overview', readers['overview']))
                            for connection in connections.all():
                                stack.enter_context(connection.execute_wrapper(wrapper(connection.alias)))
                            stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('HTTP forbidden')))
                            stack.enter_context(patch('urllib.request.urlopen', side_effect=AssertionError('HTTP forbidden')))
                            stack.enter_context(journal_sources.learner_journal_reads())
                            from learner_api import canonical_learning, training_plan_dashboard, attendance_lectures, overview_week
                            for module, name in ((canonical_learning, 'entries_for'), (canonical_learning, 'targets_for'),
                                    (dashboard_tabs, 'learning_projection'), (dashboard_training, 'module_rows'), (dashboard_training, 'learning_facts'), (dashboard_overview, 'module_rows'),
                                    (attendance_lectures, 'read_workspace'), (overview_week, 'read_week')):
                                original = getattr(module, name)
                                def timed(*values, _original=original, _name=name, **options):
                                    with measurement.stage(_name):
                                        return _original(*values, **options)
                                stack.enter_context(patch.object(module, name, timed))
                            try:
                                source = SOURCE_MODELS[kind].all_learners.only(*dict.fromkeys([
                                    *TRAINING_PLAN_SOURCE_FIELDS, 'username', 'employer_id', 'learning_plan', 'training_plan'])).get(pk=pk)
                                if tab == 'training-detail':
                                    from learner_api.identity import learner_profile_for_source
                                    selected = selections.get(sample)
                                    if not selected:
                                        raise LookupError('No assigned module available for detail measurement')
                                    owner = canonical_learning.require_profile(source.pk)
                                    profile_options = {'fields': TRAINING_PLAN_PROFILE_FIELDS} if variant == 'current' else {}
                                    profile = learner_profile_for_source(source, source.pk, heal=False, **profile_options)
                                    if profile is None or profile.pk != owner['id'] or profile.enrolment_id != source.pk:
                                        raise LookupError('Unverified identity')
                                    source._canonical_profile, source._case_file_profile = owner, profile
                                    dashboard_tabs.install_request_caches(source)
                                    payload = dashboard_training.read_training(source, kind, owner, profile, RequestFactory().get('/module/'), selected)
                                else:
                                    payload = readers['tab'](source, kind, tab, RequestFactory().get('/' + tab + '/'))
                                if tab == 'training':
                                    selections[sample] = payload.get('selectedModuleId') or next((m['id'] for m in payload['timeline']['modules']), None)
                                payloads[variant] = payload
                                started = perf_counter()
                                raw = JsonResponse(payload).content
                                record.update(serialization_ms=round((perf_counter() - started) * 1000, 3),
                                              raw_bytes=len(raw), gzip_bytes=len(gzip.compress(raw, mtime=0)),
                                              payload_sha256=hashlib.sha256(raw).hexdigest())
                            except Exception as error:
                                record['error_type'] = type(error).__name__
                                if args.paired:
                                    for alias in ('default', 'enrolment'):
                                        transaction.set_rollback(True, using=alias)
                        record.update(measurement.fields(), queries=queries)
                        records.append(record)
                        args.output.write_text(json.dumps({'connection_verification_ms': connection_times, 'records': records}, indent=2))
                        print(json.dumps({k: v for k, v in record.items() if k != 'queries'}), flush=True)
                    if args.paired:
                        same = (all(isinstance(payloads.get(v), dict) for v in ('baseline', 'current'))
                            and not any(r.get('error_type') for r in records[-len(variants):])
                            and payloads['baseline'] == payloads['current'])
                        records[-1]['paired_payload_equal'] = same
                        args.output.write_text(json.dumps({'connection_verification_ms': connection_times, 'records': records}, indent=2))
                        print(json.dumps({'sample': sample, 'tab': tab, 'paired_payload_equal': same}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Tab benchmark failed: ' + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
