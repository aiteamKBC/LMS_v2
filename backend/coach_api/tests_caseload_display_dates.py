from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from coach_api.views import (
    caseload_display_start_date, caseload_profile_start_date,
    caseload_schedule_values, fetch_source_schedule_rows, resolve_caseload_source_row,
)


class CaseloadDisplayStartDateTests(SimpleTestCase):
    def test_bulk_stable_enrolment_lookup_for_all_types_and_coaches(self):
        for coach in ("coach-a@example.invalid", "coach-b@example.invalid"):
            with self.subTest(coach=coach):
                profiles = [SimpleNamespace(id=i, enrolment_id=100 + i, coach_email=coach,
                                            full_name="Same display name", start_date="2020-01-01")
                            for i in (1, 2, 3)]
                sources = [SimpleNamespace(id=100 + i, learner_type=kind,
                                           learner_start_date=value, start_date="2020-01-01")
                           for i, kind, value in ((1, "apprenticeship", "2026-05-28"),
                                                  (2, "commercial", "2025-05-01"),
                                                  (3, "apprenticeship", None))]
                with patch("coach_api.views.EnrolmentUser.all_learners.filter", return_value=sources) as fetch:
                    commercial, enrolment = fetch_source_schedule_rows(profiles)
                fetch.assert_called_once_with(pk__in={101: 1, 102: 2, 103: 3})
                for profile in profiles:
                    profile._caseload_source = resolve_caseload_source_row(
                        profile, commercial_rows=commercial, enrolment_rows=enrolment)
                    profile._caseload_contract = {"program_start_date": "2025-10-01"}
                self.assertEqual([caseload_profile_start_date(r) for r in profiles],
                                 ["2026-05-28", "2025-05-01", None])
                self.assertEqual([caseload_display_start_date(r) for r in profiles],
                                 ["28 May 2026", "01 May 2025", "--"])
                self.assertEqual([caseload_schedule_values(r)[1] for r in profiles],
                                 ["2025-10-01"] * 3)

    def test_no_source_or_relation_does_not_fall_back_to_profile(self):
        row = SimpleNamespace(id=1, enrolment_id=None, start_date="2026-05-28")
        with patch("coach_api.views.EnrolmentUser.all_learners.filter") as fetch:
            self.assertEqual(fetch_source_schedule_rows([row]), ({}, {}))
        fetch.assert_not_called()
        self.assertIsNone(caseload_profile_start_date(row))
        self.assertEqual(caseload_display_start_date(row), "--")
