"""Existing PostgreSQL active-placement count reader and compatibility fallbacks."""
from collections import Counter
from curriculum_api.catalogue.application.read_errors import CatalogueReadUnavailable

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def active_learner_delivery_counts(
    *,
    clean_str=_default_clean_str,
    connection,
    learner_relation_exists,
    learners_link_placement_by_id,
    logger,
    normalise=_default_normalise,
    parse_int=_default_parse_int,
    schema_compat,
):
    """Count live learners by the cohort/group their placement resolves to.

    ``Learner.learners`` is the permanent canonical learner table. A learner
    carrying ``cohort_id``/``group_id`` is counted against that record, so a
    renamed cohort keeps its learners; a learner without one is still counted by
    programme/cohort/group *name*, case- and whitespace-insensitively, so rows
    predating those columns do not drop off the cards. Read either half back
    with ``delivery_learner_count``.

    Returns ``(cohort_counts, group_counts)``. Both are keyed either by a
    canonical id (a plain string) or by the name tuple -- one dict holding the
    two kinds of key, because they count the same thing and the caller adds
    them. Missing learner infrastructure is treated as an empty data source (for
    example in local SQLite tests or a curriculum-only deployment).
    """
    if connection.vendor != 'postgresql':
        return {}, {}
    try:
        if not learner_relation_exists('learners'):
            return {}, {}
        with connection.cursor() as cursor:
            # The placement ids only exist where the columns do; elsewhere the
            # two constants keep the row shape and every learner falls into the
            # name bucket, which is what this counted before they were added.
            if learners_link_placement_by_id():
                id_select = ", coalesce(cohort_id, '') as cohort_id, coalesce(group_id, '') as group_id"
                id_group = ', cohort_id, group_id'
            else:
                id_select = ", '' as cohort_id, '' as group_id"
                id_group = ''
            # The normalised table links placements by id only: no name columns
            # there, so '' keeps the row shape. Unknown columns keep the original.
            learner_columns = schema_compat.columns_of('Learner', 'learners')
            if learner_columns and 'programme' not in learner_columns:
                cursor.execute(
                    f"select '' as programme, '' as cohort, '' as group_name{id_select}, count(*) "
                    'from "Learner"."learners" '
                    "where lifecycle_status = 'active' "
                    f'group by 1, 2, 3{", 4, 5" if id_group else ""}'
                )
            else:
                cursor.execute(
                    f'select programme, cohort, group_name{id_select}, count(*) '
                    'from "Learner"."learners" '
                    "where lifecycle_status = 'active' "
                    f'group by programme, cohort, group_name{id_group}'
                )
            rows = cursor.fetchall()
    except Exception as exc:
        raise CatalogueReadUnavailable(
            'Learner counts are unavailable. Please retry.', code='learner_counts_unavailable',
        ) from exc

    cohort_counts = Counter()
    group_counts = Counter()
    for programme_name, cohort_name, group_name, cohort_id, group_id, learner_count in rows:
        programme_key = normalise(programme_name)
        cohort_key = normalise(cohort_name)
        group_key = normalise(group_name)
        cohort_id = clean_str(cohort_id)
        group_id = clean_str(group_id)
        count = parse_int(learner_count, 0)
        if cohort_id:
            cohort_counts[cohort_id] += count
        elif programme_key and cohort_key:
            cohort_counts[(programme_key, cohort_key)] += count
        if group_id:
            group_counts[group_id] += count
        elif programme_key and cohort_key and group_key:
            group_counts[(programme_key, cohort_key, group_key)] += count
    return dict(cohort_counts), dict(group_counts)
