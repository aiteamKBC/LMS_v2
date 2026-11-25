"""Meeting storage and Graph adapters; runtime dependencies are supplied by the facade."""


def teams_online_meeting_from_join_url(
    organizer, join_url, *, load_microsoft_graph_request, teams_online_meeting_owner_id, urllib_parse,
):
    """Find the onlineMeeting behind a calendar event when permissions allow."""
    if not join_url:
        return {}
    escaped_url = join_url.replace("'", "''")
    query = urllib_parse.urlencode({'$filter': f"joinWebUrl eq '{escaped_url}'"})
    owner_key = urllib_parse.quote(teams_online_meeting_owner_id(organizer, join_url), safe='')
    microsoft_graph_request, = load_microsoft_graph_request()
    response = microsoft_graph_request('GET', f'users/{owner_key}/onlineMeetings?{query}')
    values = response.get('value') if isinstance(response, dict) else []
    return values[0] if values else {}


def teams_expanded_instances(
    owner_key, event_key, instance_query, expected, deadline_seconds=15.0, *, clean_str, graph_event_utc,
    load_microsoft_graph_request, time,
    read_calendar_instances,
):
    """The series' occurrences, waited for until Microsoft has expanded them.

    Extending a recurrence is not atomic on Microsoft's side. The PATCH that
    raises a four-session series to ten answers straight away, but the very next
    read of ``/instances`` can still list only the four that existed before.
    Reconciling against that answer leaves every added session un-shifted, and
    the verification that follows then names the first added session as missing
    -- so an author who adds sessions to a calendar that already exists is told
    the update failed while Microsoft is still applying it, and the retry runs
    the whole path again. Re-read until the planned number of occurrences is
    there. A series that really is short costs the deadline once instead of
    reporting a mismatch that is not one.
    """
    microsoft_graph_request, = load_microsoft_graph_request()

    instances, waited = [], 0.0
    while True:
        instances = [graph_event_utc(item) for item in read_calendar_instances(
            microsoft_graph_request, f'users/{owner_key}/events/{event_key}/instances?{instance_query}')]
        if len(instances) >= expected or waited >= deadline_seconds:
            return sorted(instances, key=lambda item: clean_str((item.get('start') or {}).get('dateTime')))
        time.sleep(2.0)
        waited += 2.0
