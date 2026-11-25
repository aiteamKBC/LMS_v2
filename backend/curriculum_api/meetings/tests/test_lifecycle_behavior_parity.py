"""Original-source/public-facade parity with synthetic ORM, SQL and mail capabilities."""
import ast
from curriculum_api.catalogue.tests.parity.current_entry_source import current_entry_tree
import copy
from datetime import datetime, timedelta, timezone
import json
import logging
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((Path(__file__).parent / 'fixtures/lifecycle_snapshot.json').read_text(encoding='utf-8'))
CURRENT = {n.name: n for n in current_entry_tree().body
           if isinstance(n, ast.FunctionDef)}


def load(name, namespace, original):
    namespace.setdefault('__package__', 'curriculum_api')
    namespace.setdefault('require_GET', lambda f: f)
    namespace.setdefault('csrf_exempt', lambda f: f)
    node = ast.parse(SNAPSHOT['functions'][name]['source']).body[0] if original else CURRENT[name]
    exec(compile(ast.Module(body=[copy.deepcopy(node)], type_ignores=[]), '<actual-lifecycle-source>', 'exec'), namespace)
    return namespace[name]


def error(message, status=400, **kwargs):
    return {'status': status, 'error': message, **kwargs}


class LifecycleParity(unittest.TestCase):
    def delivery_validation(self, original, mode):
        trace = []
        def holiday_read():
            trace.append('holiday-read')
            return ['stored-holiday']
        namespace = {'ZoneInfo': ZoneInfo, 'datetime': datetime, 'timezone': timezone,
                     'parse_graph_datetime': lambda value: datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None,
                     'parse_int': lambda value, default=0: int(value or default),
                     'get_holiday_rows_safe': holiday_read,
                     'authoring_module_exists': lambda mid: trace.append(('module', mid)) or {'start_date': '2026-11-01', 'end_date': '2026-11-30'},
                     'england_non_delivery_reason': lambda day, holidays: trace.append(('england', day, holidays)) or
                         ('Weekend' if day.weekday() >= 5 else '')}
        policy = types.SimpleNamespace(
            module_policy=lambda module: {'country': 'synthetic'},
            policy_holidays=lambda policy, start, end, holidays: trace.append(('holidays', start, end, holidays)) or ['policy-holiday'])
        rules = types.SimpleNamespace(non_delivery_reason=lambda day, policy, holidays:
                                      trace.append(('country', day, holidays)) or 'Country holiday')
        operation = load('teams_non_delivery_reason', namespace, original)
        with patch.dict(sys.modules, {'curriculum_api.delivery_calendar': policy,
                                      'curriculum_api.catalogue.infrastructure.delivery_calendar_runtime': policy,
                                      'curriculum_api.calendar_policy': rules}):
            result = operation([{'startDateTimeUtc': '2026-11-22T23:30:00Z', 'sessionNumber': 2}],
                               time_zone='Africa/Cairo' if mode == 'cairo' else 'Not/AZone' if mode == 'invalid_zone' else 'Europe/London',
                               holiday_rows=None if mode == 'stored_holidays' else [],
                               module_catalogue_id='MOD-SYNTHETIC' if mode == 'module_policy' else None)
        return result, trace

    def schema(self, original, tracking, vendor, ready, fail):
        trace = []
        class Cursor:
            def __enter__(self):
                trace.append('enter')
                return self
            def __exit__(self, kind, value, tb):
                trace.append(('exit', kind.__name__ if kind else None))
            def execute(self, sql):
                trace.append(sql)
                if fail:
                    raise RuntimeError('synthetic provisioning failure')
        flag = '_LIVE_SESSION_TRACKING_TABLES_READY' if tracking else '_LIVE_SESSIONS_TABLE_READY'
        tables = {k: k.lower() for k in ('LIVE_SESSIONS_TABLE', 'AUTHORING_MODULES_TABLE',
            'LIVE_SESSION_OCCURRENCES_TABLE', 'LIVE_SESSION_ATTENDANCE_TABLE', 'LIVE_SESSION_ARTIFACTS_TABLE',
            'LIVE_SESSION_RECORDING_EVENTS_TABLE', 'LIVE_SESSION_JOIN_LAUNCHES_TABLE')}
        cache = {'curriculum.' + value: ['cached'] for value in tables.values()}
        cache['curriculum.unrelated'] = ['preserve']
        namespace = {**tables, flag: ready, 'CURRICULUM_SCHEMA': 'curriculum',
                     'connection': types.SimpleNamespace(vendor=vendor, cursor=Cursor),
                     'authoring_table_name': lambda t: 'curriculum.' + t, 'quote_ident': lambda t: '"' + t + '"',
                     'column_names': lambda t: set(), '_TABLE_COLUMNS_CACHE': cache,
                     'ensure_live_sessions_table': lambda: trace.append('ensure-series')}
        name = 'provision_live_session_tracking_tables' if tracking else 'provision_live_sessions_table'
        operation = load(name, namespace, original)
        failure = None
        try:
            operation()
            operation()  # The second request must not re-provision.
        except RuntimeError as exc:
            failure = str(exc)
        return trace, cache, namespace[flag], failure

    def invitees(self, original, mode):
        trace = []
        rows = {'profiles': [' Person@Example.invalid ', '', 'Second@example.invalid'],
                'mirrors': ['person@example.invalid', 'THIRD@example.invalid', None]}
        if mode == 'empty':
            rows = {'profiles': [], 'mirrors': []}
        class Query:
            def __init__(self, source):
                self.source = source
            def filter(self, **values):
                trace.append((self.source, 'filter', values))
                if mode == 'failure':
                    raise RuntimeError('synthetic source unavailable')
                return self
            def exclude(self, **values):
                trace.append((self.source, 'exclude', values))
                return self
            def values_list(self, *args, **kwargs):
                trace.append((self.source, 'values_list', args, kwargs))
                return self
            def distinct(self):
                trace.append((self.source, 'distinct'))
                return rows[self.source]
        def fetch(*args):
            trace.append(('module', args))
            return [] if mode == 'missing_module' else [{'tutor_email': ' Tutor@Example.invalid '}]
        namespace = {'clean_str': lambda v: str(v or '').strip(), 'json_error': error, 'JsonResponse': dict,
                     'AUTHORING_MODULES_TABLE': 'modules', 'authoring_fetch_all': fetch,
                     'LearnerTrainingPlanModule': types.SimpleNamespace(objects=Query('mirrors')),
                     'LearnerProfile': types.SimpleNamespace(objects=Query('profiles'))}
        operation = load('curriculum_module_meeting_invitees', namespace, original)
        try:
            result = operation(object(), '  ' if mode == 'invalid' else ' MOD-SYNTHETIC ')
        except RuntimeError as exc:
            result = {'raised': str(exc)}
        return result, trace

    def archive_guard(self, original, mode):
        trace = []
        now = datetime(2026, 11, 22, 12, tzinfo=timezone.utc)
        class DatabaseError(Exception):
            pass
        def fetch(table, where, values):
            trace.append((table, where, values))
            if mode == 'unreadable':
                raise DatabaseError('synthetic offline')
            if table == 'series':
                return [{'id': 'SERIES', 'start_datetime': now + timedelta(hours=1), 'duration_minutes': 60}]
            if mode == 'no_occurrences':
                return []
            return [{'session_number': 2, 'status': 'superseded', 'scheduled_start': now + timedelta(hours=1),
                     'scheduled_end': now + timedelta(hours=2) if mode == 'future' else now - timedelta(seconds=1)}]
        namespace = {'clean_str': lambda v: str(v or '').strip(), 'parse_int': lambda v, default=0: int(v or default),
                     'utc_datetime': lambda v: v.replace(tzinfo=v.tzinfo or timezone.utc),
                     'parse_graph_datetime': lambda v: v, 'utc_iso_value': lambda v: v.isoformat(),
                     'datetime': types.SimpleNamespace(utcnow=lambda: now), 'timedelta': timedelta,
                     'authoring_fetch_all': fetch, 'LIVE_SESSIONS_TABLE': 'series', 'LIVE_SESSION_OCCURRENCES_TABLE': 'occurrences',
                     'DatabaseError': DatabaseError, 'MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE': 'Synthetic blocked calendar',
                     'json_error': error, 'logger': logging.getLogger('lifecycle-parity')}
        load('module_future_teams_sessions', namespace, original)
        response = load('module_teams_calendar_block_response', namespace, original)('MOD-SYNTHETIC')
        return response, trace

    def test_retired_route_refuses_before_any_read_or_write(self):
        def run(original):
            namespace = {'clean_str': lambda v: str(v or '').strip(), 'json_error': error}
            return load('curriculum_teams_meeting_occurrence_schedule', namespace, original)(object(), ' SERIES ', 1)
        result = run(False)
        self.assertEqual(result, run(True))
        self.assertEqual((result['status'], result['code']), (410, 'use_calendar_action'))

    def test_imported_calendar_refusal_preserves_identity_and_error_contract(self):
        def run(original):
            namespace = {'clean_str': lambda v: str(v or '').strip(), 'json_error': error}
            return load('external_teams_calendar_refusal', namespace, original)(
                {'id': ' SERIES ', 'join_url': ' https://teams.microsoft.com/synthetic ', 'web_link': None})
        result = run(False)
        self.assertEqual(result, run(True))
        self.assertEqual((result['status'], result['calendarManagement']), (409, 'external'))
        self.assertEqual(result['existingMeeting']['liveSessionId'], 'SERIES')


def schema_case(tracking, vendor, ready, fail):
    def test(self):
        actual = self.schema(False, tracking, vendor, ready, fail)
        self.assertEqual(actual, self.schema(True, tracking, vendor, ready, fail))
        trace, cache, flag, failure = actual
        self.assertEqual(flag, ready or not fail)
        self.assertEqual(cache['curriculum.unrelated'], ['preserve'])
        if ready:
            self.assertEqual(trace, [])
        elif fail:
            self.assertEqual(failure, 'synthetic provisioning failure')
        else:
            self.assertEqual(trace.count('enter'), 1)
    return test


for _tracking in (False, True):
    for _vendor in ('postgresql', 'sqlite'):
        for _ready, _fail in ((False, False), (True, False), (False, True)):
            setattr(LifecycleParity, f'test_schema_{_tracking}_{_vendor}_{_ready}_{_fail}',
                    schema_case(_tracking, _vendor, _ready, _fail))


def invitee_case(mode):
    def test(self):
        actual = self.invitees(False, mode)
        self.assertEqual(actual, self.invitees(True, mode))
        response, trace = actual
        if mode == 'invalid':
            self.assertEqual((response['status'], trace), (400, []))
        elif mode == 'duplicates':
            self.assertEqual(response['attendees'], ['Person@Example.invalid', 'Second@example.invalid', 'THIRD@example.invalid'])
            self.assertEqual(response['presenters'], ['Tutor@Example.invalid'])
            self.assertEqual(trace[1], ('mirrors', 'filter', {'curriculum_module_id': 'MOD-SYNTHETIC'}))
            self.assertIn(('profiles', 'filter', {'plan_modules__curriculum_module_id': 'MOD-SYNTHETIC'}), trace)
        elif mode == 'missing_module':
            self.assertEqual(response['presenters'], [])
            self.assertEqual(len(response['attendees']), 3)
    return test


for _mode in ('invalid', 'empty', 'duplicates', 'missing_module', 'failure'):
    setattr(LifecycleParity, 'test_invitees_' + _mode, invitee_case(_mode))


def archive_case(mode):
    def test(self):
        actual = self.archive_guard(False, mode)
        self.assertEqual(actual, self.archive_guard(True, mode))
        response, trace = actual
        if mode == 'past':
            self.assertIsNone(response)
        else:
            self.assertEqual(response['status'], 503 if mode == 'unreadable' else 409)
            self.assertFalse(response['deleted'])
        self.assertNotIn('superseded', trace[0][1])
    return test


for _mode in ('future', 'past', 'no_occurrences', 'unreadable'):
    setattr(LifecycleParity, 'test_archive_' + _mode, archive_case(_mode))


def delivery_case(mode):
    def test(self):
        result = self.delivery_validation(False, mode)
        self.assertEqual(result, self.delivery_validation(True, mode))
        self.assertEqual(result[0], '' if mode == 'cairo' else 'Session 2: Country holiday'
                         if mode == 'module_policy' else 'Session 2: Weekend')
        self.assertEqual('holiday-read' in result[1], mode == 'stored_holidays')
    return test


for _mode in ('cairo', 'invalid_zone', 'stored_holidays', 'module_policy'):
    setattr(LifecycleParity, 'test_delivery_' + _mode, delivery_case(_mode))


class NotificationParity(unittest.TestCase):
    pass


def notification_case(method):
    def test(self):
        from curriculum_api.meetings.tests import test_schedule_email_no_db as emails
        def run(original):
            traces = []
            definitions = emails.definitions
            def bind(path, namespace, names=None):
                if path == ROOT / 'views.py' and names == {'with_schedule_change_notice', 'teams_series_invited'}:
                    for name in names:
                        load(name, namespace, original)
                    operation = namespace['with_schedule_change_notice']
                    def observed(*args, **kwargs):
                        response = operation(*args, **kwargs)
                        traces.append((response.status_code, copy.deepcopy(dict(response))))
                        return response
                    namespace['with_schedule_change_notice'] = observed
                else:
                    definitions(path, namespace, names)
            case = emails.ServerSentUpdateEmailTests(method)
            try:
                with patch.object(emails, 'definitions', bind):
                    case.setUp()
                    getattr(case, method)()
                    return traces, case.notice_ids
            finally:
                case.doCleanups()
        self.assertEqual(run(False), run(True))
    return test


for _method in (
    'test_an_update_without_explicit_email_choice_sends_no_lms_mail',
    'test_a_date_update_sends_the_change_email_from_the_server',
    'test_a_people_only_save_emails_the_added_people_alone',
    'test_a_person_added_by_a_notified_date_update_gets_one_email_not_two',
    'test_an_update_that_announced_nothing_sends_no_change_email',
    'test_the_change_email_is_keyed_by_the_logical_change_so_a_retry_cannot_resend_it',
    'test_a_caller_who_may_not_send_mail_gets_the_notice_and_no_email',
):
    setattr(NotificationParity, _method, notification_case(_method))


if __name__ == '__main__':
    unittest.main()
