"""Read the exact stored rows covered by a record revision; no writes or locks."""
from ..domain.structure_revision import revision_digest

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def record_revision(
    sources,
    *,
    authoring_fetch_all,
    STRUCTURE_REVISION_VOLATILE_COLUMNS,
    logger,
    clean_str=_default_clean_str,
):
    """Fingerprint the rows a guarded write would replace.

    ``sources`` is one ``(label, table, where_sql, params, sort_column)`` per
    table, in a fixed order so the fingerprint never depends on dictionary
    iteration. Volatile columns are dropped and rows are sorted by their own
    key, for the two reasons ``module_structure_revision`` gives: a timestamp
    the write itself bumps would make every fingerprint differ from the last,
    and one that trusted database order would refuse saves at random.

    Returns '' when a table cannot be read at all, and also when the FIRST
    source -- by convention the record's own row -- matches nothing. Callers
    treat '' as "this could not be checked" and refuse the guarded save rather
    than run it unchecked, the same fail-closed rule the structure endpoint
    follows. The missing-row case earns its own answer because these records
    are all edited in place: a record that is not stored has no version to be
    stale against, and hashing its absence would mint a real-looking token that
    every unstored record shared. (``module_structure_revision`` deliberately
    does the opposite, because a module's first save is a legitimate write of
    something not yet stored.)
    """
    material = []
    for index, (label, table, where_sql, params, sort_column) in enumerate(sources):
        try:
            rows = authoring_fetch_all(
                table,
                where_sql,
                params,
                ensure_tables=False,
                exclude_columns=STRUCTURE_REVISION_VOLATILE_COLUMNS,
            )
        except Exception:
            # A table that cannot be read must not fail the request it was asked
            # about; the caller decides what an unreadable fingerprint means.
            logger.warning('Unable to fingerprint %s.', table, exc_info=True)
            return ''
        if index == 0 and not rows:
            return ''
        material.append([
            label,
            sorted(rows, key=lambda row: clean_str(row.get(sort_column))),
        ])
    return revision_digest(material)
