"""A staff account may study only its own server-linked learner record."""
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from . import permissions, views


def staff(**overrides):
    return SimpleNamespace(**{
        'id': 7, 'role': 'staff', 'subject_type': 'staff', 'subject_id': 31,
        'email': 'student.staff@example.test', 'display_name': 'Staff Learner',
        **overrides,
    })


class StaffOwnsLearnerTests(SimpleTestCase):
    def setUp(self):
        self.rows = self.enterContext(patch('learner_api.models.EnrolmentUser.all_learners'))

    def test_uses_the_same_normalised_email_link_as_the_session_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.rows.filter.return_value.__getitem__.return_value = [SimpleNamespace(pk=56, learner_type=kind)]
                self.assertTrue(permissions.staff_owns_learner(staff(email=' Student.Staff@Example.TEST '), 56))
                self.rows.filter.assert_called_with(email__iexact='student.staff@example.test')

    def test_missing_or_different_link_never_matches_even_if_staff_ids_collide(self):
        for linked in (None, SimpleNamespace(pk=19)):
            self.rows.filter.return_value.__getitem__.return_value = [linked] if linked else []
            self.assertFalse(permissions.staff_owns_learner(staff(subject_id=56), 56))

    def test_invalid_identity_and_target_do_not_query(self):
        for account, target in (
            (None, 56), (staff(role='employer'), 56), (staff(role='learner'), 56),
            (staff(role='admin'), 56), (staff(subject_type='learner'), 56),
            (staff(email=''), 56), (staff(), None), (staff(), 0), (staff(), -1),
        ):
            with self.subTest(account=account, target=target):
                self.assertFalse(permissions.staff_owns_learner(account, target))
        self.rows.filter.assert_not_called()

    def test_an_unreadable_link_fails_closed(self):
        self.rows.filter.side_effect = DatabaseError('unavailable')
        self.assertFalse(permissions.staff_owns_learner(staff(), 56))


class StaffLearnerActionTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = staff()
        self.enterContext(patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}))
        self.authenticate = self.enterContext(patch.object(permissions, 'authenticate_request', return_value=self.account))
        self.enterContext(patch.object(views, 'authenticate_request', side_effect=lambda _: self.authenticate.return_value))
        self.enterContext(patch.object(permissions, 'coach_owns_learner', return_value=False))
        self.link = self.enterContext(patch('login.learner_enrolment.existing_learner_record', return_value=SimpleNamespace(pk=56)))
        self.audit = self.enterContext(patch('login.invitations.record'))

    def test_own_activity_allows_all_target_shapes_and_preserves_staff_identity(self):
        for shape in ('kwarg', 'query_param', 'body_field'):
            with self.subTest(shape=shape):
                seen = []

                def save(request, **kwargs):
                    seen.append(request.login_account)
                    return JsonResponse({'saved': True})

                wrapped = permissions.learner_self_or_admin(**{shape: 'learnerId'})(save)
                path = '/?learnerId=56' if shape == 'query_param' else '/'
                request = self.factory.post(path, data=json.dumps({'learnerId': 56}), content_type='application/json')
                self.assertEqual(wrapped(request, **({'learnerId': 56} if shape == 'kwarg' else {})).status_code, 200)
                self.assertIs(seen[0], self.account)
                self.assertEqual((self.account.role, self.account.subject_type, self.account.subject_id), ('staff', 'staff', 31))
                self.link.assert_called_with(self.account.email)
        self.audit.assert_not_called()

    def test_read_and_write_deny_other_learners_and_client_supplied_ownership(self):
        save = Mock(return_value=JsonResponse({'saved': True}))
        wrapped = permissions.learner_self_or_admin(kwarg='pk')(save)
        for method in ('get', 'post'):
            request = getattr(self.factory, method)('/', {'learnerRecordId': 19, 'email': self.account.email})
            self.assertEqual(wrapped(request, pk=19).status_code, 403)
        save.assert_not_called()

    def test_missing_and_unreadable_links_cannot_write(self):
        save = Mock()
        wrapped = permissions.learner_self_or_admin(kwarg='pk')(save)
        self.link.return_value = None
        self.assertEqual(wrapped(self.factory.post('/'), pk=56).status_code, 403)
        self.link.side_effect = DatabaseError('unavailable')
        self.assertEqual(wrapped(self.factory.post('/'), pk=56).status_code, 403)
        save.assert_not_called()

    def test_invalid_target_never_reaches_the_view(self):
        save = Mock()
        wrapped = permissions.learner_self_or_admin(body_field='learnerId')(save)
        for body in ('{}', 'null', '{', '{"learnerId":0}', '{"learnerId":-1}', '{"learnerId":"bad"}'):
            response = wrapped(self.factory.post('/', data=body, content_type='application/json'))
            self.assertEqual(response.status_code, 403)
        self.link.assert_not_called()
        save.assert_not_called()

    def test_unrelated_roles_and_anonymous_cannot_use_the_staff_link(self):
        save = Mock()
        wrapped = permissions.learner_self_or_admin(kwarg='pk')(save)
        for account, expected in ((staff(role='employer'), 403), (staff(role='learner'), 404), (None, 401)):
            self.authenticate.return_value = account
            self.assertEqual(wrapped(self.factory.post('/'), pk=56).status_code, expected)
        self.link.assert_not_called()
        save.assert_not_called()

    def test_access_endpoint_agrees_with_action_gate(self):
        for learner_id, expected in ((56, True), (19, False), (0, False), (-1, False)):
            response = views.learner_action_access(self.factory.get(f'/?learnerId={learner_id}'))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content), {'canAct': expected})
            self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_private_calendar_and_staff_booking_rules_stay_unchanged(self):
        save = Mock(return_value=JsonResponse({'saved': True}))
        private = permissions.learner_self_only(kwarg='pk')(save)
        for method in ('get', 'post'):
            self.assertEqual(private(getattr(self.factory, method)('/'), pk=56).status_code, 403)
        save.assert_not_called()
        booking = permissions.learner_self_or_staff(kwarg='pk')(save)
        self.assertEqual(booking(self.factory.post('/'), pk=19).status_code, 200)
        self.link.assert_not_called()

    def test_staff_can_start_tracking_only_their_own_activity(self):
        from learner_api.time_tracking import start_time_tracking
        for learner_id, expected in ((56, 200), (19, 403)):
            request = self.factory.post(f'/?kind=commercial&learnerId={learner_id}', data=json.dumps({
                'activityKind': 'component', 'activityId': 'reading-1', 'countingMode': 'visible_page',
            }), content_type='application/json')
            self.assertEqual(start_time_tracking(request).status_code, expected)

    def test_staff_can_submit_own_subject_attempt_for_both_learner_types(self):
        from learner_api import student_activity
        attempt_id = '00000000-0000-4000-8000-000000000001'
        with patch.object(student_activity, '_owned_material', return_value=(11, {})), \
             patch.object(student_activity.subject_store, 'finish', return_value={'completed': True}) as finish:
            for kind in ('commercial', 'apprenticeship'):
                request = self.factory.post('/', data=json.dumps({'reading_confirmed': True}), content_type='application/json')
                response = student_activity.submit_subject_attempt(request, kind=kind, pk=56,
                    group_id=2, activity_id=3, attempt_id=attempt_id)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(json.loads(response.content)['completed'])
                self.assertIs(request.login_account, self.account)
                self.assertEqual(finish.call_args.args[:4], (56, 11, 2, 3))

    def test_material_attempt_availability_requires_own_link_and_ready_storage(self):
        from learner_api import student_activity
        with patch.object(student_activity, 'authenticate_request', return_value=self.account), \
             patch.object(student_activity, 'coach_owns_learner', return_value=False), \
             patch.object(student_activity, '_definition_for', return_value={'quiz': None}), \
             patch.object(student_activity.subject_store, 'state') as state:
            for target, ready, expected in ((56, True, True), (19, True, False), (56, False, False)):
                state.return_value = {'ready': ready, 'history': []}
                response = student_activity._material_response(self.factory.get('/'), target, 11, {
                    'learner_name': 'Staff Learner', '_source': {'activity_id': 3},
                })
                self.assertEqual(json.loads(response.content)['can_attempt'], expected)
