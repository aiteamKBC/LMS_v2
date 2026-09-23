from unittest.mock import patch

from django.core.management.base import CommandError
from django.test import SimpleTestCase

from . import review_types, reviews
from .management.commands.map_mcm_meeting_summary_field import Command


def section_with(fields):
    return [{"title": "Meeting", "enabled": True, "fields": fields}]


def text_field(field_id, *, title="Coach notes", semantic_key=None):
    configuration = {}
    if semantic_key:
        configuration["semanticKey"] = semantic_key
    return {
        "id": field_id,
        "title": title,
        "fieldType": "text_multiline",
        "required": False,
        "configuration": configuration,
    }


class MeetingSummaryTemplateValidationTests(SimpleTestCase):
    def validate(self, fields, *, review_type_code=review_types.REVIEW_TYPE_CODE_MCM):
        with patch(
            "curriculum_api.reviews.review_types.get_review_type",
            return_value={"id": "REVT-1", "code": review_type_code},
        ):
            return reviews.validate_review_payload(
                {"sections": section_with(fields)},
                partial=True,
                programme_id="PROG-1",
                current_review_type_id="REVT-1",
            )

    def test_partial_update_uses_the_existing_mcm_type_for_semantic_validation(self):
        _cleaned, errors = self.validate([
            text_field("REVF-1", semantic_key=reviews.MEETING_SUMMARY_SEMANTIC_KEY),
        ])
        self.assertNotIn("sections", errors)

    def test_duplicate_summary_markers_are_rejected(self):
        _cleaned, errors = self.validate([
            text_field("REVF-1", semantic_key=reviews.MEETING_SUMMARY_SEMANTIC_KEY),
            text_field("REVF-2", semantic_key=reviews.MEETING_SUMMARY_SEMANTIC_KEY),
        ])
        self.assertEqual(
            errors["sections"],
            "A Review can define only one Meeting Summary field.",
        )

    def test_marker_is_allowed_on_progress_review(self):
        _cleaned, errors = self.validate(
            [text_field("REVF-1", semantic_key=reviews.MEETING_SUMMARY_SEMANTIC_KEY)],
            review_type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW,
        )
        self.assertNotIn("sections", errors)

    def test_marker_is_rejected_on_other_review_types(self):
        _cleaned, errors = self.validate(
            [text_field("REVF-1", semantic_key=reviews.MEETING_SUMMARY_SEMANTIC_KEY)],
            review_type_code="gateway_review",
        )
        self.assertEqual(
            errors["sections"],
            "Only a Monthly Coaching Meeting or Progress Review may define a Meeting Summary field.",
        )

    def test_a_summary_display_label_does_not_create_a_semantic_mapping(self):
        _cleaned, errors = self.validate([text_field("REVF-1", title="Meeting Summary")])
        self.assertNotIn("sections", errors)


class ExplicitMeetingSummaryMappingTests(SimpleTestCase):
    def test_mapping_field_walk_is_recursive_and_uses_exact_ids(self):
        nested = text_field("REVF-EXACT")
        fields = Command._fields(section_with([{
            "id": "REVF-CASE",
            "yesFields": [text_field("REVF-LABEL", title="Meeting Summary"), nested],
            "noFields": [],
        }]))
        self.assertEqual([field.get("id") for field in fields], [
            "REVF-CASE", "REVF-LABEL", "REVF-EXACT",
        ])

    def test_mapping_refuses_instances_in_the_signature_stage(self):
        for status in ("awaiting-signature", "completed"):
            with self.subTest(status=status), self.assertRaises(CommandError):
                Command._validate_unsigned({"status": status})

