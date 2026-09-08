"""Correcting somebody's email has to reach the account it signs in with.

The address lives twice: on the person's own record, and on the login account
that an invitation is sent to. ``login.identity.ensure_account`` refreshes the
copy, but only ran when an account was created or when its owner signed in — and
an invited learner has not signed in yet. So a corrected email kept re-sending
the invitation to the old address, which is what a colleague reported.
"""
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import views


def _learner(**kwargs):
    fields = {
        'pk': 124,
        'id': 124,
        'email': 'old@example.com',
        'username': 'Khaled',
        'learner_type': 'commercial',
        'programme_status': 'Delivery',
        'programme': '',
        'cohort': '',
        'group': '',
        'learning_plan': None,
        'training_plan': None,
        'start_date': None,
        'save': Mock(),
    }
    fields.update(kwargs)
    return SimpleNamespace(**fields)


class LearnerEditSyncsAccountTests(SimpleTestCase):
    def _patch(self, body, learner=None):
        learner = learner or _learner()
        request = RequestFactory().patch(
            '/learner_api/enrolment-users/124/',
            data=json.dumps(body),
            content_type='application/json',
        )
        # The console's own API is staff-gated; these assert what the view does
        # once past that gate, which the documented switch turns off.
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '0'}),                 patch('learner_api.views.EnrolmentUser') as model, \
                patch('learner_api.views.sync_account') as sync, \
                patch('learner_api.views.mirror_learner_placement'), \
                patch('learner_api.views.stamp_cohort_window'), \
                patch('learner_api.views.advance_learner'), \
                patch('learner_api.views.to_board', return_value={}):
            model.all_learners.filter.return_value.first.return_value = learner
            response = views.enrolment_user_detail(request, 124)
        return response, sync, learner

    def test_a_corrected_email_is_pushed_to_the_login_account(self):
        response, sync, learner = self._patch({'email': 'new@example.com'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(learner.email, 'new@example.com')
        sync.assert_called_once_with('learner', 124, subject=learner)

    def test_a_renamed_learner_is_pushed_too(self):
        # The account carries the display name the invitation is addressed to.
        _response, sync, learner = self._patch({'username': 'Khaled Fouda'})

        sync.assert_called_once_with('learner', 124, subject=learner)

    def test_an_edit_that_touches_no_identity_field_does_not_sync(self):
        _response, sync, _learner_row = self._patch({'phone': '0700 000 000'})

        sync.assert_not_called()


class StaffEditSyncsAccountTests(SimpleTestCase):
    def _patch(self, body):
        staff = SimpleNamespace(
            pk=7, id=7, email='old.staff@example.com', username='Staff',
            preferred_name='', position='Coach', access='', save=Mock(),
        )
        request = RequestFactory().patch(
            '/learner_api/staff-users/7/',
            data=json.dumps(body),
            content_type='application/json',
        )
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '0'}),                 patch('learner_api.views.StaffUser') as model, \
                patch('learner_api.views.sync_account') as sync, \
                patch('learner_api.views.to_staff_row', return_value={}):
            model.objects.get.return_value = staff
            response = views.staff_user_detail(request, 7)
        return response, sync, staff

    def test_a_corrected_staff_email_reaches_their_account(self):
        response, sync, staff = self._patch({'email': 'new.staff@example.com'})

        self.assertEqual(response.status_code, 200)
        sync.assert_called_once_with('staff', 7, subject=staff)

    def test_a_changed_position_reaches_it_as_well(self):
        # A staff account's role is derived from position and access, and the
        # account is what enforces the role.
        _response, sync, staff = self._patch({'position': 'Tutor'})

        sync.assert_called_once_with('staff', 7, subject=staff)

    def test_an_unrelated_staff_edit_does_not_sync(self):
        _response, sync, _staff = self._patch({'phone': '0700 000 000'})

        sync.assert_not_called()
