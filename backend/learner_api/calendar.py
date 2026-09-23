"""Learner-facing calendar: coaching sessions from "Coach".coach_calendar_event.

    GET /learner_api/calendar/<kind>/<int:pk>/

`kind` is 'commercial' or 'apprenticeship' (same vocabulary as learner-detail).
The coach timetable stores events keyed by the "Learner"."Active_users" mirror
id + email, so the learner is matched by email: directly against
coach_calendar_event.learner_email, and via any Active_users mirror rows with
the same email against coach_calendar_event.learner_id.

Monthly coaching and progress reviews are *generated* from Curriculum
review_templates rather than stored: the coach timetable resolves each
learner's official occurrences every time it loads (see
coach_api.views.collect_generated_timetable), and a row only exists once
somebody schedules one. So a learner whose coach had not booked yet saw an
empty calendar while their coach saw a column of "Not Scheduled" slots. This
endpoint runs the same generator over the same window, then lays the stored
rows on top by event key — the coach's own join — so both calendars name the
same dates and the same statuses. A learner with no Curriculum programme
mapping, or a programme with no configured review template, has zero
generated occurrences here — there is no fixed-interval fallback.
"""
import json
import logging
import hashlib
from datetime import datetime

from django.db import DatabaseError, connection
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
# The first session's own vocabulary: its event type, and the college's today.
# Imported rather than restated so the gate, the booking and the calendar
# cannot disagree about either.
from .aptem_status import programme_status
from .first_session import (
    SESSION_TYPE as FIRST_SESSION_TYPE,
    imported_from_aptem as first_session_imported_from_aptem,
    uk_today as first_session_uk_today,
)
from login.permissions import learner_self_or_staff
from login.sessions import authenticate_request

logger = logging.getLogger(__name__)

EVENT_TITLES = {
    "mcr": "Monthly Coaching",
    "progress-review": "Progress Review",
    "review": "Review",
    "gateway": "Gateway",
    "other": "Other",
    "catch-up": "Catch-up Session",
    "recorded-recovery": "Watch Recording",
    "student-support": "Student Support",
    "first-session": "First Session",
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
    "gateway": "review",
    "other": "coaching",
    "catch-up": "coaching",
    "recorded-recovery": "coaching",
    "student-support": "welfare",
    "first-session": "coaching",
    "eligibility-review": "review",
    "workspace": "review",
    "training-plan": "review",
}

# What a learner can book for themselves. Monthly coaching and progress reviews
# must be booked against a generated programme-cycle eventKey so the learner and
# coach see the same official calendar row.
BOOKABLE_TYPES = ("catch-up", "student-support", "first-session", "mcr", "progress-review", "review", "gateway", "other")

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
    elif "permissions" in lowered or "accessdenied" in lowered or "access is denied" in lowered:
        detail = "the booking application does not have permission to access the organiser calendar; your Microsoft 365 administrator needs to grant access"
    elif "errorinvaliduser" in lowered or "invalid" in lowered and "user" in lowered:
        detail = "the organiser mailbox is not set up for calendar invites"
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
    """Generate the same Curriculum cycle the coach timetable exposes.

    Curriculum review_templates are the only source of truth for MCM/Progress
    Review occurrence dates. A learner with no resolvable Curriculum programme
    mapping, or a programme with no configured template, produces zero
    occurrences here -- never a fixed-interval fallback (see
    coach_api.views.collect_generated_timetable, which this mirrors).
    """
    from coach_api.models import CoachCalendarEvent
    from coach_api.views import (
        resolve_curriculum_programme_id,
        resolve_curriculum_review_occurrences,
        resolve_review_anchor_date,
        log_review_anchor_skip,
        resolve_schedule_window,
        review_event_type_for_type_code,
        review_type_event_fields,
    )
    from curriculum_api.review_instances import review_calendar_event_key

    if mirror is None:
        return []

    programme_id = resolve_curriculum_programme_id(
        getattr(mirror, 'programme_id', None) or getattr(mirror, 'programme', None),
    )
    if not programme_id:
        return []

    source_rows = {mirror.id: learner} if learner is not None else {}
    anchor, reason = resolve_review_anchor_date(mirror.id, {}, source_rows)
    if anchor is None:
        log_review_anchor_skip(mirror, reason, programme_id=programme_id, template_cache={})
        return []
    start_date, end_date = resolve_schedule_window(mirror.id, {}, source_rows, mirror)
    if not start_date or not end_date or end_date <= start_date:
        return []
    generated = []
    for occurrence in resolve_curriculum_review_occurrences(
        programme_id=programme_id,
        learner_id=mirror.id,
        learner_status=_s(
            getattr(mirror, 'programme_status', None)
            or getattr(mirror, 'status', None)
            or getattr(learner, 'programme_status', None)
            or getattr(learner, 'status', None)
        ),
        learner_start_date=anchor,
        window_start=start_date,
        window_end=end_date,
        template_cache={},
        learner_scope={
            'cohort_id': getattr(mirror, 'cohort_id', None),
            'cohort': getattr(mirror, 'cohort', None),
            'group_id': getattr(mirror, 'group_id', None),
            'group': getattr(mirror, 'group_name', None),
        },
    ):
        sequence, target_date = occurrence['occurrenceNumber'], occurrence['targetDate']
        event_type = review_event_type_for_type_code(occurrence.get('reviewTypeCode'))
        event_key = review_calendar_event_key(mirror.id, occurrence['reviewTemplateId'], sequence)
        if event_key in stored_by_key:
            continue
        generated.append({
            "id": event_key,
            "eventKey": event_key,
            "learnerId": str(mirror.id),
            "title": occurrence.get('reviewName') or EVENT_TITLES.get(event_type, 'Review'),
            "reviewTemplateId": occurrence['reviewTemplateId'],
            "reviewInstanceId": None,
            "occurrenceNumber": sequence,
            **review_type_event_fields(occurrence),
            "source": event_type,
            "type": EVENT_JSON_TYPES.get(event_type, "coaching"),
            "sequence": sequence,
            "status": CoachCalendarEvent.STATUS_NOT_SCHEDULED,
            "date": target_date.isoformat(),
            "targetDate": target_date.isoformat(),
            "scheduledDate": None,
            "scheduledTime": None,
            "durationMinutes": 60,
            "coachName": _s(mirror.coach_name),
            "coachEmail": _s(mirror.coach_email),
            "meetingProvider": "",
            "meetingLink": "",
            "notes": "",
            "reviewResponses": {},
            "reviewCompletedAt": None,
            "invited": False,
            "syncError": "",
            "isTimeEstimated": True,
            "generated": True,
        })
    return generated


def review_type_rows_by_template(template_ids):
    from curriculum_api import reviews, review_types
    wanted = sorted({_s(value) for value in template_ids if _s(value)})
    if not wanted:
        return {}
    rows = reviews.get_review_template_rows(
        f"id in ({', '.join(['%s'] * len(wanted))})", wanted, include_deleted=True,
    )
    types = review_types.review_type_index()
    return {row['id']: types[row['review_type_id']] for row in rows if row.get('review_type_id') in types}


def _serialize_event(record, *, review_types_by_template=None, templates_by_id=None):
    """Shape one coach_calendar_event row for the learner calendar page.

    Mirrors the field names the coach timetable JSON uses (scheduledDate,
    scheduledTime, durationMinutes, ...) so the two calendars stay in sync.
    """
    event_type = _s(record.event_type) or "mcr"
    from coach_api.views import review_event_type_for_type_code, review_type_event_fields
    from curriculum_api import reviews
    template_id = _s(getattr(record, 'review_template_id', ''))
    if review_types_by_template is None:
        review_types_by_template = review_type_rows_by_template([template_id])
    type_row = review_types_by_template.get(template_id) or {}
    if template_id:
        event_type = review_event_type_for_type_code(type_row.get('code'))
    template = (templates_by_id or {}).get(template_id)
    if template_id and templates_by_id is None:
        template = reviews.get_review_template_row(template_id, include_deleted=True)
    display_date = record.scheduled_date or record.target_date
    meeting_link = _s(record.meeting_link) or _s(record.graph_web_link)
    from coach_api.views import public_graph_sync_warning
    sync_warning = public_graph_sync_warning(_s(record.last_graph_sync_error))
    booking_parts = _s(getattr(record, "idempotency_key", "")).split(":")
    imported_booking = (
        len(booking_parts) == 6 and booking_parts[0] == "learner-book"
        and booking_parts[1] == ("mcm" if event_type == "mcr" else "progress-review")
        and event_type in {"mcr", "progress-review"}
        and booking_parts[2] in SOURCE_MODELS and booking_parts[5].isdigit()
    )
    return {
        "id": record.event_key,
        "eventKey": record.event_key,
        "title": (template or {}).get('name') or EVENT_TITLES.get(event_type, "Coaching Session"),
        "reviewTemplateId": template_id or None,
        "reviewInstanceId": _s(getattr(record, 'review_instance_id', '')) or None,
        "occurrenceNumber": getattr(record, 'occurrence_number', None) or record.sequence,
        **review_type_event_fields({
            'reviewTypeId': type_row.get('id'), 'reviewTypeCode': type_row.get('code'),
            'reviewTypeName': type_row.get('name'), 'reviewTypeIsSystem': type_row.get('is_system'),
        }),
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
        "learnerSigned": bool(_s((record.review_responses or {}).get("learner_signature"))),
        "learnerSignedAt": _s((record.review_responses or {}).get("learner_signed_at")) or None,
        # A row can save while the Graph sync fails (no network, non-tenant
        # mailbox, ...). Without this the UI shows a confident "Booked" for a
        # meeting that reached nobody's calendar or inbox.
        "invited": bool(_s(record.graph_event_id)) or event_type == "recorded-recovery",
        "syncError": sync_warning,
        "syncState": getattr(record, "sync_state", ""),
        "syncWarning": _friendly_sync_warning(sync_warning) if sync_warning else "",
        "reviewId": booking_parts[5] if imported_booking else "",
        "assignmentMonth": booking_parts[4] if imported_booking else "",
    }


def _mark_imported_review_scheduled(review_id, learner_profile_id, scheduled_date, scheduled_time):
    """Keep the imported Reviews row in sync with a learner-booked review."""
    if not review_id:
        return
    try:
        review_pk = int(review_id)
    except (TypeError, ValueError):
        raise DatabaseError(f"Invalid imported review id {review_id!r}.")
    scheduled_at = datetime.combine(scheduled_date, scheduled_time)
    with connection.cursor() as cursor:
        cursor.execute(
            '''
            UPDATE "Learner".reviews
               SET status = %s,
                   planned_scheduled_date = %s
             WHERE id = %s
               AND learner_id = %s
               AND LOWER(BTRIM(review_type)) IN (%s, %s, %s, %s, %s)
            ''',
            ["scheduled", scheduled_at, review_pk, learner_profile_id,
             "monthly coaching meeting", "monthly coaching", "mcm",
             "progress review", "progress review (+ skills radar)"],
        )
        if cursor.rowcount == 0:
            raise DatabaseError(
                f"Imported review {review_pk} was not found for learner profile {learner_profile_id} "
                "or is not a schedulable review."
            )


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
    from curriculum_api import reviews, review_instances
    generated = _generated_cycle_events(learner, mirror, set())
    matched = review_instances.reconcile_review_event_keys(generated, records)
    templates = {}
    template_ids = sorted({_s(getattr(record, 'review_template_id', '')) for record in records} - {''})
    if template_ids:
        templates = {row['id']: row for row in reviews.get_review_template_rows(
            f"id in ({', '.join(['%s'] * len(template_ids))})", template_ids, include_deleted=True,
        )}
    types = review_type_rows_by_template(template_ids)
    events = []
    for event in generated:
        record = matched.get(event['eventKey'])
        if record:
            stored = _serialize_event(record, review_types_by_template=types, templates_by_id=templates)
            for field in ('title', 'source', 'type', 'reviewTemplateId', 'occurrenceNumber', 'reviewTypeId', 'reviewTypeCode', 'reviewTypeName', 'reviewTypeIsSystem'):
                # Legacy cycles have no Curriculum review metadata. Preserve
                # the serialized booking fields when the generator omits them.
                if field in event:
                    stored[field] = event[field]
            events.append(stored)
        else:
            events.append(event)
    for record in records:
        if record.event_key in matched:
            continue
        is_review_placeholder = bool(getattr(record, 'review_template_id', '')) or (
            record.event_type in {'mcr', 'progress-review', 'review'}
            and not _s(getattr(record, 'idempotency_key', '')).startswith('learner-book:')
        )
        if is_review_placeholder and record.status == CoachCalendarEvent.STATUS_NOT_SCHEDULED:
            continue
        events.append(_serialize_event(record, review_types_by_template=types, templates_by_id=templates))
    return events


def alternative_recovery_events_for_learner(learner_id):
    """Expose approved cross-group recovery occurrences on the learner calendar."""
    from coach_api.models import CoachAbsenceReport
    from .alternative_recovery import ALTERNATIVE_METHOD, alternative_target_details

    events = []
    reports = CoachAbsenceReport.objects.filter(
        learner_id=learner_id,
        status=CoachAbsenceReport.STATUS_APPROVED,
        recovery_method=ALTERNATIVE_METHOD,
    )
    for report in reports:
        target = alternative_target_details(report.catchup_event_key, include_join_url=True)
        if not target:
            continue
        try:
            start = datetime.fromisoformat(f"{target['dateIso']}T{target['startTime']}")
            end = datetime.fromisoformat(f"{target['dateIso']}T{target['endTime']}") if target.get('endTime') else None
            duration = max(1, int((end - start).total_seconds() // 60)) if end else 60
        except (KeyError, TypeError, ValueError):
            continue
        key = f"absence-alternative:{report.id}"
        events.append({
            "id": key,
            "eventKey": key,
            "title": target.get("title") or report.session_title,
            "source": "live-session",
            "type": "live-session",
            "sequence": 1,
            "status": CoachCalendarEvent.STATUS_SCHEDULED,
            "date": target["dateIso"],
            "targetDate": target["dateIso"],
            "scheduledDate": target["dateIso"],
            "scheduledTime": target["startTime"],
            "durationMinutes": duration,
            "coachName": "",
            "coachEmail": report.owner_email,
            "meetingProvider": "Microsoft Teams" if target.get("joinUrl") else "",
            "meetingLink": target.get("joinUrl") or "",
            "notes": "Alternative group session for an approved absence recovery plan.",
            "invited": True,
            "syncError": "",
            "syncState": CoachCalendarEvent.SYNC_SYNCED,
            "module": target.get("module") or report.session_title,
            "cohort": target.get("cohort") or "",
            "group": target.get("group") or "",
        })
    return events


def _resolve_direct_cycle_event_key(learner, mirror, session_type):
    """Resolve the single official, not-yet-booked Curriculum occurrence for a
    generic MCM/PR request that arrived without an eventKey (the learner used
    the general booking picker instead of an official calendar card).

    Reuses coaching_events_for_learner -- the same per-learner occurrence
    resolver the official calendar cards are built from -- instead of
    re-deriving Curriculum recurrence here, so this can never disagree with
    what the learner's calendar actually shows.

    Returns (event_key, None) on exactly one unambiguous match, or
    (None, (message, status)) otherwise. The caller must turn that into an
    error response rather than falling back to an unlinked booking: a review
    session must never reach reserve_coach_calendar_booking, which has no
    concept of Curriculum linkage at all.
    """
    unresolved = [
        event for event in coaching_events_for_learner(learner, mirror)
        if event.get('source') == session_type
        and event.get('status') == CoachCalendarEvent.STATUS_NOT_SCHEDULED
        and _s(event.get('reviewTemplateId'))
    ]
    if not unresolved:
        label = 'Monthly Coaching Meeting' if session_type == 'mcr' else 'Progress Review'
        return None, (
            f"No official {label} occurrence is currently due for scheduling. "
            "Contact your coach if you believe this is incorrect.",
            404,
        )
    # A Review's recurrence is generated many occurrences ahead, so a learner
    # can have several future not-yet-scheduled slots for the SAME template --
    # only the soonest of those is actually due. Ambiguity only arises when
    # more than one *template* (e.g. two enabled MCM Reviews on the same
    # programme) each have their own occurrence due at once.
    earliest_per_template: dict[str, dict] = {}
    for event in sorted(unresolved, key=lambda e: _s(e.get('targetDate'))):
        template_id = _s(event.get('reviewTemplateId'))
        earliest_per_template.setdefault(template_id, event)
    candidates = list(earliest_per_template.values())
    if len(candidates) > 1:
        return None, (
            "More than one official review occurrence is available to schedule. "
            "Open the specific occurrence from your calendar to schedule it.",
            409,
        )
    return candidates[0]['eventKey'], None


def _resolve_assignment_month_mcm_occurrence(learner, mirror):
    """The canonical Curriculum MCM occurrence an assignment_month booking
    should attach to.

    assignment_month is only an eligibility/date-window gate -- the caller
    separately checks the chosen scheduled_date against
    monthly_assignment.coaching_booking_bounds(assignment_month). It must
    never be allowed to invent the Review's own identity: Curriculum's
    review_templates/review_instances are the only source of truth for which
    MCM this is and when it is due (see the module docstring's architecture
    diagram). Before this function existed, an assignment_month request with
    no eventKey fell through to reserve_coach_calendar_booking exactly like
    the (now-guarded) generic direct-cycle-request path used to, creating a
    standalone event_type='mcr' row with review_template_id/review_instance_id
    left blank.

    Returns (event_key, None) on an unambiguous resolution, or
    (None, (message, status)) otherwise. The caller must turn that into an
    error response rather than falling back to an unlinked booking.
    """
    from coach_api.views import resolve_curriculum_programme_id, resolve_review_anchor_date
    from curriculum_api import review_types as curriculum_review_types
    from curriculum_api.review_instances import list_enabled_review_templates

    if mirror is None:
        return None, ("Only Active learners can book programme-cycle sessions.", 400)

    programme_id = resolve_curriculum_programme_id(
        getattr(mirror, 'programme_id', None) or getattr(mirror, 'programme', None),
    )
    if not programme_id:
        return None, ("No Monthly Coaching Meeting is configured for this learner's programme.", 422)

    mcm_type = curriculum_review_types.get_review_type_by_code(curriculum_review_types.REVIEW_TYPE_CODE_MCM)
    mcm_type_id = _s((mcm_type or {}).get('id'))
    mcm_templates = [
        template for template in list_enabled_review_templates(programme_id)
        if mcm_type_id and _s(template.get('review_type_id')) == mcm_type_id
    ]
    if not mcm_templates:
        return None, ("No Monthly Coaching Meeting is configured for this learner's programme.", 422)
    if len(mcm_templates) > 1:
        return None, (
            "More than one Monthly Coaching Meeting is configured for this learner's programme. "
            "Ask your programme team to resolve this before booking.",
            409,
        )

    # STRICT anchor: enrolment."Created_users"."Learner_start_date" only,
    # never Start_date, the profile mirror, or any other fallback -- same
    # rule resolve_review_anchor_date enforces everywhere else.
    source_rows = {mirror.id: learner} if learner is not None else {}
    anchor, _reason = resolve_review_anchor_date(mirror.id, {}, source_rows)
    if anchor is None:
        return None, ("Cannot schedule this review because the learner start date is missing.", 422)

    # Template configuration and the anchor are both confirmed -- the
    # remaining question ("which occurrence, of possibly several generated
    # ahead of time, is actually due") is exactly what the generic MCM
    # request already answers. Reuse it rather than re-deriving the same
    # "soonest not-yet-scheduled occurrence" rule a second time.
    return _resolve_direct_cycle_event_key(learner, mirror, "mcr")


def _resolve_assignment_month_progress_review_occurrence(learner, mirror):
    """The canonical Curriculum Progress Review occurrence an assignment_month
    booking should attach to (see _resolve_assignment_month_mcm_occurrence,
    which this mirrors).

    Unlike MCM, assignment_month carries no eligibility/date-window rule for
    Progress Review -- it is only bookkeeping context copied from the
    imported Aptem review (which month it came from), never a booking-window
    gate and never the Review's own identity. That identity, and which
    occurrence is actually due, comes from Curriculum's review_templates /
    review_instances exactly as it does for every other Progress Review
    request -- see _resolve_direct_cycle_event_key.

    Returns (event_key, None) on an unambiguous resolution, or
    (None, (message, status)) otherwise. The caller must turn that into an
    error response rather than falling back to an unlinked booking.
    """
    from coach_api.views import resolve_curriculum_programme_id, resolve_review_anchor_date
    from curriculum_api import review_types as curriculum_review_types
    from curriculum_api.review_instances import list_enabled_review_templates

    if mirror is None:
        return None, ("Only Active learners can book programme-cycle sessions.", 400)

    programme_id = resolve_curriculum_programme_id(
        getattr(mirror, 'programme_id', None) or getattr(mirror, 'programme', None),
    )
    if not programme_id:
        return None, ("No Progress Review is configured for this learner's programme.", 422)

    pr_type = curriculum_review_types.get_review_type_by_code(curriculum_review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
    pr_type_id = _s((pr_type or {}).get('id'))
    pr_templates = [
        template for template in list_enabled_review_templates(programme_id)
        if pr_type_id and _s(template.get('review_type_id')) == pr_type_id
    ]
    if not pr_templates:
        return None, ("No Progress Review is configured for this learner's programme.", 422)
    if len(pr_templates) > 1:
        return None, (
            "More than one Progress Review is configured for this learner's programme. "
            "Ask your programme team to resolve this before booking.",
            409,
        )

    # STRICT anchor: enrolment."Created_users"."Learner_start_date" only,
    # never Start_date, the profile mirror, or any other fallback -- same
    # rule resolve_review_anchor_date enforces everywhere else.
    source_rows = {mirror.id: learner} if learner is not None else {}
    anchor, _reason = resolve_review_anchor_date(mirror.id, {}, source_rows)
    if anchor is None:
        return None, ("Cannot schedule this review because the learner start date is missing.", 422)

    # Template configuration and the anchor are both confirmed -- reuse the
    # generic Progress Review request's own "soonest not-yet-scheduled
    # occurrence" rule rather than re-deriving it, and never use
    # assignment_month itself to pick or manufacture an occurrence.
    return _resolve_direct_cycle_event_key(learner, mirror, "progress-review")


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


def _follow_first_session_start_date(kind, pk, record, scheduled_date):
    """Move the programme start date with the first session, if that is what moved.

    Booking the first session writes its date to ``learner_start_date``
    (first_session._stamp) because the programme starts at that session. Moving
    the session therefore has to move the start date too: leaving it behind
    would make the record disagree with the meeting, and that column is the
    strict anchor review scheduling reads -- so the learner's whole review
    timeline would stay pinned to a day nothing happens on.

    Only ``first-session``. Every other bookable type is a session *within* a
    programme that has already started, and moving one must not shift the
    learner's start date.

    Failure is logged, not raised: the meeting has already moved in Graph and
    everybody has been re-invited by this point, so refusing the whole request
    would report a failure for something that did happen.
    """
    if _s(getattr(record, "event_type", "")).lower() != "first-session":
        return
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return
    try:
        from .learner_dates import save_enrolment_fields

        learner = model.all_learners.filter(pk=pk).first()
        if learner is None:
            return
        learner.learner_start_date = scheduled_date.isoformat()
        save_enrolment_fields(learner, ["learner_start_date"])
    except DatabaseError:
        logger.exception(
            "learner_calendar_reschedule: could not move the start date for learner %s", pk,
        )


def _learner_booking_record(kind, pk, event_key):
    """Resolve a learner-owned booking row that the learner is allowed to move."""
    record = _learner_calendar_record(kind, pk, event_key)
    if not record or _s(record.event_type) not in CANCELLABLE_TYPES:
        return None
    return record


@csrf_exempt
@learner_self_or_staff(kwarg="pk")
def learner_calendar_event_review(request, kind, pk, event_key):
    """Return the Curriculum form for a learner calendar event, or (POST)
    save the learner's own answers to whichever fields the Review's
    Curriculum template opted the Learner into answering.

    The endpoint never creates a review instance -- GET on an unscheduled
    occurrence exposes a read-only template preview; POST requires a booked
    instance to already exist (the coach's meeting is what creates it).
    """
    if request.method not in ("GET", "POST"):
        return _error("Method not allowed.", 405)
    if request.method == "POST":
        return _save_learner_review_answers(request, kind, pk, event_key)
    record = _learner_calendar_record(kind, pk, event_key)
    from curriculum_api import review_instances, reviews
    instance_id = _s(getattr(record, "review_instance_id", ""))
    if not instance_id:
        template_id = _s(getattr(record, 'review_template_id', ''))
        occurrence_number = getattr(record, 'occurrence_number', None) or getattr(record, 'sequence', None)
        if not record:
            model = SOURCE_MODELS.get(kind)
            learner = model.all_learners.filter(pk=pk).first() if model else None
            if learner is None:
                return _error('Calendar event not found for this learner.', 404)
            mirror = learner_profile_for_source(learner, pk, active_only=True)
            event = next((event for event in _generated_cycle_events(learner, mirror, set()) if event['eventKey'] == event_key), None)
            if event is None:
                return _error('Calendar event not found for this learner.', 404)
            template_id = event['reviewTemplateId']
            occurrence_number = event['occurrenceNumber']
        if not template_id:
            return JsonResponse({'instance': None})
        # A coach can open a generated Curriculum occurrence before a
        # CoachCalendarEvent booking row exists. In that case opening the
        # occurrence creates the durable instance, but the learner calendar
        # still reaches this endpoint through the generated event key. Resolve
        # that same instance by its stable identity instead of returning a
        # blank template preview.
        candidate_ids = [str(pk)]
        model = SOURCE_MODELS.get(kind)
        learner = model.all_learners.filter(pk=pk).first() if model else None
        if learner is not None:
            mirror = learner_profile_for_source(learner, pk, active_only=True)
            if mirror is not None and str(mirror.pk) not in candidate_ids:
                candidate_ids.append(str(mirror.pk))
        for candidate_id in candidate_ids:
            existing = review_instances.find_review_instance(template_id, candidate_id, occurrence_number)
            if existing:
                instance_id = _s(existing.get('id'))
                break
        if instance_id:
            instance = review_instances.get_review_instance(instance_id)
            if not instance:
                return _error("Review instance not found.", 404)
            definition = review_instances.review_instance_form_definition(instance)
            if not definition['template']['visibleTo'].get('participant', True):
                return _error('This review is not visible to the learner.', 403)
            return JsonResponse(_learner_visible_review_definition(definition))
        template = reviews.get_review_template_row(template_id, include_deleted=bool(record))
        if template is None:
            return _error('Review template not found.', 404)
        snapshot = review_instances.build_definition_snapshot(template)
        if not snapshot.get('visibleTo', {}).get('participant', True):
            return _error('This review is not visible to the learner.', 403)
        return JsonResponse({
            'instance': None, 'occurrenceNumber': occurrence_number,
            'template': snapshot, 'sections': snapshot['sections'],
            'signatures': {role: {'required': bool(snapshot['signatures'].get(role)), 'signed': False}
                           for role in review_instances.SIGNATURE_ROLES},
        })
    instance = review_instances.get_review_instance(instance_id)
    if not instance:
        return _error("Review instance not found.", 404)
    definition = review_instances.review_instance_form_definition(instance)
    if not definition['template']['visibleTo'].get('participant', True):
        return _error('This review is not visible to the learner.', 403)
    return JsonResponse(_learner_visible_review_definition(definition))


def _save_learner_review_answers(request, kind, pk, event_key):
    """POST /learner_api/calendar/<kind>/<pk>/events/<event_key>/review/

    Saves only the fields the Review's Curriculum template opted the
    Learner ('participant') into answering -- every other field stays the
    coach's/Curriculum's, exactly as before this endpoint accepted writes.
    """
    from curriculum_api import review_instances

    record = _learner_calendar_record(kind, pk, event_key)
    instance_id = _s(getattr(record, "review_instance_id", ""))
    if not instance_id:
        return _error("This review has not been booked yet.", 404)
    instance = review_instances.get_review_instance(instance_id)
    if not instance:
        return _error("Review instance not found.", 404)
    definition = review_instances.review_instance_form_definition(instance)
    if not definition['template']['visibleTo'].get('participant', True):
        return _error('This review is not visible to the learner.', 403)

    try:
        payload = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return _error("Invalid JSON body.", 400)
    answers = payload.get("answers")
    if not isinstance(answers, dict):
        return _error("answers must be an object keyed by field id.", 400)

    account = authenticate_request(request)
    actor = _s(getattr(account, "email", "")) or f"learner:{pk}"
    try:
        updated = review_instances.save_review_instance_answers_for_role(
            instance, answers, "participant", actor=actor,
        )
    except PermissionError as exc:
        return _error(str(exc), 403)
    except ValueError as exc:
        return _error(str(exc), 409)
    return JsonResponse(_learner_visible_review_definition(updated))


def _learner_visible_review_definition(definition):
    """Hide the formal MCM summary until the coach submits the Review."""
    if (
        (definition.get('template') or {}).get('reviewTypeCode') == 'mcm'
        and (definition.get('instance') or {}).get('status') not in {'awaiting-signature', 'completed'}
    ):
        from curriculum_api.review_instances import meeting_summary_field
        field = meeting_summary_field(definition)
        if field:
            field['answer'] = None
            field['answeredBy'] = None
            field['answeredAt'] = None
    return definition


@learner_self_or_staff(kwarg="pk")
def learner_calendar_event_review_pdf(request, kind, pk, event_key):
    """Download the signed MCM PDF for a learner-visible calendar review."""
    response = learner_calendar_event_review(request, kind, pk, event_key)
    if getattr(response, "status_code", 500) != 200:
        return response
    try:
        definition = json.loads(response.content.decode("utf-8"))
    except (AttributeError, UnicodeDecodeError, ValueError):
        return _error("Review definition could not be read.", 502)

    from curriculum_api.review_pdf import learner_information, mcm_pdf_response, pdf_availability

    if not (pdf_availability(definition) or {}).get("available"):
        return mcm_pdf_response(definition, {})

    model = SOURCE_MODELS.get(kind)
    learner = model.all_learners.filter(pk=pk).first() if model else None
    record = _learner_calendar_record(kind, pk, event_key)
    information = learner_information(
        learner,
        name=getattr(record, "learner_name", "") if record else "",
        programme=getattr(record, "programme", "") if record else "",
    )
    return mcm_pdf_response(definition, information)


@learner_self_or_staff(kwarg="pk")
def learner_calendar_event_artifacts(request, kind, pk, event_key):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    record = _learner_calendar_record(kind, pk, event_key)
    if not record:
        return _error("Calendar event not found for this learner.", 404)
    from coach_api.views import (
        apply_teams_attendance_status_transition,
        fetch_coach_meeting_graph_snapshot, persist_coach_meeting_snapshots,
    )
    snapshot, error_payload, status_code = fetch_coach_meeting_graph_snapshot(record)
    if error_payload:
        return JsonResponse(error_payload, status=status_code)
    # Opening this panel is not itself what moves a linked review to
    # in-progress -- reuses the attendance data the Graph fetch above already
    # returned for the panel's own reasons; see
    # coach_api.views.apply_teams_attendance_status_transition.
    apply_teams_attendance_status_transition(record, (snapshot.get("attendance") or {}).get("records") or [])
    storage = persist_coach_meeting_snapshots(
        record,
        artifacts=snapshot["artifacts"],
        attendance_reports=snapshot["attendanceReports"],
        attendance_tracker=snapshot["attendanceTracker"],
    )
    # Learners may watch the formal meeting recording, but transcripts remain
    # staff-only because they can contain sensitive discussion notes.
    learner_artifacts = [
        artifact for artifact in snapshot["artifacts"]
        if _s(artifact.get("artifact_type")).lower() == "recording"
    ]
    return JsonResponse({
        "artifacts": learner_artifacts,
        "attendance": snapshot["attendance"],
        # Mutable AI drafts never cross the learner boundary. The lifecycle-
        # gated formal answer is returned by learner_calendar_event_review.
        "meetingSummary": None,
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
    allowed_types = {"recording"}
    if _s(artifact_type).lower() not in allowed_types:
        return _error("Only meeting recordings are available to learners.", 403)
    from coach_api.views import coach_meeting_artifact_content_response
    return coach_meeting_artifact_content_response(request, record, event_key, artifact_type, artifact_id)


@csrf_exempt
@learner_self_or_staff(kwarg="pk")
def learner_progress_review_sign(request, kind, pk, event_key):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    record = _learner_calendar_record(kind, pk, event_key)
    if not record or record.event_type not in {"mcr", "progress-review", "review"}:
        return _error("Review not found for this learner.", 404)
    # Curriculum Review instances are the canonical form/signature record.
    # Keep the old calendar blob only for rows created before instances existed.
    if _s(getattr(record, 'review_instance_id', '')):
        from curriculum_api import review_instances
        try:
            payload = json.loads(request.body or b"{}")
        except (TypeError, ValueError):
            return _error("Invalid JSON body.", 400)
        signature = _s(payload.get("signature"))
        if not signature.startswith("data:image/"):
            return _error("A valid learner signature is required.", 400)
        if record.status not in {CoachCalendarEvent.STATUS_AWAITING_SIGNATURE, CoachCalendarEvent.STATUS_COMPLETED}:
            return _error("The coach must submit the review before the learner can sign it.", 409)
        instance = review_instances.get_review_instance(record.review_instance_id)
        if not instance:
            return _error("Review instance not found.", 404)
        try:
            definition = review_instances.record_review_instance_signature(
                instance, "participant", signed_by=_s(record.learner_email),
                signed_name=_s(payload.get("name")) or _s(record.learner_name),
                signature=signature, actor=_s(record.learner_email) or "learner",
            )
        except ValueError as exc:
            return _error(str(exc), 409)
        # record_review_instance_signature already projected the instance's new
        # status onto this Calendar row, transactionally and with link-identity
        # checks (curriculum_api.review_instances
        # ._mirror_linked_calendar_after_signature). Writing it again here would
        # be a second, unguarded lifecycle decision -- re-read instead.
        record.refresh_from_db()
        return JsonResponse({"event": _serialize_event(record), "review": definition})
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
        events.extend(alternative_recovery_events_for_learner(pk))

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
    is_first_session = session_type == FIRST_SESSION_TYPE
    if session_type not in BOOKABLE_TYPES and not is_onboarding_review:
        allowed = "', '".join((*BOOKABLE_TYPES, *ONBOARDING_REVIEW_TYPES))
        return _error(f"sessionType must be one of '{allowed}'.", 400)

    owner_staff_id = None
    if is_onboarding_review or is_first_session:
        # Booked before the learner is Active and before a coach exists, so
        # these go to the case owner (enrolment officer) rather than a coach.
        #
        # The first session is the clearest case: it is the meeting that starts
        # the programme, so requiring an Active mirror to book it would be
        # circular -- the learner cannot become Active until it has happened.
        owner_email, owner_name, owner_staff_id = _case_owner_record(learner)
        if not owner_email:
            return _error(
                "No case owner has been assigned to you yet. Please contact your programme team.", 400
            )
        if is_first_session:
            # There is only ever one first session. Without this a learner
            # could book a second from a stale tab and end up with two
            # meetings, two invitations and a start date that follows whichever
            # was written last -- moving it is what reschedule is for.
            try:
                existing = (
                    CoachCalendarEvent.objects.filter(
                        learner_id=pk, event_type=FIRST_SESSION_TYPE
                    )
                    .exclude(status=CoachCalendarEvent.STATUS_CANCELLED)
                    .exists()
                )
            except DatabaseError as exc:
                logger.exception("learner_calendar_book: first-session check failed")
                return _error(f"Database error: {exc}", 502)
            if existing:
                return _error(
                    "Your first learning session is already booked. "
                    "Contact your case owner if you need to change it.", 409
                )
    else:
        if mirror is None:
            return _error("Only Active learners can book coach sessions.", 400)
        # The source learner carries the current assignment. A mirror can lag
        # after reassignment, and an explicitly cleared source assignment must
        # not silently send a new invite to the former coach.
        owner_email = _s(
            getattr(learner, "coach_email", mirror.coach_email)
            if hasattr(learner, "coach_email") else mirror.coach_email
        )
        owner_name = _s(
            getattr(learner, "coach_name", mirror.coach_name)
            if hasattr(learner, "coach_name") else mirror.coach_name
        ) or "Coach"
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
    assignment_month = _s(payload.get("assignmentMonth")) if session_type in {"mcr", "progress-review"} else ""
    imported_review_id = _s(payload.get("reviewId")) if assignment_month else ""
    # The assignment screen and imported reviews both send assignmentMonth.
    # An explicit context keeps their eligibility rules and identities separate.
    assignment_booking = _s(payload.get("bookingContext")) == "monthly-assignment"
    if assignment_booking and (session_type != "mcr" or not assignment_month or _s(payload.get("reviewId"))):
        return _error("Monthly assignment bookings require an MCM, an assignment month, and no imported review.", 400)
    # Requests opened from the generic learner modal go to the coach for
    # approval. Programme-cycle rows opened from an official calendar card
    # retain their existing direct scheduling flow.
    direct_cycle_request = session_type in {"mcr", "progress-review"} and not _s(payload.get("eventKey")) and not assignment_month
    if direct_cycle_request:
        # A generic MCM/PR request must still resolve to an official Curriculum
        # occurrence -- it must never fall through to the generic
        # reserve_coach_calendar_booking path below, which has no concept of
        # review_template_id/review_instance_id and would create an unlinked
        # calendar row (see coach_timetable_schedule_event's own linkage guard
        # for the matching coach-side rule).
        if mirror is None:
            return _error("Only Active learners can book programme-cycle sessions.", 400)
        resolved_event_key, resolution_error = _resolve_direct_cycle_event_key(learner, mirror, session_type)
        if resolution_error:
            message, status_code = resolution_error
            return _error(message, status_code)
        payload = {**payload, "eventKey": resolved_event_key}
        direct_cycle_request = False
    requires_coach_approval = (
        session_type in {"student-support", "gateway", "other"}
        or direct_cycle_request
    ) and not is_onboarding_review
    calendar_learner_id = int(mirror.id) if mirror is not None and not is_onboarding_review else pk

    if assignment_month:
        if not imported_review_id and not assignment_booking:
            return _error("reviewId is required when scheduling an imported monthly coaching review.", 400)
        if session_type == "mcr":
            from .monthly_assignment import coaching_booking_bounds, coaching_booking_windows
            windows = (coaching_booking_windows(assignment_month) if assignment_booking
                       else [coaching_booking_bounds(assignment_month)])
            if duration_minutes != 60 or not any(start and start <= scheduled_date <= end for start, end in windows):
                if assignment_booking:
                    return _error("Book a 60-minute MCM within either monthly assignment booking window.", 400)
                return _error("Book a 60-minute MCM from the last ten days of the submission month through the 5th of the following month.", 400)
            if not _s(payload.get("eventKey")):
                # assignment_month is an eligibility gate (the window check
                # above), never the Review's identity -- resolve the actual
                # canonical Curriculum occurrence instead of falling through
                # to the generic reserve_coach_calendar_booking path below,
                # which has no concept of review_template_id/review_instance_id
                # and would create an unlinked standalone 'mcr' row (see
                # _resolve_assignment_month_mcm_occurrence).
                resolved_event_key, resolution_error = _resolve_assignment_month_mcm_occurrence(learner, mirror)
                if resolution_error:
                    message, status_code = resolution_error
                    return _error(message, status_code)
                payload = {**payload, "eventKey": resolved_event_key}
        elif session_type == "progress-review":
            # No MCM-style booking-window check here: assignment_month for a
            # Progress Review is bookkeeping context copied from the imported
            # Aptem review (which month it came from), never an eligibility
            # window and never the Review's identity -- see
            # _resolve_assignment_month_progress_review_occurrence.
            if not _s(payload.get("eventKey")):
                resolved_event_key, resolution_error = _resolve_assignment_month_progress_review_occurrence(learner, mirror)
                if resolution_error:
                    message, status_code = resolution_error
                    return _error(message, status_code)
                payload = {**payload, "eventKey": resolved_event_key}

    # A supplied event key means the learner opened an official generated
    # programme slot. Without one, MCM/PR requests from the general picker use
    # the normal coach-approval path (including imported-review bookings).
    if session_type == 'review' and not _s(payload.get('eventKey')):
        return _error('Open a configured review from your calendar to schedule it.', 400)
    if session_type in {"mcr", "progress-review", "review"} and _s(payload.get("eventKey")):
        event_key = _s(payload.get("eventKey"))
        if not event_key:
            return _error(
                "Open the Monthly Coaching or Progress Review slot from your calendar and schedule that session.",
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

        from coach_api.views import (
            require_review_template_for_first_linkage,
            ReviewTemplateUnavailableError,
        )

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
            review_template_id = _s(base_event.get('reviewTemplateId'))
            # A review-driven event must not become scheduled unless canonical
            # linkage is guaranteed. Rescheduling an already-linked row never
            # re-resolves the template -- that instance stays valid even if
            # its template is later archived (see coach_timetable_schedule_event
            # for the matching coach-side rule).
            first_time_linkage = bool(review_template_id) and not record.review_instance_id
            if first_time_linkage:
                try:
                    require_review_template_for_first_linkage(review_template_id)
                except ReviewTemplateUnavailableError as exc:
                    return _error(str(exc), 409)

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
            record.review_template_id = review_template_id
            record.occurrence_number = (
                None if base_event.get('occurrenceSource') == 'manual'
                else int(base_event.get('occurrenceNumber') or base_event.get('sequence') or 1)
            )

            record = persist_calendar_sync_reservation(record, review_event=base_event)
            record, warning, _attempted = synchronize_reserved_calendar_event(record.pk, base_event)
        except ReviewTemplateUnavailableError as exc:
            return _error(str(exc), 409)
        except LearnerCalendarConflict as exc:
            return _error(str(exc), 409)
        except CalendarSyncInProgress:
            return _error("Calendar event synchronization is already in progress.", 409)
        except DatabaseError as exc:
            logger.exception("learner_calendar_book: generated cycle booking failed")
            return _error(f"Database error: {exc}", 502)

        _mark_imported_review_scheduled(
            payload.get("reviewId"), mirror.id, scheduled_date, scheduled_time,
        )
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
        if assignment_month:
            booking_kind = "mcm" if session_type == "mcr" else session_type
            idempotency_key = f"learner-book:{booking_kind}:{kind}:{pk}:{assignment_month}:{imported_review_id or 'legacy'}"
        elif supplied_key:
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
            idempotency_key = (
                f"learner-book:request:{session_type}:{digest}"
                if session_type in {"mcr", "progress-review"}
                else f"learner-book:{digest}"
            )

        replay = CoachCalendarEvent.objects.filter(
            owner_email=owner_email.strip().lower(),
            idempotency_key=idempotency_key,
        ).first()
        if replay is None and assignment_month and imported_review_id:
            # Reuse bookings created by the previous month-only key format.
            replay = CoachCalendarEvent.objects.filter(
                owner_email=owner_email.strip().lower(),
                idempotency_key=f"learner-book:{booking_kind}:{kind}:{pk}:{assignment_month}",
            ).first()
        if replay is not None:
            if assignment_month:
                replay.scheduled_date = scheduled_date
                replay.scheduled_time = scheduled_time
                replay.duration_minutes = duration_minutes
                replay.status = CoachCalendarEvent.STATUS_SCHEDULED
                replay = persist_calendar_sync_reservation(replay)
                replay, warning, _attempted = synchronize_reserved_calendar_event(
                    replay.pk, build_booked_calendar_event(replay)
                )
                _mark_imported_review_scheduled(
                    imported_review_id, replay.learner_id, scheduled_date, scheduled_time,
                )
                return JsonResponse(
                    {"event": _serialize_event(replay), "warning": _friendly_sync_warning(warning)},
                    status=200,
                )
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
        if assignment_month and imported_review_id:
            # Imported Aptem rows are not generated calendar events. Persist the
            # booking on the exact Reviews row so a fresh page load reads the
            # same status and date from the database.
            _mark_imported_review_scheduled(
                imported_review_id, mirror.id, scheduled_date, scheduled_time,
            )
    except CalendarSyncInProgress:
        return _error("Calendar event synchronization is already in progress.", 409)
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
    # The programme starts at the first session, so booking one sets the
    # learner's start date. This used to be done by first_session._stamp when
    # the enrolment form did the booking; the learner books it themselves now,
    # and the date has to follow either way -- it is the anchor review
    # scheduling reads, and the enrolment header states it.
    _follow_first_session_start_date(kind, pk, record, scheduled_date)

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
        sync_scheduled_review_instance,
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
            and record.sync_state == CoachCalendarEvent.SYNC_SYNCED
        ):
            if getattr(record, 'review_instance_id', ''):
                record = sync_scheduled_review_instance(record)
            _mark_imported_review_scheduled(
                payload.get("reviewId"), record.learner_id, scheduled_date, scheduled_time,
            )
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
            record.pk, build_booked_calendar_event(record)
        )
        _mark_imported_review_scheduled(
            payload.get("reviewId"), record.learner_id, scheduled_date, scheduled_time,
        )
        _follow_first_session_start_date(kind, pk, record, scheduled_date)
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
    from coach_api.views import (
        cancel_reserved_calendar_event,
        delete_calendar_event_from_graph,
        LearnerCalendarConflict,
    )

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

        is_review_booking = (
            record.event_type in {'mcr', 'progress-review', 'review'}
            or _s(getattr(record, 'review_template_id', ''))
            or _s(getattr(record, 'review_instance_id', ''))
        )
        if is_review_booking:
            if record.status in {CoachCalendarEvent.STATUS_COMPLETED, CoachCalendarEvent.STATUS_AWAITING_SIGNATURE}:
                return _error('A submitted or completed review cannot be cancelled.', 409)
            record, warning = cancel_reserved_calendar_event(record)
            return JsonResponse({'event': _serialize_event(record), 'warning': _friendly_sync_warning(warning)})

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
    except LearnerCalendarConflict as exc:
        return _error(str(exc), 409)
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


def _already_started(learner):
    """Whether this learner's programme is already running.

    Active is the whole test. Being Active *is* the statement that the
    programme is under way, so there is no first session left to arrange --
    whether or not a start date was ever written, and whether or not the
    session was booked through this flow at all.

    A start date is deliberately not also required. Active learners who have
    none are real (a learner activated before their session was arranged, or
    one carried in from an older route), and requiring the date sent exactly
    those learners to the booking screen, which is the lockout this branch
    exists to prevent.

    The one thing this must not swallow is the waiting state: a learner with a
    session booked for a future day is *not* Active yet, so they still get the
    holding screen and the day still has to arrive.
    """
    return programme_status(learner).casefold() == "active"


@learner_self_or_staff(kwarg="pk")
def learner_first_session(request, kind, pk):
    """Whether this learner has booked their first session, and when.

        GET /learner_api/calendar/<kind>/<id>/first-session/

    -> {caseOwner: {name, email} | null, booked: bool, event: {...} | null,
        startsOn: "YYYY-MM-DD" | null, access: "book" | "waiting" | "open"}

    The first session used to be arranged by whoever enrolled the learner. It is
    now the learner's own first task: they sign in, book it with their case
    owner, and wait until the day.

    ``access`` is the whole gate in one word, decided here rather than in the
    browser -- a learner must not be able to reach their programme early by
    changing a date on their own machine:

    * ``book``    -- nothing booked yet; the learner books it.
    * ``waiting`` -- booked, but the day has not arrived.
    * ``open``    -- the session day has come (or passed), so the programme runs
      normally from here. Also any Active learner, whose programme is running
      whether or not a session was ever booked through here
      (``_already_started``).

    Computed on every request rather than stored, so nothing has to run
    overnight to let a learner in, and moving the session takes effect at once.
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
        record = (
            CoachCalendarEvent.objects.filter(learner_id=pk, event_type=FIRST_SESSION_TYPE)
            .exclude(status=CoachCalendarEvent.STATUS_CANCELLED)
            .order_by("-sequence")
            .first()
        )
    except DatabaseError as exc:
        logger.exception("learner_first_session: lookup failed")
        return _error(f"Database error: {exc}", 502)

    owner_email, owner_name = _case_owner_contact(learner)
    starts_on = record.scheduled_date if record is not None else None

    if first_session_imported_from_aptem(learner):
        # An Aptem learner arrives with a start date and a history behind them,
        # and book_first_session skips them entirely -- so they will never have
        # one of these. Holding them out until a session that is never going to
        # be booked would lock them out of their own programme for good.
        access = "open"
    elif _already_started(learner):
        # An Active learner's programme is already running, so there is no
        # first session left to arrange. Asking them to book one would hold a
        # learner out of a programme they are part-way through -- the same
        # permanent lockout the Aptem case above avoids, reached by a different
        # route (activated outside this booking flow, or before it existed).
        access = "open"
    elif starts_on is None:
        access = "book"
    else:
        # The college's own day. A learner abroad must not reach their
        # programme a day early, nor be held out a day late, because of where
        # they happen to be -- the session happens in Kent either way.
        access = "waiting" if starts_on > first_session_uk_today() else "open"

    response = JsonResponse({
        "caseOwner": {"name": owner_name, "email": owner_email} if owner_email else None,
        "booked": record is not None,
        "event": _serialize_event(record) if record is not None else None,
        "startsOn": starts_on.isoformat() if starts_on else None,
        "access": access,
    })
    # Never cached: ``access`` turns over at midnight UK time, so a stored copy
    # would hold a learner out on the morning of their own session, or let them
    # in the day before.
    response["Cache-Control"] = "private, no-store"
    return response
