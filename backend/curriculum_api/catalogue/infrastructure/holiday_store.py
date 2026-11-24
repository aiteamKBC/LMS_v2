"""Normalized holiday storage and cohort choices on the caller connection and transaction.

No legacy views or provider imports.
"""


def in_use(*, ENGLAND_HOLIDAYS_TABLE, TABLE, authored_holiday_table_name, connection, table_exists):
    """True when the calendar lives in ``calendar_holidays``."""
    return (
        connection.vendor == 'postgresql'
        and table_exists(TABLE)
        and not table_exists(ENGLAND_HOLIDAYS_TABLE)
        and not authored_holiday_table_name()
    )


def _shape(record, *, OFFICIAL):
    (_id, kind, record_id, label, start, end, category, color, notes, archived, division,
     bunting, fetched_at, created_at, updated_at) = record
    if kind == OFFICIAL:
        return {'id': record_id, 'title': label, 'holiday_date': start, 'division': division or '',
                'notes': notes or '', 'bunting': bool(bunting), 'fetched_at': fetched_at,
                'created_at': created_at, 'updated_at': updated_at}
    return {'id': record_id, 'label': label, 'start_date': start, 'end_date': end,
            'type': category or '', 'color': color or '', 'notes': notes or '',
            'is_archived': bool(archived), 'created_at': created_at, 'updated_at': updated_at}


def rows(kind=None, *, OFFICIAL, TABLE, _COLUMNS, _ref, _shape, connection):
    """Every holiday, in the shape of the table it came from.

    A bank holiday GOV.UK has withdrawn while a cohort still names it is kept
    archived (see ``apply_official``) and is not part of the calendar.
    Authored closures come back archived or not; the caller filters.
    """
    where = 'where not (source_kind = %s and is_archived)'
    params = [OFFICIAL]
    if kind:
        where += ' and source_kind = %s'
        params.append(kind)
    with connection.cursor() as cursor:
        cursor.execute(f'select {_COLUMNS} from {_ref(TABLE)} {where} order by start_date, label', params)
        return [_shape(record) for record in cursor.fetchall()]


def local_row(identifier, *, LOCAL, TABLE, _COLUMNS, _ref, _shape, connection):
    """One authored closure by its id (archived or not), or None."""
    with connection.cursor() as cursor:
        cursor.execute(
            f'select {_COLUMNS} from {_ref(TABLE)} where source_kind = %s and source_record_id = %s',
            [LOCAL, str(identifier or '').strip()],
        )
        record = cursor.fetchone()
    return _shape(record) if record else None


def official_exists(identifier, *, OFFICIAL, TABLE, _ref, connection):
    with connection.cursor() as cursor:
        cursor.execute(
            f'select 1 from {_ref(TABLE)} where source_kind = %s and source_record_id = %s limit 1',
            [OFFICIAL, str(identifier or '').strip()],
        )
        return cursor.fetchone() is not None


def create_local(fields, *, LOCAL, TABLE, _now, _ref, connection, local_row, transaction):
    """Add an authored closure; returns it in the authored shape.

    The number continues the authored sequence (the ids the Holidays page and
    the cohorts already hold are numbers). Serialised by a transaction lock so
    two saves never take the same one.
    """
    now = _now()
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('select pg_advisory_xact_lock(hashtextextended(%s, 0))', ['curriculum.calendar_holidays.local'])
            cursor.execute(
                f"select coalesce(max(source_record_id::bigint), 0) + 1 from {_ref(TABLE)} "
                f"where source_kind = %s and source_record_id ~ '^[0-9]+$'",
                [LOCAL],
            )
            number = str(cursor.fetchone()[0])
            cursor.execute(
                f'''insert into {_ref(TABLE)}
                        (id, source_kind, source_record_id, label, start_date, end_date, category, color,
                         notes, is_archived, is_system_marker, created_at, updated_at)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, false, false, %s, %s)''',
                [f'{LOCAL}:{number}', LOCAL, number, fields.get('label') or '', fields['start_date'],
                 fields['end_date'], fields.get('type') or '', fields.get('color') or '', fields.get('notes') or '',
                 now, now],
            )
    return local_row(number)


def update_local(identifier, updates, *, LOCAL, TABLE, _LOCAL_COLUMNS, _now, _ref, connection):
    """Write only the authored fields given (``label``/``type``/... as the page names them)."""
    sets, params = [], []
    for key, value in updates.items():
        column = _LOCAL_COLUMNS.get(key)
        if column:
            sets.append(f'{column} = %s')
            params.append(value)
    sets.append('updated_at = %s')
    params.append(_now())
    with connection.cursor() as cursor:
        cursor.execute(
            f'update {_ref(TABLE)} set {", ".join(sets)} where source_kind = %s and source_record_id = %s',
            [*params, LOCAL, str(identifier or '').strip()],
        )
        return cursor.rowcount


def archive_local(identifier, *, update_local):
    return update_local(identifier, {'is_archived': True})


def stored_official(*, OFFICIAL, TABLE, _ref, connection, format_date):
    """The mirror keyed by date, like the feed (archived rows included: a
    withdrawn date that comes back is restored, not added twice)."""
    with connection.cursor() as cursor:
        cursor.execute(
            f'select source_record_id, label, start_date, notes, bunting, is_archived from {_ref(TABLE)} '
            f'where source_kind = %s',
            [OFFICIAL],
        )
        found = {}
        for record_id, label, start, notes, bunting, archived in cursor.fetchall():
            if archived:
                continue
            found[format_date(start)] = {'id': record_id, 'title': label, 'holiday_date': start,
                                               'notes': notes or '', 'bunting': bool(bunting)}
        return found


def apply_official(
    incoming, added, changed, removed, division, now=None, *, CHOICES_TABLE, OFFICIAL,
    OFFICIAL_CATEGORY, TABLE, _now, _ref, connection, transaction,
):
    """``england_holidays.apply_changes`` for this table, in one transaction.

    A removed date a cohort still names (``cohort_calendar_holidays``, RESTRICT)
    cannot be deleted; it is archived instead, which takes it out of the
    calendar exactly as a delete would and keeps the cohort's choice intact.
    """
    now = now or _now()
    table, choices = _ref(TABLE), _ref(CHOICES_TABLE)
    with transaction.atomic():
        with connection.cursor() as cursor:
            for item in added:
                cursor.execute(
                    f'''insert into {table}
                            (id, source_kind, source_record_id, label, start_date, end_date, category, notes,
                             division, bunting, fetched_at, is_archived, is_system_marker, created_at, updated_at)
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false, false, %s, %s)
                        on conflict (source_kind, source_record_id) do update set
                            label = excluded.label, start_date = excluded.start_date, end_date = excluded.end_date,
                            notes = excluded.notes, bunting = excluded.bunting, fetched_at = excluded.fetched_at,
                            is_archived = false, updated_at = excluded.updated_at''',
                    [f'england:{item["id"]}', OFFICIAL, item['id'], item['title'], item['date'], item['date'],
                     OFFICIAL_CATEGORY, item['notes'], division, item['bunting'], now, now, now],
                )
            for item in changed:
                cursor.execute(
                    f'''update {table} set label = %s, notes = %s, bunting = %s, fetched_at = %s, updated_at = %s
                         where source_kind = %s and start_date = %s and not is_archived''',
                    [item['title'], item['notes'], item['bunting'], now, now, OFFICIAL, item['date']],
                )
            for item in removed:
                cursor.execute(
                    f'''delete from {table} h
                         where h.source_kind = %s and h.start_date = %s
                           and not exists (select 1 from {choices} c where c.calendar_holiday_id = h.id)''',
                    [OFFICIAL, item['date']],
                )
                cursor.execute(
                    f'update {table} set is_archived = true, updated_at = %s '
                    f'where source_kind = %s and start_date = %s',
                    [now, OFFICIAL, item['date']],
                )
            dates = sorted(incoming)
            if dates:
                cursor.execute(
                    f'update {table} set fetched_at = %s where source_kind = %s and not is_archived '
                    f'and start_date = any(%s::date[])',
                    [now, OFFICIAL, dates],
                )


def last_fetched(*, OFFICIAL, TABLE, _ref, connection):
    """The newest ``fetched_at`` of the mirror: when GOV.UK was last read successfully."""
    with connection.cursor() as cursor:
        cursor.execute(f'select max(fetched_at) from {_ref(TABLE)} where source_kind = %s', [OFFICIAL])
        found = cursor.fetchone()
    return found[0] if found else None


def cohort_choices(cohort_ids=None, *, CHOICES_TABLE, TABLE, _ref, connection):
    """``{cohort_id: {'selected': [holiday id, ...], 'excluded': [...]}}`` (the holidays' own ids)."""
    sql = (f'select h.cohort_id::text, ch.source_record_id::text, h.is_selected, h.is_excluded '
           f'from {_ref(CHOICES_TABLE)} h join {_ref(TABLE)} ch on ch.id = h.calendar_holiday_id')
    params = []
    if cohort_ids is not None:
        sql += ' where h.cohort_id = any(%s)'
        params.append(sorted({str(value) for value in cohort_ids if value}))
    found = {}
    with connection.cursor() as cursor:
        cursor.execute(sql + ' order by h.id', params)
        for cohort_id, holiday_id, is_selected, is_excluded in cursor.fetchall():
            entry = found.setdefault(cohort_id, {'selected': [], 'excluded': []})
            if is_selected:
                entry['selected'].append(holiday_id)
            if is_excluded:
                entry['excluded'].append(holiday_id)
    return found


def _id_list(value):
    if value is None:
        return None
    if isinstance(value, str):
        import json
        try:
            value = json.loads(value or '[]')
        except ValueError:
            return None
    if not isinstance(value, (list, tuple)):
        return None
    return [str(item).strip() for item in value if str(item).strip()]


def store_cohort_choices(
    payload, rows, *, CHOICES_TABLE, TABLE, _id_list, _ref, cohort_choices, connection, in_use,
    invalidate,
):
    """Write the holiday lists a cohort save carries (only the lists it carries).

    Runs on the caller's connection and transaction. A no-op unless the
    calendar is in ``calendar_holidays``.
    """
    if not payload or not in_use():
        return
    selected = _id_list(payload.get('holiday_ids')) if 'holiday_ids' in payload else None
    excluded = _id_list(payload.get('excluded_holiday_ids')) if 'excluded_holiday_ids' in payload else None
    if selected is None and excluded is None:
        return
    cohort_ids = {str(row.get('cohort_id')) for row in (rows or []) if row and row.get('cohort_id')}
    if payload.get('cohort_id'):
        cohort_ids.add(str(payload['cohort_id']))
    choices = cohort_choices(cohort_ids)
    rows_by_cohort = {}
    for row in rows or []:
        if row and row.get('cohort_id'):
            rows_by_cohort.setdefault(str(row['cohort_id']), []).append(row)
    with connection.cursor() as cursor:
        for cohort_id in sorted(cohort_ids):
            current = choices.get(cohort_id, {})
            want_selected = selected if selected is not None else current.get('selected', [])
            want_excluded = excluded if excluded is not None else current.get('excluded', [])
            wanted = list(dict.fromkeys([*want_selected, *want_excluded]))
            cursor.execute(f'delete from {_ref(CHOICES_TABLE)} where cohort_id = %s', [cohort_id])
            calendar_ids = {}
            if wanted:
                cursor.execute(
                    f'select source_record_id, id from {_ref(TABLE)} where source_record_id = any(%s)', [wanted],
                )
                calendar_ids = dict(cursor.fetchall())
            # The rows handed back by the save show what is stored from now on.
            for row in rows_by_cohort.get(cohort_id, []):
                row['holiday_ids'] = [value for value in want_selected
                                      if value in calendar_ids and value not in want_excluded]
                row['excluded_holiday_ids'] = [value for value in want_excluded if value in calendar_ids]
            for record_id in wanted:
                calendar_id = calendar_ids.get(record_id)
                if not calendar_id:
                    continue  # an id no calendar row carries cannot be stored
                is_excluded = record_id in want_excluded
                cursor.execute(
                    f'insert into {_ref(CHOICES_TABLE)} (cohort_id, calendar_holiday_id, is_selected, is_excluded) '
                    f'values (%s, %s, %s, %s)',
                    [cohort_id, calendar_id, record_id in want_selected and not is_excluded, is_excluded],
                )
    invalidate()


def release_cohorts(where_sql, params, *, CHOICES_TABLE, _ref, connection, in_use):
    """Before cohorts matching ``where_sql`` are deleted: their holiday choices go
    with them (they reference the cohort with RESTRICT)."""
    if not in_use():
        return
    with connection.cursor() as cursor:
        cursor.execute(
            f'delete from {_ref(CHOICES_TABLE)} where cohort_id in '
            f'(select cohort_id from {_ref("cohorts")} where {where_sql})',
            list(params or []),
        )
