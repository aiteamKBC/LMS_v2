"""Administrators can operate a selected learner without changing identities."""
import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from . import permissions


class AdminLearnerActionTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.admin = SimpleNamespace(id=1, role='admin', subject_type='staff',
                                     subject_id=3, email='admin@example.test', display_name='Administrator')
        self.enterContext(patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}))
        self.authenticate = self.enterContext(patch.object(permissions, 'authenticate_request', return_value=self.admin))
        self.audit = self.enterContext(patch('login.invitations.record'))

    def test_all_target_shapes_allow_admin_and_preserve_the_actor(self):
        for shape in ('kwarg', 'query_param', 'body_field'):
            with self.subTest(shape=shape):
                seen = []

                def save(request, **kwargs):
                    seen.append(request.login_account)
                    return JsonResponse({'saved': True})

                wrapped = permissions.learner_self_or_admin(**{shape: 'learnerId'})(save)
                path = '/learner_api/example/?learnerId=56' if shape == 'query_param' else '/learner_api/example/'
                request = self.factory.post(path, data=json.dumps({'learnerId': 56}), content_type='application/json')
                response = wrapped(request, **({'learnerId': 56} if shape == 'kwarg' else {}))
                self.assertEqual(response.status_code, 200)
                self.assertIs(seen[0], self.admin)
                self.assertEqual((self.admin.role, self.admin.subject_id), ('admin', 3))
                event = self.audit.call_args
                self.assertEqual(event.args, ('admin_learner_action',))
                self.assertEqual(event.kwargs['account_id'], 1)
                self.assertEqual(event.kwargs['email'], 'admin@example.test')
                self.assertTrue(event.kwargs['succeeded'])
                self.assertEqual(json.loads(event.kwargs['reason'])['learnerId'], 56)

    def test_malformed_or_missing_target_never_reaches_the_write(self):
        save = Mock(return_value=JsonResponse({'saved': True}))
        wrapped = permissions.learner_self_or_admin(body_field='learnerId')(save)
        for body in ('{}', '[]', 'null', '{', '{"learnerId": 0}', '{"learnerId": -1}', '{"learnerId": "abc"}'):
            request = self.factory.post('/', data=body, content_type='application/json')
            self.assertEqual(wrapped(request).status_code, 400)
        save.assert_not_called()
        self.audit.assert_not_called()

    def test_staff_employers_other_learners_and_anonymous_cannot_write(self):
        save = Mock(return_value=JsonResponse({'saved': True}))
        wrapped = permissions.learner_self_or_admin(kwarg='pk')(save)
        for account, expected in (
            (SimpleNamespace(role='staff'), 403), (SimpleNamespace(role='employer'), 403),
            (SimpleNamespace(role='learner', subject_id=19), 404), (None, 401),
        ):
            self.authenticate.return_value = account
            self.assertEqual(wrapped(self.factory.post('/'), pk=56).status_code, expected)
        save.assert_not_called()
        self.audit.assert_not_called()

    def test_owner_actions_still_work_without_an_admin_audit_record(self):
        self.authenticate.return_value = SimpleNamespace(role='learner', subject_id=56)
        wrapped = permissions.learner_self_or_admin(kwarg='pk')(lambda request, **kwargs: JsonResponse({'saved': True}))
        self.assertEqual(wrapped(self.factory.post('/'), pk=56).status_code, 200)
        self.audit.assert_not_called()

    def test_admin_read_does_not_create_a_write_audit_record(self):
        wrapped = permissions.learner_self_or_admin(kwarg='pk')(lambda request, **kwargs: JsonResponse({'ready': True}))
        self.assertEqual(wrapped(self.factory.get('/'), pk=56).status_code, 200)
        self.audit.assert_not_called()

    def test_private_calendar_connections_remain_owner_only(self):
        save = Mock()
        wrapped = permissions.learner_self_only(kwarg='learner_id')(save)
        for method in ('get', 'post'):
            self.assertEqual(wrapped(getattr(self.factory, method)('/'), learner_id=56).status_code, 403)
        save.assert_not_called()

    def test_admin_can_start_a_real_tracking_session_for_the_selected_learner(self):
        from learner_api.time_tracking import start_time_tracking, verify_tracking_session
        request = self.factory.post('/learner_api/time-tracking/start/?kind=commercial&learnerId=56',
            data=json.dumps({'activityKind': 'component', 'activityId': 'reading-1', 'countingMode': 'visible_page'}),
            content_type='application/json')
        response = start_time_tracking(request)
        self.assertEqual(response.status_code, 200)
        saved = json.loads(response.content)
        verified = verify_tracking_session(saved['trackingToken'], activity_kind='component',
            activity_id='reading-1', learner_kind='commercial', learner_id='56', claimed_seconds=0)
        self.assertEqual(verified['sessionId'], saved['sessionId'])

    def test_learning_statement_generation_allows_admin_but_not_staff(self):
        from learner_api import reflection_ai
        with patch.object(reflection_ai, '_generate_learning_statements', return_value=JsonResponse({'generated': True})) as generate:
            request = self.factory.post('/', data=json.dumps({'learnerId': 56}), content_type='application/json')
            self.assertEqual(reflection_ai.generate_learning_statements(request).status_code, 200)
            generate.assert_called_once_with(request)
            self.assertIs(request.login_account, self.admin)
            self.authenticate.return_value = SimpleNamespace(role='staff')
            generate.reset_mock()
            request = self.factory.post('/', data=json.dumps({'learnerId': 56}), content_type='application/json')
            self.assertEqual(reflection_ai.generate_learning_statements(request).status_code, 403)
            generate.assert_not_called()

    def test_monthly_report_keeps_admin_name_and_does_not_replace_learner_signature(self):
        from learner_api import monthly_reports as reports
        request = self.factory.post('/', data=json.dumps({
            'monthKey': '2026-08', 'learnedSummary': 'Reviewed this month.',
            'signature': 'data:image/png;base64,admin', 'signedName': 'Learner', 'saveSignature': True,
        }), content_type='application/json')
        with patch.object(reports, 'connections') as connections, \
             patch.object(reports.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(reports, '_row_to_report', return_value={'saved': True}):
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            response = reports.monthly_reports(request, kind='commercial', pk=56)
        self.assertEqual(response.status_code, 201)
        # Only the report is written, never the reusable signature on Created_users.
        cursor.execute.assert_called_once()
        parameters = cursor.execute.call_args.args[1]
        self.assertEqual(parameters[2], '56')
        self.assertEqual(parameters[-1], 'Administrator')
        self.assertEqual(json.loads(self.audit.call_args.kwargs['reason'])['learnerId'], 56)

    def test_admin_can_save_a_subject_completion_for_the_selected_learner(self):
        from learner_api import student_activity
        attempt_id = 'e68f6bd9-449f-4df5-9e70-9bc50f8f0021'
        request = self.factory.post(f'/learner_api/student-activity/commercial/56/2/3/attempts/{attempt_id}/',
            data=json.dumps({'reading_confirmed': True}), content_type='application/json')
        with patch.object(student_activity, '_owned_material', return_value=(4176, {})), \
             patch.object(student_activity.subject_store, 'finish', return_value={'completed': True}) as finish:
            response = student_activity.submit_subject_attempt(request, kind='commercial', pk=56,
                group_id=2, activity_id=3, attempt_id=attempt_id)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(json.loads(response.content)['completed'])
        finish.assert_called_once_with(56, 4176, 2, 3, attempt_id, {}, True)
        self.assertEqual(json.loads(self.audit.call_args.kwargs['reason'])['learnerId'], 56)
