"""Actual frozen-source parity for module reads; isolated Django harness only."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views
from curriculum_api.catalogue.api import module_reads
from curriculum_api.catalogue.application import delivery_schedules, module_projection, structure_payloads

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/module_get_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_module_gets():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<pre-module-get>', 'exec'), namespace)
            fn = namespace[name]
            old = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            old.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                old = eval(decorator, vars(views))(old)
            stack.enter_context(composition_fixture(views, name, old))
        yield


class ModuleGetParity(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        # Any accidental training/write dispatch in an ordinary GET must fail.
        # The removed function exists only as a failing port for frozen originals.
        self.provision = self.enterContext(composition_fixture(views, 'ensure_training_module_authoring_structure', create=True, side_effect=AssertionError('unexpected provision')))
        self.link = self.enterContext(composition_fixture(views, 'link_training_row_to_catalogue', side_effect=AssertionError('unexpected link')))
        for name in ('save_module_authoring_structure', 'delete_module_authoring_structure', 'repair_curriculum_parent_links'):
            self.enterContext(composition_fixture(views, name, side_effect=AssertionError('unexpected writer')))
        self.enterContext(composition_fixture(views, 'logger'))
        self.events = []
        @contextmanager
        def scope(**kwargs):
            self.events.append(('scope-enter', kwargs))
            try:
                yield
            finally:
                self.events.append(('scope-exit',))
        self.enterContext(composition_fixture(views, 'curriculum_read_scope', side_effect=scope))

    def compare(self, name, *args, owner=None, symbol=None):
        self.events.clear()
        with original_module_gets():
            expected = getattr(views, name)(*args)
        old_events = deepcopy(self.events)
        self.events.clear()
        with observe_export(views, owner, symbol, wraps=getattr(owner, symbol)) if owner else ExitStack() as called:
            actual = getattr(views, name)(*args)
        if owner:
            called.assert_called_once()
        self.assertEqual(self.events, old_events)
        if hasattr(actual, 'status_code'):
            self.assertEqual((actual.status_code, actual.content, dict(actual.items())),
                             (expected.status_code, expected.content, dict(expected.items())))
        else:
            self.assertEqual(actual, expected)
        return actual

    def structure(self, ident='MOD-A', request=None):
        return self.compare('curriculum_module_structure', request or self.factory.get('/structure/'), ident,
                            owner=module_reads, symbol='module_structure_response')

    def test_stored_structure_cache_and_revision_are_read_in_one_scope(self):
        def cache(key, factory, **kwargs):
            self.events.append(('cache', key, kwargs))
            return factory()
        def read(identifier):
            self.events.append(('read', identifier))
            return {'catalogueId': identifier, 'structureRevision': 'revision-A', 'weekStructure': []}
        with composition_fixture(views, 'resolve_stored_module_catalogue_id', return_value='MOD-A'), \
             composition_fixture(views, 'cached_curriculum_value', side_effect=cache), \
             composition_fixture(views, 'read_module_structure_with_revision', side_effect=read), \
             patch.object(structure_payloads, 'load_stored_module_structure', wraps=structure_payloads.load_stored_module_structure) as query:
            response = self.structure(' legacy-A ')
        query.assert_called_once()
        self.assertEqual(json.loads(response.content)['structureRevision'], 'revision-A')
        self.assertEqual([event[0] for event in self.events], ['scope-enter', 'cache', 'read', 'scope-exit'])
        # The original predicate returns its final empty string, not bool False.
        self.assertEqual(self.events[1], ('cache', 'module-structure:MOD-A', {'force': ''}))
        self.provision.assert_not_called()
        self.link.assert_not_called()

    def test_cache_bypass_keeps_the_existing_force_contract(self):
        with composition_fixture(views, 'resolve_stored_module_catalogue_id', return_value='MOD-A'), \
             composition_fixture(views, 'request_bypasses_curriculum_cache', return_value=True), \
             composition_fixture(views, 'cached_curriculum_value', return_value={'revision': 'cached'}) as cache:
            self.structure()
        self.assertTrue(all(call.kwargs == {'force': True} for call in cache.call_args_list))

    def test_cached_payload_does_not_acquire_a_newer_revision(self):
        cached = {'catalogueId': 'MOD-A', 'structureRevision': 'stale-revision', 'weekStructure': []}
        with composition_fixture(views, 'resolve_stored_module_catalogue_id', return_value='MOD-A'), \
             composition_fixture(views, 'cached_curriculum_value', return_value=cached), \
             composition_fixture(views, 'read_module_structure_with_revision', side_effect=AssertionError('cache hit rebuilt revision')):
            result = self.structure()
        self.assertEqual(json.loads(result.content)['structureRevision'], 'stale-revision')

    def test_unresolved_target_stays_uncached_and_preserves_revision_fallback(self):
        with composition_fixture(views, 'resolve_stored_module_catalogue_id', return_value=''), \
             composition_fixture(views, 'cached_curriculum_value', side_effect=AssertionError('cached missing target')), \
             composition_fixture(views, 'get_authoring_structure_payload', return_value={'catalogueId': 'MOD-A'}) as read, \
             composition_fixture(views, 'structure_payload_with_revision', side_effect=lambda factory, identifier: {**factory(), 'structureRevision': 'r'}):
            self.assertEqual(self.structure().status_code, 200)
        self.assertEqual(read.call_count, 2)

    def test_missing_and_empty_results_are_404(self):
        for payload in (None, {}):
            with composition_fixture(views, 'resolve_stored_module_catalogue_id', return_value='MOD-A'), \
                 composition_fixture(views, 'cached_curriculum_value', return_value=payload):
                self.assertEqual(self.structure().status_code, 404)

    def test_read_failure_preserves_sanitized_500_and_scope_exit(self):
        with composition_fixture(views, 'resolve_stored_module_catalogue_id', return_value='MOD-A'), \
             composition_fixture(views, 'cached_curriculum_value', side_effect=RuntimeError('private diagnostics')):
            response = self.structure()
        self.assertEqual(response.status_code, 500)
        self.assertNotIn(b'private diagnostics', response.content)
        self.assertEqual(self.events[-1], ('scope-exit',))

    def test_training_alias_removes_fabrication_and_get_writes_but_preserves_stored_content(self):
        # Demonstrate the former side effects with frozen source and synthetic
        # ports, then check the explicitly approved new read-only contract.
        for resolved in ('', 'MOD-ALREADY-LINKED'):
            with composition_fixture(views, 'resolve_stored_module_catalogue_id', return_value=resolved), \
                 composition_fixture(views, 'ensure_training_module_authoring_structure', side_effect=lambda ident: self.events.append(('provision', ident)) or {'catalogueId': 'MOD-CREATED'}), \
                 composition_fixture(views, 'stamp_revision_after_write', side_effect=lambda value, ident: self.events.append(('stamp', ident)) or value), \
                 composition_fixture(views, 'structure_payload_with_revision', side_effect=lambda factory, ident: factory()), \
                 composition_fixture(views, 'get_authoring_structure_payload', return_value={'catalogueId': resolved}), \
                 composition_fixture(views, 'link_training_row_to_catalogue', side_effect=lambda *args: self.events.append(('link', *args))), \
                 patch.object(module_reads, 'module_structure_response', side_effect=AssertionError('training path entered read boundary')):
                self.events.clear()
                with original_module_gets():
                    before = views.curriculum_module_structure(self.factory.get('/structure/'), 'training-module-17')
                self.assertEqual(before.status_code, 200)
                self.assertEqual([event[0] for event in self.events][-2:], ['scope-exit', 'link'])
                self.events.clear()
                result = views.curriculum_module_structure(self.factory.get('/structure/'), 'training-module-17')
                self.assertEqual(result.status_code, 200 if resolved else 404)
                self.assertEqual([event[0] for event in self.events], ['scope-enter', 'scope-exit'])
                if resolved:
                    self.assertEqual(result.content, before.content)

    def test_group_module_selection_keeps_order_duplicates_and_legacy_membership(self):
        payload = {'schema': 'curriculum', 'groups': [{'id': 'GROUP-A', 'moduleIds': ['MOD-LEGACY']}],
                   'modules': [{'id': 'MOD-1', 'groupId': 'GROUP-A'}, {'id': 'MOD-OTHER', 'groupId': 'GROUP-B'},
                               {'id': 'MOD-LEGACY'}, {'id': 'MOD-1', 'groupId': 'GROUP-A'}]}
        before = deepcopy(payload)
        with composition_fixture(views, 'get_cached_payload', return_value=payload):
            response = self.compare('curriculum_group_modules', self.factory.get('/groups/'), 'GROUP-A',
                                    owner=module_reads, symbol='curriculum_group_modules_get')
        self.assertEqual([row['id'] for row in json.loads(response.content)['results']], ['MOD-1', 'MOD-LEGACY', 'MOD-1'])
        self.assertEqual(payload, before)

    def test_group_missing_and_empty_membership_keep_distinct_results(self):
        for groups, status in (([], 404), ([{'id': 'GROUP-A'}], 200)):
            with composition_fixture(views, 'get_cached_payload', return_value={'schema': 'curriculum', 'groups': groups, 'modules': []}):
                result = self.compare('curriculum_group_modules', self.factory.get('/groups/'), 'GROUP-A',
                                      owner=module_reads, symbol='curriculum_group_modules_get')
                self.assertEqual(result.status_code, status)

    def test_session_plan_preserves_query_parameters_and_serialized_fields(self):
        query = ({'sessions': [{'sessionNumber': 1}]}, 'MOD-A', {'start_date': '2028-01-01', 'session_week_day': 'Monday', 'weeks_number': 2}, 3)
        request = self.factory.get('/plan/?weeks=3&sessions=9')
        with patch.object(delivery_schedules, 'load_module_session_plan', return_value=query) as load:
            response = self.compare('curriculum_module_session_plan', request, 'alias',
                                    owner=module_reads, symbol='curriculum_module_session_plan')
        self.assertEqual([call.args[1] for call in load.call_args_list], [request.GET, request.GET])
        self.assertEqual(json.loads(response.content)['weeks'], 3)

    def test_session_plan_missing_error_and_method_statuses(self):
        for value, status in ((None, 404), (RuntimeError('private diagnostics'), 500)):
            with patch.object(delivery_schedules, 'load_module_session_plan', **({'side_effect': value} if isinstance(value, Exception) else {'return_value': value})):
                response = self.compare('curriculum_module_session_plan', self.factory.get('/plan/'), 'MOD-A',
                                        owner=module_reads, symbol='curriculum_module_session_plan')
                self.assertEqual(response.status_code, status)
        self.assertEqual(self.compare('curriculum_module_session_plan', self.factory.post('/plan/'), 'MOD-A',
                                      owner=module_reads, symbol='curriculum_module_session_plan').status_code, 405)

    def test_module_detail_still_refuses_get_without_dispatching_a_reader(self):
        self.assertEqual(self.compare('curriculum_module_detail', self.factory.get('/detail/'), 'MOD-A').status_code, 405)

    def test_compact_projection_preserves_cached_inputs_and_count_semantics(self):
        modules = [{'id': 'MOD-A', 'sessionNames': ['A', 'B'], 'weekStructure': [{'id': 'W'}]},
                   {'id': 'MOD-B', 'sessionNames': None}, {}]
        before = deepcopy(modules)
        result = self.compare('compact_module_rows', modules, owner=module_projection, symbol='compact_module_rows')
        self.assertEqual([row['sessionNamesCount'] for row in result], [2, 0, 0])
        self.assertEqual(modules, before)
