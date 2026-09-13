"""Account deletion coverage using mocks only; no database writes."""
import json
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.db.models import Q
from django.test import RequestFactory, SimpleTestCase

from .account_deletion import _profiles_for_deletion, delete_learner_account
from .mappers import ValidationError
from .views import enrolment_user_detail


class AccountDeletionTests(SimpleTestCase):
    def test_deletes_all_three_identities_in_one_transaction(self):
        user = SimpleNamespace(pk=132, delete=Mock())
        profile = SimpleNamespace(pk=901, delete=Mock())
        account = SimpleNamespace(pk=407, delete=Mock())
        with ExitStack() as stack:
            atomic = stack.enter_context(patch("learner_api.account_deletion.transaction.atomic"))
            source = stack.enter_context(patch("learner_api.account_deletion.EnrolmentUser"))
            login = stack.enter_context(patch("learner_api.account_deletion.LoginAccount"))
            resolve = stack.enter_context(patch("learner_api.account_deletion._profiles_for_deletion", return_value=[profile]))
            children = [stack.enter_context(patch(f"learner_api.account_deletion.{name}"))
                        for name in ("LoginSession", "Invitation", "PasswordReset", "LoginAudit")]
            source.all_learners.using.return_value.select_for_update.return_value.get.return_value = user
            login.objects.using.return_value.select_for_update.return_value.filter.return_value = [account]
            delete_learner_account(132)
            atomic.assert_called_once_with(using="enrolment")
            source.all_learners.using.return_value.select_for_update.return_value.get.assert_called_once_with(pk=132)
            resolve.assert_called_once_with(user)
            login.objects.using.return_value.select_for_update.return_value.filter.assert_called_once_with(subject_type="learner", subject_id=132)
            for model in children:
                model.objects.using.assert_called_once_with("enrolment")
                model.objects.using.return_value.filter.assert_called_once_with(account_id=407)
                model.objects.using.return_value.filter.return_value.delete.assert_called_once_with()
            account.delete.assert_called_once_with(using="enrolment")
            profile.delete.assert_called_once_with(using="enrolment")
            user.delete.assert_called_once_with(using="enrolment")

    def test_missing_login_and_profile_still_deletes_enrolment(self):
        with patch("learner_api.account_deletion.transaction.atomic"), \
                patch("learner_api.account_deletion.EnrolmentUser") as source, \
                patch("learner_api.account_deletion.LoginAccount") as login, \
                patch("learner_api.account_deletion._profiles_for_deletion", return_value=[]):
            login.objects.using.return_value.select_for_update.return_value.filter.return_value = []
            delete_learner_account(132)
            source.all_learners.using.return_value.select_for_update.return_value.get.return_value.delete.assert_called_once_with(using="enrolment")

    def test_failure_reaches_transaction_boundary_and_stops_deletion(self):
        failure = DatabaseError("blocked dependency")
        profile = Mock()
        profile.delete.side_effect = failure
        with patch("learner_api.account_deletion.transaction.atomic") as atomic, \
                patch("learner_api.account_deletion.EnrolmentUser") as source, \
                patch("learner_api.account_deletion.LoginAccount") as login, \
                patch("learner_api.account_deletion._profiles_for_deletion", return_value=[profile]):
            login.objects.using.return_value.select_for_update.return_value.filter.return_value = []
            with self.assertRaises(DatabaseError):
                delete_learner_account(132)
            self.assertIs(atomic.return_value.__exit__.call_args.args[1], failure)
            source.all_learners.using.return_value.select_for_update.return_value.get.return_value.delete.assert_not_called()

    def test_profile_lookup_uses_enrolment_link_and_uuid_never_matching_primary_key(self):
        user = SimpleNamespace(pk=132, uuid="stable-uuid", email="")
        with patch("learner_api.account_deletion.LearnerProfile") as model:
            query = model.objects.using.return_value.select_for_update.return_value
            query.filter.return_value = [SimpleNamespace(pk=901)]
            self.assertEqual(_profiles_for_deletion(user)[0].pk, 901)
            query.filter.assert_called_once_with(Q(enrolment_id=132) | Q(enrolment_id__isnull=True, uuid="stable-uuid"))

    def test_ambiguous_legacy_email_blocks_deletion(self):
        user = SimpleNamespace(pk=132, uuid=None, email="shared@example.com")
        with patch("learner_api.account_deletion.LearnerProfile") as profile, \
                patch("learner_api.account_deletion.EnrolmentUser") as source:
            query = profile.objects.using.return_value.select_for_update.return_value
            query.filter.return_value.__iter__.return_value = iter([])
            query.filter.return_value.exclude.return_value = [SimpleNamespace(pk=901)]
            source.all_learners.using.return_value.filter.return_value.exclude.return_value.exists.return_value = True
            with self.assertRaises(ValidationError):
                _profiles_for_deletion(user)
            self.assertIn({'enrolment_id__isnull': True, 'email__iexact': 'shared@example.com'},
                          [call.kwargs for call in query.filter.call_args_list])


class AccountDeletionEndpointTests(SimpleTestCase):
    def request_delete(self, *, self_write=False, failure=None):
        request = RequestFactory().delete('/learner_api/enrolment-users/132/')
        actor = SimpleNamespace(role='learner' if self_write else 'staff', subject_id=132)
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}), \
                patch('login.permissions.authenticate_request', return_value=actor), \
                patch('learner_api.views.EnrolmentUser.all_learners') as users, \
                patch('learner_api.views.delete_learner_account', side_effect=failure) as delete:
            users.filter.return_value.first.return_value = SimpleNamespace(pk=132)
            response = enrolment_user_detail(request, pk=132)
        return response, delete

    def test_staff_delete_uses_shared_service(self):
        response, delete = self.request_delete()
        self.assertEqual(json.loads(response.content), {'deleted': True, 'id': 132})
        delete.assert_called_once_with(132)

    def test_learner_cannot_delete_account(self):
        response, delete = self.request_delete(self_write=True)
        self.assertEqual(response.status_code, 403)
        delete.assert_not_called()

    def test_failure_is_not_reported_as_success(self):
        response, _ = self.request_delete(failure=DatabaseError('blocked dependency'))
        self.assertEqual(response.status_code, 502)
        self.assertIn('Could not delete user account', json.loads(response.content)['error'])
