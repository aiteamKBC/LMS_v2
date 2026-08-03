"""Relational learner persistence helpers.

The module name is retained for import compatibility. Runtime data is stored in
``Learner.learners`` and its normalized child tables; the former Active/Unactive
JSON tables are not read or written here.
"""

import json
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
    lower_text = text.lower()
    hour_matches = [float(amount) for amount in re.findall(r"(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b", lower_text)]
    minute_matches = [float(amount) for amount in re.findall(r"(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b", lower_text)]
    if hour_matches or minute_matches:
        return sum(hour_matches) * 60 + sum(minute_matches)

    match = re.search(r"\d+(?:\.\d+)?", lower_text)
    if not match:
        return 0.0
    value = float(match.group(0))
    # Small bare numbers are learner-entered hours ("2" => 2h). Larger bare
    # values usually come from component duration fields stored as minutes.
    return value if value > 24 else value * 60


def fmt_hours(hours):
    try:
        value = round(float(hours), 1)
    except (TypeError, ValueError):
        return "0"
    return str(int(value)) if value == int(value) else str(value)


def _progress_text(record, *fields):
    for field in fields:
        value = _s(record.get(field))
        if value:
            return value
    return ""


def otjh_progress_dedupe_key(record, index=0):
    if not isinstance(record, dict):
        return f"entry:{index}"

    kind = _s(record.get("kind")).lower()
    quiz_id = _s(record.get("quizId"))
    if quiz_id:
        return f"quiz:{quiz_id}"

    component_id = _s(record.get("componentId"))
    if component_id:
        return f"component:{component_id}"

    title = _progress_text(record, "title", "quizName", "componentTitle", "component")
    module = _progress_text(record, "moduleTitle", "module")
    week = _progress_text(record, "weekTitle", "week")
    if title:
        return "|".join(part for part in ("legacy", kind, module, week, title) if part)

    ksbs = ",".join(sorted(_s(code).upper() for code in record.get("ksbs") or [] if _s(code)))
    reported_time = _s(record.get("reportedTime")).lower()
    if kind or reported_time or ksbs:
        return "|".join(part for part in ("legacy", kind, reported_time, ksbs) if part)

    return f"entry:{index}"


def dedupe_otjh_progress_records(progress):
    if not isinstance(progress, list):
        return []
    seen = set()
    unique = []
    for index, record in enumerate(progress):
        if not isinstance(record, dict):
            continue
        key = otjh_progress_dedupe_key(record, index)
        if key in seen:
            continue
        seen.add(key)
        unique.append(record)
    return unique


def _component_expected_hours_lookup(components):
    lookup = {}
    if not isinstance(components, list):
        return lookup

    for item in components:
        if not isinstance(item, dict):
            continue
        nested_weeks = item.get("weeks")
        if isinstance(nested_weeks, list):
            for week in nested_weeks:
                for component in (week.get("components") or []) if isinstance(week, dict) else []:
                    component_id = _s(component.get("componentId") or component.get("id"))
                    expected = _number(component.get("expectedOtjh") or component.get("expected_otjh"))
                    if component_id and expected is not None:
                        lookup[component_id] = expected
            continue

        component_id = _s(item.get("componentId") or item.get("id"))
        expected = _number(item.get("expectedOtjh") or item.get("expected_otjh"))
        if component_id and expected is not None:
            lookup[component_id] = expected
    return lookup


def completed_hours_from_progress(progress, components=None):
    if not isinstance(progress, list):
        return "0"
    expected_hours_by_component = _component_expected_hours_lookup(components)
    hours = 0.0
    for record in dedupe_otjh_progress_records(progress):
        component_id = _s(record.get("componentId"))
        expected_hours = expected_hours_by_component.get(component_id)
        if expected_hours is not None:
            hours += expected_hours
            continue
        hours += _reported_minutes(record.get("reportedTime")) / 60
    return fmt_hours(hours)


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
                # Table was renamed cohort_authoring_details -> cohorts by
                # curriculum_api migration 0004; same columns.
                'SELECT start_date, end_date FROM curriculum."cohorts" '
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


def _plan_module_ids(training_plan):
    module_ids = []
    for module in training_plan or []:
        if not isinstance(module, dict):
            continue
        module_id = _s(module.get("moduleId"))
        if module_id:
            module_ids.append(module_id)
    return sorted(set(module_ids))


def _ksb_sort_key(code):
    text = _s(code).upper()
    prefix = text[:1]
    suffix = text[1:]
    parts = []
    for token in re.findall(r"\d+|[A-Z]+", suffix):
        parts.append((0, int(token)) if token.isdigit() else (1, token))
    return (
        {"K": 0, "S": 1, "B": 2}.get(prefix, 99),
        tuple(parts),
        text,
    )


def _ksb_type_from_code(code):
    return {
        "K": "Knowledge",
        "S": "Skills",
        "B": "Behaviours",
    }.get(_s(code).upper()[:1], "")


def _ksb_number_from_code(code):
    text = _s(code).upper()
    return text[1:].strip() if len(text) > 1 else ""


def _clean_ksb_profile_source_id(value):
    text = _s(value)
    if text.lower().startswith("profile:"):
        return text.split(":", 1)[1].strip()
    return text


def _ksb_code_from_parts(code="", ksb_type=""):
    raw_code = _s(code).upper()
    raw_type = _s(ksb_type).upper()
    if raw_code and raw_code[:1] in {"K", "S", "B"}:
        return raw_code
    prefix = raw_type[:1] if raw_type[:1] in {"K", "S", "B"} else ""
    if prefix and raw_code:
        return f"{prefix}{raw_code}"
    return raw_code


def _coerce_ksb_items(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return []
    if not isinstance(value, list):
        return []

    items = []
    for position, item in enumerate(value, 1):
        if not isinstance(item, dict):
            continue
        code = _ksb_code_from_parts(item.get("code"), item.get("type"))
        number = _s(item.get("number")) or _ksb_number_from_code(code) or _s(item.get("code"))
        description = _s(item.get("description")) or _s(item.get("title"))
        raw_type = _s(item.get("type"))
        normalized_type = _ksb_type_from_code(code) or {
            "KNOWLEDGE": "Knowledge",
            "K": "Knowledge",
            "SKILL": "Skills",
            "SKILLS": "Skills",
            "S": "Skills",
            "BEHAVIOUR": "Behaviours",
            "BEHAVIOURS": "Behaviours",
            "BEHAVIOR": "Behaviours",
            "BEHAVIORS": "Behaviours",
            "B": "Behaviours",
        }.get(raw_type.upper(), raw_type)
        display_order = item.get("displayOrder")
        try:
            display_order = int(display_order)
        except (TypeError, ValueError):
            display_order = position
        if not code:
            continue
        items.append(
            {
                "code": code,
                "number": number,
                "type": normalized_type,
                "description": description,
                "_display_order": display_order,
            }
        )

    items.sort(key=lambda item: (item.get("_display_order", 0), _ksb_sort_key(item.get("code"))))
    for item in items:
        item.pop("_display_order", None)
    return items


def _resolve_programme_id(programme="", training_plan=None):
    module_ids = _plan_module_ids(training_plan)
    if module_ids:
        try:
            with connections["enrolment"].cursor() as cursor:
                cursor.execute(
                    "SELECT DISTINCT programme_id FROM curriculum.modules "
                    "WHERE module_catalogue_id = ANY(%s) AND programme_id IS NOT NULL AND programme_id <> '' "
                    "ORDER BY programme_id LIMIT 1",
                    [module_ids],
                )
                row = cursor.fetchone()
        except DatabaseError as exc:
            logger.warning("Could not resolve programme id from module snapshot for %s: %s", module_ids, exc)
        else:
            if row and _s(row[0]):
                return _s(row[0])

    programme = _s(programme)
    if not programme:
        return ""
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT COALESCE(NULLIF(program_id, ''), NULLIF(name, '')) AS programme_id "
                "FROM curriculum.programmes "
                "WHERE lower(btrim(COALESCE(name, ''))) = lower(%s) "
                "   OR lower(btrim(COALESCE(program_id, ''))) = lower(%s) "
                "   OR lower(%s) LIKE lower(btrim(COALESCE(name, ''))) || ' %%' "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [programme, programme, programme],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not resolve programme id for %s: %s", programme, exc)
        return ""
    return _s(row[0]) if row else ""


def _fetch_ksb_items_for_programme(programme_id, programme):
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT ksb_items FROM curriculum.ksb_profiles "
                "WHERE is_active AND ("
                "      (%s <> '' AND programme_id = %s) "
                "   OR (programme_name = %s OR %s LIKE programme_name || ' %%')"
                ") "
                "ORDER BY CASE "
                "    WHEN %s <> '' AND programme_id = %s THEN 0 "
                "    WHEN programme_name = %s THEN 1 "
                "    ELSE 2 "
                "END, updated_at DESC NULLS LAST LIMIT 1",
                [programme_id, programme_id, programme, programme, programme_id, programme_id, programme],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not find KSB profile for %s / %s: %s", programme_id, programme, exc)
        return []
    return _coerce_ksb_items(row[0]) if row else []


def _fetch_ksb_items_from_plan_mappings(programme_id="", programme="", training_plan=None):
    module_ids = _plan_module_ids(training_plan)
    if not module_ids:
        return []
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT DISTINCT ON (upper(mapping.ksb_code)) "
                "       upper(mapping.ksb_code) AS code, "
                "       COALESCE(NULLIF(mapping.ksb_description, ''), '') AS description "
                "FROM curriculum.ksb_mappings mapping "
                "LEFT JOIN curriculum.modules module ON module.module_catalogue_id = mapping.module_catalogue_id "
                "WHERE mapping.module_catalogue_id = ANY(%s) "
                "  AND mapping.ksb_code IS NOT NULL "
                "  AND mapping.ksb_code <> '' "
                "  AND ("
                "        (%s = '' AND %s = '') "
                "     OR module.programme_id = %s "
                "     OR module.programme_name = %s "
                "     OR %s LIKE module.programme_name || ' %%'"
                "  ) "
                "ORDER BY upper(mapping.ksb_code), "
                "         CASE mapping.classification "
                "             WHEN 'main' THEN 0 "
                "             WHEN 'secondary' THEN 1 "
                "             WHEN 'possible' THEN 2 "
                "             ELSE 3 "
                "         END, "
                "         mapping.weight DESC, "
                "         mapping.ksb_description",
                [module_ids, programme_id, programme, programme_id, programme, programme],
            )
            rows = cursor.fetchall()
    except DatabaseError as exc:
        logger.warning("Could not derive KSBs from plan mappings for %s / %s: %s", programme_id, programme, exc)
        return []
    items = [
        {
            "code": code,
            "number": _ksb_number_from_code(code),
            "type": _ksb_type_from_code(code),
            "description": _s(description),
        }
        for code, description in rows
        if _s(code)
    ]
    return sorted(items, key=lambda item: _ksb_sort_key(item.get("code")))


def _resolve_ksb_profile_source_id(programme_id="", programme="", training_plan=None):
    module_ids = _plan_module_ids(training_plan)
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT COALESCE(NULLIF(ksb_profile_source_id, ''), '') "
                "FROM curriculum.programmes "
                "WHERE (%s <> '' AND programme_id = %s) "
                "   OR name = %s "
                "   OR %s LIKE name || ' %%' "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [programme_id, programme_id, programme, programme],
            )
            row = cursor.fetchone()
            source_id = _clean_ksb_profile_source_id(row[0]) if row else ""
            if source_id:
                return source_id
            if not module_ids:
                return ""
            cursor.execute(
                "SELECT COALESCE(NULLIF(module.ksb_profile_source_id, ''), '') "
                "FROM curriculum.modules module "
                "WHERE module.module_catalogue_id = ANY(%s) "
                "  AND module.ksb_profile_source_id IS NOT NULL "
                "  AND module.ksb_profile_source_id <> '' "
                "  AND ("
                "        (%s = '' AND %s = '') "
                "     OR module.programme_id = %s "
                "     OR module.programme_name = %s "
                "     OR %s LIKE module.programme_name || ' %%'"
                "  ) "
                "ORDER BY module.updated_at DESC NULLS LAST LIMIT 1",
                [module_ids, programme_id, programme, programme_id, programme, programme],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not resolve KSB profile source for %s / %s: %s", programme_id, programme, exc)
        return ""
    return _clean_ksb_profile_source_id(row[0]) if row else ""


def _fetch_ksb_items_from_profile_source(profile_source_id):
    profile_source_id = _clean_ksb_profile_source_id(profile_source_id)
    if not profile_source_id:
        return []
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT ksb_items FROM curriculum.ksb_profiles "
                "WHERE is_active AND (id = %s OR ksb_profile_id = %s) "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [profile_source_id, profile_source_id],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not find KSB profile from source %s: %s", profile_source_id, exc)
        return []
    return _coerce_ksb_items(row[0]) if row else []


def _fetch_ksb_items(programme, training_plan=None):
    programme = _s(programme)
    programme_id = _resolve_programme_id(programme, training_plan=training_plan)
    if not programme and not programme_id:
        return []
    items = _fetch_ksb_items_for_programme(programme_id, programme)
    if items:
        return items
    profile_source_id = _resolve_ksb_profile_source_id(
        programme_id=programme_id,
        programme=programme,
        training_plan=training_plan,
    )
    if profile_source_id:
        items = _fetch_ksb_items_from_profile_source(profile_source_id)
        if items:
            return items
    items = _fetch_ksb_items_from_plan_mappings(
        programme_id=programme_id,
        programme=programme,
        training_plan=training_plan,
    )
    if items:
        return items
    return []


def refresh_learner_ksb_snapshot(learner, source, training_plan=None):
    plan = training_plan if training_plan is not None else get_training_plan(source)
    items = _fetch_ksb_items(getattr(source, "programme", None), training_plan=plan)
    if items:
        replace_learner_ksbs(learner, items)
    return items


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
                training_plan = get_training_plan(source)
                replace_training_plan(learner, training_plan)
                refresh_learner_ksb_snapshot(learner, source, training_plan=training_plan)
        return learner if status.lower() == ACTIVE_STATUS else None
    except DatabaseError as exc:
        logger.warning("Could not sync learner %s: %s", source.id, exc)
        return None
