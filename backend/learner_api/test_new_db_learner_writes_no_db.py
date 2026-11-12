"""Learner writes on the normalised schema: lineage status, official hours, adoption identity.

DB-free: the lineage SQL runs in a private in-memory SQLite database with an
attached ``curriculum`` schema; everything else is a stand-in. Synthetic ids only.
"""
import inspect
import sqlite3
from contextlib import ExitStack, nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import SimpleTestCase

from curriculum_api import legacy_free_course_adoption as adoption
from . import active_users, quiz_reading


class NormalisedLineageStatusTests(SimpleTestCase):
    """The real lineage query against status-only tables (no legacy stamps)."""

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.create_function("btrim", 1, lambda value: None if value is None else str(value).strip())
        self.db.execute("ATTACH DATABASE ':memory:' AS curriculum")
        self.db.executescript("""
            CREATE TABLE curriculum.programmes (programme_id text, status text);
            CREATE TABLE curriculum.cohorts (cohort_id text, status text);
            CREATE TABLE curriculum.groups (group_id text, status text);
            CREATE TABLE curriculum.modules (module_catalogue_id text, programme_id text, cohort_id text,
                                             group_id text, status text);
            CREATE TABLE curriculum.weeks (id text, status text);
            CREATE TABLE curriculum.components (id text, week_id text, module_catalogue_id text, status text);
        """)
        self.addCleanup(self.db.close)

    def state(self, programme="active", cohort="active", group="active", module="active", week="active",
              component="active"):
        self.db.executescript("""DELETE FROM curriculum.programmes; DELETE FROM curriculum.cohorts;
            DELETE FROM curriculum.groups; DELETE FROM curriculum.modules; DELETE FROM curriculum.weeks;
            DELETE FROM curriculum.components;""")
        self.db.execute("INSERT INTO curriculum.programmes VALUES ('P', ?)", [programme])
        self.db.execute("INSERT INTO curriculum.cohorts VALUES ('CH', ?)", [cohort])
        self.db.execute("INSERT INTO curriculum.groups VALUES ('G', ?)", [group])
        self.db.execute("INSERT INTO curriculum.modules VALUES ('M', 'P', 'CH', 'G', ?)", [module])
        self.db.execute("INSERT INTO curriculum.weeks VALUES ('W', ?)", [week])
        self.db.execute("INSERT INTO curriculum.components VALUES ('C', 'W', 'M', ?)", [component])
        cursor = MagicMock()
        cursor.execute.side_effect = lambda sql, params: setattr(
            cursor, "_row", self.db.execute(sql.replace("%s", "?"), params).fetchone())
        cursor.fetchone.side_effect = lambda: cursor._row
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(active_users, "connections", {"default": connection, "enrolment": connection}):
            return active_users.component_reference_state("C")

    def test_active_lineage_accepts_new_progress(self):
        self.assertEqual(self.state(), ("active", ""))

    def test_a_planned_cohort_or_unset_status_is_not_a_withdrawal(self):
        self.assertEqual(self.state(cohort="planned"), ("active", ""))
        self.assertEqual(self.state(programme=None, cohort=None, group=None), ("active", ""))

    def test_each_withdrawn_level_is_named(self):
        for level, kwargs in (("group", {"group": "inactive"}), ("cohort", {"cohort": "inactive"}),
                              ("programme", {"programme": "inactive"}), ("programme", {"programme": "Archived"}),
                              ("module", {"module": "inactive"}), ("week", {"week": "inactive"}),
                              ("component", {"component": "inactive"})):
            with self.subTest(**kwargs):
                self.assertEqual(self.state(**kwargs), ("deleted", level))

    def test_the_nearest_withdrawn_level_wins(self):
        self.assertEqual(self.state(component="inactive", programme="inactive"), ("deleted", "component"))


class OfficialHoursPreservedTests(SimpleTestCase):
    """An ordinary learner save records evidence; it never rewrites completed_hours."""

    def setUp(self):
        self.enterContext(patch("socket.socket", side_effect=AssertionError("Network forbidden")))

    def save(self, record, history):
        learner = SimpleNamespace(pk=7, enrolment_id=19, aptem_id=42, username="Synthetic learner",
                                  training_plan_progress=history, completed_hours=38.30, save=Mock())
        connection = MagicMock(vendor="sqlite")
        with ExitStack() as stack:
            stack.enter_context(patch.object(active_users, "component_reference_state", return_value=("active", "")))
            stack.enter_context(patch.object(active_users, "_component_learning_context", return_value={}))
            stack.enter_context(patch.object(active_users.transaction, "atomic", side_effect=lambda **kwargs: nullcontext()))
            stack.enter_context(patch.object(active_users.transaction, "on_commit"))
            stack.enter_context(patch.object(active_users, "connections", {"enrolment": connection}))
            stack.enter_context(patch.object(active_users.LearnerProfile.objects, "select_for_update",
                                             return_value=SimpleNamespace(get=lambda **kwargs: learner)))
            stack.enter_context(patch.object(active_users.LearnerProgressEntry.objects, "filter",
                                             return_value=SimpleNamespace(aggregate=lambda **kwargs: {"value": 1})))
            create = stack.enter_context(patch.object(active_users, "_create_progress_entry",
                                                      return_value=SimpleNamespace(pk=11)))
            stack.enter_context(patch.object(active_users, "LearnerProgressKsb"))
            stack.enter_context(patch("learner_api.retake_timing.validate_activity_time"))
            stack.enter_context(patch("learner_api.activity_time_history.attendance_baseline", return_value=0))
            active_users.save_progress_record(learner, record)
        return learner, create

    def test_completing_a_video_keeps_imported_hours(self):
        # The projection of this history is 31.60 hours; the official total is 38.30.
        history = [{"kind": "component", "componentId": "H", "claimedSeconds": int(31.6 * 3600),
                    "submittedAt": "2026-09-01T10:00:00Z"}]
        learner, create = self.save({"kind": "video", "componentId": "V1", "claimedSeconds": 600,
                                     "submittedAt": "2026-10-02T10:00:00Z"}, history)
        self.assertEqual(learner.completed_hours, 38.30)
        learner.save.assert_not_called()
        create.assert_called_once()
        self.assertEqual(create.call_args.kwargs["claimed_seconds"], 600)

    def test_completing_a_quiz_keeps_the_official_total(self):
        learner, create = self.save({"kind": "quiz", "quizId": "64", "attempt": 1, "grade": 0.9, "passed": True,
                                     "submittedAt": "2026-10-02T10:00:00Z"}, [])
        self.assertEqual(learner.completed_hours, 38.30)
        learner.save.assert_not_called()
        self.assertEqual(float(create.call_args.kwargs["grade"]), 0.9)

    def test_quiz_reading_no_longer_rewrites_the_total(self):
        source = inspect.getsource(quiz_reading.quiz_reading)
        self.assertNotIn("completed_hours =", source)
        self.assertNotIn('"completed_hours"', source)


class AdoptionIdentityTests(SimpleTestCase):
    """History rows are owned by learner profiles; assignments by enrolment ids."""

    def owners(self, progress, profiles):
        query = MagicMock()
        query.values_list.return_value = profiles
        with patch("learner_api.models.LearnerProfile.objects.filter", return_value=query) as select:
            result = adoption.history_owners(progress)
        return result, select

    def test_history_is_mapped_from_its_profile_to_the_owning_enrolment(self):
        result, select = self.owners([{"learner_id": 501}, {"learner_id": 502}, {"learner_id": 501}],
                                     [(501, 9001), (502, 9002)])
        self.assertEqual(result, {501: 9001, 502: 9002})
        self.assertEqual(select.call_args.kwargs, {"pk__in": {501, 502}})

    def test_an_unknown_or_unlinked_profile_stops_adoption(self):
        for profiles in ([(501, 9001)], [(501, 9001), (502, None)]):
            with self.subTest(profiles=profiles), self.assertRaisesRegex(ValueError, "not a linked learner profile"):
                self.owners([{"learner_id": 501}, {"learner_id": 502}], profiles)

    def test_no_history_needs_no_lookup(self):
        result, _select = self.owners([], [])
        self.assertEqual(result, {})

    def test_adoption_reads_history_by_profile_and_awards_no_hours(self):
        source = inspect.getsource(adoption.adopt_learners)
        self.assertIn("learner_id__in=[profile.pk for profile in profiles]", source)
        self.assertNotIn("learner_id=owner_id", source)
        self.assertNotIn("completed_hours", source)
