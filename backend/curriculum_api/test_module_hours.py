"""Target persistence, audit and explicit account grants on isolated SQLite.

Module/catalogue and account-directory reads are mocked. Only the three new
tables are written. No Microsoft, mail, learner data, or storage calls occur.
"""
import json
from io import StringIO
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from django.db import DatabaseError, connections, transaction
from django.db.backends.sqlite3.base import DatabaseWrapper
from django.core.management.base import CommandError
from django.test import RequestFactory

from . import module_hours as hours
from .module_hours_schema import provision, table_name


class ModuleHoursTests(TestCase):
    def setUp(self):
        # Avoid the application's unrelated schema-qualified model sync. This
        # suite owns a fresh in-memory connection and provisions only its tables.
        config = {**connections['default'].settings_dict, 'NAME': ':memory:'}
        if config['ENGINE'] != 'django.db.backends.sqlite3':
            raise RuntimeError('This feature suite requires isolated SQLite settings.')
        self.database = DatabaseWrapper(config, alias='module_hours_feature_test')
        connections['module_hours_feature_test'] = self.database
        self.addCleanup(lambda: self.database.close())
        self.addCleanup(lambda: connections.__delitem__('module_hours_feature_test'))
        atomic = transaction.atomic
        patcher = patch.object(hours.transaction, 'atomic', side_effect=lambda *args, **kwargs: atomic(using='module_hours_feature_test'))
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch.object(hours, 'connection', self.database)
        patcher.start()
        self.addCleanup(patcher.stop)
        provision(self.database)
        self.factory = RequestFactory()
        self.actor = SimpleNamespace(id=10, role='staff', subject_type='staff', is_active=True)
        self.target_account = SimpleNamespace(id=20, role='admin', subject_type='staff', is_active=True)
        def authenticate(request):
            request.login_account = self.actor
            return self.actor
        for target, options in (
            ('login.permissions.authenticate_request', {'side_effect': authenticate}),
            ('login.permissions._accesses_of', {'return_value': frozenset({'curriculum'})}),
            ('curriculum_api.module_hours.stored_module', {'side_effect': lambda identifier: (identifier, {'title': 'Synthetic module', 'programme_id': 'P1'})}),
            ('curriculum_api.views.lock_module_structure_row', {}),
            ('curriculum_api.views.authoring_module_exists', {'return_value': {'title': 'Synthetic module', 'programme_id': 'P1'}}),
            ('curriculum_api.views.archived_programme_module_edit_error', {'return_value': None}),
        ):
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    def grant(self, account_id=10, match=False, manage=False):
        with transaction.atomic():
            current = hours.read_access(account_id)
            return hours.write_access(account_id, match, manage, current['revision'], 99)

    def request(self, view, method='GET', payload=None, identifier='M1', csrf=True):
        path = '/hours/'
        request = self.factory.get(path) if method == 'GET' else self.factory.patch(path,
            data=json.dumps(payload), content_type='application/json',
            **({'HTTP_X_REQUESTED_WITH': 'XMLHttpRequest'} if csrf else {}))
        return view(request, identifier) if view != hours.own_access else view(request)

    def patch_target(self, target=30000, revision=0, **kwargs):
        return self.request(hours.module_target, 'PATCH', {'targetMinutes': target, 'expectedRevision': revision}, **kwargs)

    def test_unset_target_is_optional_and_not_zero(self):
        result = json.loads(self.request(hours.module_target).content)
        self.assertIsNone(result['targetMinutes'])
        self.assertEqual(result['revision'], 0)
        self.assertFalse(result['canMatch'])

    def test_granted_editor_sets_updates_and_clears_only_one_module(self):
        self.grant(match=True)
        self.assertEqual(self.patch_target().status_code, 200)
        self.assertEqual(self.patch_target(30060, 1).status_code, 200)
        self.assertEqual(hours.read_target('M1'), {'targetMinutes': 30060, 'revision': 2})
        self.assertEqual(hours.read_target('M2'), {'targetMinutes': None, 'revision': 0})
        self.assertEqual(self.patch_target(None, 2).status_code, 200)
        self.assertIsNone(hours.read_target('M1')['targetMinutes'])

    def test_super_admin_is_not_automatically_granted_target_or_delegation(self):
        self.actor.role = 'admin'
        with patch('login.permissions._accesses_of', return_value={'super-admin'}):
            self.assertEqual(self.patch_target().status_code, 403)
            self.assertEqual(self.request(hours.account_access, identifier=20).status_code, 403)
        self.assertFalse(json.loads(self.request(hours.own_access).content)['canMatch'])

    def test_manager_permission_does_not_grant_target_editing(self):
        self.grant(manage=True)
        self.assertEqual(self.patch_target().status_code, 403)

    def test_revocation_is_effective_on_next_request(self):
        self.grant(match=True)
        self.assertEqual(self.patch_target().status_code, 200)
        self.grant()
        self.assertEqual(self.patch_target(1, 1).status_code, 403)
        self.assertEqual(hours.read_target('M1')['targetMinutes'], 30000)

    def test_concurrent_stale_save_returns_conflict_and_retains_newer_target(self):
        self.grant(match=True)
        self.patch_target()
        self.assertEqual(self.patch_target(32000, 0).status_code, 409)
        self.assertEqual(hours.read_target('M1'), {'targetMinutes': 30000, 'revision': 1})

    def test_target_rejects_invalid_minutes_and_revision(self):
        self.grant(match=True)
        for value in [0, -1, True, '100', 1.5, 2147483648]:
            with self.subTest(value=value):
                self.assertEqual(self.patch_target(value).status_code, 400)
        for revision in [True, -1, None, '0']:
            self.assertEqual(self.patch_target(revision=revision).status_code, 400)
        self.assertEqual(hours.read_target('M1')['revision'], 0)

    def test_target_rejects_cross_site_write_and_unknown_fields(self):
        self.grant(match=True)
        self.assertEqual(self.patch_target(csrf=False).status_code, 403)
        result = self.request(hours.module_target, 'PATCH', {'targetMinutes': 10, 'expectedRevision': 0, 'totalOtjh': 1})
        self.assertEqual(result.status_code, 400)

    def test_no_module_and_archived_programme_are_rejected(self):
        self.grant(match=True)
        with patch.object(hours, 'stored_module', return_value=None):
            self.assertEqual(self.patch_target().status_code, 404)
        from django.http import JsonResponse
        with patch('curriculum_api.views.archived_programme_module_edit_error', return_value=JsonResponse({'error': 'Archived programme'}, status=409)):
            self.assertEqual(self.patch_target().status_code, 409)
        self.assertEqual(hours.read_target('M1')['revision'], 0)

    def test_audit_failure_rolls_back_target(self):
        self.grant(match=True)
        with patch.object(hours, 'audit', side_effect=DatabaseError('Synthetic failure')):
            self.assertEqual(self.patch_target().status_code, 503)
        self.assertEqual(hours.read_target('M1')['revision'], 0)

    def test_target_audit_records_actor_and_old_and_new_values(self):
        self.grant(match=True)
        self.patch_target()
        with self.database.cursor() as cursor:
            cursor.execute(f'SELECT actor_id, before_value, after_value FROM {table_name(self.database, "module_hours_audit")} WHERE kind = %s', ['target'])
            actor, before, after = cursor.fetchone()
        self.assertEqual(actor, 10)
        self.assertIsNone(json.loads(before)['targetMinutes'])
        self.assertEqual(json.loads(after)['targetMinutes'], 30000)

    def test_manager_grants_target_permission_without_changing_role(self):
        self.actor.role = 'admin'
        self.grant(manage=True)
        with patch('login.models.LoginAccount.objects') as accounts:
            accounts.filter.return_value.first.return_value = self.target_account
            result = self.request(hours.account_access, 'PATCH', {'canMatch': True, 'canManage': False, 'expectedRevision': 0}, identifier=20)
        self.assertEqual(result.status_code, 200)
        self.assertTrue(hours.read_access(20)['canMatch'])
        self.assertFalse(hours.read_access(20)['canManage'])
        self.assertEqual(self.target_account.role, 'admin')

    def test_target_editor_cannot_delegate_or_self_promote(self):
        self.actor.role = 'admin'
        self.grant(match=True)
        result = self.request(hours.account_access, 'PATCH', {'canMatch': True, 'canManage': True, 'expectedRevision': 1}, identifier=10)
        self.assertEqual(result.status_code, 403)
        self.assertFalse(hours.read_access(10)['canManage'])

    def test_manager_can_revoke_dormant_permissions_on_a_suspended_staff_account(self):
        self.actor.role = 'admin'
        self.grant(manage=True)
        self.grant(account_id=20, match=True)
        self.target_account.is_active = False
        with patch('login.models.LoginAccount.objects') as accounts:
            accounts.filter.return_value.first.return_value = self.target_account
            result = self.request(hours.account_access, 'PATCH', {'canMatch': False, 'canManage': False, 'expectedRevision': 1}, identifier=20)
        self.assertEqual(result.status_code, 200)
        self.assertFalse(hours.read_access(20)['canMatch'])

    def test_manager_checks_csrf_types_revision_and_target_account(self):
        self.actor.role = 'admin'
        self.grant(manage=True)
        with patch('login.models.LoginAccount.objects') as accounts:
            accounts.filter.return_value.first.return_value = self.target_account
            values = {'canMatch': True, 'canManage': False, 'expectedRevision': 0}
            self.assertEqual(self.request(hours.account_access, 'PATCH', values, identifier=20, csrf=False).status_code, 403)
            self.assertEqual(self.request(hours.account_access, 'PATCH', {**values, 'canMatch': 'true'}, identifier=20).status_code, 400)
            self.assertEqual(self.request(hours.account_access, 'PATCH', values, identifier=20).status_code, 200)
            self.assertEqual(self.request(hours.account_access, 'PATCH', values, identifier=20).status_code, 409)
            self.target_account.role = 'staff'
            self.assertEqual(self.request(hours.account_access, 'PATCH', {**values, 'canManage': True, 'expectedRevision': 1}, identifier=20).status_code, 400)
            accounts.filter.return_value.first.return_value = None
            self.assertEqual(self.request(hours.account_access, identifier=20).status_code, 404)

    def test_learner_employer_and_missing_session_cannot_read_targets(self):
        for role in ['learner', 'employer']:
            self.actor.role = role
            self.assertEqual(self.request(hours.module_target).status_code, 403)
        with patch('login.permissions.authenticate_request', return_value=None):
            self.assertEqual(self.request(hours.module_target).status_code, 401)

    def test_missing_schema_or_database_error_is_not_reported_as_unset(self):
        with patch.object(hours, 'read_access', side_effect=DatabaseError('Synthetic unavailable')):
            self.assertEqual(self.request(hours.module_target).status_code, 503)
            self.assertEqual(self.request(hours.own_access).status_code, 503)

    def test_bootstrap_appoints_two_verified_managers_once_without_changing_roles(self):
        from .management.commands import bootstrap_module_hours_manager as bootstrap
        accounts = [SimpleNamespace(id=10, role='admin'), SimpleNamespace(id=20, role='admin')]
        options = {'account_id': [10, 20], 'expected_database': ':memory:', 'expected_host': '', 'grant_match': True}
        command = bootstrap.Command(stdout=StringIO())
        with patch.object(bootstrap, 'connection', self.database), patch.object(bootstrap.LoginAccount, 'objects') as manager:
            manager.filter.return_value = accounts
            command.handle(**options)
            with self.assertRaises(CommandError):
                command.handle(**options)
        for account in accounts:
            self.assertTrue(hours.read_access(account.id)['canManage'])
            self.assertTrue(hours.read_access(account.id)['canMatch'])
            self.assertEqual(account.role, 'admin')

    def test_bootstrap_requires_the_verified_host_database_and_all_account_ids(self):
        from .management.commands import bootstrap_module_hours_manager as bootstrap
        command = bootstrap.Command(stdout=StringIO())
        options = {'account_id': [10, 20], 'expected_database': ':memory:', 'expected_host': '', 'grant_match': True}
        with patch.object(bootstrap, 'connection', self.database), patch.object(bootstrap.LoginAccount, 'objects') as manager:
            for override in [{'expected_database': 'other'}, {'expected_host': 'other'}]:
                with self.assertRaises(CommandError):
                    command.handle(**{**options, **override})
            manager.filter.return_value = [SimpleNamespace(id=10, role='admin')]
            with self.assertRaises(CommandError):
                command.handle(**options)
        self.assertFalse(hours.read_access(10)['canManage'])
