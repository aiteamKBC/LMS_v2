"""Archive regression tests: mocked persistence and sessions, no database/network."""
import json
from contextlib import ExitStack
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from . import user_archive
from .mappers import ValidationError
from .models import EnrolmentUser


class UserArchiveTests(SimpleTestCase):
    def change(self, user, archived):
        with patch.object(user_archive.transaction, "atomic") as atomic, \
                patch.object(EnrolmentUser.all_learners, "using") as using:
            using.return_value.select_for_update.return_value.get.return_value = user
            result = user_archive.set_archived(user.pk, archived=archived)
            atomic.assert_called_once_with(using="enrolment")
            using.assert_called_once_with("enrolment")
            using.return_value.select_for_update.return_value.get.assert_called_once_with(pk=user.pk)
        return result

    def test_roundtrip_preserves_status_and_unrelated_details_for_both_learner_types(self):
        for kind in ("commercial", "apprenticeship"):
            for status in ("FullUser", "Invited", "Prospect", "Cancelled", "Expired", None, ""):
                with self.subTest(kind=kind, status=status):
                    details = {"startDate": "2026-01-01", "other": {"retained": [1, 2]}}
                    original = deepcopy(details)
                    user = SimpleNamespace(pk=17, status=status, subscription_details=details,
                                           learner_type=kind, programme_status="Active", save=Mock())
                    self.assertEqual(self.change(user, True), "Archived")
                    self.assertEqual(details, original)
                    self.assertEqual(user.subscription_details[user_archive.ARCHIVE_KEY]["previousStatus"], status)
                    self.assertEqual(self.change(user, False), status)
                    self.assertEqual(user.subscription_details, original)
                    self.assertEqual(user.programme_status, "Active")
                    self.assertEqual(user.save.call_count, 2)
                    user.save.assert_called_with(using="enrolment", update_fields=["status", "subscription_details"])

    def test_repeated_archive_keeps_original_status_and_repeated_restore_is_noop(self):
        user = SimpleNamespace(pk=17, status="Invited", subscription_details=None, save=Mock())
        self.change(user, True)
        snapshot = deepcopy(user.subscription_details)
        self.change(user, True)
        self.assertEqual(user.subscription_details, snapshot)
        self.assertEqual(user.save.call_count, 1)
        self.change(user, False)
        self.change(user, False)
        self.assertEqual(user.status, "Invited")
        self.assertIsNone(user.subscription_details)
        self.assertEqual(user.save.call_count, 2)

    def test_legacy_archived_record_can_be_restored(self):
        user = SimpleNamespace(pk=17, status=" archived ", subscription_details=None, save=Mock())
        self.assertEqual(self.change(user, False), "FullUser")
        self.assertIsNone(user.subscription_details)

    def test_unexpected_subscription_payload_is_not_overwritten(self):
        user = SimpleNamespace(pk=17, status="FullUser", subscription_details=["legacy"], save=Mock())
        with self.assertRaises(ValidationError):
            self.change(user, True)
        user.save.assert_not_called()
        self.assertEqual(user.status, "FullUser")


class UserArchiveEndpointTests(SimpleTestCase):
    def test_archive_and_restore_urls_resolve_to_the_authenticated_views(self):
        for action, view in (("archive", user_archive.archive_user), ("restore", user_archive.restore_user)):
            match = resolve(f"/learner_api/enrolment-users/101/{action}/")
            self.assertIs(match.func, view)
            self.assertEqual(match.kwargs, {"pk": 101})

    def request(self, view, *, role="staff", method="post", failure=None):
        request = getattr(RequestFactory(), method)("/learner_api/enrolment-users/17/archive/")
        actor = SimpleNamespace(role=role, subject_id=17) if role else None
        with ExitStack() as stack:
            stack.enter_context(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))
            stack.enter_context(patch("login.permissions.authenticate_request", return_value=actor))
            change = stack.enter_context(patch.object(user_archive, "set_archived", return_value="Invited", side_effect=failure))
            response = view(request, pk=17)
        return response, change

    def test_staff_and_admin_can_archive_and_restore(self):
        for role in ("staff", "admin"):
            for view, archived in ((user_archive.archive_user, True), (user_archive.restore_user, False)):
                with self.subTest(role=role, archived=archived):
                    response, change = self.request(view, role=role)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(json.loads(response.content)["archived"], archived)
                    change.assert_called_once_with(17, archived=archived)

    def test_other_roles_and_unauthenticated_callers_cannot_write_even_own_record(self):
        for role in ("learner", "employer", "coach", "tutor", None):
            for view in (user_archive.archive_user, user_archive.restore_user):
                with self.subTest(role=role, view=view):
                    response, change = self.request(view, role=role)
                    self.assertIn(response.status_code, (401, 403))
                    change.assert_not_called()

    def test_get_cannot_mutate(self):
        for view in (user_archive.archive_user, user_archive.restore_user):
            response, change = self.request(view, method="get")
            self.assertEqual(response.status_code, 405)
            change.assert_not_called()

    def test_errors_are_not_reported_as_success(self):
        for failure, status in ((EnrolmentUser.DoesNotExist(), 404),
                                (ValidationError("Check details"), 400),
                                (DatabaseError("private database info"), 502)):
            for view in (user_archive.archive_user, user_archive.restore_user):
                with self.subTest(failure=failure, view=view):
                    response, _ = self.request(view, failure=failure)
                    self.assertEqual(response.status_code, status)
                    self.assertNotIn("private database info", response.content.decode())
