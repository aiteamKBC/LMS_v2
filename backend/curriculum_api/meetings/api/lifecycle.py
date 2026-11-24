"""Meeting HTTP delivery and tracking; existing public decorators stay at the facade."""


def external_teams_calendar_refusal(
    series=None, *, clean_str, json_error,
):
    """A pasted/imported meeting must retain its original calendar and join link."""
    series = series or {}
    return json_error(
        'This module uses an existing Teams meeting imported or pasted into the LMS. '
        'Manage its dates and invitations in the original Teams calendar. '
        'Reattach saved Teams data to restore links already imported into the LMS; '
        'this does not fetch new dates from Teams. Creating another module calendar is blocked to preserve the existing link.',
        status=409, code='external_teams_calendar', calendarManagement='external',
        existingMeeting={
            'liveSessionId': clean_str(series.get('id')),
            'joinUrl': clean_str(series.get('join_url')),
            'webLink': clean_str(series.get('web_link')),
        },
    )


def curriculum_teams_meeting_occurrence_schedule(
    request, live_session_id, session_number, *, clean_str, json_error,
):
    """Retired: moving one session goes through the calendar's Edit session action.

    This route used to move one session in Microsoft silently -- no announced
    update to the people invited and no LMS change email -- and nothing in the
    LMS called it any more. Left in place it was a way round every rule the
    calendar actions keep: the review, the forced Microsoft notice, the change
    email after Microsoft confirms, and the action record. It now refuses
    before reading or writing anything, and says where the move belongs.
    """
    return json_error(
        'Moving one session is done with the Edit session action on the Teams calendar, which tells the '
        'people invited. This older route no longer changes Teams.',
        status=410, code='use_calendar_action', liveSessionId=clean_str(live_session_id),
    )


def module_teams_calendar_block_response(
    module_catalogue_id, *, DatabaseError, MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE, json_error, logger,
    module_future_teams_sessions,
):
    """409 when the module still has future Teams sessions, else None. Fails closed."""
    try:
        standing = module_future_teams_sessions(module_catalogue_id)
    except DatabaseError:
        logger.warning('Teams sessions of module %s could not be read before archiving.', module_catalogue_id)
        return json_error(
            'The module’s Teams calendar could not be checked, so it was not archived. Try again.',
            status=503, reason='module-teams-calendar-unchecked', deleted=False,
        )
    if not standing:
        return None
    return json_error(
        MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE, status=409, reason='module-has-active-teams-calendar',
        code='module_has_active_teams_calendar', deleted=False,
        liveSessionIds=sorted({item['liveSessionId'] for item in standing}), futureSessions=len(standing),
    )
