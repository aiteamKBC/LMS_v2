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
import hashlib

from django.db import DatabaseError
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from coach_api.models import CoachCalendarEvent

from .learner_detail import SOURCE_MODELS
from .identity import learner_profile_for_source
from .mappers import _s
from .models import EnrolmentReview, LearnerProfile, StaffUser
from login.permissions import learner_self_or_staff

logger = logging.getLogger(__name__)

EVENT_TITLES = {
    "mcr": "Monthly Coaching",
    "progress-review": "Progress Review",
    "catch-up": "Catch-up Session",
    "student-support": "Student Support",
    # Onboarding reviews (see ONBOARDING_REVIEW_LABELS below).
    "eligibility-review": "Eligibility Review & FS Discussion",
    "workspace": "RPL And Experience",
    "training-plan": "Workplace Health & Safety Declaration",
}

# JSON `type` vocabulary shared with the coach timetable frontend.
EVENT_JSON_TYPES = {
    "mcr": "coaching",
    "progress-review": "review",
    "catch-up": "coaching",
    "student-support": "welfare",
    "eligibility-review": "review",
    "workspace": "review",
    "training-plan": "review",
}

BOOKABLE_TYPES = ("catch-up", "student-support")

# The Microsoft Graph invite subject uses the same wording as the page — see
# coach_api.BOOKED_EVENT_TITLES, which mirrors EVENT_TITLES above.

# The three onboarding reviews a learner books straight after submitting their
# enrolment. Unlike catch-up/student-support these are bookable *while still
# Onboarding* — they are the meetings that get the learner enrolled, so requiring
# an Active mirror + assigned coach first would be circular. They are booked with
# the learner's case owner (the enrolment officer) instead.
ONBOARDING_REVIEW_TYPES = ("eligibility-review", "workspace", "training-plan")

# Same wording the calendar shows for these events.
ONBOARDING_REVIEW_LABELS = {type_: EVENT_TITLES[type_] for type_ in ONBOARDING_REVIEW_TYPES}

# Reviews that have a form to fill in after booking -- all three now do; the
# panels each one renders live in review_form.SECTIONS_BY_REVIEW.
REVIEW_FORM_TYPES = ONBOARDING_REVIEW_TYPES

# Only learner-booked sessions can be cancelled by the learner -- the generated
# mcr / progress-review events belong to the coach's schedule.
CANCELLABLE_TYPES = (*BOOKABLE_TYPES, *ONBOARDING_REVIEW_TYPES)


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _friendly_sync_warning(warning):
    """Turn a raw Microsoft Graph failure into something a learner can act on.

    The underlying strings are diagnostics ("getaddrinfo failed",
    "ErrorInvalidUser") and mean nothing to a learner, but the outcome always
    does: the slot is held, yet no invite reached anyone.
    """
    raw = _s(warning)
    if not raw:
        return ""
    lowered = raw.lower()
    if "getaddrinfo" in lowered or "urlopen error" in lowered or "not configured" in lowered:
        detail = "the booking system could not reach Microsoft"
    elif "errorinvaliduser" in lowered or "invalid" in lowered and "user" in lowered:
        detail = "your enrolment officer's mailbox is not set up for calendar invites"
    else:
        detail = "Microsoft rejected the calendar invite"
    return (
        f"Your slot is saved, but no calendar invite or email was sent because {detail}. "
        "Please let your programme team know so they can confirm this booking."
    )


def _case_owner_contact(learner):
    """(email, name) of the learner's case owner, for onboarding review bookings.

    Case_owner stores the staff member's *name*, so the email is resolved from
    enrolment."Staff_users". Returns ('', '') when unset or unresolvable — the
    caller turns that into a clear "no case owner assigned yet" message.
    """
    email, name, _staff_id = _case_owner_record(learner)
    return email, name


def _case_owner_record(learner):
    """(email, name, staff_id) of the case owner — staff_id for Enrolment_Reviews."""
    owner_name = _s(getattr(learner, "case_owner", ""))
    if not owner_name:
        return "", "", None
    try:
        staff = (
            StaffUser.objects.filter(username__iexact=owner_name)
            .exclude(email__isnull=True)
            .exclude(email="")
            .first()
        )
    except DatabaseError:
        logger.exception("_case_owner_contact: staff lookup failed")
        return "", owner_name, None
    if staff is None:
        return "", owner_name, None
    return _s(staff.email), _s(staff.username) or owner_name, staff.pk


def _record_enrolment_review(record, *, kind, learner_kind_id, coach_id):
    """Mirror a booked review into enrolment."Enrolment_Reviews".

    Best-effort: the coach_calendar_event row is the operational source of truth
    for the calendar, so a failure here is logged but never fails the booking —
    the learner has a real meeting either way.

    Keyed on Event_key so re-booking the same slot updates rather than duplicates.
    """
    if _s(record.event_type) not in ONBOARDING_REVIEW_TYPES:
        return
    try:
        EnrolmentReview.objects.update_or_create(
            event_key=record.event_key,
            defaults={
                "review_type": _s(record.event_type),
                "review_label": ONBOARDING_REVIEW_LABELS.get(_s(record.event_type), ""),
                "learner_kind": kind,
                "learner_id": learner_kind_id,
                "learner_name": _s(record.learner_name),
                "learner_email": _s(record.learner_email),
                "coach_id": coach_id,
                "coach_name": _s(record.owner_name),
                "coach_email": _s(record.owner_email),
                "scheduled_date": record.scheduled_date,
                "scheduled_time": record.scheduled_time,
                "duration_minutes": record.duration_minutes or 60,
                "status": EnrolmentReview.STATUS_BOOKED,
                "notes": _s(record.notes),
                "meeting_provider": _s(record.meeting_provider),
                "meeting_link": _s(record.meeting_link) or _s(record.graph_web_link),
                "graph_event_id": _s(record.graph_event_id),
                "invite_sent": bool(_s(record.graph_event_id)),
                "sync_error": _s(record.last_graph_sync_error),
                "booked_at": timezone.now(),
                "cancelled_at": None,
            },
        )
    except DatabaseError:
        logger.exception(
            "_record_enrolment_review: could not save %s to Enrolment_Reviews", record.event_key
        )


def _cancel_enrolment_review(record):
    """Mark the Enrolment_Reviews row cancelled. Best-effort, as above."""
    if _s(record.event_type) not in ONBOARDING_REVIEW_TYPES:
        return
    try:
        EnrolmentReview.objects.filter(event_key=record.event_key).update(
            status=EnrolmentReview.STATUS_CANCELLED,
            cancelled_at=timezone.now(),
            updated_at=timezone.now(),
            meeting_provider="",
            meeting_link="",
            graph_event_id="",
            invite_sent=False,
        )
    except DatabaseError:
        logger.exception(
            "_cancel_enrolment_review: could not update %s in Enrolment_Reviews", record.event_key
        )


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
        # A row can save while the Graph sync fails (no network, non-tenant
        # mailbox, ...). Without this the UI shows a confident "Booked" for a
        # meeting that reached nobody's calendar or inbox.
        "invited": bool(_s(record.graph_event_id)),
        "syncError": _s(record.last_graph_sync_error),
    }


def _serialize_live_session_event(event):
    """Convert the coach curriculum event shape to the learner calendar shape."""
    scheduled_time = None
    start_hour = event.get("startHour")
    if isinstance(start_hour, (int, float)):
        hour = int(start_hour)
        minute = round((start_hour - hour) * 60)
        scheduled_time = f"{hour:02d}:{minute:02d}"
    return {
        "id": event.get("id"),
        "eventKey": event.get("eventKey") or event.get("id"),
        "title": event.get("title") or "Live Session",
        "source": "live-session",
        "type": "live-session",
        "sequence": event.get("sequence"),
        "status": event.get("status") or "scheduled",
        "date": event.get("date"),
        "targetDate": event.get("targetDate") or event.get("date"),
        "scheduledDate": event.get("date"),
        "scheduledTime": scheduled_time,
        "durationMinutes": event.get("durationMinutes") or 60,
        "coachName": event.get("tutor") or event.get("ownerName") or "",
        "coachEmail": event.get("ownerEmail") or "",
        "meetingProvider": event.get("meetingProvider") or "",
        "meetingLink": event.get("meetingLink") or event.get("graphWebLink") or "",
        "notes": event.get("notes") or "",
        "programme": event.get("programme") or "",
        "cohort": event.get("cohort") or "",
        "group": event.get("group") or "",
        "module": event.get("module") or "",
    }


def _same_calendar_identity(left, right):
    return _s(left).strip().casefold() == _s(right).strip().casefold()


def learner_calendar(request, kind, pk):
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        # all_learners: the default manager is scoped to apprenticeship rows.
        learner = model.all_learners.filter(pk=pk).first()
    except DatabaseError as exc:
        logger.exception("learner_calendar: learner lookup failed")
        return _error(f"Database error: {exc}", 502)
    if learner is None:
        return _error("Learner not found.", 404)

    try:
        # The Active_users mirror carries the source row's id (see
        # active_users.sync_active_user), and coach events store that mirror's
        # id + email — so the mirror email is the authoritative one here.
        mirror = learner_profile_for_source(learner, pk, active_only=True)
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

        # Live curriculum sessions are generated from the same module/week
        # schedule used by the coach calendar. Restrict them to this learner's
        # assigned programme/cohort/group.
        if mirror is not None and _s(mirror.coach_email):
            from coach_api.views import collect_live_session_events

            live_events = collect_live_session_events(
                _s(mirror.coach_email),
                _s(mirror.coach_name) or "Coach",
            )
            for event in live_events:
                if not _same_calendar_identity(event.get("group"), mirror.group_name):
                    continue
                if _s(mirror.cohort) and not _same_calendar_identity(event.get("cohort"), mirror.cohort):
                    continue
                if _s(mirror.programme) and not _same_calendar_identity(event.get("programme"), mirror.programme):
                    continue
                events.append(_serialize_live_session_event(event))

        # A curriculum event can be reachable through more than one legacy
        # source. Keep one stable calendar item per event key.
        events = list({
            event.get("eventKey") or event.get("id"): event
            for event in events
            if event.get("eventKey") or event.get("id")
        }.values())
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
# The one write a staff viewer keeps on a learner's page: arranging a coaching
# session is administration, not a claim about the learner's own work.
@learner_self_or_staff(kwarg="pk")
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
        booking_request_matches_record,
        calendar_idempotency_key,
        normalize_duration_minutes,
        parse_date_value,
        parse_time_value,
        reserve_coach_calendar_booking,
        synchronize_reserved_calendar_event,
    )
    from datetime import datetime

    if request.method != "POST":
        return _error("Method not allowed.", 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        # all_learners: the default manager is scoped to apprenticeship rows.
        learner = model.all_learners.filter(pk=pk).first()
        mirror = learner_profile_for_source(learner, pk, active_only=True)
    except DatabaseError as exc:
        logger.exception("learner_calendar_book: learner lookup failed")
        return _error(f"Database error: {exc}", 502)
    if learner is None:
        return _error("Learner not found.", 404)

    try:
        payload = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return _error("Invalid JSON body.", 400)

    session_type = _s(payload.get("sessionType"))
    is_onboarding_review = session_type in ONBOARDING_REVIEW_TYPES
    if session_type not in BOOKABLE_TYPES and not is_onboarding_review:
        allowed = "', '".join((*BOOKABLE_TYPES, *ONBOARDING_REVIEW_TYPES))
        return _error(f"sessionType must be one of '{allowed}'.", 400)

    owner_staff_id = None
    if is_onboarding_review:
        # Booked during enrolment, before the learner is Active and before a
        # coach exists — so these go to the case owner (enrolment officer).
        owner_email, owner_name, owner_staff_id = _case_owner_record(learner)
        if not owner_email:
            return _error(
                "No case owner has been assigned to you yet. Please contact your programme team.", 400
            )
    else:
        if mirror is None:
            return _error("Only Active learners can book coach sessions.", 400)
        owner_email = _s(mirror.coach_email)
        owner_name = _s(mirror.coach_name) or "Coach"
        if not owner_email:
            return _error("No coach has been assigned to you yet. Please contact your programme team.", 400)

    try:
        scheduled_date = parse_date_value(payload.get("scheduledDate"))
        scheduled_time = parse_time_value(payload.get("scheduledTime"))
        duration_minutes = normalize_duration_minutes(payload.get("durationMinutes") or 60)
        timezone_offset_minutes = int(payload.get("timezoneOffsetMinutes") or 0)
        if not -840 <= timezone_offset_minutes <= 840:
            raise ValueError("timezoneOffsetMinutes is outside the supported range.")
    except ValueError as exc:
        return _error(str(exc), 400)
    if isinstance(scheduled_date, datetime):
        scheduled_date = scheduled_date.date()
    if not scheduled_date:
        return _error("scheduledDate is required.", 400)
    if not scheduled_time:
        return _error("scheduledTime is required.", 400)

    notes = _s(payload.get("notes"))[:500]
    # An onboarding learner has no mirror row yet, so fall back to the source.
    # (LearnerProfile's name column is full_name, not username.)
    learner_name = _s(getattr(mirror, "full_name", "")) or _s(learner.username)
    learner_email = _s(getattr(mirror, "email", "")) or _s(learner.email)

    try:
        if is_onboarding_review:
            # Each onboarding review is booked once. Without this, a double-click
            # or a retried POST creates a second calendar event and sends the case
            # owner a second invite for the same meeting. Returning the existing
            # booking makes the request idempotent instead.
            existing = (
                CoachCalendarEvent.objects.filter(learner_id=pk, event_type=session_type)
                .exclude(status=CoachCalendarEvent.STATUS_CANCELLED)
                .order_by("-sequence")
                .first()
            )
            if existing is not None:
                return JsonResponse(
                    {
                        "event": _serialize_event(existing),
                        "warning": _friendly_sync_warning(existing.last_graph_sync_error),
                        "alreadyBooked": True,
                    },
                    status=200,
                )

        supplied_key = _s(request.headers.get("Idempotency-Key"))
        if supplied_key:
            idempotency_key = calendar_idempotency_key(request)
        else:
            # Backward-compatible deterministic identity for existing learner
            # clients. Onboarding review identity intentionally ignores the
            # slot because each review type is a one-time logical operation.
            logical_parts = [kind, str(pk), session_type]
            if not is_onboarding_review:
                logical_parts.extend(
                    [
                        scheduled_date.isoformat(),
                        scheduled_time.isoformat(),
                        str(duration_minutes),
                        notes,
                    ]
                )
            digest = hashlib.sha256("\x1f".join(logical_parts).encode("utf-8")).hexdigest()
            idempotency_key = f"learner-book:{digest}"

        replay = CoachCalendarEvent.objects.filter(
            owner_email=owner_email.strip().lower(),
            idempotency_key=idempotency_key,
        ).first()
        if replay is not None:
            if not booking_request_matches_record(
                replay,
                learner_id=pk,
                session_type=session_type,
                scheduled_date=scheduled_date,
                scheduled_time=scheduled_time,
                duration_minutes=duration_minutes,
                notes=notes,
            ):
                return _error("Idempotency-Key was already used for a different booking.", 409)
            replay, warning, _attempted = synchronize_reserved_calendar_event(
                replay.pk, build_booked_calendar_event(replay)
            )
            return JsonResponse(
                {"event": _serialize_event(replay), "warning": _friendly_sync_warning(warning)},
                status=200,
            )

        from .calendar_connections import booking_conflicts
        if booking_conflicts(
            kind,
            pk,
            scheduled_date,
            scheduled_time,
            duration_minutes,
            timezone_offset_minutes,
        ):
            return _error(
                "That time overlaps an event in your connected personal calendar. Please choose another time.",
                409,
            )

        record, created = reserve_coach_calendar_booking(
            owner_email=owner_email,
            owner_name=owner_name,
            learner_id=pk,
            learner_name=learner_name,
            learner_email=learner_email,
            session_type=session_type,
            scheduled_date=scheduled_date,
            scheduled_time=scheduled_time,
            duration_minutes=duration_minutes,
            notes=notes,
            idempotency_key=idempotency_key,
        )
        record, warning, _attempted = synchronize_reserved_calendar_event(
            record.pk, build_booked_calendar_event(record)
        )
    except ValueError as exc:
        return _error(str(exc), 409 if "already used" in str(exc) else 400)
    except DatabaseError as exc:
        logger.exception("learner_calendar_book: booking failed")
        return _error(f"Database error: {exc}", 502)

    if warning:
        # Loud in the log: the learner thinks they have a meeting, and nobody
        # else has been told about it.
        logger.error(
            "learner_calendar_book: Graph sync failed for %s (owner=%s): %s",
            record.event_key, owner_email, warning,
        )

    _record_enrolment_review(record, kind=kind, learner_kind_id=pk, coach_id=owner_staff_id)

    return JsonResponse(
        {"event": _serialize_event(record), "warning": _friendly_sync_warning(warning)},
        status=201 if created else 200,
    )


@csrf_exempt
# Same reasoning as booking: staff who arranged a session can call it off.
@learner_self_or_staff(kwarg="pk")
def learner_calendar_cancel(request, kind, pk):
    """Cancel a session the learner booked.

        POST /learner_api/calendar/<kind>/<pk>/cancel/
        {"eventKey": "eligibility-review:31:1:2026-08-03"}

    Uses the same Microsoft Graph path as the coach's cancel action
    (coach_api.views.delete_calendar_event_from_graph): deleting the organizer's
    event makes Graph email a cancellation to the attendees -- the learner and,
    for onboarding reviews, the case owner.

    The row is kept and marked cancelled rather than deleted, so the booking
    history survives and learner_onboarding_reviews frees the slot for rebooking.
    """
    from coach_api.views import delete_calendar_event_from_graph

    if request.method != "POST":
        return _error("Method not allowed.", 405)

    if SOURCE_MODELS.get(kind) is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        payload = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return _error("Invalid JSON body.", 400)

    event_key = _s(payload.get("eventKey"))
    if not event_key:
        return _error("eventKey is required.", 400)

    try:
        # Scoped to this learner's own bookings so one learner cannot cancel
        # another's session by guessing an event key.
        record = CoachCalendarEvent.objects.filter(
            event_key=event_key, learner_id=pk, event_type__in=CANCELLABLE_TYPES
        ).first()
        if record is None:
            return _error("Booking not found.", 404)
        if record.status == CoachCalendarEvent.STATUS_CANCELLED:
            return JsonResponse({"event": _serialize_event(record), "warning": ""})

        warning = delete_calendar_event_from_graph(record)
        record.status = CoachCalendarEvent.STATUS_CANCELLED
        record.scheduled_date = None
        record.scheduled_time = None
        record.meeting_provider = ""
        record.meeting_link = ""
        record.graph_web_link = ""
        record.graph_event_id = ""
        record.last_graph_sync_error = warning
        record.save()
    except DatabaseError as exc:
        logger.exception("learner_calendar_cancel: cancel failed")
        return _error(f"Database error: {exc}", 502)

    _cancel_enrolment_review(record)

    return JsonResponse(
        {"event": _serialize_event(record), "warning": _friendly_sync_warning(warning)}
    )


def learner_onboarding_reviews(request, kind, pk):
    """The three onboarding reviews and whether each is booked.

        GET /learner_api/calendar/<kind>/<id>/onboarding-reviews/

    -> {caseOwner: {name, email} | null,
        reviews: [{type, label, booked, event}], allBooked: bool}

    Drives the learner's Reviews tab after they submit their enrolment: all
    three must be booked before enrolment can be finished.
    """
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        learner = model.all_learners.filter(pk=pk).first()
        if learner is None:
            return _error("Learner not found.", 404)
        booked = {
            record.event_type: record
            for record in CoachCalendarEvent.objects.filter(
                learner_id=pk, event_type__in=ONBOARDING_REVIEW_TYPES
            )
            .exclude(status=CoachCalendarEvent.STATUS_CANCELLED)
            .order_by("scheduled_date")
        }
    except DatabaseError as exc:
        logger.exception("learner_onboarding_reviews: lookup failed")
        return _error(f"Database error: {exc}", 502)

    # Form progress, so a booked review can offer Start / Continue / Completed
    # rather than just "Booked".
    try:
        form_state = {
            row.event_key: row
            for row in EnrolmentReview.objects.filter(
                learner_id=pk, review_type__in=ONBOARDING_REVIEW_TYPES
            )
        }
    except DatabaseError:
        logger.exception("learner_onboarding_reviews: form state lookup failed")
        form_state = {}

    owner_email, owner_name = _case_owner_contact(learner)
    reviews = []
    for type_ in ONBOARDING_REVIEW_TYPES:
        record = booked.get(type_)
        form_row = form_state.get(record.event_key) if record is not None else None
        reviews.append({
            "type": type_,
            "label": ONBOARDING_REVIEW_LABELS[type_],
            "booked": type_ in booked,
            "event": _serialize_event(record) if record is not None else None,
            # Only the eligibility review has a form built so far; the other two
            # stay "Booked" until theirs exist.
            "hasForm": type_ in REVIEW_FORM_TYPES,
            "formStarted": bool(form_row and form_row.started_at),
            "formCompleted": bool(form_row and form_row.form_completed),
            # Drives the Sign button next to View review.
            "learnerSigned": bool(form_row and _s(form_row.learner_signature)),
            "adminSigned": bool(form_row and _s(form_row.admin_signature)),
        })
    return JsonResponse({
        "caseOwner": {"name": owner_name, "email": owner_email} if owner_email else None,
        "reviews": reviews,
        "allBooked": all(r["booked"] for r in reviews),
    })
