"""Meeting HTTP delivery and tracking; existing public decorators stay at the facade."""


def curriculum_teams_meeting_artifact_content(
    request, live_session_id, artifact_id, *, HttpResponse, HttpResponseRedirect, LIVE_SESSIONS_TABLE,
    LIVE_SESSION_ARTIFACTS_TABLE, LIVE_SESSION_OCCURRENCES_TABLE, StreamingHttpResponse, authoring_fetch_all,
    clean_str, ensure_live_session_tracking_tables, json_error, load_VideoImportError, load_admin_content,
    load_archived_live_session_recording_url, load_bunny_recording, load_copy, load_get_graph_settings,
    load_open_transcript, load_recording_player, logger, teams_online_meeting_owner_id, urllib_error,
    urllib_parse, urllib_request,
):
    """Proxy a tracked transcript or recording without exposing a Graph token."""
    get_graph_settings, microsoft_graph_token = load_get_graph_settings()

    ensure_live_session_tracking_tables()
    series_rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
    if not series_rows:
        return json_error('Live session series not found.', status=404)
    series = series_rows[0]
    occurrences = authoring_fetch_all(
        LIVE_SESSION_OCCURRENCES_TABLE,
        'live_session_id = %s',
        [live_session_id],
    )
    occurrence_ids = {clean_str(row.get('id')) for row in occurrences}
    artifacts = authoring_fetch_all(LIVE_SESSION_ARTIFACTS_TABLE, 'id = %s', [artifact_id])
    artifact = artifacts[0] if artifacts else None
    if not artifact or clean_str(artifact.get('occurrence_id')) not in occurrence_ids:
        return json_error('Meeting artifact not found.', status=404)

    artifact_type = clean_str(artifact.get('artifact_type')).lower()
    endpoint = 'transcripts' if artifact_type == 'transcript' else 'recordings' if artifact_type == 'recording' else ''
    if not endpoint:
        return json_error('Unsupported meeting artifact.', status=400)

    occurrence = next(
        (row for row in occurrences if clean_str(row.get('id')) == clean_str(artifact.get('occurrence_id'))),
        {},
    )
    if artifact_type == 'recording':
        bunny_recording, recording_uses_bunny = load_bunny_recording()
        if bunny_recording(artifact.get('metadata')) or recording_uses_bunny(occurrence, artifact):
            VideoImportError, = load_VideoImportError()
            recording_player, = load_recording_player()
            if bunny_recording(artifact.get('metadata')).get('state') != 'ready':
                return json_error('This Bunny recording is still being prepared. Please try again later.', status=409)
            if request.GET.get('preview') != '1':
                # Curriculum's existing Download links use this older endpoint.
                # Share the staff-authenticated original-file delivery; a DRM
                # rendition is only a playback source, not a downloadable MP4.
                copy, = load_copy()
                admin_content, = load_admin_content()
                download_request = copy(request)
                download_request.GET = request.GET.copy()
                download_request.GET['download'] = '1'
                return admin_content(download_request, live_session_id, artifact_id)
            try:
                # Legacy callers expect an MP4, including native video previews.
                # Serve Bunny's protected rendition without reverting to Microsoft/Azure.
                url = recording_player(artifact, download=True, referrer=request.build_absolute_uri('/'))
            except VideoImportError as failure:
                return json_error(str(failure), status=503)
            response = HttpResponseRedirect(url)
            response['Cache-Control'] = 'private, no-store'
            return response
        # Prefer the archived copy. Graph is an availability risk and deletes
        # recordings on its own retention schedule; once a recording is in the
        # container that is the copy worth serving, and redirecting hands the
        # bytes straight from Azure with range requests intact.
        archived_live_session_recording_url, = load_archived_live_session_recording_url()

        archived_url = archived_live_session_recording_url(
            clean_str(artifact.get('occurrence_id')),
            clean_str(artifact.get('graph_artifact_id')),
        )
        if archived_url:
            return HttpResponseRedirect(archived_url)

    # A recreated session's transcript and recording live under its own meeting,
    # so the identifiers come from the occurrence the artifact belongs to and fall
    # back to the series only for the sessions that share the series' meeting.
    occurrence_meeting_id = clean_str(occurrence.get('online_meeting_id'))
    organizer = clean_str(series.get('organizer_email'))
    meeting_id = occurrence_meeting_id or clean_str(series.get('online_meeting_id'))
    join_url = (
        (clean_str(occurrence.get('join_url')) if occurrence_meeting_id else '')
        or clean_str(series.get('join_url'))
    )
    owner_id = teams_online_meeting_owner_id(organizer, join_url)
    graph_artifact_id = clean_str(artifact.get('graph_artifact_id'))
    if not owner_id or not meeting_id or not graph_artifact_id:
        return json_error('The meeting artifact is missing its Graph identifiers.', status=409)

    path = (
        f'users/{urllib_parse.quote(owner_id, safe="")}/onlineMeetings/'
        f'{urllib_parse.quote(meeting_id, safe="")}/{endpoint}/'
        f'{urllib_parse.quote(graph_artifact_id, safe="")}/content'
    )
    graph_settings = get_graph_settings()
    url = f'{graph_settings["base_url"].rstrip("/")}/{path}'
    try:
        token = microsoft_graph_token()
    except RuntimeError as exc:
        # No token is a Microsoft availability failure like the URLError below,
        # not a server fault: answer 502 instead of an unhandled 500.
        logger.warning('Unable to fetch Teams %s content: %s', artifact_type, exc)
        return json_error(f'Microsoft Graph could not return the {artifact_type} content.', status=502)
    request_headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'text/vtt' if artifact_type == 'transcript' else 'video/mp4',
    }
    # <video preload="metadata"> and its seek bar both depend on being able to
    # ask for a byte range: without one it has to fetch the whole recording
    # before it can show a duration or play a second of it. Graph's own
    # /content route understands Range the same way a plain file download
    # does, so the browser's header is forwarded verbatim and Graph's answer
    # (200 or 206) decides what comes back -- this never guesses a range
    # itself, only relays the one the browser already asked for.
    range_header = clean_str(request.META.get('HTTP_RANGE')) if artifact_type == 'recording' else ''
    if range_header:
        request_headers['Range'] = range_header
    graph_request = urllib_request.Request(url, headers=request_headers, method='GET')
    try:
        open_transcript, = load_open_transcript()
        graph_response = open_transcript(urllib_request.urlopen, graph_request, timeout=45)
    except urllib_error.HTTPError as exc:
        if exc.code == 416 and artifact_type == 'recording':
            response = HttpResponse(status=416)
            content_range = exc.headers.get('Content-Range')
            if content_range:
                response['Content-Range'] = content_range
            return response
        detail = exc.read().decode('utf-8', errors='ignore')
        logger.warning('Unable to fetch Teams %s content: %s %s', artifact_type, exc.code, detail)
        return json_error(f'Microsoft Graph could not return the {artifact_type} content.', status=exc.code)
    except urllib_error.URLError as exc:
        logger.warning('Unable to fetch Teams %s content: %s', artifact_type, exc)
        return json_error(f'Microsoft Graph could not return the {artifact_type} content.', status=502)

    content_type = graph_response.headers.get('Content-Type') or ('text/vtt' if artifact_type == 'transcript' else 'video/mp4')
    filename = f'{live_session_id}-{artifact_type}.{"vtt" if artifact_type == "transcript" else "mp4"}'
    if artifact_type == 'recording':
        # Streamed straight through rather than buffered -- a recording can run
        # to hundreds of MB, and FileResponse cannot help here anyway: it only
        # learns a Content-Length by seeking the file it is given, and this one
        # is a live, one-way socket read with no seek of its own.
        response = StreamingHttpResponse(
            iter(lambda: graph_response.read(65536), b''),
            status=graph_response.status,
            content_type=content_type,
        )
        response['Accept-Ranges'] = 'bytes'
        content_length = graph_response.headers.get('Content-Length')
        if content_length:
            response['Content-Length'] = content_length
        content_range = graph_response.headers.get('Content-Range')
        if content_range:
            response['Content-Range'] = content_range
        as_attachment = clean_str(request.GET.get('preview')).lower() not in {'1', 'true', 'yes'}
        response['Content-Disposition'] = (
            f'{"attachment" if as_attachment else "inline"}; filename="{filename}"'
        )
        return response
    content = graph_response.read()
    graph_response.close()
    response = HttpResponse(content, content_type=content_type)
    as_attachment = clean_str(request.GET.get('preview')).lower() not in {'1', 'true', 'yes'}
    response['Content-Disposition'] = (
        f'{"attachment" if as_attachment else "inline"}; filename="{filename}"'
    )
    return response


def curriculum_teams_meeting_join(
    request, live_session_id, occurrence_id, *, HttpResponse, LIVE_SESSIONS_TABLE,
    LIVE_SESSION_JOIN_LAUNCHES_TABLE, LIVE_SESSION_OCCURRENCES_TABLE, authoring_fetch_all, authoring_upsert,
    clean_str, datetime, ensure_live_session_tracking_tables, json_db_value, json_error, parse_int, urlparse,
    uuid,
):
    """Record the Week/occurrence context, then redirect to the shared Teams URL."""
    ensure_live_session_tracking_tables()
    rows = authoring_fetch_all(
        LIVE_SESSION_OCCURRENCES_TABLE,
        'id = %s and live_session_id = %s',
        [occurrence_id, live_session_id],
    )
    if not rows:
        return json_error('Live-session occurrence not found.', status=404)
    occurrence = rows[0]
    series_rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
    series = series_rows[0] if series_rows else {}
    if series.get('status') == 'cancelled' or occurrence.get('status') == 'cancelled':
        return json_error('This Teams session has been cancelled.', status=410)
    if occurrence.get('status') == 'superseded':
        return json_error('This Teams session is no longer part of the module plan.', status=410)
    join_url = clean_str(occurrence.get('join_url')) or clean_str(series.get('join_url'))
    parsed = urlparse(join_url)
    hostname = (parsed.hostname or '').lower()
    if parsed.scheme != 'https' or not (hostname == 'teams.microsoft.com' or hostname.endswith('.teams.microsoft.com')):
        return json_error('This occurrence does not have a valid Microsoft Teams link.', status=409)

    user = getattr(request, 'user', None)
    is_authenticated = bool(user and getattr(user, 'is_authenticated', False))
    launch_id = f'JOIN-{uuid.uuid4().hex.upper()}'
    authoring_upsert(LIVE_SESSION_JOIN_LAUNCHES_TABLE, ['id'], {
        'id': launch_id,
        'live_session_id': live_session_id,
        'occurrence_id': occurrence_id,
        'launched_at': datetime.utcnow(),
        'attendance_report_id': '',
        'viewer_id': clean_str(getattr(user, 'pk', '')) if is_authenticated else '',
        'viewer_email': clean_str(getattr(user, 'email', '')).lower() if is_authenticated else '',
        'viewer_name': clean_str(getattr(user, 'get_full_name', lambda: '')()) if is_authenticated else '',
        'user_agent': clean_str(request.META.get('HTTP_USER_AGENT'))[:2000],
        'referrer': clean_str(request.META.get('HTTP_REFERER'))[:2000],
        'metadata': json_db_value({'sessionNumber': parse_int(occurrence.get('session_number'), 0)}),
        'created_at': datetime.utcnow(),
    })
    response = HttpResponse(status=302)
    response['Location'] = join_url
    response['Cache-Control'] = 'no-store, private'
    return response
