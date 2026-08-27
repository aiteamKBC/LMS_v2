"""Cohort-mates of a module — the options offered when shifting a learner.

The point of these is the walk outwards from a module to its cohort. All three
link shapes exist in the data (a module naming its cohort, a module naming only
its group, and a module named only by a group's `module_ids`), so each gets a
test — a missed shape shows up as an empty picker, not an error.
"""
import json
from contextlib import nullcontext
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import module_shift

# Two groups in one cohort, plus a group in another cohort that must not leak in.
GROUPS = [
    {
        "group_id": "G-1",
        "group_name": "G1 T",
        "cohort_id": "COH-1",
        "cohort_name": "25/8/26",
        "module_ids": ["MOD-LISTED"],
    },
    {
        "group_id": "G-2",
        "group_name": "G2 T",
        "cohort_id": "COH-1",
        "cohort_name": "25/8/26",
        # Text rather than jsonb: older rows are written that way.
        "module_ids": json.dumps(["MOD-TEXT-LISTED"]),
    },
    {
        "group_id": "G-9",
        "group_name": "Other",
        "cohort_id": "COH-OTHER",
        "cohort_name": "Feb 2026",
        "module_ids": [],
    },
]

MODULES = {
    # Names its cohort outright — a module authored in the curriculum tree.
    "MOD-1": {
        "module_catalogue_id": "MOD-1",
        "title": "Module 1 T",
        "group_name": "G1 T",
        "programme_name": "Test 25/8",
        "total_otjh": 7,
        "start_date": date(2025, 10, 1),
        "end_date": date(2026, 2, 4),
        "cohort_id": "COH-1",
        "cohort_name": "25/8/26",
        "group_id": "G-1",
    },
    # Names only its group; the cohort has to come from the group.
    "MOD-GROUP-ONLY": {
        "module_catalogue_id": "MOD-GROUP-ONLY",
        "title": "Group only",
        "group_name": "G2 T",
        "programme_name": "Test 25/8",
        "total_otjh": 3,
        "start_date": None,
        "end_date": None,
        "cohort_id": None,
        "cohort_name": None,
        "group_id": "G-2",
    },
    # Names neither; only a group's module_ids ties it to anything.
    "MOD-LISTED": {
        "module_catalogue_id": "MOD-LISTED",
        "title": "Listed by a group",
        "group_name": None,
        "programme_name": "Test 25/8",
        "total_otjh": 5,
        "start_date": None,
        "end_date": None,
        "cohort_id": None,
        "cohort_name": None,
        "group_id": None,
    },
    # Unlinked entirely — the bulk-imported case.
    "MOD-LOOSE": {
        "module_catalogue_id": "MOD-LOOSE",
        "title": "Nathan - Customer Journey Optimisation",
        "group_name": None,
        "programme_name": "MBA",
        "total_otjh": 7,
        "start_date": None,
        "end_date": None,
        "cohort_id": None,
        "cohort_name": None,
        "group_id": None,
    },
}


def _fake_rows(sql, params):
    """Stand in for the queries module_shift makes, by shape of SQL."""
    if "FROM curriculum.weeks" in sql:
        # These fixtures carry no weeks: nothing here maps progress.
        return []
    if "FROM curriculum.groups" in sql:
        return [dict(g) for g in GROUPS]
    if "WHERE module_catalogue_id = %s" in sql:
        row = MODULES.get(params[0])
        return [dict(row)] if row else []
    # The cohort collection: cohort_id, group ids, listed ids.
    cohort_id, group_ids, listed_ids = params
    return [
        dict(m)
        for m in MODULES.values()
        if m["cohort_id"] == cohort_id
        or (m["group_id"] and m["group_id"] in group_ids)
        or m["module_catalogue_id"] in listed_ids
    ]


class ModuleShiftOptionTests(SimpleTestCase):
    def _call(self, module_id=None):
        query = {"moduleId": module_id} if module_id is not None else {}
        request = RequestFactory().get("/learner_api/module-shift/options/", query)
        with patch("learner_api.module_shift._rows", side_effect=_fake_rows):
            response = module_shift.module_shift_options(request)
        return response, json.loads(response.content)

    def test_a_module_naming_its_cohort_finds_the_cohorts_modules(self):
        _response, body = self._call("MOD-1")

        self.assertEqual(body["cohort"]["name"], "25/8/26")
        self.assertEqual(body["groups"], ["G1 T", "G2 T"])
        self.assertEqual(
            sorted(m["moduleId"] for m in body["modules"]),
            ["MOD-1", "MOD-GROUP-ONLY", "MOD-LISTED"],
        )
        # Another cohort's group is not searched.
        self.assertNotIn("Other", body["groups"])

    def test_a_module_naming_only_its_group_resolves_through_the_group(self):
        _response, body = self._call("MOD-GROUP-ONLY")

        self.assertEqual(body["cohort"]["id"], "COH-1")
        self.assertIn("MOD-1", [m["moduleId"] for m in body["modules"]])

    def test_a_module_named_only_by_a_groups_module_ids_still_resolves(self):
        _response, body = self._call("MOD-LISTED")

        self.assertEqual(body["cohort"]["id"], "COH-1")
        self.assertIn("MOD-1", [m["moduleId"] for m in body["modules"]])

    def test_options_carry_the_window_and_hours_the_picker_shows(self):
        _response, body = self._call("MOD-1")
        first = next(m for m in body["modules"] if m["moduleId"] == "MOD-1")

        self.assertEqual(first["hours"], 7.0)
        self.assertEqual(first["startDate"], "2025-10-01")
        self.assertEqual(first["endDate"], "2026-02-04")

    def test_an_unlinked_module_explains_itself_rather_than_failing(self):
        response, body = self._call("MOD-LOOSE")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["modules"], [])
        self.assertIn("not linked to a group or cohort", body["reason"])

    def test_a_module_missing_from_the_catalogue_explains_itself(self):
        response, body = self._call("MOD-GONE")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["modules"], [])
        self.assertIn("no longer in the curriculum", body["reason"])

    def test_a_missing_module_id_is_a_client_error(self):
        response, body = self._call()

        self.assertEqual(response.status_code, 400)
        self.assertIn("moduleId", body["error"])

    def test_only_get_is_allowed(self):
        request = RequestFactory().post("/learner_api/module-shift/options/")
        response = module_shift.module_shift_options(request)

        self.assertEqual(response.status_code, 405)


def _learner(plan=None, programme="Test 25/8", group="G1 T"):
    return SimpleNamespace(
        id=62,
        pk=62,
        username="Ayman Badewi",
        programme=programme,
        cohort="25/8/26",
        group=group,
        programme_status="Active",
        learning_plan=plan,
        save=Mock(),
    )


class ModuleShiftWriteTests(SimpleTestCase):
    """Moving a learner between modules.

    The write deliberately does not go through the learning-plan endpoint: it
    keeps every entry it did not move exactly as stored, so a learner part-way
    through delivery whose plan holds a since-retired module can still be moved.
    """

    def _shift(self, learner, body, preset=()):
        request = RequestFactory().patch(
            "/learner_api/module-shift/62/",
            data=json.dumps(body),
            content_type="application/json",
        )
        # The plan write is wrapped in a transaction and followed by the two
        # derived-data refreshes; none of the three has a database here.
        with (
            patch("learner_api.module_shift._rows", side_effect=_fake_rows),
            patch("learner_api.module_shift.EnrolmentUser") as model,
            patch("learner_api.module_shift.transaction.atomic",
                  side_effect=lambda **kwargs: nullcontext()),
            patch("learner_api.module_shift.sync_active_user") as sync,
            patch("learner_api.module_shift.recompute_completed_hours"),
            patch("learner_api.module_shift._programme_modules",
                  return_value=[module_shift._module_payload(m) for m in MODULES.values()]),
            patch("learner_api.module_shift._group_module_ids", return_value=list(preset)),
            patch("learner_api.module_shift._serialize",
                  side_effect=lambda learner_row: {"plan": learner_row.learning_plan}),
        ):
            model.all_learners.get.return_value = learner
            response = module_shift.module_shift(request, 62)
            self.sync = sync
        return response, json.loads(response.content)

    def test_the_chosen_entry_is_replaced_and_the_rest_kept_verbatim(self):
        # One real module, one whose module has left the curriculum — the shape a
        # learner mid-delivery actually has.
        orphan = {"moduleId": "MOD-GONE", "moduleTitle": "Retired", "hours": 4, "weeks": 6}
        learner = _learner([{"moduleId": "MOD-1", "moduleTitle": "Module 1 T"}, orphan])

        response, _body = self._shift(learner, {"fromModuleId": "MOD-1", "toModuleId": "MOD-LISTED"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [m.get("moduleId") for m in learner.learning_plan],
            ["MOD-LISTED", "MOD-GONE"],
        )
        # Untouched entries keep even the keys this shape no longer uses.
        self.assertEqual(learner.learning_plan[1], orphan)
        # The shifted-in entry is rebuilt from the catalogue, not from the client.
        self.assertEqual(learner.learning_plan[0]["moduleTitle"], "Listed by a group")
        self.assertEqual(learner.learning_plan[0]["hours"], 5.0)

    def test_a_learner_with_no_saved_plan_shifts_within_their_group_preset(self):
        learner = _learner(None)

        response, _body = self._shift(
            learner,
            {"fromModuleId": "MOD-1", "toModuleId": "MOD-LISTED"},
            preset=["MOD-1", "MOD-GROUP-ONLY"],
        )

        self.assertEqual(response.status_code, 200)
        # The preset is saved along with the move — agreeing to it is implicit in
        # moving within it.
        self.assertEqual(
            [m["moduleId"] for m in learner.learning_plan],
            ["MOD-LISTED", "MOD-GROUP-ONLY"],
        )

    def test_a_module_outside_the_cohort_is_refused(self):
        learner = _learner([{"moduleId": "MOD-1"}])

        response, body = self._shift(learner, {"fromModuleId": "MOD-1", "toModuleId": "MOD-OTHER-COHORT"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("not taught to", body["error"])
        learner.save.assert_not_called()

    def test_shifting_onto_a_module_the_learner_already_has_is_refused(self):
        learner = _learner([{"moduleId": "MOD-1"}, {"moduleId": "MOD-LISTED"}])

        response, body = self._shift(learner, {"fromModuleId": "MOD-1", "toModuleId": "MOD-LISTED"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("already on this learner's plan", body["error"])
        learner.save.assert_not_called()

    def test_shifting_from_a_module_the_learner_does_not_have_is_refused(self):
        learner = _learner([{"moduleId": "MOD-LISTED"}])

        response, body = self._shift(learner, {"fromModuleId": "MOD-1", "toModuleId": "MOD-GROUP-ONLY"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("not on this learner's plan", body["error"])
        learner.save.assert_not_called()

    def test_a_module_with_no_cohort_cannot_be_shifted_from(self):
        learner = _learner([{"moduleId": "MOD-LOOSE"}])

        response, body = self._shift(learner, {"fromModuleId": "MOD-LOOSE", "toModuleId": "MOD-1"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("not linked to a group or cohort", body["error"])
        learner.save.assert_not_called()

    def test_the_same_module_twice_is_refused_before_any_lookup(self):
        learner = _learner([{"moduleId": "MOD-1"}])

        response, body = self._shift(learner, {"fromModuleId": "MOD-1", "toModuleId": "MOD-1"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("different module", body["error"])

    def test_both_ids_are_required(self):
        learner = _learner([{"moduleId": "MOD-1"}])

        response, body = self._shift(learner, {"fromModuleId": "MOD-1"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("required", body["error"])

    def test_an_active_learners_delivery_record_is_refreshed(self):
        # Their own workspace reads the materialised plan, not this list.
        learner = _learner([{"moduleId": "MOD-1"}])

        self._shift(learner, {"fromModuleId": "MOD-1", "toModuleId": "MOD-LISTED"})

        self.sync.assert_called_once_with(learner)

    def test_a_get_is_not_a_shift(self):
        request = RequestFactory().get("/learner_api/module-shift/62/")
        response = module_shift.module_shift(request, 62)

        self.assertEqual(response.status_code, 405)
