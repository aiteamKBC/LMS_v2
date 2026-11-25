"""Concrete entry-point composition, original-source parity and fixture restoration."""
import ast
import copy
import importlib
from types import ModuleType
from unittest.mock import Mock

from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views
from curriculum_api.catalogue.tests.parity import entry_composition_oracle as oracle
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.test_entry_composition_standalone import AbsoluteImports, original
from curriculum_api.catalogue.infrastructure import row_queries
from curriculum_api.catalogue.api import responses


def old_function(name):
    fn = next(n for n in original().body if isinstance(n, ast.FunctionDef) and n.name == name)
    env = dict(vars(views))
    exec(compile(ast.fix_missing_locations(ast.Module(body=[AbsoluteImports().visit(copy.deepcopy(fn))], type_ignores=[])), '<original-entry>', 'exec'), env)
    return env[name]


class EntryCompositionParity(SimpleTestCase):
    def test_exports_are_same_functions_and_value_objects(self):
        for name, module in {**oracle.SNAPSHOT['manifest']['functions'], **oracle.SNAPSHOT['manifest']['constants']}.items():
            owner = importlib.import_module('curriculum_api.' + module)
            self.assertIs(getattr(views, name), getattr(owner, name), name)

    def test_fixture_reaches_concrete_lookup_and_restores_all_aliases(self):
        original_fetch = views.authoring_fetch_all
        replacement = Mock(return_value=[])
        with composition_fixture(views, 'authoring_fetch_all', replacement):
            self.assertIs(row_queries.authoring_fetch_all, replacement)
            row_queries.module_index_rows()
            replacement.assert_called_once()
        self.assertIs(views.authoring_fetch_all, original_fetch)
        self.assertIs(row_queries.authoring_fetch_all, original_fetch)

    def test_fixture_preserves_nested_patch_lifetime_and_unrelated_targets(self):
        original_fetch = views.authoring_fetch_all
        with composition_fixture(views, 'authoring_fetch_all', return_value=['outer']) as outer:
            inner = composition_fixture(views, 'authoring_fetch_all', return_value=['inner'])
            inner_mock = inner.start()
            self.assertIs(row_queries.authoring_fetch_all, inner_mock)
            inner.stop()
            self.assertIs(row_queries.authoring_fetch_all, outer)
        self.assertIs(row_queries.authoring_fetch_all, original_fetch)
        unrelated = ModuleType('unrelated'); unrelated.authoring_fetch_all = original_fetch
        with composition_fixture(unrelated, 'authoring_fetch_all', return_value=[]):
            self.assertIs(row_queries.authoring_fetch_all, original_fetch)

    def test_module_index_reads_preserve_arguments_rows_and_error_policy(self):
        for name in ('module_index_rows', 'get_authoring_module_rows', 'safe_authoring_module_rows', 'safe_module_index_rows'):
            outcomes = []
            for old in (True, False):
                rows = [{'module_catalogue_id': 'MOD-SYNTH', 'title': 'Synthetic'}]
                with composition_fixture(views, 'authoring_fetch_all', return_value=rows) as fetch:
                    fn = old_function(name) if old else getattr(views, name)
                    result = fn()
                    self.assertIs(result, rows)
                    outcomes.append((result, fetch.call_args_list))
            self.assertEqual(outcomes[0], outcomes[1], name)

    def test_json_input_and_error_status_contracts_preserve_original(self):
        factory = RequestFactory()
        for raw in ('{"name":"Synthetic"}', '[]', 'null', '{invalid'):
            req = factory.post('/synthetic', data=raw, content_type='application/json')
            self.assertEqual(responses.json_body(req), old_function('json_body')(req))
        for status in (400, 403, 409):
            current = responses.json_error('Synthetic error', status=status, detail='same')
            prior = old_function('json_error')('Synthetic error', status=status, detail='same')
            self.assertEqual((current.status_code, current.content, dict(current.items())),
                             (prior.status_code, prior.content, dict(prior.items())))

    def test_http_query_parameters_and_visibility_match_original(self):
        for query in ('?id=A&id=B,C', '?id=%20A%20&alternate=C', '?include_archived=true', '?visibility=ALL', ''):
            request = RequestFactory().get('/synthetic' + query)
            self.assertEqual(responses.csv_param(request, 'id', 'alternate'), old_function('csv_param')(request, 'id', 'alternate'))
            self.assertEqual(responses.curriculum_visibility(request), old_function('curriculum_visibility')(request))
