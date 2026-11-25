"""Real import bindings and query transport with synthetic capabilities only."""
import importlib
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

MANIFEST = json.loads((Path(__file__).parents[2] /
    'catalogue/tests/fixtures/read_consumer_imports.json').read_text(encoding='utf-8'))


class ReadConsumerBindingsTests(SimpleTestCase):
    def test_module_bindings_are_the_same_concrete_objects_as_public_exports(self):
        from curriculum_api import views, learning_storage
        for entry in MANIFEST:
            name = entry['file'].removeprefix('backend/').removesuffix('.py').replace('/', '.')
            module = importlib.import_module(name)
            for binding in entry['bindings']:
                owner = importlib.import_module(binding['owner'])
                actual = getattr(owner, binding.get('original', binding['symbol']))
                facade = learning_storage if name == 'old_otjh.repository' else views
                with self.subTest(consumer=name, symbol=binding['symbol']):
                    self.assertIs(actual, getattr(facade, binding['symbol']))
                    if binding['scope'] == '<module>':
                        self.assertIs(getattr(module, binding['symbol']), actual)

    def test_hours_reader_keeps_selected_alias_parameters_and_json_decoding(self):
        from old_otjh import repository
        from curriculum_api.catalogue.infrastructure import course_storage_reads
        db = MagicMock()
        cursor = db.cursor.return_value.__enter__.return_value
        cursor.description = [('id',), ('metadata',), ('required_months',)]
        cursor.fetchall.return_value = [(7, '{"synthetic": true}', '["2026-01"]')]
        with patch.object(repository, 'connections', {'audit': db}), \
             patch.object(course_storage_reads, 'read_sql', return_value='SELECT synthetic') as route:
            rows = repository._query_rows('audit', 'SELECT input', ('value',))
        route.assert_called_once_with('SELECT input', db)
        cursor.execute.assert_called_once_with('SELECT synthetic', ('value',))
        self.assertEqual(rows, [{'id': 7, 'metadata': {'synthetic': True}, 'required_months': ['2026-01']}])

    def test_hours_reader_preserves_no_result_and_failure_semantics(self):
        from old_otjh import repository
        from curriculum_api.catalogue.infrastructure import course_storage_reads
        db = MagicMock()
        cursor = db.cursor.return_value.__enter__.return_value
        cursor.description = None
        with patch.object(repository, 'connections', {'audit': db}), \
             patch.object(course_storage_reads, 'read_sql', side_effect=lambda sql, db: sql):
            self.assertEqual(repository._query_rows('audit', 'SELECT input', ()), [])
            cursor.fetchall.assert_not_called()
            cursor.execute.side_effect = ValueError('synthetic read failure')
            with self.assertRaisesRegex(ValueError, 'synthetic read failure'):
                repository._query_rows('audit', 'SELECT input', ())
