# =============================================================================
# CHAT SUBSYSTEM DISABLED — 2026-09-02
# -----------------------------------------------------------------------------
# The entire chat feature (this module, chat/consumers.py, chat/services.py and
# the /api/chat/ routes) is deliberately turned OFF and is known-broken.
#
# Reason: the session-bootstrap endpoint (ChatSessionView below) was an
# unauthenticated identity bootstrap — security audit finding A10. Product-owner
# decision on 2026-09-02 was to DISABLE chat, not fix it.
#
# Mitigation applied: CHAT_DEMO_BOOTSTRAP_ENABLED=false (backend/.env) so the
# bootstrap returns 404 and mints nothing, and the already-minted chat_demo_*
# auth_user rows were deactivated so their existing cookies stop authenticating.
# The code default of CHAT_DEMO_BOOTSTRAP_ENABLED in backend/config/settings.py
# is now also "false", so a deployment lacking the .env line is closed too.
#
# NO chat code was deleted. This subsystem is DISABLED, not removed: every
# module (this view, chat/consumers.py, chat/services.py, chat/routing.py, the
# routes) is intact and can be re-enabled once A18 is done. "Don't delete it"
# was an explicit instruction — the code is off, present, and recoverable.
#
# Do NOT re-enable by flipping the flag — that reopens A10. The correct rebuild
# is audit finding A18 (a kbc_session-backed DRF/Channels auth class). See the
# ChatSessionView docstring and SECURITY_AUDIT.md (A10, A18).
# =============================================================================
from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.db import IntegrityError, router, transaction
from django.http import Http404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from learner_api.models import EnrolmentUser, LearnerProfile
from login.sessions import authenticate_request

from .models import ChatCoach, ChatLearner, Conversation
from .permissions import IsConversationParticipant, IsMessageParticipant
from .serializers import ConversationSerializer, MessageCreateSerializer, MessageSerializer
from .services import (
    ChatAccessError,
    InvalidMessageError,
    InvalidReadError,
    broadcast_message,
    conversation_queryset_for_user,
    create_message,
    delete_message_for_everyone,
    delete_message_for_me,
    edit_message,
    get_conversation_for_user,
    get_message_for_user,
    learner_messages_queryset_for_coach,
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
}


class ChatIdentityError(ValueError):
    """Raised when a selected learner cannot be mapped to an exact chat pair."""


def _clean_text(value):
    return "" if value in (None, "") else str(value).strip()


def _learner_profile_defaults(source, source_email):
    programme_status = _clean_text(getattr(source, "programme_status", ""))
    source_status = _clean_text(getattr(source, "status", ""))
    normalized_status = (programme_status or source_status).casefold()
    lifecycle_status = (
        "active"
        if normalized_status in {"active", "fulluser"}
        else ("onboarding" if normalized_status in {"", "onboarding", "ready to enrol"} else "inactive")
    )
    return {
        "full_name": _clean_text(getattr(source, "username", "")) or source_email,
        "email": source_email,
        "phone_number": _clean_text(getattr(source, "phone_number", "")),
        "lifecycle_status": lifecycle_status,
        "programme": _clean_text(getattr(source, "programme", "")),
        "programme_status": programme_status,
        "cohort": _clean_text(getattr(source, "cohort", "")),
        "group_name": _clean_text(getattr(source, "group", "")),
    }


def _sync_learner_identity_from_source(source_id):
    """Resolve a selected learner into the ``Learner.learners`` identity.

    ``enrolment.Created_users`` and ``Learner.learners`` have independent
    primary-key sequences. Email is therefore the only safe bridge when a
    current source row is available; legacy profile ids are also accepted for
    sessions created before the learner-table merge.
    """

    if source_id in (None, ""):
        raise ChatIdentityError("Select a learner before opening messages.")

    try:
        source_id = int(source_id)
    except (TypeError, ValueError):
        raise ChatIdentityError("The selected learner id is invalid.")

    source = EnrolmentUser.all_learners.filter(pk=source_id).first()
    if source is None:
        # Older frontend sessions persisted the learner table id (for example
        # LearnerProfile 2), while the merged enrolment table now exposes a
        # different source id (for example 19). Keep those sessions usable by
        # resolving the existing profile when no source row matches.
        profile = LearnerProfile.objects.filter(pk=source_id).first()
        if profile is None:
            raise ChatIdentityError("The selected learner no longer exists.")

        learner = ChatLearner.objects.filter(pk=profile.pk).first()
        if learner is None:
            raise ChatIdentityError("The learner identity could not be prepared for chat.")
        return learner

    source_email = _clean_text(getattr(source, "email", ""))
    if not source_email:
        raise ChatIdentityError("The selected learner needs an email before chat can be used.")

    defaults = _learner_profile_defaults(source, source_email)
    db_alias = router.db_for_write(LearnerProfile) or "default"
    with transaction.atomic(using=db_alias):
        profile = (
            LearnerProfile.objects.using(db_alias)
            .select_for_update()
            .filter(email__iexact=source_email)
            .first()
        )
        if profile is None:
            try:
                profile = LearnerProfile.objects.using(db_alias).create(**defaults)
            except IntegrityError:
                # A simultaneous request may have inserted the same normalized
                # email. Re-read it instead of creating a duplicate identity.
                profile = (
                    LearnerProfile.objects.using(db_alias)
                    .select_for_update()
                    .get(email__iexact=source_email)
                )
        else:
            identity_updates = []
            for field in ("full_name", "email"):
                value = defaults[field]
                if getattr(profile, field) != value:
                    setattr(profile, field, value)
                    identity_updates.append(field)
            if identity_updates:
                profile.save(update_fields=identity_updates)

    # Return the chat model from its normal database alias so subsequent
    # Conversation operations never become cross-alias relations.
    learner = ChatLearner.objects.filter(pk=profile.pk).first()
    if learner is None:
        raise ChatIdentityError("The learner identity could not be prepared for chat.")
    return learner


def _demo_learner_identity_from_source(source_id):
    return "learner", _sync_learner_identity_from_source(source_id)


def _demo_chat_identity(email, learner_source_id=None):
    if learner_source_id not in (None, ""):
        return _demo_learner_identity_from_source(learner_source_id)

    # Never silently impersonate Test User. The learner page must carry the
    # selected directory row so its real name/email become the chat identity.
    if (email or "").strip().lower() == "learner@kbc.test":
        raise ChatIdentityError("Select a learner from the user list before opening messages.")

    mapping = DEMO_CHAT_IDENTITIES.get((email or "").strip().lower())
    if not mapping:
        return None

    participant_type, participant_email = mapping
    participants = (
        ChatCoach.objects.coaches()
        if participant_type == "coach"
        else ChatLearner.objects.all()
    )
    return participant_type, participants.filter(email__iexact=participant_email).first()


def _ensure_assigned_coach_conversation(learner):
    profile = LearnerProfile.objects.filter(pk=learner.pk).only("coach_email").first()
    coach_email = _clean_text(getattr(profile, "coach_email", ""))
    if not coach_email:
        raise ChatIdentityError("This learner does not have an assigned coach email.")

    # Reuse an existing conversation even if the staff directory holds
    # duplicate rows for the same email. This keeps one continuous thread.
    existing = (
        Conversation.objects.filter(
            learner_id=learner.pk,
            coach__email__iexact=coach_email,
        )
        .select_related("coach")
        .order_by("-updated_at", "-id")
        .first()
    )
    if existing is not None:
        return existing

    coach = ChatCoach.objects.coaches().filter(email__iexact=coach_email).order_by("id").first()
    if coach is None:
        raise ChatIdentityError(
            f"No staff user with coach access matches {coach_email}."
        )
    conversation, _ = Conversation.objects.get_or_create(coach=coach, learner=learner)
    return conversation


@method_decorator(ensure_csrf_cookie, name="dispatch")
class ChatSessionView(APIView):
    """DISABLED 2026-09-02 — the chat subsystem is known-broken and off.

    ================= DO NOT SIMPLY RE-ENABLE THIS =================
    The whole chat subsystem is deliberately disabled as of 2026-09-02.

    Why: this endpoint was an unauthenticated identity bootstrap (security
    audit finding A10). It is `AllowAny` and, when the flag below is on, mints
    a real Django login session for a caller-chosen identity — originally with
    no session check at all, so any anonymous stranger could become any learner
    (and one hardcoded demo coach). A minted session then satisfies every
    ``ANY``-prefix gate. It is also the ONLY place in the app that creates a
    Django-auth session, so it is the sole login bridge the rest of chat
    depends on.

    The product owner's decision (2026-09-02) was to DISABLE chat, not fix it:
      * ``CHAT_DEMO_BOOTSTRAP_ENABLED`` is set to ``false`` (backend/.env), so
        this endpoint returns 404 to everyone and mints nothing.
      * The six ``chat_demo_*`` auth_user rows already minted were deactivated
        (``is_active=False``) so their existing session cookies no longer
        authenticate.
    Still outstanding: flip the CODE default of ``CHAT_DEMO_BOOTSTRAP_ENABLED``
    in backend/config/settings.py from ``"true"`` to ``"false"`` so a fresh
    deployment without the .env line is also closed.

    This is known-broken and intentionally NOT fixed. Do not "switch it back on"
    by flipping the flag — that reopens A10. The proper rebuild is audit finding
    A18: a custom DRF/Channels authentication class that reads ``kbc_session``
    and populates ``request.user`` directly, removing session-minting entirely.
    See SECURITY_AUDIT.md (A10 status: MITIGATED BY DISABLING; A18: the rebuild).
    ===============================================================
    """

    authentication_classes = ()
    permission_classes = (AllowAny,)

    def get(self, request):
        return Response({
            "authenticated": bool(request.user.is_authenticated),
            "email": getattr(request.user, "email", "") if request.user.is_authenticated else None,
        })

    def post(self, request):
        # Flag check FIRST: a disabled endpoint returns a uniform 404 to every
        # caller and discloses nothing about session state. With the subsystem
        # off (see the class docstring) this is the only branch that runs.
        if not settings.CHAT_DEMO_BOOTSTRAP_ENABLED:
            return Response({"detail": "Demo chat session bootstrap is disabled."}, status=status.HTTP_404_NOT_FOUND)

        # Kept below the flag as defence-in-depth for the day someone re-enables
        # the flag: a chat session may only be minted for a caller who already
        # holds a valid platform session (the ``kbc_session`` cookie). It costs
        # nothing while the endpoint is disabled.
        if authenticate_request(request) is None:
            return Response({"detail": "Authentication required."}, status=status.HTTP_401_UNAUTHORIZED)

        demo_email = str(request.data.get("email", "")).strip().lower()
        try:
            identity = _demo_chat_identity(
                demo_email,
                learner_source_id=request.data.get("learner_source_id"),
            )
        except ChatIdentityError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        if identity is None or identity[1] is None:
            return Response({"detail": "This demo account has no chat identity."}, status=status.HTTP_400_BAD_REQUEST)

        participant_type, participant = identity
        if participant_type == "learner":
            try:
                conversation = _ensure_assigned_coach_conversation(participant)
            except ChatIdentityError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        else:
            conversation = None
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
            "participant_name": (
                participant.name if participant_type == "coach" else participant.full_name
            ),
            "conversation_id": conversation.pk if conversation is not None else None,
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


class LearnerMessagesView(APIView):
    """Return learner-sent messages from every conversation assigned to a coach."""

    permission_classes = (IsAuthenticated,)

    def get(self, request):
        try:
            queryset = learner_messages_queryset_for_coach(request.user)
        except ChatAccessError as exc:
            raise PermissionDenied(str(exc)) from exc

        paginator = MessagePagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = MessageSerializer(page, many=True, context={"request": request})
        return paginator.get_paginated_response(serializer.data)


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


class MessageEditView(APIView):
    """Edit a message only when the authenticated user sent it."""

    permission_classes = (IsAuthenticated, IsMessageParticipant)

    def patch(self, request, message_id):
        message = get_message_for_user(message_id, request.user)
        if message is None:
            raise Http404
        self.check_object_permissions(request, message)

        input_serializer = MessageCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)

        try:
            message = edit_message(
                message=message,
                editor=request.user,
                body=input_serializer.validated_data["body"],
            )
        except ChatAccessError as exc:
            raise PermissionDenied(str(exc)) from exc
        except InvalidMessageError as exc:
            raise ValidationError({"body": str(exc)}) from exc

        broadcast_message(message, event_type="message_updated")
        output_serializer = MessageSerializer(
            message,
            context={"request": request},
        )
        return Response(output_serializer.data, status=status.HTTP_200_OK)


class MessageDeleteView(APIView):
    """Delete a message for the current participant or for everyone."""

    permission_classes = (IsAuthenticated, IsMessageParticipant)

    def post(self, request, message_id):
        message = get_message_for_user(message_id, request.user)
        if message is None:
            raise Http404
        self.check_object_permissions(request, message)

        scope = str(request.data.get("scope", "me")).strip().lower()
        if scope not in {"me", "everyone"}:
            raise ValidationError({"scope": "Scope must be 'me' or 'everyone'."})

        try:
            if scope == "me":
                delete_message_for_me(message=message, user=request.user)
                return Response(
                    {"message": message.pk, "scope": "me"},
                    status=status.HTTP_200_OK,
                )

            message = delete_message_for_everyone(message=message, user=request.user)
        except ChatAccessError as exc:
            raise PermissionDenied(str(exc)) from exc
        except InvalidMessageError as exc:
            raise ValidationError({"scope": str(exc)}) from exc

        broadcast_message(message, event_type="message_deleted")
        output_serializer = MessageSerializer(message, context={"request": request})
        return Response(output_serializer.data, status=status.HTTP_200_OK)
