"""Legacy public contracts point to actual feature owners; no database calls."""
import ast
from copy import deepcopy
import importlib
import inspect
import json
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase
from curriculum_api import views
from curriculum_api.review_management.tests.export_contracts import declared_callable
from curriculum_api.review_management.infrastructure import instance_schema

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/instance_boundary.json').read_text())


class InstanceContracts(SimpleTestCase):
    def test_every_original_callable_keeps_signature_and_actual_owner(self):
        original = ast.parse(FIXTURE['source'])
        decorated = 0
        for node in original.body:
            if not isinstance(node, ast.FunctionDef):
                continue
            with self.subTest(function=node.name):
                owner = importlib.import_module('curriculum_api.review_management.' + FIXTURE['owners'][node.name])
                actual = declared_callable('review_instances', node.name)
                self.assertIs(actual, getattr(owner, node.name))
                self.assertEqual(actual.__module__, owner.__name__)
                signature = deepcopy(node)
                signature.body, signature.decorator_list = [ast.Pass()], []
                namespace = {'OCCURRENCE_SOURCE_GENERATED': 'generated', 'STATUS_COMPLETED': 'completed'}
                exec(compile(ast.fix_missing_locations(ast.Module(body=[signature], type_ignores=[])), '<original-signature>', 'exec'), namespace)
                self.assertEqual(inspect.signature(actual), inspect.signature(namespace[node.name]))
                if node.decorator_list:
                    decorated += 1
                    self.assertTrue(hasattr(actual, '__wrapped__'))
                    self.assertEqual(actual.__code__.co_filename.replace('\\', '/').split('/')[-1], 'reconciliation_links.py')
        self.assertEqual(decorated, 10)

    def test_schema_reset_preserves_independent_gate_lifetimes(self):
        with patch.object(instance_schema, '_TABLES_READY', True), \
             patch.object(instance_schema, '_MANUAL_OVERRIDES_TABLE_READY', True), \
             patch.object(instance_schema, '_LEARNER_REVIEW_ADDITIONS_TABLE_READY', True), \
             patch.object(instance_schema, '_REOPENS_TABLE_READY', True):
            views.reset_schema_ready_flags()
            self.assertFalse(instance_schema._TABLES_READY)
            self.assertFalse(instance_schema._MANUAL_OVERRIDES_TABLE_READY)
            self.assertFalse(instance_schema._LEARNER_REVIEW_ADDITIONS_TABLE_READY)
            self.assertTrue(instance_schema._REOPENS_TABLE_READY)
        self.assertFalse((Path(__file__).parents[2] / 'review_instances.py').exists())
