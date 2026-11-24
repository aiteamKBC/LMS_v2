"""Deterministic meeting decisions over Python values and explicit pure helpers."""


def live_session_meeting_groups(
    series, occurrences, *, clean_str, teams_meeting_base_path,
):
    """(Graph meeting path, the occurrences it holds) for one live-session series.

    Normally a single pair -- the series meeting and every session in it. A
    session recreated on its own event carries its own online meeting, and Graph
    lists a meeting's attendance, transcripts and recordings only under the
    meeting that ran, so those sessions are asked for separately.
    """
    organizer = clean_str(series.get('organizer_email'))
    series_meeting_id = clean_str(series.get('online_meeting_id'))
    series_join_url = clean_str(series.get('join_url'))
    grouped = {}
    for row in occurrences:
        own_join_url = clean_str(row.get('join_url'))
        meeting_id = clean_str(row.get('online_meeting_id')) or (series_meeting_id if not own_join_url or own_join_url == series_join_url else '')
        if not meeting_id:
            continue
        bucket = grouped.setdefault(meeting_id, {
            'join_url': clean_str(row.get('join_url')) or series_join_url,
            'rows': [],
        })
        bucket['rows'].append(row)
    return [
        (teams_meeting_base_path(organizer, meeting_id, bucket['join_url']), bucket['rows'])
        for meeting_id, bucket in grouped.items()
    ]


def teams_series_invited(
    series, *, teams_series_email_list,
):
    """Everyone a stored calendar row invites, in any role, lower-cased."""
    return {email.lower() for email in teams_series_email_list(
        [series.get('organizer_email')], series.get('attendees'), series.get('presenters'), series.get('co_organizers'))}


def strip_shared_teams_delivery_settings(
    settings, *, SHARED_TEAMS_DELIVERY_SETTING_KEYS, clean_str,
):
    """Remove source-owned Teams identity from a shared-module payload."""
    result = {
        key: value for key, value in (settings or {}).items()
        if key not in SHARED_TEAMS_DELIVERY_SETTING_KEYS
    }
    # A newly pasted URL is an explicit lack of proof, not a source-owned ID.
    # Learner readers must retain that fact instead of reviving a positional
    # source occurrence after the next full save.
    if ((settings or {}).get('teamsCalendarBinding') == 'unverified'
            and clean_str((settings or {}).get('liveSessionLinkOverride'))):
        result['teamsCalendarBinding'] = 'unverified'
    return result


def module_live_sessions_affected(
    stored, merged, *, LIVE_SESSION_SCHEDULE_FIELDS, clean_str, load_same, normalise_component_type,
):
    """Could this save change what the Teams attachment pass would write?

    It pairs the module's live sessions, in module order, with the calendar's
    occurrences on the module's delivery schedule. So it is needed when the
    live sessions themselves, their order or position, the week count or the
    schedule moved -- and not for an edit to a reading, a quiz or a title.
    Errs towards True: when in doubt the pass runs, as it always did.
    """
    if not stored:
        return True
    same, = load_same()

    def live(structure):
        found = []
        for week_index, week in enumerate(structure.get('weekStructure') or []):
            for component in week.get('components') or []:
                if normalise_component_type(component.get('type')) == 'live_session':
                    found.append((week_index, clean_str(component.get('id')), component.get('settings') or {}))
        return found

    if len(stored.get('weekStructure') or []) != len(merged.get('weekStructure') or []):
        return True
    before, after = live(stored), live(merged)
    if [item[:2] for item in before] != [item[:2] for item in after]:
        return True
    if any(not same(old[2], new[2]) for old, new in zip(before, after)):
        return True
    return any(
        field in merged and not same(stored.get(field), merged.get(field))
        for field in LIVE_SESSION_SCHEDULE_FIELDS
    )
