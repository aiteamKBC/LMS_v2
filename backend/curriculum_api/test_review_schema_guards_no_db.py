"""Pure regression checks for Review editor guards; no database or Teams I/O."""

from django.test import SimpleTestCase

from unittest.mock import patch

from . import review_instances
from .reviews import _review_definition_signature


class ReviewDefinitionGuardTests(SimpleTestCase):
    def setUp(self):
        self.sections = [{
            "id": "SEC-1",
            "title": "General",
            "estimatedMinutes": 10,
            "enabled": True,
            "fields": [{
                "id": "FIELD-1",
                "title": "Notes",
                "fieldType": "text_multiline",
                "required": True,
                "configuration": {"respondentRoles": ["participant"]},
            }],
        }]

    def test_section_edit_is_structural(self):
        renamed = [{**self.sections[0], "title": "Updated heading"}]
        # A section title is structural; the template name is handled outside
        # this helper so a name-only PATCH can leave the fields untouched.
        self.assertNotEqual(
            _review_definition_signature(self.sections),
            _review_definition_signature(renamed),
        )

    def test_same_tree_with_ids_is_not_replaced_when_name_changes_elsewhere(self):
        same_tree = [{**self.sections[0], "fields": [dict(self.sections[0]["fields"][0])]}]
        self.assertEqual(
            _review_definition_signature(self.sections),
            _review_definition_signature(same_tree),
        )

    def test_replacing_a_field_with_the_same_label_is_structural(self):
        replacement = [{
            **self.sections[0],
            "fields": [{**self.sections[0]["fields"][0], "id": "FIELD-2"}],
        }]
        self.assertNotEqual(
            _review_definition_signature(self.sections),
            _review_definition_signature(replacement),
        )

    def test_unknown_answer_field_is_rejected_before_any_insert(self):
        instance = {
            "id": "INSTANCE-1",
            "review_template_id": "TEMPLATE-1",
            "definition_snapshot": {"sections": self.sections},
        }
        with patch.object(
            review_instances,
            "_refresh_locked_editable_definition_snapshot",
            return_value=instance,
        ) as refresh:
            with self.assertRaisesRegex(ValueError, "Unknown Review field"):
                review_instances._save_review_instance_answers_locked(
                    instance, {"FIELD-UNKNOWN": "must not be dropped"}, actor="test",
                )
        refresh.assert_not_called()
