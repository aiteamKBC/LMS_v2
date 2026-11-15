"""Module facts that live only in the authoring tables: KSB count and last edit.

build_modules() shapes delivery rows the way the legacy tables held them. Its
KSB codes come from a session_ksb_json column the current schema does not have,
and it leaves lastUpdated blank, so every module in a compact payload read as
unmapped and never edited. These helpers put the real values back.
"""

import json

from django.db import connection

from . import ksb_mapping_placement


def _clean(value):
    return str(value if value is not None else '').strip()


def ksb_counts_selection():
    """``(sql, params)``: one jsonb object of module_catalogue_id -> distinct live KSB codes.

    A mapping carries only component_id and standard_ksb_id; relation() joins its
    module (through the component) and its code (through the standard KSB). The
    SQL is a scalar subquery, so a caller can add it to a wider SELECT and keep a
    single round trip.
    """
    from . import views

    where_sql, params = views.live_authoring_rows_sql(views.AUTHORING_KSB_MAPPINGS_TABLE)
    sql = (
        "(select coalesce(jsonb_object_agg(module_catalogue_id, ksb_total), '{}'::jsonb) from ("
        "select module_catalogue_id::text as module_catalogue_id, "
        "count(distinct nullif(trim(ksb_code), '')) as ksb_total "
        f'from {ksb_mapping_placement.relation(include_description=False)} '
        'where module_catalogue_id is not null'
        + (f' and {where_sql}' if where_sql else '')
        + ' group by 1) ksb_source)'
    )
    return sql, list(params)


def decode_counts(value):
    if isinstance(value, str):
        value = json.loads(value or '{}')
    return {str(key): int(count or 0) for key, count in (value or {}).items()}


def module_ksb_counts():
    """Distinct live KSB codes per module catalogue id.

    PostgreSQL only: test databases carry no mapping/standard tables to join, so
    there every module reads as unmapped, exactly as before.
    """
    from . import views

    if connection.vendor != 'postgresql':
        return {}
    sql, params = ksb_counts_selection()
    row = views.fetch_all(f'select {sql} as "ksb_counts"', params)[0]
    return decode_counts(row.get('ksb_counts'))


def apply_authoring_facts(modules, authoring_rows, ksb_counts=None):
    """Put each module's real KSB count and last edit on payload rows, in place.

    ``ksb_counts=None`` means the caller did not read them, so ksbCount is left
    as it was; a dict (even empty) is authoritative. lastUpdated is only set
    where the authoring row has a stamp.
    """
    from . import views

    updated = {
        _clean(row.get('module_catalogue_id')): views.format_created_at(row.get('updated_at'))
        for row in authoring_rows or [] if _clean(row.get('module_catalogue_id'))
    }
    for module in modules:
        catalogue_id = _clean(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('sourceId'))
        if not catalogue_id:
            continue
        if ksb_counts is not None:
            module['ksbCount'] = int(ksb_counts.get(catalogue_id) or 0)
        if updated.get(catalogue_id):
            module['lastUpdated'] = updated[catalogue_id]
    return modules
