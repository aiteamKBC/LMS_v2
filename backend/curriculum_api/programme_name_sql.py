"""A row's programme name, read through its programme_id.

The canonical schema removed the copied ``programme_name`` columns from
curriculum.modules, curriculum.cohorts and curriculum.groups; the name lives
only in curriculum.programmes.name. This scalar subquery never duplicates the
outer row, and a blank, unknown or duplicated programme id yields ''
(the removed column's default) instead of an arbitrary name.
"""


def programme_name_sql(alias):
    """SQL expression: the programme name for the row aliased ``alias``."""
    return (f"COALESCE((SELECT CASE WHEN count(*) = 1 THEN min(programme_name_source.name) END "
            f"FROM curriculum.programmes programme_name_source "
            f"WHERE programme_name_source.programme_id = {alias}.programme_id "
            f"AND btrim(coalesce({alias}.programme_id, '')) <> ''), '')")
