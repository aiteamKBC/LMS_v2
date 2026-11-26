"""Run Recorded delivery and preserved Live rules in the existing blocking CI shard.

The CI runner discovers test*_no_db.py. These suites use synthetic facts and
mocked services; SimpleTestCase prohibits application database access.
"""
from curriculum_api.tests_bulk_attendance_recorded import (
    BulkRecordedOutcomeTests,
    RecordedSourceIdentityTests,
)
from .tests_live_session_progress import LiveSessionProgressTests
from .tests_recorded_attendance import RecordedAttendanceTests
from .tests_recorded_session_progress import RecordedSessionProgressTests
