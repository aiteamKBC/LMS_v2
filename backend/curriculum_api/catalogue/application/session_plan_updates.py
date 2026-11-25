"""Apply reviewed delivery plans and persist only changed authored session settings.

No views, provider or Django imports.
"""
from ..domain.week_session_dates import stamp_week_session_dates
from curriculum_api.weekly_schedule import module_week_boundary_mode


def apply_module_session_plan_to_weeks(
    module, group_row, weeks, *, holidays=None, calendar_clock_to_utc_iso, clean_str, format_date,
    is_calendar_unavailable, module_live_session_clock, module_session_clock,
    module_week_delivery_slots, parse_int,
    module_delivery_row,
    module_session_plan_for_weeks,
):
    """Stamp the module's planned session date/day/time onto its weeks in place.

    Shared by the single-module and batched structure readers so the two cannot
    drift: the batched one lacked this entirely, which silently dropped
    sessionDate/sessionDay/sessionStartTime/sessionDurationMinutes from every
    week it returned. With ``holidays`` supplied it issues no queries;
    otherwise it reads the cohort's selected holidays through the shared
    session planner.

    Authored week N is calendar week N. Weeks run Monday to Sunday from the
    module's own starting week, and a week owns the group's delivery days that
    fall inside its window -- so a Mon+Fri module gives every full week two
    dates because the calendar holds two, not because a session count was
    divided by a week count. That division could only ever give every week the
    same number, which is wrong the moment a module starts mid-week: such a
    module's first week owns only the delivery days from its start date on, and
    the run must not slide by the days it never had.

    A week over-authored with more live sessions than its window has delivery
    days leaves the extras undated. There is no date to give them -- the group
    does not deliver again that week -- and no caller may invent one, because an
    invented date becomes a real calendar entry and a real Teams meeting.
    """
    # Planned on the group's delivery days and clock, falling back to the
    # module's own only where the group states none -- so moving the group
    # re-dates the weeks of every module delivered to it.
    #
    # One slot per delivery day the week runs: a Monday group gives each week
    # one, a Mon+Fri group two, and the week's Nth live session takes the Nth of
    # them. Authored week N takes window N, so a week with no delivery day in
    # its own window (a module whose group pauses a week) simply gets nothing
    # rather than borrowing the next week's date.
    try:
        study_windows = []
        if module_week_boundary_mode(module) == 'calendar':
            study_plan = module_session_plan_for_weeks(module_delivery_row(module, group_row), len(weeks), holidays=holidays)
            study_windows = study_plan.get('weeks') or []
            session_plan = study_plan.get('sessions') or []
            slots_by_week = [[slot for slot in session_plan if slot.get('weekNumber') == index + 1] for index in range(len(weeks))]
        else:
            slots_by_week, session_plan = module_week_delivery_slots(
                module, group_row, len(weeks), holidays=holidays, weeks=weeks,
            )
    except ValueError as exc:
        if not is_calendar_unavailable(exc):
            raise
        # This is read-side enrichment only. Keep authored/booked dates and
        # report the missing reference data; scheduling writes remain strict.
        module['_calendar_error'] = str(exc)
        for week in weeks:
            week['calendarError'] = str(exc)
        return
    return stamp_week_session_dates(
        module, group_row, weeks, slots_by_week, session_plan,
        calendar_clock_to_utc_iso=calendar_clock_to_utc_iso, clean_str=clean_str,
        format_date=format_date, module_live_session_clock=module_live_session_clock,
        module_session_clock=module_session_clock, parse_int=parse_int,
        study_windows=study_windows,
    )


def persist_group_module_session_dates(
    module_rows, group_row, *, apply_module_session_plan_to_weeks, as_json_value, clean_str,
    cohort_selected_holidays_by_cohort, datetime, defaultdict, frontend_component_type, parse_int,
    read_session_plan_rows, write_session_settings,
):
    """Persist a group's new delivery dates onto its unbooked live sessions.

    The group PATCH updates the module rows that own the session plan.  Learner
    delivery, however, reads the concrete ``sessionDate`` stored on each live
    component, so leaving those copies behind makes Curriculum say Friday while
    the learner still says Thursday.  Reuse the same planner the structure
    readers use, then write only settings that actually moved.

    ``apply_module_session_plan_to_weeks`` deliberately leaves a Microsoft-
    confirmed occurrence alone.  Those meetings continue through the explicit
    Teams reschedule flow (and the group PATCH response still reports their
    calendars as stale), so this helper cannot silently move an invitation.
    """
    modules = [row for row in (module_rows or []) if clean_str(row.get('module_catalogue_id'))]
    if not modules:
        return 0

    holidays_by_cohort = cohort_selected_holidays_by_cohort([
        clean_str(row.get('cohort_id'))
        for row in modules
        if clean_str(row.get('cohort_id'))
    ])
    now = datetime.utcnow()
    updated = 0

    for module in modules:
        catalogue_id = clean_str(module.get('module_catalogue_id'))
        week_rows, component_rows = read_session_plan_rows(catalogue_id)

        components_by_week = defaultdict(list)
        stored_settings = {}
        for row in component_rows:
            if frontend_component_type(row.get('type')) != 'live-session':
                continue
            component_id = clean_str(row.get('id'))
            settings = as_json_value(row.get('settings_json'), {})
            settings = settings if isinstance(settings, dict) else {}
            stored_settings[component_id] = settings
            components_by_week[clean_str(row.get('week_id'))].append({
                'id': component_id,
                'type': 'live-session',
                'settings': settings,
            })

        weeks = [{
            'id': clean_str(row.get('id')),
            'weekNumber': parse_int(row.get('week_number'), index + 1),
            'components': components_by_week.get(clean_str(row.get('id')), []),
        } for index, row in enumerate(week_rows)]
        apply_module_session_plan_to_weeks(
            module,
            group_row or {},
            weeks,
            holidays=holidays_by_cohort.get(clean_str(module.get('cohort_id'))) or [],
        )

        for week in weeks:
            for component in week.get('components') or []:
                component_id = clean_str(component.get('id'))
                planned_settings = component.get('settings') if isinstance(component.get('settings'), dict) else {}
                if planned_settings == stored_settings.get(component_id, {}):
                    continue
                write_session_settings(component_id, planned_settings, now)
                updated += 1

    return updated
