"""All recorded activities remain visible independently of the Main-only review."""
from copy import deepcopy
from inspect import unwrap
import json
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from coach_api.dashboard_view import coach_dashboard_section
from coach_api.services.dashboard.sections import all_learners, project_section, paginate_learners
from coach_api.services.dashboard.service import CoachDashboardService


class DashboardRecordCountsTests(SimpleTestCase):
    def setUp(self):
        overlay = patch('coach_api.activity_plan_snapshots.attach_snapshots')
        overlay.start()
        self.addCleanup(overlay.stop)
        self.learner = {
            "id": "7", "name": "Synthetic learner", "learnerType": "apprenticeship",
            "enrolmentId": "107", "rawProgramStatus": "Active",
            "componentsCompleted": 9, "componentsPlanned": 9,
            "activityProgress": 100, "activityProgressAvailable": True,
            "otjhCompleted": 12, "otjhPlanned": 100, "otjhTargetAsOfToday": 15,
            "otjhProgressAsOfToday": 80, "otjhRagStatus": "on-track",
        }
        self.main = dict(mainActivitiesCompleted=3, mainActivitiesPlanned=12,
                         mainActivitiesProgress=25, mainActivitiesProgressAvailable=True)
        self.expected = {"completed": 9, "total": 9, "progress": 100}

    def test_section_and_wire_use_all_records_even_with_old_main_fields(self):
        for available in (True, False):
            with self.subTest(main_available=available):
                original = {"learners": [{**self.learner, **self.main,
                                         "mainActivitiesProgressAvailable": available}]}
                before = deepcopy(original)
                row = all_learners(project_section(original, "learners"))["results"][0]
                self.assertEqual(row["activities"], self.expected)
                self.assertEqual(row["otjh"], {"completed": 12, "planned": 100, "targetToDate": 15,
                                              "progress": 80, "ragStatus": "on-track"})
                self.assertEqual((row["learnerType"], row["enrolmentId"]), ("apprenticeship", "107"))
                self.assertEqual(original, before)

    def test_sort_uses_record_ratio_and_keeps_unknown_last(self):
        payload = {"learners": [{**self.learner, **self.main},
            {**self.learner, **self.main, "id": "8", "componentsCompleted": 3,
             "componentsPlanned": 12, "activityProgress": 25, "mainActivitiesProgress": 75},
            {**self.learner, "id": "9", "componentsCompleted": None,
             "componentsPlanned": None, "activityProgressAvailable": False}]}
        for direction, expected in (("asc", ["8", "7", "9"]), ("desc", ["7", "8", "9"])):
            result = paginate_learners(payload, page=1, page_size=10, search="", cohort="all", status="all",
                                       otjh_status="all", sort="components", direction=direction)
            self.assertEqual([row["id"] for row in result["results"]], expected)

    def test_unavailable_records_are_not_replaced_by_main_counts(self):
        learner = {**self.learner, **self.main, "componentsCompleted": None,
                   "componentsPlanned": None, "activityProgressAvailable": False}
        self.assertEqual(all_learners({"learners": [learner]})["results"][0]["activities"],
                         {"completed": None, "total": None, "progress": None})

    def test_zero_completed_records_stays_zero(self):
        learner = {**self.learner, **self.main, "componentsCompleted": 0, "activityProgress": 0}
        self.assertEqual(all_learners({"learners": [learner]})["results"][0]["activities"],
                         {"completed": 0, "total": 9, "progress": 0})

    def test_cold_and_warm_endpoint_show_records_before_background_refresh(self):
        for cached in (False, True):
            for version in (21, 22, CoachDashboardService.SCHEMA_VERSION):
                with self.subTest(cached=cached, version=version):
                    payload = {"learners": [{**self.learner, **self.main}],
                               "readModel": {"version": version}}
                    request = RequestFactory().get("/coach_api/coach/dashboard/learners")
                    request.coach_email = "coach@example.invalid"
                    with patch("coach_api.dashboard_view.dashboard_cache.get_cached_dashboard_section", return_value=payload if cached else None), \
                         patch("coach_api.dashboard_view.dashboard_cache.cache_dashboard_section"), \
                         patch("coach_api.dashboard_view.load_section", return_value=payload), \
                         patch.object(CoachDashboardService, "normalize_start_dates", side_effect=lambda value, **kw: value), \
                         patch("coach_api.dashboard_view.schedule_coach_dashboard_refresh"), \
                         patch("learner_api.review_activity_facts.dashboard_activity_facts") as catalogues:
                        response = unwrap(coach_dashboard_section)(request, "learners")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(json.loads(response.content)["results"][0]["activities"], self.expected)
                    catalogues.assert_not_called()
