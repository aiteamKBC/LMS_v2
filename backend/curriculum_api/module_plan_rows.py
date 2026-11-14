"""One-module writes to the learner's normalized plan rows.

The "Assign learners to module" drawer reads membership from
``"Learner".learner_training_plan_modules`` (see
``learner_status_counts.module_member_enrolment_ids``). The legacy JSON plan on
``enrolment."Created_users"`` is still written too, because learner and coach
screens read it. But ``sync_learning_plan_mirror`` rebuilds every plan row
from that JSON, which would delete any row the JSON does not carry. So when a
learner already has plan rows, only the one module's rows are added or removed
here, and the rest of their rows are left untouched.
"""
from django.db.models import Max

from learner_api import learning_plan as plans
from learner_api.mappers import get_training_plan
from learner_api.models import (
    EnrolmentUser, LearnerProfile, LearnerTrainingPlanComponent,
    LearnerTrainingPlanModule, LearnerTrainingPlanWeek,
)


def _s(value):
    return plans._s(value)


def profile_for(learner):
    """The one learner profile linked to this enrolment row, or None."""
    return (LearnerProfile.objects.using(learner._state.db or 'default')
            .only('id', 'enrolment_id').filter(enrolment_id=learner.pk).first())


def has_plan_rows(profile):
    return profile is not None and LearnerTrainingPlanModule.objects.filter(learner=profile).exists()


def has_module_row(profile, module_id):
    return profile is not None and LearnerTrainingPlanModule.objects.filter(
        learner=profile, curriculum_module_id=module_id).exists()


def _normalized_children():
    """True when the week/component plan tables carry curriculum FKs
    (``curriculum_week_id`` / ``curriculum_component_id``) instead of the
    ``week_ref``/``week_title`` text columns the learner_api models still name.
    The normalized database has only the FK columns, so the model-based writes
    (and Django's cascade, which reads the child rows through those models)
    fail there."""
    from django.db import connections
    connection = connections[LearnerTrainingPlanModule.objects.db]
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'Learner' AND table_name = 'learner_training_plan_weeks'
              AND column_name = 'curriculum_week_id'
        """)
        return bool(cursor.fetchone()[0])


def add_module_row(profile, module):
    """Append one module (with its weeks and components) unless it is already there."""
    module_id = _s(module.get('moduleId'))
    if not module_id or has_module_row(profile, module_id):
        return False
    position = (LearnerTrainingPlanModule.objects.filter(learner=profile)
                .aggregate(top=Max('position'))['top'] or 0) + 1
    module_row = LearnerTrainingPlanModule.objects.create(
        learner=profile, position=position, curriculum_module_id=module_id)
    weeks = [week for week in module.get('weeks') or [] if isinstance(week, dict)]
    if not weeks:
        return True
    if _normalized_children():
        _add_normalized_children(module_row, weeks)
        return True
    week_rows = LearnerTrainingPlanWeek.objects.bulk_create([
        LearnerTrainingPlanWeek(
            plan_module=module_row, position=week_position,
            week_ref=_s(week.get('weekId')) or None, week_title=_s(week.get('weekTitle')),
        )
        for week_position, week in enumerate(weeks, 1)
    ])
    if any(row.pk is None for row in week_rows):
        week_rows = list(module_row.weeks.all().order_by('position', 'id'))
    LearnerTrainingPlanComponent.objects.bulk_create([
        LearnerTrainingPlanComponent(
            plan_week=week_row, position=position,
            component_ref=_s(component.get('componentId')) or None,
            component_title=_s(component.get('componentTitle')),
        )
        for week_row, week in zip(week_rows, weeks)
        for position, component in enumerate(week.get('components') or [], 1)
        if isinstance(component, dict)
    ], batch_size=1000)
    return True


def _add_normalized_children(module_row, weeks):
    """Weeks/components by curriculum id. Each row is written only when its id
    exists in curriculum.weeks / curriculum.components, so the RESTRICT FKs hold;
    the title is read from curriculum, never stored here."""
    from django.db import connections
    connection = connections[LearnerTrainingPlanModule.objects.db]
    with connection.cursor() as cursor:
        for week_position, week in enumerate(weeks, 1):
            week_id = _s(week.get('weekId'))
            cursor.execute("""
                INSERT INTO "Learner".learner_training_plan_weeks (plan_module_id, position, curriculum_week_id)
                SELECT %s, %s, w.id FROM curriculum.weeks w WHERE w.id = %s
                RETURNING id
            """, [module_row.pk, week_position, week_id])
            row = cursor.fetchone()
            if row is None:
                continue
            components = [c for c in week.get('components') or [] if isinstance(c, dict)]
            for position, component in enumerate(components, 1):
                cursor.execute("""
                    INSERT INTO "Learner".learner_training_plan_components (plan_week_id, position, curriculum_component_id)
                    SELECT %s, %s, c.id FROM curriculum.components c WHERE c.id = %s
                """, [row[0], position, _s(component.get('componentId'))])


def remove_module_rows(profile, module_id):
    """Delete this module's rows; the database cascades weeks and components."""
    if profile is None:
        return False
    from django.db import connections
    with connections[LearnerTrainingPlanModule.objects.db].cursor() as cursor:
        cursor.execute("""
            DELETE FROM "Learner".learner_training_plan_modules
            WHERE learner_id = %s AND curriculum_module_id = %s
        """, [profile.pk, module_id])
        return cursor.rowcount > 0


def refresh_title_columns(learner):
    """Keep the legacy Modules/Weeks/Components title columns in step with the JSON plan,
    as ``sync_learning_plan_mirror`` does, without rebuilding the plan rows."""
    modules_csv, weeks_csv, components_csv = plans._plan_titles(get_training_plan(learner) or [])
    EnrolmentUser.all_learners.filter(pk=learner.pk).update(
        modules=modules_csv, weeks=weeks_csv, components=components_csv)
