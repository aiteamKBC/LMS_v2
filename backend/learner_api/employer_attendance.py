"""Employer attendance uses the same saved outcomes as the learner Overview."""
from django.utils import timezone

from curriculum_api.bulk_attendance_live_policy import merge_live_over_kbc
from .attendance_rules import attendance_outcome
from .dashboard_overview import attendance_to_date, saved_attendance_rows
from .employer_learning import _prepare_source
from .journal_sources import learner_journal_reads


def read_attendance(source, kind=None):
    """Count final attendance to date, without reading raw reports or plan targets."""
    now = timezone.now()
    with learner_journal_reads():
        profile = _prepare_source(source)
        register = saved_attendance_rows(source, profile, now=now)
        summary = attendance_to_date(source, profile, now=now, register=register)
    if summary is None:
        return None
    # Retain the attendance endpoint's detail fields without expanding the
    # learner Overview contract or counting superseded historical rows twice.
    rows = merge_live_over_kbc(*register)
    late = sum(
        str(row.get('attendance_status') or '').strip().lower() == 'late'
        or (row.get('minutes_late') or 0) > 0
        for row in rows if attendance_outcome(row, now)[1]
    )
    return {**summary, 'absent': summary['sessions'] - summary['present'], 'late': late}
