"""Meeting storage and Graph adapters; runtime dependencies are supplied by the facade."""


def persist_recreated_occurrence_details(
    live_session_id, recreated_details, *, LIVE_SESSION_OCCURRENCES_TABLE, clean_str, datetime,
    update_authoring_rows,
):
    """Point a moved session at the event and meeting Teams actually gave it.

    A recreated occurrence is its own event with its own Teams link and its own
    online meeting, so the series link and meeting ID are the wrong answer for
    it: learners would join a session that no longer exists, and its transcript,
    recording and attendance would be looked for under a meeting that never ran.
    """
    if not recreated_details:
        return
    now = datetime.utcnow()
    for detail in recreated_details:
        try:
            session_number = int(detail.get('session_number') or 0)
        except (TypeError, ValueError):
            continue
        if session_number <= 0:
            continue
        update = {}
        for column in ('graph_event_id', 'join_url', 'online_meeting_id'):
            value = clean_str(detail.get(column))
            if value:
                update[column] = value
        if not update:
            continue
        update['updated_at'] = now
        update_authoring_rows(
            LIVE_SESSION_OCCURRENCES_TABLE,
            'live_session_id = %s and session_number = %s',
            [live_session_id, session_number],
            update,
        )


def live_session_join_launches(
    occurrences, *, LIVE_SESSION_JOIN_LAUNCHES_TABLE, authoring_fetch_all, clean_str,
):
    occurrence_ids = [clean_str(row.get('id')) for row in occurrences if clean_str(row.get('id'))]
    if not occurrence_ids:
        return []
    placeholders = ', '.join(['%s'] * len(occurrence_ids))
    return authoring_fetch_all(
        LIVE_SESSION_JOIN_LAUNCHES_TABLE,
        f'occurrence_id in ({placeholders})',
        occurrence_ids,
        'launched_at asc',
    )


def upsert_live_session_artifact(
    occurrence, artifact_type, artifact, *, LIVE_SESSION_ARTIFACTS_TABLE, _same_artifact_under_new_graph_id,
    authoring_table_name, authoring_upsert, clean_str, connection, datetime, hashlib, json_db_value,
    parse_graph_datetime, parse_json_value, transaction,
):
    graph_id = clean_str(artifact.get('id'))
    if not graph_id:
        return False
    # Deterministic, not uuid4(): the upsert key below (occurrence_id +
    # artifact_type + graph_artifact_id) already recognises a re-synced
    # artifact as the same row, but a random id here still overwrote its own
    # primary key on every sync -- so a link or an open preview holding
    # yesterday's id 404'd the moment someone re-fetched attendance, even
    # though the underlying Teams artifact never changed. Hashing the same
    # key this row is matched on gives it one id for life.
    artifact_id = 'ART-' + hashlib.sha256(
        f"{occurrence['id']}|{artifact_type}|{graph_id}".encode('utf-8')
    ).hexdigest()[:32].upper()
    payload = {
        'id': artifact_id,
        'occurrence_id': occurrence['id'],
        'artifact_type': artifact_type,
        'graph_artifact_id': graph_id,
        'call_id': clean_str(artifact.get('callId')),
        'content_correlation_id': clean_str(artifact.get('contentCorrelationId')),
        'content_url': clean_str(
            artifact.get('transcriptContentUrl') if artifact_type == 'transcript'
            else artifact.get('recordingContentUrl')
        ),
        'created_datetime': parse_graph_datetime(artifact.get('createdDateTime')),
        'end_datetime': parse_graph_datetime(artifact.get('endDateTime')),
        'metadata': json_db_value(artifact),
    }
    # Serialize against staff hide/restore. Graph refreshes must not overwrite
    # LMS visibility, including a toggle committed while discovery was running.
    with transaction.atomic(), connection.cursor() as cursor:
        lock = ' FOR UPDATE' if connection.vendor == 'postgresql' else ''
        if lock:
            # Two syncs of one meeting (a retry overlapping a worker) both find
            # no row for a new id and would both insert. One session's artifacts
            # of one type are written one at a time; the lock ends with the transaction.
            cursor.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',
                           [f"live-session-artifact|{occurrence['id']}|{artifact_type}"])
        cursor.execute(f'SELECT metadata FROM {authoring_table_name(LIVE_SESSION_ARTIFACTS_TABLE)} '
                       'WHERE occurrence_id=%s AND artifact_type=%s AND graph_artifact_id=%s' + lock,
                       [occurrence['id'], artifact_type, graph_id])
        existing = cursor.fetchone()
        metadata = dict(artifact)
        metadata.pop('lmsHiddenFromLearners', None)
        metadata.pop('lmsTranscriptTimeline', None)
        metadata.pop('lmsBunnyRecording', None)
        same_recording = None if existing else _same_artifact_under_new_graph_id(cursor, lock, payload)
        if same_recording:
            # Teams re-issued the id of an artifact already saved (same call and
            # recording window). Keep the one LMS row -- its id, archive, visibility
            # and transcript timing -- and only move it to the current Graph id.
            row_id, saved = same_recording
            saved_metadata = parse_json_value(saved, {})
            metadata['lmsHiddenFromLearners'] = saved_metadata.get('lmsHiddenFromLearners') is True
            if 'lmsTranscriptTimeline' in saved_metadata:
                metadata['lmsTranscriptTimeline'] = saved_metadata['lmsTranscriptTimeline']
            if 'lmsBunnyRecording' in saved_metadata:
                metadata['lmsBunnyRecording'] = saved_metadata['lmsBunnyRecording']
            cursor.execute(
                f'UPDATE {authoring_table_name(LIVE_SESSION_ARTIFACTS_TABLE)} SET graph_artifact_id=%s, content_url=%s, '
                'content_correlation_id=%s, metadata=%s, updated_at=%s WHERE id=%s',
                [graph_id, payload['content_url'], payload['content_correlation_id'], json_db_value(metadata),
                 datetime.utcnow(), row_id],
            )
            return True
        if existing:
            saved_metadata = parse_json_value(existing[0], {})
            metadata['lmsHiddenFromLearners'] = saved_metadata.get('lmsHiddenFromLearners') is True
            if 'lmsTranscriptTimeline' in saved_metadata:
                metadata['lmsTranscriptTimeline'] = saved_metadata['lmsTranscriptTimeline']
            if 'lmsBunnyRecording' in saved_metadata:
                metadata['lmsBunnyRecording'] = saved_metadata['lmsBunnyRecording']
        payload['metadata'] = json_db_value(metadata)
        authoring_upsert(LIVE_SESSION_ARTIFACTS_TABLE, ['occurrence_id', 'artifact_type', 'graph_artifact_id'], payload)
    return True


def _same_artifact_under_new_graph_id(
    cursor, lock, payload, *, LIVE_SESSION_ARTIFACTS_TABLE, authoring_table_name, clean_str,
):
    """(row id, metadata) of this occurrence's artifact for the same call and recording window.

    Graph has returned one recording under a second id on a later sync, and two
    ids for one recording in the same listing; matching only on
    graph_artifact_id then saved and archived it twice. Microsoft's content
    correlation id names the recording itself (one per recording, shared by no
    other in production), so it matches even when the timing is reported with a
    different precision -- but never across calls, which keeps two recordings of
    one session apart.
    """
    table = authoring_table_name(LIVE_SESSION_ARTIFACTS_TABLE)
    correlation = clean_str(payload.get('content_correlation_id'))
    if correlation:
        cursor.execute(
            f'SELECT id, metadata FROM {table} WHERE occurrence_id=%s AND artifact_type=%s '
            "AND content_correlation_id=%s AND (call_id=%s OR call_id='' OR call_id IS NULL OR %s='') "
            'ORDER BY created_at LIMIT 1' + lock,
            [payload['occurrence_id'], payload['artifact_type'], correlation, payload['call_id'], payload['call_id']],
        )
        row = cursor.fetchone()
        if row:
            return row
    if not payload['call_id'] or not payload['created_datetime']:
        return None
    cursor.execute(
        f'SELECT id, metadata FROM {table} '
        'WHERE occurrence_id=%s AND artifact_type=%s AND call_id=%s AND created_datetime=%s '
        'AND end_datetime IS NOT DISTINCT FROM %s ORDER BY created_at LIMIT 1' + lock,
        [payload['occurrence_id'], payload['artifact_type'], payload['call_id'],
         payload['created_datetime'], payload['end_datetime']],
    )
    return cursor.fetchone()


def remove_artifact_from_wrong_occurrences(
    occurrences, target_occurrence, artifact_type, artifact, *, LIVE_SESSION_ARTIFACTS_TABLE, authoring_delete,
    authoring_fetch_all, clean_str,
):
    """Remove an earlier date-heuristic copy when launch tracking remaps an artifact."""
    graph_id = clean_str(artifact.get('id'))
    target_id = clean_str(target_occurrence.get('id'))
    occurrence_ids = {clean_str(row.get('id')) for row in occurrences}
    if not graph_id or not target_id:
        return
    matches = authoring_fetch_all(
        LIVE_SESSION_ARTIFACTS_TABLE,
        'artifact_type = %s and graph_artifact_id = %s',
        [artifact_type, graph_id],
    )
    for row in matches:
        occurrence_id = clean_str(row.get('occurrence_id'))
        if occurrence_id in occurrence_ids and occurrence_id != target_id:
            authoring_delete(LIVE_SESSION_ARTIFACTS_TABLE, 'id = %s', [row['id']])


def stored_leftover_slots(
    live_session_id, *, connection, logger, parse_json_value,
):
    """Teams slots outside the module plan, as the last calendar status check found them.

    Read from the status sweep's own snapshot, never from Microsoft here. Empty
    when status sync is not provisioned or has not run: a missing reading is
    not evidence of anything.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('curriculum.teams_calendar_sync_state')")
            if not cursor.fetchone()[0]:
                return []
            cursor.execute('SELECT snapshot FROM curriculum.teams_calendar_sync_state WHERE live_session_id = %s',
                           [live_session_id])
            row = cursor.fetchone()
    except Exception:
        logger.exception('Teams leftover slots could not be read.')
        return []
    snapshot = parse_json_value(row[0], {}) if row else {}
    leftovers = (snapshot or {}).get('leftovers') if isinstance(snapshot, dict) else None
    return leftovers if isinstance(leftovers, list) else []
