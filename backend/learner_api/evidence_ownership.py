"""Canonical ownership helpers for ``Learner.evidence_files``.

Evidence routes use the enrolment/source id in their URL. The normalized table
owns rows through ``learner_profile_id`` instead, so readers must resolve that
bridge without falling back to the removed ``learner_id`` column.
"""


def profile_id_for_source(cursor, kind, source_id):
    """Return the one canonical learner profile for an enrolment route id."""
    try:
        source_id = int(source_id)
    except (TypeError, ValueError):
        return None
    params = [source_id]
    kind_sql = ""
    if kind is not None:
        kind_sql = " and lower(learner_type) = lower(%s)"
        params.append(str(kind).strip())
    cursor.execute(
        'select id from "Learner".learners where enrolment_id = %s' + kind_sql,
        params,
    )
    rows = [row[0] for row in cursor.fetchall() if row and row[0] is not None]
    return int(rows[0]) if len(rows) == 1 else None


def plan_component_id(cursor, learner_profile_id, component_ref):
    """Resolve one component through the learner's saved normalized plan."""
    if learner_profile_id is None or not str(component_ref or "").strip():
        return None
    cursor.execute(
        '''select plan_component.id
             from "Learner".learner_training_plan_modules plan_module
             join "Learner".learner_training_plan_weeks plan_week
               on plan_week.plan_module_id=plan_module.id
             join "Learner".learner_training_plan_components plan_component
               on plan_component.plan_week_id=plan_week.id
            where plan_module.learner_id=%s
              and plan_component.curriculum_component_id=%s
            order by plan_component.id''',
        [learner_profile_id, str(component_ref).strip()],
    )
    rows = [row[0] for row in cursor.fetchall() if row and row[0] is not None]
    return int(rows[0]) if len(rows) == 1 else None
