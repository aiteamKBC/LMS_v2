"""Case-owner edits and the coach picker must produce the same assignment."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from .active_users import sync_active_user
from .coach_assignment import case_owner_coach, current_coach
from .training_plan_dashboard import read_dashboard
from .views import enrolment_user_detail, learner_coach


def learner(**overrides):
    values = dict(pk=501, id=501, email='learner@example.com', aptem_id=None,
                  learner_type='commercial', programme_status='Active',
                  case_owner='Rewan Yasser', coach_name='Rewan Yasser',
                  coach_email='rewan@example.com', save=Mock())
    return SimpleNamespace(**{**values, **overrides})


def profile():
    # The enrolment id and profile id are deliberately different.
    return SimpleNamespace(pk=901, id=901, enrolment_id=501, lifecycle_status='active',
                           coach_name='Rewan Yasser', coach_email='rewan@example.com', save=Mock())


class CaseOwnerSaveTests(SimpleTestCase):
    def setUp(self):
        self.source = learner()
        self.profile = profile()
        self.enterContext(patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '0'}))
        model = self.enterContext(patch('learner_api.views.EnrolmentUser'))
        model.all_learners.filter.return_value.first.return_value = self.source
        self.enterContext(patch('learner_api.views.advance_learner'))
        self.enterContext(patch('learner_api.views.to_board', return_value={}))
        self.atomic = self.enterContext(patch('learner_api.learner_dates.transaction.atomic'))
        self.resolve = self.enterContext(patch('learner_api.learner_dates.learner_profile_for_source',
                                              return_value=self.profile))
        self.enterContext(patch('learner_api.views.learner_profile_for_source', return_value=self.profile))
        self.staff = self.enterContext(patch('learner_api.coach_assignment.StaffUser.objects.filter'))
        self.staff.return_value.only.return_value.__getitem__.return_value = [
            SimpleNamespace(email='curriculum@example.com')]

    def patch(self, view, payload):
        request = RequestFactory().patch('/learner_api/enrolment-users/501/',
                                         data=json.dumps(payload), content_type='application/json')
        return view(request, 501)

    def test_edit_form_updates_source_and_linked_profile_for_both_learner_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.source.learner_type = kind
                response = self.patch(enrolment_user_detail, {'caseOwner': 'Test curriculum'})
                self.assertEqual(response.status_code, 200)
                for record in (self.source, self.profile):
                    self.assertEqual(record.coach_name, 'Test curriculum')
                    self.assertEqual(record.coach_email, 'curriculum@example.com')
                self.assertEqual(self.source.case_owner, 'Test curriculum')
                self.assertEqual(set(self.source.save.call_args.kwargs['update_fields']),
                                 {'case_owner', 'coach_name', 'coach_email'})
                self.resolve.assert_called_with(self.source)

    def test_clearing_case_owner_removes_the_previous_coach_email(self):
        response = self.patch(enrolment_user_detail, {'caseOwner': ''})
        self.assertEqual(response.status_code, 200)
        for record in (self.source, self.profile):
            self.assertEqual((record.coach_name, record.coach_email), ('', ''))
        self.staff.assert_not_called()

    def test_assignment_before_activation_is_retained_on_source(self):
        self.resolve.return_value = None
        response = self.patch(enrolment_user_detail, {'caseOwner': 'Test curriculum'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.source.coach_email, 'curriculum@example.com')
        self.profile.save.assert_not_called()

    def test_profile_failure_rolls_back_the_source_write_and_reports_failure(self):
        failure = DatabaseError('profile write failed')
        self.profile.save.side_effect = failure
        response = self.patch(enrolment_user_detail, {'caseOwner': 'Test curriculum'})
        self.assertEqual(response.status_code, 502)
        self.assertIs(self.atomic.return_value.__exit__.call_args.args[1], failure)

    def test_coach_picker_also_updates_the_edit_forms_case_owner(self):
        response = self.patch(learner_coach, {'coachName': 'Test curriculum',
                                             'coachEmail': 'curriculum@example.com'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.source.case_owner, 'Test curriculum')
        self.assertEqual(self.source.coach_email, 'curriculum@example.com')
        self.assertEqual(self.profile.coach_email, 'curriculum@example.com')
        self.assertEqual(json.loads(response.content), {'coachName': 'Test curriculum',
                                                        'coachEmail': 'curriculum@example.com'})

    def test_name_only_picker_change_resolves_new_email(self):
        response = self.patch(learner_coach, {'coachName': 'Test curriculum'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.profile.coach_email, 'curriculum@example.com')

    def test_coach_read_prefers_case_owner_over_stale_profile(self):
        self.source.case_owner = 'Test curriculum'
        self.source.coach_name = None
        self.source.coach_email = None
        response = learner_coach(RequestFactory().get('/learner_api/learners/501/coach/'), 501)
        self.assertEqual(json.loads(response.content), {'coachName': 'Test curriculum',
                                                        'coachEmail': 'curriculum@example.com'})
        self.source.save.assert_not_called()

    def test_email_only_picker_change_resolves_name_and_case_owner(self):
        with patch('learner_api.views.StaffUser.objects.filter') as query:
            query.return_value.only.return_value.__getitem__.return_value = [
                SimpleNamespace(username='Test curriculum')]
            response = self.patch(learner_coach, {'coachEmail': 'curriculum@example.com'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.source.case_owner, 'Test curriculum')
        self.assertEqual(self.profile.coach_name, 'Test curriculum')

    def test_learner_cannot_change_own_coach(self):
        request = RequestFactory().patch('/learner_api/learners/501/coach/',
                                         data=json.dumps({'coachName': 'Test curriculum'}),
                                         content_type='application/json')
        request.login_account = SimpleNamespace(role='learner')
        response = learner_coach(request, 501)
        self.assertEqual(response.status_code, 403)
        self.source.save.assert_not_called()
        self.profile.save.assert_not_called()


class CoachResolutionTests(SimpleTestCase):
    def test_missing_or_duplicate_staff_names_never_reuse_old_coach_email(self):
        for staff in ([], [SimpleNamespace(email='a@example.com'), SimpleNamespace(email='b@example.com')]):
            with self.subTest(staff=staff), patch('learner_api.coach_assignment.StaffUser.objects.filter') as query:
                query.return_value.only.return_value.__getitem__.return_value = staff
                self.assertEqual(case_owner_coach('New owner', learner()),
                                 {'coach_name': 'New owner', 'coach_email': ''})

    def test_explicit_email_preserves_identity_for_duplicate_names(self):
        with patch('learner_api.coach_assignment.StaffUser.objects.filter') as query:
            self.assertEqual(case_owner_coach(' Rewan Yasser ', learner()),
                             {'coach_name': 'Rewan Yasser', 'coach_email': 'rewan@example.com'})
        query.assert_not_called()

    def test_legacy_profile_contact_does_not_borrow_historical_email(self):
        source = learner(case_owner=None, coach_name=None, coach_email=None)
        active = profile()
        active.coach_email = ''
        self.assertEqual(current_coach(source, active, {'coach_email': 'old@example.com'}),
                         {'coach_name': 'Rewan Yasser', 'coach_email': ''})

    def test_activation_copies_assignment_and_explicit_clear(self):
        for name, email in [('Test curriculum', 'curriculum@example.com'), ('', '')]:
            with self.subTest(name=name):
                source = learner(case_owner=name, coach_name=name, coach_email=email)
                with patch('learner_api.apprenticeship_agreement._group_dates', return_value=(None, None, None)), \
                        patch('learner_api.active_users.get_training_plan', return_value=[]), \
                        patch('learner_api.active_users.transaction.atomic'), \
                        patch('learner_api.active_users.learner_profile_for_source', return_value=None), \
                        patch('learner_api.active_users.hydrate_source_training_plan', return_value=[]), \
                        patch('learner_api.active_users._resolve_linkable_programme_id', return_value=None), \
                        patch('learner_api.active_users._linkable_placement_ids', return_value=(None, None)), \
                        patch('learner_api.active_users.LearnerProfile.objects.create') as create, \
                        patch('learner_api.active_users.replace_training_plan'), \
                        patch('learner_api.active_users.refresh_learner_ksb_snapshot'):
                    sync_active_user(source)
                self.assertEqual(create.call_args.kwargs['coach_name'], name)
                self.assertEqual(create.call_args.kwargs['coach_email'], email)

    def test_dashboard_prefers_saved_assignment_and_respects_unassignment(self):
        for name, email in [('Test curriculum', 'curriculum@example.com'), ('', '')]:
            with self.subTest(name=name):
                source = learner(case_owner=name, coach_name=name, coach_email=email)
                connection = MagicMock()
                connection.cursor.return_value.__enter__.return_value.fetchall.return_value = []
                with patch('learner_api.training_plan_dashboard.connections', {'enrolment': connection}), \
                        patch('learner_api.training_plan_dashboard.LearnerProfile') as profiles, \
                        patch('learner_api.training_plan_dashboard._builder_subject_metadata', return_value=({}, {})), \
                        patch('learner_api.training_plan_dashboard.assigned_group_coach', return_value='Group coach'), \
                        patch('learner_api.calendar.coaching_events_for_learner', return_value=[]), \
                        patch('learner_api.training_plan_dashboard.booking_url', side_effect=lambda value: value or None):
                    profiles.objects.filter.return_value.first.return_value = profile()
                    result = read_dashboard(source, section='overview')
                self.assertEqual(result['coach'], {'name': name, 'bookingUrl': email or None})
