"""Review reads without loading the learner's lectures or recovery calendar."""
import logging

from django.db import DatabaseError
from django.http import JsonResponse

from coach_api.meeting_outcomes import annotate_meeting_outcomes
from login.permissions import learner_self_or_staff

from .booking_calendar import booking_calendar_payload
from .calendar import _calendar_profile, coaching_events_for_learner
from .learner_detail import SOURCE_MODELS
from .models import attach_programme_name

logger = logging.getLogger(__name__)
REVIEW_SOURCES = frozenset({"mcr", "progress-review", "review"})


@learner_self_or_staff(kwarg="pk")
def learner_review_sessions(request, kind, pk):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({"error": "Unknown learner kind."}, status=404)
    content = request.GET.get("content", "full")
    if content not in {"summary", "full"}:
        return JsonResponse({"error": "Unknown review content mode."}, status=400)
    try:
        learner = model.all_learners.defer("status", "programme").filter(pk=pk).first()
        if learner is None:
            return JsonResponse({"error": "Learner not found."}, status=404)
        attach_programme_name(learner)
        mirror = _calendar_profile(learner, pk)
        # Keep source selection, booking identity, signatures and local Aptem
        # continuations in the same reader as the calendar. Only list reads
        # omit historical section bodies; the detail view still receives them.
        options = {"only_sources": REVIEW_SOURCES} if content == "summary" else {}
        events = coaching_events_for_learner(learner, mirror, **options)
        events = list({
            event.get("eventKey") or event.get("id"): event
            for event in events
            if (event.get("eventKey") or event.get("id")) and (
                event.get("source") in REVIEW_SOURCES or event.get("reviewTemplateId")
                or event.get("importedReview")
            )
        }.values())
        events.sort(key=lambda event: (
            event.get("date") or event.get("targetDate") or "",
            event.get("source") or "", event.get("sequence") or 0,
        ))
        if content == "summary":
            # Older imports embed sections in review_data even when the
            # separate section-table read is skipped by the source adapter.
            events = [{**event, "importedReview": {**event["importedReview"], "sections": []}}
                      if isinstance(event.get("importedReview"), dict) else event for event in events]
        annotate_meeting_outcomes(events)
    except DatabaseError:
        logger.exception("learner_review_sessions: review lookup failed")
        return JsonResponse({"error": "Could not load programme sessions. Please try again."}, status=502)
    return JsonResponse({
        "learner": {"kind": kind, "id": pk},
        "events": events,
        "bookingCalendar": booking_calendar_payload(),
    })
