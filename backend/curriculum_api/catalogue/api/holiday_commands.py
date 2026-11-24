"""Holiday HTTP contracts; calendar storage and provider operations are explicit capabilities.

No legacy views or provider imports.
"""


def curriculum_holidays(
    request, *, cached_curriculum_value, curriculum_results_response, curriculum_visibility,
    get_holiday_rows, load_england_holidays, serialize_holiday_row,
):
    """The curriculum's holiday calendar, both halves of it.

    England's bank holidays, mirrored from GOV.UK, plus this organisation's own
    authored closure periods -- in one list, in the one label/start/end shape
    every caller already reads. See ``get_holiday_rows``.

    ``/curriculum/england-holidays/`` serves the GOV.UK half on its own, in the
    feed's raw shape (title, notes, bunting), for the page that lists it.
    """
    visibility = curriculum_visibility(request)
    include_archived = visibility == 'all'

    def build_holidays():
        return [
            serialize_holiday_row(item)
            for item in get_holiday_rows(include_archived=include_archived)
        ]

    # Keyed on visibility again now that authored holidays are back: an archived
    # closure period is in one answer and not the other, and a single cache key
    # would serve whichever was asked for first to both.
    holidays = cached_curriculum_value(f'holidays:{visibility}', build_holidays)
    # Calendar reads retain the existing automatic synchronization check.
    # The provider module is loaded through the supplied capability at call time.
    # The legacy composition seam owns that import and the existing sync state.
    # Keeping loading deferred preserves its timing without importing views or
    # provider modules when this API adapter is imported.
    england_holidays = load_england_holidays()
    england_holidays.auto_sync_if_due()
    return curriculum_results_response(holidays)


def curriculum_holiday_collection(
    request, *, AUTHORED_HOLIDAY_COLOR, JsonResponse, authored_holiday_table_name,
    calendar_holidays, clean_str, curriculum_holidays, datetime, holiday_date_payload, insert_row,
    invalidate_curriculum_cache, json_body, json_error, require_fields, serialize_holiday_row,
):
    """Read the whole calendar; write the authored half of it.

    A POST here creates one of this organisation's own closure periods -- a
    Christmas shutdown, an exam week, a staff training day -- with its own start
    and end date. It never touches the GOV.UK mirror: nobody here gets to invent
    a national holiday, and ``curriculum_holiday_detail`` refuses to edit one for
    the same reason.
    """
    if request.method == 'GET':
        return curriculum_holidays(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    source_table = authored_holiday_table_name()
    on_calendar = not source_table and calendar_holidays.in_use()
    if not source_table and not on_calendar:
        return json_error(
            'The holidays table is not provisioned. Apply '
            'sql/2026-09-14_curriculum_authored_holidays.sql first.',
            status=404,
        )

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['label', 'startDate'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    dates = holiday_date_payload(payload)
    if isinstance(dates, JsonResponse):
        return dates

    if on_calendar:
        row = calendar_holidays.create_local({
            'label': clean_str(payload.get('label')),
            'start_date': dates['start'],
            'end_date': dates['end'],
            'type': clean_str(payload.get('type')),
            'color': clean_str(payload.get('color')) or AUTHORED_HOLIDAY_COLOR,
            'notes': clean_str(payload.get('notes')),
        })
        invalidate_curriculum_cache()
        return JsonResponse({'created': True, 'holiday': serialize_holiday_row(row)}, status=201)

    row = insert_row(source_table, {
        'label': clean_str(payload.get('label')),
        'start_date': dates['start'],
        # A holiday with no end date is a single day, stored as such rather than
        # left null: every reader downstream measures a period, and "one day" is
        # a period whose two ends are the same date.
        'end_date': dates['end'],
        'type': clean_str(payload.get('type')),
        'color': clean_str(payload.get('color')) or AUTHORED_HOLIDAY_COLOR,
        'notes': clean_str(payload.get('notes')),
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
        'is_archived': False,
    })
    invalidate_curriculum_cache()
    return JsonResponse({'created': True, 'holiday': serialize_holiday_row(row)}, status=201)


def curriculum_holiday_detail(
    request, identifier, *, HOLIDAY_READ_ONLY_MESSAGE, JsonResponse, archive_payload,
    authored_holiday_table_name, calendar_holidays, clean_str, datetime, delete_rows,
    england_holiday_exists, fetch_all, get_holiday_rows, holiday_date_payload,
    invalidate_curriculum_cache, json_body, json_error, serialize_holiday_row, table_name,
    update_rows,
):
    """One holiday: read either kind, edit or archive only an authored one."""
    identifier = clean_str(identifier)

    if request.method == 'GET':
        rows = [
            item for item in get_holiday_rows(include_archived=True)
            if clean_str(item.get('id')) == identifier
        ]
        if not rows:
            return json_error('Holiday not found.', status=404)
        return JsonResponse(serialize_holiday_row(rows[0]))

    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)

    source_table = authored_holiday_table_name()
    on_calendar = not source_table and calendar_holidays.in_use()
    if not source_table and not on_calendar:
        return json_error('The holidays table is not provisioned.', status=404)

    if on_calendar:
        found = calendar_holidays.local_row(identifier)
        rows = [found] if found else []
    else:
        # Official ids are namespaced strings; manual ids may be integer columns.
        # Comparing as text lets the read-only check below reject an official id
        # without PostgreSQL trying to cast it to a manual row's numeric key.
        rows = fetch_all(f'select * from {table_name(source_table)} where cast(id as text) = %s', [identifier])
    if not rows:
        # A GOV.UK id reaching a write is a client that has not noticed the two
        # kinds apart, so say which it is rather than "not found".
        if england_holiday_exists(identifier):
            return json_error(HOLIDAY_READ_ONLY_MESSAGE, status=405)
        return json_error('Holiday not found.', status=404)

    if request.method == 'DELETE':
        if on_calendar:
            calendar_holidays.archive_local(identifier)
            invalidate_curriculum_cache()
            return JsonResponse({'archived': True, 'id': identifier})
        payload = archive_payload(source_table, rows[0].get('notes'))
        if payload:
            update_rows(source_table, 'id = %s', [identifier], payload)
        else:
            delete_rows(source_table, 'id = %s', [identifier])
        invalidate_curriculum_cache()
        return JsonResponse({'archived': True, 'id': identifier})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    updates = {'updated_at': datetime.utcnow()}
    # Only what was sent is written. The Holidays page saves a type rename by
    # PATCHing the type alone across every holiday that carries it, and a patch
    # that also blanked the dates would move every one of those holidays.
    if 'label' in payload:
        updates['label'] = clean_str(payload.get('label'))
    if 'type' in payload:
        updates['type'] = clean_str(payload.get('type'))
    if 'color' in payload:
        updates['color'] = clean_str(payload.get('color'))
    if 'notes' in payload:
        updates['notes'] = clean_str(payload.get('notes'))
    if 'startDate' in payload or 'endDate' in payload:
        dates = holiday_date_payload(payload, existing=rows[0])
        if isinstance(dates, JsonResponse):
            return dates
        updates['start_date'] = dates['start']
        updates['end_date'] = dates['end']

    if on_calendar:
        calendar_holidays.update_local(identifier, updates)
        invalidate_curriculum_cache()
        return JsonResponse({'updated': True, 'id': identifier})
    update_rows(source_table, 'id = %s', [identifier], updates)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': identifier})


def curriculum_england_holidays(
    request, *, CURRICULUM_SCHEMA, ENGLAND_HOLIDAYS_TABLE, JsonResponse, calendar_holidays,
    fetch_all, format_date, load_england_holidays, serialize_england_holiday_row, table_exists,
    table_name,
):
    """England's bank holidays as GOV.UK publishes them.

    Reference data, not the authored half of the calendar above: nobody here
    edits these, so the route is read-only. The table is loaded by
    sql/2026-09-13_curriculum_england_holidays.sql and kept current by
    ``england_holidays.run_sync`` -- automatically on the interval, by the
    refresh route below on demand, or by the fetch_england_holidays command.

    Deliberately uncached. It is one indexed read of well under a hundred rows,
    and caching it would pin an empty list for the whole TTL on any environment
    where the table has not been created yet.
    """
    # Reading the page is the most likely moment for the mirror to be checked,
    # and the least costly: the check runs behind the response.
    england_holidays = load_england_holidays()
    england_holidays.auto_sync_if_due()
    rows = []
    if table_exists(ENGLAND_HOLIDAYS_TABLE):
        rows = fetch_all(f'''
            select *
            from {table_name(ENGLAND_HOLIDAYS_TABLE)}
            order by holiday_date
        ''')
    elif calendar_holidays.in_use():
        # The GOV.UK mirror lives in calendar_holidays (source_kind
        # england_official), read back in its own shape.
        rows = sorted(calendar_holidays.rows(calendar_holidays.OFFICIAL),
                      key=lambda row: format_date(row.get('holiday_date')) or '')
    results = [serialize_england_holiday_row(row) for row in rows]
    # The sync state rides along with the list rather than costing the page a
    # second request: "these are the dates" and "this is when they were last
    # checked" are one answer, and the page shows them together.
    return JsonResponse({
        'schema': CURRICULUM_SCHEMA,
        'count': len(results),
        'results': results,
        'syncStatus': england_holidays.sync_status(),
    })


def curriculum_england_holiday_syncs(request, *, CURRICULUM_SCHEMA, JsonResponse, load_england_holidays, parse_int):
    """Every recent check against GOV.UK, and what each one found.

    This is the "which holidays changed on the website?" answer. A check that
    found nothing is listed too -- without it, the last real change reads as the
    last time anyone looked, which is the one wrong conclusion available here.
    """
    england_holidays = load_england_holidays()
    limit = parse_int(request.GET.get('limit'), 20) or 20
    return JsonResponse({
        'schema': CURRICULUM_SCHEMA,
        'status': england_holidays.sync_status(),
        'results': england_holidays.recent_syncs(min(limit, 100)),
    })


def curriculum_england_holidays_refresh(request, *, JsonResponse, json_body, json_error, load_england_holidays, truthy):
    """Check GOV.UK now, and report what moved.

    The button behind this exists because "it will refresh itself within a day"
    is not an answer when someone has just read that a bank holiday changed and
    needs the cohorts under it rescheduled today.

    ``?dryRun=1`` reports what would change without writing it.
    """
    england_holidays = load_england_holidays()
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if not isinstance(payload, dict):
        return json_error('Invalid JSON body.')
    dry_run = truthy(request.GET.get('dryRun')) or truthy(payload.get('dryRun'))
    summary = england_holidays.run_sync(source='manual', apply=not dry_run)
    # The next automatic check is a full interval from this one, and the latch
    # holding that answer in memory was set before this check happened.
    england_holidays.reset_auto_sync_state()
    status = 200 if summary.get('status') == 'ok' else 502
    return JsonResponse({'summary': summary, 'status': england_holidays.sync_status()}, status=status)
