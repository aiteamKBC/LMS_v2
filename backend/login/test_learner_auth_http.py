"""Executed only by the disposable PostgreSQL runner; actual middleware + SQL."""
import json
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connections, DatabaseError
from django.http import JsonResponse
from django.test import RequestFactory, override_settings
from django.utils.functional import SimpleLazyObject

from config.learner_auth import ALIAS
from login import identity, permissions, sessions, views
from login.api_gate import ApiSessionGateMiddleware
from login.middleware import LoginSessionMiddleware
from login.test_learner_auth_adapter import AdapterTests
from django.urls import path

urlpatterns = [path('login_api/me/', views.me), path('login_api/login/', views.login)]


class RuntimeHTTPTests(unittest.TestCase):
    setUp = AdapterTests.setUp
    tearDown = AdapterTests.tearDown
    sql = staticmethod(AdapterTests.sql)
    # Reuse synthetic fixture setup, not the adapter test cases.
    def request(self, view, *, account_id=18, path='/login_api/me/', method='get', data=None, token=None, xhr=True):
        factory = RequestFactory()
        request = getattr(factory, method)(path, data=json.dumps(data or {}) if method == 'post' else data or {},
            content_type='application/json', **({'HTTP_X_REQUESTED_WITH': 'XMLHttpRequest'} if xhr else {}))
        request.COOKIES[sessions.COOKIE_NAME] = token if token is not None else self.tokens[account_id]
        request.user = SimpleLazyObject(lambda: self.fail('Platform request evaluated Django user'))
        return LoginSessionMiddleware(ApiSessionGateMiddleware(view))(request)

    def boundary(self, *, writes=False):
        stack = ExitStack()
        self.sql_trace = []
        def trace(execute, sql, params, many, context):
            alias = context['connection'].alias
            self.sql_trace.append((alias, sql))
            if alias != ALIAS:
                allowed = writes and (sql.lstrip().upper().startswith(('UPDATE ', 'INSERT ', 'SAVEPOINT ', 'RELEASE SAVEPOINT ')))
                if not allowed:
                    raise AssertionError('Unexpected source/default SQL: ' + sql)
            return execute(sql, params, many, context)
        for alias in connections:
            stack.enter_context(connections[alias].execute_wrapper(trace))
        return stack

    def test_http_me_sql_boundary_all_roles_and_no_deferred_reads(self):
        for account_id, subject_id in ((17,83), (18,272), (19,90)):
            with self.boundary():
                response = self.request(views.me, account_id=account_id)
            self.assertEqual(response.status_code, 200, response.content)
            payload = json.loads(response.content)['user']
            self.assertEqual(payload['id'], account_id)
            self.assertEqual(payload['subjectId'], subject_id)
            self.assertNotIn('password_hash', payload)
            print('HTTP /me SQL boundary:', account_id, len(self.sql_trace), 'reader statements; zero source/default')

    def test_http_permissions_ownership_and_demotions(self):
        @permissions.require_access('coach')
        def coach(request):
            return JsonResponse({'own': permissions.coach_owns_learner(request.login_account,271),
                                 'other': permissions.coach_owns_learner(request.login_account,272)})
        with self.boundary():
            response = self.request(coach, account_id=17, path='/coach_api/test/')
        self.assertEqual(json.loads(response.content), {'own':True,'other':False})
        self.sql('UPDATE enrolment."Staff_users" SET "Access"=NULL,"Access_extra"=NULL WHERE id=83')
        try:
            with self.boundary():
                self.assertEqual(self.request(coach, account_id=17, path='/coach_api/test/').status_code,403)
        finally:
            self.sql('UPDATE enrolment."Staff_users" SET "Access"=\'coach\',"Access_extra"=\'enrolment\' WHERE id=83')

    def test_http_reader_outage_is_503_without_django_fallback(self):
        with patch.object(connections[ALIAS], 'cursor', side_effect=DatabaseError('synthetic')):
            with self.boundary():
                response = self.request(views.me)
        self.assertEqual(response.status_code,503)
        self.assertEqual(json.loads(response.content)['code'],'session_unavailable')
        self.assertNotIn(sessions.COOKIE_NAME,response.cookies)

    def test_http_unknown_session_refuses_without_fallback(self):
        with self.boundary():
            response = self.request(views.me,token='unknown-synthetic')
        self.assertEqual(response.status_code,401)

    def test_django_admin_boundary_remains_independent(self):
        request = RequestFactory().get('/curriculum_api/test/')
        request.user = SimpleNamespace(is_authenticated=True)
        request.login_account = None
        self.assertTrue(ApiSessionGateMiddleware._django_user(request))
        request.COOKIES[sessions.COOKIE_NAME] = 'invalid'
        self.assertFalse(ApiSessionGateMiddleware._django_user(request))

    def test_http_logout_updates_source_and_projection_without_source_select(self):
        with self.boundary(writes=True):
            response = self.request(views.logout,method='post')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.cookies[sessions.COOKIE_NAME]['max-age'],0)
        self.assertIsNone(sessions.resolve_session(self.tokens[18]))

    def test_http_password_login_and_csrf(self):
        from login.models import LoginAccount
        from login.security import hash_password
        account = LoginAccount.objects.get(pk=18)
        old = account.password_hash
        LoginAccount.objects.filter(pk=18).update(password_hash=hash_password('Synthetic-Harbour-92!'))
        try:
            payload = {'email':'draft@example.test','password':'Synthetic-Harbour-92!','remember':True}
            with self.boundary(writes=True):
                denied = self.request(views.login,method='post',data=payload,xhr=False)
                response = self.request(views.login,method='post',data=payload)
            self.assertEqual(denied.status_code,403)
            self.assertEqual(response.status_code,200,response.content)
            self.assertTrue(response.cookies[sessions.COOKIE_NAME]['httponly'])
            self.assertGreater(int(response.cookies[sessions.COOKIE_NAME]['max-age']),0)
        finally:
            LoginAccount.objects.filter(pk=18).update(password_hash=old)

    def test_http_token_peeks_and_consumed_token(self):
        from login import invitations
        from login.models import LoginAccount
        account = LoginAccount.objects.get(pk=18)
        for create, view in ((invitations.create_reset, views.reset_info),
                             (invitations.create_invitation, views.invitation_info)):
            row, token = create(account)
            with self.boundary():
                response = self.request(view, data={'token':token})
            self.assertEqual(response.status_code,200)
            self.assertEqual(json.loads(response.content)['email'],account.email)
            from django.utils import timezone
            row.used_at = timezone.now()
            row.save(update_fields=['used_at'])
            with self.boundary():
                self.assertEqual(self.request(view,data={'token':token}).status_code,400)

    def test_http_sso_uses_reader_and_preserves_nonce_binding(self):
        from django.core import signing
        from login import microsoft_sso as sso, security
        nonce = 'synthetic-nonce'
        state = signing.dumps({'n':security.hash_token(nonce)}, salt=sso.STATE_SALT)
        request = RequestFactory().get('/login_api/microsoft/callback/',{'state':state,'code':'synthetic'})
        request.COOKIES[sso.NONCE_COOKIE] = nonce
        with patch.object(sso,'missing_settings',return_value=[]), \
                patch.object(sso,'_exchange_code',return_value='synthetic'), \
                patch.object(sso,'_graph_email',return_value='draft@example.test'), self.boundary(writes=True):
            response = LoginSessionMiddleware(sso.callback)(request)
        self.assertEqual(response.status_code,302)
        self.assertTrue(response['Location'].endswith('/learner/home'))
        self.assertEqual(response.cookies[sessions.COOKIE_NAME]['max-age'],'')
        self.assertEqual(response.cookies[sso.NONCE_COOKIE]['max-age'],0)
        request = RequestFactory().get('/login_api/microsoft/callback/',{'state':state,'code':'synthetic'})
        with patch.object(sso,'missing_settings',return_value=[]), \
                patch.object(sso,'_exchange_code') as exchange, self.boundary(writes=True):
            response = sso.callback(request)
        exchange.assert_not_called()
        self.assertNotIn(sessions.COOKIE_NAME,response.cookies)

    def test_programme_gate_and_canonical_identity_use_only_learner(self):
        from login import learner_auth_runtime
        from learner_api.canonical_learning import profile
        self.sql('UPDATE enrolment."Created_users" SET "Cohort"=\'Cohort\',"Programme"=\'P\' WHERE id=272')
        try:
            with self.boundary():
                self.assertEqual(profile(271)['id'],510)
                source = learner_auth_runtime.programme_source(272)
                self.assertEqual(source.programme,'P')
                response = self.request(lambda request: JsonResponse({'ok':True}),
                                        path='/learner_api/quizzes/1/submit/',method='post')
            self.assertEqual(response.status_code,403)
            self.assertEqual(json.loads(response.content)['code'],'programme_not_started')
        finally:
            self.sql('UPDATE enrolment."Created_users" SET "Cohort"=NULL WHERE id=272')

    def test_batch_does_not_evaluate_django_identity(self):
        from config.batch import _execute_get
        request = RequestFactory().get('/api/batch/')
        request.COOKIES[sessions.COOKIE_NAME] = self.tokens[17]
        request.user = SimpleLazyObject(lambda: self.fail('Batch evaluated Django auth'))
        with self.boundary():
            sessions.authenticate_request(request)
            with patch('config.batch.resolve',return_value=SimpleNamespace(
                    func=lambda req: JsonResponse({'ok':True}),args=(),kwargs={})):
                result = _execute_get(request,{'id':'synthetic','url':'/coach_api/test/'})
        self.assertEqual(result['status'],200)

    def test_django_client_middleware_stack_never_loads_django_user(self):
        from django.test import Client
        with override_settings(ROOT_URLCONF=__name__, MIDDLEWARE=[
                'django.contrib.sessions.middleware.SessionMiddleware',
                'django.contrib.auth.middleware.AuthenticationMiddleware',
                'login.middleware.LoginSessionMiddleware',
                'login.api_gate.ApiSessionGateMiddleware']):
            client = Client()
            client.cookies[sessions.COOKIE_NAME] = self.tokens[18]
            client.cookies['sessionid'] = 'synthetic-other-domain'
            with patch('django.contrib.auth.get_user',side_effect=AssertionError('Django auth loaded')), self.boundary():
                response = client.get('/login_api/me/')
            self.assertEqual(response.status_code,200)

    def test_coach_workspace_identity_and_preview_boundary(self):
        from coach_api.auth import coach_access_required
        @coach_access_required
        def workspace(request):
            return JsonResponse({'email':request.coach_email,'preview':request.coach_view_as})
        with self.boundary():
            response = self.request(workspace,account_id=17,path='/coach_api/test/')
            denied = self.request(workspace,account_id=17,path='/coach_api/test/',
                                  data={'ownerEmail':'other@example.test'})
        self.assertEqual(json.loads(response.content),{'email':'learner@example.test','preview':False})
        self.assertEqual(denied.status_code,403)
        self.sql('UPDATE enrolment."Staff_users" SET "Access"=\'super-admin\',"Access_extra"=NULL WHERE id=83')
        self.sql('INSERT INTO enrolment."Staff_users"(id,"Email","Username","Access") VALUES(84,\'coach@example.test\',\'Coach\',\'coach\')')
        try:
            with self.boundary():
                selected = self.request(workspace,account_id=17,path='/coach_api/test/',data={'viewAsCoach':'coach@example.test'})
                no_selection = self.request(workspace,account_id=17,path='/coach_api/test/')
                denied_write = self.request(workspace,account_id=17,path='/coach_api/test/',method='post',data={'viewAsCoach':'coach@example.test'})
            self.assertEqual(json.loads(selected.content),{'email':'coach@example.test','preview':True})
            self.assertEqual(no_selection.status_code,403)
            self.assertEqual(denied_write.status_code,403)
        finally:
            self.sql('DELETE FROM enrolment."Staff_users" WHERE id=84')
            self.sql('UPDATE enrolment."Staff_users" SET "Access"=\'coach\',"Access_extra"=\'enrolment\' WHERE id=83')

    def test_password_change_and_renewal_keep_source_writer(self):
        from datetime import timedelta
        from django.utils import timezone
        from login.models import LoginAccount, LoginSession
        from login.security import hash_password
        account = LoginAccount.objects.get(pk=18)
        old = account.password_hash
        LoginAccount.objects.filter(pk=18).update(password_hash=hash_password('Synthetic-Harbour-92!'))
        _, other, _ = sessions.issue_session(account)
        LoginSession.objects.filter(pk=self.session_ids[1]).update(
            last_seen_at=timezone.now()-timedelta(hours=1),expires_at=timezone.now()+timedelta(minutes=1))
        try:
            with self.boundary(writes=True):
                response = self.request(views.change_password,method='post',data={
                    'currentPassword':'Synthetic-Harbour-92!','newPassword':'Changed-Harbour-92!'})
            self.assertEqual(response.status_code,200)
            self.assertIsNotNone(sessions.resolve_session(self.tokens[18]))
            self.assertIsNotNone(LoginSession.objects.get(pk=other.pk).revoked_at)
        finally:
            LoginAccount.objects.filter(pk=18).update(password_hash=old)
            LoginSession.objects.filter(pk=other.pk).delete()


