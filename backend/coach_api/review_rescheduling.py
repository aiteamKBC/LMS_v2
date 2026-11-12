"""Coach-only rescheduling policy and immutable previous booking contexts.

No provider requests and no changes to Review answers, signatures or lifecycle.
Writers must hold the calendar row lock before checking evidence or archiving.
"""
from copy import copy

from django.db import ProgrammingError, OperationalError, transaction

from .models import ReviewBookingReschedule
from .migrated_session_scope import booking_fingerprint, session_context_from_claim


def previous_bookings(record):
    if not getattr(record, 'pk', None) or getattr(record, 'event_type', None) not in {'mcr', 'progress-review'}:
        return []
    key = booking_fingerprint(record)
    cached = getattr(record, '_reschedule_history_cache', None)
    if cached and cached[0] == key:
        return cached[1]
    query = ReviewBookingReschedule.objects.filter(
        calendar_event_id=record.pk, learner_profile_id=record.learner_id,
        event_key=record.event_key, graph_event_id=record.graph_event_id,
        owner_email__iexact=record.owner_email,
    ).order_by('created_at', 'pk')
    try:
        with transaction.atomic():
            rows = list(query)
    except (ProgrammingError, OperationalError) as exc:
        # Rolling deployment: existing reviews remain readable before the new
        # additive migration. The new writer still refuses to lose history.
        code = getattr(exc.__cause__, 'sqlstate', None) or getattr(exc.__cause__, 'pgcode', None)
        if code == '42P01' or 'no such table' in str(exc):
            rows = []
        elif (code == '42703' or 'no such column' in str(exc)) and 'evidence_manifest' in str(exc):
            # The additive manifest migration may follow the application update.
            # Read existing history as before; new writes still require the field.
            with transaction.atomic():
                rows = list(query.defer('evidence_manifest'))
            for row in rows:
                row.evidence_manifest = {}
        else:
            raise
    record._reschedule_history_cache = (key, rows)
    return rows


def historical_record(record, attempt):
    previous = copy(record)
    previous.scheduled_date = attempt.scheduled_date
    previous.scheduled_time = attempt.scheduled_time
    previous.duration_minutes = attempt.duration_minutes
    return previous


def archived_claim(record, claim):
    """A previously verified claim remains reserved, but is not the new call."""
    return next((attempt for attempt in previous_bookings(record)
                 if attempt.session_claim == claim
                 and session_context_from_claim(historical_record(record, attempt), claim)), None)


def started_booking(record, status):
    return bool(record and status == 'in-progress' and record.status == 'in-progress'
                and record.event_type in {'mcr', 'progress-review'}
                and record.graph_event_id and (record.meeting_link or record.graph_web_link)
                and record.scheduled_date and record.scheduled_time
                and record.sync_state in {'synced', 'failed', 'pending'}
                and not record.review_completed_at and not record.manager_signed_at)


def learner_attended(record, *, overlay=None):
    """Ten minutes of learner attendance blocks rescheduling, including identity links.

    No reports is pending, not absence; either permits this specific Coach action.
    A failed evidence read is not the same as an absent report and fails closed.
    """
    from . import views as v
    from .review_attendance_links import LinkConflict, saved_links, project_attendance, scoped_snapshot
    from .bound_actual_session import BoundSessionConflict
    from .review_attendance_policy import attended_seconds, qualifies
    snapshot = v.stored_coach_meeting_snapshot(record)
    if snapshot.get('partial') or not (snapshot.get('storage') or {}).get('stored'):
        raise v.LearnerCalendarConflict('Attendance could not be checked. Retry before rescheduling.')
    attendance = snapshot.get('attendance') or {}
    # Retain the saved roster too: an email edit must not erase known attendance.
    links = saved_links(record)
    candidates = [attendance, project_attendance(record, attendance, links)]
    if overlay is not None and links:
        # Imported links are saved against the selected call, which can have
        # fewer reports than the unscoped stored snapshot.
        try:
            selected = scoped_snapshot(record, overlay)
        except (LinkConflict, BoundSessionConflict):
            raise v.LearnerCalendarConflict('Attendance could not be checked. Retry before rescheduling.') from None
        candidates.append(project_attendance(record, selected['attendance'], links))
    for value in candidates:
        if any(row.get('expected') and row.get('role') == 'learner'
               and qualifies(row.get('totalAttendanceSeconds') or 0)
               for row in value.get('tracker') or []):
            return True
    expected = [row for row in v.coach_meeting_expected_attendees(record)
                if row.get('role') == 'learner']
    records = [row for report in snapshot.get('attendanceReports') or []
               for row in report.get('records') or []]
    return any(qualifies(attended_seconds([
        row for row in records if v.coach_attendance_record_confirms_expected(row, person)
    ])) for person in expected)


def require_started_reschedule(record, status, *, overlay=None):
    from .views import LearnerCalendarConflict
    if not started_booking(record, status):
        raise LearnerCalendarConflict('Only an existing editable Review meeting can be rescheduled.')
    if learner_attended(record, overlay=overlay):
        raise LearnerCalendarConflict('The learner attended this meeting. It cannot be rescheduled.')


def archive_booking(record, candidate, *, overlay=None):
    """Called in the same transaction as the slot update; retries are idempotent."""
    if (record.scheduled_date, record.scheduled_time, record.duration_minutes) == (
            candidate.scheduled_date, candidate.scheduled_time, candidate.duration_minutes):
        return
    claim = {}
    if overlay and (overlay.meeting_intelligence or {}).get('actualSession'):
        from .bound_actual_session import bound_session, BoundSessionConflict
        try:
            bound = bound_session(record, overlay=overlay, lock=True)
        except BoundSessionConflict:
            from .views import LearnerCalendarConflict
            raise LearnerCalendarConflict('The saved session association changed. Reload the Review before rescheduling.') from None
        claim = bound.claim if bound else {}
    manifest = {}
    if overlay is not None:
        from .review_reschedule_evidence import capture, EvidenceConflict
        from .views import stored_coach_meeting_snapshot, LearnerCalendarConflict
        try:
            manifest = capture(record, stored_coach_meeting_snapshot(record),
                               evidence_manifests(record, previous_bookings(record)))
        except EvidenceConflict:
            raise LearnerCalendarConflict(
                'Previous meeting resources could not be verified. Retry before rescheduling.') from None
    try:
        with transaction.atomic():
            ReviewBookingReschedule.objects.get_or_create(
                calendar_event_id=record.pk, booking_fingerprint=booking_fingerprint(record),
                defaults=dict(learner_id=record.learner_id, event_key=record.event_key,
                              graph_event_id=record.graph_event_id, owner_email=record.owner_email,
                              scheduled_date=record.scheduled_date, scheduled_time=record.scheduled_time,
                              duration_minutes=record.duration_minutes, session_claim=claim,
                              evidence_manifest=manifest),
            )
    except (ProgrammingError, OperationalError):
        from .views import LearnerCalendarConflict
        raise LearnerCalendarConflict('Rescheduling history is unavailable. Ask support to check the installation.') from None
    record._reschedule_history_cache = None


def evidence_manifests(record, attempts):
    from .review_reschedule_evidence import validated_manifest
    result = []
    for attempt in attempts:
        if getattr(attempt, 'evidence_manifest', {}) in ({}, None):
            continue
        result.append(validated_manifest(historical_record(record, attempt), attempt))
    return result


def current_evidence(record, snapshot):
    """Restrict reused meetings to their new slot; stored historical rows survive."""
    if getattr(record, 'event_type', None) not in {'mcr', 'progress-review'}:
        return snapshot
    attempts = previous_bookings(record)
    if not attempts:
        return snapshot
    from .review_reschedule_evidence import without_archived, EvidenceConflict
    try:
        snapshot = without_archived(snapshot, evidence_manifests(record, attempts))
    except EvidenceConflict:
        return {**snapshot, 'attendanceReports': [], 'artifacts': [],
                'rescheduleSelectionError': 'MEETING_ARTIFACT_CONFLICT'}
    from .migrated_session_scope import current_reports, select_artifacts
    reports = current_reports(record, snapshot)
    artifacts, error = select_artifacts(record, {**snapshot, 'attendanceReports': reports})
    return {**snapshot, 'attendanceReports': reports, 'artifacts': artifacts,
            **({'rescheduleSelectionError': error} if error else {})}


def historical_artifacts(record, snapshot):
    """Same authorised booking/provider only, with each old slot independently scoped."""
    from .migrated_session_scope import scope_snapshot, has_verified_meeting_evidence, select_artifacts
    from .review_reschedule_evidence import validated_manifest, archived_artifacts, EvidenceConflict
    result = []
    seen = set()
    for attempt in previous_bookings(record):
        previous = historical_record(record, attempt)
        try:
            manifest = validated_manifest(previous, attempt)
        except EvidenceConflict:
            continue
        if manifest is not None:
            artifacts = archived_artifacts(record, snapshot, manifest)
        else:
            session = session_context_from_claim(previous, attempt.session_claim)
            scoped = scope_snapshot(previous, snapshot, session=session, historical=True,
                                    meeting_scoped=has_verified_meeting_evidence(snapshot))
            if scoped.get('selectionError'):
                continue
            artifacts, error = select_artifacts(previous, scoped, session=session)
            if error:
                continue
        for artifact in artifacts:
            if (artifact.get('metadata') or {}).get('_lms_graph_event_id') != record.graph_event_id:
                continue
            key = artifact.get('artifact_type'), artifact.get('graph_artifact_id')
            if key in seen:
                continue
            seen.add(key)
            result.append({**artifact, 'previous_session': True})
    return result


def historical_content(record, artifact_type, artifact_id, snapshot):
    """Select one old artifact after the normal endpoint has authorised the Review."""
    if artifact_id == 'combined':
        return None
    return next((row for row in historical_artifacts(record, snapshot)
                 if row.get('artifact_type') == artifact_type
                 and row.get('graph_artifact_id') == artifact_id), None)
