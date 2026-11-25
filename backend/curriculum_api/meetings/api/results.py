"""HTTP response and workflow boundary; URL/authentication decorators remain at the public facade.

Existing behavior is preserved; legacy capabilities are composed at the outer facade.
"""


def curriculum_teams_meeting_artifacts(
    request,
    live_session_id,
    *,
    JsonResponse,
    LIVE_SESSIONS_TABLE,
    LIVE_SESSION_ARTIFACTS_TABLE,
    LIVE_SESSION_ATTENDANCE_TABLE,
    LIVE_SESSION_JOIN_LAUNCHES_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE,
    apply_teams_meeting_options,
    attendance_display_name,
    attendance_identity,
    attendance_interval_seconds,
    attendance_report_rosters,
    authoring_delete,
    authoring_fetch_all,
    authoring_upsert,
    clean_str,
    collection,
    completion_to_reopen,
    datetime,
    defaultdict,
    get_graph_settings,
    graph_item_with_occurrence_link,
    graph_timezone_iana,
    has_graph_credentials,
    json_db_value,
    json_error,
    keep_directory_lookup,
    launch_linked_live_occurrence,
    live_session_join_launches,
    live_session_meeting_groups,
    logger,
    merge_attendance_intervals,
    microsoft_graph_request,
    note_completion,
    note_premature_run,
    note_reopened_by_sync,
    off_schedule_runs,
    parse_graph_datetime,
    parse_int,
    parse_json_value,
    queue_sync,
    read_events,
    recording_matches_occurrence,
    remember_teams_dial_in,
    remove_artifact_from_wrong_occurrences,
    resolve_directory_accounts,
    run_not_delivery,
    run_replaces_stored,
    schema_gate,
    stamp_live_session_instants,
    stored_leftover_slots,
    stored_run_is_delivery,
    sync_verified_teams_attendance_reporting,
    teams_online_meeting_from_join_url,
    teams_schedule_settings,
    teams_series_email_list,
    transaction,
    update_authoring_rows,
    upsert_live_session_artifact,
    urllib_parse,
    uuid,
    teams_module_session_limit,
):
    """Read the tracked lecture plan or pull completed artifacts from Graph."""

    if request.method == 'POST' and not getattr(request, 'session_result_worker', False):
        return queue_sync(request, live_session_id)
    # Schema is provisioned by the operator, never repaired by a read or worker.
    schema_gate.require_tables(LIVE_SESSIONS_TABLE, LIVE_SESSION_OCCURRENCES_TABLE,
        LIVE_SESSION_ATTENDANCE_TABLE, LIVE_SESSION_ARTIFACTS_TABLE, LIVE_SESSION_JOIN_LAUNCHES_TABLE)
    series_rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
    if not series_rows:
        return json_error('Live session series not found.', status=404)
    series = series_rows[0]
    occurrences = authoring_fetch_all(
        LIVE_SESSION_OCCURRENCES_TABLE,
        'live_session_id = %s',
        [live_session_id],
        'session_number asc',
    )
    if request.method == 'GET':
        review_limit = teams_module_session_limit(series.get('module_catalogue_id'))
        logged = read_events([live_session_id])
        # One read per table for the whole series, not two per session: a
        # 14-session series was 28 round trips to the remote database.
        occurrence_ids = [occurrence['id'] for occurrence in occurrences]
        attendance_by_occurrence, artifacts_by_occurrence = {}, {}
        if occurrence_ids:
            placeholders = ', '.join(['%s'] * len(occurrence_ids))
            for row in authoring_fetch_all(
                LIVE_SESSION_ATTENDANCE_TABLE, f'occurrence_id in ({placeholders})', occurrence_ids, 'display_name asc'
            ):
                attendance_by_occurrence.setdefault(row['occurrence_id'], []).append(row)
            for row in authoring_fetch_all(
                LIVE_SESSION_ARTIFACTS_TABLE, f'occurrence_id in ({placeholders})', occurrence_ids, 'artifact_type asc'
            ):
                artifacts_by_occurrence.setdefault(row['occurrence_id'], []).append(row)
        for occurrence in occurrences:
            # Calls on this link that were not this session, said with their dates.
            occurrence['off_schedule_runs'] = off_schedule_runs(occurrence, logged)
            actual_attendance = attendance_by_occurrence.get(occurrence['id'], [])
            for attendance in actual_attendance:
                attendance['intervals'] = parse_json_value(attendance.get('intervals'), [])
                attendance['raw_data'] = parse_json_value(attendance.get('raw_data'), {})
                if not clean_str(attendance.get('display_name')):
                    attendance['display_name'] = attendance_display_name({
                        **attendance['raw_data'],
                        'emailAddress': attendance.get('email') or attendance['raw_data'].get('emailAddress'),
                    })
            occurrence['attendance'] = attendance_report_rosters(
                series,
                actual_attendance,
                include_absent=bool(
                    occurrence.get('attendance_report_id') and occurrence.get('actual_end')
                ),
            )
            occurrence['artifacts'] = artifacts_by_occurrence.get(occurrence['id'], [])
            for artifact in occurrence['artifacts']:
                artifact['metadata'] = parse_json_value(artifact.get('metadata'), {})
                # The transcript cues (up to ~200 KB each) have their own
                # endpoint; this list only needs to know the artifact exists.
                artifact['metadata'].pop('lmsTranscriptTimeline', None)
        return JsonResponse({
            'series': {**stamp_live_session_instants(series), 'timeZoneIana': graph_timezone_iana(teams_schedule_settings({}, series=series)),
                       **({'reviewSessionLimit': review_limit} if review_limit > 52 else {})},
            'occurrences': [stamp_live_session_instants(occurrence) for occurrence in occurrences],
            'leftoverSlots': stored_leftover_slots(live_session_id),
        })
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    if not has_graph_credentials():
        return json_error('Microsoft Graph credentials are not configured.', status=503)
    organizer = clean_str(series.get('organizer_email'))
    meeting_id = clean_str(series.get('online_meeting_id'))
    join_url = clean_str(series.get('join_url'))
    if organizer and not meeting_id and join_url:
        try:
            graph_meeting = teams_online_meeting_from_join_url(organizer, join_url)
        except RuntimeError as exc:
            logger.warning('Unable to backfill onlineMeeting ID for %s: %s', live_session_id, exc)
            return json_error(
                'The Teams meeting exists, but Microsoft Graph cannot resolve it for tracking. '
                'Retry after Microsoft finishes publishing the meeting. If it continues, check the organizer access policy.',
                status=409,
                detail=str(exc),
            )
        meeting_id = clean_str(graph_meeting.get('id'))
        if meeting_id:
            update_authoring_rows(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id], {
                'online_meeting_id': meeting_id,
                'meeting_options_url': clean_str(graph_meeting.get('meetingOptionsWebUrl')) or series.get('meeting_options_url'),
                'updated_at': datetime.utcnow(),
            })
            # A series that only just became resolvable is a series whose options
            # were never applied: the lookup that failed at creation is the same
            # one that gates the patch, so its recording, transcription, lobby and
            # presenter roles are still sitting at the tenant defaults. This is
            # the first moment the LMS can put them right, so it does -- otherwise
            # granting the access policy fixes the tracking and silently leaves
            # every meeting still recording nothing.
            reapplied, _meeting, reapply_warnings = apply_teams_meeting_options(
                organizer,
                join_url,
                recording=clean_str(series.get('recording')).lower() or 'none',
                lobby_bypass=clean_str(series.get('lobby_bypass')).lower() or 'invited',
                spoken_language=clean_str(series.get('spoken_language')) or 'en-GB',
                attendees=teams_series_email_list(series.get('attendees')),
                presenters=teams_series_email_list(series.get('presenters')),
                co_organizers=teams_series_email_list(series.get('co_organizers')),
                online_meeting_id=meeting_id,
            )
            if not reapplied:
                logger.warning(
                    'Resolved the onlineMeeting for %s but could not re-apply its options: %s',
                    live_session_id,
                    '; '.join(clean_str(item.get('detail')) for item in reapply_warnings),
                )
    if not organizer or not meeting_id:
        return json_error(
            'The Teams meeting exists, but its online meeting ID is not available yet. '
            'Grant OnlineMeetings.Read.All and an application access policy to the organizer, then retry.',
            status=409,
        )
    # The lookup above may have just resolved the meeting behind the series. Keep
    # the loaded row in step with it, or the grouping below reads the blank value
    # the row was loaded with and asks Graph for nothing at all.
    series['online_meeting_id'] = meeting_id
    # The meeting ID and passcode shown under the join link, once per link.
    remember_teams_dial_in(series)
    errors = []
    if any(clean_str(row.get('join_url')) not in ('', join_url) and not clean_str(row.get('online_meeting_id')) for row in occurrences):
        errors.append('A weekday series has no online meeting ID yet. Update the calendar to retry its Teams configuration.')
    synced = {'attendanceReports': 0, 'attendanceRecords': 0, 'transcripts': 0, 'recordings': 0}
    now = datetime.utcnow()

    # Graph answers for the meeting that ran, and a session the wizard had to move
    # can be an event of its own with an online meeting of its own (see
    # apply_teams_occurrence_shifts). Asking the series for that session's
    # attendance, transcript or recording returns nothing at all.
    for base, group in live_session_meeting_groups(series, occurrences):
        # The delivery run each session was given by this sync. Kept apart from
        # the loaded rows so report bindings below still read what was stored.
        delivered = {}
        launches = live_session_join_launches(group)
        try:
            response = {'value': collection(microsoft_graph_request, f'{base}/attendanceReports', get_graph_settings()['base_url'])}
            stored_records = {row['id']: authoring_fetch_all(LIVE_SESSION_ATTENDANCE_TABLE, 'occurrence_id = %s', [row['id']]) for row in group}
            synced_ids_by_occurrence = defaultdict(set)
            returned_report_ids = set()
            assigned_reports_by_occurrence = defaultdict(set)
            for report in response.get('value') or []:
                report_id = clean_str(report.get('id'))
                report_start = parse_graph_datetime(report.get('meetingStartDateTime'))
                occurrence, launch = launch_linked_live_occurrence(group, report_start, launches, report_id)
                if not occurrence or not report_id:
                    continue
                assigned_reports_by_occurrence[occurrence['id']].add(report_id)
                if launch and clean_str(launch.get('attendance_report_id')) != report_id:
                    update_authoring_rows(
                        LIVE_SESSION_JOIN_LAUNCHES_TABLE,
                        'id = %s',
                        [launch['id']],
                        {'attendance_report_id': report_id},
                    )
                    launch['attendance_report_id'] = report_id
                stored_end = parse_graph_datetime(occurrence.get('actual_end'))
                matching = [row for row in stored_records[occurrence['id']]
                    if report_id in (parse_json_value(row.get('raw_data'), {}).get('sourceAttendanceReportIds') or [])]
                expected_count = parse_int(report.get('totalParticipantCount'), -1)
                if (not getattr(request, 'session_result_force', False) and stored_end
                        and (now - stored_end.replace(tzinfo=None)).total_seconds() > 48 * 3600
                        and clean_str(occurrence.get('attendance_report_id')) == report_id
                        and expected_count >= 0 and len(matching) >= expected_count
                        # A saved test open is judged again, never trusted for being old.
                        and stored_run_is_delivery(occurrence)):
                    continue
                report_key = urllib_parse.quote(report_id, safe='')
                detail = microsoft_graph_request('GET', f'{base}/attendanceReports/{report_key}?$expand=attendanceRecords')
                records = collection(microsoft_graph_request, f'{base}/attendanceReports/{report_key}?$expand=attendanceRecords',
                    get_graph_settings()['base_url'], first=detail, key='attendanceRecords') if 'attendanceRecords' in detail else collection(
                    microsoft_graph_request, f'{base}/attendanceReports/{report_key}/attendanceRecords', get_graph_settings()['base_url'])
                if not parse_graph_datetime(detail.get('meetingEndDateTime')):
                    continue  # an ongoing report cannot establish absence
                run_start = parse_graph_datetime(detail.get('meetingStartDateTime'))
                run_end = parse_graph_datetime(detail.get('meetingEndDateTime'))
                participants = int(detail.get('totalParticipantCount') or len(records))
                current = {**occurrence, **delivered.get(occurrence['id'], {})}
                not_delivery = run_not_delivery(current, run_start, run_end, participants)
                if not_delivery:
                    # Somebody opened the meeting for something other than this
                    # session -- a fresh link being tried before it, another day's
                    # use after it, one person checking the room. That is not
                    # delivery: it neither completes the session nor gives it
                    # attendance. What an earlier sync already stored is left as it is.
                    note_premature_run(series, occurrence, report_id, run_start, run_end,
                                       job_id=clean_str(getattr(request, 'session_result_job_id', '')),
                                       reason=not_delivery)
                    continue
                with transaction.atomic():
                    returned_report_ids.add(report_id)
                    if run_replaces_stored(current, report_id, run_start, run_end, participants):
                        delivery = {
                            'attendance_report_id': report_id,
                            'participant_count': participants,
                            'actual_start': run_start,
                            'actual_end': run_end,
                            'status': 'completed',
                        }
                        update_authoring_rows(LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', [occurrence['id']], {
                            **delivery, 'artifacts_synced_at': now, 'last_sync_error': '',
                        })
                        if clean_str(current.get('status')).lower() != 'completed':
                            note_completion(series, occurrence, report_id, run_start, run_end,
                                            job_id=clean_str(getattr(request, 'session_result_job_id', '')))
                        delivered[occurrence['id']] = delivery
                    else:
                        # A smaller run of a session already delivered (a reconnect,
                        # a second room): its attendance is kept below, but the run
                        # that delivered the session stays its saved run.
                        update_authoring_rows(LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', [occurrence['id']], {
                            'artifacts_synced_at': now, 'last_sync_error': '',
                        })
                    for record in records:
                        display_name, identity_id = attendance_identity(record)
                        display_name = display_name or attendance_display_name(record)
                        graph_record_id = clean_str(record.get('id') or identity_id or record.get('emailAddress'))
                        stable_key = graph_record_id or uuid.uuid4().hex
                        attendance_id = f'ATT-{uuid.uuid5(uuid.NAMESPACE_URL, occurrence["id"] + report_id + stable_key).hex.upper()}'
                        synced_ids_by_occurrence[occurrence['id']].add(attendance_id)
                        existing_rows = authoring_fetch_all(
                            LIVE_SESSION_ATTENDANCE_TABLE, 'id = %s', [attendance_id]
                        )
                        existing = existing_rows[0] if existing_rows else {}
                        existing_intervals = parse_json_value(existing.get('intervals'), [])
                        merged_intervals = merge_attendance_intervals(
                            existing_intervals,
                            record.get('attendanceIntervals') or [],
                        )
                        existing_raw = parse_json_value(existing.get('raw_data'), {})
                        report_ids = list(dict.fromkeys([
                            *(
                                existing_raw.get('sourceAttendanceReportIds')
                                if isinstance(existing_raw.get('sourceAttendanceReportIds'), list)
                                else []
                            ),
                            report_id,
                        ]))
                        merged_raw = {
                            **record,
                            'attendanceIntervals': merged_intervals,
                            'sourceAttendanceReportIds': report_ids,
                            'attendanceReportId': report_id,
                            'attendanceReportStart': clean_str(detail.get('meetingStartDateTime') or report.get('meetingStartDateTime')),
                            'attendanceReportEnd': clean_str(detail.get('meetingEndDateTime') or report.get('meetingEndDateTime')),
                        }
                        merged_raw = graph_item_with_occurrence_link(merged_raw, occurrence, launch)
                        # Keep an earlier directory lookup of the same account (read-only identity check).
                        merged_raw = keep_directory_lookup(existing_raw, merged_raw)
                        authoring_upsert(LIVE_SESSION_ATTENDANCE_TABLE, ['id'], {
                            'id': attendance_id,
                            'occurrence_id': occurrence['id'],
                            'graph_record_id': graph_record_id,
                            'email': clean_str(record.get('emailAddress')).lower(),
                            'display_name': display_name,
                            'role': clean_str(record.get('role')),
                            'total_attendance_seconds': attendance_interval_seconds(merged_intervals) if merged_intervals else max(
                                parse_int(existing.get('total_attendance_seconds'), 0), parse_int(record.get('totalAttendanceInSeconds'), 0)),
                            'intervals': json_db_value(merged_intervals),
                            'raw_data': json_db_value(merged_raw),
                        })
                        synced['attendanceRecords'] += 1
                    synced['attendanceReports'] += 1

            # Replace legacy attendee-only rows after every report has been
            # persisted. Those rows merged the same Graph attendee id across
            # different meeting runs and would otherwise duplicate the new,
            # correctly report-scoped rows in the response.
            for occurrence in group:
                keep_ids = synced_ids_by_occurrence.get(occurrence['id'], set())
                existing_rows = authoring_fetch_all(
                    LIVE_SESSION_ATTENDANCE_TABLE, 'occurrence_id = %s', [occurrence['id']]
                )
                for existing in existing_rows:
                    existing_id = clean_str(existing.get('id'))
                    if existing_id in keep_ids:
                        continue
                    existing_raw = parse_json_value(existing.get('raw_data'), {})
                    source_ids = existing_raw.get('sourceAttendanceReportIds')
                    source_ids = set(source_ids) if isinstance(source_ids, list) else set()
                    if source_ids & returned_report_ids:
                        authoring_delete(LIVE_SESSION_ATTENDANCE_TABLE, 'id = %s', [existing_id])
                if occurrence['id'] in delivered:
                    # This sync saved the session's delivery run just now; a stored
                    # report that has since moved elsewhere must not clear it.
                    continue
                stored_report_id = clean_str(occurrence.get('attendance_report_id'))
                if stored_report_id in returned_report_ids and stored_report_id not in assigned_reports_by_occurrence.get(occurrence['id'], set()):
                    update_authoring_rows(LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', [occurrence['id']], {
                        'attendance_report_id': '',
                        'participant_count': 0,
                        'actual_start': None,
                        'actual_end': None,
                        'status': 'scheduled',
                    })
                elif completion_to_reopen(occurrence):
                    # Completed by a test open before it was due: the session has
                    # not happened yet. Its attendance rows and Teams meeting stay
                    # exactly as they are; the event keeps what the row held.
                    update_authoring_rows(LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', [occurrence['id']], {
                        'attendance_report_id': '',
                        'participant_count': 0,
                        'actual_start': None,
                        'actual_end': None,
                        'status': 'scheduled',
                    })
                    note_reopened_by_sync(series, occurrence,
                                          job_id=clean_str(getattr(request, 'session_result_job_id', '')))
        except RuntimeError as exc:
            errors.append(f'Attendance: {exc}')

        for artifact_type, endpoint in (('transcript', 'transcripts'), ('recording', 'recordings')):
            try:
                response = {'value': collection(microsoft_graph_request, f'{base}/{endpoint}', get_graph_settings()['base_url'])}
                for artifact in response.get('value') or []:
                    primary_time = 'createdDateTime' if artifact_type == 'recording' else 'endDateTime'
                    fallback_time = 'endDateTime' if artifact_type == 'recording' else 'createdDateTime'
                    timestamp = parse_graph_datetime(artifact.get(primary_time)) or parse_graph_datetime(artifact.get(fallback_time))
                    existing_artifacts = authoring_fetch_all(LIVE_SESSION_ARTIFACTS_TABLE,
                        'artifact_type = %s AND graph_artifact_id = %s', [artifact_type, clean_str(artifact.get('id'))])
                    existing_ids = {row['occurrence_id'] for row in existing_artifacts}
                    stored = next((row for row in group if row['id'] in existing_ids), None)
                    correlation = clean_str(artifact.get('contentCorrelationId'))
                    if not stored and correlation:
                        # The same recording saved before under another Graph id stays
                        # on the session it was filed under.
                        same = authoring_fetch_all(LIVE_SESSION_ARTIFACTS_TABLE,
                            'artifact_type = %s AND content_correlation_id = %s', [artifact_type, correlation])
                        same_ids = {row['occurrence_id'] for row in same}
                        stored = next((row for row in group if row['id'] in same_ids), None)
                    occurrence, launch = (stored, None) if stored else launch_linked_live_occurrence(group, timestamp, launches)
                    if (artifact_type == 'recording' and occurrence and not stored
                            and not recording_matches_occurrence(artifact, occurrence, linked_by_launch=bool(launch))):
                        continue
                    # Recordings are matched by their start; judge delivery by their actual end.
                    if occurrence and not stored and launch is None and run_not_delivery(
                            occurrence, parse_graph_datetime(artifact.get('createdDateTime')) or timestamp,
                            parse_graph_datetime(artifact.get('endDateTime')) or timestamp):
                        # Matched only as the nearest scheduled session, yet recorded
                        # outside it -- another day's use of the link (a week with no
                        # session, a session booked on its own meeting). Filing it
                        # under that week would be wrong; it waits for a person.
                        logger.info('Teams %s %s is outside every session of this meeting; not filed.',
                                    artifact_type, clean_str(artifact.get('id'))[-12:])
                        continue
                    linked_artifact = graph_item_with_occurrence_link(artifact, occurrence, launch) if occurrence else artifact
                    if occurrence:
                        remove_artifact_from_wrong_occurrences(group, occurrence, artifact_type, linked_artifact)
                    if occurrence and upsert_live_session_artifact(occurrence, artifact_type, linked_artifact):
                        synced[f'{artifact_type}s'] += 1
                        update_authoring_rows(
                            LIVE_SESSION_OCCURRENCES_TABLE,
                            'id = %s',
                            [occurrence['id']],
                            {'artifacts_synced_at': now, 'last_sync_error': ''},
                        )
            except RuntimeError as exc:
                errors.append(f'{artifact_type.title()}: {exc}')

    # Identity check only: look up the email behind signed-in college accounts
    # so staff can compare it with the LMS email. Reads the directory, writes
    # nothing to Microsoft and leaves attendance seconds and status untouched.
    try:
        lookup = resolve_directory_accounts(
            [row for occurrence in occurrences
             for row in authoring_fetch_all(LIVE_SESSION_ATTENDANCE_TABLE, 'occurrence_id = %s', [occurrence['id']])],
            graph_request=microsoft_graph_request,
            save_raw=lambda row, raw: update_authoring_rows(
                LIVE_SESSION_ATTENDANCE_TABLE, 'id = %s', [row['id']], {'raw_data': json_db_value(raw)}),
            home_tenant=get_graph_settings().get('tenant_id') or '',
        )
        synced['accountsLookedUp'] = lookup['resolved'] + lookup['notFound']
        if lookup['denied']:
            logger.warning('Teams account check: Microsoft refused the directory lookup (User.Read.All).')
    except Exception:
        logger.exception('Teams account check: directory lookup failed; attendance is unaffected.')

    try:

        synced['reportingRows'] = sync_verified_teams_attendance_reporting(
            module_refs=[clean_str(series.get('module_catalogue_id'))],
        )
    except Exception as exc:
        logger.exception('Unable to refresh the learner attendance reporting table.')
        errors.append(f'Attendance reporting: {exc}')

    return JsonResponse({'synced': synced, 'errors': errors, 'partial': bool(errors)}, status=207 if errors else 200)
