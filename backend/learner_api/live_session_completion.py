"""Complete assigned live-session components from verified Teams attendance."""
import json
from collections import defaultdict

from django.db import transaction

from .active_users import component_reference_state, save_progress_record
from .attendance_lectures import _component_for, read_native_components
from .models import EnrolmentUser, LearnerProfile


def complete_attended_live_sessions(rows):
    """Append missing completions without changing attendance or crediting hours again.

    Called by the attendance synchronizer in its transaction. Only original
    report-backed presence qualifies; an excuse or a catch-up is not attendance
    at this occurrence. Reflection is not required for verified attendance.
    """
    by_learner = defaultdict(list)
    for row in rows:
        if (
            row.get('attendance_status') == 'present'
            and row.get('raw_attendance_status', 'present') == 'present'
            and row.get('is_expected') is True
            and row.get('attendance_report_id')
            and row.get('actual_end')
            and row.get('occurrence_id')
            and row.get('learner_profile_id')
            and row.get('enrolment_id')
        ):
            by_learner[row['learner_profile_id']].append(row)
    if not by_learner:
        return 0

    completed = 0
    with transaction.atomic(using='enrolment'):
        # Use the same learner lock as manual progress writes. Repeated reports
        # and concurrent syncs must observe the completion before appending one.
        profiles = (LearnerProfile.objects.using('enrolment').select_for_update()
                    .filter(pk__in=sorted(by_learner)).order_by('pk')
                    .only('id', 'enrolment_id'))
        for learner in profiles:
            attendance = [row for row in by_learner[learner.pk]
                          if row['enrolment_id'] == learner.enrolment_id]
            if not attendance:
                continue
            source = (EnrolmentUser.all_learners.using('enrolment')
                      .filter(pk=learner.enrolment_id).only('id').first())
            if source is None:
                continue
            # Reuse the attendance workspace's assignment/deletion filters and
            # exact occurrence matching. An ambiguous match completes nothing.
            components, _ = read_native_components(
                source, module_refs=sorted({row['module_catalogue_id'] for row in attendance}),
            )
            for row in attendance:
                component = _component_for(row, components)
                if component is None or component['completed']:
                    continue
                if component_reference_state(component['id'])[0] != 'active':
                    continue
                ended_at = row['actual_end'].isoformat()
                started_at = row.get('actual_start') or row.get('scheduled_start')
                record = {
                    'kind': 'component',
                    'componentId': component['id'],
                    'componentType': 'live_session',
                    'componentTitle': component['title'],
                    'startedAt': started_at.isoformat() if started_at else None,
                    'submittedAt': ended_at,
                    'timeTrackingSource': 'microsoft_teams_attendance',
                    'timeTrackingSessionId': f"teams-attendance:{row['occurrence_id']}",
                    'timeTrackingCalculation': json.dumps({
                        'sourceRef': f"attendance:{row['occurrence_id']}",
                        'attendanceReportId': row['attendance_report_id'],
                        'attendedSeconds': row.get('attended_seconds', 0),
                    }),
                    # Attendance retains its existing hours source. This row
                    # records completion only, never a second time claim.
                    'reportedTime': '0 minutes',
                    'claimedSeconds': 0,
                    'verifiedSeconds': 0,
                }
                save_progress_record(learner, record, {
                    'kind': 'component',
                    'componentType': 'live_session',
                    'action': 'Completed live session',
                    'title': component['title'],
                    'detail': 'Completed automatically from verified Teams attendance.',
                    'at': ended_at,
                })
                component['completed'] = True
                completed += 1
    return completed
