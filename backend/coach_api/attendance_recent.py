"""Bounded bulk candidates for four canonical chips; no historical DTOs."""
from collections import defaultdict
from datetime import datetime

from django.db import connections
from django.db.models import F, Window
from django.db.models.functions import DenseRank
from django.utils import timezone

from learner_api import attendance_lectures as canonical
from learner_api.attendance import fetch_kbc_attendance_rows_bulk, fetch_verified_teams_attendance_rows
from learner_api.attendance_rules import attendance_outcome
from learner_api.attendance_confirmation import EVENT
from learner_api.student_activity_access import student_activity_available
from learner_api.alternative_recovery import ALTERNATIVE_METHOD, alternative_occurrence_id
from curriculum_api.models import LiveSessionAbsence
from .models import CoachAbsenceReport, CoachAttendanceSourceAdjustment, CoachManualAttendance
from .attendance_detail import occurrence_order


def recent_candidates(profiles, assignments, limit, state):
    """One query per transport, independent of learner count.

    Rank complete dates rather than rows: canonical mirror ambiguity depends on
    all identities on a day. Explicit corrections stay available even when they
    move an old row into the newest four. Recovery and confirmation identities
    can turn an otherwise unmarked occurrence into a counted outcome.
    """
    adjustments, confirmations, targets, completed, report_days = state
    sources = {p._caseload_source.id: p._caseload_source for p in profiles
               if getattr(p, '_caseload_source', None) is not None}
    records, scheduled = defaultdict(list), defaultdict(list)
    boundary = defaultdict(list)
    aptem = defaultdict(list)
    for source in sources.values():
        if student_activity_available(source.aptem_id):
            aptem[str(source.aptem_id).strip()].append(source)
    identities = [{'aptem_id': key, 'learner_id': values[0].id,
                   'learner_name': values[0].username or '', 'learner_email': values[0].email or ''}
                  for key, values in aptem.items()]
    representatives = {values[0].id: values for values in aptem.values()}
    correction_keys = [key[1] for edits in adjustments.values() for key in edits if key[0] == 'kbc-attendance']
    for row in fetch_kbc_attendance_rows_bulk(identities, recent_dates=limit, correction_keys=correction_keys):
        for source in representatives[row['learner_id']]:
            records[source.id].append({**row, 'learner_id': source.id, 'source': 'kbc-attendance'})
            if row['_day_rank'] == limit + 1:
                boundary[source.id].append(row['session_date'])
    eligible = [(source.id, canonical._key(source.email), module)
                for source in sources.values() if source.email for module in assignments.get(source.id, [])]
    if eligible:
        forced = {key[1] for edits in adjustments.values() for key in edits if key[0] == 'microsoft-teams'}
        forced.update(key.removeprefix('teams:').rsplit('-', 3)[0]
                      for entries in confirmations.values() for key in entries if key.startswith('teams:'))
        forced.update(str(key) for entries in completed.values() for key in entries)
        legacy_days = sorted({r['session_date'] for rows in records.values() for r in rows})
        recovery_days = sorted({day for days in report_days.values() for day in days})
        native = canonical.NATIVE_OCCURRENCES_SQL.replace(
            'SELECT o.id AS session_id', 'SELECT eligible.id AS enrolment_id,o.id AS session_id').replace(
            'lower(btrim(a.email))=%s', 'lower(btrim(a.email))=eligible.email').replace(
            'WHERE s.module_catalogue_id=ANY(%s)',
            '''JOIN eligible ON eligible.module_catalogue_id=s.module_catalogue_id
            WHERE ((o.scheduled_end<=%s AND (coalesce(o.attendance_report_id,'')<>''
              OR o.id=ANY(%s) OR (o.scheduled_start AT TIME ZONE %s)::date=ANY(%s)))
              OR (o.scheduled_start AT TIME ZONE %s)::date=ANY(%s) OR o.id=ANY(%s))''').replace(
            'ORDER BY o.scheduled_start,o.id', '')
        values = ','.join(['(%s,%s,%s)'] * len(eligible))
        sql = f'''WITH eligible(id,email,module_catalogue_id) AS (VALUES {values}),
            candidates AS ({native}), ranked AS (
                SELECT *,dense_rank() OVER (PARTITION BY enrolment_id
                  ORDER BY (scheduled_start AT TIME ZONE %s)::date DESC) AS day_rank FROM candidates)
            SELECT * FROM ranked WHERE day_rank<=%s OR session_id=ANY(%s)
              OR (scheduled_start AT TIME ZONE %s)::date=ANY(%s)
            ORDER BY scheduled_start,session_id'''
        zone = timezone.get_current_timezone_name()
        params = [item for triple in eligible for item in triple] + [timezone.now(), sorted(forced), zone,
            recovery_days, zone, legacy_days, sorted(forced), zone, limit+1, sorted(forced), zone, legacy_days]
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(sql, params)
            for row in canonical.dict_rows(cursor):
                source_id = row['enrolment_id']
                scheduled[source_id].append(row)
                if row['day_rank'] == limit + 1:
                    boundary[source_id].append(timezone.localtime(canonical._aware(row['scheduled_start'])).date())
    wanted = {str(row['session_id']) for rows in scheduled.values() for row in rows}
    wanted.update(target for rows in targets.values() for target in rows.values() if target)
    emails = [source.email for source in sources.values() if source.email]
    if wanted and emails:
        for row in fetch_verified_teams_attendance_rows(learner_emails=emails,
                occurrence_ids=sorted(wanted), independent_learner_scope=True):
            if row.get('enrolment_id') in sources:
                records[row['enrolment_id']].append({**row, 'learner_id': row['enrolment_id'], 'source': 'microsoft-teams'})
    return records, scheduled, boundary


def recent_attendance(profiles, assignments):
    source_ids = [p._caseload_source.id for p in profiles if getattr(p, '_caseload_source', None) is not None]
    result = {str(p.id): [] for p in profiles}
    if not source_ids:
        return result
    adjustments, confirmations, targets, completed, report_days, manuals = (
        defaultdict(dict), defaultdict(dict), defaultdict(dict), defaultdict(set), defaultdict(set), defaultdict(list))
    for row in CoachAttendanceSourceAdjustment.objects.filter(learner_id__in=[p.id for p in profiles]):
        adjustments[row.learner_id][(row.source, row.source_id)] = row
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT l.enrolment_id,p.time_tracking_session_ref AS lecture_id,
            p.claimed_seconds AS seconds,p.submitted_at FROM "Learner".learner_progress_entries p
            JOIN "Learner".learners l ON l.id=p.learner_id
            WHERE l.enrolment_id=ANY(%s) AND p.kind='activity_event' AND p.feed_kind=%s
            ORDER BY p.id''', [source_ids, EVENT])
        for row in canonical.dict_rows(cursor):
            confirmations[row['enrolment_id']][row['lecture_id']] = row
    for row in CoachAbsenceReport.objects.filter(learner_id__in=source_ids,
            status=CoachAbsenceReport.STATUS_APPROVED, recovery_method=ALTERNATIVE_METHOD).only(
                'learner_id', 'attendance_id', 'catchup_event_key', 'session_date'):
        targets[row.learner_id][str(row.attendance_id)] = alternative_occurrence_id(row.catchup_event_key)
        report_days[row.learner_id].add(row.session_date)
    for learner, occurrence in LiveSessionAbsence.objects.filter(source_learner_id__in=source_ids,
            recovery_method='catch-up', recovery_status=LiveSessionAbsence.RECOVERY_COMPLETED).values_list(
                'source_learner_id', 'occurrence_id'):
        completed[learner].add(occurrence)
    for row in CoachManualAttendance.objects.filter(learner_id__in=[p.id for p in profiles],
            session_date__lte=timezone.localdate()).annotate(day_rank=Window(
                expression=DenseRank(), partition_by=[F('learner_id')], order_by=F('session_date').desc()
            )).filter(day_rank__lte=4).only('id', 'learner_id', 'session_date', 'status'):
        manuals[row.learner_id].append({'session_id': str(row.id), 'session_date': row.session_date,
                                      'attendance_status': row.status, '_manual': True})
    pending, limit = [p for p in profiles if getattr(p, '_caseload_source', None) is not None], 8
    state = adjustments, confirmations, targets, completed, report_days
    while pending:
        records, scheduled, boundary = recent_candidates(pending, assignments, limit, state)
        unresolved = []
        for profile in pending:
            source = profile._caseload_source
            unique = {}
            for row in records[source.id]:
                key = row['source'], str(row.get('occurrence_id') or row['session_id'])
                if key not in unique or row['attendance_status'] in {'present', 'late'}:
                    unique[key] = row
            rows = canonical.lecture_register(source, learner_profile_id=profile.id,
                records=list(unique.values()), preloaded={
                    'scheduled': canonical.normalize_native_occurrences(source, scheduled[source.id]),
                    'confirmations': confirmations[source.id], 'targets': targets[source.id],
                    'completed': completed[source.id], 'adjustments': adjustments[profile.id]})
            counted = []
            for row in rows + manuals[profile.id]:
                status, eligible = attendance_outcome(row)
                if eligible:
                    counted.append((row, status))
            counted.sort(key=lambda item: occurrence_order(item[0]), reverse=True)
            # Expand only when deletions/mirror suppression leave too few rows,
            # or an edited old identity sits behind an unread candidate boundary.
            floor = max(boundary[source.id], default=None)
            fourth_day = datetime.fromtimestamp(occurrence_order(counted[3][0])[0],
                timezone.get_current_timezone()).date() if len(counted) >= 4 else None
            if floor and (fourth_day is None or fourth_day < floor):
                unresolved.append(profile)
            else:
                result[str(profile.id)] = [{'date': row['session_date'].isoformat(), 'status': status}
                                           for row, status in counted[:4]]
        pending, limit = unresolved, limit * 2
    return result
