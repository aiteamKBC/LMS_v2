from __future__ import annotations

import json
import logging
import re
from decimal import Decimal, InvalidOperation

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import connections
from django.db import router
from django.db.models.functions import Lower, Trim
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from learner_api.models import LearnerProfile


DEFAULT_COACH_EMAIL = "Med.Maher@kentbusinesscollege.com"
logger = logging.getLogger(__name__)
COACH_RAG_LABELS = {
    "green": "Green",
    "amber": "Amber",
    "red": "Red",
}


def clean_text(value) -> str:
    return "" if value in (None, "") else str(value).strip()


def normalize_email(value: str | None) -> str:
    return clean_text(value).lower()


def parse_json_body(request) -> dict:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError(f"Invalid JSON body: {exc}") from exc


def to_decimal(value) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def to_number(value) -> float:
    return float(to_decimal(value))


def percentage(numerator, denominator) -> int:
    denominator_value = to_decimal(denominator)
    if denominator_value <= 0:
        return 0
    numerator_value = to_decimal(numerator)
    value = int(round((numerator_value / denominator_value) * 100))
    return max(0, min(100, value))


def parse_variance(value: str | None) -> int:
    if not value:
        return 0
    match = re.search(r"-?\d+", value)
    return int(match.group()) if match else 0


def normalize_program_status(raw_status: str | None) -> str:
    normalized = clean_text(raw_status).lower().replace(" ", "")
    if normalized == "withdrawn":
        return "withdrawn"
    if normalized in {"break", "onbreak", "onabreak", "onmaternitybreak", "onillnessbreak", "onotherbreak"}:
        return "break"
    if normalized == "readytoenrol":
        return "ready-to-enrol"
    if normalized == "active":
        return "active"
    return "unknown"


def format_coach_rag_value(value) -> str:
    return COACH_RAG_LABELS.get(clean_text(value).lower(), "")


def get_lms_row_program_status(row) -> str:
    return clean_text(getattr(row, "programme_status", None) or getattr(row, "status", None))


def get_learner_db_alias() -> str:
    return router.db_for_read(LearnerProfile) or "default"


def build_active_user_risk_flags(
    *,
    otjh_status: str,
    ksb_status: str,
    progress_variance: str,
    hours_progress: int,
    hours_available: bool,
    ksb_progress: int,
    ksb_available: bool,
    component_progress: int,
    component_available: bool,
) -> list[str]:
    flags: list[str] = []
    normalized_otjh = clean_text(otjh_status).lower().replace(" ", "")

    if normalized_otjh == "needattention":
        flags.append("Hours need attention")
    elif normalized_otjh == "atrisk":
        flags.append("OTJH at risk")

    if ksb_status == "Not Started":
        flags.append("KSBs not started")
    if progress_variance:
        flags.append(f"Variance {progress_variance}")
    if component_available and component_progress < 25:
        flags.append("Components behind target")
    if hours_available and hours_progress < 25:
        flags.append("Low hours progress")
    if ksb_available and ksb_progress < 25:
        flags.append("Low KSB progress")

    deduped: list[str] = []
    seen: set[str] = set()
    for flag in flags:
        if flag not in seen:
            seen.add(flag)
            deduped.append(flag)
    return deduped[:4]


def determine_active_user_status(
    *,
    program_status: str,
    otjh_status: str,
    progress_variance: str,
    hours_progress: int,
    hours_available: bool,
    ksb_progress: int,
    ksb_available: bool,
    component_progress: int,
    component_available: bool,
) -> str:
    if normalize_program_status(program_status) == "ready-to-enrol":
        return "new-starter"

    normalized_otjh = clean_text(otjh_status).lower().replace(" ", "")
    if normalized_otjh == "atrisk":
        return "at-risk"
    if normalized_otjh == "needattention" and (
        (hours_available and hours_progress < 45)
        or (ksb_available and ksb_progress < 35)
        or (component_available and component_progress < 35)
    ):
        return "at-risk"
    if progress_variance and parse_variance(progress_variance) <= -10:
        return "at-risk"
    if (
        hours_available
        and ksb_available
        and component_available
        and hours_progress >= 80
        and ksb_progress >= 75
        and component_progress >= 75
    ):
        return "high"
    return "on-track"


def _owner_email_from_request(request) -> str:
    return request.GET.get("owner_email", DEFAULT_COACH_EMAIL).strip() or DEFAULT_COACH_EMAIL


def _fetch_owner_message_learners(owner_email: str) -> list[LearnerProfile]:
    requested_owner = normalize_email(owner_email)
    queryset = (
        LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
        .filter(coach_email_key=requested_owner)
        .only(
            "id",
            "full_name",
            "email",
            "programme",
            "programme_status",
            "cohort",
            "group_name",
            "completed_hours",
            "target_hours",
            "minimum_hours",
            "planned_hours",
            "progress_variance",
            "otjh_status",
            "coach_name",
            "coach_email",
            "coach_rag",
        )
        .order_by("full_name", "id")
    )
    rows: list[LearnerProfile] = []
    for row in queryset:
        if clean_text(row.username):
            rows.append(row)
    return rows


def _build_initials(value: str) -> str:
    parts = [part for part in clean_text(value).split() if part]
    if not parts:
        return "--"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def _thread_snapshot_for_learner(row: LearnerProfile) -> dict:
    target_hours_value = (
        clean_text(row.target_hours)
        or clean_text(row.minimum_hours)
        or clean_text(row.planned_hours)
    )
    hours_available = bool(clean_text(row.completed_hours) or target_hours_value)
    hours_progress = percentage(row.completed_hours, target_hours_value) if target_hours_value else 0
    otjh_status = clean_text(row.otjh_status)
    progress_variance = clean_text(row.progress_variance)
    program_status = get_lms_row_program_status(row)
    risk_flags = build_active_user_risk_flags(
        otjh_status=otjh_status,
        ksb_status="",
        progress_variance=progress_variance,
        hours_progress=hours_progress,
        hours_available=hours_available,
        ksb_progress=0,
        ksb_available=False,
        component_progress=0,
        component_available=False,
    )
    status = determine_active_user_status(
        program_status=program_status,
        otjh_status=otjh_status,
        progress_variance=progress_variance,
        hours_progress=hours_progress,
        hours_available=hours_available,
        ksb_progress=0,
        ksb_available=False,
        component_progress=0,
        component_available=False,
    )
    return {
        "learnerId": str(row.id),
        "learnerName": clean_text(row.username) or "Unknown learner",
        "learnerInitials": _build_initials(row.username),
        "learnerEmail": clean_text(row.email) or "",
        "programme": clean_text(row.programme) or "--",
        "cohortName": clean_text(row.cohort) or "--",
        "group": clean_text(row.group) or "--",
        "coachRag": format_coach_rag_value(getattr(row, "coach_rag", None)),
        "otjhStatus": otjh_status or "--",
        "overallProgress": hours_progress,
        "otjhCompleted": to_number(row.completed_hours),
        "otjhTarget": max(to_number(target_hours_value) if target_hours_value else 1, 1),
        "status": status,
        "riskFlags": risk_flags,
        "programStatus": program_status or "--",
    }


def _format_timestamp(value) -> dict[str, str | None]:
    if not value:
        return {
            "createdAt": None,
            "dateLabel": "--",
            "timeLabel": "--",
        }
    if timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_current_timezone())
    localized = timezone.localtime(value)
    return {
        "createdAt": localized.isoformat(),
        "dateLabel": localized.strftime("%d %b %Y"),
        "timeLabel": localized.strftime("%H:%M"),
    }


def _fetch_latest_conversation_summaries(learner_ids: list[int]) -> dict[int, dict]:
    if not learner_ids:
        return {}

    query = """
        select
            c.id,
            c.learner_id,
            c.coach_id,
            c.created_at,
            c.updated_at,
            last_msg.body,
            last_msg.created_at,
            last_msg.sender_type,
            coalesce(unread.unread_count, 0) as unread_count
        from chat.conversations c
        left join lateral (
            select m.body, m.created_at, m.sender_type
            from chat.messages m
            where m.conversation_id = c.id
              and coalesce(m.is_deleted, false) = false
            order by m.created_at desc, m.id desc
            limit 1
        ) last_msg on true
        left join lateral (
            select count(*)::int as unread_count
            from chat.message_receipts r
            join chat.messages msg on msg.id = r.message_id
            where msg.conversation_id = c.id
              and coalesce(msg.is_deleted, false) = false
              and r.recipient_type = 'coach'
              and r.read_at is null
        ) unread on true
        where c.learner_id = any(%s)
        order by c.updated_at desc nulls last, c.id desc
    """
    db_alias = get_learner_db_alias()
    summaries: dict[int, dict] = {}
    with connections[db_alias].cursor() as cursor:
        cursor.execute(query, [learner_ids])
        for (
            conversation_id,
            learner_id,
            coach_id,
            created_at,
            updated_at,
            last_body,
            last_created_at,
            last_sender_type,
            unread_count,
        ) in cursor.fetchall():
            if learner_id in summaries:
                continue
            summaries[int(learner_id)] = {
                "conversationId": str(conversation_id),
                "chatCoachId": clean_text(coach_id),
                "createdAt": created_at,
                "updatedAt": updated_at,
                "lastMessage": clean_text(last_body),
                "lastMessageAt": last_created_at,
                "lastSenderType": clean_text(last_sender_type).lower(),
                "unreadCount": int(unread_count or 0),
            }
    return summaries


def _fetch_latest_conversation_for_learner(learner_id: int) -> dict | None:
    query = """
        select id, coach_id, created_at, updated_at
        from chat.conversations
        where learner_id = %s
        order by updated_at desc nulls last, id desc
        limit 1
    """
    db_alias = get_learner_db_alias()
    with connections[db_alias].cursor() as cursor:
        cursor.execute(query, [learner_id])
        row = cursor.fetchone()
    if not row:
        return None
    return {
        "conversationId": int(row[0]),
        "chatCoachId": clean_text(row[1]),
        "createdAt": row[2],
        "updatedAt": row[3],
    }


def _resolve_chat_coach_id(owner_email: str, learner_id: int | None = None) -> str:
    normalized_owner = normalize_email(owner_email)
    if not normalized_owner:
        raise ValueError("Coach email is required.")

    db_alias = get_learner_db_alias()
    query = """
        select id
        from curriculum.coaches
        where lower(trim(email)) = %s
        order by updated_at desc nulls last, created_at desc nulls last, id desc
        limit 1
    """
    with connections[db_alias].cursor() as cursor:
        cursor.execute(query, [normalized_owner])
        row = cursor.fetchone()
    if row and clean_text(row[0]):
        return clean_text(row[0])

    if learner_id is not None:
        existing = _fetch_latest_conversation_for_learner(int(learner_id))
        if existing and clean_text(existing.get("chatCoachId")):
            return clean_text(existing["chatCoachId"])

    raise ValueError(f"Unable to resolve a chat coach profile for {owner_email}.")


def _serialize_thread(row: LearnerProfile, summary: dict | None) -> dict:
    snapshot = _thread_snapshot_for_learner(row)
    summary = summary or {}
    last_message = summary.get("lastMessage") or ""
    last_timestamp = _format_timestamp(summary.get("lastMessageAt"))
    last_sender_type = clean_text(summary.get("lastSenderType")).lower()
    unread_count = int(summary.get("unreadCount") or 0)
    snapshot.update(
        {
            "conversationId": summary.get("conversationId"),
            "hasConversation": bool(summary.get("conversationId")),
            "chatCoachId": summary.get("chatCoachId") or "",
            "lastMessage": last_message,
            "lastMessageAt": last_timestamp["createdAt"],
            "lastMessageDateLabel": last_timestamp["dateLabel"],
            "lastMessageTimeLabel": last_timestamp["timeLabel"],
            "lastSenderType": last_sender_type or None,
            "unreadCount": unread_count,
            "needsReply": bool(last_sender_type == "learner" and unread_count > 0),
        }
    )
    return snapshot


def _mark_conversation_read(conversation_id: int) -> None:
    db_alias = get_learner_db_alias()
    query = """
        update chat.message_receipts r
        set delivered_at = coalesce(r.delivered_at, now()),
            read_at = coalesce(r.read_at, now())
        from chat.messages m
        where r.message_id = m.id
          and m.conversation_id = %s
          and coalesce(m.is_deleted, false) = false
          and r.recipient_type = 'coach'
          and r.read_at is null
    """
    with connections[db_alias].cursor() as cursor:
        cursor.execute(query, [conversation_id])


def _fetch_conversation_messages(conversation_id: int, learner_id: int) -> list[dict]:
    db_alias = get_learner_db_alias()
    query = """
        select
            m.id,
            m.sender_type,
            m.body,
            m.created_at,
            m.edited_at,
            coalesce(m.is_deleted, false),
            receipt.delivered_at,
            receipt.read_at
        from chat.messages m
        left join lateral (
            select r.delivered_at, r.read_at
            from chat.message_receipts r
            where r.message_id = m.id
              and r.recipient_type = 'learner'
              and r.recipient_learner_id = %s
            order by r.id desc
            limit 1
        ) receipt on true
        where m.conversation_id = %s
        order by m.created_at asc, m.id asc
    """
    with connections[db_alias].cursor() as cursor:
        cursor.execute(query, [learner_id, conversation_id])
        rows = cursor.fetchall()

    messages: list[dict] = []
    for message_id, sender_type, body, created_at, edited_at, is_deleted, delivered_at, read_at in rows:
        timestamp = _format_timestamp(created_at)
        status = "sent"
        if clean_text(sender_type).lower() == "coach":
            if read_at:
                status = "read"
            elif delivered_at:
                status = "delivered"
        messages.append(
            {
                "id": str(message_id),
                "from": "me" if clean_text(sender_type).lower() == "coach" else "them",
                "body": "Message deleted." if is_deleted else clean_text(body),
                "createdAt": timestamp["createdAt"],
                "dateLabel": timestamp["dateLabel"],
                "timeLabel": timestamp["timeLabel"],
                "editedAt": _format_timestamp(edited_at)["createdAt"] if edited_at else None,
                "isDeleted": bool(is_deleted),
                "status": status,
            }
        )
    return messages


def _create_or_get_conversation(learner_id: int, coach_id: str) -> int:
    existing = _fetch_latest_conversation_for_learner(learner_id)
    db_alias = get_learner_db_alias()
    with connections[db_alias].cursor() as cursor:
        if existing:
            cursor.execute(
                """
                update chat.conversations
                set coach_id = %s
                where id = %s
                """,
                [coach_id, existing["conversationId"]],
            )
            return int(existing["conversationId"])
        cursor.execute(
            """
            insert into chat.conversations (coach_id, learner_id, created_at, updated_at)
            values (%s, %s, now(), now())
            returning id
            """,
            [coach_id, learner_id],
        )
        return int(cursor.fetchone()[0])


def _insert_coach_message(conversation_id: int, learner_id: int, coach_id: str, body: str) -> dict:
    db_alias = get_learner_db_alias()
    with connections[db_alias].cursor() as cursor:
        cursor.execute(
            """
            insert into chat.messages (
                conversation_id,
                sender_type,
                sender_coach_id,
                sender_learner_id,
                body,
                created_at,
                edited_at,
                is_deleted
            )
            values (%s, 'coach', %s, null, %s, now(), null, false)
            returning id, created_at
            """,
            [conversation_id, coach_id, body],
        )
        message_id, created_at = cursor.fetchone()
        cursor.execute(
            """
            insert into chat.message_receipts (
                message_id,
                recipient_type,
                recipient_coach_id,
                recipient_learner_id,
                delivered_at,
                read_at
            )
            values (%s, 'learner', null, %s, now(), null)
            """,
            [message_id, learner_id],
        )
        cursor.execute(
            """
            update chat.conversations
            set coach_id = %s,
                updated_at = %s
            where id = %s
            """,
            [coach_id, created_at, conversation_id],
        )

    timestamp = _format_timestamp(created_at)
    return {
        "id": str(message_id),
        "from": "me",
        "body": body,
        "createdAt": timestamp["createdAt"],
        "dateLabel": timestamp["dateLabel"],
        "timeLabel": timestamp["timeLabel"],
        "editedAt": None,
        "isDeleted": False,
        "status": "delivered",
    }


def _broadcast_coach_message(conversation_id: int, message: dict, coach_id: str) -> None:
    """Notify an open learner chat when the coach endpoint sends a message."""

    channel_layer = get_channel_layer()
    if channel_layer is None or not message.get("createdAt"):
        return

    try:
        async_to_sync(channel_layer.group_send)(
            f"chat.conversation.{int(conversation_id)}",
            {
                "type": "chat.new_message",
                "message": {
                    "id": int(message["id"]),
                    "conversation": int(conversation_id),
                    "sender": {"type": "coach", "id": str(coach_id)},
                    "body": message["body"],
                    "created_at": message["createdAt"],
                    "edited_at": None,
                    "is_deleted": False,
                },
            },
        )
    except Exception:
        logger.exception("Unable to broadcast coach chat message %s", message.get("id"))


def _resolve_owner_name(rows: list[LearnerProfile]) -> str:
    return next((clean_text(row.coach_name) for row in rows if clean_text(row.coach_name)), "Med Maher")


def _find_owner_learner(owner_email: str, learner_id: int) -> LearnerProfile | None:
    for row in _fetch_owner_message_learners(owner_email):
        if int(row.id) == int(learner_id):
            return row
    return None


@require_GET
def coach_messages_threads(request):
    owner_email = _owner_email_from_request(request)
    try:
        rows = _fetch_owner_message_learners(owner_email)
        learner_ids = [int(row.id) for row in rows]
        summaries = _fetch_latest_conversation_summaries(learner_ids)
        threads = [_serialize_thread(row, summaries.get(int(row.id))) for row in rows]
    except Exception as exc:
        return JsonResponse(
            {"detail": "Unable to load coach messages.", "error": str(exc)},
            status=500,
        )

    threads.sort(
        key=lambda item: (
            item.get("lastMessageAt") or "",
            item.get("learnerName") or "",
        ),
        reverse=True,
    )
    return JsonResponse(
        {
            "owner": {"name": _resolve_owner_name(rows), "email": owner_email},
            "threads": threads,
        }
    )


@csrf_exempt
def coach_message_thread(request, learner_id: int):
    owner_email = _owner_email_from_request(request)
    learner = _find_owner_learner(owner_email, learner_id)
    if learner is None:
        return JsonResponse({"detail": "Learner not found in this coach caseload."}, status=404)

    if request.method == "GET":
        try:
            summary = _fetch_latest_conversation_summaries([int(learner_id)]).get(int(learner_id))
            thread = _serialize_thread(learner, summary)
            if summary and summary.get("conversationId"):
                _mark_conversation_read(int(summary["conversationId"]))
                thread["unreadCount"] = 0
                thread["needsReply"] = False
                messages = _fetch_conversation_messages(int(summary["conversationId"]), int(learner_id))
            else:
                messages = []
        except Exception as exc:
            return JsonResponse(
                {"detail": "Unable to load the conversation.", "error": str(exc)},
                status=500,
            )

        return JsonResponse(
            {
                "owner": {"name": _resolve_owner_name([learner]), "email": owner_email},
                "thread": thread,
                "messages": messages,
            }
        )

    if request.method == "POST":
        try:
            payload = parse_json_body(request)
        except ValueError as exc:
            return JsonResponse({"detail": str(exc)}, status=400)

        body = clean_text(payload.get("body"))
        if not body:
            return JsonResponse({"detail": "Message body is required."}, status=400)

        try:
            coach_id = _resolve_chat_coach_id(owner_email, int(learner_id))
            conversation_id = _create_or_get_conversation(int(learner_id), coach_id)
            message = _insert_coach_message(conversation_id, int(learner_id), coach_id, body)
            _broadcast_coach_message(conversation_id, message, coach_id)
            summary = _fetch_latest_conversation_summaries([int(learner_id)]).get(int(learner_id))
            thread = _serialize_thread(learner, summary)
        except Exception as exc:
            return JsonResponse(
                {"detail": "Unable to send the message.", "error": str(exc)},
                status=500,
            )

        return JsonResponse(
            {
                "owner": {"name": _resolve_owner_name([learner]), "email": owner_email},
                "thread": thread,
                "message": message,
            }
        )

    return JsonResponse({"detail": "Method not allowed."}, status=405)
