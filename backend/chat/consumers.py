import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .services import (
    ChatAccessError,
    InvalidMessageError,
    conversation_group_name,
    create_message,
    get_conversation_for_user,
    message_event_payload,
)

logger = logging.getLogger(__name__)


class ChatConsumer(AsyncJsonWebsocketConsumer):
    """Authenticated WebSocket endpoint for a private conversation."""

    async def connect(self):
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return

        conversation_id = self.scope.get("url_route", {}).get("kwargs", {}).get(
            "conversation_id"
        )
        conversation = await database_sync_to_async(get_conversation_for_user)(
            conversation_id, user
        )
        if conversation is None:
            # Use one denial code for unknown and unauthorized IDs so the endpoint
            # does not disclose whether another user's conversation exists.
            await self.close(code=4403)
            return

        self.conversation = conversation
        self.conversation_id = conversation.pk
        self.group_name = conversation_group_name(conversation.pk)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if not isinstance(content, dict) or content.get("type") != "send_message":
            await self.send_json(
                {
                    "type": "error",
                    "code": "unsupported_event",
                    "detail": "Only send_message is supported in phase 1.",
                }
            )
            return

        try:
            message = await database_sync_to_async(create_message)(
                conversation=self.conversation,
                sender=self.scope["user"],
                body=content.get("body"),
            )
        except ChatAccessError:
            await self.close(code=4403)
            return
        except InvalidMessageError as exc:
            await self.send_json(
                {"type": "error", "code": "invalid_message", "detail": str(exc)}
            )
            return

        try:
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "chat.new_message",
                    "message": message_event_payload(message),
                },
            )
        except Exception:
            logger.exception("Unable to broadcast WebSocket chat message %s", message.pk)
            await self.send_json(
                {
                    "type": "error",
                    "code": "delivery_unavailable",
                    "detail": "Message was saved but could not be delivered in real time.",
                }
            )

    async def chat_new_message(self, event):
        await self.send_json(
            {
                "type": "new_message",
                "message": event["message"],
            }
        )
