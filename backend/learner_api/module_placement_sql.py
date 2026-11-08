"""A curriculum module's programme, cohort and group names, read through its ids.

The canonical curriculum.modules table holds only programme_id, cohort_id and
group_id; the copied programme_name, cohort_name and group_name columns were
removed. These scalar subqueries resolve each id through its curriculum table,
keep the original column names and their empty-string default, and never
duplicate a module row: a blank, unknown or duplicated id yields ''.
"""


def module_placement_names_sql(alias='m'):
    """SQL select-list items: programme_name, cohort_name, group_name for ``alias``."""
    def name(column, table, key, result):
        return (f"COALESCE((SELECT CASE WHEN count(*) = 1 THEN min(placement.{column}) END "
                f"FROM curriculum.{table} placement WHERE placement.{key} = {alias}.{key} "
                f"AND btrim(coalesce({alias}.{key}, '')) <> ''), '') AS {result}")
    return ','.join((
        name('name', 'programmes', 'programme_id', 'programme_name'),
        name('cohort_name', 'cohorts', 'cohort_id', 'cohort_name'),
        name('group_name', 'groups', 'group_id', 'group_name'),
    ))


def current_module_sql(alias='m'):
    """SQL predicate: the module may appear in a learner's CURRENT learning lists.

    Owner decision (Module Visibility, Option A): curriculum.modules.status
    'inactive' is hidden from current learning and catalogue lists. The
    canonical modules table has no deletion marker (deleted_at,
    deleted_via_parent and is_programme_deleted were removed); status replaces
    them. Only 'inactive' is hidden: no other value -- including NULL or a
    legacy value -- is reinterpreted, so it stays as visible as it was.

    Never apply this to historical reads (progress, completed activities,
    attendance, submissions, reviews, evidence, OTJ): an inactive module's
    history remains readable.
    """
    return f"lower(btrim(coalesce({alias}.status, ''))) <> 'inactive'"


def module_tutor_name_sql(alias='m'):
    """SQL expression: the module's tutor name, read through ``tutor_id``.

    curriculum.modules no longer stores tutor_name; curriculum.tutors.name is
    reached by the modules.tutor_id foreign key. An unassigned (NULL/blank) or
    unknown tutor gives '' -- the removed column's empty default -- so callers'
    ``nullif(..., '')`` fallbacks behave as before.
    """
    return (f"COALESCE((SELECT min(tutor.name) FROM curriculum.tutors tutor "
            f"WHERE tutor.id = {alias}.tutor_id AND btrim(coalesce({alias}.tutor_id, '')) <> ''), '')")


def group_coach_name_sql(group_alias='g'):
    """SQL expression: the group's coach name, read through ``coach_id``, or NULL.

    curriculum.groups no longer stores coach_name (and curriculum.modules has no
    coach column); curriculum.coaches.name is reached by groups.coach_id. A
    group without a coach, a missing group row, or a blank name gives NULL,
    matching the former ``coalesce(nullif(btrim(g.coach_name), ''), ...)``.
    """
    return (f"(SELECT nullif(btrim(min(coach.name)), '') FROM curriculum.coaches coach "
            f"WHERE coach.id = {group_alias}.coach_id)")
