"""Mirroring the assigned learning plan out to the reporting tables.

The plan staff edit lives on enrolment."Created_users"."Learning_plan". Every
coach, marking and reporting surface reads "Learner".learners instead, and had
no view of what a learner was actually assigned. These cover the two things
that go wrong quietly: the legacy title columns being written as ids (which
would make the legacy reader reconstruct a plan of id-shaped module names), and
a cleared plan leaving a stale mirror behind.
"""
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from .learning_plan import _plan_titles, sync_learning_plan_mirror

PLAN = [
    {
        "moduleId": "MOD-1",
        "moduleTitle": "Marketing Impact",
        "weeks": [
            {
                "weekId": "WEEK-1",
                "weekTitle": "Week 1",
                "components": [
                    {"componentId": "COMP-1", "componentTitle": "Recorded Session"},
                    {"componentId": "COMP-2", "componentTitle": "Reading"},
                ],
            },
            {"weekId": "WEEK-2", "weekTitle": "Week 2", "components": []},
        ],
    },
]


class PlanTitleColumnsTests(SimpleTestCase):
    """The legacy columns hold titles joined with ", " and "·" for hierarchy."""

    def test_modules_are_titles_not_ids(self):
        # Ids here would be read back by mappers._legacy_plan_from_csv as module
        # *titles*, so a learner's plan would display as "MOD-1".
        modules, _weeks, _components = _plan_titles(PLAN)

        self.assertEqual(modules, "Marketing Impact")

    def test_weeks_carry_their_module(self):
        _modules, weeks, _components = _plan_titles(PLAN)

        self.assertEqual(weeks, "Marketing Impact · Week 1, Marketing Impact · Week 2")

    def test_components_carry_module_and_week(self):
        _modules, _weeks, components = _plan_titles(PLAN)

        self.assertEqual(
            components,
            "Marketing Impact · Week 1 · Recorded Session, "
            "Marketing Impact · Week 1 · Reading",
        )

    def test_an_empty_plan_clears_rather_than_omits(self):
        # A learner whose plan was cleared must not keep the old text.
        self.assertEqual(_plan_titles([]), ("", "", ""))
        self.assertEqual(_plan_titles(None), ("", "", ""))

    def test_a_malformed_entry_is_skipped_not_fatal(self):
        modules, _weeks, _components = _plan_titles([PLAN[0], "not a dict", None])

        self.assertEqual(modules, "Marketing Impact")


class SyncMirrorTests(SimpleTestCase):
    """What reaches each table, and what happens when one cannot be written."""

    def _sync(self, plan, pk=19):
        source = type("Source", (), {"pk": pk})()
        with patch("learner_api.mappers.get_training_plan", return_value=plan), \
                patch("learner_api.learning_plan.EnrolmentUser") as enrolment, \
                patch("learner_api.active_users.replace_training_plan") as child_rows, \
                patch("learner_api.models.LearnerProfile") as profile:
            count = sync_learning_plan_mirror(source)
        return count, enrolment, profile, child_rows

    def test_the_mirror_gets_the_structured_plan(self):
        _count, _enrolment, profile, _child = self._sync(PLAN)

        profile.objects.filter.assert_called_with(enrolment_id=19)
        profile.objects.filter.return_value.update.assert_called_once_with(learning_plan=PLAN)

    def test_a_cleared_plan_nulls_the_mirror(self):
        # Not skipped: a learner whose plan was removed must not keep a copy of
        # it in the table every coach surface reads.
        _count, _enrolment, profile, _child = self._sync([])

        profile.objects.filter.return_value.update.assert_called_once_with(learning_plan=None)

    def test_the_mirror_is_matched_on_enrolment_id(self):
        # Never on a LearnerProfile pk: that reference goes stale after
        # sync_active_user, which silently missed 367 rows once already.
        _count, _enrolment, profile, _child = self._sync(PLAN, pk=101)

        profile.objects.filter.assert_called_with(enrolment_id=101)

    def test_a_learner_with_no_pk_is_left_alone(self):
        self.assertEqual(sync_learning_plan_mirror(None), 0)

    def test_a_database_failure_does_not_raise(self):
        # The plan itself is already saved by the time this runs, so a failed
        # mirror must not turn a successful staff edit into an error.
        source = type("Source", (), {"pk": 19})()
        with patch("learner_api.mappers.get_training_plan", return_value=PLAN), \
                patch("learner_api.active_users.replace_training_plan"), \
                patch("learner_api.models.LearnerProfile") as profile:
            profile.objects.filter.side_effect = DatabaseError("pooler said no")
            self.assertEqual(sync_learning_plan_mirror(source), 0)

    def test_the_child_rows_the_learner_page_reads_are_written(self):
        # LearnerProfile.training_plan is assembled from plan_modules/weeks/
        # components, not from the jsonb. Writing only the jsonb stored the
        # plan and still showed the learner an empty "My learning" page.
        _count, _enrolment, _profile, child_rows = self._sync(PLAN)

        self.assertEqual(child_rows.call_count, 1)
        self.assertEqual(child_rows.call_args.args[1], PLAN)


class ChildRowBatchingTests(SimpleTestCase):
    """The mirror rebuild is three inserts, not one per module and per week.

    Written row by row, a learner on five thirteen-week modules cost about 140
    sequential round trips, which is what made assigning a single learner to a
    module hang for seconds against a remote database.
    """

    def _replace(self, plan):
        from . import active_users

        calls = []

        def bulk(name):
            def create(rows, **kwargs):
                calls.append(name)
                for index, row in enumerate(rows, 1):
                    row.pk = index if name != 'weeks' else 100 + index
                return list(rows)
            return create

        with patch.object(active_users, 'LearnerTrainingPlanModule') as modules,                 patch.object(active_users, 'LearnerTrainingPlanWeek') as weeks,                 patch.object(active_users, 'LearnerTrainingPlanComponent') as components:
            modules.side_effect = lambda **kw: type('Row', (), {**kw, 'pk': None})()
            weeks.side_effect = lambda **kw: type('Row', (), {**kw, 'pk': None})()
            components.side_effect = lambda **kw: type('Row', (), {**kw, 'pk': None})()
            modules.objects.bulk_create.side_effect = bulk('modules')
            weeks.objects.bulk_create.side_effect = bulk('weeks')
            components.objects.bulk_create.side_effect = bulk('components')
            active_users.replace_training_plan(object(), plan)
            return calls, modules, weeks, components

    def test_one_insert_per_level_and_a_single_delete(self):
        calls, modules, weeks, components = self._replace(PLAN)

        self.assertEqual(calls, ['modules', 'weeks', 'components'])
        modules.objects.filter.return_value.delete.assert_called_once_with()
        self.assertEqual(len(modules.objects.bulk_create.call_args.args[0]), 1)
        self.assertEqual(len(weeks.objects.bulk_create.call_args.args[0]), 2)
        self.assertEqual(len(components.objects.bulk_create.call_args.args[0]), 2)

    def test_every_component_is_filed_under_its_own_week(self):
        # Batching the inserts is only safe while each child still points at the
        # parent it belongs to; an off-by-one here would silently re-file a
        # learner's components under the wrong week.
        _calls, _modules, weeks, components = self._replace(PLAN)

        week_rows = weeks.objects.bulk_create.call_args.args[0]
        self.assertEqual([row.week_ref for row in week_rows], ['WEEK-1', 'WEEK-2'])
        self.assertEqual([row.position for row in week_rows], [1, 2])
        component_rows = components.objects.bulk_create.call_args.args[0]
        self.assertEqual([row.component_ref for row in component_rows], ['COMP-1', 'COMP-2'])
        self.assertEqual({row.plan_week.week_ref for row in component_rows}, {'WEEK-1'})
        self.assertEqual([row.position for row in component_rows], [1, 2])

    def test_an_empty_plan_clears_without_inserting(self):
        calls, modules, _weeks, _components = self._replace([])

        self.assertEqual(calls, [])
        modules.objects.filter.return_value.delete.assert_called_once_with()
