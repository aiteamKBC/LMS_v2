"""Programme-audit schema checks and asset/material SELECT readers."""


def quote_ident(
    value,
):
    return '"' + str(value).replace('"', '""') + '"'


def asset_table_name(
    *, PROGRAMME_AUDIT_SCHEMA, PROGRAMME_AUDIT_TABLE, connection, quote_ident,
):
    if connection.vendor == 'postgresql':
        return f'{quote_ident(PROGRAMME_AUDIT_SCHEMA)}.{quote_ident(PROGRAMME_AUDIT_TABLE)}'
    return quote_ident('programme_audit_assets')


def rows_as_dicts(
    cursor,
):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def ui_material_table_exists(
    table, *, PROGRAMME_AUDIT_SCHEMA, connection,
):
    if connection.vendor != 'postgresql':
        return False
    with connection.cursor() as cursor:
        cursor.execute(
            'SELECT 1 FROM information_schema.tables '
            'WHERE table_schema = %s AND table_name = %s LIMIT 1',
            [PROGRAMME_AUDIT_SCHEMA, table],
        )
        return cursor.fetchone() is not None


def fetch_ui_material(
    key, include_results=False, *, PROGRAMME_AUDIT_SCHEMA, ProgrammeAuditNotFound, UI_MATERIAL_TABLES,
    clean, connection, quote_ident, rows_as_dicts, ui_material_table_exists,
):
    definition = UI_MATERIAL_TABLES.get(clean(key))
    if not definition:
        raise ProgrammeAuditNotFound('Material not found.')
    table_ident = definition['table']
    if not ui_material_table_exists(table_ident):
        return {**definition, 'key': key, 'ready': False, 'count': 0, 'expectedMinutes': 0, 'firstWeekTitle': '', 'results': []}

    table = f'{quote_ident(PROGRAMME_AUDIT_SCHEMA)}.{quote_ident(table_ident)}'
    with connection.cursor() as cursor:
        cursor.execute(
            f'''SELECT count(*),
                       coalesce(sum(
                           CASE WHEN expected_otjh IS NOT NULL AND expected_otjh > 0
                                THEN expected_otjh * 60
                                ELSE coalesce(duration_minutes, 0) END
                       ), 0)
                FROM {table}'''
        )
        count, expected_minutes = cursor.fetchone()
        cursor.execute(
            f'''SELECT week_title FROM {table}
                WHERE coalesce(week_title, '') <> ''
                ORDER BY week_number NULLS LAST, week_title, title LIMIT 1'''
        )
        first_week = cursor.fetchone()
        results = []
        if include_results:
            columns = (
                'id', 'module_catalogue_id', 'module_title', 'week_id', 'week_number',
                'week_title', 'component_id', 'component_type', 'content_kind',
                'title', 'description', 'source_url', 'embed_url', 'render_mode',
                'duration_minutes', 'expected_otjh', 'points', 'status',
            )
            cursor.execute(
                f'''SELECT {", ".join(quote_ident(column) for column in columns)}
                    FROM {table}
                    ORDER BY week_number NULLS LAST, week_title, title, id'''
            )
            results = rows_as_dicts(cursor)
            for row in results:
                if row.get('expected_otjh') is not None:
                    row['expected_otjh'] = float(row['expected_otjh'])
    return {
        **definition,
        'key': key,
        'ready': True,
        'count': int(count),
        'expectedMinutes': int(round(float(expected_minutes or 0))),
        'firstWeekTitle': first_week[0] if first_week else '',
        'results': results,
    }


def table_exists(
    *, PROGRAMME_AUDIT_SCHEMA, PROGRAMME_AUDIT_TABLE, connection, logger,
):
    try:
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute(
                    'select 1 from information_schema.tables where table_schema = %s and table_name = %s limit 1',
                    [PROGRAMME_AUDIT_SCHEMA, PROGRAMME_AUDIT_TABLE],
                )
            else:
                cursor.execute(
                    "select 1 from sqlite_master where type='table' and name = %s limit 1",
                    ['programme_audit_assets'],
                )
            return cursor.fetchone() is not None
    except Exception:
        logger.debug('Could not verify programme audit table.', exc_info=True)
        return False


def fetch_assets(
    programme_id, kind='', *, ASSET_COLUMNS, asset_table_name, connection, quote_ident,
    require_programme_audit_table, rows_as_dicts, serialise_asset_row,
):
    require_programme_audit_table()
    where = ['programme_id = %s']
    params = [programme_id]
    if kind:
        where.append('content_kind = %s')
        params.append(kind)
    kind_order = """
        case content_kind
            when 'live_session' then 1
            when 'recording' then 2
            when 'video' then 3
            when 'presentation' then 4
            when 'reading' then 5
            when 'audio' then 6
            when 'quiz' then 7
            when 'reflection' then 8
            else 99
        end
    """
    if connection.vendor == 'postgresql':
        sql = (
            f'select {", ".join(quote_ident(column) for column in ASSET_COLUMNS)} '
            f'from {asset_table_name()} where {" and ".join(where)} '
            f'order by module_title, week_number nulls last, week_title, {kind_order}, title'
        )
    else:
        sql = (
            f'select {", ".join(quote_ident(column) for column in ASSET_COLUMNS)} '
            f'from {asset_table_name()} where {" and ".join(where)} '
            f'order by module_title, week_number, week_title, {kind_order}, title'
        )
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return [serialise_asset_row(row) for row in rows_as_dicts(cursor)]
