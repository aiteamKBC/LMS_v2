"""Meeting HTTP delivery and tracking; existing public decorators stay at the facade."""


def parse_client_event_time(
    value, *, datetime, parse_graph_datetime, timezone,
):
    parsed = parse_graph_datetime(value)
    if not parsed:
        return datetime.utcnow()
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def curriculum_teams_recording_events(
    request, live_session_id, artifact_id, *, JsonResponse, LIVE_SESSIONS_TABLE, LIVE_SESSION_ARTIFACTS_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE, LIVE_SESSION_RECORDING_EVENTS_TABLE, authoring_fetch_all, bool_payload,
    clean_str, datetime, ensure_live_session_tracking_tables, insert_row, json, json_body, json_error,
    parse_client_event_time, parse_int, safe_float, uuid,
):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    ensure_live_session_tracking_tables()
    series_rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
    if not series_rows:
        return json_error('Live session series not found.', status=404)
    occurrences = authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [live_session_id])
    occurrence_by_id = {clean_str(row.get('id')): row for row in occurrences}
    artifacts = authoring_fetch_all(LIVE_SESSION_ARTIFACTS_TABLE, 'id = %s', [artifact_id])
    artifact = artifacts[0] if artifacts else None
    occurrence_id = clean_str((artifact or {}).get('occurrence_id'))
    if not artifact or occurrence_id not in occurrence_by_id:
        return json_error('Meeting recording not found.', status=404)
    if clean_str(artifact.get('artifact_type')).lower() != 'recording':
        return json_error('Only recording artifacts can receive recording tracking events.', status=400)

    viewer = payload.get('viewer') if isinstance(payload.get('viewer'), dict) else {}
    # Who watched is part of a session's record, so the signed-in account is the
    # authority on it: a viewer named in the body is whatever the caller typed.
    # The body is kept only as the fallback for a request with no session.
    account = getattr(request, 'login_account', None)
    if account is not None:
        viewer = {
            'id': clean_str(getattr(account, 'id', '')),
            'email': clean_str(getattr(account, 'email', '')),
            'name': clean_str(getattr(account, 'display_name', '')) or clean_str(getattr(account, 'email', '')),
            'role': clean_str(getattr(account, 'role', '')),
        }
    browser = payload.get('browser') if isinstance(payload.get('browser'), dict) else {}
    preview_session_id = clean_str(payload.get('previewSessionId'))[:128] or uuid.uuid4().hex
    events = payload.get('events') if isinstance(payload.get('events'), list) else []
    if not events:
        return json_error('No recording events were supplied.', status=400)

    now = datetime.utcnow()
    saved = 0
    for event in events[:200]:
        if not isinstance(event, dict):
            continue
        event_type = clean_str(event.get('type') or event.get('eventType'))[:64]
        if not event_type:
            continue
        video_time = max(0.0, safe_float(event.get('videoTimeSeconds') if 'videoTimeSeconds' in event else event.get('videoTime'), 0.0))
        previous_video_time = event.get('previousVideoTimeSeconds') if 'previousVideoTimeSeconds' in event else event.get('previousVideoTime')
        previous_video_time = None if previous_video_time is None else max(0.0, safe_float(previous_video_time, 0.0))
        skip_from = event.get('skipFromSeconds') if 'skipFromSeconds' in event else event.get('skipFrom')
        skip_to = event.get('skipToSeconds') if 'skipToSeconds' in event else event.get('skipTo')
        skip_from = None if skip_from is None else max(0.0, safe_float(skip_from, 0.0))
        skip_to = None if skip_to is None else max(0.0, safe_float(skip_to, 0.0))
        skip_delta = None
        if skip_from is not None and skip_to is not None:
            skip_delta = skip_to - skip_from
        metadata = event.get('metadata') if isinstance(event.get('metadata'), dict) else {}
        insert_row(LIVE_SESSION_RECORDING_EVENTS_TABLE, {
            'id': clean_str(event.get('id'))[:128] or uuid.uuid4().hex,
            'live_session_id': live_session_id,
            'occurrence_id': occurrence_id,
            'artifact_id': artifact_id,
            'preview_session_id': preview_session_id,
            'event_type': event_type,
            'viewer_id': clean_str(viewer.get('id'))[:255],
            'viewer_email': clean_str(viewer.get('email')).lower()[:320],
            'viewer_name': clean_str(viewer.get('name'))[:500],
            'viewer_role': clean_str(viewer.get('role'))[:128],
            'browser_session_id': clean_str(browser.get('sessionId') or payload.get('browserSessionId'))[:128],
            'client_event_id': clean_str(event.get('clientEventId') or event.get('id'))[:128],
            'event_time': parse_client_event_time(event.get('eventTime') or event.get('timestamp')) if event.get('eventTime') or event.get('timestamp') else now,
            'video_time_seconds': video_time,
            'previous_video_time_seconds': previous_video_time,
            'duration_seconds': None if event.get('durationSeconds') is None else max(0.0, safe_float(event.get('durationSeconds'), 0.0)),
            'watched_seconds_delta': max(0.0, safe_float(event.get('watchedSecondsDelta'), 0.0)),
            'playback_rate': max(0.0, safe_float(event.get('playbackRate'), 1.0)),
            'volume': None if event.get('volume') is None else max(0.0, min(1.0, safe_float(event.get('volume'), 0.0))),
            'muted': bool_payload(event.get('muted')) if event.get('muted') is not None else None,
            'skipped': bool_payload(event.get('skipped')) or event_type in {'seeked', 'seek_end', 'skip'},
            'skip_from_seconds': skip_from,
            'skip_to_seconds': skip_to,
            'skip_delta_seconds': skip_delta,
            'viewport_width': parse_int(browser.get('viewportWidth'), 0) or None,
            'viewport_height': parse_int(browser.get('viewportHeight'), 0) or None,
            'user_agent': clean_str(browser.get('userAgent') or request.META.get('HTTP_USER_AGENT'))[:1000],
            'page_url': clean_str(browser.get('pageUrl'))[:1000],
            'referrer': clean_str(browser.get('referrer') or request.META.get('HTTP_REFERER'))[:1000],
            'metadata': json.dumps(metadata),
        })
        saved += 1

    return JsonResponse({'saved': saved, 'previewSessionId': preview_session_id})
