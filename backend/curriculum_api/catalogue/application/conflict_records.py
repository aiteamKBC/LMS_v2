"""Assemble drawer-authored fields for existing conflict and snapshot responses.

No merge, save decision, HTTP response or derived catalogue rollup belongs here.
"""

from curriculum_api.catalogue.domain.programme_identity import programme_config_identity as _default_programme_config_identity
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value


def cohort_conflict_record(
    cohort_id,
    *,
    fetch_cohort_row,
    curriculum_cohort_from_authoring_detail,
    parse_json_value=_default_parse_json_value,
):
    row = fetch_cohort_row(cohort_id)
    if not row:
        return None
    return curriculum_cohort_from_authoring_detail({
        **row,
        # Stored as JSON text; the payload builder passes whatever it is handed
        # straight through, and the drawer merges these as lists.
        'holiday_ids': parse_json_value(row.get('holiday_ids'), []),
        'excluded_holiday_ids': parse_json_value(row.get('excluded_holiday_ids'), []),
    })


def group_conflict_record(
    group_id,
    *,
    fetch_group_row,
    curriculum_group_from_authoring_detail,
):
    row = fetch_group_row(group_id)
    return curriculum_group_from_authoring_detail(row) if row else None


def programme_conflict_record(
    identifier,
    *,
    programme_config_by_identifier,
    programme_config_identity=_default_programme_config_identity,
):
    """The programme drawer's own fields, read from the ``programmes`` row.

    Not ``programme_response``: that assembles the whole curriculum payload with
    ``force=True``, which is seconds of work against a remote database -- and
    this runs while the record's row is locked. The drawer authors the name,
    level, description and colour, and they all live on the row already read.
    """
    config = programme_config_by_identifier(identifier)
    if not config:
        return None
    return {
        'id': programme_config_identity(config),
        'sourceId': programme_config_identity(config),
        'name': config.get('name') or '',
        'level': config.get('level') or '',
        'description': config.get('description') or '',
        'color': config.get('color') or '',
    }
