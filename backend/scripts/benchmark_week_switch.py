"""Read-only Week 2/3 projection benchmark; excludes HTTP/auth/browser time."""
import argparse
from contextlib import ExitStack
import gzip
import json
import logging
import os
from pathlib import Path
import sys
from time import perf_counter
import traceback
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--paired', action='store_true', help='Alternate reconstructed pre-task and current readers.')
    parser.add_argument('--verify-views', action='store_true', help='Read-only view-level status checks, excluding auth middleware.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    for line in (root / '.env').read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings'
    from django.conf import settings
    for config in settings.DATABASES.values():
        assert config['ENGINE'] == 'django.db.backends.postgresql'
        config['HOST'] = config.get('HOST', '').replace('-pooler.', '.')
        config.setdefault('OPTIONS', {}).pop('pool', None)
        config['OPTIONS']['options'] = '-c default_transaction_read_only=on -c statement_timeout=20000'
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
    import django
    django.setup()
    logging.disable(logging.CRITICAL)
    from django.db import connections
    from django.http import JsonResponse
    from learner_api import dashboard_weekly as weekly, journal_sources
    from learner_api.projection_performance import ProjectionPerformance
    import types
    baseline_reader = types.ModuleType('coach_api._week_switch_baseline')
    baseline_reader.__package__ = 'coach_api'
    code = (root / 'coach_api/weekly_learning.py').read_text().replace(
        'if student_projection and not include_weeks:', 'if False:')
    code = code.replace("AS fallback_ksb_mappings''' if student_projection else ''",
                        "AS fallback_ksb_mappings''' if False else ''").replace(
                        'if student_projection:\n            for row in details:', 'if False:\n            for row in details:')
    exec(compile(code, 'pre-task:coach_api/weekly_learning.py', 'exec'), baseline_reader.__dict__)
    from learner_api.identity import learner_profile_for_source
    from learner_api import canonical_learning
    import inspect
    ledger_globals = dict(canonical_learning.__dict__)
    ledger_code = inspect.getsource(canonical_learning.weekly_hour_records).replace(
        ' AND s.learner_id=%s)', ')').replace("[owner['id'], owner['id']]", "[owner['id']]")
    exec(compile(ledger_code, 'pre-task:canonical_learning.weekly_hour_records', 'exec'), ledger_globals)
    def baseline_identity(source, pk, **kwargs):
        kwargs.pop('fields', None)
        return learner_profile_for_source(source, pk, **kwargs)
    def baseline_calendar(cohort_ids):
        from curriculum_api.views import (clean_str, curriculum_in_clause, authoring_fetch_all,
            COHORT_AUTHORING_DETAILS_TABLE, get_holiday_rows, scheduling_holidays_from, parse_json_value)
        wanted = list(dict.fromkeys(clean_str(value) for value in cohort_ids if clean_str(value)))
        if not wanted:
            return {}
        clause, params = curriculum_in_clause('cohort_id', wanted)
        cohorts = authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE, clause, params, ensure_tables=False)
        if not cohorts:
            return {}
        holidays = get_holiday_rows()
        return {clean_str(cohort['cohort_id']): scheduling_holidays_from(holidays, cohort.get('start_date'),
            parse_json_value(cohort.get('excluded_holiday_ids'), [])) for cohort in cohorts if clean_str(cohort.get('cohort_id'))}
    for alias in ('default', 'enrolment'):
        with connections[alias].cursor() as cursor:
            cursor.execute('SHOW transaction_read_only')
            assert cursor.fetchone()[0] == 'on'
    with connections['enrolment'].cursor() as cursor:
        cursor.execute("SELECT module_catalogue_id FROM curriculum.modules WHERE lower(title)='ai in marketing'")
        candidates = [row[0] for row in cursor.fetchall()]
    from learner_api.learning_plan import _effective_plan_ids
    source = weekly.assignment_projection(weekly.SOURCE_MODELS['commercial'].all_learners.only(*weekly.WEEKLY_SOURCE_FIELDS)).get(pk=265)
    source.training_plan, source.learning_plan = source._weekly_training_plan, source._weekly_learning_plan
    module_ids = set(_effective_plan_ids(source, {}))
    module_id, = [mid for mid in candidates if mid in module_ids]
    records = []
    for run in range(args.runs):
        variants = ['baseline', 'optimized'] if args.paired else ['optimized']
        if run % 2:
            variants.reverse()
        for number, variant in [(number, variant) for number in (2, 3, 2) for variant in variants]:
            queries = []
            measurement = ProjectionPerformance('week-switch', kind='commercial', learner_id='redacted')
            def wrapper(alias):
                def execute(fn, sql, params, many, context):
                    callers = [{'file': Path(frame.filename).name, 'function': frame.name, 'line': frame.lineno}
                               for frame in traceback.extract_stack() if '/backend/' in frame.filename.replace('\\', '/')
                               and '/.venv/' not in frame.filename.replace('\\', '/')][-5:]
                    started = perf_counter()
                    try:
                        return measurement.execute_for(alias, fn, sql, params, many, context)
                    finally:
                        queries.append({'alias': alias, 'sql': sql, 'ms': round((perf_counter()-started)*1000, 3),
                                        'rows': context['cursor'].rowcount, 'callers': callers})
                return execute
            with ExitStack() as stack:
                if variant == 'baseline':
                    stack.enter_context(patch.object(weekly, 'read_weekly_learning', baseline_reader.read_weekly_learning))
                    stack.enter_context(patch.object(weekly, 'learner_profile_for_source', baseline_identity))
                    stack.enter_context(patch('learner_api.weekly_calendar.cohort_holidays', baseline_calendar))
                    stack.enter_context(patch.object(canonical_learning, 'weekly_hour_records', ledger_globals['weekly_hour_records']))
                for connection in connections.all():
                    stack.enter_context(connection.execute_wrapper(wrapper(connection.alias)))
                stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('HTTP forbidden')))
                stack.enter_context(patch('urllib.request.urlopen', side_effect=AssertionError('HTTP forbidden')))
                stack.enter_context(journal_sources.learner_journal_reads())
                source = weekly.assignment_projection(weekly.SOURCE_MODELS['commercial'].all_learners.only(*weekly.WEEKLY_SOURCE_FIELDS)).get(pk=265)
                source.training_plan, source.learning_plan = source._weekly_training_plan, source._weekly_learning_plan
                payload = weekly.read_dashboard_weekly(source, 265, week_id=f'slot:{module_id}:{number}', module_id=module_id)
                compact = weekly.compact_weekly(payload, detail=True)
                raw = JsonResponse(compact).content
            record = {'run': run, 'week': number, 'variant': variant, **measurement.fields(), 'raw_bytes': len(raw),
                      'gzip_bytes': len(gzip.compress(raw, mtime=0)), 'activities': len(payload['selectedWeek']['activities']), 'queries': queries}
            # Save payload hashes, never learner/activity content, for parity checks.
            import hashlib
            record['payload_sha256'] = hashlib.sha256(raw).hexdigest()
            records.append(record)
            print(json.dumps({key: value for key, value in record.items() if key != 'queries'}), flush=True)
    statuses = []
    if args.verify_views:
        import inspect
        from django.test import RequestFactory
        view = inspect.unwrap(weekly.dashboard_weekly)
        with patch('requests.sessions.Session.request', side_effect=AssertionError('HTTP forbidden')), \
             patch('urllib.request.urlopen', side_effect=AssertionError('HTTP forbidden')):
            for pk, number in ((101, None), (265, 2), (265, 3)):
                request = RequestFactory().get('/weekly/', {'version': '2', **({'moduleId': module_id} if number else {})})
                response = view(request, 'commercial', pk, **({'week_id': f'slot:{module_id}:{number}'} if number else {}))
                statuses.append({'enrolment_id': pk, 'week': number, 'status': response.status_code})
                assert response.status_code == 200
    for number in (2, 3):
        hashes = {record['payload_sha256'] for record in records if record['week'] == number}
        assert len(hashes) == 1, 'Week payload parity failed.'
    args.output.write_text(json.dumps({'scope': 'read-only projection; all aliases wrapped; no HTTP/auth/browser timing',
                                     'module_id': module_id, 'payload_parity': True, 'view_statuses': statuses, 'records': records}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Benchmark failed: ' + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
