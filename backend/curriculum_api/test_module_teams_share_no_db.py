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


if __name__ == '__main__':
    unittest.main()
