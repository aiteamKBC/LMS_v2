"""Every learner's first-session booking, for the enrolment workspace.

    GET /learner_api/first-session-bookings/

    -> {count, results: [{id, learnerId, source, learnerName, learnerEmail, programme,
        caseOwner: {name, email}, bookedAt, bookedDate, sessionDate,
        sessionTime, durationMinutes, meetingLink, state, status, syncState}]}

Read only. The source is "Learner".coach_calendar_event (``event_type =
'first-session'``), not the ``First_session_booked*`` columns on
enrolment."Created_users": the learner now books the session from their own
calendar (calendar.learner_calendar_book), and that path never writes those
columns -- only the older enrolment-form booking did. The calendar row exists
whichever route made the booking, and it owns the meeting and its join link.

Every row is returned -- past, cancelled and failed-to-sync bookings included --
so ``state`` says which one it is rather than the list hiding it. A booking
Microsoft never accepted has no join link, and it is reported that way, not as
a working meeting.

Each booking is its own row (reserve_coach_calendar_booking creates a new one
per booking), so ``created_at`` is when it was booked; a reschedule moves the
session on the same row and leaves that time alone.
"""
from __future__ import annotations

import logging

from django.db import DatabaseError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from coach_api.models import CoachCalendarEvent
from login.permissions import require_access

from .constants import ACCESS_ENROLMENT
from .first_session import SESSION_TYPE, UK
from .models import EnrolmentUser, LearnerProfile

logger = logging.getLogger(__name__)


def _text(value):
    return str(value or "").strip()


def _email(value):
    return _text(value).casefold()


def booking_state(record) -> str:
    """One word for where this booking stands.

    Cancelled wins over everything: a cancelled row can still carry a join link
    and a synced flag from before it was cancelled. A completed session is past
    caring about sync. Otherwise a sync that did not finish is what matters --
    local save is not proof that Microsoft accepted the meeting.
    """
    status = _text(record.status).lower()
    sync = _text(record.sync_state).lower()
    if status == CoachCalendarEvent.STATUS_CANCELLED or sync == CoachCalendarEvent.SYNC_CANCELLED:
        return "cancelled"
    if status == CoachCalendarEvent.STATUS_COMPLETED:
        return "completed"
    if sync == CoachCalendarEvent.SYNC_FAILED:
        return "sync-failed"
    if sync == CoachCalendarEvent.SYNC_RECONCILIATION:
        return "needs-reconciliation"
    if sync in (CoachCalendarEvent.SYNC_PENDING, CoachCalendarEvent.SYNC_SYNCING):
        return "sync-pending"
    if status == CoachCalendarEvent.STATUS_NOT_SCHEDULED:
        # Booked as a request the case owner still has to approve.
        return "requested"
    return status or "scheduled"


def resolve_learners(records):
    """Resolve calendar profile IDs through their canonical enrolment link only."""
    ids = {r.learner_profile_id for r in records if r.learner_profile_id}
    profiles = {
        p.id: p for p in LearnerProfile.objects.filter(id__in=ids).only('id', 'enrolment_id')
    }
    enrolment_ids = {p.enrolment_id for p in profiles.values() if p.enrolment_id}
    fields = ('id', 'username', 'email', 'programme_id', 'case_owner', 'learner_type')
    learners = {u.id: u for u in EnrolmentUser.all_learners.filter(id__in=enrolment_ids).only(*fields)}
    return {
        record.pk: learners.get(profiles[record.learner_profile_id].enrolment_id)
        if record.learner_profile_id in profiles else None
        for record in records
    }


def serialize_booking(record, learner):
    created = record.created_at
    return {
        "id": record.pk,
        # The enrolment id, so the row can open the learner's board. Null when
        # the calendar row could not be tied to an enrolment record.
        "learnerId": learner.id if learner is not None else None,
        # Which board opens it -- the same rule as the Users directory row.
        "source": (
            ("commercial" if _text(learner.learner_type) == "commercial" else "apprenticeship")
            if learner is not None else None
        ),
        "learnerName": _text(learner.username if learner is not None else "") or _text(record.learner_name),
        "learnerEmail": _text(learner.email if learner is not None else "") or _text(record.learner_email),
        "programme": _text(learner.programme) if learner is not None else "",
        # The meeting owner comes from owner_coach_id, never the current case owner.
        "caseOwner": {
            "name": _text(record.owner_name),
            "email": _text(record.owner_email),
        },
        "bookedAt": created.isoformat() if created else None,
        # The UK day it was booked on, so filtering by day does not depend on
        # the browser's time zone.
        "bookedDate": timezone.localtime(created, UK).date().isoformat() if created else None,
        # UK wall clock, as the booking was made.
        "sessionDate": record.scheduled_date.isoformat() if record.scheduled_date else None,
        "sessionTime": record.scheduled_time.strftime("%H:%M") if record.scheduled_time else None,
        "durationMinutes": record.duration_minutes,
        "meetingLink": _text(record.meeting_link),
        "state": booking_state(record),
        "status": _text(record.status),
        "syncState": _text(record.sync_state),
    }


@csrf_exempt
@require_access(ACCESS_ENROLMENT)
def first_session_bookings(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        records = list(
            CoachCalendarEvent.objects.filter(event_type=SESSION_TYPE)
            .order_by("-created_at", "-pk")
        )
        learners = resolve_learners(records)
    except DatabaseError:
        logger.exception("first_session_bookings: lookup failed")
        return JsonResponse({"error": "First-session bookings could not be loaded. Please try again."}, status=502)
    rows = [serialize_booking(record, learners.get(record.pk)) for record in records]
    return JsonResponse({"count": len(rows), "results": rows})
