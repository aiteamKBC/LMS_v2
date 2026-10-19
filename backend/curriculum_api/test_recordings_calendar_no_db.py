"""Stdlib regression runner: no Django setup, database or external services."""
import ast
import json
import sys
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from curriculum_api.recordings_calendar_policy import compare_calendar, meeting_key, event_meeting_key

LINK = 'https://teams.microsoft.com/l/meetup-join/meeting-1?context=%7B%7D'
START = datetime(2026, 10, 14, 21, tzinfo=timezone.utc)
END = datetime(2026, 10, 15, 21, tzinfo=timezone.utc)


def event(**values):
    return {'id': 'E1', 'subject': 'Same title', 'start': {'dateTime': '2026-10-15T08:00:00Z'},
            'end': {'dateTime': '2026-10-15T10:00:00Z'}, 'onlineMeeting': {'joinUrl': LINK}, **values}


def occurrence(**values):
    return {'id': 'O1', 'module_catalogue_id': 'M1', 'join_url': LINK,
            'scheduled_start': datetime(2026, 10, 15, 8), 'scheduled_end': datetime(2026, 10, 15, 10),
            'status': 'scheduled', **values}


class CalendarComparisonTests(unittest.TestCase):
    def compare(self, events, rows=None):
        return compare_calendar(events, rows if rows is not None else [occurrence()], [{'join_url': LINK}], START, END, 'Africa/Cairo')

    def test_matches_link_and_exact_utc_interval_in_cairo_day(self):
        result = self.compare([event()])
        self.assertEqual(result['matched'], [{'occurrenceId': 'O1', 'moduleId': 'M1', 'title': 'Same title'}])
        self.assertEqual(result['unmatched'], [])

    def test_attendee_copy_uses_invitation_link_without_online_meeting_metadata(self):
        copy = event(onlineMeeting=None, body={'content': f'<a href="{LINK.replace("&", "&amp;")}">Join</a>'})
        self.assertEqual(self.compare([copy])['matched'][0]['occurrenceId'], 'O1')
        self.assertEqual(event_meeting_key(event(onlineMeeting=None, onlineMeetingUrl=LINK)), meeting_key(LINK))

    def test_multiple_different_invitation_links_are_not_guessed(self):
        ambiguous = event(onlineMeeting=None, body={'content': LINK + ' ' + LINK.replace('meeting-1', 'meeting-2')})
        self.assertIsNone(event_meeting_key(ambiguous))
        self.assertEqual(self.compare([ambiguous])['matched'], [])

    def test_same_title_different_meeting_never_matches(self):
        result = self.compare([event(onlineMeeting={'joinUrl': LINK.replace('meeting-1', 'meeting-2')})])
        self.assertEqual(result['matched'], [])
        self.assertIn('not linked', result['unmatched'][0]['reason'])

    def test_previous_day_occurrence_and_different_end_time_do_not_match(self):
        for row in [occurrence(scheduled_start=datetime(2026, 10, 14, 8)), occurrence(scheduled_end=datetime(2026, 10, 15, 11))]:
            result = self.compare([event()], [row])
            self.assertEqual(result['matched'], [])
            self.assertIn('date, time', result['unmatched'][0]['reason'])

    def test_midnight_boundaries_use_utc_instants_of_the_viewing_zone(self):
        before = event(start={'dateTime': '2026-10-14T20:59:00Z'})
        after = event(start={'dateTime': '2026-10-15T21:00:00Z'})
        result = self.compare([before, after])
        self.assertEqual(result, {'matched': [], 'unmatched': []})

    def test_cancelled_calendar_and_lms_states_must_agree(self):
        self.assertEqual(self.compare([event(isCancelled=True)])['matched'], [])
        self.assertEqual(len(self.compare([event(isCancelled=True)], [occurrence(status='cancelled')])['matched']), 1)

    def test_ambiguous_links_are_reported_instead_of_counting_duplicate_lectures(self):
        result = self.compare([event()], [occurrence(), occurrence(id='O2', module_catalogue_id='M2')])
        self.assertEqual(result['matched'], [])
        self.assertIn('More than one', result['unmatched'][0]['reason'])

    def test_duplicate_calendar_copies_do_not_duplicate_a_matched_session(self):
        self.assertEqual(len(self.compare([event(), event(id='COPY')])['matched']), 1)

    def test_non_teams_url_and_unlinked_calendar_events_are_explained(self):
        self.assertIsNone(meeting_key('https://teams.microsoft.com.evil.invalid/l/meetup-join/meeting-1'))
        self.assertIsNone(meeting_key('http://teams.microsoft.com/l/meetup-join/meeting-1'))
        result = self.compare([event(onlineMeeting=None)])
        self.assertIn('no Teams meeting link', result['unmatched'][0]['reason'])


class CalendarViewValidationTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).parent / 'recordings_calendar.py').read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'calendar_matches')
        self.assertIn("require_role('admin', 'staff')", ast.unparse(node.decorator_list[1]))
        self.assertEqual(ast.unparse(node.decorator_list[0]), 'require_GET')
        node.decorator_list = []
        from datetime import date, timedelta
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        from urllib.parse import quote, urlencode
        self.ns = {'date': date, 'datetime': datetime, 'timedelta': timedelta, 'timezone': timezone,
                   'ZoneInfo': ZoneInfo, 'ZoneInfoNotFoundError': ZoneInfoNotFoundError,
                   'JsonResponse': lambda data, status=200: {'data': data, 'status': status},
                   'DatabaseError': type('DatabaseError', (Exception,), {}), 'read': Mock(),
                   'unavailable': lambda: {'status': 503}, '__package__': 'curriculum_api',
                   'quote': quote, 'urlencode': urlencode, 'compare_calendar': compare_calendar}
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'calendar-view', 'exec'), self.ns)

    def request(self, **params):
        return types.SimpleNamespace(GET={'start': '2026-10-15', 'end': '2026-10-15', 'timeZone': 'Africa/Cairo', **params}, login_account=types.SimpleNamespace(email='own@example.invalid', role='staff'))

    def test_invalid_period_and_zone_fail_before_db_or_graph(self):
        for request in [self.request(end='2026-12-01'), self.request(start='bad'), self.request(timeZone='invalid')]:
            self.assertEqual(self.ns['calendar_matches'](request)['status'], 400)
        self.ns['read'].assert_not_called()

    def test_unknown_mailbox_cannot_access_an_arbitrary_tenant_calendar(self):
        self.ns['read'].return_value = [{'organizer_email': 'known@example.invalid'}]
        result = self.ns['calendar_matches'](self.request(mailbox='other@example.invalid'))
        self.assertEqual(result['status'], 400)
        self.assertEqual(self.ns['read'].call_count, 1)

    def test_no_default_account_requires_selection_without_guessing_a_calendar(self):
        self.ns['read'].return_value = [{'organizer_email': 'one@example.invalid'}, {'organizer_email': 'two@example.invalid'}]
        request = self.request(); request.login_account.role = 'admin'
        result = self.ns['calendar_matches'](request)
        self.assertEqual(result['data']['status'], 'choose')
        self.assertEqual(result['Cache-Control'], 'private, no-store')
        self.assertEqual(result['data']['matched'], [])
        self.assertEqual(self.ns['read'].call_count, 1)

    def test_database_failure_is_not_reported_as_an_empty_calendar(self):
        self.ns['read'].side_effect = self.ns['DatabaseError']()
        self.assertEqual(self.ns['calendar_matches'](self.request())['status'], 503)


    def test_staff_cannot_read_a_different_existing_organizer_calendar(self):
        self.ns['read'].return_value = [{'organizer_email': 'own@example.invalid'}, {'organizer_email': 'other@example.invalid'}]
        result = self.ns['calendar_matches'](self.request(mailbox='other@example.invalid'))
        self.assertEqual(result['status'], 400)
        self.assertEqual(self.ns['read'].call_count, 1)

    def verified_view(self, failure=False):
        self.ns['read'].side_effect = [[{'organizer_email': 'own@example.invalid'}], [occurrence()], [{'join_url': LINK}]]
        graph = types.ModuleType('coach_api.views')
        graph.microsoft_graph_request = Mock(side_effect=RuntimeError('unavailable')) if failure else Mock(return_value={'value': [event()]})
        graph.get_graph_settings = lambda: {'base_url': 'https://graph.microsoft.com/v1.0'}
        normalization = types.ModuleType('curriculum_api.teams_weekly_calendar')
        normalization.graph_event_utc = lambda item: item
        external = types.ModuleType('curriculum_api.recordings_external')
        external.event_reference = lambda *args: 'signed-event-reference'
        with patch.dict(sys.modules, {'coach_api.views': graph, 'curriculum_api.teams_weekly_calendar': normalization, 'curriculum_api.recordings_external': external}):
            result = self.ns['calendar_matches'](self.request())
        return result, graph.microsoft_graph_request

    def test_verified_view_reads_graph_only_and_never_exposes_invitation_links(self):
        result, graph = self.verified_view()
        self.assertEqual(result['data']['status'], 'verified')
        self.assertEqual(result['data']['matched'][0]['occurrenceId'], 'O1')
        self.assertEqual(graph.call_args.args[0], 'GET')
        self.assertNotIn(LINK, json.dumps(result))
        self.assertTrue(all(call.args[0].lstrip().startswith('SELECT') for call in self.ns['read'].call_args_list))

    def test_graph_failure_is_not_reported_as_verified_or_empty_success(self):
        result, _graph = self.verified_view(failure=True)
        self.assertEqual(result['status'], 503)
        self.assertNotIn('matched', result['data'])


if __name__ == '__main__':
    unittest.main()
