"""Module command parity using actual frozen bodies and synthetic capabilities.

Only loaded in the isolated Django harness. SimpleTestCase forbids database
access; these fixtures do not validate provider delivery or the live schema.
"""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import copy
import json
from contextlib import ExitStack, contextmanager
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from . import views, learning_storage, module_collaboration
from .catalogue.api import module_commands, module_structure
from .catalogue.application import module_authoring, component_authoring
from .catalogue.tests.parity.module_commands_oracle import SNAPSHOT
from .test_hierarchy_commands_boundary_no_db import FrozenClock


@contextmanager
def original_module_commands():
    """Execute original function bodies against the same patched composition seam."""
    with ExitStack() as stack:
        for name, entry in SNAPSHOT['functions'].items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<pre-module-commands>', 'exec'), namespace)
            fn = namespace[name]
            original = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            original.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                original = eval(decorator, vars(views))(original)
            stack.enter_context(composition_fixture(views, name, original))
        yield


def request(method, payload=None):
    return RequestFactory().generic(method, '/synthetic/', json.dumps(payload or {}), content_type='application/json')


def response_value(response):
    return response.status_code, json.loads(response.content), dict(response.items())


def recording(events, name, result=None):
    def operation(*args, **kwargs):
        events.append((name, copy.deepcopy(args), copy.deepcopy(kwargs)))
        return copy.deepcopy(result)
    return Mock(side_effect=operation)


@contextmanager
def fixture_scope(original, values=None, *, atomic=True):
    events = []
    @contextmanager
    def transaction_scope():
        events.append(('begin', (), {}))
        try:
            yield
        except Exception:
            events.append(('rollback', (), {}))
            raise
        else:
            events.append(('commit', (), {}))
    with ExitStack() as stack:
        defaults = {
            'logger': Mock(), 'datetime': FrozenClock,
            'invalidate_curriculum_cache': recording(events, 'invalidate'),
            'notify_staff_assignment_change': recording(events, 'notify'),
            'log_curriculum_decision': recording(events, 'decision'),
        }
        for name, value in {**defaults, **(values or {})}.items():
            stack.enter_context(composition_fixture(views, name, value))
        if atomic:
            stack.enter_context(patch.object(views.transaction, 'atomic', side_effect=transaction_scope))
        stack.enter_context(patch.object(module_collaboration, 'enabled', return_value=False))
        stack.enter_context(patch.object(module_collaboration, 'check_structure_save', return_value=None))
        stack.enter_context(patch.object(module_collaboration, 'announce_saved', side_effect=recording(events, 'announce')))
        if original:
            stack.enter_context(original_module_commands())
        yield stack, events


def save_ports(events, stored=None, *, original=False):
    """Keep real payload/flag rules; replace reads, writes and external capabilities."""
    row = stored if stored is not None else {'module_catalogue_id': 'MOD-A', 'title': 'Before', 'status': 'active', 'programme_id': 'P'}
    def fetch(table, *args, **kwargs):
        events.append(('read', (table, *args), kwargs))
        return copy.deepcopy([row] if table == views.AUTHORING_MODULES_TABLE else [])
    def upsert(table, keys, payload, **kwargs):
        if original and table == views.AUTHORING_MODULES_TABLE:
            # Explicit approved nullable addition to the frozen writer contract.
            payload = {**payload, 'week_boundary_mode': None}
            kwargs = {**kwargs, 'allow_null_columns': kwargs['allow_null_columns'] | {'week_boundary_mode'}}
        events.append(('upsert', (table, keys, copy.deepcopy(payload)), copy.deepcopy(kwargs)))
        return copy.deepcopy(payload)
    ports = {
        'ensure_module_authoring_tables': recording(events, 'ensure'),
        'validate_module_authoring_payload': Mock(return_value=[]),
        'unique_module_catalogue_id': Mock(return_value='MOD-A'),
        'authoring_fetch_all': Mock(side_effect=fetch),
        'authoring_upsert': Mock(side_effect=upsert),
        'authoring_bulk_upsert': recording(events, 'bulk'),
        'authoring_soft_delete': recording(events, 'withdraw'),
        'write_changed_authoring_rows': recording(events, 'changed'),
        'delete_rows': recording(events, 'delete-related'),
        'sync_progress_ksbs': recording(events, 'sync-progress'),
        'ensure_programme_config_for_authoring': Mock(return_value={'sourceId': 'P'}),
        'module_withdrawn_on_its_own': Mock(return_value=False),
        'module_recovered_by_move_to_live': Mock(return_value=False),
        'programme_archived_for_authoring': Mock(return_value=False),
        'canonical_staff_assignment_name': Mock(return_value=''),
        'resolve_staff_assignment_email': Mock(return_value=''),
        'get_authoring_structure_payload': Mock(return_value={'catalogueId': 'MOD-A', 'weekStructure': []}),
        'module_authoring_quality_check': Mock(return_value=(['checked'], 70)),
        'stored_module_cover_image': Mock(side_effect=lambda identifier, image: image),
        'link_live_session_series_to_module': Mock(),
        'attach_teams_meeting_to_module_weeks': Mock(side_effect=AssertionError('provider path is out of scope')),
        'repair_curriculum_parent_links': recording(events, 'repair'),
        'json_db_value': Mock(side_effect=copy.deepcopy),
        'normalise_component_ksb_mappings': Mock(return_value=([], [])),
    }
    return ports


class ModuleCommandsParity(SimpleTestCase):
    def pair(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    def test_full_and_changed_only_save_payloads_and_write_order(self):
        for changed, build in ((False, True), (True, True), (True, False)):
            with self.subTest(changed=changed, build=build):
                def scenario(original):
                    calls = []
                    with fixture_scope(original, save_ports(calls, original=original)) as (stack, events):
                        stack.enter_context(composition_fixture(learning_storage, 'refresh_totals', side_effect=recording(events, 'totals')))
                        stack.enter_context(patch.object(views.ksb_mapping_placement, 'where', return_value=('module_catalogue_id = %s', ['MOD-A'])))
                        result = views.save_module_authoring_structure('MOD-A', {
                            'title': 'After', 'description': '', 'startDate': '', 'learnerRosterMode': 'manual',
                            'weekStructure': [{'id': 'WEEK-A', 'components': [
                                {'id': 'COMP-A', 'type': 'reading', 'title': 'Synthetic',
                                 'reflectionRequired': True, 'coachValidationRequired': False, 'settings': {}},
                            ]}],
                        }, write_changed_only=changed, build_result=build)
                    return result, calls, events
                with patch.object(module_authoring, 'save_module_authoring_structure', wraps=module_authoring.save_module_authoring_structure) as invoked:
                    actual = self.pair(scenario)
                invoked.assert_called_once()
                module_row = next(c[1][2] for c in actual[1] if c[0] == 'upsert')
                self.assertEqual((module_row['title'], module_row['learner_roster_mode'], module_row['start_date']), ('After', 'manual', None))
                self.assertEqual(any(c[0] == 'withdraw' for c in actual[1]), not changed)
                self.assertEqual(any(c[0] == 'changed' for c in actual[1]), changed)
                self.assertEqual([e[0] for e in actual[2]], ['begin', 'commit', 'totals', 'invalidate'])

    def test_validation_refuses_before_any_storage_call(self):
        for original in (False, True):
            calls = []
            ports = save_ports(calls)
            ports['validate_module_authoring_payload'] = Mock(return_value=[{'path': 'weeks', 'message': 'synthetic'}])
            with fixture_scope(original, ports):
                with self.assertRaises(views.ModuleAuthoringValidationError):
                    views.save_module_authoring_structure('MOD-A', {})
            self.assertEqual(calls, [])

    def test_light_save_reuses_locked_rows_without_global_reads_or_parent_repair(self):
        def scenario(original):
            calls = []
            stored = {'module_catalogue_id': 'MOD-A', 'title': 'Before', 'status': 'active', 'programme_id': 'P', 'programme_name': 'Synthetic'}
            values = save_ports(calls, stored, original=original)
            values['authoring_fetch_all'] = Mock(side_effect=AssertionError('light save reread locked rows'))
            values['unique_module_catalogue_id'] = Mock(side_effect=AssertionError('light save resolved known identity'))
            with fixture_scope(original, values) as (stack, events):
                stack.enter_context(composition_fixture(learning_storage, 'refresh_totals', return_value=None))
                result = views.save_module_authoring_structure('MOD-A', {
                    'title': 'Before', 'programmeName': 'Synthetic', 'weekStructure': [],
                }, light=True, write_changed_only=True, build_result=False,
                    stored_rows={views.AUTHORING_MODULES_TABLE: [stored]},
                    stored_structure={'catalogueId': 'MOD-A', 'weekStructure': []})
            values['repair_curriculum_parent_links'].assert_not_called()
            return result, calls, events
        result, calls, _ = self.pair(scenario)
        self.assertEqual(result['catalogueId'], 'MOD-A')
        self.assertTrue(any(c[0] == 'changed' for c in calls))

    def test_collection_match_duplicate_and_new_create_contracts(self):
        for existing, duplicate in ((True, False), (True, True), (False, False)):
            with self.subTest(existing=existing, duplicate=duplicate):
                def scenario(original):
                    values = {
                        'find_existing_authoring_catalogue_id_for_payload': Mock(return_value='MOD-A'),
                        'unique_module_catalogue_id': Mock(return_value='MOD-NEW'),
                        'authoring_module_exists': Mock(return_value={'module_catalogue_id': 'MOD-A'} if existing else None),
                        'get_authoring_structure_payload': Mock(return_value={'catalogueId': 'MOD-A'}),
                        'stamp_revision_after_write': Mock(side_effect=lambda p, i: {**p, 'structureRevision': 'r'}),
                        'save_module_authoring_structure': Mock(return_value={'catalogueId': 'MOD-NEW'}),
                    }
                    with fixture_scope(original, values) as (stack, events):
                        stack.enter_context(composition_fixture(learning_storage, 'creation_unavailable_response', return_value=None))
                        result = views.curriculum_module_collection(request('POST', {'title': 'Synthetic', 'moduleType': 'authoring', 'weeks': 3, 'duplicateDestination': duplicate}))
                        if original:
                            for saved in values['save_module_authoring_structure'].call_args_list:
                                saved.args[1].update(weekStartsOn=None, weekBoundaryMode=None)
                        return response_value(result), values['save_module_authoring_structure'].call_args_list, events
                result, calls, _ = self.pair(scenario)
                self.assertEqual(result[0], 200 if existing and not duplicate else 201)
                if existing and not duplicate:
                    self.assertEqual(calls, [])
                else:
                    self.assertEqual(calls[0].args[1]['weeksNumber'], 3)
                    self.assertNotIn('weeks', calls[0].args[1])

    def test_structure_full_guard_failure_and_success_contracts(self):
        for revision, fail in (('old', False), ('current', False), ('', False), ('current', True)):
            def scenario(original):
                calls = []
                values = structure_ports(calls, revision=revision, fail=fail)
                with fixture_scope(original, values) as (_, events):
                    result = views.curriculum_module_structure(request('PATCH', {'title': 'Edit', 'expectedRevision': 'current'}), 'MOD-A')
                    return response_value(result), calls, events
            result, calls, events = self.pair(scenario)
            self.assertEqual(result[0], 500 if fail else 200 if revision == 'current' else 409)
            self.assertEqual(any(c[0] == 'save' for c in calls), revision == 'current')
            if fail:
                self.assertIn('rollback', [e[0] for e in events])

    def test_partial_save_reads_result_after_commit_and_preserves_flags(self):
        def scenario(original):
            calls = []
            values = structure_ports(calls)
            values.update({
                'module_structure_source_rows': Mock(return_value={'synthetic': []}),
                'soft_deleted_structure_ids': Mock(return_value=set()),
                'merge_partial_module_structure': Mock(return_value={'title': 'Merged', 'weekStructure': []}),
                'read_module_structure_with_revision': recording(calls, 'read-result', {'catalogueId': 'MOD-A', 'structureRevision': 'after'}),
            })
            with fixture_scope(original, values) as (_, events):
                values['read_module_structure_with_revision'].side_effect = lambda i: (events.append(('read-result', (), {})) or {'catalogueId': i, 'structureRevision': 'after'})
                result = views.curriculum_module_structure(request('PATCH', {'saveMode': 'partial', 'expectedRevision': 'current', 'programmeStatus': 'active'}), 'MOD-A')
                return response_value(result), calls, events
        result, calls, events = self.pair(scenario)
        self.assertEqual(result[0], 200)
        save = next(c for c in calls if c[0] == 'save')
        self.assertEqual((save[2]['write_changed_only'], save[2]['light'], save[2]['build_result']), (True, True, False))
        self.assertLess([e[0] for e in events].index('commit'), [e[0] for e in events].index('read-result'))

    def test_detail_rename_uses_narrow_update_and_preserves_revision(self):
        def scenario(original):
            calls = []
            values = structure_ports(calls)
            values.update({
                'get_authoring_structure_payload': Mock(return_value={'catalogueId': 'MOD-A', 'title': 'Before', 'weekStructure': []}),
                'update_authoring_rows': recording(calls, 'rename'),
                'module_authoring_quality_check': Mock(return_value=(['checked'], 70)),
            })
            with fixture_scope(original, values) as (_, events):
                result = views.curriculum_module_detail(request('PATCH', {'name': 'After'}), 'MOD-A')
                return response_value(result), calls, events
        result, calls, _ = self.pair(scenario)
        self.assertEqual(result[0], 200)
        self.assertFalse(any(c[0] == 'save' for c in calls))
        self.assertEqual(next(c[1][3]['title'] for c in calls if c[0] == 'rename'), 'After')

    def test_component_context_existing_and_new_parent_contract(self):
        for existing in (False, True):
            def scenario(original):
                calls = []
                values = {
                    'ensure_module_authoring_tables': Mock(),
                    'authoring_module_exists': Mock(return_value={'title': 'Synthetic'} if existing else None),
                    'authoring_fetch_all': Mock(return_value=[{'id': 'WEEK-A'}] if existing else []),
                    'canonical_authoring_id': Mock(return_value='WEEK-A'),
                    'authoring_upsert': recording(calls, 'upsert'),
                }
                with fixture_scope(original, values):
                    result = views.component_context_for_payload({'moduleCatalogueId': 'MOD-A', 'weekNumber': 2})
                return result, calls
            with patch.object(component_authoring, 'component_context_for_payload', wraps=component_authoring.component_context_for_payload) as invoked:
                result, calls = self.pair(scenario)
            invoked.assert_called_once()
            self.assertEqual(result, ('MOD-A', 'WEEK-A', 2))
            self.assertEqual(len(calls), 0 if existing else 2)

    def test_component_save_keeps_flags_and_settings_and_mapping_write_order(self):
        def scenario(original):
            calls = []
            row = {'id': 'COMP-A', 'reflection_required': True, 'coach_validation_required': False, 'settings_json': {'kept': 1}}
            values = save_ports(calls)
            values.update({
                'component_context_for_payload': Mock(return_value=('MOD-A', 'WEEK-A', 1)),
                'canonical_authoring_id': Mock(return_value='COMP-A'),
                'authoring_fetch_all': Mock(side_effect=lambda table, *a, **kw: [copy.deepcopy(row)] if table == views.AUTHORING_COMPONENTS_TABLE else []),
                'component_builder_response': Mock(side_effect=lambda r, *a: r),
            })
            with fixture_scope(original, values):
                result = views.save_component_builder_payload({'id': 'COMP-A', 'type': 'reading', 'title': 'After', 'settings': {'incoming': 2}})
            return result, calls
        result, calls = self.pair(scenario)
        row = next(c[1][2] for c in calls if c[0] == 'upsert')
        self.assertTrue(row['reflection_required'])
        self.assertFalse(row['coach_validation_required'])
        self.assertEqual((row['settings_json']['kept'], row['settings_json']['incoming']), (1, 2))
        self.assertEqual([c[0] for c in calls], ['upsert', 'withdraw', 'bulk'])

    def test_unsupported_methods_keep_405_contract(self):
        for symbol, args in (('curriculum_module_collection', ()), ('curriculum_module_detail', ('MOD-A',)), ('curriculum_module_structure', ('MOD-A',))):
            def scenario(original):
                with fixture_scope(original, {'resolve_stored_module_catalogue_id': Mock(return_value='')}) as (_, events):
                    return response_value(getattr(views, symbol)(request('PUT'), *args)), events
            self.assertEqual(self.pair(scenario)[0][0], 405)

    def test_missing_noncanonical_target_and_partial_without_revision_are_refused(self):
        for identifier, stored, payload, expected in (
            ('missing-alias', '', {}, 404),
            ('MOD-A', 'MOD-A', {'saveMode': 'partial'}, 400),
        ):
            def scenario(original):
                ports = structure_ports([])
                ports['resolve_stored_module_catalogue_id'] = Mock(return_value=stored)
                with fixture_scope(original, ports) as (stack, _):
                    stack.enter_context(composition_fixture(learning_storage, 'creation_unavailable_response', return_value=None))
                    result = views.curriculum_module_structure(request('PATCH', payload), identifier)
                ports['save_module_authoring_structure'].assert_not_called()
                return response_value(result)
            self.assertEqual(self.pair(scenario)[0], expected)

    def test_cover_staff_gate_refuses_before_storage(self):
        for account, expected in ((None, 401), (SimpleNamespace(role='learner'), 403)):
            def scenario(original):
                storage = Mock(side_effect=AssertionError('unauthorized write'))
                with fixture_scope(original, {'stored_module_cover_image': storage}), \
                     patch('login.permissions.authenticate_request', return_value=account):
                    result = views._update_module_cover(request('PATCH'), 'MOD-A', {'coverImage': ''})
                storage.assert_not_called()
                return response_value(result)
            self.assertEqual(self.pair(scenario)[0], expected)


def structure_ports(events, revision='current', fail=False):
    def save(*args, **kwargs):
        events.append(('save', copy.deepcopy(args), copy.deepcopy(kwargs)))
        if fail:
            raise ValueError('synthetic save failure')
        return {'catalogueId': 'MOD-A', 'weekStructure': []}
    return {
        'resolve_stored_module_catalogue_id': Mock(return_value='MOD-A'),
        'authoring_module_exists': Mock(return_value={'module_catalogue_id': 'MOD-A', 'title': 'Before', 'status': 'active'}),
        'archived_programme_module_edit_error': Mock(return_value=None),
        'lock_module_structure_row': recording(events, 'lock'),
        'module_structure_revision': recording(events, 'revision', revision),
        'get_authoring_structure_payload': Mock(return_value={'catalogueId': 'MOD-A', 'weekStructure': []}),
        'structure_payload_with_revision': Mock(return_value={'catalogueId': 'MOD-A', 'structureRevision': revision}),
        'save_module_authoring_structure': Mock(side_effect=save),
    }
