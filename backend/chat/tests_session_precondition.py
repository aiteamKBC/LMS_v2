"""Deploy 1: ChatSessionView.post requires a valid platform session.

These tests isolate the new precondition. ``authenticate_request`` reads the
``kbc_session`` cookie against the ``login`` app's unmanaged Neon tables, which
do not exist in the SQLite test database, so it is patched at the view boundary
to stand in for "a platform session is / is not present". Everything downstream
of the precondition is the pre-existing demo-bootstrap behaviour, left
unchanged by Deploy 1.
"""
from unittest import mock

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from .models import ChatCoach


@override_settings(CHAT_DEMO_BOOTSTRAP_ENABLED=True)
class ChatSessionPreconditionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse("chat:chat-session")
        # The single demo coach identity DEMO_CHAT_IDENTITIES maps to. Present so
        # the "valid session" case can resolve an identity and succeed exactly as
        # it did before Deploy 1.
        ChatCoach.objects.create(
            id=201,
            name="Med Maher",
            email="Med.Maher@kentbusinesscollege.com",
            job_title="Progress Coach",
            access="coach",
        )

    def test_post_without_platform_session_is_rejected(self):
        with mock.patch("chat.views.authenticate_request", return_value=None):
            response = self.client.post(
                self.url, {"email": "coach@kbc.test"}, format="json"
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["detail"], "Authentication required.")

    def test_post_with_platform_session_succeeds_as_before(self):
        # A truthy account stands in for a resolved kbc_session. The value is
        # not read by the demo branch, only its presence gates entry.
        fake_account = mock.Mock()
        with mock.patch("chat.views.authenticate_request", return_value=fake_account):
            response = self.client.post(
                self.url, {"email": "coach@kbc.test"}, format="json"
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["authenticated"])
        self.assertEqual(response.data["participant_type"], "coach")
        self.assertEqual(response.data["email"], "Med.Maher@kentbusinesscollege.com")
