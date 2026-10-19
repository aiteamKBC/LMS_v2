"""A coach can act for the learners on their own caseload, like an administrator."""
import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from . import permissions, views

COACH = SimpleNamespace(id=7, role='staff', subject_type='staff', subject_id=31,
                        email='coach@example.test', display_name='A Coach')


class CoachLearnerActionTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}))
        self.authenticate = self.enterContext(patch.object(permissions, 'authenticate_request', return_value=COACH))
        self.owns = self.enterContext(patch.object(permissions, 'coach_owns_learner', return_value=True))
        self.enterContext(patch('login.learner_enrolment.existing_learner_record', return_value=None))
        self.audit = self.enterContext(patch('login.invitations.record'))

    def test_own_coach_writes_as_themselves_and_is_audited_as_a_coach(self):
        seen = []

        def save(request, **kwargs):
            seen.append(request.login_account)
            return JsonResponse({'saved': True})

        wrapped = permissions.learner_self_or_admin(kwarg='pk')(save)
        response = wrapped(self.factory.post('/learner_api/example/'), pk=56)
        self.assertEqual(response.status_code, 200)
        self.assertIs(seen[0], COACH)
        self.assertEqual((COACH.role, COACH.subject_id), ('staff', 31))
        self.owns.assert_called_once_with(COACH, 56)
        event = self.audit.call_args
        self.assertEqual(event.args, ('coach_learner_action',))
        self.assertEqual(event.kwargs['account_id'], 7)
        self.assertEqual(event.kwargs['email'], 'coach@example.test')
        self.assertEqual(json.loads(event.kwargs['reason'])['learnerId'], 56)

    def test_own_coach_reads_without_a_write_audit_record(self):
        wrapped = permissions.learner_self_or_admin(kwarg='pk')(lambda request, **kwargs: JsonResponse({'ready': True}))
        self.assertEqual(wrapped(self.factory.get('/'), pk=56).status_code, 200)
        self.audit.assert_not_called()

    def test_another_coachs_learner_stays_read_only(self):
        self.owns.return_value = False
        save = Mock(return_value=JsonResponse({'saved': True}))
        wrapped = permissions.learner_self_or_admin(kwarg='pk')(save)
        for method in ('get', 'post'):
            response = wrapped(getattr(self.factory, method)('/'), pk=56)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(json.loads(response.content)['code'], 'read_only_learner_view')
        save.assert_not_called()
        self.audit.assert_not_called()

    def test_learner_only_and_staff_preview_gates_are_unchanged(self):
        save = Mock(return_value=JsonResponse({'saved': True}))
        self.assertEqual(permissions.learner_self_only(kwarg='pk')(save)(self.factory.post('/'), pk=56).status_code, 403)
        save.assert_not_called()
        self.owns.assert_not_called()

    def test_monthly_report_is_signed_in_the_coachs_name(self):
        from learner_api import monthly_reports as reports
        request = self.factory.post('/', data=json.dumps({
            'monthKey': '2026-08', 'learnedSummary': 'Reviewed this month.',
            'signature': 'data:image/png;base64,coach', 'signedName': 'Learner', 'saveSignature': True,
        }), content_type='application/json')
        with patch.object(reports, 'connections') as connections, \
             patch.object(reports.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(reports, '_row_to_report', return_value={'saved': True}):
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            response = reports.monthly_reports(request, kind='commercial', pk=56)
        self.assertEqual(response.status_code, 201)
        # Only the report is written, never the learner's reusable signature.
        cursor.execute.assert_called_once()
        self.assertEqual(cursor.execute.call_args.args[1][-1], 'A Coach')
        self.assertEqual(self.audit.call_args.args, ('coach_learner_action',))


class CoachOwnsLearnerTests(SimpleTestCase):
    def owns(self, staff, profile_exists=True, account=COACH, learner_id=56):
        with patch('learner_api.models.StaffUser.objects') as staff_rows, \
             patch('learner_api.models.LearnerProfile.objects') as profiles:
            staff_rows.filter.return_value.only.return_value.first.return_value = staff
            profiles.annotate.return_value.filter.return_value.exists.return_value = profile_exists
            return permissions.coach_owns_learner(account, learner_id), profiles

    def test_matches_the_caseload_rule_on_the_coachs_normalised_email(self):
        staff = SimpleNamespace(email=' Coach@Example.TEST ', access='coach', access_extra='')
        owned, profiles = self.owns(staff)
        self.assertTrue(owned)
        profiles.annotate.return_value.filter.assert_called_once_with(coach_email_key='coach@example.test', enrolment_id=56)

    def test_refuses_everything_that_is_not_the_learners_own_coach(self):
        coach = SimpleNamespace(email='coach@example.test', access='coach', access_extra='')
        cases = {
            'not on caseload': dict(staff=coach, profile_exists=False),
            'tutor access only': dict(staff=SimpleNamespace(email='t@example.test', access='tutor', access_extra='')),
            'no staff row': dict(staff=None),
            'no email': dict(staff=SimpleNamespace(email='', access='coach', access_extra='')),
            'admin role': dict(staff=coach, account=SimpleNamespace(**{**vars(COACH), 'role': 'admin'})),
            'learner account': dict(staff=coach, account=SimpleNamespace(**{**vars(COACH), 'role': 'learner'})),
            'bad learner id': dict(staff=coach, learner_id=0),
        }
        for name, case in cases.items():
            with self.subTest(name):
                self.assertFalse(self.owns(**case)[0])

    def test_an_unreadable_caseload_fails_closed(self):
        with patch('learner_api.models.StaffUser.objects') as staff_rows:
            staff_rows.filter.side_effect = DatabaseError('offline')
            self.assertFalse(permissions.coach_owns_learner(COACH, 56))


class LearnerActionAccessEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.authenticate = self.enterContext(patch.object(views, 'authenticate_request'))
        self.owns = self.enterContext(patch.object(permissions, 'coach_owns_learner', return_value=False))
        self.enterContext(patch('login.learner_enrolment.existing_learner_record', return_value=None))

    def answer(self, account, query='?learnerId=56'):
        self.authenticate.return_value = account
        return views.learner_action_access(self.factory.get(f'/login_api/learner-action-access/{query}'))

    def test_answers_the_same_rule_the_write_gate_enforces(self):
        learner = SimpleNamespace(role='learner', subject_id=56)
        cases = [
            (SimpleNamespace(role='admin'), False, True),
            (learner, False, True),
            (SimpleNamespace(role='learner', subject_id=57), False, False),
            (COACH, True, True),
            (COACH, False, False),
            (SimpleNamespace(role='employer'), False, False),
        ]
        for account, owns, expected in cases:
            with self.subTest(role=account.role, owns=owns):
                self.owns.return_value = owns
                response = self.answer(account)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content), {'canAct': expected})
                self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_requires_a_session_and_a_learner_id(self):
        self.assertEqual(self.answer(None).status_code, 401)
        self.assertEqual(self.answer(COACH, '').status_code, 400)
        self.assertEqual(self.answer(COACH, '?learnerId=abc').status_code, 400)
