"""Identity conflicts stay recoverable; account failures roll back the edit."""
import json
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import connections
from django.test import RequestFactory, SimpleTestCase

from login.identity import AccountError
from . import account_identity, views
from .mappers import ValidationError


def owner(**values):
    return SimpleNamespace(pk=42, username='Existing learner', programme='Other programme',
                           learner_type='commercial', status='Archived', **values)


class EmailConflictResponseTests(SimpleTestCase):
    def test_owner_lookup_compiles_with_canonical_programme_id_and_includes_archived_users(self):
        from django.db.models.query import QuerySet
        captured = []
        def first(query):
            captured.append(query.query.get_compiler(using='enrolment').as_sql())
            return None
        with patch.object(QuerySet, 'first', first):
            self.assertIsNone(account_identity.email_owner(' Existing@Example.test ', exclude_id=7))
        sql, params = captured[0]
        self.assertIn('"programme_id"', sql)
        self.assertNotIn('"Programme"', sql)
        self.assertIn('existing@example.test', params)
        self.assertIn(7, params)
        self.assertNotIn('Archived', params)

    def test_create_returns_the_existing_learner_without_a_second_write(self):
        request = RequestFactory().post('/learner_api/enrolment-users/',
            json.dumps({'username': 'New learner', 'email': 'existing@example.test'}),
            content_type='application/json')
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '0'}), \
                patch.object(views, '_create_enrolment_user', side_effect=account_identity.LearnerEmailConflict(owner())):
            response = views.enrolment_users(request)
        self.assertEqual(response.status_code, 400)
        payload = json.loads(response.content)
        self.assertEqual(payload['existingUser'], {
            'id': '42', 'name': 'Existing learner', 'programme': 'Other programme',
            'learnerType': 'commercial', 'archived': True,
        })

    def test_edit_conflict_does_not_save_other_submitted_fields(self):
        user = SimpleNamespace(pk=7, email='old@example.test', username='Current learner')
        request = RequestFactory().patch('/learner_api/enrolment-users/7/',
            json.dumps({'email': 'existing@example.test', 'phone': '07000000000'}), content_type='application/json')
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '0'}), \
                patch.object(views, 'EnrolmentUser') as model, \
                patch.object(views, 'save_learner_identity', side_effect=account_identity.LearnerEmailConflict(owner())), \
                patch.object(views, 'save_enrolment_fields') as save:
            model.all_learners.filter.return_value.first.return_value = user
            response = views.enrolment_user_detail(request, 7)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)['existingUser']['id'], '42')
        self.assertEqual(user.email, 'old@example.test')
        save.assert_not_called()

    def test_a_concurrent_create_conflict_returns_a_recoverable_response(self):
        from django.db import IntegrityError
        request = RequestFactory().post('/learner_api/enrolment-users/',
            json.dumps({'username': 'New learner', 'email': 'existing@example.test'}), content_type='application/json')
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '0'}), \
                patch.object(views, '_create_enrolment_user', side_effect=IntegrityError('Synthetic unique-index race')), \
                patch.object(views, 'email_owner', return_value=owner()):
            response = views.enrolment_users(request)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)['existingUser']['id'], '42')
        self.assertNotIn('Synthetic', response.content.decode())

    def test_email_lookup_ignores_case_spacing_and_excludes_the_current_record(self):
        with patch.object(account_identity, 'EnrolmentUser') as model:
            account_identity.email_owner('  Learner@Example.test  ', exclude_id=7)
        query = model.all_learners.annotate.return_value
        query.filter.assert_called_once_with(_identity_email='learner@example.test')
        query.filter.return_value.exclude.assert_called_once_with(pk=7)

    def test_unauthorised_roles_cannot_obtain_conflicting_learner_details(self):
        for role in (None, 'learner', 'employer'):
            with self.subTest(role=role):
                request = RequestFactory().post('/learner_api/enrolment-users/',
                    json.dumps({'username': 'New learner', 'email': 'existing@example.test'}),
                    content_type='application/json')
                account = None if role is None else SimpleNamespace(role=role, subject_id=7)
                with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}), \
                        patch('login.permissions.authenticate_request', return_value=account), \
                        patch.object(views, '_create_enrolment_user') as create:
                    response = views.enrolment_users(request)
                self.assertIn(response.status_code, (401, 403))
                self.assertNotIn('existingUser', json.loads(response.content))
                create.assert_not_called()

    def test_own_learner_cannot_change_their_login_email(self):
        user = SimpleNamespace(pk=7, email='old@example.test', username='Learner')
        request = RequestFactory().patch('/learner_api/enrolment-users/7/',
            json.dumps({'email': 'different@example.test'}), content_type='application/json')
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}), \
                patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=7)), \
                patch.object(views, 'EnrolmentUser') as model, \
                patch.object(views, 'save_learner_identity') as save, \
                patch.object(views, 'to_board', return_value={}):
            model.all_learners.filter.return_value.first.return_value = user
            response = views.enrolment_user_detail(request, pk=7)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(user.email, 'old@example.test')
        save.assert_not_called()


class IdentityBoundaryTests(SimpleTestCase):
    """Mocked transaction boundaries; actual rollback remains an integration test."""

    def exercise(self, fields, failure=None):
        source = SimpleNamespace(pk=7, email='old@example.test', username='Learner', save=Mock())
        profile = SimpleNamespace(pk=9, email=source.email, full_name=source.username, save=Mock())
        with ExitStack() as stack:
            atomic = stack.enter_context(patch.object(account_identity.transaction, 'atomic'))
            users = stack.enter_context(patch.object(account_identity, 'EnrolmentUser'))
            users.all_learners.select_for_update.return_value.get.return_value = source
            accounts = stack.enter_context(patch.object(account_identity, 'LoginAccount'))
            accounts.objects.select_for_update.return_value.filter.return_value.first.return_value = SimpleNamespace(pk=11)
            accounts.objects.annotate.return_value.filter.return_value.exclude.return_value.exists.return_value = False
            profiles = stack.enter_context(patch.object(account_identity, 'LearnerProfile'))
            profiles.objects.filter.return_value.exclude.return_value.exists.return_value = False
            stack.enter_context(patch.object(account_identity, 'learner_profile_for_source', return_value=profile))
            stack.enter_context(patch.object(account_identity, 'email_owner', return_value=None))
            sync = stack.enter_context(patch.object(account_identity, 'ensure_account', side_effect=failure))
            invites = stack.enter_context(patch.object(account_identity, 'Invitation'))
            resets = stack.enter_context(patch.object(account_identity, 'PasswordReset'))
            if failure:
                with self.assertRaises(ValidationError):
                    account_identity.save_learner_identity(source, fields)
            else:
                account_identity.save_learner_identity(source, fields)
        atomic.assert_called_once_with(using='enrolment')
        sync.assert_called_once_with('learner', 7, subject=source)
        return atomic, profile, invites, resets

    def test_changed_email_synchronizes_profile_and_invalidates_both_unused_token_types(self):
        _, profile, invites, resets = self.exercise({'email': 'correct@example.test'})
        self.assertEqual(profile.email, 'correct@example.test')
        profile.save.assert_called_once_with(update_fields=['email', 'updated_at'])
        for model in (invites, resets):
            kwargs = model.objects.filter.call_args.kwargs
            self.assertEqual(kwargs['account_id'], 11)
            self.assertTrue(kwargs['used_at__isnull'])
            model.objects.filter.return_value.update.assert_called_once_with(expires_at=kwargs['expires_at__gt'])

    def test_account_sync_failure_reaches_transaction_exit_and_stops_later_writes(self):
        failure = AccountError('synthetic sync refusal')
        atomic, profile, invites, resets = self.exercise({'email': 'correct@example.test'}, failure)
        self.assertIs(atomic.return_value.__exit__.call_args.args[0], AccountError)
        profile.save.assert_not_called()
        invites.objects.filter.assert_not_called()
        resets.objects.filter.assert_not_called()

    def test_name_only_edit_keeps_email_tokens_valid(self):
        _, profile, invites, resets = self.exercise({'username': 'Corrected Name'})
        self.assertEqual(profile.email, 'old@example.test')
        invites.objects.filter.assert_not_called()
        resets.objects.filter.assert_not_called()


class IdentityTransactionTests(unittest.TestCase):
    """Actual SQLite transaction with synthetic source/account/profile stores.

    Model lookups are doubles; writes use the real in-memory enrolment
    connection so a swallowed sync error cannot make these rollback tests pass.
    No migration, unmanaged production table or external service is used.
    """
    def setUp(self):
        self.db = connections['enrolment']
        assert self.db.vendor == 'sqlite' and self.db.settings_dict['NAME'] == ':memory:'
        with self.db.cursor() as cur:
            for table in ('identity_test_source', 'identity_test_account', 'identity_test_profile'):
                cur.execute(f'CREATE TABLE {table} (id integer PRIMARY KEY, email text, password text)')
                cur.execute(f'INSERT INTO {table} VALUES (7, %s, %s)', ['old@example.test', 'unchanged-hash'])
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.source = SimpleNamespace(pk=7, email='old@example.test', username='Learner', preferred_name='')
        self.profile = SimpleNamespace(pk=9, email='old@example.test', full_name='Learner')
        def write(table, record):
            with self.db.cursor() as cur:
                cur.execute(f'UPDATE {table} SET email=%s WHERE id=7', [record.email])
        self.source.save = Mock(side_effect=lambda **kw: write('identity_test_source', self.source))
        self.profile.save = Mock(side_effect=lambda **kw: write('identity_test_profile', self.profile))
        model = self.stack.enter_context(patch.object(account_identity, 'EnrolmentUser'))
        model.all_learners.select_for_update.return_value.get.return_value = self.source
        login = self.stack.enter_context(patch.object(account_identity, 'LoginAccount'))
        self.login = login
        login.objects.select_for_update.return_value.filter.return_value.first.return_value = SimpleNamespace(pk=11)
        login.objects.annotate.return_value.filter.return_value.exclude.return_value.exists.return_value = False
        profiles = self.stack.enter_context(patch.object(account_identity, 'LearnerProfile'))
        profiles.objects.filter.return_value.exclude.return_value.exists.return_value = False
        self.find_owner = self.stack.enter_context(patch.object(account_identity, 'email_owner', return_value=None))
        self.stack.enter_context(patch.object(account_identity, 'learner_profile_for_source', return_value=self.profile))
        self.sync = self.stack.enter_context(patch.object(account_identity, 'ensure_account'))
        self.sync.side_effect = lambda *a, **kw: write('identity_test_account', self.source)
        self.invites = self.stack.enter_context(patch.object(account_identity, 'Invitation'))
        self.resets = self.stack.enter_context(patch.object(account_identity, 'PasswordReset'))

    def tearDown(self):
        with self.db.cursor() as cur:
            for table in ('identity_test_source', 'identity_test_account', 'identity_test_profile'):
                cur.execute(f'DROP TABLE {table}')

    def emails(self):
        with self.db.cursor() as cur:
            values = []
            for table in ('identity_test_source', 'identity_test_account', 'identity_test_profile'):
                cur.execute(f'SELECT email, password FROM {table} WHERE id=7')
                values.append(cur.fetchone())
        return values

    def test_email_correction_reaches_all_three_stores_without_changing_credentials(self):
        account_identity.save_learner_identity(self.source, {'email': 'correct@example.test'})
        self.assertEqual(self.emails(), [('correct@example.test', 'unchanged-hash')] * 3)
        for model in (self.invites, self.resets):
            self.assertEqual(model.objects.filter.call_args.kwargs['account_id'], 11)
            model.objects.filter.return_value.update.assert_called_once()

    def test_account_failure_after_a_write_rolls_back_source_and_account(self):
        def fail(*args, **kwargs):
            with self.db.cursor() as cur:
                cur.execute("UPDATE identity_test_account SET email='partial@example.test' WHERE id=7")
            raise AccountError('Synthetic conflict')
        self.sync.side_effect = fail
        with self.assertRaisesRegex(ValidationError, 'No identity changes were saved'):
            account_identity.save_learner_identity(self.source, {'email': 'correct@example.test'})
        self.assertEqual(self.emails(), [('old@example.test', 'unchanged-hash')] * 3)

    def test_duplicate_email_never_moves_either_identity(self):
        self.find_owner.return_value = owner()
        with self.assertRaises(account_identity.LearnerEmailConflict):
            account_identity.save_learner_identity(self.source, {'email': 'existing@example.test'})
        self.sync.assert_not_called()
        self.assertEqual(self.emails(), [('old@example.test', 'unchanged-hash')] * 3)

    def test_profile_write_failure_rolls_back_the_source_and_account(self):
        from django.db import DatabaseError
        self.profile.save.side_effect = DatabaseError('Synthetic profile failure')
        with self.assertRaisesRegex(DatabaseError, 'No identity changes were saved'):
            account_identity.save_learner_identity(self.source, {'email': 'correct@example.test'})
        self.assertEqual(self.emails(), [('old@example.test', 'unchanged-hash')] * 3)

    def test_another_account_cannot_be_claimed_by_correcting_an_email(self):
        self.login.objects.annotate.return_value.filter.return_value.exclude.return_value.exists.return_value = True
        with self.assertRaisesRegex(ValidationError, 'another sign-in account'):
            account_identity.save_learner_identity(self.source, {'email': 'taken@example.test'})
        self.sync.assert_not_called()
        self.assertEqual(self.emails(), [('old@example.test', 'unchanged-hash')] * 3)

    def test_editing_an_uninvited_record_does_not_create_an_account(self):
        self.login.objects.select_for_update.return_value.filter.return_value.first.return_value = None
        self.login.objects.annotate.return_value.filter.return_value.exists.return_value = False
        account_identity.save_learner_identity(self.source, {'email': 'correct@example.test'})
        self.sync.assert_not_called()
        self.assertEqual(self.emails(), [
            ('correct@example.test', 'unchanged-hash'), ('old@example.test', 'unchanged-hash'),
            ('correct@example.test', 'unchanged-hash'),
        ])

    def test_a_name_only_edit_preserves_existing_invitation_and_reset_links(self):
        account_identity.save_learner_identity(self.source, {'username': 'Renamed learner'})
        self.invites.objects.filter.assert_not_called()
        self.resets.objects.filter.assert_not_called()
