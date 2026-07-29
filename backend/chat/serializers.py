from rest_framework import serializers

from .models import Conversation, Message, MessageReceipt
from .services import chat_principal_for_user


def _request_user(context):
    request = context.get("request")
    if request is not None:
        return getattr(request, "user", None)
    return context.get("user")


def _participant_data(participant, participant_type):
    if participant is None:
        return None
    if participant_type == "coach":
        return {
            "id": str(participant.pk),
            "type": "coach",
            "name": participant.name,
            "avatar": None,
        }
    return {
        "id": str(participant.pk),
        "type": "learner",
        "name": participant.full_name,
        "avatar": None,
    }


def _sender_data(obj):
    participant = obj.sender
    return _participant_data(participant, obj.sender_type)


class LatestMessageSerializer(serializers.ModelSerializer):
    """Compact message representation used by the conversation list."""

    sender = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = (
            "id",
            "sender",
            "body",
            "created_at",
            "edited_at",
            "is_deleted",
        )
        read_only_fields = fields

    def get_sender(self, obj):
        return _sender_data(obj)


class ConversationSerializer(serializers.ModelSerializer):
    participant = serializers.SerializerMethodField()
    latest_message = serializers.SerializerMethodField()
    unread_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Conversation
        fields = (
            "id",
            "participant",
            "latest_message",
            "updated_at",
            "unread_count",
        )
        read_only_fields = fields

    def get_participant(self, obj):
        user = _request_user(self.context)
        principal = chat_principal_for_user(user)
        if principal and principal.kind == "coach":
            return _participant_data(obj.learner, "learner")
        return _participant_data(obj.coach, "coach")

    def get_latest_message(self, obj):
        latest_messages = getattr(obj, "latest_message_list", None)
        if latest_messages is None:
            latest_messages = list(
                obj.messages.select_related("sender_coach", "sender_learner")
                .order_by("-created_at", "-id")[:1]
            )
        if not latest_messages:
            return None
        return LatestMessageSerializer(latest_messages[0], context=self.context).data


class MessageSerializer(serializers.ModelSerializer):
    sender = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()
    read_at = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = (
            "id",
            "conversation",
            "sender",
            "body",
            "created_at",
            "edited_at",
            "is_deleted",
            "is_mine",
            "read_at",
        )
        read_only_fields = fields

    def get_sender(self, obj):
        return _sender_data(obj)

    def get_is_mine(self, obj):
        principal = chat_principal_for_user(_request_user(self.context))
        return bool(
            principal
            and principal.kind == obj.sender_type
            and str(principal.id) == str(obj.sender_id)
        )

    def get_read_at(self, obj):
        annotated_read_at = getattr(obj, "viewer_read_at", serializers.empty)
        if annotated_read_at is not serializers.empty:
            return annotated_read_at

        principal = chat_principal_for_user(_request_user(self.context))
        if principal is None:
            return None
        recipient_filter = (
            {"recipient_type": "coach", "recipient_coach_id": principal.id}
            if principal.kind == "coach"
            else {"recipient_type": "learner", "recipient_learner_id": principal.id}
        )
        return (
            MessageReceipt.objects.filter(message_id=obj.pk, **recipient_filter)
            .values_list("read_at", flat=True)
            .first()
        )


class MessageCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ("body",)

    def validate_body(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Message body cannot be empty.")
        if len(value) > 5000:
            raise serializers.ValidationError("Message body cannot exceed 5000 characters.")
        return value
