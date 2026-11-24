"""Meeting workflow over explicit read/write/provider capabilities; no framework or provider imports.

Existing behavior is preserved; legacy capabilities are composed at the outer facade.
"""


def apply_teams_occurrence_shifts(
    owner_key,
    event_key,
    title,
    target_occurrences,
    invited_people,
    meeting_options=None,
    existing_occurrences=None,
    missing=None,
    *,
    GRAPH_SILENT_INVITE_HEADERS,
    clean_str,
    datetime,
    graph_event_utc,
    logger,
    microsoft_graph_request,
    parse_graph_datetime,
    teams_calendar_minute_key,
    teams_expanded_instances,
    teams_standalone_occurrence_meeting,
    timedelta,
    tracked_occurrence_keys,
    urllib_parse,
    vacated_occurrence_keys,
    read_calendar_instances,
):
    """Move the plain weekly Graph occurrences onto the wizard's shifted dates.

    Graph recurrences can only be unbroken weekly patterns, so a holiday-shifted plan
    has to be reconciled instance by instance once the series exists. Creating a
    series needs this exactly as much as rescheduling one does: the wizard sends the
    shifted dates on both calls, and skipping the reconciliation leaves Teams showing
    sessions on the very holidays the wizard moved them off.

    Returns `(warnings, recreated, stale)`. ``recreated`` holds only standalone
    replacements that ALREADY exist (moved and re-configured on their own
    events). A planned session whose occurrence Microsoft no longer lists in the
    series is never re-created here: a new event is a new join link, and quietly
    creating one is how learners ended up split across two rooms. It is appended
    to ``missing`` (when the caller passes a list) and reported as "Missing from
    Teams -- resolution required"; only the explicit, confirmed Calendar health
    resolution may create a replacement.
    """

    warnings = []
    recreated_details = []
    stale_deletions = []
    protected_instances = set()
    moved_instances = set()
    if not target_occurrences:
        return warnings, recreated_details, stale_deletions

    instance_start = (min(item['start'] for item in target_occurrences) - timedelta(days=7)).isoformat()
    instance_end = (max(item['end'] for item in target_occurrences) + timedelta(days=7)).isoformat()
    # Graph pages /instances at 10 by default. Without an explicit $top the later
    # sessions of a long series are simply invisible here, so their holiday shifts
    # were never applied and the pairing below mistook present-but-unlisted slots
    # for missing ones. Read every page before reconciling a longer study series.
    instance_query = urllib_parse.urlencode({
        'startDateTime': instance_start,
        'endDateTime': instance_end,
        '$top': 200,
    })
    try:
        instances = teams_expanded_instances(owner_key, event_key, instance_query, len(target_occurrences))
        # Claim instances that already sit on a wanted date before assigning the
        # rest. Pairing purely by position would move an instance that is already
        # correct onto another wanted date and duplicate it, because a shifted
        # series spans more weekly slots than there are sessions.
        sorted_targets = sorted(target_occurrences, key=lambda item: item['session_number'])
        series_event_id = urllib_parse.unquote(event_key)
        active_statuses = {'cancelled', 'canceled', 'declined', 'deleted', 'removed', 'superseded'}
        standalone_rows = [
            row for row in (existing_occurrences or [])
            if clean_str(row.get('graph_event_id'))
            and clean_str(row.get('graph_event_id')) != series_event_id
            and clean_str(row.get('status')).lower() not in active_statuses
        ]
        standalone_assignments = {}
        used_standalone_ids = set()
        for target in sorted_targets:
            target_key = teams_calendar_minute_key(target['start'])
            match = next(
                (
                    row for row in standalone_rows
                    if clean_str(row.get('id')) not in used_standalone_ids
                    and teams_calendar_minute_key(row.get('scheduled_start')) == target_key
                ),
                None,
            )
            if match is None:
                match = next(
                    (
                        row for row in standalone_rows
                        if clean_str(row.get('id')) not in used_standalone_ids
                        and int(row.get('session_number') or 0) == int(target['session_number'])
                    ),
                    None,
                )
            if match is not None:
                standalone_assignments[target['session_number']] = match
                used_standalone_ids.add(clean_str(match.get('id')))

        # Existing standalone replacements remain first-class occurrences on
        # later schedule or people saves. Move and reconfigure their own events
        # instead of trying to pull them back into a recurrence that cannot own
        # them again.
        for target in sorted_targets:
            row = standalone_assignments.get(target['session_number'])
            if not row:
                continue
            standalone_id = clean_str(row.get('graph_event_id'))
            standalone_path = f'users/{owner_key}/events/{urllib_parse.quote(standalone_id, safe="")}'
            try:
                standalone_event = microsoft_graph_request('GET', standalone_path)
                if standalone_event.get('isCancelled'):
                    raise RuntimeError('The standalone Teams occurrence is cancelled.')
                current_start = teams_calendar_minute_key((standalone_event.get('start') or {}).get('dateTime'))
                current_end = teams_calendar_minute_key((standalone_event.get('end') or {}).get('dateTime'))
                if current_start != teams_calendar_minute_key(target['start']) or current_end != teams_calendar_minute_key(target['end']):
                    standalone_event = microsoft_graph_request(
                        'PATCH', standalone_path,
                        payload={
                            'start': {'dateTime': target['start'].replace(second=0, microsecond=0).isoformat(timespec='seconds'), 'timeZone': 'UTC'},
                            'end': {'dateTime': target['end'].replace(second=0, microsecond=0).isoformat(timespec='seconds'), 'timeZone': 'UTC'},
                            'hideAttendees': True,
                        },
                        extra_headers=GRAPH_SILENT_INVITE_HEADERS,
                    ) or standalone_event
                standalone = teams_standalone_occurrence_meeting(
                    owner_key, standalone_event, target, invited_people, meeting_options,
                )
                warnings.extend(standalone.pop('warnings'))
                recreated_details.append(standalone)
            except RuntimeError as exc:
                warnings.append({
                    'code': 'teams_standalone_occurrence_not_updated',
                    'message': 'Microsoft Teams could not verify the separately restored session.',
                    'detail': str(exc),
                })

        series_targets = [
            target for target in sorted_targets
            if target['session_number'] not in standalone_assignments
        ]
        series_target_keys = {
            teams_calendar_minute_key(target['start'])
            for target in series_targets
        }
        remaining_instances = list(instances)
        paired_instances = []
        unmatched_targets = []
        for target in series_targets:
            target_key = teams_calendar_minute_key(target['start'])
            match = next(
                (
                    candidate for candidate in remaining_instances
                    if teams_calendar_minute_key((candidate.get('start') or {}).get('dateTime')) == target_key
                ),
                None,
            )
            if match is None:
                unmatched_targets.append(target)
                continue
            remaining_instances.remove(match)
            paired_instances.append((match, target))
        # A target already on the right day but at a different clock time -- a DST
        # boundary moves the UTC instant by an hour -- belongs to that day's
        # instance. Only genuinely date-shifted sessions fall through to position,
        # where a wrong guess drags an occurrence across its neighbour.
        positional_targets = []
        for target in unmatched_targets:
            target_day = target['start'].date()
            match = next(
                (
                    candidate for candidate in remaining_instances
                    if (parse_graph_datetime((candidate.get('start') or {}).get('dateTime')) or datetime.min).date() == target_day
                ),
                None,
            )
            if match is None:
                positional_targets.append(target)
                continue
            remaining_instances.remove(match)
            paired_instances.append((match, target))
        for target in positional_targets:
            if not remaining_instances:
                break
            paired_instances.append((remaining_instances.pop(0), target))
        for instance, target in reversed(paired_instances):
            instance_id = clean_str(instance.get('id'))
            if not instance_id:
                continue
            current_key = teams_calendar_minute_key((instance.get('start') or {}).get('dateTime'))
            target_key = teams_calendar_minute_key(target['start'])
            current_end = teams_calendar_minute_key((instance.get('end') or {}).get('dateTime'))
            if current_key and current_key == target_key and current_end == teams_calendar_minute_key(target['end']):
                continue
            instance_key = urllib_parse.quote(instance_id, safe='')
            try:
                microsoft_graph_request('PATCH', f'users/{owner_key}/events/{instance_key}', payload={
                    'start': {'dateTime': target['start'].replace(second=0, microsecond=0).isoformat(timespec='seconds'), 'timeZone': 'UTC'},
                    'end': {'dateTime': target['end'].replace(second=0, microsecond=0).isoformat(timespec='seconds'), 'timeZone': 'UTC'},
                }, extra_headers=GRAPH_SILENT_INVITE_HEADERS)
                moved_instances.add(instance_id)
            except RuntimeError as exc:
                protected_instances.add(instance_id)
                warnings.append({
                    'code': 'teams_shifted_occurrence_not_moved',
                    'message': 'Microsoft Teams could not move this occurrence, so it was left in the recurring series to preserve the module\'s fixed join URL.',
                    'detail': str(exc),
                })
        if (
            not remaining_instances
            and not moved_instances
            and len(paired_instances) == len(series_targets)
        ):
            # Every occurrence Microsoft listed was already on a wanted date and
            # none had to move, so nothing can be left over to delete. Re-reading
            # the series here only spends another round trip on a calendar that
            # already matches the plan.
            return warnings, recreated_details, stale_deletions
        instances = [graph_event_utc(item) for item in read_calendar_instances(
            microsoft_graph_request, f'users/{owner_key}/events/{event_key}/instances?{instance_query}')]
        # Session-aware, not date-set-aware. The old rule here deleted every
        # instance whose start was absent from `series_target_keys`, which turned
        # an omission into a cancellation: a week moved to its own additional
        # meeting left the target list, its live occurrence was read as surplus,
        # and Exchange emailed the whole cohort "Canceled: <module>". Nothing is
        # retired now unless the LMS's own occurrence rows prove this very
        # session has just moved off that date.
        stale = vacated_occurrence_keys(series_targets, existing_occurrences)
        tracked = tracked_occurrence_keys(existing_occurrences)
        for instance in instances:
            instance_id = clean_str(instance.get('id'))
            if not instance_id:
                continue
            current_key = teams_calendar_minute_key((instance.get('start') or {}).get('dateTime'))
            # An occurrence this run has just moved is never surplus. Microsoft
            # can still answer with its previous start for a moment, and deleting
            # it on that reading destroys the session the move had just placed.
            if instance_id in moved_instances or instance_id in protected_instances:
                continue
            if not current_key or current_key in series_target_keys:
                continue
            identity = stale.get(current_key)
            if identity is None and current_key in tracked:
                # A session this calendar owns, absent from the send list. That
                # is routing, not intent: the week now belongs to its own
                # additional meeting, and nothing about its absence asks for a
                # cancellation. Leave Microsoft alone.
                continue
            stale_deletions.append({
                **(identity or {
                    'session_number': '',
                    'previous_start': current_key,
                    'new_start': '',
                    # Graph's own weekly filler: a slot the recurrence generated
                    # that has never been an LMS session. Clearing it is what
                    # lets a shifted plan verify.
                    'reason': 'recurrence_filler_never_an_lms_session',
                }),
                'instance_id': instance_id,
            })
        master_keys = {
            teams_calendar_minute_key((instance.get('start') or {}).get('dateTime'))
            for instance in instances
        }
        standalone_numbers = {
            int(detail.get('session_number') or 0)
            for detail in recreated_details
            if clean_str(detail.get('graph_event_id'))
        }
        for target in series_targets:
            target_key = teams_calendar_minute_key(target['start'])
            if target_key in master_keys or int(target['session_number']) in standalone_numbers:
                continue
            # Reported, never re-created. See the docstring: a save must not
            # mint a second join link for a session learners already hold one for.
            if missing is not None:
                missing.append({
                    'sessionNumber': int(target['session_number']),
                    'startDateTimeUtc': target['start'].isoformat(),
                    'endDateTimeUtc': target['end'].isoformat(),
                    'reason': 'not_in_recurring_series',
                })
    except RuntimeError as exc:
        logger.warning('Unable to reconcile individual Teams event instances: %s', exc)
        warnings.append({
            'code': 'teams_individual_occurrences_not_updated',
            'message': 'Microsoft Teams updated the meeting series, but could not update shifted individual sessions.',
            'detail': str(exc),
        })
    return warnings, recreated_details, stale_deletions
