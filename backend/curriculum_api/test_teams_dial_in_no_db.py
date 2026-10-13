"""Run directly with Python. No database, credentials, network or Microsoft writes.

The meeting ID and passcode kept beside a join link (teams_dial_in.py):

* read from the onlineMeeting the caller already holds, else one Graph GET;
* never a write to Microsoft, and never ``updated_at`` (it picks the module's
  active calendar);
* skipped once captured for the same link, and before the columns exist;
* a Graph refusal is logged and skipped -- the save or sync carries on.
"""
import contextlib
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from django.conf import settings

if not settings.configured:
    settings.configure(DEFAULT_CHARSET='utf-8')

ROOT = Path(__file__).parent
for name, attrs in {'login': {}, 'login.permissions': {'require_role': lambda *roles: (lambda view: view)}}.items():
    try:
        __import__(name)
    except ImportError:
        module = sys.modules.setdefault(name, types.ModuleType(name))
        for key, value in attrs.items():
            setattr(module, key, value)

JOIN = 'https://teams.microsoft.com/meet/000111222333?p=synthetic'
MEETING = {'id': 'online-1', 'joinMeetingIdSettings': {'joinMeetingId': '000111222333', 'passcode': 'Synth3t1c'}}


class FakeViews(types.ModuleType):
    LIVE_SESSIONS_TABLE = 'live_sessions'

    def __init__(self):
        super().__init__('curriculum_api.views')
        self.columns = {'id', 'join_meeting_code', 'join_passcode', 'dial_in_join_url'}
        self.updates = []

    def column_names(self, table):
        return self.columns

    def teams_meeting_base_path(self, organizer, meeting_id, join_url=''):
        return f'users/{organizer}/onlineMeetings/{meeting_id}'

    LIVE_SESSION_OCCURRENCES_TABLE = 'live_session_occurrences'
    rows = {}

    def update_authoring_rows(self, table, where_sql, where_params, payload):
        self.updates.append((table, where_params, payload))

    def authoring_fetch_all(self, table, where_sql, params, order=''):
        return [row for row in self.rows.get(table, []) if all(row.get(key) == value for key, value in zip(
            ('id' if table == self.LIVE_SESSIONS_TABLE else 'live_session_id', 'join_url'), params))]

    def teams_online_meeting_from_join_url(self, organizer, join_url):
        return self.graph('GET', f'users/{organizer}/onlineMeetings?joinWebUrl={join_url}')


def load(fake_views, graph):
    package = types.ModuleType('curriculum_api')
    package.__path__ = [str(ROOT)]
    package.views = fake_views
    coach = types.ModuleType('coach_api')
    coach_views = types.ModuleType('coach_api.views')
    coach_views.microsoft_graph_request = graph
    coach_views.has_graph_credentials = lambda: True
    fake_views.graph = graph
    modules = {'curriculum_api': package, 'curriculum_api.views': fake_views,
               'coach_api': coach, 'coach_api.views': coach_views}
    with patch.dict(sys.modules, modules):
        spec = importlib.util.spec_from_file_location('curriculum_api.teams_dial_in', ROOT / 'teams_dial_in.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    module.transaction = types.SimpleNamespace(atomic=contextlib.nullcontext)
    return module, modules


class DialInTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.views = FakeViews()
        self.reply = MEETING

        def graph(method, path, **kwargs):
            self.calls.append((method, path))
            if isinstance(self.reply, Exception):
                raise self.reply
            return self.reply

        self.module, self.modules = load(self.views, graph)
        self.series = {'id': 'LIVE-1', 'join_url': JOIN, 'online_meeting_id': 'online-1', 'organizer_email': 'tutor'}

    def remember(self, series, meeting=None):
        with patch.dict(sys.modules, self.modules):
            return self.module.remember_teams_dial_in(series, meeting)

    def test_reads_the_meeting_once_and_stores_the_pair_with_its_link(self):
        self.assertTrue(self.remember(self.series))
        self.assertEqual(self.calls, [('GET', 'users/tutor/onlineMeetings/online-1')])
        self.assertEqual(self.views.updates, [('live_sessions', ['LIVE-1'], {
            'join_meeting_code': '000111222333', 'join_passcode': 'Synth3t1c', 'dial_in_join_url': JOIN})])

    def test_a_meeting_already_in_hand_needs_no_graph_call(self):
        self.assertTrue(self.remember(self.series, MEETING))
        self.assertEqual(self.calls, [])

    def test_skipped_once_captured_for_the_same_link(self):
        captured = {**self.series, 'dial_in_join_url': JOIN, 'join_meeting_code': '000111222333'}
        self.assertFalse(self.remember(captured))
        self.assertEqual((self.calls, self.views.updates), ([], []))

    def test_a_new_link_is_read_again(self):
        moved = {**self.series, 'dial_in_join_url': 'https://teams.microsoft.com/meet/old', 'join_meeting_code': '9'}
        self.assertTrue(self.remember(moved))
        self.assertEqual(len(self.calls), 1)

    def test_nothing_asked_before_the_columns_exist(self):
        self.views.columns = {'id'}
        self.assertFalse(self.remember(self.series))
        self.assertEqual((self.calls, self.views.updates), ([], []))

    def test_a_graph_refusal_is_skipped_not_raised(self):
        self.reply = RuntimeError('HTTP 403')
        self.assertFalse(self.remember(self.series))
        self.assertEqual(self.views.updates, [])

    def test_a_meeting_without_dial_in_stores_nothing(self):
        self.reply = {'id': 'online-1'}
        self.assertFalse(self.remember(self.series))
        self.assertEqual(self.views.updates, [])

    def test_no_link_no_call(self):
        self.assertFalse(self.remember({**self.series, 'join_url': ''}))
        self.assertEqual(self.calls, [])



class DialInEndpointTests(DialInTests):
    """The editor's read: stored pair first, else one Graph GET for a link of this series."""

    def ask(self, link):
        import json
        request = types.SimpleNamespace(method='GET', GET={'link': link})
        with patch.dict(sys.modules, self.modules):
            response = self.module.teams_meeting_dial_in(request, 'LIVE-1')
        return json.loads(response.content)

    def setUp(self):
        super().setUp()
        self.views.rows = {'live_sessions': [dict(self.series)], 'live_session_occurrences': [
            {'live_session_id': 'LIVE-1', 'join_url': 'https://teams.microsoft.com/meet/moved', 'online_meeting_id': ''}]}

    def test_stored_pair_is_answered_without_graph(self):
        self.views.rows['live_sessions'][0].update(dial_in_join_url=JOIN, join_meeting_code='9', join_passcode='p')
        self.assertEqual(self.ask(JOIN), {'joinUrl': JOIN, 'meetingId': '9', 'passcode': 'p'})
        self.assertEqual(self.calls, [])

    def test_unsynced_series_link_is_read_once_and_stored(self):
        self.assertEqual(self.ask(JOIN), {'joinUrl': JOIN, 'meetingId': '000111222333', 'passcode': 'Synth3t1c'})
        self.assertEqual(self.calls, [('GET', 'users/tutor/onlineMeetings/online-1')])
        self.assertEqual(len(self.views.updates), 1)

    def test_a_session_on_its_own_meeting_is_read_but_not_stored_on_the_series(self):
        moved = 'https://teams.microsoft.com/meet/moved'
        self.assertEqual(self.ask(moved)['meetingId'], '000111222333')
        self.assertEqual(self.views.updates, [])

    def test_a_link_from_elsewhere_is_never_looked_up(self):
        self.assertEqual(self.ask('https://teams.microsoft.com/meet/other'), {'joinUrl': '', 'meetingId': '', 'passcode': ''})
        self.assertEqual(self.calls, [])

    def test_a_graph_refusal_answers_blanks(self):
        self.reply = RuntimeError('HTTP 403')
        self.assertEqual(self.ask(JOIN)['meetingId'], '')


if __name__ == '__main__':
    unittest.main()
