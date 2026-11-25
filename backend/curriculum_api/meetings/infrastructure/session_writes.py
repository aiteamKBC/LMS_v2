"""Existing meeting persistence operations over explicit database capabilities.

The existing facade composes dependencies; query and business semantics are preserved.
"""


def persist_live_session_occurrences(
    live_session_id,
    payload,
    event,
    utc_start,
    duration,
    repeat,
    occurrences,
    *,
    LIVE_SESSION_OCCURRENCES_TABLE,
    authoring_upsert,
    clean_str,
    datetime,
    ensure_live_session_tracking_tables,
    scheduled_live_session_occurrences,
    uuid,
):
    ensure_live_session_tracking_tables()
    now = datetime.utcnow()
    join_url = clean_str((event.get('onlineMeeting') or {}).get('joinUrl'))
    rows = scheduled_live_session_occurrences(payload, utc_start, duration, repeat, occurrences)
    for item in rows:
        authoring_upsert(LIVE_SESSION_OCCURRENCES_TABLE, ['live_session_id', 'session_number'], {
            'id': f'OCC-{uuid.uuid4().hex.upper()}',
            'live_session_id': live_session_id,
            'session_number': item['session_number'],
            'graph_event_id': clean_str(event.get('id')),
            'scheduled_start': item['start'],
            'scheduled_end': item['end'],
            'join_url': join_url,
            'status': 'scheduled',
            'created_at': now,
            'updated_at': now,
        })
    return rows


def replace_live_session_occurrences(
    live_session_id,
    payload,
    utc_start,
    duration,
    repeat,
    occurrences,
    event_id='',
    join_url='',
    *,
    LIVE_SESSION_OCCURRENCES_TABLE,
    authoring_fetch_all,
    authoring_upsert,
    clean_str,
    datetime,
    ensure_live_session_tracking_tables,
    occurrence_session_number,
    pair_planned_occurrences,
    scheduled_live_session_occurrences,
    transaction,
    update_authoring_rows,
    uuid,
):
    ensure_live_session_tracking_tables()
    now = datetime.utcnow()
    rows = scheduled_live_session_occurrences(payload, utc_start, duration, repeat, occurrences)
    existing_rows = authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [live_session_id])
    pairs, unclaimed = pair_planned_occurrences(rows, existing_rows)
    wanted_numbers = {item['session_number'] for item in rows}
    # (live_session_id, session_number) is unique, so a kept row taking a new
    # number, or an unclaimed row sitting on a number a session now needs, steps
    # aside first. Parking below zero never collides with a real session number.
    parked = [row for item, row in pairs if row and occurrence_session_number(row) != item['session_number']]
    parked += [row for row in unclaimed if occurrence_session_number(row) in wanted_numbers]
    lowest = min([0, *(occurrence_session_number(row) for row in existing_rows)])
    with transaction.atomic():
        for offset, row in enumerate(parked, start=1):
            update_authoring_rows(LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', [clean_str(row.get('id'))],
                                  {'session_number': lowest - offset})
        for item, existing in pairs:
            values = {
                'live_session_id': live_session_id,
                'session_number': item['session_number'],
                'graph_event_id': clean_str(event_id),
                'scheduled_start': item['start'],
                'scheduled_end': item['end'],
                'join_url': clean_str(join_url),
                'status': 'completed' if (existing or {}).get('status') == 'completed' else 'scheduled',
                'updated_at': now,
            }
            if existing:
                update_authoring_rows(LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', [clean_str(existing.get('id'))], values)
            else:
                authoring_upsert(LIVE_SESSION_OCCURRENCES_TABLE, ['live_session_id', 'session_number'],
                                 {**values, 'id': f'OCC-{uuid.uuid4().hex.upper()}', 'created_at': now})
        if rows:
            # Rows no planned session kept remain audit history. A parked row
            # stays in the negative range so it cannot block a future active
            # session from reclaiming its former positive number. They are
            # 'superseded' -- "not in plan, still on Teams" -- and never
            # 'cancelled': nobody pressed Cancel, and the Teams slot is still
            # there until somebody does. A row already cancelled stays cancelled.
            for row in unclaimed:
                if clean_str(row.get('status')).lower() in {'cancelled', 'canceled'}:
                    continue
                values = {'status': 'superseded', 'updated_at': now}
                update_authoring_rows(LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', [clean_str(row.get('id'))], values)
    return rows


def persist_live_session_series(
    payload,
    event,
    warnings,
    graph_settings,
    organizer,
    attendees,
    presenters,
    online_meeting_id='',
    co_organizers=(),
    *,
    persist_occurrences=True,
    LIVE_SESSIONS_TABLE,
    authoring_module_exists,
    authoring_upsert,
    clean_str,
    datetime,
    ensure_live_session_tracking_tables,
    ensure_module_authoring_tables,
    json_db_value,
    parse_graph_datetime,
    persist_live_session_occurrences,
    teams_calendar_subject,
    update_authoring_rows,
    uuid,
    max_sessions=52,
):
    ensure_module_authoring_tables()
    ensure_live_session_tracking_tables()
    module_catalogue_id = clean_str(payload.get('moduleCatalogueId'))
    if module_catalogue_id and not authoring_module_exists(module_catalogue_id):
        module_catalogue_id = ''
    module_draft_id = clean_str(payload.get('moduleDraftId'))
    now = datetime.utcnow()
    supersede_filters = []
    supersede_params = []
    if module_catalogue_id:
        supersede_filters.append('module_catalogue_id = %s')
        supersede_params.append(module_catalogue_id)
    elif module_draft_id:
        supersede_filters.append('module_draft_id = %s')
        supersede_params.append(module_draft_id)
    if supersede_filters:
        update_authoring_rows(
            LIVE_SESSIONS_TABLE,
            f"status = 'active' and ({' or '.join(supersede_filters)})",
            supersede_params,
            {'status': 'superseded', 'updated_at': now},
        )

    live_session_id = f'LIVE-{uuid.uuid4().hex.upper()}'
    start_datetime = None
    start_raw = clean_str(payload.get('startDateTimeUtc'))
    if start_raw:
        try:
            start_datetime = datetime.fromisoformat(start_raw.replace('Z', '+00:00'))
        except ValueError:
            start_datetime = None
    authoring_upsert(LIVE_SESSIONS_TABLE, ['id'], {
        'id': live_session_id,
        'module_catalogue_id': module_catalogue_id or None,
        'module_draft_id': module_draft_id,
        'module_title': clean_str(event.get('subject')) or teams_calendar_subject(payload),
        'provider': 'Microsoft Teams',
        'graph_event_id': clean_str(event.get('id')) or None,
        'online_meeting_id': online_meeting_id,
        'join_url': clean_str((event.get('onlineMeeting') or {}).get('joinUrl')),
        'web_link': clean_str(event.get('webLink')),
        'meeting_options_url': clean_str(event.get('_meetingOptionsUrl')),
        'organizer_email': organizer,
        'attendees': json_db_value(attendees),
        'presenters': json_db_value(presenters),
        'co_organizers': json_db_value(co_organizers),
        'start_datetime': start_datetime,
        'timezone': graph_settings.get('timezone') or '',
        'duration_minutes': max(15, min(1440, int(payload.get('durationMinutes') or 60))),
        'repeat_pattern': clean_str(payload.get('repeat')).lower() or 'none',
        'repeat_occurrences': max(1, min(max_sessions, int(payload.get('repeatOccurrences') or 1))),
        'lobby_bypass': clean_str(payload.get('lobbyBypass')).lower() or 'invited',
        'recording': clean_str(payload.get('recording')).lower() or 'none',
        'spoken_language': clean_str(payload.get('spokenLanguage')) or 'en-GB',
        'meeting_type': clean_str(payload.get('meetingType')) or 'live-session',
        'request_responses': bool(payload.get('requestResponses', True)),
        'allow_time_proposals': bool(payload.get('allowNewTimeProposals', True)),
        'hide_attendees': True,
        'status': 'active',
        'warnings': json_db_value(warnings),
        'created_at': now,
        'updated_at': now,
    })
    if not persist_occurrences:
        return live_session_id, 0
    occurrence_rows = persist_live_session_occurrences(
        live_session_id,
        payload,
        event,
        parse_graph_datetime(payload.get('startDateTimeUtc')) or now,
        max(15, min(1440, int(payload.get('durationMinutes') or 60))),
        clean_str(payload.get('repeat')).lower() or 'none',
        max(1, min(max_sessions, int(payload.get('repeatOccurrences') or 1))),
    )
    return live_session_id, len(occurrence_rows)


def link_live_session_series_to_module(
    module_catalogue_id,
    payload,
    *,
    LIVE_SESSIONS_TABLE,
    clean_str,
    datetime,
    ensure_live_sessions_table,
    update_authoring_rows,
):
    ensure_live_sessions_table()
    live_session_ids = set()
    # A full structure is authoritative about which live-session rows belong
    # to this module.  Its delivery metadata can be inherited from an older
    # module snapshot and may still name the source meeting; using that fallback
    # during a full save would silently move the source calendar to the target
    # module when a component is copied between groups.  Metadata remains the
    # compatibility path for the legacy partial save that sends no structure.
    has_structure = 'weekStructure' in payload or 'weeks' in payload
    if has_structure:
        weeks = payload.get('weekStructure') if 'weekStructure' in payload else payload.get('weeks')
        for week in weeks or []:
            for component in week.get('components') or []:
                settings_payload = component.get('settings') if isinstance(component.get('settings'), dict) else {}
                live_session_id = clean_str(settings_payload.get('teamsLiveSessionId'))
                if live_session_id:
                    live_session_ids.add(live_session_id)
    else:
        delivery_metadata = payload.get('deliveryMetadata') if isinstance(payload.get('deliveryMetadata'), dict) else {}
        metadata_id = clean_str(delivery_metadata.get('teamsLiveSessionId'))
        if metadata_id:
            live_session_ids.add(metadata_id)
    for live_session_id in live_session_ids:
        update_authoring_rows(
            LIVE_SESSIONS_TABLE,
            "id = %s AND (module_catalogue_id IS NULL OR module_catalogue_id = '' OR module_catalogue_id = %s)",
            [live_session_id, module_catalogue_id],
            {'module_catalogue_id': module_catalogue_id, 'updated_at': datetime.utcnow()},
        )
