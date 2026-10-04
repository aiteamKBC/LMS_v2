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
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
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
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
        wanted = {
            node.name: node for node in tree.body
            if isinstance(node, ast.FunctionDef)
            and node.name in {'strip_shared_teams_delivery_settings', 'apply_shared_teams_settings_to_weeks'}
        }
        namespace = {
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

    def test_alias_save_payload_can_strip_source_owned_identity(self):
        stripped = self.strip({
            'sessionPurpose': 'Keep this text',
            'teamsLiveSessionId': 'LIVE-SOURCE',
            'teamsMeetingUrl': 'https://teams.example/source',
        })
        self.assertEqual(stripped, {'sessionPurpose': 'Keep this text'})


if __name__ == '__main__':
    unittest.main()
