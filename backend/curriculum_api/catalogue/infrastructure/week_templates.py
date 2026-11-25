"""Week-template read queries and archive filtering.

Storage routing, schema checks and existing archive policy are explicit ports.
"""


def get_week_template_rows(
    where_sql='',
    params=None,
    *,
    include_deleted=False,
    ensure_week_template_tables,
    table_name,
    WEEK_TEMPLATES_TABLE,
    fetch_all,
    curriculum_row_effectively_deleted,
):
    """Week template rows, archived ones excluded unless asked for.

    This is the single read funnel for the table, so filtering here is what
    keeps an archived template out of every list and picker at once. DELETE is
    a soft archive, so without this a deleted template would keep showing up.
    """
    ensure_week_template_tables()
    query = f'select * from {table_name(WEEK_TEMPLATES_TABLE)}'
    if where_sql:
        query += f' where {where_sql}'
    query += ' order by updated_at desc'
    rows = fetch_all(query, params or [])
    if include_deleted:
        return rows
    return [row for row in rows if not curriculum_row_effectively_deleted(row)]


def get_week_template_row(
    template_id,
    *,
    include_deleted=False,
    get_week_template_rows,
):
    rows = get_week_template_rows('id = %s', [template_id], include_deleted=include_deleted)
    return rows[0] if rows else None


def get_week_template_component_rows(
    template_id,
    *,
    ensure_week_template_tables,
    fetch_all,
    table_name,
    WEEK_TEMPLATE_COMPONENTS_TABLE,
):
    from curriculum_api import template_ksbs
    ensure_week_template_tables()
    rows = fetch_all(
        f'select * from {table_name(WEEK_TEMPLATE_COMPONENTS_TABLE)} '
        f'where week_template_id = %s order by display_order asc', [template_id])
    with connection.cursor() as cursor:
        mappings = template_ksbs.items(cursor, [row['id'] for row in rows])
    for row in rows:
        row['ksb_mappings'] = mappings.get(row['id'], [])
    return rows

from django.db import connection
