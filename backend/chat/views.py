from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.http import Http404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ChatCoach, ChatLearner
from .permissions import IsConversationParticipant, IsMessageParticipant
from .serializers import ConversationSerializer, MessageCreateSerializer, MessageSerializer
from .services import (
    ChatAccessError,
    InvalidMessageError,
    InvalidReadError,
    broadcast_message,
    conversation_queryset_for_user,
    create_message,
    get_conversation_for_user,
    get_message_for_user,
    mark_message_as_read,
    messages_queryset_for_user,
)


class MessagePagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


# The frontend currently uses local demo accounts. These two mappings connect
# those demo identities to the real coach/learner identities already present
# in the production chat schema, so the browser can receive a normal Django
# session before it calls the protected chat endpoints.
DEMO_CHAT_IDENTITIES = {
    "coach@kbc.test": ("coach", "Med.Maher@kentbusinesscollege.com"),
    "learner@kbc.test": ("learner", "test@example.com"),
}


def _demo_chat_identity(email):
    mapping = DEMO_CHAT_IDENTITIES.get((email or "").strip().lower())
    if not mapping:
        return None

    participant_type, participant_email = mapping
    participant_model = ChatCoach if participant_type == "coach" else ChatLearner
    return participant_type, participant_model.objects.filter(email__iexact=participant_email).first()


@method_decorator(ensure_csrf_cookie, name="dispatch")
class ChatSessionView(APIView):
    """Create the Django session used by the local frontend demo accounts."""

    authentication_classes = ()
    permission_classes = (AllowAny,)

    def get(self, request):
        return Response({
            "authenticated": bool(request.user.is_authenticated),
            "email": getattr(request.user, "email", "") if request.user.is_authenticated else None,
        })

    def post(self, request):
        if not settings.DEBUG:
            return Response({"detail": "Demo chat session bootstrap is disabled."}, status=status.HTTP_404_NOT_FOUND)

        demo_email = str(request.data.get("email", "")).strip().lower()
        identity = _demo_chat_identity(demo_email)
        if identity is None or identity[1] is None:
            return Response({"detail": "This demo account has no chat identity."}, status=status.HTTP_400_BAD_REQUEST)

        participant_type, participant = identity
        user_model = get_user_model()
        username = f"chat_demo_{participant_type}_{participant.pk}"[:150]
        user, _ = user_model.objects.get_or_create(
            username=username,
            defaults={"email": participant.email, "is_active": True},
        )
        if user.email != participant.email or not user.is_active:
            user.email = participant.email
            user.is_active = True
            user.save(update_fields=["email", "is_active"])

        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response({
            "authenticated": True,
            "demo_email": demo_email,
            "email": participant.email,
            "participant_type": participant_type,
            "participant_id": str(participant.pk),
        })


class ChatSessionLogoutView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request):
        logout(request)
        return Response({"authenticated": False})


@method_decorator(ensure_csrf_cookie, name="dispatch")
class ConversationListView(APIView):
    """List only conversations belonging to the authenticated user."""

    permission_classes = (IsAuthenticated,)

    def get(self, request):
        conversations = conversation_queryset_for_user(request.user)
        serializer = ConversationSerializer(
            conversations,
            many=True,
            context={"request": request},
        )
        return Response(serializer.data)


class ConversationMessagesView(APIView):
    """Read history or create a message within an authorized conversation."""

    permission_classes = (IsAuthenticated, IsConversationParticipant)

    def _conversation(self, request, conversation_id):
        conversation = get_conversation_for_user(conversation_id, request.user)
        if conversation is None:
            raise Http404
        self.check_object_permissions(request, conversation)
        return conversation

    def get(self, request, conversation_id):
        conversation = self._conversation(request, conversation_id)
        paginator = MessagePagination()
        page = paginator.paginate_queryset(
            messages_queryset_for_user(conversation, request.user), request, view=self
        )
        serializer = MessageSerializer(
            page,
            many=True,
            context={"request": request},
        )
        return paginator.get_paginated_response(serializer.data)

    def post(self, request, conversation_id):
        conversation = self._conversation(request, conversation_id)
        input_serializer = MessageCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        try:
            message = create_message(
                conversation=conversation,
                sender=request.user,
                body=input_serializer.validated_data["body"],
            )
        except ChatAccessError as exc:
            raise PermissionDenied(str(exc)) from exc
        except InvalidMessageError as exc:
            raise ValidationError({"body": str(exc)}) from exc

        broadcast_message(message)
        output_serializer = MessageSerializer(
            message,
            context={"request": request},
        )
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)


class MessageReadView(APIView):
    """Mark a message read for its authenticated recipient."""

    permission_classes = (IsAuthenticated, IsMessageParticipant)

    def post(self, request, message_id):
        message = get_message_for_user(message_id, request.user)
        if message is None:
            raise Http404
        self.check_object_permissions(request, message)

        try:
            receipt = mark_message_as_read(message, request.user)
        except ChatAccessError as exc:
            raise PermissionDenied(str(exc)) from exc
        except InvalidReadError as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        return Response(
            {
                "message": message.pk,
                "read_at": receipt.read_at,
            },
            status=status.HTTP_200_OK,
        )
