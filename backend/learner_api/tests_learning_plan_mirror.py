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
        _count, _enrolment, profile, child = self._sync(PLAN)

        profile.objects.only.assert_called_once_with("id", "enrolment_id")
        profile.objects.only.return_value.filter.assert_called_with(enrolment_id=19)
        child.assert_called_once_with(profile.objects.only.return_value.filter.return_value.first.return_value, PLAN)

    def test_a_cleared_plan_nulls_the_mirror(self):
        # Not skipped: a learner whose plan was removed must not keep a copy of
        # it in the table every coach surface reads.
        _count, _enrolment, profile, child = self._sync([])

        child.assert_called_once_with(profile.objects.only.return_value.filter.return_value.first.return_value, [])

    def test_the_mirror_is_matched_on_enrolment_id(self):
        # Never on a LearnerProfile pk: that reference goes stale after
        # sync_active_user, which silently missed 367 rows once already.
        _count, _enrolment, profile, _child = self._sync(PLAN, pk=101)

        profile.objects.only.return_value.filter.assert_called_with(enrolment_id=101)

    def test_a_learner_with_no_pk_is_left_alone(self):
        self.assertEqual(sync_learning_plan_mirror(None), 0)

    def test_a_database_failure_does_not_raise(self):
        # The plan itself is already saved by the time this runs, so a failed
        # mirror must not turn a successful staff edit into an error.
        source = type("Source", (), {"pk": 19})()
        with patch("learner_api.mappers.get_training_plan", return_value=PLAN), \
                patch("learner_api.active_users.replace_training_plan"), \
                patch("learner_api.models.LearnerProfile") as profile:
            profile.objects.only.side_effect = DatabaseError("pooler said no")
            self.assertEqual(sync_learning_plan_mirror(source), 0)

    def test_the_child_rows_the_learner_page_reads_are_written(self):
        # LearnerProfile.training_plan is assembled from plan_modules/weeks/
        # components, not from the jsonb. Writing only the jsonb stored the
        # plan and still showed the learner an empty "My learning" page.
        _count, _enrolment, _profile, child_rows = self._sync(PLAN)

        self.assertEqual(child_rows.call_count, 1)
        self.assertEqual(child_rows.call_args.args[1], PLAN)

    def test_plan_sync_never_reads_or_rebuilds_legacy_free_courses(self):
        class Source:
            pk = 19

            @property
            def free_courses(self):
                raise AssertionError("legacy Free_courses must not be read")

        with patch("learner_api.mappers.get_training_plan", return_value=PLAN), \
                patch("learner_api.learning_plan.EnrolmentUser"), \
                patch("learner_api.active_users.replace_training_plan"), \
                patch("learner_api.models.LearnerProfile"):
            self.assertEqual(sync_learning_plan_mirror(Source()), 1)


class ChildRowReconciliationTests(SimpleTestCase):
    """The compatibility entry point delegates to the canonical writer."""

    def _replace(self, plan):
        from . import active_users

        learner = type(
            "Learner",
            (),
            {"pk": 41, "_state": type("State", (), {"db": "enrolment"})()},
        )()
        snapshot = type("Snapshot", (), {"plan_version": "plan-v1"})()
        result = object()
        with patch(
            "learner_api.training_plan_writes.training_plan_snapshot",
            return_value=snapshot,
        ) as read, patch(
            "learner_api.training_plan_writes.reconcile_training_plan",
            return_value=result,
        ) as reconcile:
            returned = active_users.replace_training_plan(learner, plan)
        return returned, read, reconcile

    def test_delegates_without_delete_or_rebuild(self):
        returned, read, reconcile = self._replace(PLAN)

        self.assertIsNotNone(returned)
        read.assert_called_once_with(41, using="enrolment")
        self.assertEqual(reconcile.call_args.args[:2], (41, PLAN))
        self.assertEqual(reconcile.call_args.kwargs["expected_version"], "plan-v1")
        self.assertTrue(reconcile.call_args.kwargs["reorder"])

    def test_empty_internal_plan_is_reconciled_not_bulk_deleted(self):
        _returned, _read, reconcile = self._replace([])

        self.assertEqual(reconcile.call_args.args[:2], (41, []))


class CanonicalWeekMappingTests(SimpleTestCase):
    def test_week_model_selects_only_the_canonical_fk_and_curriculum_title(self):
        from .models import LearnerTrainingPlanWeek

        fields = {field.name: field for field in LearnerTrainingPlanWeek._meta.concrete_fields}
        self.assertNotIn('week_ref', fields)
        self.assertNotIn('week_title', fields)
        self.assertEqual(fields['curriculum_week'].column, 'curriculum_week_id')

        sql = str(LearnerTrainingPlanWeek.objects.all().query)
        self.assertNotIn('learner_training_plan_weeks"."week_ref', sql)
        self.assertNotIn('learner_training_plan_weeks"."week_title', sql)
        self.assertIn('curriculum"."weeks', sql)

    def test_compatibility_properties_use_the_curriculum_relationship(self):
        from curriculum_api.models import ModuleAuthoringWeek
        from .models import LearnerTrainingPlanWeek

        curriculum_week = ModuleAuthoringWeek(id='WEEK-1', title='Canonical Week')
        row = LearnerTrainingPlanWeek(curriculum_week=curriculum_week, position=1)

        self.assertEqual(row.week_ref, 'WEEK-1')
        self.assertEqual(row.week_title, 'Canonical Week')


class CanonicalComponentMappingTests(SimpleTestCase):
    def test_component_model_selects_only_the_canonical_fk_and_curriculum_title(self):
        from .models import LearnerTrainingPlanComponent

        fields = {field.name: field for field in LearnerTrainingPlanComponent._meta.concrete_fields}
        self.assertNotIn('component_ref', fields)
        self.assertNotIn('component_title', fields)
        self.assertEqual(fields['curriculum_component'].column, 'curriculum_component_id')

        sql = str(LearnerTrainingPlanComponent.objects.all().query)
        self.assertNotIn('learner_training_plan_components"."component_ref', sql)
        self.assertNotIn('learner_training_plan_components"."component_title', sql)
        self.assertIn('curriculum"."components', sql)

    def test_compatibility_properties_use_the_curriculum_relationship(self):
        from curriculum_api.models import ModuleAuthoringComponent
        from .models import LearnerTrainingPlanComponent

        curriculum_component = ModuleAuthoringComponent(id='COMP-1', title='Canonical Component')
        row = LearnerTrainingPlanComponent(
            curriculum_component=curriculum_component, position=1,
        )

        self.assertEqual(row.component_ref, 'COMP-1')
        self.assertEqual(row.component_title, 'Canonical Component')


class CanonicalPlanValidationTests(SimpleTestCase):
    def _validate(
        self, plan, *, modules=('MOD-1',),
        weeks=(('WEEK-1', 'MOD-1'), ('WEEK-2', 'MOD-1')),
        components=(
            ('COMP-1', 'WEEK-1', 'MOD-1'),
            ('COMP-2', 'WEEK-1', 'MOD-1'),
        ),
    ):
        from curriculum_api.models import (
            ModuleAuthoringComponent,
            ModuleAuthoringModule,
            ModuleAuthoringWeek,
        )
        from .active_users import validate_training_plan_relationships

        with patch.object(ModuleAuthoringModule, 'objects') as module_objects, \
                patch.object(ModuleAuthoringWeek, 'objects') as week_objects, \
                patch.object(ModuleAuthoringComponent, 'objects') as component_objects:
            module_objects.using.return_value.filter.return_value.values_list.return_value = list(modules)
            week_objects.using.return_value.filter.return_value.values_list.return_value = list(weeks)
            component_objects.using.return_value.filter.return_value.values_list.return_value = list(components)
            return validate_training_plan_relationships(plan)

    def test_valid_plan_preserves_empty_weeks_and_canonical_ids(self):
        validated = self._validate(PLAN)

        self.assertEqual(validated[0]['module_id'], 'MOD-1')
        self.assertEqual(
            [week['week_id'] for week in validated[0]['weeks']],
            ['WEEK-1', 'WEEK-2'],
        )

    def test_module_with_zero_weeks_is_valid(self):
        plan = [{'moduleId': 'MOD-1', 'moduleTitle': 'Canonical title is resolved later', 'weeks': []}]

        validated = self._validate(plan, weeks=(), components=())

        self.assertEqual(validated[0]['module_id'], 'MOD-1')
        self.assertEqual(validated[0]['weeks'], [])

    def test_rejects_a_week_owned_by_another_module(self):
        from .mappers import ValidationError

        with self.assertRaisesRegex(ValidationError, "does not belong to module 'MOD-1'"):
            self._validate(PLAN, weeks=(('WEEK-1', 'MOD-2'), ('WEEK-2', 'MOD-1')))

    def test_rejects_a_component_owned_by_another_week(self):
        from .mappers import ValidationError

        with self.assertRaisesRegex(ValidationError, "does not belong to week 'WEEK-1'"):
            self._validate(PLAN, components=(
                ('COMP-1', 'WEEK-2', 'MOD-1'),
                ('COMP-2', 'WEEK-1', 'MOD-1'),
            ))

    def test_rejects_missing_module_and_duplicate_week_before_any_write(self):
        from . import active_users
        from .mappers import ValidationError

        with self.assertRaisesRegex(ValidationError, "does not exist in Curriculum"):
            self._validate(PLAN, modules=())

        duplicate = [{**PLAN[0], 'weeks': [PLAN[0]['weeks'][0], PLAN[0]['weeks'][0]]}]
        with self.assertRaisesRegex(ValidationError, "appears more than once"):
            self._validate(duplicate)

        from .training_plan_writes import TrainingPlanValidationError

        learner = type(
            "Learner",
            (),
            {"pk": 41, "_state": type("State", (), {"db": "enrolment"})()},
        )()
        snapshot = type("Snapshot", (), {"plan_version": "plan-v1"})()
        with patch(
            "learner_api.training_plan_writes.training_plan_snapshot",
            return_value=snapshot,
        ), patch(
            "learner_api.training_plan_writes.reconcile_training_plan",
            side_effect=TrainingPlanValidationError(
                "invalid_curriculum_hierarchy", "invalid canonical relationship"
            ),
        ):
            with self.assertRaisesRegex(ValidationError, "invalid canonical relationship"):
                active_users.replace_training_plan(learner, PLAN)
