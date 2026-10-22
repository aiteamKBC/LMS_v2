"""Final four regressions using real source definitions and intercepted I/O.

Run: python -B backend/learner_api/test_f01_f02_final_four_no_db.py
No application imports, environment files, database, network or writes.
"""
import ast
from datetime import datetime, timedelta, timezone
import functools
import logging
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch

import test_legacy_assignment_list_no_db as support

ROOT = Path(__file__).resolve().parents[2]
SAFE_ERROR = 'The database service is temporarily unavailable.'
SECRET = 'SELECT password FROM private_table; password=synthetic-secret learner@example.invalid'


def load(path, names, scope):
    return support.definitions(ROOT / path, names, scope)


def module(name, **values):
    result = ModuleType(name)
    result.__dict__.update(values)
    return result


class Response(dict):
    def __init__(self, data, status=200):
        self.data, self.status_code = data, status


class FinalFourTests(unittest.TestCase):
    def auth(self, account=None, unreadable=False, failure=None):
        self.logger = Mock(spec=logging.Logger)
        scope = dict(__name__='login.views', __package__='login', JsonResponse=Response, DatabaseError=support.DatabaseError,
                     logger=self.logger, require_GET=lambda f: f,
                     authenticate_request=Mock(return_value=account, side_effect=failure),
                     session_unreadable=lambda request: unreadable,
                     identity=NS(account_payload=Mock(return_value={'id': 1})))
        load('backend/login/permissions.py', ['_unavailable'], scope)
        load('backend/login/views.py', ['_error', 'me', 'learner_action_access'], scope)
        return scope

    def action(self, scope, learner='1', coach=False, own=False):
        permissions = module('login.permissions', coach_owns_learner=Mock(return_value=coach),
                             staff_owns_learner=Mock(return_value=own))
        with patch.dict(sys.modules, {'login.permissions': permissions}):
            return scope['learner_action_access'](NS(GET={'learnerId': learner}))

    def test_missing_session_and_unreadable_session_are_distinct(self):
        for unreadable, status in [(False, 401), (True, 503)]:
            scope = self.auth(unreadable=unreadable)
            for response in (scope['me'](NS()), self.action(scope)):
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.data['code'],
                                 'session_unavailable' if unreadable else 'unauthenticated')
                if unreadable:
                    self.assertEqual(response['Retry-After'], '5')
                self.assertNotIn('Set-Cookie', response)

    def test_lookup_failures_are_unavailable_without_middleware(self):
        for error in [support.DatabaseError(SECRET), RuntimeError(SECRET)]:
            scope = self.auth(failure=error)
            for response in (scope['me'](NS()), self.action(scope)):
                self.assertEqual(response.status_code, 503)
                self.assertNotIn(SECRET, str(response.data))
            for call in self.logger.mock_calls:
                self.assertNotIn(SECRET, str(call))

    def test_stale_staff_role_is_not_used_when_grants_are_unavailable(self):
        scope = self.auth(NS(role='admin', _staff_access_unavailable=True))
        self.assertEqual(scope['me'](NS()).status_code, 503)
        self.assertEqual(self.action(scope).status_code, 503)

    def test_action_ownership_and_validation_remain_intact(self):
        for role, subject, learner, coach, own, allowed in [
            ('learner', 1, '1', False, False, True),
            ('learner', 1, '2', False, False, False),
            ('admin', 9, '2', False, False, True),
            ('staff', 9, '2', True, False, True),
            ('staff', 9, '2', False, True, True),
            ('staff', 9, '2', False, False, False),
            ('employer', 9, '2', False, False, False),
            ('admin', 9, '0', False, False, False),
        ]:
            scope = self.auth(NS(role=role, subject_id=subject))
            result = self.action(scope, learner, coach, own)
            self.assertEqual(result.data, {'canAct': allowed})
            self.assertEqual(result['Cache-Control'], 'private, no-store')
        self.assertEqual(self.action(scope, 'bad').status_code, 400)

    def test_session_resolution_denies_expired_revoked_inactive_and_unknown(self):
        now = datetime(2026, 10, 21, tzinfo=timezone.utc)
        for state in ['valid', 'expired', 'revoked', 'inactive', 'unknown', 'missing']:
            account = NS(is_active=state != 'inactive', subject_type='staff')
            row = NS(account=account, expires_at=now + timedelta(days=-1 if state == 'expired' else 1))
            query = Mock()
            query.select_related.return_value = query
            query.filter.return_value = query
            query.first.return_value = None if state in {'revoked', 'unknown'} else row
            scope = dict(LoginSession=NS(objects=query), hash_token=lambda token: 'hash',
                         timezone=NS(now=lambda: now), event_log=Mock(), _event=Mock(),
                         expiry_reason=lambda row: 'expired_idle')
            load('backend/login/sessions.py', ['resolve_session'], scope)
            result = scope['resolve_session'](None if state == 'missing' else 'synthetic')
            self.assertIs(result, row if state == 'valid' else None)
            if state == 'missing':
                query.select_related.assert_not_called()
            else:
                query.filter.assert_called_once_with(token_hash='hash', revoked_at__isnull=True)

    def grants(self):
        scope = dict(ACCESS_CHOICES=('super-admin', 'coach', 'tutor', 'record-monitor'),
                     ACCESS_SUPER_ADMIN='super-admin', ROLE_ADMIN='admin', ROLE_STAFF='staff')
        load('backend/login/identity.py',
             ['role_for_staff', 'access_for_staff', 'parse_access_list', 'accesses_for_staff'], scope)
        return scope

    def refresh(self, primary, extra, role='staff', failure=None):
        grants = self.grants()
        row = NS(access=primary, access_extra=extra, position='Admin')
        query = Mock()
        query.filter.return_value = query
        query.only.return_value = query
        query.first.side_effect = failure
        query.first.return_value = row
        account = NS(subject_type='staff', subject_id=1, role=role, save=Mock())
        scope = {'__name__': 'login.sessions', '__package__': 'login'}
        modules = {'django.db': module('django.db', DatabaseError=support.DatabaseError),
                   'learner_api.models': module('learner_api.models', StaffUser=NS(objects=query)),
                   'login.identity': module('login.identity', **grants)}
        load('backend/login/sessions.py', ['_refresh_staff_role'], scope)
        with patch.dict(sys.modules, modules):
            scope['_refresh_staff_role'](account)
        return account, grants['accesses_for_staff'](row)

    def test_primary_additional_combined_grants_and_precedence(self):
        for primary, extra, role, grants in [
            ('super-admin', '', 'admin', {'super-admin'}),
            ('coach', ' SUPER-ADMIN , tutor ', 'admin', {'super-admin'}),
            ('', 'super-admin', 'admin', {'super-admin'}),
            ('coach', 'tutor', 'staff', {'coach', 'tutor'}),
            ('', 'tutor', 'staff', {'tutor'}),
            ('record-monitor', 'unknown', 'staff', {'record-monitor'}),
            ('', '', 'staff', set()),
            ('unknown', 'unrelated', 'staff', set()),
        ]:
            with self.subTest(primary=primary, extra=extra):
                account, actual = self.refresh(primary, extra)
                self.assertEqual(account.role, role)
                self.assertEqual(actual, grants)
                self.assertEqual(account._staff_access, primary.strip().lower())
                self.assertEqual(account.save.call_count, int(role != 'staff'))

    def test_revocation_demotes_and_unreadable_grants_fail_closed(self):
        account, _ = self.refresh('coach', '', role='admin')
        self.assertEqual(account.role, 'staff')
        account.save.assert_called_once_with(update_fields=['role', 'updated_at'])
        account, _ = self.refresh('coach', '', role='admin', failure=support.DatabaseError(SECRET))
        self.assertTrue(account._staff_access_unavailable)
        account.save.assert_not_called()

    def test_access_gate_honors_extras_without_granting_unrelated_privileges(self):
        grants = self.grants()
        scope = dict(__name__='login.permissions', __package__='login', functools=functools,
                     JsonResponse=Response, session_unreadable=lambda request: False)
        load('backend/login/permissions.py',
             ['_unauthenticated', '_unavailable', '_forbidden', '_accesses_of', 'require_access'], scope)
        query = Mock()
        query.filter.return_value = query
        query.only.return_value = query
        modules = {'django.db': module('django.db', DatabaseError=support.DatabaseError),
                   'learner_api.constants': module('learner_api.constants', ACCESS_SUPER_ADMIN='super-admin'),
                   'learner_api.models': module('learner_api.models', StaffUser=NS(objects=query)),
                   'login.identity': module('login.identity', **grants)}
        with patch.dict(sys.modules, modules):
            for primary, extra, required, expected in [
                ('coach', '', 'coach', 200), ('coach', 'tutor', 'tutor', 200),
                ('', 'tutor', 'tutor', 200), ('coach', 'tutor', 'super-admin', 403),
                ('', '', 'coach', 403), ('coach', 'super-admin', 'tutor', 200),
            ]:
                query.first.return_value = NS(access=primary, access_extra=extra)
                scope['authenticate_request'] = lambda request: NS(role='staff', subject_type='staff', subject_id=1)
                endpoint = scope['require_access'](required)(lambda request: Response({'ok': True}))
                self.assertEqual(endpoint(NS()).status_code, expected)
            # Inactive account resolution (tested above) supplies no account to the gate.
            scope['authenticate_request'] = lambda request: None
            self.assertEqual(endpoint(NS()).status_code, 401)

    def test_middleware_failure_marks_session_without_clearing_cookie(self):
        scope = dict(__name__='login.middleware', __package__='login',
                     _authenticate_with_file_retry=Mock(side_effect=support.DatabaseError(SECRET)),
                     DatabaseError=support.DatabaseError, logger=Mock(spec=logging.Logger),
                     RENEWED_UNTIL_ATTR='login_session_renewed_until',
                     mark_session_unreadable=lambda request: setattr(request, 'login_session_unreadable', True),
                     refresh_session_cookie=Mock(), close_old_connections=Mock())
        tree = ast.parse((ROOT / 'backend/login/middleware.py').read_text(encoding='utf-8-sig'))
        node = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'LoginSessionMiddleware')
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<middleware-source>', 'exec'), scope)
        request = NS()
        auth = self.auth(unreadable=True)
        for error in [support.DatabaseError(SECRET), RuntimeError(SECRET)]:
            scope['_authenticate_with_file_retry'].side_effect = error
            result = scope['LoginSessionMiddleware'](auth['me'])(request)
            self.assertTrue(request.login_session_unreadable)
            self.assertIsNone(request.login_account)
            self.assertEqual(result.status_code, 503)
            self.assertNotIn('Set-Cookie', result)
        self.assertNotIn(SECRET, str(scope['logger'].mock_calls))

    def test_me_payload_database_failure_keeps_502_and_safe_text(self):
        scope = self.auth(NS(role='learner'))
        scope['identity'].account_payload.side_effect = support.DatabaseError(SECRET)
        response = scope['me'](NS())
        self.assertEqual((response.status_code, response.data), (502, {'error': SAFE_ERROR}))
        self.assertNotIn(SECRET, str(self.logger.mock_calls))

    def test_health_database_failure_keeps_shape_and_safe_text(self):
        scope = self.auth()
        scope.update(LoginAccount=NS(objects=NS(count=Mock(side_effect=support.DatabaseError(SECRET)))),
                     email_azure=NS(is_configured=lambda: True, missing_settings=lambda: []),
                     microsoft_sso=NS(is_configured=lambda: True, missing_settings=lambda: []))
        load('backend/login/views.py', ['health'], scope)
        response = scope['health'](NS())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['database'], dict(ok=False, error=SAFE_ERROR,
                                                       accounts=None, accountsWithPassword=None))
        self.assertNotIn(SECRET, str(self.logger.mock_calls))

    def test_invitation_service_sanitizes_each_database_failure_and_keeps_denials(self):
        class AccountError(ValueError):
            pass

        class InvitePermissionError(PermissionError):
            pass

        for stage in ['lookup', 'account', 'invitation', 'validation', 'forbidden', 'inactive']:
            logger = Mock(spec=logging.Logger)
            account = NS(has_password=False)
            scope = dict(DatabaseError=support.DatabaseError, AccountError=AccountError,
                         InvitePermissionError=InvitePermissionError, logger=logger,
                         ROLE_ADMIN='admin', _MAY_INVITE={'admin', 'staff'},
                         fetch_subject=Mock(return_value=NS()),
                         describe_subject=Mock(return_value=('synthetic@example.invalid', 'Synthetic', 'learner')),
                         ensure_account=Mock(return_value=(account, True)),
                         send_invitation=Mock(return_value=(NS(expires_at=datetime.now(timezone.utc)), True, None)))
            load('backend/login/services.py', ['_authorise', 'invite_subject'], scope)
            if stage in {'lookup', 'account', 'invitation'}:
                scope[{'lookup': 'fetch_subject', 'account': 'ensure_account',
                       'invitation': 'send_invitation'}[stage]].side_effect = support.DatabaseError(SECRET)
            if stage == 'validation':
                scope['fetch_subject'].side_effect = ValueError('Unknown subject type.')
            inviter = NS(is_active=stage != 'inactive', role='learner' if stage == 'forbidden' else 'admin',
                         email='synthetic@example.invalid')
            result = scope['invite_subject']('learner', 1, inviter=inviter)
            if stage in {'lookup', 'account', 'invitation'}:
                self.assertEqual(result['error'], SAFE_ERROR)
                self.assertFalse(result['forbidden'])
                self.assertNotIn(SECRET, str(logger.mock_calls))
            elif stage == 'validation':
                self.assertEqual(result['error'], 'Unknown subject type.')
            else:
                self.assertTrue(result['forbidden'])
                scope['ensure_account'].assert_not_called()

    def test_all_targeted_database_handlers_use_safe_literal_errors_and_logs(self):
        counts = []
        for path in ['backend/login/views.py', 'backend/learner_api/learning_plan.py',
                     'backend/learner_api/learner_detail.py']:
            tree = ast.parse((ROOT / path).read_text(encoding='utf-8-sig'))
            count = 0
            for handler in ast.walk(tree):
                if not isinstance(handler, ast.ExceptHandler) or handler.type is None:
                    continue
                if ast.unparse(handler.type) != 'DatabaseError':
                    continue
                calls = [n for n in ast.walk(handler) if isinstance(n, ast.Call)]
                if not any(ast.unparse(c.func) == '_error' for c in calls) and path != 'backend/login/views.py':
                    continue  # Read fallbacks do not produce public database error responses.
                count += 1
                self.assertTrue(any(ast.unparse(c.func) == 'logger.error' for c in calls), path)
                self.assertFalse(any(ast.unparse(c.func) == 'logger.exception' for c in calls), path)
                for call in calls:
                    if ast.unparse(call.func) == '_error':
                        self.assertEqual(ast.literal_eval(call.args[0]), SAFE_ERROR)
                        self.assertEqual(ast.literal_eval(call.args[1]), 502)
                self.assertFalse(any(isinstance(n, ast.JoinedStr) for n in ast.walk(handler)), path)
            counts.append(count)
        self.assertEqual(counts, [10, 10, 3])

    def test_free_course_serializer_omits_order_and_keeps_authored_order(self):
        weeks = [dict(id='W2', course_id='F1', week_number=2, week_title='Two'),
                 dict(id='W1', course_id='F1', week_number=1, week_title='One')]
        query = Mock()
        query.filter.return_value = query
        query.values_list.return_value = []
        scope = dict(require_GET=lambda f: f, learner_self_or_staff=lambda **kw: lambda f: f,
                     JsonResponse=Response, DatabaseError=support.DatabaseError,
                     _resolve_source=lambda kind, pk: (NS(pk=1, free_courses=[{'freeCourseId': 'F1'}]), None),
                     _normalize_free_courses=lambda value: value,
                     _scoped_rows=lambda ids: ({}, weeks, []), clean_str=lambda value: str(value or ''),
                     LearnerFreeCourseProgress=NS(objects=query))
        load('backend/learner_api/free_courses_view.py', ['free_courses'], scope)
        result = scope['free_courses'](NS(), 'commercial', 1)
        actual = result.data['freeCourses'][0]['weeks']
        self.assertEqual([week['weekId'] for week in actual], ['W2', 'W1'])
        self.assertEqual(actual, [dict(weekId='W2', weekNumber=2, weekTitle='Two', activities=[]),
                                  dict(weekId='W1', weekNumber=1, weekTitle='One', activities=[])])
        self.assertEqual(result['Cache-Control'], 'private, no-store')

    def test_changed_modules_local_import_symbols_resolve_without_startup(self):
        backend = ROOT / 'backend'
        for name in ['login.views', 'login.sessions', 'login.middleware', 'login.services',
                     'learner_api.learning_plan', 'learner_api.learner_detail']:
            path = backend.joinpath(*name.split('.')).with_suffix('.py')
            tree = ast.parse(path.read_text(encoding='utf-8-sig'))
            package = name.split('.')[:-1]
            for node in tree.body:
                if not isinstance(node, ast.ImportFrom):
                    continue
                prefix = package[:len(package) - node.level + 1] if node.level else []
                target = '.'.join([*prefix, *node.module.split('.')]) if node.module else '.'.join(prefix)
                target_path = backend.joinpath(*target.split('.')).with_suffix('.py')
                if not target_path.is_file():
                    continue
                definitions = ast.parse(target_path.read_text(encoding='utf-8-sig')).body
                exported = set()
                for definition in definitions:
                    if isinstance(definition, (ast.FunctionDef, ast.ClassDef)):
                        exported.add(definition.name)
                    elif isinstance(definition, ast.Assign):
                        exported.update(t.id for t in definition.targets if isinstance(t, ast.Name))
                    elif isinstance(definition, (ast.Import, ast.ImportFrom)):
                        exported.update(a.asname or a.name.split('.')[0] for a in definition.names)
                for alias in node.names:
                    child = backend.joinpath(*target.split('.'), alias.name)
                    self.assertTrue(alias.name in exported or child.with_suffix('.py').is_file()
                                    or (child / '__init__.py').is_file(), (name, target, alias.name))


if __name__ == '__main__':
    sys.addaudithook(support.guard)
    unittest.main()
