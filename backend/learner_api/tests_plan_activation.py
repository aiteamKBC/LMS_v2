"""Agreeing a plan is the last thing a commercial learner waits for.

Their progression is date-driven: past their start date, with a plan assigned,
they are Active. The plan is normally the last of those to arrive — so the save
that assigns it has to re-run the check, or the learner sits in Delivery until
some unrelated edit happens to run it for them. See learner_progression.
"""
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .learning_plan import learning_plan

CATALOGUE = [
    {
        "moduleId": "MOD-1",
        "moduleTitle": "Module 1",
        "groupName": "Aya Group",
        "programmeName": "Final Test",
        "hours": 7.0,
        "startDate": "",
        "endDate": "",
    },
]


def _learner():
    return SimpleNamespace(
        id=101,
        pk=101,
        username="Aya Aya Test",
        programme="Final Test",
        cohort="Final Cohort",
        group="Aya Group",
        programme_status="Delivery",
        learning_plan=None,
        save=Mock(),
    )


class PlanSaveAdvancesLearnerTests(SimpleTestCase):
    def _patch(self, learner, body):
        request = RequestFactory().patch(
            "/learner_api/learning-plan/101/",
            data=json.dumps(body),
            content_type="application/json",
        )
        with patch("learner_api.learning_plan.advance_learner") as advance, \
                patch("learner_api.learning_plan.EnrolmentUser") as model, \
                patch("learner_api.learning_plan._programme_modules", return_value=CATALOGUE), \
                patch("learner_api.learning_plan._all_modules", return_value=CATALOGUE), \
                patch("learner_api.learning_plan._group_module_ids", return_value=[]), \
                patch("learner_api.learning_plan._serialize", return_value={}):
            model.all_learners.get.return_value = learner
            response = learning_plan(request, 101)
        return response, advance

    def test_saving_a_plan_re_runs_progression(self):
        learner = _learner()

        response, advance = self._patch(learner, {"modules": [{"moduleId": "MOD-1"}]})

        self.assertEqual(response.status_code, 200)
        advance.assert_called_once_with(learner)

    def test_a_rejected_save_does_not_advance_anyone(self):
        learner = _learner()

        response, advance = self._patch(learner, {"modules": [{"moduleId": "MOD-ELSEWHERE"}]})

        self.assertEqual(response.status_code, 400)
        advance.assert_not_called()

    def test_reading_a_plan_advances_nobody(self):
        # A GET is not a change; progression runs on writes.
        learner = _learner()
        request = RequestFactory().get("/learner_api/learning-plan/101/")
        with patch("learner_api.learning_plan.advance_learner") as advance, \
                patch("learner_api.learning_plan.EnrolmentUser") as model, \
                patch("learner_api.learning_plan._programme_modules", return_value=CATALOGUE), \
                patch("learner_api.learning_plan._all_modules", return_value=CATALOGUE), \
                patch("learner_api.learning_plan._group_module_ids", return_value=[]), \
                patch("learner_api.learning_plan._serialize", return_value={}):
            model.all_learners.get.return_value = learner
            learning_plan(request, 101)

        advance.assert_not_called()
