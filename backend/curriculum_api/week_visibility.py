"""Which deleted curriculum rows a learner-facing read may still show.

A running module shows only its live weeks, components and KSB mappings. An
archived module keeps showing the rows that were archived WITH it -- the
learner's history of a module that was withdrawn under them -- and nothing
else.

"Archived with it" is two facts, not one. The row was stamped by the same
cascade as its module (a module delete stamps its children with the module's
own id; a programme delete stamps module and children alike with the programme
id), and it was stamped in the same moment. ``deleted_via_parent`` alone is not
enough: a module that is deleted and later brought back by a save keeps the
children of that earlier deletion stamped with its id, and a module rebuilt
after that carries two sets of weeks per number. Read on the parent stamp alone,
the stale set outranks the live one and the learner sees a previous version of
the course.

The five-minute window is the one ``recordings_library`` already uses for the
same question: one archive writes all of its rows inside a single transaction.
"""

ARCHIVE_EVENT_WINDOW = "interval '5 minutes'"


def _latest_archive_sql(entity_types, entity_id_sql):
    """LATERAL body: the latest 'archived' revision of one row (time, reason, recorded parent)."""
    types = ', '.join(f"'{kind}'" for kind in entity_types)
    return (
        f"SELECT r.created_at, COALESCE(r.reason, '') AS reason, "
        f"COALESCE(r.metadata ->> 'archived_via', '') AS via "
        f"FROM curriculum.record_revisions r "
        f"WHERE r.entity_type IN ({types}) AND r.entity_id={entity_id_sql} AND r.action='archived' "
        f"ORDER BY r.created_at DESC LIMIT 1"
    )


def visible_child_sql(alias):
    """SQL predicate: this module child row may be shown.

    For a ``curriculum`` table whose rows carry ``id``, ``module_catalogue_id``
    and ``status`` -- weeks and components. ``alias`` is the name the row has in
    the calling query -- its alias, or the bare table name for an unaliased
    ``FROM curriculum.<table>``. It is required: an unqualified column inside
    the subquery would bind to the module row.

    Normalised schema: archive state is ``status``; when and with which parent a
    row was archived is history's (``curriculum.record_revisions``). An archive
    recorded by this code names its parent in ``metadata.archived_via``; an
    older one names it by its cascade reason -- ``module-delete`` took down the
    module's own children, ``programme-delete`` everything under the programme.
    """
    w = alias
    module_via = (
        "COALESCE(NULLIF(module_archive.via, ''), "
        "CASE module_archive.reason WHEN 'programme-delete' THEN archived_module.programme_id END)"
    )
    row_via = (
        "COALESCE(NULLIF(row_archive.via, ''), CASE row_archive.reason "
        "WHEN 'module-delete' THEN archived_module.module_catalogue_id "
        "WHEN 'programme-delete' THEN archived_module.programme_id END)"
    )
    return (
        f"({w}.status NOT IN ('inactive','archived') OR EXISTS ("
        f"SELECT 1 FROM curriculum.modules archived_module "
        f"CROSS JOIN LATERAL ({_latest_archive_sql(['module'], 'archived_module.module_catalogue_id')}) module_archive "
        f"CROSS JOIN LATERAL ({_latest_archive_sql(['week', 'component', 'ksb_mapping'], f'{w}.id')}) row_archive "
        f"WHERE archived_module.module_catalogue_id={w}.module_catalogue_id "
        f"AND archived_module.status IN ('inactive','archived') "
        f"AND {row_via} IN (archived_module.module_catalogue_id, {module_via}) "
        f"AND row_archive.created_at BETWEEN module_archive.created_at - {ARCHIVE_EVENT_WINDOW} "
        f"AND module_archive.created_at + {ARCHIVE_EVENT_WINDOW}))"
    )


def visible_week_sql(alias):
    """SQL predicate: this ``curriculum.weeks`` row may be shown."""
    return visible_child_sql(alias)
