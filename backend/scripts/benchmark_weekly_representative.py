"""Anonymous, read-only Weekly benchmark across learner types and record lineages.

No fixed learner/module/programme/week selection; excludes HTTP and browser time.
"""
import argparse
from contextlib import ExitStack
import gzip
import hashlib
import json
import logging
import os
from pathlib import Path
import sys
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--samples-per-stratum', type=int, default=2)
    parser.add_argument('--weeks-per-learner', type=int, default=3)
    args = parser.parse_args()
    if min(args.runs, args.samples_per_stratum, args.weeks_per_learner) < 1:
        parser.error('Counts must be positive.')
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    sys.argv = [sys.argv[0], 'shell']  # Disable background curriculum warmers.
    from django.conf import settings
    for config in settings.DATABASES.values():
        if config['ENGINE'] != 'django.db.backends.postgresql':
            raise RuntimeError('PostgreSQL required.')
        config['HOST'] = config.get('HOST', '').replace('-pooler.', '.')
        options = config.setdefault('OPTIONS', {})
        options.pop('pool', None)
        options['options'] = '-c default_transaction_read_only=on -c statement_timeout=20000'
        options['connect_timeout'] = 10
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
    import django
    django.setup()
    logging.disable(logging.CRITICAL)
    from django.db import connections
    from django.http import JsonResponse
    from learner_api import dashboard_weekly as weekly, journal_sources
    from learner_api.projection_performance import ProjectionPerformance
    verified = []
    # Unrelated audit databases need not be reachable for a Weekly read. All
    # aliases still inherit read-only startup options, including nested reads.
    for connection in (connections['default'], connections['enrolment']):
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(),current_setting('transaction_read_only')")
            target, readonly = cursor.fetchone()
            if not target or readonly != 'on':
                raise RuntimeError('Read-only target verification failed.')
            verified.append(connection.alias)
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
        SELECT id,kind,lineage FROM ranked WHERE position<=%s ORDER BY kind,lineage,id''',
        [list(weekly.SOURCE_MODELS), args.samples_per_stratum])
        samples = cursor.fetchall()
    records = []
    missing = [{'kind': kind, 'lineage': lineage, 'reason': 'No eligible active sample'}
               for kind in weekly.SOURCE_MODELS for lineage in ('legacy', 'native')
               if not any(k == kind and l == lineage for _, k, l in samples)]
    for sample, (pk, kind, lineage) in enumerate(samples):
        selections = [None]
        def read(selection):
            source = weekly.assignment_projection(weekly.SOURCE_MODELS[kind].all_learners.only(
                *weekly.WEEKLY_SOURCE_FIELDS)).get(pk=pk)
            source.training_plan, source.learning_plan = source._weekly_training_plan, source._weekly_learning_plan
            return weekly.read_dashboard_weekly(source, pk, week_id=selection[0] if selection else None,
                                              module_id=selection[1] if selection else None)
        for run in range(args.runs):
            index = 0
            while index < len(selections):
                selection = selections[index]
                measurement = ProjectionPerformance('weekly-benchmark', kind=kind, learner_id='redacted')
                record = {'sample': sample, 'kind': kind, 'lineage': lineage, 'run': run,
                          'selection': index, 'mode': 'detail' if selection else 'navigation'}
                with ExitStack() as stack:
                    for connection in connections.all():
                        stack.enter_context(connection.execute_wrapper(measurement.wrapper(connection.alias)))
                    stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('HTTP forbidden')))
                    stack.enter_context(patch('urllib.request.urlopen', side_effect=AssertionError('HTTP forbidden')))
                    stack.enter_context(journal_sources.learner_journal_reads())
                    try:
                        payload = read(selection)
                        raw = JsonResponse(payload).content
                        record.update(raw_bytes=len(raw), gzip_bytes=len(gzip.compress(raw, mtime=0)),
                                      payload_sha256=hashlib.sha256(raw).hexdigest())
                        if selection is None and len(selections) == 1:
                            # Round-robin modules/kinds rather than only the first module.
                            groups = {}
                            for week in payload['weeks']:
                                groups.setdefault((week['moduleId'], week['kind']), []).append(week)
                            while groups and len(selections) <= args.weeks_per_learner:
                                for key in list(groups):
                                    week = groups[key].pop(0)
                                    selections.append((weekly.slot_id(week['moduleId'],
                                        {'type': week['kind'], 'slotNumber': week['slotNumber']}), week['moduleId']))
                                    if not groups[key]:
                                        del groups[key]
                                    if len(selections) > args.weeks_per_learner:
                                        break
                            if len(selections) == 1:
                                record['unverified'] = 'No assigned weeks'
                    except Exception as error:
                        record['error_type'] = type(error).__name__
                record.update(measurement.fields())
                records.append(record)
                print(json.dumps(record), flush=True)
                index += 1
    args.output.write_text(json.dumps({'scope': 'read-only projection; no HTTP/auth/browser timing',
        'lineage_definition': 'legacy has active old_lms progress; native has none (may have no progress)',
        'read_only_aliases_verified': verified, 'records': records, 'unverified': missing}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Benchmark failed: ' + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
