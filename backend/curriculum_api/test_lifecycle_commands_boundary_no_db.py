"""Lifecycle parity against actual frozen implementations, using synthetic ports.

Loaded only by the isolated Django runner. SimpleTestCase forbids all DB access.
Provider guards are injected; no provider behavior is exercised here.
"""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import copy
from contextlib import ExitStack, contextmanager
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase
from . import views, module_collaboration
from .catalogue.application import programme_lifecycle
from .catalogue.infrastructure import database_reads
from .catalogue.tests.parity.lifecycle_commands_oracle import SNAPSHOT
from .test_hierarchy_commands_boundary_no_db import FrozenClock
from .test_module_commands_boundary_no_db import recording, request, response_value


@contextmanager
def original_lifecycle():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT['functions'].items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<pre-lifecycle>', 'exec'), namespace)
            fn = namespace[name]
            original = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            original.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                original = eval(decorator, vars(views))(original)
            stack.enter_context(composition_fixture(views, name, original))
        yield


@contextmanager
def lifecycle_scope(original, events, values=None, *, atomic=True):
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
    defaults = {
        'logger': Mock(), 'datetime': FrozenClock,
        'ensure_module_authoring_tables': Mock(),
        'ensure_program_config_archive_columns': Mock(),
        'invalidate_curriculum_cache': recording(events, 'invalidate'),
        'log_curriculum_storage': recording(events, 'storage'),
        'log_curriculum_decision': recording(events, 'decision'),
    }
    with ExitStack() as stack:
        for name, value in {**defaults, **(values or {})}.items():
            stack.enter_context(composition_fixture(views, name, value))
            if name in {"table_name", "authoring_table_name", "has_column", "column_names", "fetch_all"}:
                stack.enter_context(patch.object(database_reads, name, value))
        if atomic:
            stack.enter_context(patch.object(views.transaction, 'atomic', side_effect=transaction_scope))
        stack.enter_context(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')))
        if original:
            stack.enter_context(original_lifecycle())
        yield stack


def programme_ports(events):
    return {
        'programme_config_by_identifier': Mock(return_value={'programme_id': 'P', 'name': 'Synthetic'}),
        'programme_config_identity': Mock(return_value='P'),
        'programme_config_key_column': Mock(return_value='programme_id'),
        'programme_identifier_candidates': Mock(return_value=['P']),
        'orphan_programme_name_clause': Mock(return_value=("programme_name = %s", ['Synthetic'])),
        'authoring_table_name': Mock(side_effect=lambda table: 'curriculum.' + table),
        'soft_delete_payload': Mock(return_value={'status': 'inactive'}),
        'restore_soft_delete_payload': Mock(return_value={'status': 'active'}),
        'restore_payload': Mock(return_value={'notes': 'restored'}),
        'update_rows': recording(events, 'update', [{'id': 'synthetic'}]),
        'authoring_soft_delete': recording(events, 'archive', [{'id': 'synthetic'}]),
        'restore_rows_via_parent': recording(events, 'restore', [{'id': 'synthetic'}]),
    }


def deletion_plan():
    return {'candidates': ['P'], 'childIds': {'cohortIds': ['C'], 'groupIds': ['G'],
            'moduleIds': ['M'], 'weekIds': ['W'], 'componentIds': ['X'], 'weekTemplateIds': ['T']},
            'blockers': [], 'learners': 0}


def record_request(events, name, result=None):
    def operation(req, *args, **kwargs):
        # Compare request content, not identity of two separate RequestFactory
        # instances. Preserve every remaining argument and its ordering.
        events.append((name, (req.method, req.path, req.body, *copy.deepcopy(args)), copy.deepcopy(kwargs)))
        return result
    return Mock(side_effect=operation)


class LifecycleBoundaryParity(SimpleTestCase):
    def compare(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    def programme(self, original, restore=False, fail=None):
        events = []
        values = programme_ports(events)
        if fail == 'parent':
            values['update_rows'] = Mock(side_effect=ValueError('parent refused'))
        if fail == 'child':
            values['restore_rows_via_parent' if restore else 'authoring_soft_delete'] = Mock(side_effect=ValueError('child refused'))
        with lifecycle_scope(original, events, values):
            try:
                result = (views.restore_programme_authoring_structure if restore else views.soft_delete_programme_authoring_structure)('alias-P')
            except ValueError as exc:
                result = ('error', str(exc))
        return result, events

    def test_programme_archive_invokes_real_owner_and_keeps_scopes(self):
        with patch.object(programme_lifecycle, 'soft_delete_programme_authoring_structure', wraps=programme_lifecycle.soft_delete_programme_authoring_structure) as invoked:
            actual = self.programme(False)
        invoked.assert_called_once()
        self.assertEqual(actual, self.programme(True))
        writes = [e for e in actual[1] if e[0] == 'archive']
        self.assertEqual(len(writes), 6)
        self.assertTrue(all(e[2]['via_parent'] == 'P' for e in writes))
        self.assertIn('component_id in', writes[-1][1][1])
        self.assertEqual(actual[1][-1][0], 'invalidate')

    def test_archive_parent_failure_still_archives_children_as_before(self):
        result, events = self.compare(lambda old: self.programme(old, fail='parent'))
        self.assertFalse(result['programmeArchived'])
        self.assertEqual(len([e for e in events if e[0] == 'archive']), 6)

    def test_archive_child_failure_propagates_without_invalidation(self):
        result, events = self.compare(lambda old: self.programme(old, fail='child'))
        self.assertEqual(result, ('error', 'child refused'))
        self.assertNotIn('invalidate', [e[0] for e in events])

    def test_programme_restore_only_delegates_to_owned_cascade(self):
        result, events = self.compare(lambda old: self.programme(old, restore=True))
        self.assertTrue(result['programmeRestored'])
        restored = [e for e in events if e[0] == 'restore']
        self.assertEqual(len(restored), 6)
        self.assertTrue(all(e[1][1] == 'P' for e in restored))

    def test_restore_errors_propagate_before_invalidation(self):
        for failure in ('parent', 'child'):
            with self.subTest(failure=failure):
                result, events = self.compare(lambda old: self.programme(old, restore=True, fail=failure))
                self.assertEqual(result, ('error', failure + ' refused'))
                self.assertNotIn('invalidate', [e[0] for e in events])

    def test_programme_deletion_order_force_and_content_refusal(self):
        def scenario(original, force, refuse):
            events = []
            values = {'table_exists': Mock(return_value=True),
                      'programme_config_key_column': Mock(return_value='programme_id'),
                      'refuse_if_programme_owns_content': recording(events, 'content-check'),
                      'unhook_programme_reusables': recording(events, 'unhook'),
                      'delete_rows': recording(events, 'delete', [{'id': 'synthetic'}]),
                      'calendar_holidays': SimpleNamespace(release_cohorts=recording(events, 'holidays')),
                      'group_coaches': SimpleNamespace(release_groups=recording(events, 'coaches'))}
            if refuse:
                values['refuse_if_programme_owns_content'] = Mock(side_effect=views.ProgrammeContentRetained('retained'))
            with lifecycle_scope(original, events, values):
                try:
                    result = views.permanently_delete_programme_structure(deletion_plan(), force_content=force)
                except views.ProgrammeContentRetained:
                    result = 'retained'
            return result, events
        for force, refuse in ((False, False), (True, False), (False, True)):
            with self.subTest(force=force, refuse=refuse):
                result, events = self.compare(lambda old: scenario(old, force, refuse))
                deleted = [e[1][0] for e in events if e[0] == 'delete']
                if refuse:
                    self.assertEqual(deleted, [])
                else:
                    self.assertEqual(events[0][0], 'unhook' if force else 'content-check')
                    self.assertEqual(deleted[-1], 'programmes')
                    self.assertEqual(views.AUTHORING_COMPONENTS_TABLE in deleted, force)
                    self.assertNotIn('quizzes', deleted)
                    self.assertNotIn('week_templates', deleted)

    def test_reusables_are_detached_using_existing_sentinel(self):
        def scenario(original):
            events, removed = [], {}
            values = {'table_exists': Mock(return_value=True), 'has_column': Mock(return_value=True),
                      'update_rows': recording(events, 'update', [{'id': 'synthetic'}])}
            with lifecycle_scope(original, events, values):
                views.unhook_programme_reusables(deletion_plan(), removed)
            return removed, events
        result, events = self.compare(scenario)
        self.assertEqual(len(events), 2)
        self.assertTrue(all(e[0] == 'update' for e in events))
        self.assertEqual(events[0][1][3]['programme_id'], views.DETACHED_PARENT_SENTINEL)

    def test_module_archive_is_atomic_and_quizzes_precede_children(self):
        def scenario(original, fail):
            events = []
            values = {'authoring_fetch_all': Mock(return_value=[{'module_catalogue_id': 'M'}]),
                      'archive_module_child_quizzes': recording(events, 'quizzes', [17]),
                      'authoring_soft_delete': recording(events, 'archive', []),
                      'ksb_mapping_placement': SimpleNamespace(where=Mock(return_value=('component_id in (%s)', ['X'])))}
            if fail:
                values['authoring_soft_delete'] = Mock(side_effect=ValueError('synthetic failure'))
            with lifecycle_scope(original, events, values):
                try:
                    result = views.delete_module_authoring_structure(' M ')
                except ValueError:
                    result = 'failure'
            return result, events
        for fail in (False, True):
            result, events = self.compare(lambda old: scenario(old, fail))
            self.assertEqual([e[0] for e in events[:2]], ['begin', 'quizzes'])
            self.assertEqual(events[-1][0], 'rollback' if fail else 'invalidate')

    def test_programme_http_outcomes_and_post_commit_verification(self):
        def scenario(original, case):
            events, plan = [], deletion_plan()
            if case == 'learners':
                plan['blockers'] = [{'count': 1}]
            values = {'is_archived_program_config': Mock(return_value=case != 'live'),
                      'programme_status_is_archived': Mock(return_value=False),
                      'programme_permanent_delete_plan': recording(events, 'plan', plan),
                      'permanent_delete_reference_refusal': Mock(return_value=None),
                      'permanently_delete_programme_structure': recording(events, 'delete', {'programmes': 1}),
                      'programme_config_rows_remaining': recording(events, 'remaining', case == 'remaining')}
            if case in ('database', 'content'):
                error = DatabaseError('synthetic restricted') if case == 'database' else views.ProgrammeContentRetained('synthetic retained')
                values['permanently_delete_programme_structure'] = Mock(side_effect=error)
            with lifecycle_scope(original, events, values):
                result = response_value(views.permanent_programme_delete_response('P', {}, {'programme_id': 'P'}))
            return result, events
        for case in ('success', 'live', 'learners', 'remaining', 'database', 'content'):
            with self.subTest(case=case):
                result, events = self.compare(lambda old: scenario(old, case))
                self.assertEqual(result[0], 200 if case == 'success' else 409)
                names = [e[0] for e in events]
                if case in ('success', 'remaining'):
                    self.assertLess(names.index('commit'), names.index('invalidate'))
                    self.assertLess(names.index('invalidate'), names.index('remaining'))
                if case in ('live', 'learners'):
                    self.assertNotIn('begin', names)

    def test_module_restore_method_missing_live_parent_and_success(self):
        def scenario(original, case):
            events = []
            values = {'resolve_stored_module_catalogue_id': Mock(return_value='M'),
                      'authoring_module_exists': Mock(return_value=None if case == 'missing' else {'module_catalogue_id': 'M', 'programme_id': 'P'}),
                      'curriculum_row_effectively_deleted': Mock(return_value=case != 'live'),
                      'archived_parent_programme': Mock(return_value={'name': 'Synthetic'} if case == 'parent' else None),
                      'module_archive_event_bounds': Mock(return_value=('start', 'end')),
                      'restore_rows_via_parent': recording(events, 'restore', [{'id': 'synthetic'}]),
                      'restore_soft_delete_payload': Mock(return_value={'status': 'active'}),
                      'update_rows': recording(events, 'update', [])}
            with lifecycle_scope(original, events, values):
                result = response_value(views.curriculum_module_restore(request('GET' if case == 'method' else 'POST'), 'alias-M'))
            return result, events
        for case, status in (('method', 405), ('missing', 404), ('live', 409), ('parent', 409), ('success', 200)):
            with self.subTest(case=case):
                result, events = self.compare(lambda old: scenario(old, case))
                self.assertEqual(result[0], status)
                restores = [e for e in events if e[0] == 'restore']
                self.assertEqual(len(restores), len(views.MODULE_CHILD_AUTHORING_TABLES) if case == 'success' else 0)
                self.assertTrue(all(e[1][1:] == ('M', ('start', 'end')) for e in restores))

    def test_component_and_week_delete_keep_conflict_checks_under_lock(self):
        def scenario(original, week, stale):
            events = []
            values = {'refuse_stale_module_write': record_request(events, 'revision', views.json_error('stale', status=409) if stale else None),
                      'authoring_fetch_all': recording(events, 'children', [{'id': 'X'}]),
                      'authoring_soft_delete': recording(events, 'archive', []),
                      'ksb_mapping_placement': SimpleNamespace(where=Mock(return_value=('component_id in (%s)', ['X'])))}
            with lifecycle_scope(original, events, values) as stack:
                stack.enter_context(patch.object(module_collaboration, 'check_removal', side_effect=record_request(events, 'collaboration')))
                fn = views.curriculum_module_week_detail if week else views.curriculum_module_component_detail
                result = response_value(fn(request('DELETE'), ' M ', ' W ' if week else ' X '))
            # Responses are deliberately compared outside the call journal.
            return result, events
        for week in (False, True):
            for stale in (False, True):
                result, events = self.compare(lambda old: scenario(old, week, stale))
                self.assertEqual(result[0], 409 if stale else 200)
                names = [e[0] for e in events]
                self.assertEqual(names[:2], ['begin', 'revision'])
                if stale:
                    self.assertNotIn('archive', names)
                    self.assertNotIn('collaboration', names)
                else:
                    self.assertLess(names.index('collaboration'), names.index('archive'))

    def test_normalized_restore_uses_provenance_selection_and_batches_500(self):
        def scenario(original):
            events = []
            selected = [{'id': str(index)} for index in range(501)] + [{'id': ''}]
            values = {'archived_rows_under': Mock(return_value=[{'id': 'unselected'}]),
                      'update_rows': recording(events, 'restore', [{'id': 'synthetic'}])}
            with lifecycle_scope(original, events, values) as stack:
                chooser = stack.enter_context(patch.object(views.archive_state, 'archived_with', return_value=copy.deepcopy(selected)))
                stack.enter_context(patch.object(views.archive_state, 'datetime', FrozenClock))
                result = views.restore_rows_via_parent('weeks', 'M', ('start', 'end'))
                call = chooser.call_args
            return result, events, call
        result, events, call = self.compare(scenario)
        updates = [e for e in events if e[0] == 'restore']
        self.assertEqual([len(e[1][2]) for e in updates], [500, 1])
        self.assertEqual(call.args, ('weeks', 'M', [{'id': 'unselected'}], ('start', 'end')))
        self.assertEqual(call.kwargs, {'key_column': 'id'})

    def test_missing_legacy_archive_columns_do_not_create_writes(self):
        def scenario(original):
            events = []
            values = {'has_column': Mock(return_value=False), 'column_names': Mock(return_value=[]),
                      'update_rows': recording(events, 'update', []),
                      'soft_delete_payload': Mock(return_value={'deleted_at': FrozenClock.utcnow()})}
            with lifecycle_scope(original, events, values):
                result = (views.restore_rows_via_parent('legacy', 'M'), views.soft_delete_rows('legacy', 'id = %s', ['X']))
            return result, events
        self.assertEqual(self.compare(scenario), (([], []), []))

    def test_existing_quiz_fixtures_also_pass_against_frozen_source(self):
        from .tests_module_delete_flags import ModuleQuizArchiveTests
        with original_lifecycle():
            for name in ('test_archives_a_quiz_owned_by_the_deleted_module',
                         'test_keeps_a_quiz_live_when_another_active_module_uses_it'):
                with self.subTest(name=name):
                    case = ModuleQuizArchiveTests(methodName=name)
                    getattr(case, name)()


if __name__ == '__main__':
    raise SystemExit('Use the isolated Phase 1F runner; do not start Django on the host.')
