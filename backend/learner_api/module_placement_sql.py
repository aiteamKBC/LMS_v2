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
    """SQL expression: the group's coach names, joined with ', ', or NULL.

    curriculum.groups no longer stores a coach (neither coach_name nor coach_id,
    and curriculum.modules has no coach column): a group's coaches are its rows
    in curriculum.group_coaches, named by curriculum.coaches. A group may have
    several; distinct trimmed names are joined in deterministic name order.
    This display value must never resolve a learner's assigned coach.
    A group without a coach, a missing group row, or only blank names gives
    NULL, matching the former ``coalesce(nullif(btrim(g.coach_name), ''), ...)``.
    """
    return (f"(SELECT string_agg(names.name, ', ' ORDER BY lower(names.name), names.name) "
            f"FROM (SELECT DISTINCT btrim(coach.name) AS name "
            f"FROM curriculum.group_coaches group_coach "
            f"JOIN curriculum.coaches coach ON coach.id = group_coach.coach_id "
            f"WHERE group_coach.group_id = {group_alias}.group_id "
            f"AND btrim(coalesce(coach.name, '')) <> '') names)")
