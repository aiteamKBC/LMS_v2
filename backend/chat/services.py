"""Application services for the existing PostgreSQL chat schema."""

import logging
from dataclasses import dataclass
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models import Count, DateTimeField, Exists, OuterRef, Prefetch, Q, Subquery
from django.utils import timezone

from .models import (
    ChatCoach,
    ChatLearner,
    Conversation,
    Message,
    MessageDeletion,
    MessageReceipt,
)

logger = logging.getLogger(__name__)

MAX_MESSAGE_LENGTH = 5000
MESSAGE_ACTION_WINDOW = timedelta(minutes=15)


class ChatAccessError(Exception):
    """Raised when an authenticated user is not a chat participant."""


class InvalidMessageError(Exception):
    """Raised when message input is invalid."""


class InvalidReadError(Exception):
    """Raised when a user cannot mark a message as read."""


@dataclass(frozen=True)
class ChatPrincipal:
    """The external identity represented by an authenticated Django user."""

    kind: str
    id: str | int
    name: str
    email: str


def _principal_cache_key(user):
    return f"_chat_principal_{getattr(user, 'pk', None)}"


def chat_principal_for_user(user):
    """Resolve a Django user to a coach or learner by email.

    The chat tables intentionally reference the existing ``curriculum.coaches``
    and ``Learner.learners`` tables rather than ``auth_user``. Email is the
    stable identity bridge; no client-provided participant ID is trusted.
    """

    if user is None or not user.is_authenticated:
        return None

    cache_key = _principal_cache_key(user)
    if hasattr(user, cache_key):
        return getattr(user, cache_key)

    email = (getattr(user, "email", "") or "").strip()
    principal = None
    if email:
        coach = ChatCoach.objects.filter(email__iexact=email).first()
        if coach:
            principal = ChatPrincipal("coach", coach.pk, coach.name, coach.email)
        else:
            learner = ChatLearner.objects.filter(email__iexact=email).first()
            if learner:
                principal = ChatPrincipal("learner", learner.pk, learner.full_name, learner.email)

    setattr(user, cache_key, principal)
    return principal


def conversation_group_name(conversation_id):
    return f"chat.conversation.{int(conversation_id)}"


def _principal_matches_conversation(conversation, principal):
    if principal is None:
        return False
    if principal.kind == "coach":
        return str(conversation.coach_id) == str(principal.id)
    return str(conversation.learner_id) == str(principal.id)


def user_belongs_to_conversation(conversation, user):
    return _principal_matches_conversation(conversation, chat_principal_for_user(user))


def _receipt_recipient_filter(principal, prefix=""):
    field_prefix = f"{prefix}__" if prefix else ""
    identity_field = (
        f"{field_prefix}recipient_coach_id"
        if principal.kind == "coach"
        else f"{field_prefix}recipient_learner_id"
    )
    return {
        f"{field_prefix}recipient_type": principal.kind,
        identity_field: principal.id,
    }


def _hidden_message_filter(principal, prefix=""):
    """Return a subquery for messages hidden from one participant."""

    message_field = f"{prefix}message_id" if prefix else "message_id"
    return MessageDeletion.objects.filter(
        **{
            message_field: OuterRef("pk"),
            "participant_type": principal.kind,
            "participant_id": str(principal.id),
        }
    )


def _ensure_message_action_is_recent(message):
    if timezone.now() > message.created_at + MESSAGE_ACTION_WINDOW:
        raise InvalidMessageError("Messages can only be edited or deleted for everyone within 15 minutes.")


def conversation_queryset_for_user(user):
    """Return only conversations owned by the authenticated external identity."""

    principal = chat_principal_for_user(user)
    if principal is None:
        return Conversation.objects.none()

    ownership = (
        Q(coach_id=principal.id)
        if principal.kind == "coach"
        else Q(learner_id=principal.id)
    )
    unread_filter = Q(
        messages__message_receipt__read_at__isnull=True,
        **_receipt_recipient_filter(principal, "messages__message_receipt"),
    )
    latest_message_queryset = (
        Message.objects.select_related(
            "sender_coach", "sender_learner"
        )
        .filter(~Exists(_hidden_message_filter(principal)))
        .order_by("-created_at", "-id")[:1]
    )

    return (
        Conversation.objects.filter(ownership)
        .select_related("coach", "learner")
        .annotate(
            unread_count=Count(
                "messages__message_receipt",
                filter=unread_filter,
                distinct=True,
            )
        )
        .prefetch_related(
            Prefetch("messages", queryset=latest_message_queryset, to_attr="latest_message_list")
        )
        .order_by("-updated_at", "-id")
    )


def get_conversation_for_user(conversation_id, user):
    return conversation_queryset_for_user(user).filter(pk=conversation_id).first()


def messages_queryset_for_user(conversation, user):
    principal = chat_principal_for_user(user)
    if not _principal_matches_conversation(conversation, principal):
        raise ChatAccessError("User does not belong to this conversation.")

    receipt_filter = _receipt_recipient_filter(principal)
    viewer_read_at = MessageReceipt.objects.filter(
        message_id=OuterRef("pk"),
        **receipt_filter,
    ).values("read_at")[:1]
    return (
        Message.objects.filter(conversation_id=conversation.pk)
        .select_related("sender_coach", "sender_learner")
        .filter(~Exists(_hidden_message_filter(principal)))
        .annotate(viewer_read_at=Subquery(viewer_read_at, output_field=DateTimeField()))
        .order_by("created_at", "id")
    )


def get_message_for_user(message_id, user):
    principal = chat_principal_for_user(user)
    if principal is None:
        return None
    ownership = (
        Q(conversation__coach_id=principal.id)
        if principal.kind == "coach"
        else Q(conversation__learner_id=principal.id)
    )
    return (
        Message.objects.filter(pk=message_id)
        .filter(ownership)
        .select_related(
            "conversation",
            "conversation__coach",
            "conversation__learner",
            "sender_coach",
            "sender_learner",
        )
        .first()
    )


def create_conversation(coach, learner):
    """Create or return the existing unique external-identity pair."""

    if str(coach.pk) == str(learner.pk):
        raise ChatAccessError("A user cannot start a conversation with themselves.")
    conversation, _ = Conversation.objects.get_or_create(coach=coach, learner=learner)
    return conversation


@transaction.atomic
def create_message(conversation, sender, body):
    """Persist a message and its unread receipt in one transaction."""

    principal = chat_principal_for_user(sender)
    if not _principal_matches_conversation(conversation, principal):
        raise ChatAccessError("Sender does not belong to this conversation.")
    if not isinstance(body, str):
        raise InvalidMessageError("Message body must be text.")

    body = body.strip()
    if not body:
        raise InvalidMessageError("Message body cannot be empty.")
    if len(body) > MAX_MESSAGE_LENGTH:
        raise InvalidMessageError(
            f"Message body cannot exceed {MAX_MESSAGE_LENGTH} characters."
        )

    locked_conversation = (
        Conversation.objects.select_for_update()
        .select_related("coach", "learner")
        .get(pk=conversation.pk)
    )
    if not _principal_matches_conversation(locked_conversation, principal):
        raise ChatAccessError("Sender does not belong to this conversation.")

    now = timezone.now()
    message_kwargs = {
        "conversation": locked_conversation,
        "sender_type": principal.kind,
        "body": body,
        "created_at": now,
        "is_deleted": False,
    }
    if principal.kind == "coach":
        message_kwargs["sender_coach_id"] = principal.id
    else:
        message_kwargs["sender_learner_id"] = principal.id

    message = Message(**message_kwargs)
    message.full_clean()
    message.save(force_insert=True)

    receipt_kwargs = {
        "message": message,
        "recipient_type": "learner" if principal.kind == "coach" else "coach",
        "delivered_at": None,
        "read_at": None,
    }
    if principal.kind == "coach":
        receipt_kwargs["recipient_learner_id"] = locked_conversation.learner_id
    else:
        receipt_kwargs["recipient_coach_id"] = locked_conversation.coach_id

    receipt = MessageReceipt(**receipt_kwargs)
    receipt.full_clean()
    receipt.save(force_insert=True)
    Conversation.objects.filter(pk=locked_conversation.pk).update(updated_at=now)

    return (
        Message.objects.select_related(
            "conversation", "sender_coach", "sender_learner"
        ).get(pk=message.pk)
    )


@transaction.atomic
def edit_message(message, editor, body):
    """Update a message only when the authenticated user sent it."""

    principal = chat_principal_for_user(editor)
    if not _principal_matches_conversation(message.conversation, principal):
        raise ChatAccessError("Editor does not belong to this conversation.")
    if message.is_deleted:
        raise InvalidMessageError("Deleted messages cannot be edited.")
    if message.sender_type != principal.kind or str(message.sender_id) != str(principal.id):
        raise ChatAccessError("Only the message sender can edit this message.")
    _ensure_message_action_is_recent(message)
    if not isinstance(body, str):
        raise InvalidMessageError("Message body must be text.")

    body = body.strip()
    if not body:
        raise InvalidMessageError("Message body cannot be empty.")
    if len(body) > MAX_MESSAGE_LENGTH:
        raise InvalidMessageError(
            f"Message body cannot exceed {MAX_MESSAGE_LENGTH} characters."
        )

    locked_message = (
        Message.objects.select_for_update()
        .get(pk=message.pk)
    )
    if not _principal_matches_conversation(locked_message.conversation, principal):
        raise ChatAccessError("Editor does not belong to this conversation.")
    if locked_message.is_deleted:
        raise InvalidMessageError("Deleted messages cannot be edited.")
    if locked_message.sender_type != principal.kind or str(locked_message.sender_id) != str(principal.id):
        raise ChatAccessError("Only the message sender can edit this message.")
    _ensure_message_action_is_recent(locked_message)

    now = timezone.now()
    locked_message.body = body
    locked_message.edited_at = now
    locked_message.full_clean()
    locked_message.save(update_fields=["body", "edited_at"])
    Conversation.objects.filter(pk=locked_message.conversation_id).update(updated_at=now)

    return (
        Message.objects.select_related(
            "conversation", "sender_coach", "sender_learner"
        ).get(pk=locked_message.pk)
    )


@transaction.atomic
def delete_message_for_me(message, user):
    """Hide a message for the requesting participant only."""

    principal = chat_principal_for_user(user)
    if not _principal_matches_conversation(message.conversation, principal):
        raise ChatAccessError("User does not belong to this conversation.")

    MessageDeletion.objects.get_or_create(
        message_id=message.pk,
        participant_type=principal.kind,
        participant_id=str(principal.id),
    )


@transaction.atomic
def delete_message_for_everyone(message, user):
    """Soft-delete a sender's message for both conversation participants."""

    principal = chat_principal_for_user(user)
    if not _principal_matches_conversation(message.conversation, principal):
        raise ChatAccessError("User does not belong to this conversation.")
    if message.sender_type != principal.kind or str(message.sender_id) != str(principal.id):
        raise ChatAccessError("Only the message sender can delete this message for everyone.")
    if message.is_deleted:
        return message
    _ensure_message_action_is_recent(message)

    # Do not select_related nullable sender FKs while taking the row lock;
    # PostgreSQL rejects FOR UPDATE on the nullable side of that join.
    locked_message = Message.objects.select_for_update().get(pk=message.pk)
    if locked_message.is_deleted:
        return locked_message
    if locked_message.sender_type != principal.kind or str(locked_message.sender_id) != str(principal.id):
        raise ChatAccessError("Only the message sender can delete this message for everyone.")
    _ensure_message_action_is_recent(locked_message)

    now = timezone.now()
    locked_message.is_deleted = True
    locked_message.edited_at = now
    locked_message.save(update_fields=["is_deleted", "edited_at"])
    Conversation.objects.filter(pk=locked_message.conversation_id).update(updated_at=now)

    return (
        Message.objects.select_related(
            "conversation", "sender_coach", "sender_learner"
        ).get(pk=locked_message.pk)
    )


@transaction.atomic
def mark_message_as_read(message, user):
    principal = chat_principal_for_user(user)
    if not _principal_matches_conversation(message.conversation, principal):
        raise ChatAccessError("User does not belong to this conversation.")

    receipt = (
        MessageReceipt.objects.select_for_update()
        .filter(message_id=message.pk, **_receipt_recipient_filter(principal))
        .first()
    )
    if receipt is None:
        raise InvalidReadError("Only the message recipient can mark it as read.")

    if receipt.read_at is None:
        now = timezone.now()
        receipt.read_at = now
        update_fields = ["read_at"]
        if receipt.delivered_at is None:
            receipt.delivered_at = now
            update_fields.append("delivered_at")
        receipt.save(update_fields=update_fields)
    return receipt


def message_event_payload(message):
    return {
        "id": message.pk,
        "conversation": message.conversation_id,
        "sender": {
            "type": message.sender_type,
            "id": str(message.sender_id),
        },
        "body": "Message deleted" if message.is_deleted else message.body,
        "created_at": message.created_at.isoformat(),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
        "is_deleted": message.is_deleted,
    }


def broadcast_message(message, event_type="new_message"):
    """Broadcast a committed REST-created message through Redis."""

    channel_layer = get_channel_layer()
    if channel_layer is None:
        logger.warning("Chat channel layer is not configured; message was persisted only.")
        return

    try:
        async_to_sync(channel_layer.group_send)(
            conversation_group_name(message.conversation_id),
            {"type": f"chat.{event_type}", "message": message_event_payload(message)},
        )
    except Exception:
        logger.exception("Unable to broadcast chat message %s", message.pk)
