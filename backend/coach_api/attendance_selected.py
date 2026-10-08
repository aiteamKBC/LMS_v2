"""Bulk persisted evidence for one occurrence; canonical projection stays shared."""
from collections import defaultdict

from django.db import connections, DatabaseError
from django.utils import timezone

from learner_api import attendance_lectures as canonical
from learner_api.attendance_rules import attendance_outcome
from learner_api.attendance_confirmation import EVENT
from learner_api.alternative_recovery import ALTERNATIVE_METHOD, alternative_occurrence_id
from learner_api.teams_attendance import fetch_verified_teams_attendance_rows
from curriculum_api.models import LiveSessionAbsence
from .models import CoachAbsenceReport, CoachAttendanceSourceAdjustment


# Same JSON + normalized assignment union as ATTENDANCE_SUBJECTS_SQL, retaining
# learner identity. Never use group membership or an old invite as assignment.
ASSIGNMENTS_SQL = '''WITH source AS (
    SELECT id,lower(btrim("Email")) AS email,
        CASE WHEN jsonb_typeof("Training_plan"::jsonb)='array'
        THEN "Training_plan"::jsonb ELSE "Learning_plan"::jsonb END AS plan
    FROM enrolment."Created_users" WHERE id=ANY(%s)
), assigned AS (
    SELECT id,email,entry->>'moduleId' AS module_id FROM source
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(plan)='array' THEN plan ELSE '[]'::jsonb END) entry
    UNION
    SELECT source.id,source.email,coalesce(m.curriculum_module_id,nullif(m.module_ref,''))
    FROM source JOIN "Learner".learners l ON l.enrolment_id=source.id
    JOIN "Learner".learner_training_plan_modules m ON m.learner_id=l.id
), eligible AS (
    SELECT DISTINCT assigned.id,assigned.email,cm.module_catalogue_id
    FROM assigned JOIN curriculum.modules cm ON cm.module_catalogue_id=assigned.module_id
    WHERE (cm.deleted_at IS NULL OR COALESCE(cm.deleted_via_parent,'')<>'')
      AND coalesce(assigned.email,'')<>''
) '''


def selected_rows(profiles, occurrence_id, timing):
    """Return response rows with no I/O inside learner projection loops.

    Only the selected occurrence and approved alternative targets can affect
    its state. Target schedules are retained to distinguish an assigned lecture
    from a recovery guest, exactly as the full register does.
    """
    from .bulk_attendance import attendance_version

    available = [profile for profile in profiles if getattr(profile, '_caseload_source', None) is not None]
    if not available:
        return {}
    sources = {profile._caseload_source.id: profile._caseload_source for profile in available}
    source_ids = list(sources)
    profile_ids = [profile.id for profile in available]
    report_ids = {source_id: str(canonical.report_id({
        'learner_id': source_id, 'source': 'microsoft-teams', 'session_id': occurrence_id}))
        for source_id in source_ids}
    reports, targets = {}, defaultdict(dict)
    with timing.stage('absence_reports'):
        for report in CoachAbsenceReport.objects.filter(
                learner_id__in=source_ids, attendance_id__in=list(report_ids.values())).order_by('created_at', 'id'):
            if str(report.attendance_id) != report_ids.get(report.learner_id):
                continue
            reports[report.learner_id] = report
            if report.status == CoachAbsenceReport.STATUS_APPROVED and report.recovery_method == ALTERNATIVE_METHOD:
                targets[report.learner_id][str(report.attendance_id)] = alternative_occurrence_id(report.catchup_event_key)

    wanted = sorted({occurrence_id} | {value for values in targets.values() for value in values.values() if value})
    scheduled, records = defaultdict(list), defaultdict(list)
    with timing.stage('occurrence_state'):
        sql = canonical.NATIVE_OCCURRENCES_SQL.replace(
            'SELECT o.id AS session_id', 'SELECT eligible.id AS enrolment_id,o.id AS session_id').replace(
            'lower(btrim(a.email))=%s', 'lower(btrim(a.email))=eligible.email').replace(
            'WHERE s.module_catalogue_id=ANY(%s)',
            'JOIN eligible ON eligible.module_catalogue_id=s.module_catalogue_id WHERE o.id=ANY(%s)')
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(ASSIGNMENTS_SQL + sql, [source_ids, wanted])
            for row in canonical.dict_rows(cursor):
                scheduled[row['enrolment_id']].append(row)

    with timing.stage('attendance_state'):
        emails = [source.email for source in sources.values() if source.email]
        # This reader uses stored report rows, reviewed aliases, reconnect
        # deduplication, and persisted recovery. It never calls Graph.
        evidence = fetch_verified_teams_attendance_rows(learner_emails=emails, occurrence_ids=wanted, independent_learner_scope=True) if emails else []
        for row in evidence:
            source_id = row.get('enrolment_id')
            if source_id in sources:
                records[source_id].append({**row, 'learner_id': source_id, 'source': 'microsoft-teams'})

    completed, confirmations = defaultdict(set), defaultdict(dict)
    with timing.stage('corrections_recovery'):
        try:
            for source_id, target in LiveSessionAbsence.objects.filter(
                    source_learner_id__in=source_ids, occurrence_id=occurrence_id,
                    recovery_method='catch-up', recovery_status=LiveSessionAbsence.RECOVERY_COMPLETED
                    ).values_list('source_learner_id', 'occurrence_id'):
                completed[source_id].add(target)
        except DatabaseError:
            # Match the register's existing unavailable-ledger behavior for
            # unreported lectures; never invent recovery credit.
            canonical.log.warning('Could not read completed catch-ups for selected attendance.', exc_info=True)
        adjustments = {row.learner_id: row for row in CoachAttendanceSourceAdjustment.objects.filter(
            learner_id__in=profile_ids, source='microsoft-teams', source_id=occurrence_id)}
        # Confirmation keys contain the scheduled local date. Restrict by exact
        # keys, retaining canonical ordering when old duplicate events exist.
        keys = [f"teams:{occurrence_id}-{timezone.localtime(canonical._aware(row['scheduled_start'])).date().isoformat()}"
                for rows in scheduled.values() for row in rows if str(row['session_id']) == occurrence_id]
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''SELECT l.enrolment_id,p.time_tracking_session_ref AS lecture_id,
                p.claimed_seconds AS seconds,p.submitted_at,p.time_tracking_calculation AS details
                FROM "Learner".learner_progress_entries p
                JOIN "Learner".learners l ON l.id=p.learner_id
                WHERE l.enrolment_id=ANY(%s) AND p.kind='activity_event' AND p.feed_kind=%s
                  AND p.time_tracking_session_ref=ANY(%s) ORDER BY p.id''', [source_ids, EVENT, list(set(keys))])
            for row in canonical.dict_rows(cursor):
                confirmations[row['enrolment_id']][row['lecture_id']] = row

    raw_rows = {}
    with timing.stage('canonical_projection'):
        for profile in available:
            source = profile._caseload_source
            register = canonical.lecture_register(source, learner_profile_id=profile.id, apply_adjustments=False,
                records=records[source.id], preloaded={
                    'scheduled': canonical.normalize_native_occurrences(source, scheduled[source.id]),
                    'targets': targets[source.id], 'completed': completed[source.id],
                    'confirmations': confirmations[source.id]})
            row = next((row for row in register if str(row['session_id']) == occurrence_id), None)
            if row is not None:
                raw_rows[str(profile.id)] = row

    versions = {}
    with timing.stage('version_generation'):
        for profile in available:
            if (row := raw_rows.get(str(profile.id))) is not None:
                versions[str(profile.id)] = attendance_version(profile.id, occurrence_id, row, adjustments.get(profile.id))

    result = {}
    with timing.stage('canonical_projection'):
        for profile in available:
            row = raw_rows.get(str(profile.id))
            if row is None:
                continue
            adjustment = adjustments.get(profile.id)
            projected = canonical._apply_coach_source_adjustments([row], profile.id,
                adjustments={('microsoft-teams', occurrence_id): adjustment} if adjustment else {})
            status = attendance_outcome(projected[0])[0] if projected else None
            report = reports.get(profile._caseload_source.id) if projected else None
            result[str(profile.id)] = {
                'learnerId': str(profile.id), 'status': status if status in {'present', 'absent'} else None,
                'absenceReport': {'id': str(report.id), 'status': report.status,
                                  'url': getattr(report, 'evidence_image_url', '') or None} if report else None,
                'version': versions[str(profile.id)]}
    return result
