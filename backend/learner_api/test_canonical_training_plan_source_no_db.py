from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import canonical_learning, dashboard_weekly, my_learning, training_plan_dashboard
from .learning_plan import effective_training_plan
from .learning_plans.public import hydrate_normalized_plan
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

        with patch(
            "learner_api.learning_plans.infrastructure.plan_hydration.prefetch_related_objects",
        ) as prefetch:
            result = hydrate_normalized_plan(source, profile)

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
            hydrate_normalized_plan(source, profile)

    def test_existing_canonical_cache_short_circuits_the_orm_reader(self):
        cached = []
        source = SimpleNamespace(pk=17, _canonical_training_plan=cached)
        with patch(
            "learner_api.learning_plans.composition.read_normalized_plan",
            side_effect=AssertionError("normalized reader"),
        ) as reader:
            result = hydrate_normalized_plan(source)
        self.assertIs(result, cached)
        reader.assert_not_called()

    def test_missing_normalized_profile_installs_an_authoritative_empty_plan(self):
        source = SimpleNamespace(pk=17)
        with patch(
            "learner_api.learning_plans.infrastructure.plan_hydration.LearnerProfile",
        ) as model:
            model.objects.only.return_value.filter.return_value.prefetch_related.return_value.first.return_value = None
            result = hydrate_normalized_plan(source)
        self.assertEqual(result, [])
        self.assertIs(source._canonical_training_plan, result)

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
