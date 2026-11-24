"""Programme structure count orchestration over existing read capabilities.

The API adapter retains read-scope caching and supplies existing readers and
normalizers. No settings, database initialization or writer capabilities live here.
"""
from collections import Counter

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise


def _empty_programme_structure_counts():
    return {'cohorts': 0, 'groups': 0, 'modules': 0, 'weeks': 0}


def authoring_programme_structure_counts(
    *,
    source=None,
    clean_str=_default_clean_str,
    normalise=_default_normalise,
    programme_deleted_row,
    COHORT_AUTHORING_DETAILS_TABLE,
    COHORT_ROWS_ORDER,
    GROUPS_TABLE,
    GROUP_ROWS_ORDER,
    authoring_fetch_all,
    logger,
    active_week_rows,
    AUTHORING_WEEKS_TABLE,
    WEEK_INDEX_COLUMNS,
    module_index_rows,
    module_stored_week_count,
):
    """Cohorts, groups, modules and weeks per programme, from the rows that own them.

    A programme's card and the programme's own workspace have to answer with the
    same figures, so both count the normalized authoring tables --
    ``curriculum.cohorts``, ``curriculum.groups``, ``curriculum.modules`` and the
    weeks authored beneath them -- minus anything archived or soft-deleted.

    The card used to count ``training_rows`` narrowed by
    ``is_actual_delivery_row``, which keeps a module only once it has BOTH a
    cohort and a group. A programme whose modules were authored before being
    attached to a group therefore read "0 modules, 0 groups, 0 weeks" on its card
    and "64 modules, 1 group, 641 weeks" one click later on its own page, which
    reads these tables.

    Every child row is attributed to exactly ONE programme: by ``programme_id``
    when it carries one, and only otherwise by name. That matters because a
    rename that never reached the children leaves them holding the old name --
    frequently another live programme's name -- and counting by name as well
    would credit one programme's modules to that one too.

    Returns ``(by_programme_id, by_normalised_programme_name)``.
    """
    by_id = {}
    by_name = {}

    def counts_for(row):
        """The one bucket this child row counts towards, or None if it has neither key."""
        programme_id = clean_str(row.get('programme_id'))
        if programme_id:
            return by_id.setdefault(programme_id, _empty_programme_structure_counts())
        programme_name = normalise(row.get('programme_name'))
        if programme_name:
            return by_name.setdefault(programme_name, _empty_programme_structure_counts())
        return None

    def is_countable(row):
        # Archived is the status cohorts and groups carry; soft delete is the
        # stamp everything else carries. Neither is on the programme's page, so
        # neither is on its card.
        return not (
            programme_deleted_row(row)
            or clean_str(row.get('status')).lower() == 'archived'
        )

    # In the order the cohort/group list readers ask for, so a build that runs
    # them too reads each table once through the read scope; a count does not
    # depend on the order.
    for table, key, order_sql in (
        (COHORT_AUTHORING_DETAILS_TABLE, 'cohorts', COHORT_ROWS_ORDER),
        (GROUPS_TABLE, 'groups', GROUP_ROWS_ORDER),
    ):
        try:
            for row in (source[key] if source is not None else authoring_fetch_all(table, order_sql=order_sql)):
                if not is_countable(row):
                    continue
                counts = counts_for(row)
                if counts is not None:
                    counts[key] += 1
        except (Exception, AssertionError):
            logger.debug('Programme %s counts are not available yet.', key, exc_info=True)

    # Authored weeks per module, so the card's WEEKS figure resolves the same way
    # the module's own structure endpoint resolves it: the stored weeks_number
    # wins and rows written before that column existed fall back to the week rows
    # they actually hold. Narrowed to the four columns that decide it -- this
    # table is read in full and the database is remote.
    week_counts_by_module = Counter()
    try:
        for row in active_week_rows(source['weeks'] if source is not None else authoring_fetch_all(
            AUTHORING_WEEKS_TABLE,
            columns=WEEK_INDEX_COLUMNS,
        )):
            module_id = clean_str(row.get('module_catalogue_id'))
            if module_id:
                week_counts_by_module[module_id] += 1
    except (Exception, AssertionError):
        logger.debug('Authored week counts are not available yet.', exc_info=True)

    try:
        for row in (source['modules'] if source is not None else module_index_rows()):
            # A module archived on its own is soft-deleted, so programme_deleted_row
            # covers it; `status` on a module row is draft/published, not archived.
            if programme_deleted_row(row):
                continue
            counts = counts_for(row)
            if counts is None:
                continue
            counts['modules'] += 1
            counts['weeks'] += module_stored_week_count(
                row, week_counts_by_module.get(clean_str(row.get('module_catalogue_id')), 0)
            )
    except (Exception, AssertionError):
        logger.debug('Programme module counts are not available yet.', exc_info=True)

    return by_id, by_name


def programme_structure_counts(
    programme,
    by_id=None,
    by_name=None,
    *,
    clean_str=_default_clean_str,
    normalise=_default_normalise,
    authoring_programme_structure_counts,
):
    """This programme's authoring counts, or None when it owns no authoring rows.

    None is the answer for a legacy programme that exists only as delivery rows;
    its caller keeps whatever it derived from those rows instead.
    """
    if by_id is None or by_name is None:
        by_id, by_name = authoring_programme_structure_counts()
    programme = programme or {}
    for value in (programme.get('sourceId'), programme.get('id')):
        counts = by_id.get(clean_str(value))
        if counts:
            return counts
    return by_name.get(normalise(programme.get('name')))
