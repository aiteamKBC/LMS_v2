"""Phase 1 identity contracts: no database, mail, Graph or session writes."""
import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.db import models as django_models
from django.test import RequestFactory, SimpleTestCase

from learner_api.models import CommercialUser, EnrolmentUser, LearnerProfile
from learner_api import models as learner_models

from . import identity, views
from .learner_enrolment import existing_learner_record
from .sessions import COOKIE_NAME


class LoginSchemaCompatibilityTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(
            id=7, email='person@example.test', display_name='Example Person',
            role='learner', subject_type='learner', subject_id=42,
            has_password=True, password_hash='synthetic-hash', last_login_at=None,
        )
        self.subject = SimpleNamespace(
            pk=42, learner_type='apprenticeship', programme='Example Programme', aptem_id=None,
        )
        self.lookup = self.enterContext(patch.object(identity, 'account_for_email', return_value=self.account))
        self.enterContext(patch.object(identity, 'fetch_subject', return_value=self.subject))
        self.enterContext(patch('old_otjh.service.enabled', return_value=False))
        self.throttle = self.enterContext(patch.object(views, 'ip_is_throttled', return_value=False))
        self.enterContext(patch.object(views, 'is_default_learner_password', return_value=False))
        self.locked = self.enterContext(patch.object(views, 'is_locked', return_value=False))
        self.password = self.enterContext(patch.object(views, 'verify_password', return_value=True))
        self.failure = self.enterContext(patch.object(views, 'register_failure', return_value=None))
        self.success = self.enterContext(patch.object(views, 'register_success'))
        self.issue = self.enterContext(patch.object(
            views, 'issue_session', return_value=('synthetic-token', SimpleNamespace(), timedelta(hours=8)),
        ))
        self.audit = self.enterContext(patch.object(views, 'record'))
        self.authenticate = self.enterContext(patch.object(views, 'authenticate_request', return_value=self.account))

    def login(self, *, remember=False, csrf=True):
        headers = {'HTTP_X_REQUESTED_WITH': 'XMLHttpRequest'} if csrf else {}
        return views.login(self.factory.post('/login_api/login/',
            data=json.dumps({'email': ' Person@Example.TEST ', 'password': 'synthetic-password',
                             'remember': remember}), content_type='application/json', **headers))

    def me(self):
        return views.me(self.factory.get('/login_api/me/'))

    def test_learner_login_preserves_payload_permissions_and_cookie_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.subject.learner_type = kind
                response = self.login()
                self.assertEqual(response.status_code, 200)
                user = json.loads(response.content)['user']
                self.assertEqual(user['subjectId'], 42)
                self.assertEqual(user['learnerType'], kind)
                self.assertEqual(user['programme'], 'Example Programme')
                self.assertEqual(user['permissions'], identity.permissions_for('learner'))
                self.assertNotIn('password_hash', user)
                self.assertEqual(response.cookies[COOKIE_NAME].value, 'synthetic-token')
                self.assertTrue(response.cookies[COOKIE_NAME]['httponly'])
                self.assertEqual(response.cookies[COOKIE_NAME]['samesite'], 'Lax')
                self.assertEqual(response.cookies[COOKIE_NAME]['max-age'], '')
        self.lookup.assert_called_with('person@example.test')

    def test_remember_me_keeps_existing_session_cookie_lifetime(self):
        response = self.login(remember=True)
        self.assertEqual(response.cookies[COOKIE_NAME]['max-age'], 8 * 60 * 60)
        self.assertTrue(self.issue.call_args.kwargs['remember'])

    def test_me_returns_same_user_document_without_issuing_session(self):
        signed_in = json.loads(self.login().content)['user']
        self.issue.reset_mock()
        self.audit.reset_mock()
        self.assertEqual(json.loads(self.me().content), {'user': signed_in})
        self.issue.assert_not_called()
        self.audit.assert_not_called()

    def test_login_and_me_project_programme_from_real_model_without_requiring_a_link(self):
        with patch.object(learner_models, 'connections') as connections:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            for kind in ('commercial', 'apprenticeship'):
                for placement, expected in ((('Current Programme', None, None), 'Current Programme'),
                                             (None, None)):
                    with self.subTest(kind=kind, linked=placement is not None):
                        cursor.fetchone.return_value = placement
                        record = EnrolmentUser(pk=42, learner_type=kind)
                        with patch.object(identity, 'fetch_subject', return_value=record):
                            response = self.login()
                            self.assertEqual(response.status_code, 200)
                            user = json.loads(response.content)['user']
                            self.assertEqual(user['programme'], expected)
                            self.assertEqual(user['subjectId'], 42)
                            self.assertEqual(json.loads(self.me().content)['user'], user)

    def test_invalid_password_remains_401_and_never_issues_session(self):
        self.password.return_value = False
        response = self.login()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content), {'error': views.GENERIC_LOGIN_ERROR})
        self.failure.assert_called_once_with(self.account)
        self.issue.assert_not_called()

    def test_unknown_account_remains_generic_401(self):
        self.lookup.return_value = None
        response = self.login()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content)['error'], views.GENERIC_LOGIN_ERROR)
        self.issue.assert_not_called()

    def test_csrf_denial_still_precedes_identity_and_session_reads(self):
        self.assertEqual(self.login(csrf=False).status_code, 403)
        self.lookup.assert_not_called()
        self.issue.assert_not_called()

    def test_unauthenticated_me_remains_401(self):
        self.authenticate.return_value = None
        response = self.me()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content)['code'], 'unauthenticated')

    def test_locked_account_remains_423(self):
        self.locked.return_value = True
        self.account.locked_until = None
        self.assertEqual(self.login().status_code, 423)
        self.issue.assert_not_called()

    def test_staff_login_and_optional_learner_workspace_preserve_staff_identity(self):
        self.account.role = 'staff'
        self.account.subject_type = 'staff'
        self.account.subject_id = 31
        self.subject = SimpleNamespace(position='Tutor', access='tutor', access_extra='')
        with patch.object(identity, 'fetch_subject', return_value=self.subject), \
             patch('login.learner_enrolment.existing_learner_record') as linked:
            for kind in (None, 'apprenticeship', 'commercial'):
                with self.subTest(kind=kind):
                    linked.return_value = None if kind is None else SimpleNamespace(pk=42, learner_type=kind)
                    response = self.login()
                    self.assertEqual(response.status_code, 200)
                    user = json.loads(response.content)['user']
                    self.assertEqual((user['role'], user['subjectId']), ('staff', 31))
                    self.assertEqual(user['permissions'], identity.permissions_for('staff'))
                    if kind is None:
                        self.assertNotIn('learnerRecordId', user)
                    else:
                        self.assertEqual(user['learnerRecordId'], 42)
                        self.assertEqual(user['accessWorkspaces'][-1]['home'], f'/workspace/learner/{kind}/42')
                    self.assertEqual(json.loads(self.me().content)['user'], user)

    def assert_database_failure(self, call):
        with self.assertLogs('login.views', level='ERROR') as logs:
            response = call()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(json.loads(response.content), {'error': views.DATABASE_UNAVAILABLE_ERROR})
        self.assertNotIn(COOKIE_NAME, response.cookies)
        for text in (response.content.decode(), '\n'.join(logs.output)):
            for secret in ('SELECT', 'Created_users', 'person@example.test', 'synthetic-secret', 'private/path'):
                self.assertNotIn(secret, text)

    def test_database_errors_at_every_login_stage_are_safe(self):
        for target in (self.throttle, self.lookup, self.success, self.issue, self.audit):
            with self.subTest(target=target):
                target.side_effect = DatabaseError('SELECT Created_users person@example.test synthetic-secret private/path')
                self.assert_database_failure(self.login)
                target.side_effect = None
        with patch.object(identity, 'account_payload', side_effect=DatabaseError('SELECT Created_users synthetic-secret')):
            self.assert_database_failure(self.login)

    def test_database_errors_in_me_authentication_and_payload_are_safe(self):
        with patch.object(identity, 'account_payload', side_effect=DatabaseError('SELECT Created_users synthetic-secret')):
            self.assert_database_failure(self.me)
        self.authenticate.side_effect = DatabaseError('SELECT Created_users synthetic-secret')
        self.assert_database_failure(self.me)

    def test_default_password_lookup_database_error_is_safe(self):
        self.lookup.return_value = None
        with patch.object(views, 'is_default_learner_password', return_value=True), \
             patch.object(views, 'default_password_setup', side_effect=DatabaseError('SELECT Created_users synthetic-secret')):
            self.assert_database_failure(self.login)
        self.issue.assert_not_called()

    def test_safe_diagnostics_keep_sqlstate_without_exception_message(self):
        cause = RuntimeError('synthetic-secret')
        cause.sqlstate = '42703'
        failure = DatabaseError('SELECT private/path')
        failure.__cause__ = cause
        self.lookup.side_effect = failure
        with self.assertLogs('login.views', level='ERROR') as logs:
            response = self.login()
        self.assertEqual(response.status_code, 502)
        self.assertIn('sqlstate=42703', logs.output[0])
        self.assertNotIn('synthetic-secret', logs.output[0])
        self.assertNotIn('SELECT', logs.output[0])

    def test_non_database_errors_are_not_hidden_as_database_failures(self):
        self.lookup.side_effect = ValueError('unexpected programming error')
        with self.assertRaisesRegex(ValueError, 'unexpected programming error'):
            self.login()


class IdentityModelCompatibilityTests(SimpleTestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value.__enter__.return_value
        self.cursor.fetchone.return_value = ('Current Programme', 'Current Cohort', 'Current Group')
        self.connections = self.enterContext(patch.object(learner_models, 'connections'))
        self.connections.__getitem__.return_value = self.connection

    def test_touched_models_pass_non_database_django_checks(self):
        for model in (EnrolmentUser, LearnerProfile):
            with self.subTest(model=model.__name__):
                self.assertEqual(model.check(databases=[]), [])

    def test_full_model_selects_do_not_request_deleted_columns(self):
        forbidden = {
            EnrolmentUser: {'Programme', 'Cohort', 'Group', 'Start_date', 'End_date',
                           'Learner_start_date', 'Learner_end_date', 'state'},
            LearnerProfile: {'programme', 'cohort', 'group_name', 'coach_rag',
                             'Learner_Start_date', 'Learner_end_date'},
        }
        for model, deleted in forbidden.items():
            with self.subTest(model=model.__name__):
                columns = {field.column for field in model._meta.concrete_fields}
                self.assertFalse(columns & deleted)
                # Compile the full query, not a deferred query that could hide a
                # bad mapping. This never executes SQL or opens a connection.
                query = model._base_manager.all().query
                sql, _ = query.get_compiler(using='enrolment').as_sql()
                for column in deleted:
                    self.assertNotIn(f'."{column}"', sql)
                self.assertFalse(model._meta.managed)
        self.connection.cursor.assert_not_called()

    def test_all_four_dates_map_to_distinct_lowercase_date_columns(self):
        names = ('start_date', 'end_date', 'learner_start_date', 'learner_end_date')
        for model in (EnrolmentUser, LearnerProfile):
            with self.subTest(model=model.__name__):
                for name in names:
                    field = model._meta.get_field(name)
                    self.assertEqual(field.column, name)
                    self.assertIsInstance(field, django_models.DateField)
                    self.assertTrue(field.null)

    def test_primary_keys_and_existing_scalar_links_keep_their_semantics(self):
        self.assertIsInstance(EnrolmentUser._meta.pk, django_models.AutoField)
        self.assertIsInstance(LearnerProfile._meta.pk, django_models.BigAutoField)
        self.assertTrue(LearnerProfile._meta.get_field('enrolment_id').null)
        for name in ('programme_id', 'cohort_id', 'group_id'):
            self.assertEqual(LearnerProfile._meta.get_field(name).column, name)
            self.assertTrue(LearnerProfile._meta.get_field(name).null)
        self.assertFalse(EnrolmentUser._meta.get_field('programme_id').null)
        self.assertTrue(EnrolmentUser._meta.get_field('cohort_id').null)
        group = EnrolmentUser._meta.get_field('group_id')
        self.assertEqual(group.column, 'group_id')
        self.assertEqual(group.max_length, 128)
        self.assertTrue(group.null)

    def test_enrolment_labels_use_enrolment_fk_not_learner_pk_and_one_query(self):
        record = EnrolmentUser(pk=42, programme_id='stale-enrolment-programme')
        self.assertEqual((record.programme, record.cohort, record.group),
                         ('Current Programme', 'Current Cohort', 'Current Group'))
        self.cursor.execute.assert_called_once()
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('WHERE l.enrolment_id = %s', sql)
        self.assertEqual(params, [42])
        for table, key in (('programmes', 'programme_id'), ('cohorts', 'cohort_id'), ('groups', 'group_id')):
            self.assertIn(f'LEFT JOIN curriculum.{table}', sql)
            self.assertIn(f'l.{key}', sql)
        self.assertNotIn('Created_users', sql)
        self.assertNotIn('stale-enrolment-programme', sql)

    def test_profile_labels_use_profile_pk_even_when_enrolment_id_differs(self):
        record = LearnerProfile(pk=900, enrolment_id=42)
        self.assertEqual((record.programme, record.cohort, record.group_name, record.group),
                         ('Current Programme', 'Current Cohort', 'Current Group', 'Current Group'))
        self.cursor.execute.assert_called_once()
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('WHERE l.id = %s', sql)
        self.assertEqual(params, [900])

    def test_no_link_preserves_nullable_enrolment_labels_without_fabricating_placement(self):
        self.cursor.fetchone.return_value = None
        record = EnrolmentUser(pk=42, programme_id='enrolment-only-programme')
        self.assertEqual((record.programme, record.cohort, record.group), (None, None, None))
        self.cursor.execute.assert_called_once()

    def test_optional_links_and_unsaved_records_do_not_invent_names(self):
        self.cursor.fetchone.return_value = ('Programme', None, None)
        record = LearnerProfile(pk=900, enrolment_id=None)
        self.assertEqual((record.programme, record.cohort, record.group_name), ('Programme', '', ''))
        self.connection.cursor.reset_mock()
        self.assertEqual(EnrolmentUser().programme, None)
        self.assertEqual(LearnerProfile().group_name, '')
        self.connection.cursor.assert_not_called()

    def test_placement_cache_is_scoped_to_instance_and_uses_loaded_database_alias(self):
        first, second = EnrolmentUser(pk=42), EnrolmentUser(pk=43)
        first._state.db = 'enrolment'
        self.cursor.fetchone.side_effect = [('Programme A', None, None), ('Programme B', None, None)]
        self.assertEqual(first.programme, 'Programme A')
        self.assertEqual(second.programme, 'Programme B')
        self.assertEqual(first.programme, 'Programme A')
        self.assertEqual(self.cursor.execute.call_count, 2)
        self.connections.__getitem__.assert_called_with('enrolment')

    def test_compatibility_labels_are_read_only_and_do_not_silently_drop_writes(self):
        for record, names in ((EnrolmentUser(pk=42), ('programme', 'cohort', 'group')),
                              (LearnerProfile(pk=900), ('programme', 'cohort', 'group_name'))):
            for name in names:
                with self.subTest(model=type(record).__name__, field=name):
                    with self.assertRaises(AttributeError):
                        setattr(record, name, 'unapproved placement write')
        self.connection.cursor.assert_not_called()

    def test_placement_database_errors_propagate_instead_of_fabricating_empty_success(self):
        self.cursor.execute.side_effect = DatabaseError('unavailable')
        with self.assertRaises(DatabaseError):
            _ = EnrolmentUser(pk=42).programme

    def test_identity_subject_read_is_minimal_and_covers_both_learner_types(self):
        with patch.object(EnrolmentUser, 'all_learners') as manager:
            for model, kind in ((EnrolmentUser, 'apprenticeship'), (CommercialUser, 'commercial')):
                record = model(pk=42, learner_type=kind)
                manager.only.return_value.get.return_value = record
                self.assertIs(identity.fetch_subject('learner', 42), record)
                manager.only.assert_called_with('id', 'email', 'username', 'preferred_name', 'learner_type', 'aptem_id')
                manager.only.return_value.get.assert_called_with(pk=42)

    def test_staff_learner_lookup_loads_only_identity_fields(self):
        with patch.object(EnrolmentUser, 'all_learners') as manager:
            record = EnrolmentUser(pk=42, learner_type='commercial')
            manager.filter.return_value.only.return_value.first.return_value = record
            self.assertIs(existing_learner_record(' Person@Example.TEST '), record)
            manager.filter.assert_called_once_with(email__iexact='person@example.test')
            manager.filter.return_value.only.assert_called_once_with('id', 'learner_type')
            manager.reset_mock()
            self.assertIsNone(existing_learner_record(''))
            manager.filter.assert_not_called()

    def test_real_model_programme_property_preserves_account_payload_and_enrolment_identity(self):
        account = SimpleNamespace(id=7, email='person@example.test', display_name='Example', role='learner',
                                  subject_type='learner', subject_id=42, has_password=True, last_login_at=None)
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), patch('old_otjh.service.enabled', return_value=False):
                record = EnrolmentUser(pk=42, learner_type=kind)
                user = identity.account_payload(account, subject=record)
                self.assertEqual(user['programme'], 'Current Programme')
                self.assertEqual(user['subjectId'], 42)
                self.assertEqual(user['learnerType'], kind)
