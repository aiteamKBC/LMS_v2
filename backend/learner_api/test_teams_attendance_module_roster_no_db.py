from collections import defaultdict
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from learner_api import teams_attendance


class TeamsAttendanceModuleRosterTests(SimpleTestCase):
    def test_attendance_session_query_compiles_with_real_model_fields(self):
        # Compile the real ORM selection used by reporting. A mocked queryset
        # alone accepts nonexistent fields and hides failures before SQL runs.
        real_queryset = teams_attendance.LiveSession.objects.using("default")
        queryset = MagicMock()

        def compile_selection(*fields):
            sql, _params = real_queryset.only(*fields).query.get_compiler(using="default").as_sql()
            self.assertIn('"co_organizers"', sql)
            return []

        queryset.only.side_effect = compile_selection
        with patch.object(teams_attendance.router, "db_for_read", return_value="default"), \
                patch("learner_api.alternative_recovery.approved_alternative_guests", return_value={}), \
                patch.object(teams_attendance.LiveSession.objects, "using", return_value=queryset):
            self.assertEqual(teams_attendance.fetch_verified_teams_attendance_rows(all_learners=True), [])
        queryset.only.assert_called_once()

    def test_saved_co_organizer_is_not_matched_to_a_similarly_named_learner(self):
        session = teams_attendance.LiveSession(
            organizer_email="organizer@example.test", presenters=[],
            co_organizers=[" Staff@Example.Test "],
        )
        participant = {
            "id": "row-1", "occurrence_id": "session-1", "role": "presenter",
            "email": "staff@example.test", "display_name": "Eva Morgan",
        }
        resolved = teams_attendance.apply_reviewed_identities(
            [participant],
            learners={"eva.morgan@example.test": {"name": "Eva Morgan", "learnerProfileId": 7}},
            protected_emails=teams_attendance.series_identity_emails(session),
        )
        self.assertEqual(resolved[0]["email"], "staff@example.test")
        self.assertIsNone(resolved[0]["identityRule"])

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
        queryset.filter.assert_called_once_with(curriculum_module_id__in={"MOD-1", "MOD-2"})

    def test_replaced_attendance_sources_map_destination_to_source_report(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [
            ("destination-occurrence", "source-occurrence", "source-report"),
        ]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch.object(teams_attendance, "connections", {"default": connection}):
            result = teams_attendance._replaced_attendance_sources(
                "default",
                ["destination-occurrence"],
            )

        self.assertEqual(
            result,
            {
                "destination-occurrence": {
                    "occurrence_id": "source-occurrence",
                    "attendance_report_id": "source-report",
                },
            },
        )
        sql, params = cursor.execute.call_args.args
        self.assertIn("liveSessionLinkOverride", sql)
        self.assertEqual(params, [["destination-occurrence"]])
