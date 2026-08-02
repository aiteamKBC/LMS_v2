from rest_framework.permissions import BasePermission

from .models import Conversation, Message
from .services import user_belongs_to_conversation


class IsConversationParticipant(BasePermission):
    """Allow access only to the coach or learner in the conversation."""

    message = "You do not have access to this conversation."

    def has_object_permission(self, request, view, obj):
        conversation = obj if isinstance(obj, Conversation) else getattr(obj, "conversation", None)
        return user_belongs_to_conversation(conversation, request.user)


class IsMessageParticipant(BasePermission):
    """Explicit message-level variant for endpoints addressed by message ID."""

    message = "You do not have access to this message."

    def has_object_permission(self, request, view, obj):
        if not isinstance(obj, Message):
            return False
        return user_belongs_to_conversation(obj.conversation, request.user)
