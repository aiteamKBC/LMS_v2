"""Focused no-database regressions for Learner Summary request reuse."""

from unittest.mock import patch

from django.test import SimpleTestCase

from . import learner_detail


class LearnerSummaryOtjhReuseTests(SimpleTestCase):
    def test_master_expected_otjh_avoids_a_second_component_lookup(self):
        components = [{
            "componentId": "C1",
            "module": "Module",
            "week": "Week 1",
            "component": "Reading",
            "type": "reading",
        }]

        with patch.object(learner_detail, "_otjh_by_component_id") as by_id, patch.object(
            learner_detail, "_otjh_by_legacy_title",
        ) as by_title:
            result, total = learner_detail._annotate_otjh(
                components,
                resolved_expected_otjh={"C1": 2.5},
            )

        by_id.assert_not_called()
        by_title.assert_not_called()
        self.assertEqual(result[0]["expectedOtjh"], 2.5)
        self.assertEqual(total, 2.5)

    def test_master_null_expected_otjh_keeps_null_without_fallback_query(self):
        components = [{
            "componentId": "C1",
            "module": "Module",
            "week": "Week 1",
            "component": "Reading",
            "type": "reading",
        }]

        with patch.object(learner_detail, "_otjh_by_component_id") as by_id:
            result, total = learner_detail._annotate_otjh(
                components,
                resolved_expected_otjh={"C1": None},
            )

        by_id.assert_not_called()
        self.assertIsNone(result[0]["expectedOtjh"])
        self.assertEqual(total, 0.0)

    def test_only_unresolved_and_legacy_components_use_fallback_lookups(self):
        resolved = {
            "componentId": "C1", "module": "Module", "week": "Week 1",
            "component": "Reading", "type": "reading",
        }
        unresolved = {
            "componentId": "C2", "module": "Module", "week": "Week 1",
            "component": "Video", "type": "video",
        }
        legacy = {
            "componentId": None, "module": "Legacy", "week": "Week 2",
            "component": "Podcast", "type": "podcast",
        }

        with patch.object(
            learner_detail, "_otjh_by_component_id", return_value={"C2": 1.25},
        ) as by_id, patch.object(
            learner_detail, "_otjh_by_legacy_title",
            return_value={("Legacy", "Week 2", "Podcast"): 0.75},
        ) as by_title:
            result, total = learner_detail._annotate_otjh(
                [resolved, unresolved, legacy],
                resolved_expected_otjh={"C1": 2.5},
            )

        by_id.assert_called_once_with([unresolved])
        by_title.assert_called_once_with([legacy])
        self.assertEqual([row["expectedOtjh"] for row in result], [2.5, 1.25, 0.75])
        self.assertEqual(total, 4.5)
