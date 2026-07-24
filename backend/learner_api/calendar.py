"""Learner-facing calendar: coaching sessions from "Coach".coach_calendar_event.

    GET /learner_api/calendar/<kind>/<int:pk>/

`kind` is 'commercial' or 'apprenticeship' (same vocabulary as learner-detail).
The coach timetable stores events keyed by the "Learner"."Active_users" mirror
id + email, so the learner is matched by email: directly against
coach_calendar_event.learner_email, and via any Active_users mirror rows with
the same email against coach_calendar_event.learner_id.
"""
import json
import logging

from django.db import DatabaseError
from django.db.models import Max, Q
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from coach_api.models import CoachCalendarEvent

from .learner_detail import SOURCE_MODELS
from .mappers import _s
from .models import ActiveUser

logger = logging.getLogger(__name__)

EVENT_TITLES = {
    "mcr": "Monthly Coaching",
    "progress-review": "Progress Review",
    "catch-up": "Catch-up Session",
    "student-support": "Student Support",
}

# JSON `type` vocabulary shared with the coach timetable frontend.
EVENT_JSON_TYPES = {
    "mcr": "coaching",
    "progress-review": "review",
    "catch-up": "coaching",
    "student-support": "welfare",
}

BOOKABLE_TYPES = ("catch-up", "student-support")


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _serialize_event(record):
    """Shape one coach_calendar_event row for the learner calendar page.

    Mirrors the field names the coach timetable JSON uses (scheduledDate,
    scheduledTime, durationMinutes, ...) so the two calendars stay in sync.
    """
    event_type = _s(record.event_type) or "mcr"
    display_date = record.scheduled_date or record.target_date
    meeting_link = _s(record.meeting_link) or _s(record.graph_web_link)
    return {
        "id": record.event_key,
        "eventKey": record.event_key,
        "title": EVENT_TITLES.get(event_type, "Coaching Session"),
        "source": event_type,
        "type": EVENT_JSON_TYPES.get(event_type, "coaching"),
        "sequence": record.sequence,
        "status": record.status,
        "date": display_date.isoformat() if display_date else None,
        "targetDate": record.target_date.isoformat() if record.target_date else None,
        "scheduledDate": record.scheduled_date.isoformat() if record.scheduled_date else None,
        "scheduledTime": record.scheduled_time.strftime("%H:%M") if record.scheduled_time else None,
        "durationMinutes": record.duration_minutes or 60,
        "coachName": _s(record.owner_name),
        "coachEmail": _s(record.owner_email),
        "meetingProvider": _s(record.meeting_provider),
        "meetingLink": meeting_link,
        "notes": _s(record.notes),
        "reviewResponses": record.review_responses if isinstance(record.review_responses, dict) else {},
        "reviewCompletedAt": record.review_completed_at.isoformat() if record.review_completed_at else None,
    }


def learner_calendar(request, kind, pk):
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        learner = model.objects.filter(pk=pk).first()
    except DatabaseError as exc:
        logger.exception("learner_calendar: learner lookup failed")
        return _error(f"Database error: {exc}", 502)
    if learner is None:
        return _error("Learner not found.", 404)

    try:
        # The Active_users mirror carries the source row's id (see
        # active_users.sync_active_user), and coach events store that mirror's
        # id + email — so the mirror email is the authoritative one here.
        mirror = ActiveUser.objects.filter(id=pk).first()
    except DatabaseError as exc:
        logger.exception("learner_calendar: mirror lookup failed")
        return _error(f"Database error: {exc}", 502)

    mirror_email = _s(mirror.email) if mirror else ""
    source_email = _s(learner.email)
    email = mirror_email or source_email

    match = Q()
    if mirror is not None:
        match |= Q(learner_id=pk)
    for candidate in {mirror_email, source_email} - {""}:
        match |= Q(learner_email__iexact=candidate)
    if not match:
        return JsonResponse({"learner": {"kind": kind, "id": pk}, "events": []})

    try:
        records = CoachCalendarEvent.objects.filter(match).order_by(
            "target_date", "event_type", "sequence"
        )
        events = [_serialize_event(record) for record in records]
    except DatabaseError as exc:
        logger.exception("learner_calendar: event lookup failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse(
        {
            "learner": {"kind": kind, "id": pk, "email": email},
            "events": events,
        }
    )


@csrf_exempt
def learner_calendar_book(request, kind, pk):
    """Book a session with the learner's assigned coach.

        POST /learner_api/calendar/<kind>/<pk>/book/
        {"sessionType": "catch-up" | "student-support",
         "scheduledDate": "YYYY-MM-DD", "scheduledTime": "HH:MM",
         "durationMinutes": 60, "notes": "..."}

    Mirrors coach_api.views.coach_timetable_schedule_event: same
    coach_calendar_event row shape, same event-key format, same Microsoft
    Graph Teams sync (meeting created on the coach's calendar, learner as
    attendee). The coach comes from the Active_users mirror's coach_email.
    """
    # Imported here (not module level) to keep the heavyweight coach views
    # module out of learner_api's import path until a booking actually happens.
    from coach_api.views import (
        build_booked_calendar_event,
        build_timetable_event_key,
        normalize_duration_minutes,
        parse_date_value,
        parse_time_value,
        sync_calendar_event_to_graph,
    )
    from datetime import datetime

    if request.method != "POST":
        return _error("Method not allowed.", 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        learner = model.objects.filter(pk=pk).first()
        mirror = ActiveUser.objects.filter(id=pk).first()
    except DatabaseError as exc:
        logger.exception("learner_calendar_book: learner lookup failed")
        return _error(f"Database error: {exc}", 502)
    if learner is None:
        return _error("Learner not found.", 404)
    if mirror is None:
        return _error("Only Active learners can book coach sessions.", 400)

    coach_email = _s(mirror.coach_email)
    coach_name = _s(mirror.coach_name) or "Coach"
    if not coach_email:
        return _error("No coach has been assigned to you yet. Please contact your programme team.", 400)

    try:
        payload = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return _error("Invalid JSON body.", 400)

    session_type = _s(payload.get("sessionType"))
    if session_type not in BOOKABLE_TYPES:
        return _error("sessionType must be 'catch-up' or 'student-support'.", 400)

    try:
        scheduled_date = parse_date_value(payload.get("scheduledDate"))
        scheduled_time = parse_time_value(payload.get("scheduledTime"))
        duration_minutes = normalize_duration_minutes(payload.get("durationMinutes") or 60)
    except ValueError as exc:
        return _error(str(exc), 400)
    if isinstance(scheduled_date, datetime):
        scheduled_date = scheduled_date.date()
    if not scheduled_date:
        return _error("scheduledDate is required.", 400)
    if not scheduled_time:
        return _error("scheduledTime is required.", 400)

    notes = _s(payload.get("notes"))[:500]
    learner_name = _s(mirror.username) or _s(learner.username)
    learner_email = _s(mirror.email) or _s(learner.email)

    try:
        next_sequence = (
            CoachCalendarEvent.objects.filter(learner_id=pk, event_type=session_type)
            .aggregate(max_seq=Max("sequence"))["max_seq"]
            or 0
        ) + 1
        record = CoachCalendarEvent(
            event_key=build_timetable_event_key(pk, session_type, next_sequence, scheduled_date),
            owner_email=coach_email,
            owner_name=coach_name,
            learner_id=pk,
            learner_name=learner_name,
            learner_email=learner_email,
            event_type=session_type,
            sequence=next_sequence,
            target_date=scheduled_date,
            scheduled_date=scheduled_date,
            scheduled_time=scheduled_time,
            duration_minutes=duration_minutes,
            status=CoachCalendarEvent.STATUS_SCHEDULED,
            notes=notes,
        )
        warning = sync_calendar_event_to_graph(record, build_booked_calendar_event(record))
        record.last_graph_sync_error = warning
        record.save()
    except DatabaseError as exc:
        logger.exception("learner_calendar_book: booking failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({"event": _serialize_event(record), "warning": warning}, status=201)
