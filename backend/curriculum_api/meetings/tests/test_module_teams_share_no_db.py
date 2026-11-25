"""The shared-module Teams owner resolver, without a database or Graph."""
import ast
import unittest
from pathlib import Path
from unittest.mock import Mock


class SharedTeamsOwnerTests(unittest.TestCase):
    def setUp(self):
        rows = {
            'ALIAS': {'module_catalogue_id': 'ALIAS', 'teams_shared_source_module_id': 'SOURCE'},
            'SOURCE': {'module_catalogue_id': 'SOURCE', 'teams_shared_source_module_id': ''},
        }
        self.fetch = Mock(side_effect=lambda _table, _where, values: [rows.get(str(values[0]), {})])
        namespace = {
            'AUTHORING_MODULES_TABLE': 'modules',
            'clean_str': lambda value: str(value or '').strip(),
            'authoring_fetch_all': self.fetch,
        }
        tree = ast.parse((Path(__file__).parents[2] / 'views.py').read_text(encoding='utf-8-sig'))
        node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'teams_module_owner_id')
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'teams-owner-function', 'exec'), namespace)
        self.owner = namespace['teams_module_owner_id']

    def test_shared_alias_resolves_to_source_without_copying_or_moving_identity(self):
        self.assertEqual(self.owner('ALIAS'), 'SOURCE')
        self.assertEqual([call.args[2] for call in self.fetch.call_args_list], [['ALIAS'], ['SOURCE']])

    def test_missing_or_cyclic_alias_is_bounded(self):
        self.fetch.side_effect = lambda _table, _where, values: [{
            'module_catalogue_id': values[0],
            'teams_shared_source_module_id': 'ALIAS',
        }]
        self.assertEqual(self.owner('ALIAS'), 'ALIAS')
        self.assertLessEqual(self.fetch.call_count, 2)


class SharedTeamsProjectionTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).parents[2] / 'views.py').read_text(encoding='utf-8-sig'))
        wanted = {
            node.name: node for node in tree.body
            if isinstance(node, ast.FunctionDef)
            and node.name in {'strip_shared_teams_delivery_settings', 'apply_shared_teams_settings_to_weeks'}
        }
        namespace = {
            '__name__': 'curriculum_api.views',
            '__package__': 'curriculum_api',
            'SHARED_TEAMS_DELIVERY_SETTING_KEYS': {
                'teamsLiveSessionId', 'teamsMeetingUrl', 'teamsOccurrenceId',
            },
            'clean_str': lambda value: str(value or '').strip(),
            'normalise_component_type': lambda value: str(value or '').replace('-', '_'),
            'teams_module_owner_id': lambda value: value,
            'shared_teams_component_settings': lambda _module_id: [{
                'teamsLiveSessionId': 'LIVE-SOURCE',
                'teamsMeetingUrl': 'https://teams.example/source',
                'teamsOccurrenceId': 'OCC-SOURCE',
                'sessionDate': '2026-12-30', 'sessionTime': '12:00', 'durationMinutes': 120,
            }],
        }
        exec(compile(ast.Module(body=[wanted['strip_shared_teams_delivery_settings'], wanted['apply_shared_teams_settings_to_weeks']], type_ignores=[]), 'shared-teams-projection', 'exec'), namespace)
        self.strip = namespace['strip_shared_teams_delivery_settings']
        self.apply = namespace['apply_shared_teams_settings_to_weeks']

    def test_alias_reads_source_links_but_keeps_its_own_authoring_settings(self):
        weeks = [{'components': [{
            'type': 'live-session',
            'settings': {'sessionPurpose': 'Keep this text'},
        }]}]
        self.apply({'teams_shared_source_module_id': 'SOURCE'}, weeks)
        self.assertEqual(weeks[0]['components'][0]['settings']['teamsLiveSessionId'], 'LIVE-SOURCE')
        self.assertEqual(weeks[0]['components'][0]['settings']['teamsMeetingUrl'], 'https://teams.example/source')
        self.assertEqual(weeks[0]['components'][0]['settings']['sessionPurpose'], 'Keep this text')

    def test_shared_week_heading_follows_the_confirmed_source_without_changing_ids(self):
        weeks = [{'id': 'ALIAS-WEEK', 'sessionDate': '2026-12-28', 'components': [
            {'id': 'ALIAS-LIVE', 'type': 'live-session', 'settings': {}}]}]
        self.apply({'teams_shared_source_module_id': 'SOURCE', 'start_date': '2026-12-01', 'end_date': '2027-01-31'}, weeks)
        self.assertEqual((weeks[0]['sessionDate'], weeks[0]['sessionDay']), ('2026-12-30', 'Wednesday'))
        self.assertEqual((weeks[0]['sessionStartTime'], weeks[0]['sessionDurationMinutes']), ('12:00', 120))
        self.assertEqual((weeks[0]['id'], weeks[0]['components'][0]['id']), ('ALIAS-WEEK', 'ALIAS-LIVE'))
        self.assertEqual(weeks[0]['components'][0]['settings']['teamsOccurrenceId'], 'OCC-SOURCE')

    def test_shared_booking_outside_the_alias_window_keeps_its_planned_heading(self):
        weeks = [{'sessionDate': '2026-12-14', 'components': [{'type': 'live-session', 'settings': {}}]}]
        self.apply({'teams_shared_source_module_id': 'SOURCE', 'end_date': '2026-12-20'}, weeks)
        self.assertEqual(weeks[0]['sessionDate'], '2026-12-14')
        self.assertEqual(weeks[0]['components'][0]['settings']['sessionDate'], '2026-12-30')

    def test_alias_save_payload_can_strip_source_owned_identity(self):
        stripped = self.strip({
            'sessionPurpose': 'Keep this text',
            'teamsLiveSessionId': 'LIVE-SOURCE',
            'teamsMeetingUrl': 'https://teams.example/source',
        })
        self.assertEqual(stripped, {'sessionPurpose': 'Keep this text'})

    def test_shared_clock_matches_source_even_when_alias_reading_weeks_differ(self):
        weeks = [{'id': 'W-ALIAS', 'components': [{
            'id': 'C-ALIAS', 'type': 'live-session',
            'settings': {'sessionDate': '2026-12-16', 'sessionTime': '09:00',
                         'durationMinutes': 60, 'liveSessionLinkOverride': 'https://teams.example/source'},
        }]}]
        self.apply({'teams_shared_source_module_id': 'SOURCE'}, weeks)
        card = weeks[0]['components'][0]
        self.assertEqual(card['id'], 'C-ALIAS')
        self.assertEqual(weeks[0]['id'], 'W-ALIAS')
        self.assertEqual((card['settings']['sessionDate'], card['settings']['sessionTime'],
                          card['settings']['durationMinutes']), ('2026-12-30', '12:00', 120))
        self.assertEqual(card['settings']['liveSessionUrl'], 'https://teams.example/source')
        self.assertEqual(card['settings']['teamsLiveSessionId'], 'LIVE-SOURCE')

    def test_a_different_alias_link_keeps_its_clock_without_borrowing_source_identity(self):
        weeks = [{'components': [{'type': 'live-session', 'settings': {
            'sessionDate': '2026-12-16', 'sessionTime': '09:00', 'durationMinutes': 60,
            'liveSessionLinkOverride': 'https://teams.example/own',
            'teamsLiveSessionId': 'STALE-SOURCE', 'teamsOccurrenceId': 'STALE-OCCURRENCE',
        }}]}]
        self.apply({'teams_shared_source_module_id': 'SOURCE'}, weeks)
        settings = weeks[0]['components'][0]['settings']
        self.assertEqual((settings['sessionDate'], settings['sessionTime'], settings['durationMinutes']),
                         ('2026-12-16', '09:00', 60))
        self.assertEqual(settings['liveSessionUrl'], 'https://teams.example/own')
        self.assertEqual(settings['teamsCalendarBinding'], 'unverified')
        self.assertNotIn('teamsLiveSessionId', settings)
        self.assertNotIn('teamsOccurrenceId', settings)


if __name__ == '__main__':
    unittest.main()
