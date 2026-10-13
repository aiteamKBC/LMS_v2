"""Review ownership and read-only Aptem continuation linkage shared by both roles.

An imported row owns the occurrence. Calendar rows and form overlays supply
local state; neither dates nor email addresses establish that relationship.
"""
from dataclasses import dataclass

from django.db import DatabaseError
from django.db.models import Q

from learner_api.student_activity_access import student_activity_available


class ReviewIdentityConflict(DatabaseError):
    pass


@dataclass(frozen=True)
class ReviewSource:
    kind: str
    aptem_id: int | None = None


def resolve_review_source(source_aptem_id=None, profile_aptem_id=None):
    """The existing coach rule: enrolment first, profile fallback, fail closed."""
    source_id = int(str(source_aptem_id).strip()) if student_activity_available(source_aptem_id) else None
    profile_id = int(str(profile_aptem_id).strip()) if student_activity_available(profile_aptem_id) else None
    if source_id and profile_id and source_id != profile_id:
        return ReviewSource("conflict")
    effective = source_id or profile_id
    return ReviewSource("aptem", effective) if effective else ReviewSource("curriculum")


def source_for_learner(source, profile):
    return resolve_review_source(getattr(source, "aptem_id", None), getattr(profile, "aptem_id", None))


def review_profile_for_source(source, profile=None):
    """Resolve without the general identity helper's opportunistic DB writes.

    Stable enrolment/Aptem links precede the unique legacy email fallback.
    A conflicting or multiply-owned link is never reclassified as Native.
    """
    from learner_api.models import EnrolmentUser, LearnerProfile

    source_pk = getattr(source, "pk", None)
    if profile is None:
        matches = list(LearnerProfile.objects.filter(enrolment_id=source_pk)[:2]) if source_pk else []
        if not matches and student_activity_available(getattr(source, "aptem_id", None)):
            matches = list(LearnerProfile.objects.filter(aptem_id=int(str(source.aptem_id).strip()))[:2])
            if any(item.enrolment_id not in (None, source_pk) for item in matches):
                raise ReviewIdentityConflict("The Aptem profile belongs to another enrolment.")
        if not matches and not student_activity_available(getattr(source, "aptem_id", None)):
            email = str(getattr(source, "email", "") or "").strip()
            if email:
                matches = list(LearnerProfile.objects.filter(email__iexact=email, enrolment_id__isnull=True)[:2])
                if matches and EnrolmentUser.all_learners.filter(email__iexact=email).exclude(pk=source_pk).exists():
                    raise ReviewIdentityConflict("The legacy Review profile is ambiguous.")
        if len(matches) > 1:
            raise ReviewIdentityConflict("More than one Review profile matches this learner.")
        profile = matches[0] if matches else None
    if source_for_learner(source, profile).kind == "conflict":
        raise ReviewIdentityConflict("Conflicting Aptem learner identities.")
    return profile


def imported_identity(review, profile_id):
    """Keep both source IDs; the Aptem event key remains the existing form key."""
    return {
        "reviewSource": "aptem", "reviewId": str(review["id"]),
        "aptemReviewId": review["aptemReviewId"], "importedReviewType": review["type"],
        "learnerId": str(profile_id),
        "sourceStatus": review["status"], "rawStatus": review.get("rawStatus", review["status"]),
        "sourcePlannedDate": review.get("plannedDate"),
        "sourceCompletedDate": review.get("completedDate"),
    }


def enrolment_for_review_profile(profile):
    """Reverse the same stable bridge for participant authorization, without writes."""
    from learner_api.models import EnrolmentUser

    if profile is None:
        return None
    if profile.enrolment_id:
        source = EnrolmentUser.all_learners.filter(pk=profile.enrolment_id).first()
    elif student_activity_available(profile.aptem_id):
        matches = list(EnrolmentUser.all_learners.filter(aptem_id=str(profile.aptem_id))[:2])
        source = matches[0] if len(matches) == 1 else None
    else:
        source = None
    if source is None or source_for_learner(source, profile).kind != "aptem":
        return None
    return source


def imported_learner_identity(profile):
    enrolment_id = getattr(profile, "enrolment_id", None)
    kind = "commercial" if getattr(profile, "learner_type", "") == "commercial" else "apprenticeship"
    if not enrolment_id:
        source = enrolment_for_review_profile(profile)
        if source:
            enrolment_id = source.pk
            kind = getattr(source, "learner_type", "") or kind
    return {"enrolmentId": str(enrolment_id) if enrolment_id else None, "learnerType": kind}


def linked_overlay(event, overlays):
    matches = [row for row in overlays
               if str(row.learner_id) == str(event.get("learnerId"))
               and ((row.source_review_id is not None and str(row.source_review_id) == event.get("reviewId"))
                    or (row.source_review_id is None and row.event_key == event["eventKey"]))]
    if len(matches) > 1:
        raise ReviewIdentityConflict("More than one continuation matches the imported Review.")
    return matches[0] if matches else None


def linked_booking(event, records, overlay=None):
    """Use durable keys, checking the ID space of legacy learner bookings."""
    matches = []
    for row in records:
        exact_key = row.event_key == event["eventKey"] or (overlay is not None and row.event_key == overlay.event_key)
        profile_owned = str(row.learner_id) == str(event.get("learnerId"))
        if exact_key and (not profile_owned or row.event_type != event["source"]
                          or row.review_instance_id or row.review_template_id):
            raise ReviewIdentityConflict("The imported Review calendar association is inconsistent.")
        if row.event_type != event["source"]:
            continue
        parts = (row.idempotency_key or "").split(":")
        legacy = (len(parts) == 6 and parts[0] == "learner-book"
                  and parts[1] == ("mcm" if event["source"] == "mcr" else "progress-review")
                  and parts[2] == event.get("learnerType")
                  and parts[3] == str(event.get("enrolmentId"))
                  and parts[5] == event.get("reviewId"))
        legacy_owned = legacy and str(row.learner_id) in {str(event.get("learnerId")), str(event.get("enrolmentId"))}
        if (profile_owned and exact_key) or legacy_owned:
            if overlay and row.owner_email.casefold() != overlay.owner_email.casefold():
                raise ReviewIdentityConflict("The imported Review booking has a conflicting owner.")
            matches.append(row)
    # Never silently choose between two real appointments for one source row.
    if len(matches) > 1:
        raise ReviewIdentityConflict("More than one booking matches the imported Review.")
    return matches[0] if matches else None


def load_imported_links(events, *, records=None, compact=False):
    from .models import CoachCalendarEvent, ImportedReviewInstance

    if not events:
        return {}, {}
    profile_ids = {int(event["learnerId"]) for event in events}
    review_ids = {int(event["reviewId"]) for event in events if event.get("reviewId")}
    keys = {event["eventKey"] for event in events}
    overlay_query = ImportedReviewInstance.objects.filter(learner_id__in=profile_ids).filter(
        Q(source_review_id__in=review_ids) | Q(event_key__in=keys))
    if compact:
        overlay_query = overlay_query.only('id', 'learner_id', 'source_review_id', 'event_key', 'owner_email', 'status', 'completed_at')
    overlays = list(overlay_query)
    if records is None:
        enrolment_ids = {int(event["enrolmentId"]) for event in events if str(event.get("enrolmentId", "")).isdigit()}
        records = list(CoachCalendarEvent.objects.filter(
            Q(event_key__in=keys) | Q(learner_id__in=profile_ids | enrolment_ids,
                                     event_type__in={event["source"] for event in events})))
    booking_map, overlay_map = {}, {}
    for event in events:
        overlay = linked_overlay(event, overlays)
        booking_map[event["eventKey"]] = linked_booking(event, records, overlay)
        overlay_map[event["eventKey"]] = overlay
    return booking_map, overlay_map


def booking_for_imported_review(profile, review, overlay=None, *, lock=False):
    """Resolve the same durable appointment from a form or its occurrence."""
    from .models import CoachCalendarEvent
    from .migrated_reviews import booking_event_type, review_family

    event = {**imported_identity(review, profile.id),
             "eventKey": f"imported-review:{review['aptemReviewId']}",
             "source": booking_event_type(review_family(review["type"])),
             **imported_learner_identity(profile)}
    if not event["source"]:
        return None
    ids = {profile.id}
    if str(event["enrolmentId"] or "").isdigit():
        ids.add(int(event["enrolmentId"]))
    query = CoachCalendarEvent.objects
    if lock:
        query = query.select_for_update()
    keys = {event["eventKey"]}
    if overlay is not None:
        keys.add(overlay.event_key)
    records = query.filter(Q(event_key__in=keys) | Q(learner_id__in=ids, event_type=event["source"]))
    return linked_booking(event, records, overlay)


def booking_for_overlay(overlay, *, lock=False):
    """Keep legacy imported bookings available to completion/PDF/summary reads."""
    from .models import CoachCalendarEvent
    from learner_api.models import LearnerProfile

    query = CoachCalendarEvent.objects.filter(event_key=overlay.event_key)
    if lock:
        query = query.select_for_update()
    current = list(query[:2])
    if len(current) > 1:
        raise ReviewIdentityConflict("More than one booking matches the imported Review.")
    if current:
        record = current[0]
        if (record.owner_email.casefold() != overlay.owner_email.casefold()
                or record.learner_id != overlay.learner_id
                or record.review_instance_id or record.review_template_id
                or record.event_type not in {"mcr", "progress-review"}):
            raise ReviewIdentityConflict("The imported Review calendar association is inconsistent.")
        return record
    profile = LearnerProfile.objects.filter(pk=overlay.learner_id).first()
    if not profile or not overlay.source_review_id:
        return None
    # Family is only a filter. Internal review ID in the durable key is the link.
    matches = []
    for review_type in ("Monthly Coaching Meeting", "Progress Review"):
        review = {"id": overlay.source_review_id, "aptemReviewId": overlay.event_key.removeprefix("imported-review:"),
                  "type": review_type, "status": "not-scheduled"}
        record = booking_for_imported_review(profile, review, overlay, lock=lock)
        if record:
            matches.append(record)
    if len(matches) > 1:
        raise ReviewIdentityConflict("More than one booking matches the imported Review.")
    return matches[0] if matches else None


def enrich_imported_events(events):
    from .views import overlay_calendar_record

    bookings, overlays = load_imported_links(events)
    return [overlay_calendar_record(event, bookings.get(event["eventKey"]), overlays.get(event["eventKey"]))
            for event in events]


def standalone_review_records(records, profiles, aptem_profile_ids, *, linked_keys=()):
    """Suppress parallel Aptem reviews, respecting legacy enrolment ID space."""
    identities = {row.id: imported_learner_identity(row) for row in profiles if row.id in aptem_profile_ids}
    enrolments = {(item["learnerType"], item["enrolmentId"]) for item in identities.values() if item["enrolmentId"]}
    result = []
    for record in records:
        if record.event_key in linked_keys:
            continue
        if record.event_type in {"mcr", "progress-review", "review"}:
            parts = (record.idempotency_key or "").split(":")
            if len(parts) >= 4 and parts[0] == "learner-book":
                if (parts[2], parts[3]) in enrolments:
                    continue
            elif record.learner_id in aptem_profile_ids:
                continue
        result.append(record)
    return result


def apply_imported_state(event, record=None, overlay=None, *, compact=False):
    """Pure read adapter. Never changes source evidence or a meeting identity."""
    event = dict(event)
    from learner_api.review_history import _normalise_status

    source_status = _normalise_status(event.get("sourceStatus") or event.get("status"))
    historical = source_status == "completed" or bool(event.get("sourceCompletedDate"))
    effective = "completed" if historical else source_status
    migrated = bool(not compact and not historical and overlay and overlay.source_review_id
                    and isinstance(overlay.template_snapshot, dict) and overlay.template_snapshot.get("sections"))
    if record:
        # Pending/failed sync must not claim a successful external booking.
        verified = bool(record.sync_state == "synced" and record.graph_event_id
                        and (record.meeting_link or record.graph_web_link))
        if not historical and (verified or record.status in {"completed", "awaiting-signature", "cancelled", "failed"}):
            effective = record.status
        event.update({
            "calendarEventId": str(record.pk), "calendarEventKey": record.event_key,
            "bookingStatus": record.status, "syncState": record.sync_state,
            "scheduledDate": record.scheduled_date.isoformat() if record.scheduled_date else None,
            "scheduledTime": record.scheduled_time.strftime("%H:%M") if record.scheduled_time else None,
            "durationMinutes": record.duration_minutes,
            "meetingLink": (record.meeting_link or record.graph_web_link or "") if verified else "",
            "graphWebLink": (record.graph_web_link or "") if verified else "", "meetingProvider": record.meeting_provider or "",
            "coachName": record.owner_name or "", "coachEmail": record.owner_email or "",
            "invited": verified, "reviewResponses": {} if compact else record.review_responses or {},
        })
        if record.scheduled_date:
            event["date"] = record.scheduled_date.isoformat()
    else:
        event["calendarEventKey"] = None
    if not historical and overlay:
        local = _normalise_status(overlay.status)
        # An unstarted form must not demote an existing, verified appointment.
        if local != "not-scheduled" or effective == "not-scheduled":
            effective = local
        event["localStatus"] = local
        if overlay.completed_at:
            event["reviewCompletedAt"] = overlay.completed_at.isoformat()
    event.update({"status": effective, "effectiveLmsStatus": effective, "migratedForm": migrated})
    if migrated:
        event["hasReviewForm"] = True
        event["formEventKey"] = overlay.event_key
    # A legacy booking may carry old native linkage, which is not the form for
    # this occurrence. Keep the stored row intact; expose the imported form.
    event["reviewInstanceId"] = None
    event["reviewTemplateId"] = None
    return event


def number_imported_events(events):
    """Display sequence only; equal dates never collapse distinct source rows."""
    counters = {}
    ordered = sorted(events, key=lambda item: (
        item.get("sourcePlannedDate") or item.get("sourceCompletedDate") or "9999-12-31",
        int(item["reviewId"]), item.get("aptemReviewId", "")))
    for event in ordered:
        family = (event["learnerId"], event["source"])
        counters[family] = counters.get(family, 0) + 1
        event["sequence"] = counters[family]
        event["occurrenceNumber"] = None
    return ordered
