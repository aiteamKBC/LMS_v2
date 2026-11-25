from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import canonical_learning, dashboard_weekly, my_learning, training_plan_dashboard
from .learning_plan import (
    effective_training_plan,
    install_canonical_training_plan,
    install_canonical_training_plan_module_ids,
    install_canonical_training_plan_modules,
)
from .mappers import get_training_plan


class CanonicalTrainingPlanSourceTests(SimpleTestCase):
    def test_canonical_plan_wins_over_absent_stale_or_contradictory_json(self):
        canonical = [{
            "moduleId": "CANONICAL",
            "moduleTitle": "Canonical module",
            "weeks": [],
        }]
        source = SimpleNamespace(
            pk=17,
            training_plan=[{"moduleId": "STALE"}],
            learning_plan=[{"moduleId": "CONTRADICTORY"}],
        )
        profile = SimpleNamespace(enrolment_id=17, training_plan=canonical)

        with patch("django.db.models.prefetch_related_objects") as prefetch:
            result = install_canonical_training_plan(source, profile)

        self.assertEqual(result, canonical)
        self.assertEqual(get_training_plan(source), canonical)
        self.assertEqual(effective_training_plan(source, {"group": ["PRIVATE"]}), canonical)
        prefetch.assert_called_once_with([profile], "plan_modules__weeks__components")

    def test_explicit_empty_canonical_plan_never_inherits_json_or_group_modules(self):
        source = SimpleNamespace(
            pk=17,
            training_plan=[{"moduleId": "STALE"}],
            learning_plan=None,
            _canonical_training_plan=[],
        )
        with patch("learner_api.learning_plan._preset_ids_for", side_effect=AssertionError("group preset")):
            self.assertEqual(get_training_plan(source), [])
            self.assertEqual(effective_training_plan(source, {}), [])

    def test_profile_must_own_the_enrolment_source(self):
        source = SimpleNamespace(pk=17)
        profile = SimpleNamespace(enrolment_id=18, training_plan=[])
        with self.assertRaisesMessage(ValueError, "does not own"):
            install_canonical_training_plan(source, profile)

    def test_upcoming_module_ids_use_the_canonical_owner_without_loading_children(self):
        source = SimpleNamespace(pk=285)
        owner = {'id': 407, 'enrolment_id': 285}
        cursor = MagicMock()
        cursor.fetchall.return_value = [('MOD-2',), ('MOD-1',), (None,)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch('learner_api.learning_plan.connections', {'enrolment': connection}):
            result = install_canonical_training_plan_module_ids(source, owner)

        self.assertEqual(result, [{'moduleId': 'MOD-2'}, {'moduleId': 'MOD-1'}])
        self.assertIs(source._canonical_training_plan, result)
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [407])
        self.assertIn('WHERE plan_module.learner_id=%s', sql)
        self.assertNotIn('learner_training_plan_weeks', sql)
        self.assertNotIn('learner_training_plan_components', sql)
        self.assertNotIn('curriculum.components', sql)

    def test_upcoming_module_ids_reject_a_same_number_foreign_canonical_owner(self):
        source = SimpleNamespace(pk=285)
        # Canonical learner 285 belongs to enrolment 207, not URL enrolment 285.
        foreign_owner = {'id': 285, 'enrolment_id': 207}
        with patch('learner_api.learning_plan.connections') as databases, \
             self.assertRaisesMessage(ValueError, 'does not own'):
            install_canonical_training_plan_module_ids(source, foreign_owner)
        databases.__getitem__.assert_not_called()

    def test_compact_dashboard_plan_uses_url_enrolment_owner_and_complete_ordered_tree(self):
        source = SimpleNamespace(pk=285)
        profile = SimpleNamespace(pk=407, enrolment_id=285, _state=SimpleNamespace(db='enrolment'))
        cursor = MagicMock()
        cursor.fetchall.return_value = [
            (10, 'MOD-1', 'Module 1', 101, 'WEEK-1', 'Week 1', 1001, 'COMP-1'),
            (10, 'MOD-1', 'Module 1', 101, 'WEEK-1', 'Week 1', 1002, 'COMP-2'),
            (20, 'MOD-2', 'Module 2', 201, 'WEEK-2', 'Week 2', None, None),
        ]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch('learner_api.learning_plan.connections', {'enrolment': connection}):
            result = install_canonical_training_plan_modules(source, profile)

        self.assertEqual(result, [
            {'moduleId': 'MOD-1', 'moduleTitle': 'Module 1', 'weeks': [
                {'weekId': 'WEEK-1', 'weekTitle': 'Week 1', 'components': [
                    {'componentId': 'COMP-1'}, {'componentId': 'COMP-2'},
                ]},
            ]},
            {'moduleId': 'MOD-2', 'moduleTitle': 'Module 2', 'weeks': [
                {'weekId': 'WEEK-2', 'weekTitle': 'Week 2', 'components': []},
            ]},
        ])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [407])
        self.assertIn('WHERE plan_module.learner_id=%s', sql)
        self.assertNotIn('description', sql)
        self.assertNotIn('settings_json', sql)

    def test_compact_dashboard_plan_never_treats_url_id_as_canonical_id(self):
        source = SimpleNamespace(pk=285)
        # Canonical learner 285 belongs to enrolment 207, not URL enrolment 285.
        foreign_profile = SimpleNamespace(pk=285, enrolment_id=207, _state=SimpleNamespace(db='enrolment'))
        with patch('learner_api.learning_plan.connections') as databases, \
             self.assertRaisesMessage(ValueError, 'does not own'):
            install_canonical_training_plan_modules(source, foreign_profile)
        databases.__getitem__.assert_not_called()

    def test_learner_read_source_fields_exclude_legacy_plan_storage(self):
        for fields in (
            my_learning.SOURCE_FIELDS,
            dashboard_weekly.WEEKLY_SOURCE_FIELDS,
            training_plan_dashboard.TRAINING_PLAN_SOURCE_FIELDS,
        ):
            self.assertNotIn("learning_plan", fields)
            self.assertNotIn("training_plan", fields)
            self.assertNotIn("modules", fields)
            self.assertNotIn("weeks", fields)
            self.assertNotIn("components", fields)

    def test_training_plan_schedule_does_not_append_imported_course_memberships(self):
        source = SimpleNamespace(pk=17, _canonical_training_plan=[{"moduleId": "CANONICAL"}])
        with patch.object(training_plan_dashboard, "builder_subject_links", return_value={}), \
             patch.object(canonical_learning, "curriculum_module_ids_for",
                          side_effect=AssertionError("historical membership")) as historical:
            module_ids, links = training_plan_dashboard.plan_module_ids(object(), source, {"id": 9})
        self.assertEqual(module_ids, ["CANONICAL"])
        self.assertEqual(links, {})
        historical.assert_not_called()

    def test_weekly_canonical_owner_marker_suppresses_historical_membership_query(self):
        with patch.object(canonical_learning, "query",
                          side_effect=AssertionError("historical membership")) as query:
            self.assertEqual(canonical_learning.curriculum_module_ids_for({
                "id": 9, "_canonical_plan_only": True,
            }), [])
        query.assert_not_called()
