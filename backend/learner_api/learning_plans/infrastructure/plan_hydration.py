"""Concrete ORM and SQL readers for normalized Learning Plan hydration."""

from django.db import connections
from django.db.models import prefetch_related_objects

from learner_api.learning_plans.application.hydration import NORMALIZED_PLAN_PREFETCH
from learner_api.learning_plans.domain.stored_plan import clean_text
from learner_api.models import LearnerProfile


def read_normalized_plan(source, profile=None, *, profile_id=None):
    """Read the complete normalized plan with its ORM ownership boundary."""
    source_id = getattr(source, "pk", None) or getattr(source, "id", None)
    if profile is None:
        query = LearnerProfile.objects.only("id", "enrolment_id").filter(
            enrolment_id=source_id,
        )
        if profile_id is not None:
            query = query.filter(pk=profile_id)
        profile = query.prefetch_related(NORMALIZED_PLAN_PREFETCH).first()
    else:
        if source_id is None or profile.enrolment_id != source_id:
            raise ValueError("The learner profile does not own this enrolment source.")
        prefetch_related_objects([profile], NORMALIZED_PLAN_PREFETCH)

    return profile.training_plan if profile is not None else []


def compact_plan_from_rows(rows):
    """Convert the ordered compact SQL projection into the legacy plan tree."""
    modules = {}
    weeks = {}
    for (
        module_pk,
        module_id,
        module_title,
        week_pk,
        week_id,
        week_title,
        _component_pk,
        component_id,
    ) in rows:
        if not module_id:
            continue
        module = modules.setdefault(module_pk, {
            "moduleId": clean_text(module_id),
            "moduleTitle": clean_text(module_title),
            "weeks": [],
        })
        if week_pk is None or not week_id:
            continue
        week = weeks.get(week_pk)
        if week is None:
            week = {
                "weekId": clean_text(week_id),
                "weekTitle": clean_text(week_title),
                "components": [],
            }
            weeks[week_pk] = week
            module["weeks"].append(week)
        if component_id:
            week["components"].append({"componentId": clean_text(component_id)})
    return list(modules.values())


def read_normalized_plan_modules(source, profile):
    """Read a compact normalized plan tree in one ordered SQL query."""
    source_id = getattr(source, "pk", None) or getattr(source, "id", None)
    if source_id is None or profile.enrolment_id != source_id:
        raise ValueError("The learner profile does not own this enrolment source.")
    using = getattr(getattr(profile, "_state", None), "db", None) or "enrolment"
    with connections[using].cursor() as cursor:
        cursor.execute('''
            SELECT plan_module.id,plan_module.curriculum_module_id,module.title,
                   plan_week.id,plan_week.curriculum_week_id,week.title,
                   plan_component.id,plan_component.curriculum_component_id
            FROM "Learner".learner_training_plan_modules plan_module
            LEFT JOIN curriculum.modules module
              ON module.module_catalogue_id=plan_module.curriculum_module_id
            LEFT JOIN "Learner".learner_training_plan_weeks plan_week
              ON plan_week.plan_module_id=plan_module.id
            LEFT JOIN curriculum.weeks week
              ON week.id=plan_week.curriculum_week_id
            LEFT JOIN "Learner".learner_training_plan_components plan_component
              ON plan_component.plan_week_id=plan_week.id
            WHERE plan_module.learner_id=%s
            ORDER BY plan_module.position,plan_module.id,
                     plan_week.position,plan_week.id,
                     plan_component.position,plan_component.id
        ''', [profile.pk])
        rows = cursor.fetchall()
    return compact_plan_from_rows(rows)
