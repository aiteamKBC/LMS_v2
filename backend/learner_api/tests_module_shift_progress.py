"""Moving a learner's progress when they are shifted between modules.

The pairing is by position — week 1 to week 1 — but which *component* a piece of
progress lands on is a human decision, so these cover the offer (which weeks and
components are shown, and what is suggested) and the write (what is rewritten,
and just as importantly what is left alone).
"""
import json
from datetime import datetime, timezone as tz
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import module_shift

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
    ("W-B1", 1, "Week 1", "C-B3", "powerpoint", "shift ppt", 3.0),
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
    """The suggestion is only a starting point, but it should be the obvious one."""

    def setUp(self):
        with patch("learner_api.module_shift._rows", side_effect=_fake_rows):
            self.target = module_shift._weeks_with_components("MOD-B")[0]

    def test_same_position_wins_when_the_types_agree(self):
        component = {"componentId": "C-A2", "type": "reading"}

        self.assertEqual(module_shift._suggested_pair(component, 1, 0, self.target), "C-B2")

    def test_a_moved_position_falls_back_to_the_same_rank_of_that_type(self):
        component = {"componentId": "C-A4", "type": "video"}

        # Second video on each side, even though the positions have drifted.
        self.assertEqual(module_shift._suggested_pair(component, 9, 1, self.target), "C-B4")

    def test_nothing_of_that_type_suggests_nothing_rather_than_a_near_miss(self):
        component = {"componentId": "C-A9", "type": "quiz"}

        # The target week has no quiz; suggesting the component in that slot
        # would be proposing a video as evidence of a quiz.
        self.assertEqual(module_shift._suggested_pair(component, 0, 0, self.target), "")

    def test_a_week_that_does_not_exist_suggests_nothing(self):
        component = {"componentId": "C-A2", "type": "reading"}

        self.assertEqual(module_shift._suggested_pair(component, 1, 0, None), "")


class MappingValidationTests(SimpleTestCase):
    def _validate(self, mappings):
        with patch("learner_api.module_shift._rows", side_effect=_fake_rows):
            return module_shift._validate_mappings(mappings, "MOD-A", "MOD-B")

    def test_a_pair_within_the_two_modules_is_accepted(self):
        pairs, error = self._validate([{"fromComponentId": "C-A2", "toComponentId": "C-B2"}])

        self.assertEqual(error, "")
        self.assertEqual(pairs, [("C-A2", "C-B2")])

    def test_a_pair_with_no_target_means_leave_that_progress_alone(self):
        pairs, error = self._validate([{"fromComponentId": "C-A2", "toComponentId": ""}])

        self.assertEqual(error, "")
        self.assertEqual(pairs, [])

    def test_a_component_cannot_be_matched_to_a_different_type(self):
        _pairs, error = self._validate([
            {"fromComponentId": "C-A1", "toComponentId": "C-B2"},
        ])

        self.assertIn("is a video", error)
        self.assertIn("is a reading", error)

    def test_the_same_type_at_a_different_position_is_allowed(self):
        # The picker offers this: matching is by type, not by slot.
        pairs, error = self._validate([
            {"fromComponentId": "C-A1", "toComponentId": "C-B4"},
        ])

        self.assertEqual(error, "")
        self.assertEqual(pairs, [("C-A1", "C-B4")])

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
        self._repoint([entry])
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
