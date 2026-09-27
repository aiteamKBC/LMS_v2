from collections import defaultdict
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from learner_api import teams_attendance


class TeamsAttendanceModuleRosterTests(SimpleTestCase):
    def test_module_roster_excludes_organizer_presenter_and_unassigned_guest(self):
        session = SimpleNamespace(
            module_catalogue_id="MOD-1",
            attendees=["learner@example.test", "guest@example.test"],
            presenters=["lecturer@example.test"],
            organizer_email="organizer@example.test",
        )
        assigned = defaultdict(set, {"MOD-1": {"learner@example.test"}})

        self.assertEqual(
            teams_attendance._module_expected_emails(session, assigned),
            {"learner@example.test"},
        )

    def test_caller_scope_can_narrow_the_module_roster(self):
        session = SimpleNamespace(module_catalogue_id="MOD-1")
        assigned = defaultdict(
            set,
            {"MOD-1": {"first@example.test", "second@example.test"}},
        )

        self.assertEqual(
            teams_attendance._module_expected_emails(
                session,
                assigned,
                {"second@example.test"},
            ),
            {"second@example.test"},
        )

    def test_assignment_rows_are_normalised_and_grouped_by_module(self):
        queryset = MagicMock()
        queryset.filter.return_value.values_list.return_value = [
            ("MOD-1", " Learner@Example.Test "),
            ("MOD-1", ""),
            ("MOD-2", "second@example.test"),
        ]
        manager = MagicMock()
        manager.using.return_value = queryset

        with patch.object(teams_attendance.LearnerTrainingPlanModule, "objects", manager):
            result = teams_attendance._assigned_learner_emails_by_module(
                "default",
                ["MOD-1", "MOD-2"],
            )

        self.assertEqual(result["MOD-1"], {"learner@example.test"})
        self.assertEqual(result["MOD-2"], {"second@example.test"})
        queryset.filter.assert_called_once_with(module_ref__in={"MOD-1", "MOD-2"})
