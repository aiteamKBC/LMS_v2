"""Learner-facing calendar: coaching sessions from "Coach".coach_calendar_event.

    GET /learner_api/calendar/<kind>/<int:pk>/

`kind` is 'commercial' or 'apprenticeship' (same vocabulary as learner-detail).
The coach timetable stores events keyed by the "Learner"."Active_users" mirror
id + email, so the learner is matched by email: directly against
coach_calendar_event.learner_email, and via any Active_users mirror rows with
the same email against coach_calendar_event.learner_id.

Monthly coaching and progress reviews are *generated* from the learner's own
delivery window rather than stored: the coach timetable derives them every time
it loads (see coach_api.views.collect_generated_timetable), and a row only
exists once somebody schedules one. So a learner whose coach had not booked yet
saw an empty calendar while their coach saw a column of "Not Scheduled" slots.
This endpoint runs the same generator over the same window, then lays the stored
rows on top by event key — the coach's own join — so both calendars name the
same dates and the same statuses.
"""
import json
import logging
import hashlib
from datetime import datetime

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
from .booking_calendar import booking_calendar_payload, booking_date_restriction
from login.permissions import learner_self_or_staff

logger = logging.getLogger(__name__)

EVENT_TITLES = {
    "mcr": "Monthly Coaching",
    "progress-review": "Progress Review",
    # Any other Curriculum Review. Only a last resort: these events are titled
    # from their own review_templates.name.
    "review": "Review",
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
    "review": "review",
    "catch-up": "coaching",
    "student-support": "welfare",
    "eligibility-review": "review",
    "workspace": "review",
    "training-plan": "review",
}

# What a learner can book for themselves. Monthly coaching and progress reviews
# must be booked against a generated programme-cycle eventKey so the learner and
# coach see the same official calendar row.
# Curriculum Review occurrences. These are NOT booked from scratch: each one
# already exists as a generated occurrence on both calendars, and "booking" one
# only fills in the date/time of that same occurrence. `review` is the generic
# bucket every custom Review Type lands in (see
# coach_api.views.review_event_type_for_type_code), so a custom type schedules
# through exactly the same path as MCM and Progress Review -- no per-type
# scheduling code, and no second event.
REVIEW_CYCLE_TYPES = ("mcr", "progress-review", "review")

BOOKABLE_TYPES = ("catch-up", "student-support", *REVIEW_CYCLE_TYPES)

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
        defaults = {
            "review_type": _s(record.event_type),
            "review_label": ONBOARDING_REVIEW_LABELS.get(_s(record.event_type), ""),
            "learner_kind": kind,
            "learner_id": learner_kind_id,
            "learner_name": _s(record.learner_name),
            "learner_email": _s(record.learner_email),
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
        }
        if coach_id is not None:
            defaults["coach_id"] = coach_id
        EnrolmentReview.objects.update_or_create(
            event_key=record.event_key,
            defaults=defaults,
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


def _belongs_to_current_cycle(record, mirror):
    """Whether a stored row is part of *this* learner's coaching cycle.

    Rows are matched by email as well as by mirror id, because a learner's
    mirror is recreated on occasion and their bookings must survive it. That
    generosity has one bad case: a monthly-coaching or progress-review slot
    generated against a *previous* mirror stays behind when that mirror is
    deleted, and its dates came from a window the learner no longer has. The
    coach never sees those — their timetable only builds keys from live
    caseload profiles — so a learner shown them is reading dates their coach
    cannot see.

    Only the generated cycle is filtered. A catch-up, a student-support session,
    an onboarding review, or a cycle-type meeting explicitly booked by the
    learner is something somebody actually arranged and must survive a mirror
    change. Learner bookings are identifiable by their durable idempotency key;
    unlike coach-generated slots, they currently store the source learner id.
    """
    if mirror is None:
        return True
    if _s(record.event_type) not in ("mcr", "progress-review", "review"):
        return True
    if _s(getattr(record, "idempotency_key", "")).startswith("learner-book:"):
        return True
    return str(record.learner_id or "") in ("", str(mirror.id))


def _generated_cycle_events(learner, mirror, stored_by_key):
    """The learner's Curriculum Review slots for the cycle.

    Delegates to the coach timetable's own generator so there is one definition
    of when these fall: Curriculum's Review templates for the learner's
    programme decide which Reviews exist, how often they recur and how many
    there are, all counted from the learner's start date. Importing it rather
    than restating it is the point: two implementations of the same cycle would
    drift apart the first time either was tuned, and the learner and their coach
    would then be told different dates for the same meeting.

    A slot that has been scheduled already appears in `stored_by_key` and is
    skipped here, because the stored row carries the real date, time and status.
    Everything else is returned as the coach sees it: "not-scheduled", dated on
    the target, with no time.
    """
    from coach_api.models import CoachCalendarEvent
    from coach_api.views import (
        build_timetable_event_key,
        resolve_curriculum_programme_id,
        log_review_anchor_skip,
        resolve_curriculum_review_occurrences,
        resolve_review_anchor_date,
        resolve_schedule_window,
        review_event_type_for_type_code,
    )

    if mirror is None:
        # The window is read from the mirror the coach timetable reads, so
        # without one there is nothing to generate from. A learner reaches that
        # state before their first activation.
        return []

    # The learner's OWN enrolment row goes in first, exactly as the coach
    # timetable passes it: resolve_schedule_window prefers a source row's
    # enrolment."Created_users"."Start_date" over the profile mirror's, and the
    # mirror's start_date is the COHORT delivery window -- active_users
    # .mirror_learner_placement stamps it there on every placement edit ("the
    # window belongs to the cohort, so it moves with the placement").
    #
    # Passing empty maps here reversed that preference, so a learner who
    # started on the 10th saw every Review on the cohort's 3rd while their
    # coach -- who does pass the maps -- held the 10th. Same meeting, two
    # dates. The coach passes prefetched maps for a whole caseload; this
    # endpoint holds the one learner, so it builds a map of one.
    commercial_rows, enrolment_rows = {}, {}
    if learner is not None:
        is_commercial = _s(getattr(learner, "learner_type", "")).casefold() == "commercial"
        (commercial_rows if is_commercial else enrolment_rows)[mirror.id] = learner
    programme_id = resolve_curriculum_programme_id(getattr(mirror, "programme", None))
    # Same strict rule as the coach timetable, from the same helper and in the
    # same order: Review recurrence counts from the learner's own enrolment
    # ."Created_users"."Start_date" or it does not count at all. Without this
    # the two calendars would disagree the moment a learner has no enrolment
    # row -- the coach would show nothing while the learner still saw
    # cohort-dated Reviews.
    review_anchor, anchor_reason = resolve_review_anchor_date(
        mirror.id, commercial_rows, enrolment_rows,
    )
    if review_anchor is None:
        log_review_anchor_skip(mirror, anchor_reason, programme_id=programme_id)
        return []

    start_date, end_date = resolve_schedule_window(mirror.id, commercial_rows, enrolment_rows, mirror)
    end_date = end_date or _as_date(
        getattr(learner, "end_date", None)
        or getattr(learner, "practical_period_end_date", None)
        or getattr(learner, "apprenticeship_end_date", None)
    )
    if not start_date or not end_date or end_date <= start_date:
        return []

    coach_name = _s(mirror.coach_name)
    coach_email = _s(mirror.coach_email)
    generated = []
    occurrences = resolve_curriculum_review_occurrences(
        programme_id=programme_id,
        learner_id=mirror.id,
        learner_status=_s(getattr(mirror, "programme_status", None) or getattr(mirror, "status", None)),
        learner_start_date=review_anchor,
        window_start=start_date,
        window_end=end_date,
        template_cache={},
    )
    for occurrence in occurrences:
        event_type = review_event_type_for_type_code(occurrence.get("reviewTypeCode"))
        sequence = occurrence["occurrenceNumber"]
        target_date = occurrence["targetDate"]
        event_key = build_timetable_event_key(mirror.id, event_type, sequence, target_date)
        if event_key in stored_by_key:
            continue
        generated.append({
            "id": event_key,
            "eventKey": event_key,
            # The Review's live Curriculum name -- the coach calendar shows
            # this same string for the same occurrence.
            "title": occurrence.get("reviewName") or EVENT_TITLES.get(event_type, "Coaching Session"),
            # `source` stays the legacy routing bucket (mcr / progress-review /
            # review): event keys, booking, artifacts and every Coach consumer
            # are keyed on it. Classification rides alongside it rather than
            # replacing it -- see _review_type_fields.
            "source": event_type,
            "type": EVENT_JSON_TYPES.get(event_type, "review"),
            "sequence": sequence,
            "reviewTemplateId": occurrence.get("reviewTemplateId"),
            # A generated occurrence is a projection, not a record: nothing is
            # written until somebody schedules it, so it never carries an
            # instance. Emitted explicitly so the shape matches a stored row.
            "reviewInstanceId": None,
            "occurrenceNumber": sequence,
            **_review_type_fields_from_occurrence(occurrence),
            "status": CoachCalendarEvent.STATUS_NOT_SCHEDULED,
            # Dated on the target so it lands in the right month; the coach
            # calendar shows the same date with the same caveat.
            "date": target_date.isoformat(),
            "targetDate": target_date.isoformat(),
            "scheduledDate": None,
            "scheduledTime": None,
            "durationMinutes": 60,
            "coachName": coach_name,
            "coachEmail": coach_email,
            "meetingProvider": "",
            "meetingLink": "",
            "notes": "",
            "reviewResponses": {},
            "reviewCompletedAt": None,
            "invited": False,
            "syncError": "",
            # Nothing has been booked, so there is no time to show and no
            # invitation to claim — see the coach's own generated event.
            "isTimeEstimated": True,
            "generated": True,
        })
    return generated


def _as_date(value):
    """A date from the enrolment row's date-or-text columns, or None."""
    from coach_api.views import parse_date_value

    parsed = parse_date_value(value)
    return parsed.date() if isinstance(parsed, datetime) else parsed


def _review_type_fields(type_row):
    """The Review Type block every review-driven calendar event carries.

    Four fields, and each earns its place:

      reviewTypeId       stable filter identity -- survives a rename of the
                         type itself, which `code` also does but `name` does not
      reviewTypeCode     stable routing code, for anything keying on 'mcm' etc.
      reviewTypeName     the FILTER LABEL. Not the event title: the title is
                         review_templates.name, so "Monthly Learner Catch-up"
                         displays under itself while filtering as "Monthly
                         Coaching Meeting".
      reviewTypeIsSystem lets a consumer order system types before custom ones
                         without matching any code literal.

    All four are None/False for an event that is not a Curriculum Review, and
    for a Review whose template predates the Review Type backfill.
    """
    return {
        "reviewTypeId": _s((type_row or {}).get("id")) or None,
        "reviewTypeCode": _s((type_row or {}).get("code")) or None,
        "reviewTypeName": _s((type_row or {}).get("name")) or None,
        "reviewTypeIsSystem": bool((type_row or {}).get("is_system")),
    }


def _review_type_fields_from_occurrence(occurrence):
    """Same block, from a freshly resolved occurrence that already carries it
    (see curriculum_api.review_instances.resolve_programme_review_occurrences)
    -- no second lookup for data the engine just handed us."""
    return {
        "reviewTypeId": _s(occurrence.get("reviewTypeId")) or None,
        "reviewTypeCode": _s(occurrence.get("reviewTypeCode")) or None,
        "reviewTypeName": _s(occurrence.get("reviewTypeName")) or None,
        "reviewTypeIsSystem": bool(occurrence.get("reviewTypeIsSystem")),
    }


def review_type_rows_by_template(template_ids):
    """{review_template_id: review_types row} for a batch of stored rows.

    A stored calendar row links to Curriculum only by ``review_template_id``;
    its classification is whatever that template points at RIGHT NOW, read
    live. Reclassifying a Review in Curriculum therefore re-buckets its
    existing calendar events, which is the intent -- Review Type is routing
    metadata, not part of a historical record (the frozen definition_snapshot
    on a review instance is what protects the answers).

    Batched deliberately: production is nine two-worker services talking to
    Neon, so one query for the templates plus one tiny one for the type
    catalogue beats a pair per event.
    """
    wanted = {_s(template_id) for template_id in template_ids if _s(template_id)}
    if not wanted:
        return {}
    try:
        from curriculum_api import reviews as curriculum_reviews
        from curriculum_api import review_types as curriculum_review_types

        type_index = curriculum_review_types.review_type_index()
        resolved = {}
        for template_id in wanted:
            template_row = curriculum_reviews.get_review_template_row(template_id)
            if not template_row:
                continue
            type_row = type_index.get(_s(template_row.get("review_type_id")))
            if type_row:
                resolved[template_id] = type_row
        return resolved
    except Exception:
        # Curriculum being unreachable must cost the learner their filters,
        # not their calendar.
        logger.warning("Could not resolve Review Types for the learner calendar.", exc_info=True)
        return {}


def _stored_event_title(record, event_type):
    """A stored Review row is titled by its Curriculum template, read live, so
    renaming a Review in Curriculum renames it on the learner's calendar too.
    Rows that are not Curriculum Reviews (catch-up, onboarding, ...) keep the
    fixed wording they have always had."""
    template_id = _s(getattr(record, "review_template_id", ""))
    if template_id:
        from coach_api.views import resolve_review_display_title

        return resolve_review_display_title(event_type, template_id)
    return EVENT_TITLES.get(event_type, "Coaching Session")


def _serialize_event(record, *, review_type_rows=None):
    """Shape one coach_calendar_event row for the learner calendar page.

    Mirrors the field names the coach timetable JSON uses (scheduledDate,
    scheduledTime, durationMinutes, ...) so the two calendars stay in sync.

    ``review_type_rows`` is review_type_rows_by_template()'s batch, passed by
    callers serialising a whole list. A single-row caller can omit it and pay
    for one lookup.
    """
    event_type = _s(record.event_type) or "mcr"
    template_id = _s(getattr(record, "review_template_id", ""))
    if review_type_rows is None:
        review_type_rows = review_type_rows_by_template([template_id])
    display_date = record.scheduled_date or record.target_date
    meeting_link = _s(record.meeting_link) or _s(record.graph_web_link)
    return {
        "id": record.event_key,
        "eventKey": record.event_key,
        "title": _stored_event_title(record, event_type),
        "source": event_type,
        "type": EVENT_JSON_TYPES.get(event_type, "coaching"),
        "sequence": record.sequence,
        "reviewTemplateId": template_id or None,
        # Set the moment this occurrence is first scheduled (see
        # coach_api.views.ensure_review_instance_for_calendar_record). Its
        # presence is what tells the learner pages to open the generic
        # Curriculum-driven Review form instead of their legacy accordions --
        # exactly the flag the coach timetable already routes on.
        "reviewInstanceId": _s(getattr(record, "review_instance_id", "")) or None,
        "occurrenceNumber": getattr(record, "occurrence_number", None),
        # Resolved live from the template's current Review Type, so a booked
        # review sits in the same filter bucket as the unbooked occurrences
        # around it.
        **_review_type_fields(review_type_rows.get(template_id)),
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
        "learnerSigned": bool(_s((record.review_responses or {}).get("learner_signature"))),
        "learnerSignedAt": _s((record.review_responses or {}).get("learner_signed_at")) or None,
        # A row can save while the Graph sync fails (no network, non-tenant
        # mailbox, ...). Without this the UI shows a confident "Booked" for a
        # meeting that reached nobody's calendar or inbox.
        "invited": bool(_s(record.graph_event_id)),
        "syncError": _s(record.last_graph_sync_error),
    }


def coaching_events_for_learner(learner, mirror):
    """One source for the calendar and Training Plan coaching dates/statuses."""
    emails = {_s(getattr(learner, 'email', '')).strip().casefold(),
              _s(getattr(mirror, 'email', '')).strip().casefold()} - {''}
    match = Q()
    for email in emails:
        match |= Q(learner_email__iexact=email)
    if mirror is not None:
        match |= Q(learner_id=mirror.id) | Q(learner_id=learner.pk)
    if not match:
        return []
    records = []
    for record in CoachCalendarEvent.objects.filter(match).order_by('target_date', 'event_type', 'sequence'):
        email = _s(getattr(record, 'learner_email', '')).strip().casefold()
        # Created_users and learner profiles have different ID sequences.
        # A matching number must never override another learner's email.
        expected_id = learner.pk if _s(getattr(record, 'idempotency_key', '')).startswith('learner-book:') else getattr(mirror, 'id', None)
        belongs = email in emails if email else expected_id is not None and str(record.learner_id) == str(expected_id)
        if belongs and _belongs_to_current_cycle(record, mirror):
            records.append(record)
    review_type_rows = review_type_rows_by_template(
        getattr(record, "review_template_id", "") for record in records
    )
    events = [_serialize_event(record, review_type_rows=review_type_rows) for record in records]
    events.extend(_generated_cycle_events(learner, mirror, {record.event_key for record in records}))
    return events


def _learner_calendar_record(kind, pk, event_key):
    """Resolve an event only when it belongs to the requested learner."""
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return None
    learner = model.all_learners.filter(pk=pk).first()
    if learner is None:
        return None
    mirror = learner_profile_for_source(learner, pk, active_only=True)
    emails = {_s(learner.email).strip().casefold()}
    if mirror:
        emails.add(_s(mirror.email).strip().casefold())
    emails.discard("")
    record = CoachCalendarEvent.objects.filter(event_key=event_key).first()
    if not record:
        return None
    learner_ids = {str(pk)}
    if mirror:
        learner_ids.add(str(mirror.id))
    return record if (str(record.learner_id or "") in learner_ids or _s(record.learner_email).strip().casefold() in emails) else None


def _graph_base_event(record):
    """The base event a Graph sync must be given for this row.

    For a Curriculum Review the generated occurrence IS the source of truth:
    it carries the Review Template's live name (which becomes the Teams
    subject) and, for a Progress Review, the employer attendee. Rebuilding the
    event from the stored row instead -- as build_booked_calendar_event does --
    would retitle the meeting from the legacy per-event-type map and silently
    drop the employer from the invite.

    The coach's own scheduling path already passes the generated event
    (coach_api.views.coach_timetable_schedule_event), so this is what keeps the
    two sides writing the same Graph event.

    Falls back to build_booked_calendar_event for rows that genuinely have no
    generated source -- catch-up, student support, onboarding reviews -- and
    for a Review whose occurrence can no longer be resolved.
    """
    from coach_api.views import build_booked_calendar_event, find_generated_timetable_event

    if _s(record.event_type) in REVIEW_CYCLE_TYPES:
        base_event, _owner_name = find_generated_timetable_event(
            _s(record.owner_email), record.event_key,
        )
        if base_event:
            return base_event
        logger.warning(
            "Review occurrence %s could not be resolved for a Graph sync; "
            "falling back to the stored row.", record.event_key,
        )
    return build_booked_calendar_event(record)


def _learner_booking_record(kind, pk, event_key):
    """Resolve a learner-owned booking row that the learner is allowed to move."""
    record = _learner_calendar_record(kind, pk, event_key)
    if not record or _s(record.event_type) not in CANCELLABLE_TYPES:
        return None
    return record


@learner_self_or_staff(kwarg="pk")
def learner_calendar_event_artifacts(request, kind, pk, event_key):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    record = _learner_calendar_record(kind, pk, event_key)
    if not record:
        return _error("Calendar event not found for this learner.", 404)
    from coach_api.views import fetch_coach_meeting_graph_snapshot, persist_coach_meeting_snapshots, ensure_coach_meeting_summary
    snapshot, error_payload, status_code = fetch_coach_meeting_graph_snapshot(record)
    if error_payload:
        return JsonResponse(error_payload, status=status_code)
    storage = persist_coach_meeting_snapshots(
        record,
        artifacts=snapshot["artifacts"],
        attendance_reports=snapshot["attendanceReports"],
        attendance_tracker=snapshot["attendanceTracker"],
    )
    meeting_summary = ensure_coach_meeting_summary(record)
    # Learners may watch the formal meeting recording, but transcripts remain
    # staff-only because they can contain sensitive discussion notes.
    learner_artifacts = [
        artifact for artifact in snapshot["artifacts"]
        if _s(artifact.get("artifact_type")).lower() == "recording"
    ]
    return JsonResponse({
        "artifacts": learner_artifacts,
        "attendance": snapshot["attendance"],
        "meetingSummary": meeting_summary,
        "errors": snapshot["errors"],
        "partial": snapshot["partial"],
        "storage": storage,
    }, status=status_code)


@learner_self_or_staff(kwarg="pk")
def learner_calendar_event_artifact_content(request, kind, pk, event_key, artifact_type, artifact_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    record = _learner_calendar_record(kind, pk, event_key)
    if not record:
        return _error("Calendar event not found for this learner.", 404)
    if _s(artifact_type).lower() != "recording":
        return _error("Only meeting recordings are available to learners.", 403)
    from coach_api.views import coach_meeting_artifact_content_response
    return coach_meeting_artifact_content_response(request, record, event_key, artifact_type, artifact_id)


@csrf_exempt
@learner_self_or_staff(kwarg="pk")
def learner_progress_review_sign(request, kind, pk, event_key):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    record = _learner_calendar_record(kind, pk, event_key)
    if not record or record.event_type != "progress-review":
        return _error("Progress review not found for this learner.", 404)
    try:
        payload = json.loads(request.body or b"{}")
    except (TypeError, ValueError):
        return _error("Invalid JSON body.", 400)
    signature = _s(payload.get("signature"))
    if not signature.startswith("data:image/"):
        return _error("A valid learner signature is required.", 400)
    if record.status not in {CoachCalendarEvent.STATUS_AWAITING_SIGNATURE, CoachCalendarEvent.STATUS_COMPLETED}:
        return _error("The coach must submit the review before the learner can sign it.", 409)
    responses = dict(record.review_responses or {})
    responses.update({
        "learner_signature": signature,
        "learner_signed_by": _s(payload.get("name")) or record.learner_name,
        "learner_signed_at": timezone.now().isoformat(),
    })
    record.review_responses = responses
    record.save(update_fields=["review_responses", "updated_at"])
    return JsonResponse({"event": _serialize_event(record)})


@learner_self_or_staff(kwarg="pk")
def learner_calendar_event_review(request, kind, pk, event_key):
    """The Curriculum Review form behind one of the learner's calendar events.

        GET /learner_api/calendar/<kind>/<pk>/events/<event_key>/review/
        -> {"instance": {...}, "template": {...}, "sections": [...], "signatures": {...}}
        -> {"instance": null} when this occurrence has no Review instance yet

    Read-only, and deliberately so. A Review instance is created when the
    occurrence is SCHEDULED (coach_api.views
    .ensure_review_instance_for_calendar_record) or when the coach first opens
    its form -- never by a learner looking at it. So this endpoint resolves an
    existing instance and refuses to create one: an unscheduled occurrence
    answers ``instance: null`` rather than quietly writing a durable row every
    time the learner opens the page.

    The payload is the same ``review_instance_form_definition`` the coach's
    ``/coach_api/coach/reviews/<id>`` returns, so both sides render one
    Curriculum-authored form -- sections, fields, conditional fields, required
    rules and signatures -- from one definition.
    """
    from curriculum_api import review_instances as curriculum_review_instances

    if request.method != "GET":
        return _error("Method not allowed.", 405)
    record = _learner_calendar_record(kind, pk, event_key)
    if record is None:
        return _error("Calendar event not found for this learner.", 404)
    instance_id = _s(getattr(record, "review_instance_id", ""))
    if not instance_id:
        # Not an error: a generated-but-unscheduled occurrence, or a stored row
        # that predates the Curriculum Review architecture, legitimately has no
        # instance. The page falls back to whatever it held before.
        return JsonResponse({"instance": None})
    try:
        instance_row = curriculum_review_instances.get_review_instance(instance_id)
    except DatabaseError as exc:
        logger.exception("learner_calendar_event_review: instance lookup failed")
        return _error(f"Database error: {exc}", 502)
    if not instance_row:
        return JsonResponse({"instance": None})
    return JsonResponse(curriculum_review_instances.review_instance_form_definition(instance_row))


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


@learner_self_or_staff(kwarg="pk")
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
        match |= Q(learner_id=mirror.id)
    for candidate in {mirror_email, source_email} - {""}:
        match |= Q(learner_email__iexact=candidate)
    if not match:
        return JsonResponse({
            "learner": {"kind": kind, "id": pk},
            "events": [],
            "bookingCalendar": booking_calendar_payload(),
        })

    try:
        events = coaching_events_for_learner(learner, mirror)

        # Live curriculum sessions belong to the learner's placement, not to
        # their assigned coach. Use the same module/week/holiday planner as the
        # coach calendar, but scope it directly to programme/cohort/group.
        if mirror is not None and (_s(getattr(mirror, "group_id", "")) or _s(mirror.group_name)):
            from coach_api.views import collect_live_session_events

            live_events = collect_live_session_events(
                "",
                "",
                require_coach_access=False,
                include_past=True,
                learner_scope={
                    "programme": _s(mirror.programme),
                    "programme_id": _s(getattr(mirror, "programme_id", "")),
                    "cohort": _s(mirror.cohort),
                    "cohort_id": _s(getattr(mirror, "cohort_id", "")),
                    "group": _s(mirror.group_name),
                    "group_id": _s(getattr(mirror, "group_id", "")),
                },
            )
            for event in live_events:
                events.append(_serialize_live_session_event(event))

        # A curriculum event can be reachable through more than one legacy
        # source. Keep one stable calendar item per event key.
        events = list({
            event.get("eventKey") or event.get("id"): event
            for event in events
            if event.get("eventKey") or event.get("id")
        }.values())
        # Generated slots interleave with stored ones, so the page is handed a
        # calendar in date order rather than stored-then-generated.
        events.sort(key=lambda event: (
            event.get("date") or event.get("targetDate") or "",
            _s(event.get("source")),
            event.get("sequence") or 0,
        ))
    except DatabaseError as exc:
        logger.exception("learner_calendar: event lookup failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse(
        {
            "learner": {"kind": kind, "id": pk, "email": email},
            "events": events,
            "bookingCalendar": booking_calendar_payload(),
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
        CalendarSyncInProgress,
        ensure_review_instance_for_calendar_record,
        find_generated_timetable_event,
        LearnerCalendarConflict,
        normalize_duration_minutes,
        parse_date_value,
        parse_time_value,
        persist_calendar_sync_reservation,
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
    date_restriction = booking_date_restriction(scheduled_date)
    if date_restriction is not None:
        return _error(date_restriction.message, 400)

    notes = _s(payload.get("notes"))[:500]
    # An onboarding learner has no mirror row yet, so fall back to the source.
    # (LearnerProfile's name column is full_name, not username.)
    learner_name = _s(getattr(mirror, "full_name", "")) or _s(learner.username)
    learner_email = _s(getattr(mirror, "email", "")) or _s(learner.email)
    requires_coach_approval = session_type in {"catch-up", "student-support"} and not is_onboarding_review
    calendar_learner_id = int(mirror.id) if mirror is not None and not is_onboarding_review else pk

    if session_type in REVIEW_CYCLE_TYPES:
        event_key = _s(payload.get("eventKey"))
        if not event_key:
            return _error(
                "Open the Review slot from your calendar and schedule that session.",
                400,
            )
        if len(event_key) > 255:
            return _error("eventKey is too long.", 400)
        if mirror is None:
            return _error("Only Active learners can schedule programme-cycle sessions.", 400)

        base_event, owner_name = find_generated_timetable_event(owner_email, event_key)
        if (
            not base_event
            or _s(base_event.get("source")) != session_type
            or str(base_event.get("learnerId") or "") != str(mirror.id)
        ):
            return _error("Programme-cycle calendar event not found for this learner.", 404)

        if _s(base_event.get("status")) in {
            CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
            CoachCalendarEvent.STATUS_COMPLETED,
        }:
            return _error("A submitted or completed review cannot be scheduled again.", 409)

        target_date = parse_date_value(base_event.get("targetDate"))
        if isinstance(target_date, datetime):
            target_date = target_date.date()
        if not target_date:
            return _error("Target date is missing for this event.", 400)

        try:
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

            record, created = CoachCalendarEvent.objects.get_or_create(
                event_key=event_key,
                defaults={
                    "owner_email": owner_email,
                    "owner_name": owner_name or _s(mirror.coach_name) or "Coach",
                    "learner_id": int(mirror.id),
                    "learner_name": _s(base_event.get("learner")) or learner_name,
                    "learner_email": _s(base_event.get("email")) or learner_email,
                    "event_type": session_type,
                    "sequence": int(base_event.get("sequence") or 1),
                    "target_date": target_date,
                },
            )
            record.owner_email = owner_email
            record.owner_name = owner_name or _s(mirror.coach_name) or record.owner_name or "Coach"
            record.learner_id = int(mirror.id)
            record.learner_name = _s(base_event.get("learner")) or learner_name
            record.learner_email = _s(base_event.get("email")) or learner_email
            record.event_type = session_type
            record.sequence = int(base_event.get("sequence") or 1)
            record.target_date = target_date
            record.scheduled_date = scheduled_date
            record.scheduled_time = scheduled_time
            record.duration_minutes = duration_minutes
            record.status = CoachCalendarEvent.STATUS_SCHEDULED
            record.notes = notes

            # The learner can schedule a programme-cycle Review themselves, so
            # this path has to link the row back to Curriculum exactly as the
            # coach's own scheduling does. Without it a learner-booked MCM kept
            # neither its template (so it fell back to the legacy title) nor an
            # instance (so its Review form could never be opened).
            review_template_id = _s(base_event.get("reviewTemplateId"))
            if review_template_id:
                record.review_template_id = review_template_id
                record.occurrence_number = int(base_event.get("occurrenceNumber") or record.sequence)

            record = persist_calendar_sync_reservation(record)
            if review_template_id:
                ensure_review_instance_for_calendar_record(record, base_event)
            record, warning, _attempted = synchronize_reserved_calendar_event(record.pk, base_event)
        except LearnerCalendarConflict as exc:
            return _error(str(exc), 409)
        except CalendarSyncInProgress:
            return _error("Calendar event synchronization is already in progress.", 409)
        except DatabaseError as exc:
            logger.exception("learner_calendar_book: generated cycle booking failed")
            return _error(f"Database error: {exc}", 502)

        if warning:
            logger.error(
                "learner_calendar_book: Graph sync failed for generated %s (owner=%s): %s",
                record.event_key, owner_email, warning,
            )
        return JsonResponse(
            {"event": _serialize_event(record), "warning": _friendly_sync_warning(warning)},
            status=201 if created else 200,
        )

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
                learner_id=calendar_learner_id,
                session_type=session_type,
                scheduled_date=scheduled_date,
                scheduled_time=scheduled_time,
                duration_minutes=duration_minutes,
                notes=notes,
            ):
                return _error("Idempotency-Key was already used for a different booking.", 409)
            if requires_coach_approval:
                return JsonResponse(
                    {
                        "event": _serialize_event(replay),
                        "warning": "",
                        "approvalRequired": True,
                    },
                    status=200,
                )
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
            learner_id=calendar_learner_id,
            learner_name=learner_name,
            learner_email=learner_email,
            session_type=session_type,
            scheduled_date=scheduled_date,
            scheduled_time=scheduled_time,
            duration_minutes=duration_minutes,
            notes=notes,
            idempotency_key=idempotency_key,
            initial_status=CoachCalendarEvent.STATUS_NOT_SCHEDULED if requires_coach_approval else CoachCalendarEvent.STATUS_SCHEDULED,
        )
        if requires_coach_approval:
            return JsonResponse(
                {
                    "event": _serialize_event(record),
                    "warning": "",
                    "approvalRequired": True,
                },
                status=201 if created else 200,
            )
        record, warning, _attempted = synchronize_reserved_calendar_event(
            record.pk, build_booked_calendar_event(record)
        )
    except LearnerCalendarConflict as exc:
        return _error(str(exc), 409)
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
@learner_self_or_staff(kwarg="pk")
def learner_calendar_reschedule(request, kind, pk):
    """Move one of this learner's booked sessions and update its Graph event."""
    from coach_api.views import (
        build_booked_calendar_event,
        CalendarSyncInProgress,
        LearnerCalendarConflict,
        normalize_duration_minutes,
        parse_date_value,
        parse_time_value,
        persist_calendar_sync_reservation,
        synchronize_reserved_calendar_event,
    )

    if request.method not in {"POST", "PATCH"}:
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
    date_restriction = booking_date_restriction(scheduled_date)
    if date_restriction is not None:
        return _error(date_restriction.message, 400)

    try:
        record = _learner_booking_record(kind, pk, event_key)
        if record is None:
            return _error("Booking not found.", 404)
        if record.status != CoachCalendarEvent.STATUS_SCHEDULED:
            return _error("Only an upcoming scheduled session can be rescheduled.", 409)
        if (
            record.scheduled_date == scheduled_date
            and record.scheduled_time == scheduled_time
            and record.duration_minutes == duration_minutes
        ):
            return JsonResponse({"event": _serialize_event(record), "warning": ""})

        from .calendar_connections import booking_conflicts
        if booking_conflicts(
            kind,
            pk,
            scheduled_date,
            scheduled_time,
            duration_minutes,
            timezone_offset_minutes,
            exclude_scheduled_date=record.scheduled_date,
            exclude_scheduled_time=record.scheduled_time,
            exclude_duration_minutes=record.duration_minutes,
        ):
            return _error(
                "That time overlaps an event in your connected personal calendar. Please choose another time.",
                409,
            )

        record.scheduled_date = scheduled_date
        record.scheduled_time = scheduled_time
        record.duration_minutes = duration_minutes
        record = persist_calendar_sync_reservation(record)
        record, warning, _attempted = synchronize_reserved_calendar_event(
            record.pk, _graph_base_event(record)
        )
    except LearnerCalendarConflict as exc:
        return _error(str(exc), 409)
    except CalendarSyncInProgress:
        return _error("Calendar event synchronization is already in progress.", 409)
    except DatabaseError as exc:
        logger.exception("learner_calendar_reschedule: update failed")
        return _error(f"Database error: {exc}", 502)

    _record_enrolment_review(record, kind=kind, learner_kind_id=pk, coach_id=None)
    return JsonResponse(
        {"event": _serialize_event(record), "warning": _friendly_sync_warning(warning)}
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
    from coach_api.views import cancel_reserved_calendar_event, delete_calendar_event_from_graph

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
        record = _learner_booking_record(kind, pk, event_key)
        if record is None:
            return _error("Booking not found.", 404)
        if record.status == CoachCalendarEvent.STATUS_CANCELLED:
            return JsonResponse({"event": _serialize_event(record), "warning": ""})

        if _s(record.event_type) in REVIEW_CYCLE_TYPES:
            # A Curriculum Review occurrence is not a booking that can be
            # called off -- it is a Review the programme still owes the
            # learner. Cancelling one releases the slot so it can be scheduled
            # again, which is exactly what the coach's own cancel does. Using
            # the coach's helper is what keeps the two sides on one terminal
            # state ("not-scheduled", Graph event deleted, Review instance
            # untouched) instead of the learner leaving a row nobody can
            # rebook. Non-Review bookings keep their own "cancelled" semantics,
            # which learner_onboarding_reviews relies on to free a slot.
            record, warning = cancel_reserved_calendar_event(record)
        else:
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


@learner_self_or_staff(kwarg="pk")
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
