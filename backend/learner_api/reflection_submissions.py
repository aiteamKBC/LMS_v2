"""Persist the complete seven-step learner reflection for tutor review."""

import json
import logging
import uuid
from datetime import date

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .reflection_submission_tables import ensure_learning_reflection_submissions_table

logger = logging.getLogger(__name__)

VALID_KINDS = {"commercial", "apprenticeship"}


def _error(message, status=400):
    return JsonResponse({"error": message}, status=status)


def _text(value):
    return str(value or "").strip()


def _dict(value):
    return value if isinstance(value, dict) else {}


def _list(value):
    return value if isinstance(value, list) else []


@csrf_exempt
def create_reflection_submission(request):
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    try:
        payload = json.loads(request.body or b"{}")
    except (TypeError, ValueError):
        return _error("Request body must be valid JSON.")

    learner_kind = _text(payload.get("learnerKind"))
    learner_id = _text(payload.get("learnerId"))
    activity_type = _text(payload.get("activityType"))
    activity_id = _text(payload.get("activityId"))
    learning_reflection = _text(payload.get("learningReflection"))

    if learner_kind not in VALID_KINDS:
        return _error("A valid learnerKind is required.")
    if not learner_id:
        return _error("learnerId is required.")
    if not activity_type or not activity_id:
        return _error("activityType and activityId are required.")
    if not learning_reflection:
        return _error("learningReflection is required.")

    raw_date = _text(payload.get("dateCompleted"))
    try:
        date_completed = date.fromisoformat(raw_date) if raw_date else None
    except ValueError:
        return _error("dateCompleted must use YYYY-MM-DD format.")

    quality_score = payload.get("qualityScore", 0)
    try:
        quality_score = max(0, min(100, int(quality_score)))
    except (TypeError, ValueError):
        quality_score = 0

    submission_id = uuid.uuid4()
    full_submission = dict(payload)

    try:
        ensure_learning_reflection_submissions_table()
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                """
                insert into "Learner"."learning_reflection_submissions" (
                    id, learner_kind, learner_id, learner_name, programme_name,
                    activity_type, activity_id, activity_title, module_title,
                    week_title, planned_otjh, learning_reflection, ksb_codes,
                    ksb_explanations, confidence_before, confidence_after,
                    application_type, application_text, evidence_files,
                    evidence_consent_confirmed, selected_benefits,
                    benefit_explanation, actual_time_hours,
                    completed_during_paid_hours, date_completed, otjh_confirmed,
                    signed_declaration, quality_score, full_submission
                ) values (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s::jsonb,
                    %s::jsonb, %s::jsonb, %s::jsonb,
                    %s, %s, %s::jsonb,
                    %s, %s::jsonb,
                    %s, %s,
                    %s, %s, %s,
                    %s, %s, %s::jsonb
                )
                on conflict (learner_kind, learner_id, activity_type, activity_id)
                do update set
                    learner_name = excluded.learner_name,
                    programme_name = excluded.programme_name,
                    activity_title = excluded.activity_title,
                    module_title = excluded.module_title,
                    week_title = excluded.week_title,
                    planned_otjh = excluded.planned_otjh,
                    status = 'submitted_for_tutor_review',
                    learning_reflection = excluded.learning_reflection,
                    ksb_codes = excluded.ksb_codes,
                    ksb_explanations = excluded.ksb_explanations,
                    confidence_before = excluded.confidence_before,
                    confidence_after = excluded.confidence_after,
                    application_type = excluded.application_type,
                    application_text = excluded.application_text,
                    evidence_files = excluded.evidence_files,
                    evidence_consent_confirmed = excluded.evidence_consent_confirmed,
                    selected_benefits = excluded.selected_benefits,
                    benefit_explanation = excluded.benefit_explanation,
                    actual_time_hours = excluded.actual_time_hours,
                    completed_during_paid_hours = excluded.completed_during_paid_hours,
                    date_completed = excluded.date_completed,
                    otjh_confirmed = excluded.otjh_confirmed,
                    signed_declaration = excluded.signed_declaration,
                    quality_score = excluded.quality_score,
                    full_submission = excluded.full_submission,
                    submitted_at = now()
                returning id
                """,
                [
                    str(submission_id),
                    learner_kind,
                    learner_id,
                    _text(payload.get("learnerName")),
                    _text(payload.get("programmeName")),
                    activity_type,
                    activity_id,
                    _text(payload.get("activityTitle")),
                    _text(payload.get("moduleTitle")),
                    _text(payload.get("weekTitle")),
                    _text(payload.get("plannedOtjh")),
                    learning_reflection,
                    json.dumps(_list(payload.get("ksbCodes"))),
                    json.dumps(_dict(payload.get("ksbExplanations"))),
                    json.dumps(_dict(payload.get("confidenceBefore"))),
                    json.dumps(_dict(payload.get("confidenceAfter"))),
                    _text(payload.get("applicationType")),
                    _text(payload.get("applicationText")),
                    json.dumps(_list(payload.get("evidenceFiles"))),
                    bool(payload.get("evidenceConsentConfirmed")),
                    json.dumps(_list(payload.get("selectedBenefits"))),
                    _text(payload.get("benefitExplanation")),
                    _text(payload.get("actualTimeHours")),
                    _text(payload.get("completedDuringPaidHours")),
                    date_completed,
                    bool(payload.get("otjhConfirmed")),
                    bool(payload.get("signedDeclaration")),
                    quality_score,
                    json.dumps(full_submission),
                ],
            )
            stored_id = cur.fetchone()[0]
    except DatabaseError:
        logger.exception("Could not save learner reflection submission.")
        return _error("Could not save the reflection for tutor review.", 502)

    return JsonResponse(
        {
            "id": str(stored_id),
            "status": "submitted_for_tutor_review",
        },
        status=201,
    )
