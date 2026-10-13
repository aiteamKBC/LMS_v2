from copy import deepcopy
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from coach_api.review_categories import review_event_category
from coach_api.services.dashboard.sections import project_section, summarize_meetings
from coach_api.services.dashboard.service import CoachDashboardService
from coach_api.views import latest_completed_review_dates_from_events
from coach_api import views


class ReviewCategoryTests(SimpleTestCase):
    @patch("coach_api.review_sources.enrich_imported_events", side_effect=lambda events: events)
    @patch("coach_api.views.fetch_aptem_review_events")
    @patch("coach_api.views.resolve_effective_aptem_ids", return_value=({1: 101}, set()))
    @patch("coach_api.views.LearnerProfile.objects")
    def test_old_snapshot_repair_loads_owned_identity_and_leaves_native_history_alone(self, profiles, identities, fetch, enrich):
        owned = [SimpleNamespace(id=1, aptem_id=101), SimpleNamespace(id=2, aptem_id=None)]
        profiles.annotate.return_value.filter.return_value.only.return_value = owned
        fetch.return_value = ([{"learnerId": "1", "source": "progress-review", "importedReviewType": "Gateway Review",
                               "status": "completed", "reviewCompletedAt": "2026-09-10"}], {1})
        result = views.dashboard_imported_completed_review_dates([1, 2], owner_email="coach@example.invalid", owner_name="Coach")
        self.assertEqual(result, {1: {"lastPr": None, "lastMcm": None}})
        profiles.annotate.return_value.filter.assert_called_once_with(coach_email_key="coach@example.invalid", pk__in=[1, 2])
        identities.assert_called_once_with(owned)
        enrich.assert_called_once_with(fetch.return_value[0])

    def test_imported_types_take_precedence_over_legacy_routing_without_mutation(self):
        cases = {
            "Monthly Coaching Meeting": "mcr", " Monthly Coaching ": "mcr", "mcm": "mcr",
            "Progress Review": "progress-review", "progress review (+ skills radar)": "progress-review",
            "Gateway Review": "review", "RPL and Experience": "review",
            "Eligibility Review & FS Discussion": "review", "Workplace Health & Safety Declaration": "review",
            "ULN Privacy Notice & Learner Acknowledgement Review": "review", "Future custom type": "review",
        }
        for original_type, expected in cases.items():
            with self.subTest(original_type=original_type):
                event = {"source": "progress-review", "importedReviewType": original_type,
                         "eventKey": "imported-review:synthetic", "meetingLink": "https://example.invalid/meeting"}
                before = deepcopy(event)
                self.assertEqual(review_event_category(event), expected)
                self.assertEqual(event, before)

    def test_curriculum_classification_uses_type_code_not_template_title(self):
        self.assertEqual(review_event_category({"source": "review", "reviewTypeCode": "progress_review", "title": "Gateway"}), "progress-review")
        self.assertEqual(review_event_category({"source": "review", "reviewTypeCode": "career_review", "title": "Progress Review"}), "review")
        self.assertEqual(review_event_category({"source": "catch-up"}), "catch-up")

    def test_other_completed_reviews_never_supply_last_pr_or_cross_learner_dates(self):
        events = [
            {"learnerId": "1", "source": "progress-review", "importedReviewType": "RPL and Experience",
             "status": "completed", "reviewCompletedAt": "2026-09-10"},
            {"learnerId": "2", "source": "progress-review", "importedReviewType": "Progress Review (+ Skills Radar)",
             "status": "completed", "reviewCompletedAt": "2026-09-01"},
            {"learnerId": "2", "source": "progress-review", "importedReviewType": "Gateway Review",
             "status": "completed", "reviewCompletedAt": "2026-09-12"},
        ]
        dates = latest_completed_review_dates_from_events([SimpleNamespace(id=1), SimpleNamespace(id=2)], events)
        self.assertEqual(dates[1], {"lastPr": None, "lastMcm": None})
        self.assertEqual(dates[2], {"lastPr": "01 Sep 2026", "lastMcm": None})

    @patch("coach_api.services.dashboard.sections.timezone.localdate", return_value=date(2026, 9, 23))
    def test_projected_weekly_counts_and_popup_exclude_other_imported_reviews(self, _today):
        base = {"learnerId": "1", "source": "progress-review", "scheduledDate": "2026-09-23", "status": "scheduled"}
        payload = {"learners": [{"id": "1", "name": "Synthetic learner", "rawProgramStatus": "Active"}],
                   "meetings": {"events": [{**base, "id": str(index), "importedReviewType": kind}
                       for index, kind in enumerate(["RPL and Experience", "Progress Review", "Progress Review (+ Skills Radar)"])]}}
        result = summarize_meetings(project_section(payload, "summary"))
        self.assertEqual(result["summary"]["meetingsThisWeek"]["pr"], 2)
        self.assertEqual([item["id"] for item in result["meetingsPopup"]["pr"]["items"]], ["1", "2"])

    @patch("coach_api.views.dashboard_imported_completed_review_dates", return_value={1: {"lastPr": None, "lastMcm": None}})
    @patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates")
    def test_old_dashboard_projection_does_not_retain_misclassified_last_pr(self, profiles, dates):
        profiles.return_value = [SimpleNamespace(id=1, start_date=date(2026, 1, 1), programme_status="Active")]
        payload = {"learners": [{"id": "1", "lastPr": "2026-09-10", "lastProgressReview": "10 Sep 2026"}],
                   "readModel": {"version": 19}}
        result = CoachDashboardService("coach@example.invalid").normalize_start_dates(payload)
        self.assertIsNone(result["learners"][0]["lastPr"])
        self.assertEqual(result["learners"][0]["lastProgressReview"], "--")
        self.assertEqual(payload["learners"][0]["lastPr"], "2026-09-10")
        self.assertEqual(dates.call_args.kwargs["owner_email"], "coach@example.invalid")
