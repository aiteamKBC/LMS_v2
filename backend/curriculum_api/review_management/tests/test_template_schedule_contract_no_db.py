"""Public Review call contracts and owner state; isolated Django, no database."""
import ast
import importlib
import inspect
import json
from pathlib import Path
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from curriculum_api import views
from curriculum_api.review_management.tests.export_contracts import declared_callable
from curriculum_api.review_management.api import commands, templates, schedule, types
from curriculum_api.review_management.infrastructure import template_schema, schedule_schema, type_schema

SNAPSHOT = json.loads((Path(__file__).parent / 'fixtures/template_schedule_boundary.json').read_text())


class TemplateScheduleContracts(SimpleTestCase):
    def test_legacy_callable_signatures_and_actual_owners(self):
        wrappers = {'create_review', 'update_review', 'archive_review', 'create_review_type',
                    'rename_review_type', 'archive_review_type', 'resolve_clash_decision'}
        for entry in SNAPSHOT['symbols']:
            if entry['kind'] != 'FunctionDef': continue
            with self.subTest(entry=entry['name']):
                function = declared_callable(entry['old'], entry['name'])
                owner = 'api.commands' if entry['name'] in wrappers else entry['owner']
                actual_owner = importlib.import_module('curriculum_api.review_management.' + owner)
                self.assertIs(function, getattr(actual_owner, entry['name']))
                self.assertEqual(function.__module__, actual_owner.__name__)
                source = ast.parse(SNAPSHOT['sources'][entry['old']])
                old = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == entry['name'])
                old.decorator_list = []
                old.body = [ast.Pass()]
                namespace = {'DEFAULT_PREVIEW_MONTHS': 12}
                exec(compile(ast.fix_missing_locations(ast.Module(body=[old], type_ignores=[])), '<signature-only>', 'exec'), namespace)
                self.assertEqual(inspect.signature(function), inspect.signature(namespace[entry['name']]))

    def test_http_compatibility_exports_are_the_real_api_functions(self):
        for old, owner, names in (
            ('reviews', templates, ('curriculum_programme_review_collection', 'curriculum_review_detail', 'curriculum_review_clone')),
            ('review_schedule', schedule, ('curriculum_programme_review_schedule', 'curriculum_programme_review_clash_resolve')),
            ('review_types', types, ('curriculum_review_type_collection', 'curriculum_review_type_detail')),
        ):
            for name in names:
                self.assertIs(declared_callable(old, name), getattr(owner, name))
                self.assertTrue(getattr(owner, name).csrf_exempt)

    def test_schema_reset_reaches_the_only_flag_owners(self):
        with patch.object(template_schema, '_REVIEW_TABLES_READY', True), \
             patch.object(schedule_schema, '_REVIEW_SCHEDULE_TABLES_READY', True), \
             patch.object(type_schema, '_TABLE_READY', True):
            views.reset_schema_ready_flags()
            self.assertFalse(template_schema._REVIEW_TABLES_READY)
            self.assertFalse(schedule_schema._REVIEW_SCHEDULE_TABLES_READY)
            self.assertFalse(type_schema._TABLE_READY)
        for name in ('reviews', 'review_schedule', 'review_types'):
            self.assertFalse((Path(__file__).parents[2] / (name + '.py')).exists())

    def test_runtime_composition_passes_the_existing_cache_capability(self):
        cache = Mock()
        result = object()
        with patch.object(commands, 'invalidate_curriculum_cache', cache), \
             patch.object(commands, '_create_review', return_value=result) as use_case:
            payload = {'name': 'Synthetic review'}
            self.assertIs(commands.create_review('P', payload, actor='staff'), result)
            use_case.assert_called_once_with('P', payload, actor='staff', invalidate_curriculum_cache=cache)
            cache.assert_not_called()  # The application retains the original call timing.
