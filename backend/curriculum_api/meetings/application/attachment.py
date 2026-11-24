"""Meeting workflow over explicit read/write/provider capabilities; no framework or provider imports.

Existing behavior is preserved; legacy capabilities are composed at the outer facade.
"""


def attach_teams_meeting_to_module_weeks(
    module_catalogue_id,
    series_row,
    series_settings,
    occurrence_rows,
    *,
    create_missing=False,
    dry_run=False,
    unresolved_components=None,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    GROUPS_TABLE,
    LIVE_SESSION_MEETING_SCOPE_KEY,
    ZoneInfo,
    active_component_rows,
    active_week_rows,
    archive_state,
    authoring_fetch_all,
    authoring_upsert,
    calendar_clock_to_utc_iso,
    clean_str,
    component_builder_settings,
    datetime,
    defaultdict,
    delivery_days_per_week,
    external_calendar_settings,
    format_date,
    frontend_component_type,
    graph_timezone_iana,
    invalidate_curriculum_cache,
    json_db_value,
    live_occurrence_component_settings,
    live_session_component_points,
    live_session_meeting_scope,
    module_has_booked_series,
    module_session_clock,
    module_stored_session_count,
    module_structure_uses_session_rows,
    module_week_delivery_slots,
    module_week_session_plan,
    occurrence_local_date,
    parse_graph_datetime,
    parse_int,
    stored_calendar_series,
    timezone,
    update_authoring_rows,
    uuid,
):
    """Write a tracked Teams meeting onto the weeks of a module.

    A module's live sessions and its meeting's sessions are one list, read in
    the same order: the Nth live session of the module is the Nth session of the
    series. So each component carries its own session's date -- and its own join
    link, when Graph would only accept a holiday-shifted session as an event of
    its own -- rather than the whole series' first one.

    Walking the weeks is what makes ``create_missing`` possible: each week is
    topped up to the module's delivery-day count, taking consecutive sessions
    from the list. That is what makes re-attaching enough to put a whole created
    series in front of the learner, instead of only the weeks somebody had
    already authored a session into. Returns ``(updated, created)``.

    ``dry_run`` counts what the call *would* do and writes nothing. It exists so
    a caller can ask "is there anything here to re-attach?" using this very
    walk, rather than a second implementation of the same rule that could drift
    from it. The ``created`` count is the one that answers that question: the
    update pass rewrites every existing live-session component every time, so it
    is never zero and never means work is outstanding.
    """
    module_row = (authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id]) or [{}])[0]
    group_rows = authoring_fetch_all(GROUPS_TABLE, 'group_id = %s', [module_row.get('group_id')]) if module_row.get('group_id') else []
    group_row = group_rows[0] if group_rows else {}
    week_rows = active_week_rows(authoring_fetch_all(
        AUTHORING_WEEKS_TABLE,
        'module_catalogue_id = %s',
        [module_catalogue_id],
        'display_order, week_number, id',
    ))
    component_rows = active_component_rows(authoring_fetch_all(
        AUTHORING_COMPONENTS_TABLE,
        'module_catalogue_id = %s',
        [module_catalogue_id],
        'display_order, id',
    ))
    components_by_week = defaultdict(list)
    for row in component_rows:
        components_by_week[clean_str(row.get('week_id'))].append(row)
    # Read before anything below writes: an existing booking or pasted main
    # link means a new unassigned session must choose its calendar. With neither,
    # the first Create may take the module's unassigned sessions.
    series_already_booked = module_has_booked_series([
        component_builder_settings(row) for row in component_rows
        if frontend_component_type(row.get('type')) == 'live-session'
    ])

    structure_rows = [{**week, 'components': components_by_week.get(clean_str(week.get('id')), [])} for week in week_rows]
    session_rows = module_structure_uses_session_rows(structure_rows, module_stored_session_count(module_row), delivery_days_per_week(module_row))
    session_plan = module_week_session_plan(module_row, 0 if session_rows else len(week_rows))
    external_calendar = clean_str(series_row.get('meeting_type')) == 'linked-external'
    external_slots = []
    if external_calendar:
        # Imported occurrences already exist in Microsoft. Moving curriculum
        # content changes which occurrence delivers it, not that occurrence's
        # date, attendance or recordings.
        external_slots, _external_plan = module_week_delivery_slots(module_row, group_row, len(week_rows))
    session_start_time, _session_end_time, session_duration = module_session_clock(module_row, group_row)
    default_points = live_session_component_points() if create_missing else 0
    now = datetime.utcnow()
    updated = 0
    created = 0
    handled_component_ids = set()
    claimed_occurrence_ids = set()

    def free_occurrence_on(date_value):
        """The unclaimed session Microsoft holds on one date, if there is one."""
        if not date_value:
            return None
        return next((row for row in occurrence_rows
                     if clean_str(row.get('id')) not in claimed_occurrence_ids
                     and occurrence_local_date(row, series_settings) == date_value), None)

    def occurrence_for_component(existing_settings, slot_index):
        """Which booked session a live-session component owns.

        Paired by DATE, never by counting. Session numbers cannot carry this:
        cancelling a session leaves its number in place, a week with no live
        session still consumes a delivery slot number, and a series that has
        been renumbered once holds both schemes at the same time. Counting
        components against those numbers slid every session after the first gap
        onto the previous one's meeting, and left the last real booking attached
        to nothing.

        In order of authority:

        1. The date this component itself currently runs on -- where its own
           meeting sits, which is what keeps a booked session with its invited
           attendees while a plan moves around it.
        2. The date its week is planned for, which is what dates a component
           that has never been booked, and what re-pairs one whose stored date
           was left on another session's day.
        3. For a component with no date at all -- neither its own nor a planned
           one for its week -- the next unclaimed session in order, which is
           what fills a freshly created series.

        A component that matches none of these keeps the meeting it already has
        rather than being handed an unrelated one. A week planned for a day the
        calendar holds no session on is simply not booked yet: handing it the
        next free session took the following week's meeting and left that week
        with none.
        """
        existing_settings = existing_settings if isinstance(existing_settings, dict) else {}
        tracked_id = clean_str(existing_settings.get('teamsOccurrenceId'))
        tracked_number = parse_int(existing_settings.get('teamsSessionNumber'), 0)
        tracked_series = clean_str(existing_settings.get('teamsLiveSessionId'))
        tracked = next((row for row in occurrence_rows if (
            clean_str(row.get('id')) not in claimed_occurrence_ids
            and (
                (clean_str(row.get('id')) == tracked_id) if tracked_id else (
                    tracked_series == clean_str(series_row.get('id'))
                    and tracked_number > 0
                    and parse_int(row.get('session_number'), 0) == tracked_number
                )
            )
        )), None)
        if tracked:
            return tracked
        stored_date = clean_str(existing_settings.get('sessionDate'))[:10]
        found = free_occurrence_on(stored_date)
        if found:
            return found
        planned = session_plan[slot_index] if slot_index < len(session_plan) else {}
        planned_date = format_date(planned.get('date'))
        found = free_occurrence_on(planned_date)
        if found or stored_date or planned_date:
            return found
        return next((row for row in occurrence_rows if clean_str(row.get('id')) not in claimed_occurrence_ids), None)

    def settings_for_session(slot_index, occurrence, existing_settings=None, existing_link=''):
        """Everything that belongs to one live session.

        ``slot_index`` is the position in the module's dated plan. A
        content-only week still occupies one, so week N stays on delivery slot
        N -- that is what dates a live session nobody has dated by hand.
        ``occurrence`` is the booked session this component owns, chosen by
        `occurrence_for_component`.
        """
        existing_settings = existing_settings if isinstance(existing_settings, dict) else {}
        if not occurrence and stored_calendar_series(series_row):
            saved_link = clean_str(existing_settings.get('liveSessionUrl') or existing_settings.get('teamsMeetingUrl') or existing_link)
            if saved_link:
                # A failed match is not an instruction to erase an existing
                # booking. Keep its identity/history and expose the unresolved
                # binding; a later verified update can match it again.
                return {**existing_settings, 'liveSessionUrl': saved_link,
                        'teamsMeetingUrl': clean_str(existing_settings.get('teamsMeetingUrl')) or saved_link,
                        'teamsCalendarBinding': 'missing'}
            empty_settings = {key: '' for key in ('teamsMeetingUrl', 'liveSessionUrl', 'teamsEventId', 'teamsOnlineMeetingId', 'teamsOccurrenceId', 'teamsLiveSessionId', 'teamsSessionNumber', 'sessionDateTimeUtc', 'teamsStartDateTimeUtc')}
            if 'teamsCalendarBinding' in existing_settings:
                empty_settings['teamsCalendarBinding'] = 'missing'
            override = clean_str(existing_settings.get('liveSessionLinkOverride'))
            if override:
                empty_settings['liveSessionUrl'] = override
                empty_settings['teamsMeetingUrl'] = override
            return empty_settings
        session_settings = live_occurrence_component_settings(occurrence, series_settings)
        # Imported defaults may still be stored on an unbooked component even
        # though Create used its group's current clock. Stamp the verified clock
        # when first attaching; subsequent restores keep confirmed overrides.
        if occurrence and not (clean_str(existing_settings.get('teamsLiveSessionId'))
                               and parse_int(existing_settings.get('teamsSessionNumber'), 0) > 0):
            start = parse_graph_datetime(occurrence.get('scheduled_start'))
            if start:
                zone = ZoneInfo(series_settings.get('sessionTimeZone') or graph_timezone_iana({}))
                local = start.replace(tzinfo=start.tzinfo or timezone.utc).astimezone(zone)
                session_settings['sessionTime'] = local.strftime('%H:%M')
        shared_series_settings = {
            key: value
            for key, value in series_settings.items()
            if key not in {'sessionDate', 'sessionDay', 'sessionTime', 'sessionDateTimeUtc', 'teamsStartDateTimeUtc'}
        }
        planned = session_plan[slot_index] if slot_index < len(session_plan) else {}
        session_date = format_date(planned.get('date'))
        slot_time, _slot_end, slot_duration = module_session_clock(module_row, group_row, session_date)
        planned_settings = {}
        tracked_occurrence = (
            clean_str(existing_settings.get('sessionDateTimeUtc'))
            or (
                clean_str(existing_settings.get('teamsLiveSessionId'))
                and parse_int(existing_settings.get('teamsSessionNumber'), 0) > 0
            )
        )
        if session_date and not (clean_str(existing_settings.get('sessionDate')) or tracked_occurrence):
            planned_settings['sessionDate'] = session_date
            planned_settings['sessionTime'] = slot_time
            planned_settings['durationMinutes'] = slot_duration
            planned_settings['teamsDurationMinutes'] = slot_duration
            # Only when the calendar holds no instant of its own for this
            # session: the occurrence's start is the one Teams will really run.
            if not clean_str(session_settings.get('sessionDateTimeUtc')):
                planned_instant = calendar_clock_to_utc_iso(session_date, slot_time, series_settings.get('sessionTimeZone'))
                if planned_instant:
                    planned_settings['sessionDateTimeUtc'] = planned_instant
                    planned_settings['teamsStartDateTimeUtc'] = planned_instant
        attached = {**shared_series_settings, **planned_settings, **session_settings}
        if 'teamsCalendarBinding' in existing_settings:
            attached['teamsCalendarBinding'] = 'matched' if occurrence else 'missing'
        # A bulk authoring replacement intentionally changes the join URL while
        # leaving the Teams meeting identity and occurrence metadata intact.
        # Keep that explicit override when the calendar is re-attached after a
        # normal module save; an ordinary edit without this marker remains
        # authoritative from the verified calendar occurrence.
        override = clean_str(existing_settings.get('liveSessionLinkOverride'))
        if override:
            attached['liveSessionUrl'] = override
            attached['teamsMeetingUrl'] = override
        return attached

    session_index = 0
    sessions_per_week = delivery_days_per_week(module_row)
    for week_index, week_row in enumerate(week_rows):
        week_id = clean_str(week_row.get('id'))
        live_rows = [row for row in components_by_week.get(week_id, []) if frontend_component_type(row.get('type')) == 'live-session']
        for live_index, row in enumerate(live_rows):
            existing_settings = component_builder_settings(row)
            # Updating the main calendar does not adopt a different meeting
            # explicitly selected for this component (for example a master class).
            explicit_link = clean_str(existing_settings.get('liveSessionLinkOverride'))
            if explicit_link and explicit_link != clean_str(series_row.get('join_url')):
                session_index += 1
                handled_component_ids.add(clean_str(row.get('id')))
                continue
            # A live session delivered by its own additional meeting is not part
            # of this series. It is never sent to the module's calendar, so it
            # owns no occurrence here and must keep ITS meeting's link rather
            # than be handed the series'. The slot index still advances: the
            # week occupies its place in the dated plan either way, and the
            # sessions after it would otherwise all shift a week early.
            # See teams_week_meeting.py.
            additional_link = clean_str(existing_settings.get('extraTeamsMeetingUrl'))
            meeting_scope = live_session_meeting_scope(existing_settings, series_already_booked)
            if not additional_link and meeting_scope != 'main':
                # Reserved for an additional meeting not booked yet, or not yet
                # assigned to either calendar. Neither may be handed one of the
                # series' occurrences or its link -- that is how a week ends up
                # delivered twice. Left exactly as it is; the slot still advances
                # for the same reason as the branch below.
                session_index += 1
                handled_component_ids.add(clean_str(row.get('id')))
                continue
            if additional_link:
                session_index += 1
                handled_component_ids.add(clean_str(row.get('id')))
                if not dry_run:
                    update_authoring_rows(AUTHORING_COMPONENTS_TABLE, 'id = %s', [row.get('id')], {
                        'settings_json': json_db_value({
                            **existing_settings,
                            'liveSessionUrl': additional_link,
                            'teamsMeetingUrl': additional_link,
                        }),
                        'live_sessions_link': additional_link,
                        'updated_at': now,
                    })
                updated += 1
                continue
            if external_calendar:
                slots = external_slots[week_index] if week_index < len(external_slots) else []
                planned = slots[live_index] if live_index < len(slots) else {}
                attached = external_calendar_settings(
                    existing_settings, series_row, planned, occurrence_rows, claimed_occurrence_ids,
                    series_settings.get('sessionTimeZone') or graph_timezone_iana({}),
                )
                session_index += 1
                handled_component_ids.add(clean_str(row.get('id')))
                if attached is not None:
                    attached_settings = {**existing_settings, **attached, LIVE_SESSION_MEETING_SCOPE_KEY: 'main'}
                    if attached_settings != existing_settings or clean_str(row.get('live_sessions_link')) != attached['liveSessionUrl']:
                        if not dry_run:
                            update_authoring_rows(AUTHORING_COMPONENTS_TABLE, 'id = %s', [row.get('id')], {
                                'settings_json': json_db_value(attached_settings),
                                'live_sessions_link': attached['liveSessionUrl'], 'updated_at': now,
                            })
                        updated += 1
                continue
            occurrence = occurrence_for_component(existing_settings, session_index)
            if occurrence:
                claimed_occurrence_ids.add(clean_str(occurrence.get('id')))
            settings_for_week = settings_for_session(session_index, occurrence, existing_settings, row.get('live_sessions_link'))
            if not occurrence and settings_for_week.get('teamsCalendarBinding') == 'missing' and unresolved_components is not None:
                unresolved_components.append(clean_str(row.get('id')))
            session_index += 1
            handled_component_ids.add(clean_str(row.get('id')))
            if not dry_run:
                # Recorded as the module calendar's whether or not Microsoft
                # booked it this time: a session the series took but Graph
                # failed to hold is retried by the next Update, rather than read
                # as a week nobody has assigned yet.
                update_authoring_rows(AUTHORING_COMPONENTS_TABLE, 'id = %s', [row.get('id')], {
                    'settings_json': json_db_value({**existing_settings, **settings_for_week,
                                                    LIVE_SESSION_MEETING_SCOPE_KEY: 'main'}),
                    'live_sessions_link': clean_str(settings_for_week.get('liveSessionUrl') or settings_for_week.get('teamsMeetingUrl')),
                    'updated_at': now,
                })
            updated += 1
        if not create_missing or external_calendar:
            if not live_rows and not session_rows:
                # A content-only week still occupies one dated slot, matching the
                # structure payload's backward-compatible week-header walk.
                session_index += 1
            continue
        missing_count = 0 if session_rows else max(0, sessions_per_week - len(live_rows))
        for offset in range(missing_count):
            occurrence = occurrence_for_component({}, session_index)
            if occurrence:
                claimed_occurrence_ids.add(clean_str(occurrence.get('id')))
            settings_for_week = settings_for_session(session_index, occurrence)
            session_index += 1
            join_url = clean_str(settings_for_week.get('liveSessionUrl') or settings_for_week.get('teamsMeetingUrl'))
            position = len(components_by_week.get(week_id, [])) + offset
            duration = parse_int(settings_for_week.get('durationMinutes'), session_duration) or session_duration
            if dry_run:
                created += 1
                continue
            authoring_upsert(AUTHORING_COMPONENTS_TABLE, ['id'], {
                'id': f'COMP-{uuid.uuid4().hex.upper()}',
                'week_id': week_id,
                'module_catalogue_id': module_catalogue_id,
                'type': 'live_session',
                # Never the week's own name: a live-session component titled after
                # its week reads as a generated placeholder and is filtered out of
                # the authoring model (isGeneratedWeekPlaceholderComponent).
                'title': f'Live Teams Session {position + 1}',
                'description': '',
                'expected_otjh': round(max(15, duration) / 60, 2),
                'points': default_points,
                'ksb_mappings': json_db_value([]),
                'reflection_required': False,
                'workplace_evidence_required': False,
                'tutor_validation_required': False,
                'display_order': position,
                'settings_json': json_db_value({
                    'completionRule': 'Attend or watch recording',
                    'evidenceRequired': 'Attendance or recording completion',
                    'contentStatus': 'Draft',
                    'version': '0.1',
                    'attendanceRequired': True,
                    'recordingExpected': True,
                    **settings_for_week,
                    LIVE_SESSION_MEETING_SCOPE_KEY: 'main',
                }),
                'live_sessions_link': join_url,
                'status': archive_state.ACTIVE,
            })
            created += 1

    # A live-session component whose week is gone still holds a join link, and
    # what this endpoint promises is that every one of them points at the
    # tracked meeting.
    for row in component_rows:
        if frontend_component_type(row.get('type')) != 'live-session':
            continue
        if clean_str(row.get('id')) in handled_component_ids:
            continue
        if external_calendar:
            # No authored week means no delivery date to match safely.
            continue
        orphan_settings = component_builder_settings(row)
        # Its own additional meeting, for the same reason as above: losing its
        # week must not hand it the series' link. Nor one reserved for one.
        if (clean_str(orphan_settings.get('extraTeamsMeetingUrl'))
                or live_session_meeting_scope(orphan_settings, series_already_booked) == 'additional'):
            continue
        if not dry_run:
            attached_orphan_settings = {**orphan_settings, **series_settings}
            override = clean_str(orphan_settings.get('liveSessionLinkOverride'))
            if override:
                attached_orphan_settings['liveSessionUrl'] = override
                attached_orphan_settings['teamsMeetingUrl'] = override
            update_authoring_rows(AUTHORING_COMPONENTS_TABLE, 'id = %s', [row.get('id')], {
                'settings_json': json_db_value(attached_orphan_settings),
                'live_sessions_link': clean_str(attached_orphan_settings.get('liveSessionUrl') or attached_orphan_settings.get('teamsMeetingUrl')),
                'updated_at': now,
            })
        updated += 1

    if (updated or created) and not dry_run:
        invalidate_curriculum_cache()
    return updated, created
