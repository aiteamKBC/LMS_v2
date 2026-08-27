"""The module delivery window shown on the learning plan.

The window belongs to the module (curriculum.modules start_date/end_date, set
where the module is scheduled), so the plan must re-read it like it re-reads
hours — never take it from the saved jsonb, which is a snapshot from whenever
the plan was agreed. These cover that, the empty-window case, and the one
exception: a module no longer in the catalogue, whose snapshot is all there is.
"""
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .learning_plan import _module_payload, learning_plan

MODULE_ROWS = [
    {
        "module_catalogue_id": "MOD-1",
        "title": "Customer Journey Optimisation",
        "group_name": "G1",
        "programme_name": "MBA",
        "total_otjh": 7,
        "start_date": date(2026, 9, 1),
        "end_date": date(2026, 10, 15),
    },
    {
        "module_catalogue_id": "MOD-2",
        "title": "Strategic Finance",
        "group_name": "G1",
        "programme_name": "MBA",
        "total_otjh": 5,
        # Never scheduled — the common case for bulk-imported modules.
        "start_date": None,
        "end_date": None,
    },
]


def _learner(plan=None):
    return SimpleNamespace(
        id=19,
        pk=19,
        username="test Lesrer mba",
        programme="MBA",
        cohort="C1",
        group="G1",
        programme_status="Delivery",
        learning_plan=plan,
        save=Mock(),
    )


class ModuleWindowTests(SimpleTestCase):
    def _call(self, learner, method="GET", body=None):
        factory = RequestFactory()
        url = "/learner_api/learning-plan/19/"
        if method == "GET":
            request = factory.get(url)
        else:
            request = factory.patch(url, data=json.dumps(body), content_type="application/json")

        catalogue = [_module_payload(row) for row in MODULE_ROWS]
        with patch("learner_api.learning_plan.EnrolmentUser") as model, \
                patch("learner_api.learning_plan._programme_modules", return_value=catalogue), \
                patch("learner_api.learning_plan._all_modules", return_value=catalogue), \
                patch("learner_api.learning_plan._group_module_ids", return_value=["MOD-1", "MOD-2"]):
            model.all_learners.get.return_value = learner
            response = learning_plan(request, 19)
        return response, json.loads(response.content)

    def test_a_date_column_becomes_an_iso_day(self):
        payload = _module_payload(MODULE_ROWS[0])

        self.assertEqual(payload["startDate"], "2026-09-01")
        self.assertEqual(payload["endDate"], "2026-10-15")

    def test_an_unscheduled_module_has_an_empty_window(self):
        payload = _module_payload(MODULE_ROWS[1])

        self.assertEqual(payload["startDate"], "")
        self.assertEqual(payload["endDate"], "")

    def test_the_preset_carries_each_module_window(self):
        _response, body = self._call(_learner())

        self.assertEqual(
            [(m["moduleId"], m["startDate"], m["endDate"]) for m in body["plan"]],
            [("MOD-1", "2026-09-01", "2026-10-15"), ("MOD-2", "", "")],
        )

    def test_a_saved_plan_shows_the_modules_current_window_not_its_snapshot(self):
        learner = _learner([
            {"moduleId": "MOD-1", "startDate": "2020-01-01", "endDate": "2020-02-01"},
        ])
        _response, body = self._call(learner)

        self.assertEqual(body["plan"][0]["startDate"], "2026-09-01")
        self.assertEqual(body["plan"][0]["endDate"], "2026-10-15")

    def test_an_orphaned_entry_falls_back_to_its_saved_window(self):
        learner = _learner([
            {"moduleId": "RETIRED", "moduleTitle": "Retired", "hours": 3,
             "startDate": "2026-01-05", "endDate": "2026-02-05"},
        ])
        _response, body = self._call(learner)

        self.assertTrue(body["plan"][0]["orphaned"])
        self.assertEqual(body["plan"][0]["startDate"], "2026-01-05")
        self.assertEqual(body["plan"][0]["endDate"], "2026-02-05")

    def test_saving_stores_the_catalogue_window(self):
        learner = _learner()
        response, _body = self._call(learner, "PATCH", {"modules": [{"moduleId": "MOD-1"}]})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(learner.learning_plan[0]["startDate"], "2026-09-01")
        self.assertEqual(learner.learning_plan[0]["endDate"], "2026-10-15")
