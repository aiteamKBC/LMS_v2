"""Stamp delivered dates and clocks without reading or writing application data."""
from curriculum_api.weekly_schedule import module_week_boundary_mode


def stamp_week_session_dates(
    module, group_row, weeks, slots_by_week, session_plan, *, calendar_clock_to_utc_iso, clean_str,
    format_date, module_live_session_clock, module_session_clock, parse_int,
    study_windows=(),
):
    session_start_time, _session_end_time, session_duration = module_session_clock(module, group_row)
    for week_index, week in enumerate(weeks):
        if week_index < len(study_windows):
            window = study_windows[week_index]
            week.update(studyWeekStartDate=window['startDate'], studyWeekEndDate=window['endDate'], studyWeekHolidays=window['holidays'])
        live_components = [component for component in week.get('components') or [] if component.get('type') == 'live-session']
        slots = slots_by_week[week_index] if week_index < len(slots_by_week) else []
        # The week itself runs on the first of its delivery days.
        first_planned = slots[0] if slots else {}
        if live_components:
            for offset, component in enumerate(live_components):
                settings = component.get('settings') if isinstance(component.get('settings'), dict) else {}
                # A separately booked meeting retains its own date, clock and
                # link when weeks move, including when it is the first session.
                if clean_str(settings.get('extraTeamsMeetingUrl')):
                    continue
                # A live session runs on the day its week runs on. The date on
                # the component is a copy of the plan's, so it follows the plan
                # when the plan moves -- a changed start date, a week dragged up
                # the rail, a week inserted ahead of this one. Keeping the
                # first-stamped date instead left this week's header and the
                # session inside it naming different days, and the session's was
                # the one `authoring_session_links_by_catalogue` handed to the
                # calendar and to Teams.
                #
                # The one date this may not touch is an occurrence Microsoft has
                # confirmed: that is where a meeting real people were invited to
                # actually sits, and it moves through the reschedule endpoint,
                # not silently underneath them -- unless a saved override has
                # already rescheduled it, which is that endpoint's own record of
                # the move and the one thing this follows. `sessionDateTimeUtc`
                # is deliberately not part of that test -- it is written below on
                # every stamp, so counting it froze every date this ever set.
                #
                # Mirrors `applyModuleWeekSessionPlan` in
                # module-builder/moduleAuthoringData.ts. The two walks must agree:
                # where they have drifted before, the builder spent its first
                # render silently rewriting what this had just sent.
                booked_at_microsoft = (
                    clean_str(settings.get('teamsLiveSessionId'))
                    and parse_int(settings.get('teamsSessionNumber'), 0) > 0
                )
                # The Nth live session of the week takes the Nth delivery slot.
                # A live session beyond them is an ADDITIONAL one: the group
                # does not deliver again that week, so there is no planned date
                # to give it and the `continue` below leaves it on whatever its
                # author stored -- which may be nothing at all.
                planned = slots[offset] if offset < len(slots) else {}
                # A component that already names a session number is matched to
                # THAT session rather than to its position in the week, so a
                # booked session keeps hold of its own plan entry when the weeks
                # around it move. A number the plan no longer has falls back to
                # the week's own slot: the week walk stays the answer of last
                # resort, never `{}`, which would have left the session undated.
                explicit_number = parse_int(settings.get('teamsSessionNumber'), 0)
                if explicit_number:
                    planned = next(
                        (item for item in session_plan if item.get('sessionNumber') == explicit_number),
                        planned,
                    )
                if booked_at_microsoft and not planned.get('rescheduled'):
                    continue
                session_date = format_date(planned.get('date'))
                if not session_date:
                    continue
                planned_day = clean_str(planned.get('day'))
                planned_rescheduled = bool(planned.get('rescheduled'))
                slot_time, _slot_end, slot_duration = module_live_session_clock(
                    module, '' if module_week_boundary_mode(module) else settings.get('sessionTime'),
                    0 if module_week_boundary_mode(module) else settings.get('durationMinutes'),
                    booked=booked_at_microsoft, group_row=group_row, session_date=session_date,
                )
                planned_settings = {
                    **settings,
                    'sessionDate': session_date,
                    'sessionDay': planned_day,
                    'sessionTime': slot_time,
                    'durationMinutes': slot_duration,
                    'teamsDurationMinutes': slot_duration,
                }
                planned_instant = calendar_clock_to_utc_iso(session_date, slot_time, settings.get('sessionTimeZone'))
                if planned_instant:
                    planned_settings['sessionDateTimeUtc'] = planned_instant
                    planned_settings['teamsStartDateTimeUtc'] = planned_instant
                if settings.get('teamsCalendarBinding') in {'missing', 'ambiguous', 'unverified'}:
                    # A planned delivery time does not confirm a Microsoft
                    # occurrence. Also clear a stamp left by an older planner.
                    planned_settings['teamsStartDateTimeUtc'] = ''
                if planned_rescheduled:
                    planned_settings['sessionRescheduled'] = True
                component['settings'] = planned_settings
            first_settings = live_components[0].get('settings')
            first_settings = first_settings if isinstance(first_settings, dict) else {}
            first_number = parse_int(first_settings.get('teamsSessionNumber'), 0)
            first_numbered = next(
                (item for item in session_plan if first_number > 0 and item.get('sessionNumber') == first_number),
                None,
            )
            if first_numbered:
                # Teams numbering can omit orientation and additional events.
                # Keep a confirmed date that already fits this authored week's
                # slots; a changed plan still moves the header when it no
                # longer fits. Mirrors applyModuleWeekSessionPlan.
                confirmed_date = (
                    format_date(first_settings.get('sessionDate'))
                    if clean_str(first_settings.get('teamsLiveSessionId')) else ''
                )
                first_planned = next(
                    (slot for slot in slots if slot.get('date') == confirmed_date),
                    first_numbered,
                )
        # The week runs on the day its live session is delivered on. A closed
        # delivery slot is not this week -- it is a reading week of its own,
        # which the plan's `slots` spine keeps in the curriculum at the closed
        # date -- so the authored week and everything in it moves down to the
        # next open slot together with the session it holds. Dating the week
        # from `slotDate` instead put the week on a day the module is shut and
        # disagreed with the frontend's `applyModuleWeekSessionPlan`, which has
        # walked the delivered date all along.
        session_date = format_date(first_planned.get('date'))
        session_start_time, _session_end_time, session_duration = module_session_clock(module, group_row, session_date)
        week['sessionDate'] = session_date
        week['sessionDay'] = clean_str(first_planned.get('day'))
        week['sessionStartTime'] = session_start_time if session_date else ''
        week['sessionDurationMinutes'] = session_duration if session_date else 0
        if first_planned.get('rescheduled'):
            week['sessionRescheduled'] = True
    return weeks
