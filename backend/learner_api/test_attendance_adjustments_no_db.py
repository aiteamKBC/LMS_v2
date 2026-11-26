from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from django.utils import timezone

from learner_api.attendance_lectures import _apply_coach_source_adjustments


class CoachAttendanceAdjustmentProjectionTests(SimpleTestCase):
    @patch("coach_api.models.CoachAttendanceSourceAdjustment.objects")
    def test_edit_projects_into_the_shared_learner_and_coach_register(self, objects):
        objects.filter.return_value = [SimpleNamespace(
            source="microsoft-teams", source_id="occ-8", is_deleted=False,
            session_date=date(2026, 10, 2), module_name="Updated module",
            session_title="Updated session", status="present", updated_at=timezone.now(),
        )]
        row = {
            "source": "microsoft-teams", "session_id": "occ-8",
            "session_date": date(2026, 10, 1), "module_title": "Old module",
            "session_type": "live_session", "session_title": "Old session",
            "attendance_status": "absent",
        }

        result = _apply_coach_source_adjustments([row], 315)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["session_date"], date(2026, 10, 2))
        self.assertEqual(result[0]["session_title"], "Updated session")
        self.assertEqual(result[0]["attendance_status"], "present")
        self.assertEqual(result[0]["effective_attendance"], 1)
        objects.filter.assert_called_once_with(learner_id=315)

    @patch("coach_api.models.CoachAttendanceSourceAdjustment.objects")
    def test_delete_removes_only_the_matching_learner_row(self, objects):
        objects.filter.return_value = [SimpleNamespace(
            source="kbc-attendance", source_id="kbc-1", is_deleted=True,
        )]
        rows = [
            {"source": "kbc-attendance", "session_id": "kbc-1"},
            {"source": "kbc-attendance", "session_id": "kbc-2"},
        ]

        result = _apply_coach_source_adjustments(rows, 315)

        self.assertEqual([row["session_id"] for row in result], ["kbc-2"])
