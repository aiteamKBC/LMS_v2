from unittest.mock import patch

from django.test import SimpleTestCase

from .models import learner_ksbs_relation_exists


class LearnerKsbLegacyRelationCompatibilityTests(SimpleTestCase):
    @patch("learner_api.models.connections")
    def test_rejects_an_incompatible_table_with_the_same_name(self, connections):
        cursor = connections["legacy_without_id"].cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (["learner_id", "category", "code", "title", "level"],)

        self.assertFalse(learner_ksbs_relation_exists("legacy_without_id"))

    @patch("learner_api.models.connections")
    def test_accepts_the_complete_rollback_table_shape(self, connections):
        cursor = connections["compatible_legacy"].cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ([
            "id", "learner_id", "position", "code", "number", "ksb_type", "description",
        ],)

        self.assertTrue(learner_ksbs_relation_exists("compatible_legacy"))
