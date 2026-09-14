"""Group membership changes reaching a plan that was already agreed.

A saved plan used to be a closed list: adding a module to the group taught
every *unsaved* learner (they are shown the preset live) and no saved one, so
the same group could be taught two different module sets depending on whether
anyone had opened the modal. These cover the rule that closes that gap and,
just as importantly, the two things it must not do.

The rule is additive. A module the group gained joins the plan; a module the
group *lost* stays on it, because a plan records what was agreed and may carry
progress -- dropping it is the deliberate per-learner act the modal confirms.
An emptied plan stays empty, since emptying one is how staff say this learner
is taught none of their group's modules.
"""
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .learning_plan import _effective_plan_ids, _module_payload, learning_plan

MODULE_ROWS = [
    {
        "module_catalogue_id": "MOD-1", "title": "Agreed module", "group_name": "G1",
        "programme_name": "MBA", "total_otjh": 7, "start_date": None, "end_date": None,
    },
    {
        "module_catalogue_id": "MOD-2", "title": "Added to the group later", "group_name": "G1",
        "programme_name": "MBA", "total_otjh": 5, "start_date": None, "end_date": None,
    },
]


def _learner(plan=None):
    return SimpleNamespace(
        id=19, pk=19, username="Learner", programme="MBA", cohort="C1", group="G1",
        programme_status="Delivery", learning_plan=plan, training_plan=None, save=Mock(),
    )


class GroupSyncTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(
            patch("login.permissions.authenticate_request", return_value=SimpleNamespace(role="admin")),
        )

    def _get(self, learner, preset):
        catalogue = [_module_payload(row) for row in MODULE_ROWS]
        request = RequestFactory().get("/learner_api/learning-plan/19/")
        with patch("learner_api.learning_plan.EnrolmentUser") as model, \
                patch("learner_api.learning_plan._programme_modules", return_value=catalogue), \
                patch("learner_api.learning_plan._all_modules", return_value=catalogue), \
                patch("learner_api.learning_plan._group_module_ids", return_value=preset):
            model.all_learners.get.return_value = learner
            response = learning_plan(request, 19)
        return json.loads(response.content)

    def test_a_module_added_to_the_group_joins_an_already_agreed_plan(self):
        # The plan was agreed when the group taught MOD-1 alone.
        body = self._get(_learner([{"moduleId": "MOD-1"}]), ["MOD-1", "MOD-2"])

        self.assertEqual([m["moduleId"] for m in body["plan"]], ["MOD-1", "MOD-2"])
        # Appended, so the order staff chose is untouched and the new module is
        # flagged rather than passed off as something they picked.
        self.assertNotIn("inherited", body["plan"][0])
        self.assertIs(body["plan"][1]["inherited"], True)
        self.assertEqual(body["inheritedCount"], 1)

    def test_the_inherited_module_counts_towards_the_hours_being_agreed(self):
        body = self._get(_learner([{"moduleId": "MOD-1"}]), ["MOD-1", "MOD-2"])

        self.assertEqual(body["totals"], {"moduleCount": 2, "totalHours": 12})

    def test_an_inherited_module_is_not_also_offered_by_the_picker(self):
        body = self._get(_learner([{"moduleId": "MOD-1"}]), ["MOD-1", "MOD-2"])

        self.assertEqual([m["moduleId"] for m in body["available"]], [])

    def test_a_module_dropped_from_the_group_stays_on_the_agreed_plan(self):
        # MOD-1 is no longer taught by the group; it may already carry progress.
        body = self._get(_learner([{"moduleId": "MOD-1"}]), ["MOD-2"])

        self.assertEqual([m["moduleId"] for m in body["plan"]], ["MOD-1", "MOD-2"])

    def test_an_emptied_plan_is_not_refilled_from_the_group(self):
        body = self._get(_learner([]), ["MOD-1", "MOD-2"])

        self.assertEqual(body["plan"], [])
        self.assertEqual(body["inheritedCount"], 0)

    def test_nothing_is_inherited_when_the_plan_already_matches_the_group(self):
        body = self._get(_learner([{"moduleId": "MOD-1"}, {"moduleId": "MOD-2"}]), ["MOD-1", "MOD-2"])

        self.assertEqual(body["inheritedCount"], 0)
        self.assertTrue(all("inherited" not in m for m in body["plan"]))

    def test_an_unsaved_learner_still_simply_shows_the_preset(self):
        body = self._get(_learner(None), ["MOD-1", "MOD-2"])

        self.assertEqual([m["moduleId"] for m in body["plan"]], ["MOD-1", "MOD-2"])
        self.assertFalse(body["saved"])
        # Nothing is "inherited" here: none of it was ever agreed to begin with.
        self.assertEqual(body["inheritedCount"], 0)


class ModulePickerAgreesWithThePlanTests(SimpleTestCase):
    """The module-side reader has to apply the same rule, or the two disagree."""

    def test_a_module_inherited_from_the_group_reads_as_assigned(self):
        learner = _learner([{"moduleId": "MOD-1"}])
        with patch("learner_api.learning_plan._group_module_ids", return_value=["MOD-1", "MOD-2"]):
            self.assertEqual(_effective_plan_ids(learner, {}), ["MOD-1", "MOD-2"])

    def test_an_emptied_plan_reads_as_assigned_to_nothing(self):
        with patch("learner_api.learning_plan._group_module_ids") as preset:
            self.assertEqual(_effective_plan_ids(_learner([]), {}), [])
        # Not merely empty -- the group is never consulted for an emptied plan.
        preset.assert_not_called()
