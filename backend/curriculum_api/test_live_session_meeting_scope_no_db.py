"""Which calendar delivers a live session -- the real functions, no Django setup or network."""
import ast
import unittest
from pathlib import Path
from unittest.mock import patch

NAMES = {'clean_str', 'parse_int', 'live_session_booked_on_module_calendar', 'module_has_booked_series',
         'live_session_meeting_scope', 'preserve_additional_meeting_settings'}


def load_functions():
    tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
    assert len(nodes) == len(NAMES)
    namespace = {
        'LIVE_SESSION_MEETING_SCOPE_KEY': 'teamsMeetingScope',
        'LIVE_SESSION_MEETING_SCOPES': ('main', 'additional'),
        'ADDITIONAL_MEETING_SETTING_KEYS': ('extraTeamsMeetingUrl', 'extraTeamsSubject'),
        'component_builder_settings': lambda row: row['settings_json'],
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'scope-functions', 'exec'), namespace)
    return namespace


class MeetingScopeTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.n = load_functions()
        self.scope = self.n['live_session_meeting_scope']

    def test_a_booking_outranks_the_stored_choice(self):
        self.assertEqual(self.scope({'extraTeamsMeetingUrl': 'https://x.invalid', 'teamsMeetingScope': 'main'}), 'additional')
        self.assertEqual(self.scope({'teamsOccurrenceId': 'OCC-1', 'teamsMeetingScope': 'additional'}), 'main')
        self.assertEqual(self.scope({'teamsSessionNumber': '2'}), 'main')

    def test_the_stored_choice_decides_an_unbooked_week(self):
        self.assertEqual(self.scope({'teamsMeetingScope': 'main'}), 'main')
        self.assertEqual(self.scope({'teamsMeetingScope': 'Additional'}), 'additional')

    def test_an_unassigned_week_is_pending_only_once_the_module_calendar_exists(self):
        self.assertEqual(self.scope({}, True), 'pending')
        self.assertEqual(self.scope({}, False), 'main')
        self.assertEqual(self.scope(None, False), 'main')
        self.assertEqual(self.scope({'teamsMeetingScope': 'nonsense'}, True), 'pending')

    def test_a_module_has_a_series_once_any_live_session_is_booked(self):
        has = self.n['module_has_booked_series']
        self.assertFalse(has([{}, {'teamsMeetingScope': 'main'}]))
        self.assertTrue(has([{}, {'teamsOccurrenceId': 'OCC-1'}]))


class PreserveScopeOnSaveTests(unittest.TestCase):
    def setUp(self):
        self.preserve = load_functions()['preserve_additional_meeting_settings']

    def test_a_builder_save_keeps_the_stored_choice(self):
        stored = {'settings_json': {'teamsMeetingScope': 'additional'}}
        self.assertEqual(self.preserve({'title': 'x'}, stored), {'title': 'x', 'teamsMeetingScope': 'additional'})

    def test_a_stale_builder_cannot_put_an_old_choice_back(self):
        stored = {'settings_json': {'teamsMeetingScope': 'additional'}}
        self.assertEqual(self.preserve({'teamsMeetingScope': 'main'}, stored)['teamsMeetingScope'], 'additional')
        self.assertNotIn('teamsMeetingScope', self.preserve({'teamsMeetingScope': 'main'}, {'settings_json': {}}))

    def test_a_new_or_copied_component_starts_undecided(self):
        self.assertEqual(self.preserve({'teamsMeetingScope': 'additional', 'a': 1}, None), {'a': 1})

    def test_a_booked_additional_meeting_is_still_restored(self):
        stored = {'settings_json': {'extraTeamsMeetingUrl': 'https://x.invalid', 'teamsMeetingScope': 'additional'}}
        kept = self.preserve({}, stored)
        self.assertEqual(kept['extraTeamsMeetingUrl'], 'https://x.invalid')
        self.assertEqual(kept['liveSessionUrl'], 'https://x.invalid')
        self.assertEqual(kept['teamsMeetingScope'], 'additional')


if __name__ == '__main__':
    unittest.main()
