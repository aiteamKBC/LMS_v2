"""Adding a module from a programme other than the learner's own.

    python manage.py test learner_api.tests_learning_plan_programmes

The plan used to be confined to the learner's programme, and a save that named a
module from anywhere else was refused. That confinement is lifted: the picker
offers the whole catalogue behind a programme dropdown, so the save side has to
accept the whole catalogue too — a module a client can be shown has to be a
module the server will take.

What must not be lost with it: a borrowed module maps to different KSBs and sits
under different funding, so every module keeps the programme it came from, and a
module id that is in no programme at all is still refused.
"""
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .learning_plan import _module_payload, _programmes, learning_plan

OWN_PROGRAMME = "PROG-MBA"
OTHER_PROGRAMME = "PROG-PCP"

CATALOGUE_ROWS = [
    {
        "module_catalogue_id": "MOD-OWN-1", "title": "Customer Journey Optimisation",
        "group_name": "G1", "programme_id": OWN_PROGRAMME, "programme_name": "MBA",
        "total_otjh": 7, "start_date": None, "end_date": None,
    },
    {
        "module_catalogue_id": "MOD-OWN-2", "title": "Strategic Finance",
        "group_name": "G1", "programme_id": OWN_PROGRAMME, "programme_name": "MBA",
        "total_otjh": 5, "start_date": None, "end_date": None,
    },
    {
        "module_catalogue_id": "MOD-OTHER-1", "title": "Project Controls",
        "group_name": "PCP-A", "programme_id": OTHER_PROGRAMME,
        "programme_name": "Project Controls Professional",
        "total_otjh": 12, "start_date": None, "end_date": None,
    },
]
CATALOGUE = [_module_payload(row) for row in CATALOGUE_ROWS]
OWN_ONLY = [m for m in CATALOGUE if m["programmeId"] == OWN_PROGRAMME]


def _learner(plan=None):
    return SimpleNamespace(
        id=19, pk=19, username="test learner", programme="MBA", cohort="C1",
        group="G1", programme_status="Delivery", learning_plan=plan, save=Mock(),
    )


class LearningPlanProgrammeTests(SimpleTestCase):
    def _call(self, learner, method="GET", body=None):
        factory = RequestFactory()
        url = "/learner_api/learning-plan/19/"
        request = (
            factory.get(url) if method == "GET"
            else factory.patch(url, data=json.dumps(body), content_type="application/json")
        )
        with patch("learner_api.learning_plan.EnrolmentUser") as model, \
                patch("learner_api.learning_plan._programme_modules", return_value=OWN_ONLY), \
                patch("learner_api.learning_plan._all_modules", return_value=CATALOGUE), \
                patch("learner_api.learning_plan._group_module_ids", return_value=["MOD-OWN-1"]):
            model.all_learners.get.return_value = learner
            response = learning_plan(request, 19)
        return response, json.loads(response.content)

    # -- what the picker is offered -----------------------------------------

    def test_the_picker_is_offered_every_programmes_modules(self):
        _response, body = self._call(_learner())

        offered = {m["moduleId"] for m in body["available"]}
        self.assertEqual(offered, {"MOD-OWN-2", "MOD-OTHER-1"})  # OWN-1 is on the plan

    def test_the_programmes_are_listed_with_their_module_counts(self):
        _response, body = self._call(_learner())

        self.assertEqual(body["programmes"], [
            {"programmeId": OWN_PROGRAMME, "programmeName": "MBA", "moduleCount": 2},
            {"programmeId": OTHER_PROGRAMME,
             "programmeName": "Project Controls Professional", "moduleCount": 1},
        ])

    def test_the_learners_own_programme_is_named_so_the_picker_can_open_on_it(self):
        _response, body = self._call(_learner())

        self.assertEqual(body["learner"]["programmeId"], OWN_PROGRAMME)

    def test_every_module_says_which_programme_it_belongs_to(self):
        """The plan has to be able to show a borrowed module as borrowed."""
        _response, body = self._call(_learner())

        by_id = {m["moduleId"]: m for m in body["available"]}
        self.assertEqual(by_id["MOD-OTHER-1"]["programmeId"], OTHER_PROGRAMME)
        self.assertEqual(by_id["MOD-OTHER-1"]["programmeName"], "Project Controls Professional")

    # -- what a save accepts ------------------------------------------------

    def test_a_module_from_another_programme_now_saves(self):
        learner = _learner()
        response, body = self._call(
            learner, "PATCH", {"modules": ["MOD-OWN-1", "MOD-OTHER-1"]},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual([m["moduleId"] for m in body["plan"]], ["MOD-OWN-1", "MOD-OTHER-1"])
        self.assertEqual(learner.learning_plan[1]["programmeName"], "Project Controls Professional")

    def test_the_saved_hours_come_from_the_catalogue_not_the_client(self):
        learner = _learner()
        _response, body = self._call(
            learner, "PATCH",
            {"modules": [{"moduleId": "MOD-OTHER-1", "hours": 999, "moduleTitle": "Spoofed"}]},
        )

        self.assertEqual(body["plan"][0]["hours"], 12)
        self.assertEqual(body["plan"][0]["moduleTitle"], "Project Controls")

    def test_a_module_in_no_programme_at_all_is_still_refused(self):
        response, body = self._call(_learner(), "PATCH", {"modules": ["MOD-NOPE"]})

        self.assertEqual(response.status_code, 400)
        self.assertIn("catalogue", body["error"].lower())

    def test_the_total_covers_modules_from_both_programmes(self):
        _response, body = self._call(
            _learner(), "PATCH", {"modules": ["MOD-OWN-1", "MOD-OTHER-1"]},
        )

        self.assertEqual(body["totals"]["moduleCount"], 2)
        self.assertEqual(body["totals"]["totalHours"], 19)


class ProgrammeListTests(SimpleTestCase):
    """_programmes is derived from the catalogue, so it can never over-promise."""

    def test_programmes_are_sorted_by_name_and_counted(self):
        self.assertEqual(_programmes(CATALOGUE), [
            {"programmeId": OWN_PROGRAMME, "programmeName": "MBA", "moduleCount": 2},
            {"programmeId": OTHER_PROGRAMME,
             "programmeName": "Project Controls Professional", "moduleCount": 1},
        ])

    def test_a_module_with_no_programme_is_left_out_rather_than_listed_blank(self):
        orphan = _module_payload({
            "module_catalogue_id": "MOD-X", "title": "Loose", "group_name": "",
            "programme_id": "", "programme_name": "", "total_otjh": 1,
            "start_date": None, "end_date": None,
        })
        self.assertEqual(_programmes([orphan]), [])

    def test_no_modules_means_no_programmes(self):
        self.assertEqual(_programmes([]), [])
