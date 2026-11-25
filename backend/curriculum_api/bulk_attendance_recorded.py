"""Project saved recording outcomes without changing attendance evidence."""
from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from django.db import DatabaseError, connections
from django.utils import timezone

from learner_api.recorded_attendance import apply_recorded_attendance
from .bulk_attendance_identity import profiles_by_aptem_ids
from .models import LiveSession, LiveSessionLearnerAttendance, LiveSessionOccurrence


@dataclass(frozen=True)
class RecordingIdentity:
    """Legacy watch key stored on learners, independent of its enrolment row."""
    id: int
    learner_type: str
    profile_id: int


def recorded_sources(learner_ids):
    """Resolve evidence identities and the profile-linked mode, for both kinds."""
    from learner_api.attendance_mode import TABLE, _ready

    profiles = profiles_by_aptem_ids(learner_ids, fields=('enrolment_id', 'learner_type'))
    if not profiles:
        return {}
    with connections['enrolment'].cursor() as cursor:
        if not _ready(cursor):
            return {}
        cursor.execute(f'''SELECT l.id FROM "Learner".learners l
            JOIN {TABLE} pref ON pref.learner_id=l.id
            WHERE pref.mode='lazy' AND l.id=ANY(%s)''',
                       [[profile.id for profile in profiles.values()]])
        recorded_ids = {row[0] for row in cursor.fetchall()}
    sources = {}
    for key, profile in profiles.items():
        if profile.id not in recorded_ids:
            continue
        if profile.enrolment_id is None or profile.learner_type not in {'commercial', 'apprenticeship'}:
            # A guessed kind/id could credit another person's watch history.
            raise DatabaseError('A recorded learner is missing its historical recording identity.')
        sources[key] = RecordingIdentity(profile.enrolment_id, profile.learner_type, profile.id)
    return sources


def register_context(records):
    keys = [int(record['recordKey'][5:]) for record in records
            if str(record.get('recordKey', '')).startswith('live:')
            and str(record['recordKey'][5:]).isdigit()]
    rows = list(LiveSessionLearnerAttendance.objects.filter(id__in=keys).values(
        'id', 'learner_profile_id', 'occurrence_id', 'live_session_id', 'module_catalogue_id')) if keys else []
    owners = dict(LiveSession.objects.filter(id__in={row['live_session_id'] for row in rows})
                  .values_list('id', 'module_catalogue_id')) if rows else {}
    return {f"live:{row['id']}": {**row, 'source_id': str(row['occurrence_id'])
            if owners.get(row['live_session_id']) == row['module_catalogue_id']
            else f"{row['occurrence_id']}:{row['module_catalogue_id']}"} for row in rows}


def manual_corrections(sources):
    from coach_api.models import CoachAttendanceSourceAdjustment

    profiles = {source.profile_id: source.id for source in sources.values()}
    return {(profiles[row['learner_profile_id']], row['source'], row['source_id'])
            for row in CoachAttendanceSourceAdjustment.objects.filter(learner_profile_id__in=profiles)
            .values('learner_profile_id', 'source', 'source_id', 'status', 'is_deleted')
            if row['status'] or row['is_deleted']}


def apply_recorded_outcomes(records):
    candidates = [record for record in records if record.get('attendance') != 'present'
                  and record.get('effectiveAttendance') != 'present'
                  and record.get('countsAsSession') is not False]
    if not candidates:
        return records
    sources = recorded_sources({record['learnerId'] for record in candidates})
    candidates = [record for record in candidates if record['learnerId'] in sources]
    if not candidates:
        return records
    contexts = register_context(candidates)
    occurrences = {row['id']: row for row in LiveSessionOccurrence.objects.filter(
        id__in={record['occurrenceId'] for record in candidates if record.get('occurrenceId')}
    ).values('id', 'scheduled_start', 'scheduled_end', 'status')}
    corrections = manual_corrections(sources)
    grouped = defaultdict(list)
    for record in candidates:
        source = sources[record['learnerId']]
        is_live = record.get('source') == 'live' or record['recordKey'].startswith('live:')
        origin = 'microsoft-teams' if is_live else 'kbc-attendance'
        context = contexts.get(record['recordKey'], {})
        source_id = context.get('source_id') if is_live else record['recordKey']
        if (source.id, origin, source_id) in corrections:
            continue
        occurrence = occurrences.get(record.get('occurrenceId'), {})
        start = occurrence.get('scheduled_start')
        day = str(record.get('sessionDate') or '')[:10]
        if not day and start:
            day = timezone.localtime(start).date().isoformat()
        try:
            session_date = date.fromisoformat(day)
        except ValueError:
            continue
        grouped[record['learnerId']].append({
            'source': origin, 'session_id': record.get('occurrenceId') or record['recordKey'],
            'session_date': session_date, 'attendance_status': record.get('attendance') or 'unmarked',
            'scheduled_start': start, 'scheduled_end': occurrence.get('scheduled_end'),
            'occurrence_status': occurrence.get('status'), '_record': record,
        })
    from .recording_views import shared_recording_reads
    projected = {}
    # One read of each session's recordings for the whole register, not one
    # per learner; each learner's watch progress is still their own read.
    with shared_recording_reads():
        for learner_id, rows in grouped.items():
            for row in apply_recorded_attendance(rows, sources[learner_id], mode='lazy'):
                basis = row.get('attendance_basis')
                if basis:
                    record = row['_record']
                    projected[id(record)] = {**record, 'attendanceBasis': basis,
                        'effectiveAttendance': 'present' if basis == 'recorded' else 'awaiting_recording'}
    return [projected.get(id(record), record) for record in records]
