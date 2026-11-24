"""Compare concrete pure policies with actual frozen production bodies."""
import ast
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import inspect
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.domain.read_contracts import WEEKDAY_INDEX
from curriculum_api.catalogue.domain.values import clean_str, parse_int, parse_json_value
from curriculum_api.meetings.api.time_serialization import LIVE_SESSION_INSTANT_FIELDS
from curriculum_api.meetings.tests.policy_composition_oracle import (
    EXPORTS, SNAPSHOT, actual, assert_export_contract, assert_owner_imports, restore_tree,
)


def original_namespace():
    namespace = dict(datetime=datetime, timedelta=timedelta, timezone=timezone,
                     hashlib=hashlib, json=json, re=re, clean_str=clean_str,
                     parse_int=parse_int, parse_json_value=parse_json_value,
                     WEEKDAY_INDEX=WEEKDAY_INDEX, LIVE_SESSION_INSTANT_FIELDS=LIVE_SESSION_INSTANT_FIELDS)
    for name, source in SNAPSHOT['functions'].items():
        exec(compile(source, '<frozen-original-policy:' + name + '>', 'exec'), namespace)
    return namespace


class PurePolicyComposition(unittest.TestCase):
    def test_frozen_original_source_is_unchanged(self):
        path = Path(__file__).parent / 'fixtures/policy_composition_snapshot.json'
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),
                         '42eacab40ca95e403f2a7bd59e62fc6e3b825c0b9e4a92b871249bb6eb8c2ae7')

    def test_public_exports_keep_exact_signatures_and_original_bodies(self):
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        original = original_namespace()
        for name, source in SNAPSHOT['functions'].items():
            with self.subTest(name=name):
                self.assertTrue(assert_export_contract(self, tree, name, ast.parse(source).body[0]))
                self.assertEqual(inspect.signature(actual(name)), inspect.signature(original[name]))

    def test_unrelated_views_are_unchanged(self):
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        self.assertEqual(hashlib.sha256(ast.dump(restore_tree(tree, 'views.py')).encode()).hexdigest(),
                         SNAPSHOT['views_ast_sha256'])

    def test_exact_import_closure_has_no_framework_storage_or_provider(self):
        for owner in set(EXPORTS.values()):
            tree = ast.parse((ROOT / (owner.replace('.', '/') + '.py')).read_text(encoding='utf-8'))
            assert_owner_imports(self, tree, owner)
        self.assertFalse(any(name.split('.')[0] in {'django', 'psycopg', 'requests', 'httpx', 'redis', 'msal'}
                             for name in sys.modules))
        self.assertNotIn('curriculum_api.views', sys.modules)

    def test_pure_consumers_do_not_import_the_legacy_facade(self):
        specs = [('teams_attendee_compare.py', 'published_invitation_list'),
                 ('teams_imported_meeting_edit.py', 'emails')]
        for path, name in specs:
            tree = ast.parse((ROOT / path).read_text(encoding='utf-8'))
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
            imports = [n for n in ast.walk(node) if isinstance(n, ast.ImportFrom)]
            self.assertEqual(len(imports), 1)
            self.assertEqual((imports[0].level, imports[0].module), (1, 'meetings.domain.invitation_policy'))

    def test_publication_union_uses_roles_and_stored_json_without_views(self):
        tree = ast.parse((ROOT / 'teams_attendee_compare.py').read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'published_invitation_list')
        namespace = {'__package__': 'curriculum_api'}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<actual-published-invitations>', 'exec'), namespace)
        self.assertEqual(namespace[node.name]({'co_organizers': ['B@example.invalid'],
            'presenters': '["A@example.invalid", "b@example.invalid"]',
            'attendees': ['c@example.invalid', 'not-an-email']}),
            ['b@example.invalid', 'a@example.invalid', 'c@example.invalid'])
        self.assertNotIn('curriculum_api.views', sys.modules)

    def compare(self, name, args, kwargs):
        old_args, new_args = copy.deepcopy(args), copy.deepcopy(args)
        old_kwargs, new_kwargs = copy.deepcopy(kwargs), copy.deepcopy(kwargs)
        def outcome(operation, args, kwargs):
            try:
                result = operation(*args, **kwargs)
                return 'value', type(result), result
            except Exception as exc:
                return 'error', type(exc), str(exc)
        self.assertEqual(outcome(actual(name), new_args, new_kwargs),
                         outcome(original_namespace()[name], old_args, old_kwargs))
        self.assertEqual(new_args, old_args)  # In-place roster/serialization semantics also matter.
        self.assertEqual(new_kwargs, old_kwargs)


CASES = []
def case(name, *args, **kwargs):
    CASES.append((name, args, kwargs))

for value in (None, '', 'bad-date', ' 2026-11-22T12:00:00Z ', '2026-11-22T14:00:00+02:00', datetime(2026, 11, 22)):
    case('parse_graph_datetime', value)
for value in ('bad-date', None, datetime(2026, 11, 22, 12),
              datetime(2026, 11, 22, 14, tzinfo=timezone(timedelta(hours=2)))):
    case('utc_iso_value', value)
for value in (None, [], {}, {'scheduled_start': datetime(2026, 11, 22, 12),
                            'actual_end': datetime(2026, 11, 22, 14, tzinfo=timezone.utc), 'unrelated': 'retain'}):
    case('stamp_live_session_instants', value)
for value in ([], '', 'A@example.invalid; a@example.invalid\tB@example.invalid',
              [' A@example.invalid ', 'a@example.invalid', None], ['invalid'], 'bad@example'):
    case('teams_attendee_emails', value)
for values in ((None,), ('["A@example.invalid", "a@example.invalid"]',),
               ('unparseable',), (['A@example.invalid', 'bad'], ('b@example.invalid',))):
    case('teams_series_email_list', *values)
case('teams_newly_invited', ['a@example.invalid'], [' A@example.invalid ', 'B@example.invalid', 'b@example.invalid'])
case('teams_newly_invited', None, None)
case('forward_teams_invitation', None, 'OWNER', ['EVENT'], [])
case('forward_teams_invitation', None, 'OWNER', ['EVENT'], ['a@example.invalid'])
case('teams_warning_sentence', ['issue', {'message': ' issue ', 'detail': ''}, {'message': 'other', 'detail': 'reason'}])
case('teams_warning_sentence', None)

start = datetime(2026, 11, 23, 12)
payload = {'scheduledOccurrences': [
    {'sessionNumber': 2, 'startDateTimeUtc': '2026-11-26T14:00:00+02:00', 'durationMinutes': 90},
    {'sessionNumber': 1, 'startDateTimeUtc': '2026-11-23T12:00:00Z'}, {'startDateTimeUtc': 'invalid'}]}
for repeat in ('none', 'daily', 'weekdays', 'weekly'):
    case('teams_event_recurrence', repeat, start, 4)
    case('teams_recurrence_slot_count', payload, start, repeat, 2)
    case('scheduled_live_session_occurrences', {}, start, 60, repeat, 3)
case('scheduled_live_session_occurrences', payload, start, 60, 'weekly', 2)
case('teams_recurrence_weekdays', payload, start)
case('teams_recurrence_weekdays', {}, start)
case('teams_scheduled_occurrence_starts', payload)
case('teams_scheduled_occurrence_starts', {'scheduledOccurrences': 'invalid'})
case('teams_shifted_occurrence_targets', payload, 60)
case('teams_shifted_occurrence_targets', {'scheduledOccurrences': [
    {'startDateTimeUtc': '2026-11-23T12:00:00Z', 'sessionNumber': 'bad', 'durationMinutes': 'bad'},
    {'startDateTimeUtc': '2026-11-24T12:00:00Z', 'durationMinutes': 99999}]}, 60)
for value in (None, 'invalid', '2026-11-22T14:00:48+02:00', start):
    case('teams_calendar_minute_key', value)
for row in (None, {}, {'session_number': '3'}, {'session_number': 'bad'}):
    case('occurrence_session_number', row)
rows = [{'id': 'SYNTHETIC-1', 'session_number': 2, 'scheduled_start': start, 'status': 'scheduled'},
        {'id': 'SYNTHETIC-2', 'session_number': 1, 'scheduled_start': start + timedelta(days=3), 'status': 'cancelled'}]
targets = [{'session_number': 1, 'start': start}, {'session_number': 2, 'start': start + timedelta(days=7)}]
case('pair_planned_occurrences', targets, rows)
case('pair_planned_occurrences', [], rows)
case('vacated_occurrence_keys', targets, rows)
case('tracked_occurrence_keys', rows)
case('closest_live_occurrence', rows, start + timedelta(hours=2))
case('closest_live_occurrence', [], start)
case('launch_linked_live_occurrence', rows, start, [{'occurrence_id': 'SYNTHETIC-2', 'launched_at': '2026-11-23T11:58:00Z'}])
case('launch_linked_live_occurrence', rows, start, [], report_id='UNKNOWN')
case('launch_linked_live_occurrence', [], start, [])
for record in ({}, {'identity': {'guest': {'id': 'SYNTHETIC', 'displayName': 'Example Person'}}},
               {'emailAddress': 'some.person@example.invalid'}):
    case('attendance_identity', record)
    case('attendance_display_name', record)
case('attendance_display_name', None)
case('merge_attendance_intervals', [{'joinDateTime': '12:00', 'leaveDateTime': '13:00'}],
     [{'joinDateTime': '12:00', 'leaveDateTime': '13:00'}, {'synthetic': True}], None)
series = {'organizer_email': 'organizer@example.invalid', 'attendees': ['a@example.invalid', 'b@example.invalid'],
          'presenters': ['a@example.invalid'], 'co_organizers': ['b@example.invalid']}
attendance = [{'id': 'SYNTHETIC-A', 'email': 'a@example.invalid', 'total_attendance_seconds': 180,
               'intervals': [], 'raw_data': {'attendanceReportId': 'REPORT-A', 'attendanceReportStart': '2026-11-22T12:00:00Z'}},
              {'id': 'SYNTHETIC-A', 'email': 'a@example.invalid', 'total_attendance_seconds': 181,
               'intervals': [{'joinDateTime': '12:00'}], 'raw_data': {'attendanceReportId': 'REPORT-B'}},
              {'id': 'SYNTHETIC-X', 'email': 'outside@example.invalid', 'total_attendance_seconds': 1000}]
for include in (False, True):
    case('attendance_roster', series, attendance, include_absent=include)
    case('attendance_report_rosters', series, attendance, include_absent=include)
case('attendance_report_rosters', series, [], include_absent=True)
for value in (None, 'invalid', 'nan', 'inf', '-inf', '4.5'):
    case('safe_float', value, default=-1)

assert set(EXPORTS) == {name for name, _, _ in CASES}
for index, (name, args, kwargs) in enumerate(CASES):
    def run(self, name=name, args=args, kwargs=kwargs):
        self.compare(name, args, kwargs)
    setattr(PurePolicyComposition, f'test_parity_{index:02d}_{name}', run)

if __name__ == '__main__':
    unittest.main()
