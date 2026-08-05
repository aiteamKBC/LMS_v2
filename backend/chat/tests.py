from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from .consumers import ChatConsumer
from .models import ChatCoach, ChatLearner, Conversation, Message, MessageReceipt
from .routing import websocket_urlpatterns
from .services import create_message


User = get_user_model()


class ChatTestMixin:
    """Create external chat identities and authenticated Django users."""

    def create_users(self):
        self.coach_identity = ChatCoach.objects.create(
            id="coach-test-1",
            name="Casey Coach",
            email="coach@example.com",
            job_title="Progress Coach",
        )
        self.learner_identity = ChatLearner.objects.create(
            id=1,
            full_name="Leslie Learner",
            email="learner@example.com",
        )

        # Authentication users are deliberately separate from the external
        # identities, matching the production email-based identity bridge.
        self.coach_user = User.objects.create_user(
            username="coach",
            email="coach@example.com",
            password="password123",
        )
        self.learner_user = User.objects.create_user(
            username="learner",
            email="learner@example.com",
            password="password123",
        )
        self.outsider = User.objects.create_user(
            username="outsider",
            email="outsider@example.com",
            password="password123",
        )
        self.conversation = Conversation.objects.create(
            coach=self.coach_identity,
            learner=self.learner_identity,
        )


class ChatModelTests(ChatTestMixin, TestCase):
    def setUp(self):
        self.create_users()

    def test_conversation_rejects_self_pair(self):
        self_pair = Conversation(
            coach=ChatCoach(
                id="1",
                name="Same Person",
                email="same@example.com",
                job_title="Coach",
            ),
            learner=self.learner_identity,
        )
        with self.assertRaises(ValidationError):
            self_pair.full_clean()

    def test_message_service_creates_unread_receipt(self):
        message = create_message(self.conversation, self.coach_user, " Hello ")

        self.assertEqual(message.body, "Hello")
        receipt = MessageReceipt.objects.get(
            message=message,
            recipient_type="learner",
            recipient_learner=self.learner_identity,
        )
        self.assertIsNone(receipt.read_at)
        self.conversation.refresh_from_db()
        self.assertGreaterEqual(self.conversation.updated_at, message.created_at)


class ChatAPITests(ChatTestMixin, TestCase):
    def setUp(self):
        self.create_users()
        self.client = APIClient()

    def test_conversation_list_returns_latest_message_and_unread_count(self):
        message = create_message(self.conversation, self.coach_user, "Latest message")
        self.client.force_authenticate(self.learner_user)

        response = self.client.get(reverse("chat:conversation-list"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["id"], self.conversation.pk)
        self.assertEqual(response.data[0]["participant"]["name"], "Casey Coach")
        self.assertEqual(response.data[0]["latest_message"]["id"], message.pk)
        self.assertEqual(response.data[0]["latest_message"]["body"], "Latest message")
        self.assertEqual(response.data[0]["unread_count"], 1)

    def test_messages_are_paginated_and_ordered(self):
        create_message(self.conversation, self.coach_user, "First")
        create_message(self.conversation, self.learner_user, "Second")
        self.client.force_authenticate(self.coach_user)

        response = self.client.get(
            reverse(
                "chat:conversation-messages",
                kwargs={"conversation_id": self.conversation.pk},
            )
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["body"] for item in response.data["results"]],
            ["First", "Second"],
        )
        self.assertEqual(response.data["count"], 2)

    def test_post_message_persists_and_returns_created_message(self):
        self.client.force_authenticate(self.coach_user)

        response = self.client.post(
            reverse(
                "chat:conversation-messages",
                kwargs={"conversation_id": self.conversation.pk},
            ),
            {"body": "Hello from REST"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["body"], "Hello from REST")
        self.assertTrue(Message.objects.filter(body="Hello from REST").exists())
        self.assertTrue(
            MessageReceipt.objects.filter(
                recipient_type="learner",
                recipient_learner=self.learner_identity,
                read_at__isnull=True,
            ).exists()
        )

    def test_same_email_coach_rows_keep_learner_conversations_isolated(self):
        duplicate_coach = ChatCoach.objects.create(
            id="coach-test-duplicate",
            name="Casey Coach",
            email="COACH@example.com",
            job_title="Progress Coach",
        )
        second_learner = ChatLearner.objects.create(
            id=2,
            full_name="Morgan Learner",
            email="morgan@example.com",
        )
        second_learner_user = User.objects.create_user(
            username="morgan",
            email="morgan@example.com",
            password="password123",
        )
        second_conversation = Conversation.objects.create(
            coach=duplicate_coach,
            learner=second_learner,
        )

        # The coach is resolved by normalized email, while the exact
        # conversation chooses the legacy coach row written to the message.
        message = create_message(second_conversation, self.coach_user, "For Morgan only")
        self.assertEqual(message.sender_coach_id, duplicate_coach.pk)
        self.assertTrue(
            MessageReceipt.objects.filter(
                message=message,
                recipient_type="learner",
                recipient_learner=second_learner,
            ).exists()
        )

        self.client.force_authenticate(self.coach_user)
        coach_response = self.client.get(reverse("chat:conversation-list"))
        self.assertEqual(
            {item["id"] for item in coach_response.data},
            {self.conversation.pk, second_conversation.pk},
        )

        self.client.force_authenticate(self.learner_user)
        denied_response = self.client.get(
            reverse(
                "chat:conversation-messages",
                kwargs={"conversation_id": second_conversation.pk},
            )
        )
        self.assertEqual(denied_response.status_code, 404)

        self.client.force_authenticate(second_learner_user)
        allowed_response = self.client.get(
            reverse(
                "chat:conversation-messages",
                kwargs={"conversation_id": second_conversation.pk},
            )
        )
        self.assertEqual(allowed_response.status_code, 200)
        self.assertEqual(
            [item["body"] for item in allowed_response.data["results"]],
            ["For Morgan only"],
        )

    def test_invalid_message_bodies_are_rejected(self):
        self.client.force_authenticate(self.coach_user)
        url = reverse(
            "chat:conversation-messages",
            kwargs={"conversation_id": self.conversation.pk},
        )

        empty_response = self.client.post(url, {"body": "   "}, format="json")
        long_response = self.client.post(url, {"body": "x" * 5001}, format="json")

        self.assertEqual(empty_response.status_code, 400)
        self.assertEqual(long_response.status_code, 400)
        self.assertEqual(Message.objects.count(), 0)

    def test_unauthorized_user_cannot_access_by_changing_id(self):
        self.client.force_authenticate(self.outsider)
        messages_url = reverse(
            "chat:conversation-messages",
            kwargs={"conversation_id": self.conversation.pk},
        )

        response = self.client.get(messages_url)
        post_response = self.client.post(messages_url, {"body": "intrusion"}, format="json")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(post_response.status_code, 404)

    def test_only_recipient_can_mark_message_read(self):
        message = create_message(self.conversation, self.coach_user, "Read me")
        read_url = reverse("chat:message-read", kwargs={"message_id": message.pk})

        self.client.force_authenticate(self.coach_user)
        sender_response = self.client.post(read_url)
        self.assertEqual(sender_response.status_code, 400)

        self.client.force_authenticate(self.learner_user)
        recipient_response = self.client.post(read_url)
        self.assertEqual(recipient_response.status_code, 200)
        self.assertIsNotNone(
            MessageReceipt.objects.get(
                message=message,
                recipient_type="learner",
                recipient_learner=self.learner_identity,
            ).read_at
        )

    def test_unauthorized_user_cannot_mark_message_read(self):
        message = create_message(self.conversation, self.coach_user, "Private")
        self.client.force_authenticate(self.outsider)

        response = self.client.post(
            reverse("chat:message-read", kwargs={"message_id": message.pk})
        )

        self.assertEqual(response.status_code, 404)


class UserScopeMiddleware:
    """Inject a known authenticated user for consumer unit tests."""

    def __init__(self, application, user):
        self.application = application
        self.user = user

    async def __call__(self, scope, receive, send):
        return await self.application({**scope, "user": self.user}, receive, send)


@override_settings(
    CHANNEL_LAYERS={
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }
)
class ChatWebSocketTests(ChatTestMixin, TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.create_users()
        self.application = UserScopeMiddleware(
            URLRouter(websocket_urlpatterns), self.coach_user
        )

    async def test_authenticated_participants_receive_new_message(self):
        coach_socket = WebsocketCommunicator(
            self.application,
            f"/ws/chat/{self.conversation.pk}/",
        )
        learner_socket = WebsocketCommunicator(
            UserScopeMiddleware(URLRouter(websocket_urlpatterns), self.learner_user),
            f"/ws/chat/{self.conversation.pk}/",
        )

        coach_connected, _ = await coach_socket.connect()
        learner_connected, _ = await learner_socket.connect()
        self.assertTrue(coach_connected)
        self.assertTrue(learner_connected)

        await coach_socket.send_json_to({"type": "send_message", "body": "Live hello"})
        coach_event = await coach_socket.receive_json_from()
        learner_event = await learner_socket.receive_json_from()

        self.assertEqual(coach_event["type"], "new_message")
        self.assertEqual(learner_event["message"]["body"], "Live hello")
        self.assertEqual(
            await database_sync_to_async(Message.objects.filter(body="Live hello").count)(),
            1,
        )

        await coach_socket.disconnect()
        await learner_socket.disconnect()

    async def test_unauthorized_websocket_is_rejected(self):
        socket = WebsocketCommunicator(
            UserScopeMiddleware(URLRouter(websocket_urlpatterns), self.outsider),
            f"/ws/chat/{self.conversation.pk}/",
        )

        connected, close_code = await socket.connect()

        self.assertFalse(connected)
        self.assertEqual(close_code, 4403)
