"""PostgreSQL membership facts using the caller-owned connection and schema checks."""
from django.db import DatabaseError


def learner_facts(module_ids, profile_ids=None, *, connection, table_exists, columns_for):
    """One small row per learner, with placement labels but no personal names.

    Module membership is reduced from normalized plan rows inside Postgres.
    No legacy JSON fallback or lifecycle filtering is applied here.
    ``profile_ids`` limits the read to those ``"Learner".learners`` ids (an
    attendance check asks about one learner, not the whole directory).
    """
    if connection.vendor != 'postgresql' or not table_exists('learners'):
        raise DatabaseError('Learner counts are unavailable.')
    columns = columns_for('learners')
    if not {'id', 'lifecycle_status'} <= columns:
        raise DatabaseError('Learner count columns are unavailable.')
    # "Learner".learners no longer stores placement names. Read them as
    # LearnerProfile.programme/.cohort/.group_name do: through the profile's own
    # placement ids and the curriculum tables. A missing id reads as no name.
    # Each target ID is a verified primary key: these LEFT JOINs preserve one
    # row per learner, including learners with absent placement relationships.
    name_selects, name_joins = [], []
    for alias, id_column, table, name, label in (
            ('placement_programme', 'programme_id', 'curriculum.programmes', 'name', 'programme'),
            ('placement_cohort', 'cohort_id', 'curriculum.cohorts', 'cohort_name', 'cohort'),
            ('placement_group', 'group_id', 'curriculum.groups', 'group_name', 'group_name')):
        if id_column in columns:
            name_selects.append(f'{alias}.{name} AS {label}')
            name_joins.append(f'LEFT JOIN {table} {alias} ON {alias}.{id_column} = p.{id_column}')
        else:
            name_selects.append(f'NULL AS {label}')
    identity = ', '.join(f"coalesce(p.{column}, '') AS {column}" if column in columns
                         else f"'' AS {column}" for column in ('programme_id', 'cohort_id', 'group_id'))
    identity += ', p.enrolment_id AS enrolment_id' if 'enrolment_id' in columns else ', NULL AS enrolment_id'
    plan_select = 'false AS explicit, ARRAY[]::text[] AS module_ids, false AS ambiguous'
    plan_join = ''
    params = []
    if module_ids:
        plan_select = "coalesce(membership.explicit,false) AS explicit, coalesce(membership.module_ids,ARRAY[]::text[]) AS module_ids, false AS ambiguous"
        plan_join = """
            LEFT JOIN LATERAL (
                SELECT count(*) > 0 AS explicit,
                       coalesce(array_agg(DISTINCT plan.curriculum_module_id)
                           FILTER (WHERE plan.curriculum_module_id = ANY(%s)), ARRAY[]::text[]) AS module_ids
                FROM "Learner".learner_training_plan_modules plan
                WHERE plan.learner_id=p.id
            ) membership ON true
        """
        params.append(sorted(module_ids))
    programme_status = "nullif(btrim(p.programme_status), '')," if 'programme_status' in columns else ''
    where = ''
    if profile_ids is not None:
        where = 'WHERE p.id = ANY(%s)'
        params.append(sorted({int(value) for value in profile_ids}))
    with connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT p.id, {', '.join(name_selects)}, {identity},
                   coalesce(nullif(btrim(p.lifecycle_status), ''), {programme_status} 'unknown') AS status,
                   {plan_select}
            FROM "Learner"."learners" p {' '.join(name_joins)} {plan_join}
            {where}
        """, params)
        names = [column[0] for column in cursor.description]
        rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    return rows
