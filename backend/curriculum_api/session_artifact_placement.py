"""Conservative placement for newly discovered Teams recordings."""

from datetime import datetime, timedelta, timezone


MAX_UNLINKED_START_OFFSET = timedelta(hours=12)


def _instant(value):
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value or '').replace('Z', '+00:00'))
        except ValueError:
            return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def recording_matches_occurrence(recording, occurrence, *, linked_by_launch=False):
    """Keep rehearsals and unrelated meeting runs out of learner components.

    A recorded run that finished before the planned lecture is not delivery,
    even if someone opened that week's Join link early. For older runs without
    an LMS launch, require the recording to start near the planned time.
    Existing saved rows are left alone and can be reviewed separately.
    """
    scheduled = _instant((occurrence or {}).get('scheduled_start'))
    started = _instant((recording or {}).get('createdDateTime'))
    finished = _instant((recording or {}).get('endDateTime'))
    if not scheduled or not (started or finished):
        return False
    if finished and finished <= scheduled and (not started or started < scheduled):
        return False
    if linked_by_launch:
        return True
    return abs((started or finished) - scheduled) <= MAX_UNLINKED_START_OFFSET


def overlapping_artifact_occurrence(artifact, occurrences):
    """Recover only a unique planned slot when a Join click names a future week.

    The caller supplies occurrences from the same Graph meeting. A click on a
    different week's shared Join URL cannot override an actual lecture window.
    Rehearsals, missing timestamps and overlapping/ambiguous slots stay unfiled.
    """
    started = _instant((artifact or {}).get('createdDateTime'))
    finished = _instant((artifact or {}).get('endDateTime'))
    if not started or not finished or finished <= started:
        return None
    candidates = []
    for occurrence in occurrences:
        if occurrence.get('status') in ('cancelled', 'deleted', 'superseded'):
            continue
        start = _instant(occurrence.get('scheduled_start'))
        end = _instant(occurrence.get('scheduled_end'))
        if (start and end and start < end and started < end and finished > start
                and recording_matches_occurrence(artifact, occurrence)):
            candidates.append(occurrence)
    return candidates[0] if len(candidates) == 1 else None
