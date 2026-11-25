"""Real owner imports and synthetic dependency contracts in the isolated runner."""
import ast
import copy
import importlib
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from curriculum_api import views, cache_scope, module_live
from curriculum_api.catalogue.infrastructure import course_schema_runtime, module_epochs, scoped_epochs
from curriculum_api.meetings.infrastructure import tracking_runtime
from curriculum_api.catalogue.tests.parity.test_runtime_ownership_standalone import MANIFEST, original
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture


class RuntimeOwnershipParity(SimpleTestCase):
    def test_compatibility_exports_reference_actual_owners(self):
        for name, module in MANIFEST['functions'].items():
            owner = importlib.import_module('curriculum_api.' + module)
            self.assertIs(getattr(views, name), getattr(owner, name), name)
        for facade, owner, names in (
            (cache_scope, scoped_epochs, ('scope_epochs', 'bump_scopes', '_STATE', '_INDEX', '_STATE_LOCK')),
            (module_live, module_epochs, ('note_rows', 'watched_epochs', '_PENDING', '_MEMO', '_MEMO_LOCK')),
        ):
            for name in names:
                self.assertIs(getattr(facade, name), getattr(owner, name))

    def test_all_schema_gates_memoize_only_after_success(self):
        for owner, ensure, flag in (
            (course_schema_runtime, 'ensure_free_programme_tables', '_FREE_PROGRAMME_TABLES_READY'),
            (course_schema_runtime, 'ensure_week_template_tables', '_WEEK_TEMPLATE_TABLES_READY'),
            (tracking_runtime, 'ensure_live_sessions_table', '_LIVE_SESSIONS_TABLE_READY'),
            (tracking_runtime, 'ensure_live_session_tracking_tables', '_LIVE_SESSION_TRACKING_TABLES_READY'),
        ):
            with self.subTest(ensure=ensure), patch.object(owner, flag, False), \
                 patch.object(owner.schema_gate, 'runtime_bootstrap_allowed', return_value=False), \
                 patch.object(owner.schema_gate, 'require_tables', side_effect=RuntimeError('synthetic missing schema')) as require, \
                 patch.object(owner, ensure.replace('ensure_', 'provision_')) as provision:
                with self.assertRaisesRegex(RuntimeError, 'synthetic missing schema'):
                    getattr(owner, ensure)()
                self.assertFalse(getattr(owner, flag))
                require.side_effect = None
                getattr(owner, ensure)()
                getattr(owner, ensure)()
                self.assertTrue(getattr(owner, flag))
                self.assertEqual(require.call_count, 2)
                provision.assert_not_called()

    def test_schema_owner_resets_never_share_copied_flags(self):
        for owner, flags in ((course_schema_runtime, ('_FREE_PROGRAMME_TABLES_READY', '_WEEK_TEMPLATE_TABLES_READY')),
                             (tracking_runtime, ('_LIVE_SESSIONS_TABLE_READY', '_LIVE_SESSION_TRACKING_TABLES_READY'))):
            with ExitStack() as stack:
                for flag in flags:
                    stack.enter_context(patch.object(owner, flag, True))
                    self.assertNotIn(flag, vars(views))
                owner.reset_ready_flags()
                for flag in flags:
                    self.assertFalse(getattr(owner, flag))

    def test_counter_scope_policy_matches_actual_prior_source(self):
        nodes = [copy.deepcopy(n) for n in original('module_live.py').body if getattr(n, 'name', None) in ('_module_tables', 'scopes_for_rows')]
        env = dict(vars(module_epochs), _views=lambda: views)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<prior-module-counter>', 'exec'), env)
        for table in (views.AUTHORING_MODULES_TABLE, views.AUTHORING_COMPONENTS_TABLE, views.GROUPS_TABLE, 'unknown'):
            for rows in (None, [], [None, 'bad'], [{'module_catalogue_id': ' M ', 'group_id': ' G '}],
                         [{'module_catalogue_id': 'M'}, {'module_catalogue_id': 'M'}, {'group_id': ''}]):
                self.assertEqual(module_epochs.scopes_for_rows(table, rows), env['scopes_for_rows'](table, rows))

    def test_counter_flush_and_commit_registration_preserve_boundary(self):
        module_epochs.reset_state()
        self.addCleanup(module_epochs.reset_state)
        with patch.object(module_epochs, 'bump_scopes') as bump, patch.object(module_epochs.transaction, 'on_commit') as commit:
            module_epochs.begin_request()
            module_epochs.note_rows(views.AUTHORING_MODULES_TABLE, [{'module_catalogue_id': 'M', 'group_id': 'G'}])
            module_epochs.note_rows(views.AUTHORING_MODULES_TABLE, [{'module_catalogue_id': 'M'}])
            bump.assert_not_called()
            commit.assert_not_called()
            module_epochs.end_request()
            bump.assert_called_once_with({'module:M', 'group:G'})
            bump.reset_mock()
            module_epochs.note_rows(views.AUTHORING_MODULES_TABLE, [{'module_catalogue_id': 'N'}])
            bump.assert_not_called()
            commit.assert_called_once()
            commit.call_args.args[0]()
            bump.assert_called_once_with({'module:N'})

    def test_cache_fixture_injection_restores_real_owner(self):
        original_fetch = scoped_epochs.fetch_all
        with composition_fixture(views, 'fetch_all', return_value=[]) as fetch:
            self.assertIs(scoped_epochs.fetch_all, fetch)
            self.assertIs(module_epochs.fetch_all, fetch)
        self.assertIs(scoped_epochs.fetch_all, original_fetch)

    def test_shared_alias_metadata_still_resolves_owner_before_reading(self):
        from curriculum_api.meetings.api import adapters
        with patch.object(adapters, 'ensure_live_session_tracking_tables') as ensure, \
             patch.object(adapters, 'teams_module_owner_id', return_value='SOURCE') as resolve, \
             patch.object(adapters, 'authoring_fetch_all', return_value=[{'id': 'SERIES'}]) as fetch, \
             patch.object(adapters, 'teams_delivery_metadata_from_live_session_row', return_value={'synthetic': True}) as serialize:
            self.assertEqual(adapters.teams_delivery_metadata_from_live_session('ALIAS'), {'synthetic': True})
            ensure.assert_called_once_with()
            resolve.assert_called_once_with('ALIAS')
            self.assertEqual(fetch.call_args.args[2], ['SOURCE'])
            serialize.assert_called_once_with({'id': 'SERIES'})
