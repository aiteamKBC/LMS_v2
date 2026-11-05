"""Check saved week bindings before a calendar update sends any Graph write."""


def calendar_occurrence_details(series, occurrences):
    """Read original recurrence instances through their verified master.

    Imported rows keep each real Microsoft instance ID for history. Those IDs
    are not separate meetings and must not receive standalone invitation writes.
    Only the in-memory transport view is changed; another join link keeps its
    own event identity.
    """
    if series.get('meeting_type') != 'linked-external':
        return occurrences
    return [{**row, 'graph_event_id': series['graph_event_id']}
            if row.get('join_url') == series.get('join_url') else row for row in occurrences]


def unresolved_saved_bindings(series_id, components, occurrences, *, join_url=''):
    """A missing saved occurrence is not permission to adopt its neighbour.

    Historical/cancelled rows still prove an identity. Additional meetings,
    manual links and other series are outside this calendar's update.
    """
    known = {str(row.get('id') or '') for row in occurrences}
    unresolved = []
    for component in components:
        settings = component.get('settings') or {}
        if (settings.get('extraTeamsMeetingUrl') or settings.get('teamsMeetingScope') == 'additional'
                or (settings.get('liveSessionLinkOverride') and settings['liveSessionLinkOverride'] != join_url)
                or str(settings.get('teamsLiveSessionId') or '') != str(series_id)):
            continue
        identity = str(settings.get('teamsOccurrenceId') or '')
        if identity and identity not in known:
            unresolved.append(component['id'])
    return unresolved
