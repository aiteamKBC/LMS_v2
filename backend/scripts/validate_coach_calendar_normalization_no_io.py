"""Run canonical calendar regressions with database and network access forbidden.

Transaction/race suites require database writes and are intentionally not invoked.
They remain a separate release gate; this runner does not replace them.
"""
from pathlib import Path
import runpy
import sys

SUITES = [
    "coach_api.test_calendar_canonical_identity",
    "coach_api.tests_calendar_reschedule",
    "coach_api.tests_calendar_sync_visibility",
    "coach_api.test_booking_reservations",
    "coach_api.test_graph_transport",
    "coach_api.test_graph_request_errors",
    "coach_api.tests_errors",
    "learner_api.tests_booking_calendar",
    "learner_api.test_imported_booking",
    "learner_api.tests_first_session",
    "learner_api.test_first_session_bookings_no_db",
    "login.test_lms_introduction_no_db",
    "coach_api.test_imported_review_start",
    "coach_api.test_actual_session_resolution",
    "coach_api.test_bound_actual_session_no_db",
    "curriculum_api.tests.TeamsMultiDayRecurrenceTests",
    "curriculum_api.tests.TeamsAttendanceRosterTests",
    "learner_api.tests.TeamsAttendanceEligibilityTests",
    "learner_api.tests.TeamsAttendanceSyncTests",
    "coach_api.tests.CoachMeetingArtifactTests",
    "coach_api.test_calendar_booking_only_no_db",
    "coach_api.test_non_delivery_booking_no_db",
    "learner_api.tests_direct_coach_booking",
    "learner_api.tests_first_session_reschedule"
]

if __name__ == "__main__":
    runner = Path(__file__).with_name("validate_progress_transfer_no_io.py")
    sys.argv = [str(runner), *SUITES]
    runpy.run_path(str(runner), run_name="__main__")
