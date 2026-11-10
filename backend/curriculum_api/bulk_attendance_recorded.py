"""Project saved recording outcomes without changing attendance evidence."""
from collections import defaultdict
from datetime import date

from django.db import DatabaseError, connections
from django.db.models.functions import Lower
from django.utils import timezone

from learner_api.models import EnrolmentUser, LearnerProfile
from learner_api.recorded_attendance import apply_recorded_attendance
from .models import LiveSession, LiveSessionLearnerAttendance, LiveSessionOccurrence


def directory_emails(learner_ids):
    """The same server-owned legacy email bridge used by the learner directory."""
    import psycopg
    from .bulk_attendance_learners import learner_directory_dsn

    dsn = learner_directory_dsn()
    if not dsn:
        return {}
    try:
        with psycopg.connect(dsn, connect_timeout=10) as connection:
            connection.read_only = True
            connection.execute("SET LOCAL statement_timeout = '10s'")
            rows = connection.execute('''SELECT "ID"::text, "Email" FROM public.kbc_users_data
                WHERE "ID"::text=ANY(%s)''', [list(learner_ids)]).fetchall()
    except psycopg.Error:
        raise DatabaseError('The attendance identity bridge is unavailable.') from None
    by_id = defaultdict(set)
    for learner_id, email in rows:
        if email and str(email).strip():
            by_id[str(learner_id)].add(str(email).strip().lower())
    return {key: next(iter(values)) for key, values in by_id.items() if len(values) == 1}


def recorded_sources(learner_ids):
    """Resolve unique enrolment identities and active preferences, for both kinds."""
    from learner_api.attendance_mode import TABLE, _ready

    sources = list(EnrolmentUser.all_learners.filter(aptem_id__in=learner_ids)
                   .only('id', 'aptem_id', 'learner_type'))
    by_aptem = defaultdict(list)
    for source in sources:
        by_aptem[str(source.aptem_id)].append(source)
    emails = directory_emails(set(learner_ids) - set(by_aptem)) if set(learner_ids) - set(by_aptem) else {}
    if emails:
        by_email = defaultdict(list)
        fallback = list(EnrolmentUser.all_learners.annotate(attendance_email=Lower('email'))
                        .filter(attendance_email__in=set(emails.values()))
                        .only('id', 'aptem_id', 'learner_type', 'email'))
        sources.extend(fallback)
        for source in fallback:
            by_email[source.email.strip().lower()].append(source)
        for key, email in emails.items():
            by_aptem[key] = by_email.get(email, [])
    if not sources:
        return {}
    with connections['enrolment'].cursor() as cursor:
        if not _ready(cursor):
            return {}
        cursor.execute(f"SELECT learner_id FROM {TABLE} WHERE mode='lazy' AND learner_id=ANY(%s)",
                       [[source.id for source in sources]])
        recorded_ids = {row[0] for row in cursor.fetchall()}
    return {key: values[0] for key, values in by_aptem.items()
            if len(values) == 1 and values[0].id in recorded_ids}


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

    profiles = dict(LearnerProfile.objects.filter(enrolment_id__in=[source.id for source in sources.values()])
                    .values_list('id', 'enrolment_id'))
    return {(profiles[row['learner_id']], row['source'], row['source_id'])
            for row in CoachAttendanceSourceAdjustment.objects.filter(learner_id__in=profiles)
            .values('learner_id', 'source', 'source_id', 'status', 'is_deleted')
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
