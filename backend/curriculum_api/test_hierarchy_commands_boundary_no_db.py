"""Hierarchy HTTP/application parity against actual frozen pre-extraction bodies.

SimpleTestCase forbids DB access. Storage/provider capabilities are explicit
synthetic fixtures; this does not replace the disposable PostgreSQL checks.
"""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export
import copy
import json
from contextlib import ExitStack, contextmanager, nullcontext
from datetime import datetime
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from . import views
from .catalogue.api import programme_commands, cohort_commands, group_commands
from .catalogue.application import programme_tree
from .catalogue.infrastructure import hierarchy_writes
from .catalogue.tests.parity.hierarchy_commands_oracle import SNAPSHOT


@contextmanager
def original_hierarchy():
    """Old-to-old calls use the real facade globals, including test patches."""
    with ExitStack() as stack:
        for name, entry in SNAPSHOT['functions'].items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<pre-hierarchy-commands>', 'exec'), namespace)
            compiled = namespace[name]
            original = FunctionType(compiled.__code__, vars(views), name, compiled.__defaults__)
            original.__kwdefaults__ = compiled.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                original = eval(decorator, vars(views))(original)
            stack.enter_context(composition_fixture(views, name, original))
        yield


class FrozenClock(datetime):
    @staticmethod
    def utcnow():
        return datetime(2026, 1, 1)


class HierarchyCommandsParity(SimpleTestCase):
    def request(self, method, payload=None):
        return RequestFactory().generic(method, '/synthetic/',
                                        json.dumps(payload or {}), content_type='application/json')

    def pair(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    @contextmanager
    def fixtures(self, original, values=None):
        with ExitStack() as stack:
            events = []
            def recorder(name, result=None):
                def call(*args, **kwargs):
                    events.append((name, copy.deepcopy(args), copy.deepcopy(kwargs)))
                    return copy.deepcopy(result)
                return call
            @contextmanager
            def atomic():
                events.append(('begin', (), {}))
                try:
                    yield
                except Exception:
                    events.append(('rollback', (), {}))
                    raise
                else:
                    events.append(('commit', (), {}))
            defaults = dict(invalidate_curriculum_cache=recorder('invalidate'),
                            log_curriculum_decision=recorder('decision'),
                            notify_staff_assignment_change=recorder('notify'),
                            logger=Mock(), datetime=FrozenClock)
            for name, value in {**defaults, **(values or {})}.items():
                stack.enter_context(composition_fixture(views, name, value))
            stack.enter_context(patch.object(views.transaction, 'atomic', side_effect=atomic))
            stack.enter_context(patch.object(views.versioning, 'source', side_effect=lambda *a: nullcontext()))
            if original:
                stack.enter_context(original_hierarchy())
            yield events, recorder

    def test_tree_partial_hydration_and_scoped_removal_parity(self):
        for payload in (
            {'partialTree': True, 'cohorts': [{'groups': [{}]}]},
            {'partialTree': True, 'cohorts': [{'groups': [{'modules': [], 'modulesPartial': True}]}]},
            {'removeMissing': True},
            {'removeMissing': True, 'hydrationComplete': True},
            {'removeGroupIds': ['G', 'OTHER'], 'removeCohortIds': ['C', 'OTHER'], 'removeModuleIds': ['M', 'OTHER']},
        ):
            with self.subTest(payload=payload):
                def scenario(original):
                    with self.fixtures(original) as (events, record), ExitStack() as stack:
                        def rows(table, where, params):
                            if table == views.AUTHORING_MODULES_TABLE:
                                return [{'programme_id': 'P' if params[0] == 'M' else 'OTHER'}]
                            return [{'group_id': 'G'}] if table == views.GROUPS_TABLE else [{'cohort_id': 'C'}]
                        values = {
                            'upsert_programme_for_tree': Mock(side_effect=record('programme', {'id': 'P', 'name': 'Synthetic'})),
                            'save_tree_cohort': Mock(side_effect=record('cohort', {'id': 'C'})),
                            'save_tree_group': Mock(side_effect=record('group', {'id': 'G'})),
                            'save_tree_group_modules': Mock(side_effect=record('modules', ([{'id': 'M'}], ['REMOVED']))),
                            'fetch_cohort_row': Mock(side_effect=lambda key: {'cohort_id': key, 'programme_id': 'P' if key == 'C' else 'OTHER'}),
                            'fetch_group_row': Mock(side_effect=lambda key: {'group_id': key, 'programme_id': 'P' if key == 'G' else 'OTHER'}),
                            'authoring_fetch_all': rows,
                            'update_authoring_rows': record('write'),
                            'authoring_soft_delete': record('archive'),
                            'unassign_authoring_modules_from_group': record('detach', ['M']),
                            'repair_curriculum_parent_links': record('repair'),
                        }
                        for name, value in values.items():
                            stack.enter_context(composition_fixture(views, name, value))
                        response = views.curriculum_programme_tree_save(self.request('POST', payload))
                        return response.status_code, json.loads(response.content), events
                with patch.object(programme_tree, 'save_programme_tree', wraps=programme_tree.save_programme_tree) as invoked:
                    result = scenario(False)
                invoked.assert_called_once()
                self.assertEqual(result, scenario(True))
                self.assertEqual(result[0], 200)
                self.assertEqual(result[1]['removedMissing'], bool(payload.get('removeMissing') and payload.get('hydrationComplete')))
                self.assertEqual(result[2][0][0], 'begin')
                self.assertEqual(result[2][-1][0], 'commit')

    def test_tree_error_mapping_and_rollback_preserve_original(self):
        for error, status in ((ValueError('synthetic validation'), 400),
                              (RuntimeError('synthetic writer failure'), 500),
                              (views.ModuleAuthoringValidationError([{'path': 'module', 'message': 'synthetic'}]), 400),
                              (views.StaleModuleStructureWrite('MOD-SYNTHETIC', 'old', 'new'), 409)):
            with self.subTest(error=type(error).__name__):
                def scenario(original):
                    with self.fixtures(original, {'upsert_programme_for_tree': Mock(side_effect=error)}) as (events, _):
                        response = views.curriculum_programme_tree_save(self.request('POST'))
                        return response.status_code, json.loads(response.content), events
                actual = self.pair(scenario)
                self.assertEqual(actual[0], status)
                self.assertEqual([e[0] for e in actual[2]], ['begin', 'rollback'])

    def test_create_cohort_verifies_write_before_success(self):
        payload = {'id': 'C', 'name': 'Synthetic cohort', 'programme': 'Synthetic programme',
                   'programmeId': 'P', 'startDate': '2026-01-01', 'durationMonths': 12}
        for outcome, expected in (('stored', 201), ('missing', 500), ('failed', 500)):
            with self.subTest(outcome=outcome):
                def scenario(original):
                    values = {
                        'canonical_programme_id': lambda *a: 'P', 'unique_cohort_id': lambda *a: 'C',
                        'archived_authoring_ids': lambda *a: set(), 'cohort_authoring_detail_rows': lambda: [],
                        'get_holiday_rows': lambda: [],
                        'fetch_cohort_row': lambda *a: {'cohort_id': 'C'} if outcome == 'stored' else None,
                        'curriculum_cohort_from_authoring_detail': lambda detail: detail,
                    }
                    with self.fixtures(original, values) as (events, record):
                        persist = Mock(side_effect=RuntimeError('synthetic failure') if outcome == 'failed' else record('persist'))
                        with composition_fixture(views, 'persist_cohort_authoring_detail', persist):
                            response = views.create_curriculum_cohort(copy.deepcopy(payload))
                        self.assertTrue(persist.call_args.kwargs['raise_on_error'])
                        return response.status_code, json.loads(response.content), events
                actual = self.pair(scenario)
                self.assertEqual(actual[0], expected)

    def test_create_group_verifies_write_before_success(self):
        payload = {'id': 'G', 'name': 'Synthetic group', 'cohortId': 'C'}
        for outcome, expected in (('stored', 201), ('missing', 500), ('failed', 500)):
            with self.subTest(outcome=outcome):
                def scenario(original):
                    values = {
                        'resolve_cohort_row': lambda *a: {'cohort_id': 'C', 'cohort_name': 'Synthetic cohort', 'programme_id': 'P'},
                        'unique_group_id': lambda *a: 'G', 'archived_authoring_ids': lambda *a: set(),
                        'group_authoring_detail_rows': lambda: [], 'canonical_group_coaches': lambda *a: [],
                        'safe_authoring_module_rows': lambda: [],
                        'fetch_group_row': lambda *a: {'group_id': 'G'} if outcome == 'stored' else None,
                        'curriculum_group_from_authoring_detail': lambda detail: detail,
                    }
                    with self.fixtures(original, values) as (events, record):
                        persist = Mock(side_effect=RuntimeError('synthetic failure') if outcome == 'failed' else record('persist'))
                        with composition_fixture(views, 'persist_group_authoring_detail', persist):
                            response = views.create_curriculum_group(copy.deepcopy(payload))
                        self.assertTrue(persist.call_args.kwargs['raise_on_error'])
                        return response.status_code, json.loads(response.content), events
                actual = self.pair(scenario)
                self.assertEqual(actual[0], expected)

    def test_restore_parent_guards_and_write_order(self):
        for kind in ('cohort', 'group'):
            for state, status in (('missing', 404), ('active', 409), ('parent-archived', 409), ('archived', 200)):
                with self.subTest(kind=kind, state=state):
                    def scenario(original):
                        row = None if state == 'missing' else {kind + '_id': 'X', 'programme_id': 'P', 'cohort_id': 'C', 'status': 'active' if state == 'active' else 'inactive'}
                        values = {
                            'fetch_' + kind + '_row': lambda *a: row,
                            'resolve_' + kind + '_row': lambda *a: row,
                            'curriculum_row_is_archived': lambda r: r.get('status') == 'inactive',
                            'archived_parent_programme': lambda *a: {'name': 'Parent'} if state == 'parent-archived' else None,
                            'restore_soft_delete_payload': lambda *a: {'status': 'active'},
                            'has_column': lambda *a: False,
                        }
                        if kind == 'group':
                            values['fetch_cohort_row'] = lambda *a: {'status': 'inactive' if state == 'parent-archived' else 'active'}
                        with self.fixtures(original, values) as (events, record), \
                                composition_fixture(views, 'update_rows', side_effect=record('write')), \
                                composition_fixture(views, 'restore_rows_via_parent', side_effect=record('restore-children', [])):
                            response = getattr(views, 'curriculum_' + kind + '_restore')(self.request('POST'), 'X')
                            return response.status_code, json.loads(response.content), events
                    actual = self.pair(scenario)
                    self.assertEqual(actual[0], status)
                    if status != 200:
                        self.assertNotIn('write', [e[0] for e in actual[2]])

    def test_persistence_null_and_failure_contracts(self):
        for kind in ('cohort', 'group'):
            for failure in (False, True):
                for raise_on_error in (False, True):
                    with self.subTest(kind=kind, failure=failure, raise_on_error=raise_on_error):
                        def scenario(original):
                            values = {kind + '_authoring_payload': lambda *a: {kind + '_id': 'X', 'epa_months': None}}
                            with self.fixtures(original, values) as (events, record):
                                save = Mock(side_effect=RuntimeError('synthetic failure') if failure else record('upsert', {'id': 'X'}))
                                with composition_fixture(views, 'authoring_upsert', save):
                                    try:
                                        result = getattr(views, 'persist_' + kind + '_authoring_detail')({}, raise_on_error=raise_on_error)
                                        error = None
                                    except RuntimeError as exc:
                                        result, error = None, str(exc)
                                return result, error, save.call_args, events
                        actual = self.pair(scenario)
                        self.assertEqual(actual[1] is not None, failure and raise_on_error)

    def test_storage_updates_keep_null_scope_and_fallback_reads(self):
        for kind in ('cohort', 'group'):
            def scenario(original):
                with self.fixtures(original, {'fetch_' + kind + '_row': lambda *a: {'id': 'existing'}}) as (events, record), \
                        composition_fixture(views, 'update_authoring_rows', side_effect=record('update', [])):
                    values = {'color': None, 'epa_months': None, 'name': 'Synthetic'}
                    kwargs = {'allow_null_columns': ('epa_months',)} if kind == 'cohort' else {}
                    result = getattr(views, 'update_' + kind + '_fields')(' X ', values, **kwargs)
                    return result, events
            actual = self.pair(scenario)
            self.assertEqual(actual[0], {'id': 'existing'})
            written = actual[1][0][1][3]
            self.assertNotIn('color', written)
            self.assertEqual('epa_months' in written, kind == 'cohort')

    def test_invalid_http_methods_and_json_use_real_new_adapters(self):
        for owner, names in (
            (programme_commands, ('curriculum_programme_reorder', 'curriculum_programme_tree_save', 'curriculum_programme_restore')),
            (cohort_commands, ('curriculum_cohort_collection', 'curriculum_cohort_restore')),
            (group_commands, ('curriculum_group_collection', 'curriculum_group_restore', 'curriculum_group_modules')),
        ):
            for name in names:
                args = ['X'] if name.endswith(('restore', 'modules')) else []
                with self.subTest(name=name), observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
                    response = getattr(views, name)(self.request('PUT'), *args)
                    self.assertEqual(response.status_code, 405)
                    called.assert_called_once()
        response = views.curriculum_programme_tree_save(RequestFactory().post('/synthetic/', '{', content_type='application/json'))
        self.assertEqual(response.status_code, 400)

    def test_empty_group_attachment_post_appends_patch_replaces(self):
        for method in ('POST', 'PATCH'):
            def scenario(original):
                values = {
                    'resolve_group_row': lambda *a: {'group_id': 'G', 'cohort_id': 'C'},
                    'resolve_cohort_row': lambda *a: {'cohort_id': 'C'},
                    'serialize_group_authoring_detail': lambda row: row,
                    'serialize_cohort_authoring_detail': lambda row: row,
                    'curriculum_group_from_authoring_detail': lambda row: {'id': 'G', 'programmeId': 'P'},
                    'curriculum_cohort_from_authoring_detail': lambda row: {'id': 'C'},
                    'safe_authoring_module_rows': lambda: [],
                }
                with self.fixtures(original, values) as (events, record), \
                        composition_fixture(views, 'unassign_authoring_modules_from_group', side_effect=record('detach', ['M-OLD'])), \
                        composition_fixture(views, 'repair_curriculum_parent_links', side_effect=record('repair')):
                    response = views.curriculum_group_modules(self.request(method, {'modules': []}), 'G')
                    return response.status_code, json.loads(response.content), events
            actual = self.pair(scenario)
            self.assertEqual(actual[0], 200)
            self.assertEqual(actual[1]['removedModuleIds'], ['M-OLD'] if method == 'PATCH' else [])
            self.assertEqual(sum(e[0] == 'detach' for e in actual[2]), int(method == 'PATCH'))

    def test_permanent_delete_refusals_do_not_write(self):
        for kind in ('cohort', 'group'):
            for refusal in ('active', 'learners', 'references'):
                with self.subTest(kind=kind, refusal=refusal):
                    def scenario(original):
                        values = {
                            'curriculum_row_is_archived': lambda *a: refusal != 'active',
                            'archived_' + kind + '_learners': lambda *a: 2 if refusal == 'learners' else 0,
                            'authoring_fetch_all': lambda *a: [],
                            'permanent_delete_reference_refusal': lambda *a: views.json_error('synthetic reference refusal', status=409),
                        }
                        with self.fixtures(original, values) as (events, _):
                            response = getattr(views, 'permanent_' + kind + '_delete_response')({kind + '_id': 'X'})
                            return response.status_code, json.loads(response.content), events
                    actual = self.pair(scenario)
                    self.assertEqual(actual[0], 409)
                    self.assertEqual(actual[2], [])

    def test_attachment_structure_lock_precedes_revision_and_payload_read(self):
        for current, supplied, weeks, expected in (
            (None, None, [], None),
            ({'id': 'M'}, None, [], None),
            ({'id': 'M'}, 'r1', [{}], None),
            ({'id': 'M'}, 'stale', [{}], 'StaleModuleStructureWrite'),
            ({'id': 'M'}, None, [{}], 'StaleModuleStructureWrite'),
        ):
            def scenario(original):
                with self.fixtures(original, {'authoring_module_exists': lambda *a: current}) as (events, record), \
                        composition_fixture(views, 'lock_module_structure_row', side_effect=record('lock')), \
                        composition_fixture(views, 'module_structure_revision', side_effect=record('revision', 'r1')), \
                        composition_fixture(views, 'get_authoring_structure_payload', side_effect=record('payload', {'id': 'M'})):
                    try:
                        result = views.locked_attachment_structure({'weekStructure': weeks, 'structureRevision': supplied}, 'M')
                        error = None
                    except views.StaleModuleStructureWrite as exc:
                        result, error = None, type(exc).__name__
                    return result, error, events
            actual = self.pair(scenario)
            self.assertEqual(actual[1], expected)
            if current:
                self.assertEqual(actual[2][0][0], 'lock')
            if expected:
                self.assertNotIn('payload', [e[0] for e in actual[2]])
