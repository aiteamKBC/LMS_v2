"""Learner adapter over the same imported occurrences used by the coach."""
from django.db import connection

from coach_api.review_sources import load_imported_links
from .review_history import _review_rows, _sections_by_review, _serialize_review


def imported_events_for_learner(source, profile, aptem_id, records):
    from coach_api.views import fetch_aptem_review_events, overlay_calendar_record

    if profile is None:
        return []
    events, _ = fetch_aptem_review_events(
        [profile], {profile.id: aptem_id}, owner_email=profile.coach_email or "",
        owner_name=profile.coach_name or "")
    if not events:
        return []
    # Preserve the other historical Aptem types already visible in Reviews too.
    types = tuple(dict.fromkeys(event["importedReviewType"] for event in events))
    # Source identity, not profile.email, is authoritative for these rows.
    for event in events:
        event["enrolmentId"] = str(source.pk)
        event["learnerType"] = getattr(source, "learner_type", "") or getattr(profile, "learner_type", "")
    with connection.cursor() as cursor:
        rows = _review_rows(cursor, profile.id, types)
        sections = _sections_by_review(cursor, [row["id"] for row in rows])
    history = {str(row["id"]): _serialize_review(row, sections) for row in rows}
    bookings, overlays = load_imported_links(events, records=records)
    result = []
    for event in events:
        review = history.get(event["reviewId"])
        if review is None:
            continue
        item = overlay_calendar_record(event, bookings[event["eventKey"]], overlays[event["eventKey"]])
        item.update({
            "importedReview": review,
            "reviewTypeCode": "mcm" if event["source"] == "mcr" else "progress_review",
            "reviewTypeName": review["type"], "reviewTemplateId": None, "reviewInstanceId": None,
            "coachName": item.get("coachName") or review["reviewerName"],
            "coachEmail": item.get("coachEmail") or "",
        })
        result.append(item)
    return result
