"""Relational learner persistence helpers.

The module name is retained for import compatibility. Runtime data is stored in
``Learner.learners`` and its normalized child tables; the former Active/Unactive
JSON tables are not read or written here.
"""

import logging
import re
from datetime import timedelta

from django.db import DatabaseError, connections, transaction
from django.db.models import Max
from django.utils.dateparse import parse_datetime

from .mappers import get_training_plan
from .models import (
    LearnerActivityEvent,
    LearnerKsb,
    LearnerProfile,
    LearnerProgressEntry,
    LearnerProgressKsb,
    LearnerQuizAnswer,
    LearnerQuizChosenAnswer,
    LearnerQuizCorrectAnswer,
    LearnerTrainingPlanComponent,
    LearnerTrainingPlanModule,
    LearnerTrainingPlanWeek,
)

logger = logging.getLogger(__name__)
ACTIVE_STATUS = "active"


def _s(value):
    return "" if value is None else str(value).strip()


def _number(value):
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _datetime(value):
    if not value:
        return None
    return value if hasattr(value, "tzinfo") else parse_datetime(str(value))


def _reported_minutes(value):
    text = _s(value)
    if not text:
        return 0.0
    if ":" in text:
        try:
            minutes, seconds, *_ = [float(part) for part in text.split(":")]
            return minutes + seconds / 60
        except (TypeError, ValueError):
            return 0.0
    match = re.search(r"\d+(?:\.\d+)?", text)
    if not match:
        return 0.0
    amount = float(match.group(0))
    return amount * 60 if "hour" in text.lower() or "hr" in text.lower() else amount


def fmt_hours(hours):
    try:
        value = round(float(hours), 1)
    except (TypeError, ValueError):
        return "0"
    return str(int(value)) if value == int(value) else str(value)


def completed_hours_from_progress(progress):
    if not isinstance(progress, list):
        return "0"
    minutes = sum(
        _reported_minutes(record.get("reportedTime"))
        for record in progress
        if isinstance(record, dict)
    )
    return fmt_hours(minutes / 60)


def append_activity_entry(learner, entry):
    if learner is None:
        return None
    next_order = (
        LearnerActivityEvent.objects.filter(learner=learner)
        .aggregate(value=Max("event_order"))["value"]
        or 0
    ) + 1
    return LearnerActivityEvent.objects.create(
        learner=learner,
        event_order=next_order,
        kind=_s(entry.get("kind")),
        action=_s(entry.get("action")),
        title=_s(entry.get("title")),
        detail=_s(entry.get("detail")),
        component_ref=_s(entry.get("componentId")) or None,
        component_type=_s(entry.get("componentType")),
        quiz_ref=_s(entry.get("quizId")) or None,
        module_title=_s(entry.get("module")),
        week_title=_s(entry.get("week")),
        passed=entry.get("passed") if isinstance(entry.get("passed"), bool) else None,
        occurred_at=_datetime(entry.get("at")),
    )


def replace_training_plan(learner, plan):
    LearnerTrainingPlanModule.objects.filter(learner=learner).delete()
    for module_position, module in enumerate(plan or [], 1):
        module_row = LearnerTrainingPlanModule.objects.create(
            learner=learner,
            position=module_position,
            module_ref=_s(module.get("moduleId")) or None,
            module_title=_s(module.get("moduleTitle")),
        )
        for week_position, week in enumerate(module.get("weeks") or [], 1):
            week_row = LearnerTrainingPlanWeek.objects.create(
                plan_module=module_row,
                position=week_position,
                week_ref=_s(week.get("weekId")) or None,
                week_title=_s(week.get("weekTitle")),
            )
            LearnerTrainingPlanComponent.objects.bulk_create(
                [
                    LearnerTrainingPlanComponent(
                        plan_week=week_row,
                        position=position,
                        component_ref=_s(component.get("componentId")) or None,
                        component_title=_s(component.get("componentTitle")),
                    )
                    for position, component in enumerate(week.get("components") or [], 1)
                ]
            )


def replace_learner_ksbs(learner, items):
    LearnerKsb.objects.filter(learner=learner).delete()
    LearnerKsb.objects.bulk_create(
        [
            LearnerKsb(
                learner=learner,
                position=position,
                code=_s(item.get("code")),
                number=_s(item.get("number")),
                ksb_type=_s(item.get("type")),
                description=_s(item.get("description")),
            )
            for position, item in enumerate(items or [], 1)
            if isinstance(item, dict)
        ]
    )


def save_progress_record(learner, record, activity=None):
    """Store one progress record and all child rows atomically."""
    if learner is None:
        return None
    with transaction.atomic(using="enrolment"):
        # Serialize writes per learner so two simultaneous submissions cannot
        # claim the same entry/event order.
        learner = LearnerProfile.objects.select_for_update().get(pk=learner.pk)
        next_order = (
            LearnerProgressEntry.objects.filter(learner=learner)
            .aggregate(value=Max("entry_order"))["value"]
            or 0
        ) + 1
        progress = LearnerProgressEntry.objects.create(
            learner=learner,
            entry_order=next_order,
            kind=_s(record.get("kind")) or "quiz",
            module_ref=_s(record.get("moduleId")) or None,
            module_title=_s(record.get("moduleTitle") or record.get("module")),
            week_ref=_s(record.get("weekId")) or None,
            week_title=_s(record.get("weekTitle") or record.get("week")),
            component_ref=_s(record.get("componentId")) or None,
            component_title=_s(record.get("componentTitle")),
            component_type=_s(record.get("componentType")),
            quiz_ref=_s(record.get("quizId")) or None,
            attempt=record.get("attempt"),
            grade=_number(record.get("grade", record.get("Score"))),
            achieved_score=_number(record.get("achievedScore")),
            total_score=_number(record.get("totalScore")),
            passed=record.get("passed") if isinstance(record.get("passed"), bool) else None,
            feedback=_s(record.get("feedback")),
            reported_time=_s(record.get("reportedTime")),
            started_at=_datetime(record.get("startedAt")),
            submitted_at=_datetime(record.get("submittedAt")),
            time_taken=_s(record.get("timeTaken")),
        )
        LearnerProgressKsb.objects.bulk_create(
            [
                LearnerProgressKsb(progress=progress, position=position, ksb_code=_s(code))
                for position, code in enumerate(record.get("ksbs") or [], 1)
            ]
        )
        for position, answer in enumerate(record.get("questions") or [], 1):
            chosen = answer.get("chosenAnswerId")
            answer_row = LearnerQuizAnswer.objects.create(
                progress=progress,
                position=position,
                question_ref=int(answer.get("questionId")),
                chosen_answer_ref=chosen if not isinstance(chosen, list) else None,
                is_correct=answer.get("correct") if isinstance(answer.get("correct"), bool) else None,
                earned=_number(answer.get("earned")),
            )
            LearnerQuizCorrectAnswer.objects.bulk_create(
                [
                    LearnerQuizCorrectAnswer(
                        quiz_answer=answer_row,
                        position=key_position,
                        answer_ref=int(answer_ref),
                    )
                    for key_position, answer_ref in enumerate(answer.get("correctAnswerId") or [], 1)
                ]
            )
            LearnerQuizChosenAnswer.objects.bulk_create(
                [
                    LearnerQuizChosenAnswer(
                        quiz_answer=answer_row,
                        position=choice_position,
                        answer_ref=int(answer_ref),
                    )
                    for choice_position, answer_ref in enumerate(
                        chosen if isinstance(chosen, list) else [],
                        1,
                    )
                ]
            )
        if activity:
            append_activity_entry(learner, activity)
        learner.completed_hours = _number(
            completed_hours_from_progress(learner.training_plan_progress)
        )
        learner.save(update_fields=["completed_hours", "updated_at"])
        return progress


def recompute_completed_hours(learner_id):
    try:
        learner = LearnerProfile.objects.filter(id=learner_id).first()
        if learner is None:
            return None
        value = completed_hours_from_progress(learner.training_plan_progress)
        learner.completed_hours = _number(value)
        learner.save(update_fields=["completed_hours", "updated_at"])
        return value
    except DatabaseError as exc:
        logger.warning("Could not recompute learner hours for %s: %s", learner_id, exc)
        return None


def cohort_dates(programme, cohort):
    programme, cohort = _s(programme), _s(cohort)
    if not programme or not cohort:
        return None, None
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                'SELECT start_date, end_date FROM curriculum."cohort_authoring_details" '
                "WHERE lower(btrim(programme_name)) = lower(%s) "
                "AND lower(btrim(cohort_name)) = lower(%s) "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [programme, cohort],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not find cohort dates for %s / %s: %s", programme, cohort, exc)
        return None, None
    return (row[0], row[1]) if row else (None, None)


def _fetch_ksb_items(programme):
    programme = _s(programme)
    if not programme:
        return []
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT ksb_items FROM curriculum.ksb_profiles "
                "WHERE is_active AND (programme_name = %s OR %s LIKE programme_name || ' %%') "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [programme, programme],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not find KSB profile for %s: %s", programme, exc)
        return []
    return row[0] if row and isinstance(row[0], list) else []


def sync_active_user(source):
    """Upsert one permanent learner and refresh authored plan/KSB child rows."""
    status = _s(getattr(source, "programme_status", ""))
    start_date, end_date = cohort_dates(
        getattr(source, "programme", None),
        getattr(source, "cohort", None),
    )
    defaults = {
        "full_name": _s(getattr(source, "username", ""))
        or _s(getattr(source, "email", ""))
        or f"Learner {source.id}",
        "email": _s(getattr(source, "email", "")) or f"learner-{source.id}@invalid.local",
        "phone_number": _s(getattr(source, "phone_number", "")),
        "lifecycle_status": "active" if status.lower() == ACTIVE_STATUS else status.lower() or "inactive",
        "programme": _s(getattr(source, "programme", "")),
        "programme_status": status,
        "cohort": _s(getattr(source, "cohort", "")),
        "group_name": _s(getattr(source, "group", "")),
        "start_date": start_date,
        "end_date": end_date,
        "gateway_review_date": end_date - timedelta(days=90) if end_date else None,
    }
    try:
        with transaction.atomic(using="enrolment"):
            learner, _ = LearnerProfile.objects.update_or_create(id=source.id, defaults=defaults)
            if status.lower() == ACTIVE_STATUS:
                replace_training_plan(learner, get_training_plan(source))
                replace_learner_ksbs(learner, _fetch_ksb_items(source.programme))
        return learner if status.lower() == ACTIVE_STATUS else None
    except DatabaseError as exc:
        logger.warning("Could not sync learner %s: %s", source.id, exc)
        return None
