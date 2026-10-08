"""Read-only bulk loading audit; emits numeric metrics only.

Usage: python scripts/profile_bulk_attendance_context.py PROFILE_ID [context]
All PostgreSQL connections enforce read-only transactions, including KBC.
"""
import json
import logging
import os
from pathlib import Path
import sys
from contextlib import ExitStack
from time import perf_counter
from unittest.mock import patch

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
logging.disable(logging.CRITICAL)
from django.db import connections
from django.test import RequestFactory
from coach_api import attendance_loading as loading, views
from coach_api import attendance_group, attendance_context, attendance_recent, bulk_attendance
from learner_api.models import LearnerProfile

original_connect = psycopg.connect
stats = {}
active = None
plans = {}
kbc_connection = None

def readonly_connect(*args, **kwargs):
    global kbc_connection
    kwargs['options'] = kwargs.get('options', '') + ' -c default_transaction_read_only=on'
    if kwargs.get('row_factory') is psycopg.rows.dict_row:
        kbc_connection = args, dict(kwargs)
        kwargs['cursor_factory'] = AuditCursor
    return original_connect(*args, **kwargs)


class AuditCursor(psycopg.Cursor):
    def execute(self, sql, params=None, **kwargs):
        if not str(sql).startswith('EXPLAIN'):
            plans['kbc_recent_or_history'] = ('kbc', sql, params)
        return query(lambda *unused: super(AuditCursor, self).execute(sql, params, **kwargs),
                     sql, params, False, None)

def measured(name, function):
    def run(*args, **kwargs):
        global active
        previous, active = active, name
        started = perf_counter()
        stage = stats.setdefault(name, {'ms': 0, 'queries': 0, 'query_ms': 0, 'slowest_ms': 0})
        try:
            return function(*args, **kwargs)
        finally:
            stage['ms'] += (perf_counter() - started) * 1000
            active = previous
    return run

def query(call, sql, params, many, context):
    started = perf_counter()
    try:
        if context and not str(sql).startswith('EXPLAIN'):
            plans[active or 'other'] = (context['connection'].alias, sql, params)
        return call(sql, params, many, context)
    finally:
        stage = stats.setdefault(active or 'other', {'ms': 0, 'queries': 0, 'query_ms': 0, 'slowest_ms': 0})
        elapsed = (perf_counter() - started) * 1000
        stage['queries'] += 1
        stage['query_ms'] += elapsed
        stage['slowest_ms'] = max(stage['slowest_ms'], elapsed)


def explain_queries():
    def summarize(value, nodes):
        nodes[value['Node Type']] = nodes.get(value['Node Type'], 0) + 1
        for child in value.get('Plans', []):
            summarize(child, nodes)
    for stage, (alias, sql, params) in list(plans.items()):
        if not str(sql).lstrip().upper().startswith(('SELECT', 'WITH')):
            continue
        try:
            with ExitStack() as stack:
                if alias == 'kbc':
                    args, kwargs = kbc_connection
                    connection = stack.enter_context(original_connect(*args, **kwargs))
                else:
                    connection = connections[alias]
                cursor = stack.enter_context(connection.cursor())
                cursor.execute('EXPLAIN (FORMAT JSON) ' + str(sql), params)
                row = cursor.fetchone()
                document = next(iter(row.values())) if isinstance(row, dict) else row[0]
                if isinstance(document, str):
                    document = json.loads(document)
                plan = document[0]['Plan']
                nodes = {}
                summarize(plan, nodes)
                print(json.dumps({'explain_stage': stage, 'planner_nodes': nodes,
                    'estimated_cost': plan['Total Cost'], 'estimated_rows': plan['Plan Rows']}), flush=True)
        except Exception as exc:
            print(json.dumps({'explain_stage': stage, 'error_type': type(exc).__name__}), flush=True)

if __name__ == '__main__':
    try:
        with ExitStack() as stack:
            stack.enter_context(patch.object(psycopg, 'connect', readonly_connect))
            for connection in connections.all():
                stack.enter_context(connection.execute_wrapper(query))
            profile = LearnerProfile.objects.only('id', 'coach_email').get(pk=int(sys.argv[1]))
            owner = profile.coach_email
            _, placements = loading.attendance_placements(owner)
            placement = next(row for row in placements if row['id'] == str(profile.id))
            request = RequestFactory().get('/', {'programmeId': placement['programmeId'], 'groupId': placement['groupId']})
            stack.enter_context(patch.object(views, 'authenticated_coach_email', return_value=owner))
            for module, names in (
                (views, ('fetch_attendance_caseload_rows', 'fetch_source_schedule_rows', 'apply_curriculum_attendance_placements', 'authoring_fetch_all')),
                (loading, ('selected_context', 'group_contracts', 'delivery_occurrences')),
                (attendance_group, ('fetch_kbc_attendance_rows_bulk', 'fetch_verified_teams_attendance_rows')),
                (attendance_context, ('assigned_modules_by_source', 'recent_attendance')),
                (attendance_recent, ('recent_candidates', 'fetch_kbc_attendance_rows_bulk', 'fetch_verified_teams_attendance_rows')),
                (bulk_attendance, ('assigned_module_ids',)),
            ):
                for name in names:
                    stack.enter_context(patch.object(module, name, measured(name, getattr(module, name))))
            names = ['coach_attendance_context'] * 2 if 'context' in sys.argv else ['coach_attendance_group', 'coach_attendance_sessions', 'coach_attendance_context', 'coach_attendance_context']
            payloads = {}
            for name in names:
                stats.clear()
                function = getattr(loading, name)
                while hasattr(function, '__wrapped__'):
                    function = function.__wrapped__
                started = perf_counter()
                response = function(request)
                payloads[name] = json.loads(response.content)
                print(json.dumps({'endpoint': name, 'status': response.status_code,
                    'total_ms': round((perf_counter()-started)*1000, 3), 'bytes': len(response.content),
                    'stages': {key: {k: round(v, 3) for k, v in value.items()} for key, value in stats.items()}}), flush=True)
            if all(name in payloads for name in ('coach_attendance_group', 'coach_attendance_sessions', 'coach_attendance_context')):
                old_group = payloads['coach_attendance_group']
                new = payloads['coach_attendance_context']
                old_group['learners'] = [{key: value for key, value in row.items() if key != 'attendance'} for row in old_group['learners']]
                old_sessions = [{key: value for key, value in row.items() if key != 'status'} for row in payloads['coach_attendance_sessions']['sessions']]
                print(json.dumps({'learner_parity': old_group == {key: value for key, value in new.items() if key != 'sessions'},
                    'session_parity': old_sessions == new['sessions'], 'learners': len(new['learners']), 'sessions': len(new['sessions'])}), flush=True)
            if '--explain' in sys.argv:
                explain_queries()
    except Exception as exc:
        print(json.dumps({'audit_error': type(exc).__name__}), flush=True)
    finally:
        connections.close_all()
