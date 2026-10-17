"""Moving a learner's progress when they are shifted between modules.

The pairing is by position — week 1 to week 1 — but which *component* a piece of
progress lands on is a human decision, so these cover the offer (which weeks and
components are shown, and what is suggested) and the write (what is moved and
what is archived).
"""
import json
from datetime import datetime, timezone as tz
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import learning_plan, module_shift

# Two modules built from the same shape: three components in week 1, one of
# which differs in type, plus a second week with none. Enough to exercise
# same-position pairing, type-based rescue, and an unpaired tail.
SOURCE_ROWS = [
    ("W-A1", 1, "Lec1", "C-A1", "video", "Recorded Session 1", 0.0),
    ("W-A1", 1, "Lec1", "C-A2", "reading", "Reading Material 2", 2.0),
    ("W-A1", 1, "Lec1", "C-A3", "powerpoint", "PowerPoint 3", 2.0),
    ("W-A1", 1, "Lec1", "C-A4", "video", "Recorded Session 2", 1.0),
    ("W-A2", 2, "Week 2", None, None, None, None),
]
TARGET_ROWS = [
    ("W-B1", 1, "Week 1", "C-B1", "video", "Recorded Session 1", 0.0),
    ("W-B1", 1, "Week 1", "C-B2", "reading", "Reading Material 2", 2.0),
    ("W-B1", 1, "Week 1", "C-B3", "powerpoint", "PowerPoint 3", 3.0),
    ("W-B1", 1, "Week 1", "C-B4", "video", "Recorded Session 2", 1.0),
    ("W-B2", 2, "Week 2", None, None, None, None),
]
MODULE_ROWS = {"MOD-A": SOURCE_ROWS, "MOD-B": TARGET_ROWS}


def _fake_rows(sql, params):
    """Only the weeks-and-components query is used by these paths."""
    assert "FROM curriculum.weeks" in sql, sql
    return [
        {
            "week_id": week_id,
            "week_number": number,
            "week_title": title,
            "component_id": comp_id,
            "type": comp_type,
            "component_title": comp_title,
            "expected_otjh": otjh,
        }
        for week_id, number, title, comp_id, comp_type, comp_title, otjh
        in MODULE_ROWS.get(params[0], [])
    ]


def _entry(component_ref, kind="component", **kwargs):
    """A progress row, with only the fields these paths read or write."""
    return SimpleNamespace(
        id=kwargs.get("id", 1),
        kind=kind,
        component_ref=component_ref,
        legacy_component_ref=kwargs.get("legacy_component_ref", ""),
        programme_ref="PROG-1",
        programme_title="Test 25/8",
        module_ref="MOD-A",
        module_title="Shift 1",
        week_ref="W-A1",
        week_title="Lec1",
        group_ref="G-1",
        group_title="G1 T",
        cohort_ref="COH-1",
        cohort_title="25/8/26",
        component_title=kwargs.get("component_title", "Reading Material 2"),
        component_type=kwargs.get("component_type", "reading"),
        expected_otjh=2,
        points=15,
        grade=kwargs.get("grade"),
        attempt=kwargs.get("attempt"),
        submitted_at=kwargs.get("submitted_at", datetime(2026, 8, 26, 11, 48, tzinfo=tz.utc)),
        started_at=None,
        save=Mock(),
    )


def _review_cursor(rows=(), conflict=False):
    """A cursor for the reflection SQL: the lookup, the conflict probe, the update.

    fetchall answers the "which submissions point at this component" query;
    fetchone answers "does the target already have one of its own".
    """
    cursor = Mock()
    cursor.__enter__ = Mock(return_value=cursor)
    cursor.__exit__ = Mock(return_value=False)
    cursor.fetchall.return_value = list(rows)
    cursor.fetchone.return_value = (1,) if conflict else None
    return cursor


TARGET_CONTEXT = {
    "moduleId": "MOD-B",
    "moduleTitle": "Shift 2",
    "weekId": "W-B1",
    "weekTitle": "Week 1",
    "groupId": "G-2",
    "group": "G2 T",
    "cohortId": "COH-1",
    "cohort": "25/8/26",
    "componentTitle": "shift ppt",
    "componentType": "powerpoint",
    "expectedOtjh": 3,
    "points": 20,
    "ksbMappings": [{"code": "k2", "description": "Second", "classification": "main", "weight": 1}],
}


class PairingCase:
    """The pairing view under one learner, with progress and reviews stubbed."""

    def setUp(self):
        super().setUp()
        self.enterContext(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='admin')))
        self.enterContext(patch('learner_api.module_shift._quiz_component_slots', return_value=[]))

    def _call(self, entries, reviews=(), **query):
        params = {"from": "MOD-A", "to": "MOD-B"}
        params.update(query)
        request = RequestFactory().get("/learner_api/module-shift/62/progress/", params)
        queryset = Mock()
        queryset.exclude.return_value = entries
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchall.return_value = list(reviews)
        with patch("learner_api.module_shift._rows", side_effect=_fake_rows), \
                patch("learner_api.module_shift.EnrolmentUser") as model, \
                patch("learner_api.module_shift.learner_profile_for_source",
                      return_value=SimpleNamespace(id=211)), \
                patch("learner_api.module_shift.connections",
                      {"enrolment": SimpleNamespace(cursor=lambda: cursor)}), \
                patch("learner_api.module_shift.LearnerProgressEntry") as entry_model:
            model.all_learners.get.return_value = SimpleNamespace(pk=62)
            entry_model.objects.filter.return_value = queryset
            response = module_shift.module_shift_progress(request, 62)
        return response, json.loads(response.content)


class ProgressPairingTests(PairingCase, SimpleTestCase):
    def test_only_weeks_with_progress_are_offered(self):
        _response, body = self._call([_entry("C-A2")])

        self.assertEqual([w["order"] for w in body["weeks"]], [1])
        self.assertEqual(body["weeks"][0]["from"]["title"], "Lec1")
        # The paired week comes from the same position in the other module.
        self.assertEqual(body["weeks"][0]["to"]["weekId"], "W-B1")

    def test_a_week_shows_every_component_and_marks_the_progressed_ones(self):
        _response, body = self._call([_entry("C-A2")])
        components = body["weeks"][0]["from"]["components"]

        self.assertEqual(
            [c["componentId"] for c in components], ["C-A1", "C-A2", "C-A3", "C-A4"],
        )
        self.assertIsNone(components[0]["progress"])
        self.assertEqual(components[1]["progress"]["entries"], 1)
        self.assertEqual(components[1]["progress"]["kinds"], ["component"])
        self.assertEqual(body["progressedComponents"], 1)

    def test_repeated_attempts_on_one_component_count_together(self):
        _response, body = self._call([
            _entry("C-A2", id=1),
            _entry("C-A2", id=2, submitted_at=datetime(2026, 8, 27, 9, 0, tzinfo=tz.utc)),
        ])
        progress = body["weeks"][0]["from"]["components"][1]["progress"]

        self.assertEqual(progress["entries"], 2)
        self.assertTrue(progress["lastAt"].startswith("2026-08-27"))

    def test_each_progressed_component_is_suggested_a_pair(self):
        _response, body = self._call([_entry("C-A1", kind="video"), _entry("C-A3", id=2)])

        self.assertEqual(
            body["suggested"],
            [
                {"fromComponentId": "C-A1", "toComponentId": "C-B1"},
                {"fromComponentId": "C-A3", "toComponentId": "C-B3"},
            ],
        )

    def test_no_progress_says_so_rather_than_offering_an_empty_pairing(self):
        response, body = self._call([])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["weeks"], [])
        self.assertIn("no recorded progress", body["reason"])

    def test_both_module_ids_are_required(self):
        request = RequestFactory().get("/learner_api/module-shift/62/progress/", {"from": "MOD-A"})
        response = module_shift.module_shift_progress(request, 62)

        self.assertEqual(response.status_code, 400)


class SuggestedPairTests(SimpleTestCase):
    """Suggestions use identity, then an exact cleaned title and type."""

    def setUp(self):
        with patch("learner_api.module_shift._rows", side_effect=_fake_rows):
            self.target = module_shift._weeks_with_components("MOD-B")[0]

    def test_same_cleaned_title_and_type_are_suggested(self):
        component = {
            "componentId": "C-A2", "type": "reading",
            "title": "  READING\u00a0material 2 ",
        }

        self.assertEqual(module_shift._suggested_pair(component, self.target), "C-B2")

    def test_same_position_and_type_do_not_override_a_different_title(self):
        component = {"componentId": "C-A9", "type": "video", "title": "Different lesson"}

        self.assertEqual(module_shift._suggested_pair(component, self.target), "")

    def test_same_id_wins_even_when_the_title_changed(self):
        component = {"componentId": "C-B4", "type": "video", "title": "Old title"}

        self.assertEqual(module_shift._suggested_pair(component, self.target), "C-B4")

    def test_an_already_claimed_target_is_not_suggested_twice(self):
        component = {"componentId": "C-A2", "type": "reading", "title": "Reading Material 2"}

        self.assertEqual(module_shift._suggested_pair(component, self.target, {"C-B2"}), "")

    def test_ambiguous_title_is_left_unmatched(self):
        component = {"componentId": "C-A2", "type": "reading", "title": "Reading Material 2"}
        target = {
            "components": [
                *self.target["components"],
                {"componentId": "C-B5", "type": "reading", "title": "reading material 2"},
            ],
        }

        self.assertEqual(module_shift._suggested_pair(component, target), "")

    def test_a_week_that_does_not_exist_suggests_nothing(self):
        component = {"componentId": "C-A2", "type": "reading", "title": "Reading Material 2"}

        self.assertEqual(module_shift._suggested_pair(component, None), "")


class ShiftedPlanTests(SimpleTestCase):
    """A shift must remain visible after group inheritance and mirror reads."""

    def setUp(self):
        self.source = {"moduleId": "MOD-A", "moduleTitle": "Martech - Thur"}
        self.target = {"moduleId": "MOD-B", "moduleTitle": "Martech - Fri"}
        self.learner = SimpleNamespace(
            pk=62,
            programme="Marketing", group="G1-MarTech",
            learning_plan=[self.source], training_plan=None, save=Mock(),
        )

    def test_leaving_a_group_module_makes_the_shift_explicit(self):
        with patch("learner_api.module_shift._group_module_ids", return_value=["MOD-A"]):
            shifted = module_shift._shifted_plan(
                self.learner, [self.source], self.target, "MOD-A",
            )

        self.assertEqual([entry["moduleId"] for entry in shifted], ["MOD-B"])
        self.assertEqual(shifted[0]["assignmentMode"], "explicit")
        self.learner.learning_plan = shifted
        self.assertEqual(learning_plan._effective_plan_ids(self.learner, {}), ["MOD-B"])

    def test_a_non_group_module_does_not_freeze_the_rest_of_the_plan(self):
        with patch("learner_api.module_shift._group_module_ids", return_value=["MOD-X"]):
            shifted = module_shift._shifted_plan(
                self.learner, [self.source], self.target, "MOD-A",
            )

        self.assertNotIn("assignmentMode", shifted[0])

    def test_save_uses_the_selected_plan_field_and_updates_only_the_shifted_mirror(self):
        profile = SimpleNamespace(pk=248, learning_plan=None)
        with (
            patch("learner_api.module_shift.learner_profile_for_source", return_value=profile),
            patch("learner_api.module_shift.LearnerProfile"),
            patch("learner_api.module_shift.EnrolmentUser"),
            patch("learner_api.module_shift._replace_json_plan_module", return_value=True) as json_replace,
            patch("learner_api.module_shift._sync_legacy_titles_from_json"),
            patch("learner_api.module_shift._replace_mirrored_module", return_value=True) as replace,
            patch("learner_api.module_shift.sync_learning_plan_mirror") as full_mirror,
        ):
            field, saved_profile, mirrored = module_shift._save_shifted_plan(
                self.learner, [self.target], "MOD-A", "MOD-B",
            )

        self.assertEqual(field, "learning_plan")
        self.assertIs(saved_profile, profile)
        self.assertTrue(mirrored)
        self.assertEqual(self.learner.learning_plan, [self.target])
        self.learner.save.assert_not_called()
        self.assertEqual(json_replace.call_count, 2)
        replace.assert_called_once_with(profile, "MOD-A", self.target)
        full_mirror.assert_not_called()

    def test_save_respects_a_training_plan_backed_learner(self):
        self.learner.learning_plan = None
        self.learner.training_plan = [self.source]

        profile = SimpleNamespace(pk=248, learning_plan=None)
        with (
            patch("learner_api.module_shift.learner_profile_for_source", return_value=profile),
            patch("learner_api.module_shift.LearnerProfile"),
            patch("learner_api.module_shift.EnrolmentUser"),
            patch("learner_api.module_shift._replace_json_plan_module", return_value=True),
            patch("learner_api.module_shift._sync_legacy_titles_from_json"),
            patch("learner_api.module_shift._replace_mirrored_module", return_value=True),
            patch("learner_api.module_shift.sync_learning_plan_mirror") as full_mirror,
        ):
            field, _profile, mirrored = module_shift._save_shifted_plan(
                self.learner, [self.target], "MOD-A", "MOD-B",
            )

        self.assertEqual(field, "training_plan")
        self.assertTrue(mirrored)
        self.assertEqual(self.learner.training_plan, [self.target])
        self.learner.save.assert_not_called()
        full_mirror.assert_not_called()


class MappingValidationTests(SimpleTestCase):
    def _validate(self, mappings):
        with patch("learner_api.module_shift._rows", side_effect=_fake_rows):
            return module_shift._validate_mappings(mappings, "MOD-A", "MOD-B")

    def test_a_pair_within_the_two_modules_is_accepted(self):
        pairs, error = self._validate([{"fromComponentId": "C-A2", "toComponentId": "C-B2"}])

        self.assertEqual(error, "")
        self.assertEqual(pairs, [("C-A2", "C-B2")])

    def test_a_pair_with_no_target_is_left_unmatched_for_archiving(self):
        pairs, error = self._validate([{"fromComponentId": "C-A2", "toComponentId": ""}])

        self.assertEqual(error, "")
        self.assertEqual(pairs, [])

    def test_a_component_cannot_be_matched_to_a_different_type(self):
        _pairs, error = self._validate([
            {"fromComponentId": "C-A1", "toComponentId": "C-B2"},
        ])

        self.assertIn("is a video", error)
        self.assertIn("is a reading", error)

    def test_the_same_type_with_a_different_title_is_rejected(self):
        _pairs, error = self._validate([
            {"fromComponentId": "C-A1", "toComponentId": "C-B4"},
        ])

        self.assertIn("same title and type", error)

    def test_two_components_cannot_land_on_the_same_one(self):
        _pairs, error = self._validate([
            {"fromComponentId": "C-A1", "toComponentId": "C-B1"},
            {"fromComponentId": "C-A4", "toComponentId": "C-B1"},
        ])

        self.assertIn("same component", error)

    def test_a_target_outside_the_module_being_joined_is_refused(self):
        _pairs, error = self._validate([{"fromComponentId": "C-A1", "toComponentId": "C-A4"}])

        self.assertIn("not part of the module being joined", error)

    def test_a_source_outside_the_module_being_left_is_refused(self):
        _pairs, error = self._validate([{"fromComponentId": "C-B1", "toComponentId": "C-B4"}])

        self.assertIn("not part of the module being left", error)


class RepointTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('learner_api.module_shift._quiz_component_slots', return_value=[]))

    def _repoint(self, entries, pairs=(("C-A3", "C-B3"),), context=None, review_rows=()):
        queryset = Mock()
        queryset.exclude.return_value = entries
        cursor = _review_cursor(review_rows)
        with patch("learner_api.module_shift._component_learning_context",
                   return_value=TARGET_CONTEXT if context is None else context), \
                patch("learner_api.module_shift.connections",
                      {"enrolment": SimpleNamespace(cursor=lambda: cursor)}), \
                patch("learner_api.module_shift.LearnerProgressEntry") as entry_model, \
                patch("learner_api.module_shift.LearnerProgressKsb") as ksb_model:
            entry_model.objects.filter.return_value = queryset
            counts = module_shift._repoint_progress(
                SimpleNamespace(pk=62), SimpleNamespace(id=211), list(pairs),
            )
        self.cursor = cursor
        return counts, ksb_model

    def test_the_entry_is_moved_onto_the_component_it_was_mapped_to(self):
        entry = _entry("C-A3", component_title="PowerPoint 3", component_type="powerpoint")

        counts, _ksb = self._repoint([entry])

        self.assertEqual(counts["entries"], 1)
        self.assertEqual(entry.component_ref, "C-B3")
        self.assertEqual(entry.component_title, "shift ppt")
        self.assertEqual(entry.module_ref, "MOD-B")
        self.assertEqual(entry.programme_title, "Test 25/8")
        self.assertEqual(entry.module_title, "Shift 2")
        self.assertEqual(entry.week_ref, "W-B1")
        # The group teaching it changes with the module.
        self.assertEqual(entry.group_title, "G2 T")
        # The component's own values come from the component now credited.
        self.assertEqual(float(entry.expected_otjh), 3.0)
        self.assertEqual(entry.points, 20)
        self.assertEqual(entry.component_link_status, "resolved_to_current_component")

    def test_what_the_learner_actually_did_is_not_rewritten(self):
        entry = _entry("C-A3", grade=72, attempt=2)
        submitted = entry.submitted_at

        self._repoint([entry])

        self.assertEqual(entry.grade, 72)
        self.assertEqual(entry.attempt, 2)
        self.assertEqual(entry.submitted_at, submitted)
        self.assertEqual(entry.kind, "component")

    def test_the_original_component_is_recorded_once(self):
        entry = _entry("C-A3")

        self._repoint([entry])
        self.assertEqual(entry.legacy_component_ref, "C-A3")

        # A second shift keeps the first reference rather than overwriting it.
        entry.component_ref = "C-B3"
        self._repoint([entry], pairs=(("C-B3", "C-C3"),))
        self.assertEqual(entry.legacy_component_ref, "C-A3")

    def test_ksbs_are_remapped_to_the_component_now_credited(self):
        _counts, ksb_model = self._repoint([_entry("C-A3")])

        ksb_model.objects.filter.return_value.delete.assert_called_once()
        created = ksb_model.objects.bulk_create.call_args.args[0]
        self.assertEqual(len(created), 1)

    def test_a_target_with_no_ksbs_of_its_own_leaves_the_existing_links(self):
        context = {**TARGET_CONTEXT, "ksbMappings": []}

        _counts, ksb_model = self._repoint([_entry("C-A3")], context=context)

        ksb_model.objects.filter.assert_not_called()
        ksb_model.objects.bulk_create.assert_not_called()

    def test_a_target_component_that_cannot_be_read_moves_nothing(self):
        entry = _entry("C-A3")

        counts, _ksb = self._repoint([entry], context={})

        self.assertEqual(counts["entries"], 0)
        self.assertEqual(entry.component_ref, "C-A3")


class ArchiveProgressTests(SimpleTestCase):
    def test_unmatched_source_progress_is_soft_archived(self):
        base = Mock()
        scoped = Mock()
        base.filter.return_value = scoped
        scoped.update.return_value = 2
        profile = SimpleNamespace(pk=211)

        with patch.object(module_shift, "LearnerProgressEntry") as model, \
                patch.object(module_shift.timezone, "now", return_value="archived-at"):
            model.objects.filter.return_value = base
            archived = module_shift._archive_unmatched_progress(
                profile, "MOD-A", {"C-A1", "C-A2"},
            )

        self.assertEqual(archived, 2)
        model.objects.filter.assert_called_once_with(
            learner=profile, deleted_at__isnull=True,
        )
        scoped.update.assert_called_once_with(deleted_at="archived-at")

    def test_progress_that_was_moved_is_not_archived_even_if_component_ids_are_shared(self):
        base = Mock()
        scoped = Mock()
        unmatched = Mock()
        base.filter.return_value = scoped
        scoped.exclude.return_value = unmatched
        unmatched.update.return_value = 1

        with patch.object(module_shift, "LearnerProgressEntry") as model:
            model.objects.filter.return_value = base
            archived = module_shift._archive_unmatched_progress(
                SimpleNamespace(pk=211), "MOD-A", {"SHARED"}, (), [8],
            )

        self.assertEqual(archived, 1)
        scoped.exclude.assert_called_once_with(pk__in=[8])

    def test_a_uniquely_resolved_legacy_quiz_is_in_the_archive_scope(self):
        base = Mock()
        scoped = Mock()
        base.filter.return_value = scoped
        scoped.update.return_value = 1

        with patch.object(module_shift, "LearnerProgressEntry") as model:
            model.objects.filter.return_value = base
            archived = module_shift._archive_unmatched_progress(
                SimpleNamespace(pk=211), "MOD-A", {"C-AQ"}, [17],
            )

        self.assertEqual(archived, 1)
        archive_scope = base.filter.call_args.args[0]
        self.assertIn(("pk__in", [17]), archive_scope.children)

    def test_a_learner_without_a_delivery_profile_has_nothing_to_archive(self):
        with patch.object(module_shift, "LearnerProgressEntry") as model:
            self.assertEqual(
                module_shift._archive_unmatched_progress(None, "MOD-A", {"C-A1"}),
                0,
            )
        model.objects.filter.assert_not_called()


class QuizShiftProgressTests(SimpleTestCase):
    """Quiz submissions have quiz_ref but no component_ref, unlike readings."""

    def setUp(self):
        self.profile = SimpleNamespace(pk=211)
        self.slot = {
            "component_id": "C-AQ", "module_id": "MOD-A",
            "week_id": "W-A1", "quiz_id": "101",
        }

    def attempt(self, **changes):
        entry = _entry(None, kind="quiz", grade=1, attempt=1)
        entry.quiz_ref = "101"
        entry.module_ref = None
        entry.week_ref = None
        entry.passed = True
        entry.achieved_score = 10
        entry.total_score = 10
        entry.verified_seconds = 68
        entry.questions = [{"questionId": 5, "chosenAnswerId": 8}]
        for key, value in changes.items():
            setattr(entry, key, value)
        return entry

    def resolve(self, attempts, *, slots=None, direct=(), summary=False):
        queryset = Mock()
        queryset.exclude.return_value = list(direct)
        with patch.object(module_shift, "_quiz_component_slots", return_value=slots or [self.slot]), \
                patch.object(module_shift, "LearnerProgressEntry") as model:
            model.objects.filter.side_effect = [queryset, attempts]
            resolver = module_shift._progress_by_component if summary else module_shift._progress_entries_by_component
            result = resolver(self.profile, ["C-AQ"])
        self.assertEqual(model.objects.filter.call_args_list[0].kwargs["learner"], self.profile)
        call = model.objects.filter.call_args_list[1]
        self.assertEqual(call.kwargs, {
            "learner": self.profile, "deleted_at__isnull": True,
            "kind": "quiz", "quiz_ref__in": ["101"],
        })
        self.assertEqual(call.args[0].connector, "OR")
        self.assertCountEqual(call.args[0].children, [("component_ref__isnull", True), ("component_ref", "")])
        return result

    def test_quiz_only_attempt_is_offered_in_the_progress_summary(self):
        entry = self.attempt()
        summary = self.resolve([entry], summary=True)
        self.assertEqual(summary["C-AQ"]["entries"], 1)
        self.assertEqual(summary["C-AQ"]["kinds"], ["quiz"])
        self.assertIsNone(entry.component_ref)  # Preview never writes.
        entry.save.assert_not_called()

    def test_passed_and_failed_attempts_are_both_preserved(self):
        attempts = [self.attempt(passed=False, grade=0.2), self.attempt(attempt=2)]
        self.assertEqual(self.resolve(attempts), {"C-AQ": attempts})

    def test_shared_quiz_without_a_unique_slot_is_left_in_place(self):
        for other in (
            {**self.slot, "component_id": "C-AQ2"},
            {**self.slot, "component_id": "C-XQ", "module_id": "MOD-X"},
        ):
            with self.subTest(other=other):
                self.assertEqual(self.resolve([self.attempt()], slots=[self.slot, other]), {})

    def test_explicit_module_and_week_disambiguate_the_original_slot(self):
        entry = self.attempt(module_ref="MOD-A", week_ref="W-A1")
        slots = [self.slot, {**self.slot, "component_id": "C-XQ", "module_id": "MOD-X"},
                 {**self.slot, "component_id": "C-AQ2", "week_id": "W-A2"}]
        self.assertEqual(self.resolve([entry], slots=slots), {"C-AQ": [entry]})

    def test_an_attempt_explicitly_from_another_module_or_week_is_not_taken(self):
        for changes in ({"module_ref": "MOD-X"}, {"week_ref": "W-A2"}, {"quiz_ref": "999"}):
            with self.subTest(changes=changes):
                self.assertEqual(self.resolve([self.attempt(**changes)]), {})

    def test_existing_component_link_does_not_need_the_old_quiz_link(self):
        moved = self.attempt(component_ref="C-AQ", quiz_ref="99")
        self.assertEqual(self.resolve([], direct=[moved]), {"C-AQ": [moved]})

    def test_repoint_preserves_the_original_quiz_answers_scores_and_times(self):
        entry = self.attempt()
        entries = self.resolve([entry])
        historical_fields = ("quiz_ref", "grade", "attempt", "passed", "achieved_score", "total_score",
                             "verified_seconds", "questions", "submitted_at", "started_at")
        original = {field: getattr(entry, field) for field in historical_fields}
        with patch.object(module_shift, "_component_learning_context", return_value={
            **TARGET_CONTEXT, "componentType": "quiz", "componentTitle": "Matching quiz",
        }), patch.object(module_shift, "_rewrite_ksbs"), \
                patch.object(module_shift, "_move_review", return_value=(0, 0)), \
                patch.object(module_shift, "_progress_entries_by_component") as resolve:
            counts = module_shift._repoint_progress(
                SimpleNamespace(pk=62), self.profile, [("C-AQ", "C-BQ")], entries,
            )
        resolve.assert_not_called()  # Already resolved against the pre-shift plan.
        self.assertEqual(counts["entries"], 1)
        self.assertEqual(entry.component_ref, "C-BQ")
        self.assertEqual(entry.legacy_component_ref, "C-AQ")
        self.assertEqual(entry.module_ref, "MOD-B")
        self.assertEqual({field: getattr(entry, field) for field in historical_fields}, original)
        entry.save.assert_called_once_with(update_fields=module_shift.REPOINTED_FIELDS)


class ReviewMoveTests(SimpleTestCase):
    """The tutor/coach decision travels with the work it was made about."""

    REVIEW_ROW = ("row-1", "commercial", "62", "slide deck")

    def _move(self, rows=(REVIEW_ROW,), conflict=False):
        cursor = _review_cursor(rows, conflict=conflict)
        with patch("learner_api.module_shift.connections",
                   {"enrolment": SimpleNamespace(cursor=lambda: cursor)}):
            moved, kept = module_shift._move_review(
                SimpleNamespace(pk=62), "C-A3", "C-B3", TARGET_CONTEXT,
            )
        return moved, kept, cursor

    def _statements(self, cursor):
        return [call.args[0] for call in cursor.execute.call_args_list]

    def test_the_submission_is_repointed_at_the_new_component(self):
        moved, kept, cursor = self._move()

        self.assertEqual((moved, kept), (1, 0))
        update = next(sql for sql in self._statements(cursor) if "UPDATE" in sql)
        params = cursor.execute.call_args.args[1]
        self.assertIn("activity_id = %s", update)
        self.assertEqual(params[0], "C-B3")
        self.assertEqual(params[1], "C-B3")
        # It also carries the titles a marker reads it by.
        self.assertIn("shift ppt", params)
        self.assertIn("Shift 2", params)

    def test_the_decision_itself_is_left_alone(self):
        _moved, _kept, cursor = self._move()
        update = next(sql for sql in self._statements(cursor) if "UPDATE" in sql)

        # A tutor has read this learner's work; the shift does not re-open that.
        for column in ("status", "coach_feedback", "reviewed_by", "reviewed_at"):
            self.assertNotIn(f"{column} =", update)

    def test_a_review_already_on_the_target_is_not_overwritten(self):
        moved, kept, cursor = self._move(conflict=True)

        self.assertEqual((moved, kept), (0, 1))
        self.assertNotIn("UPDATE", " ".join(self._statements(cursor)))

    def test_a_component_with_no_reflection_moves_nothing(self):
        moved, kept, _cursor = self._move(rows=())

        self.assertEqual((moved, kept), (0, 0))


class ReviewInPairingTests(PairingCase, SimpleTestCase):
    """The picker shows the marking state, so it is known before the decision."""

    def test_a_pending_review_is_shown_against_its_component(self):
        _response, body = self._call(
            [_entry("C-A2")],
            reviews=[("C-A2", "submitted_for_tutor_review", "", "", None)],
        )
        component = body["weeks"][0]["from"]["components"][1]

        self.assertEqual(component["review"]["status"], "submitted_for_tutor_review")
        self.assertEqual(component["review"]["feedback"], "")

    def test_a_marked_review_carries_its_feedback_and_marker(self):
        _response, body = self._call(
            [_entry("C-A2")],
            reviews=[("C-A2", "accepted", "Good reflection.", "Progress Coach", None)],
        )
        review = body["weeks"][0]["from"]["components"][1]["review"]

        self.assertEqual(review["status"], "accepted")
        self.assertEqual(review["feedback"], "Good reflection.")
        self.assertEqual(review["reviewedBy"], "Progress Coach")

    def test_a_component_with_no_reflection_has_no_review(self):
        _response, body = self._call([_entry("C-A2")])

        self.assertIsNone(body["weeks"][0]["from"]["components"][1]["review"])
