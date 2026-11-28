"""Pure, no-database coverage for the MCM summary backfill plan."""
from django.test import SimpleTestCase

from . import reviews
from .management.commands.backfill_mcm_meeting_summary_fields import (
    apply_definition_backfill,
    materialise_snapshot_ids,
    plan_definition,
)


def field(field_id, title, *, field_type="text_multiline", configuration=None):
    return {
        "id": field_id,
        "title": title,
        "fieldType": field_type,
        "required": False,
        "configuration": configuration or {},
    }


class McmSummaryBackfillPlanTests(SimpleTestCase):
    def test_existing_marker_is_idempotent(self):
        definition = {"sections": [{"title": "Meeting Summary", "fields": [
            field("REVF-1", "Summary", configuration={"semanticKey": reviews.MEETING_SUMMARY_SEMANTIC_KEY}),
        ]}]}
        self.assertEqual(plan_definition(definition)["action"], "already_mapped")
        updated, plan = apply_definition_backfill(definition)
        self.assertEqual(plan["action"], "already_mapped")
        self.assertEqual(updated, definition)

    def test_legacy_summary_in_summary_section_is_marked(self):
        definition = {"sections": [{"title": "Meeting Summary", "fields": [field("REVF-1", "Summary")]}]}
        updated, plan = apply_definition_backfill(definition)
        self.assertEqual(plan["action"], "mark_existing_field")
        self.assertEqual(
            updated["sections"][0]["fields"][0]["configuration"]["semanticKey"],
            reviews.MEETING_SUMMARY_SEMANTIC_KEY,
        )

    def test_previous_meeting_summary_is_not_selected(self):
        definition = {"sections": [{"title": "Previous Meeting Summary", "fields": [field("REVF-1", "Summary")]}]}
        self.assertEqual(plan_definition(definition)["action"], "add_new_field")

    def test_missing_mapping_adds_one_optional_summary_field(self):
        definition = {"sections": [{"title": "Opening", "fields": []}]}
        updated, plan = apply_definition_backfill(definition)
        self.assertEqual(plan["action"], "add_new_field")
        added = updated["sections"][-1]["fields"][0]
        self.assertEqual(added["configuration"]["semanticKey"], reviews.MEETING_SUMMARY_SEMANTIC_KEY)
        self.assertFalse(added["required"])

    def test_duplicate_markers_are_reported_without_mutation(self):
        definition = {"sections": [{"title": "Meeting Summary", "fields": [
            field("REVF-1", "Summary", configuration={"semanticKey": reviews.MEETING_SUMMARY_SEMANTIC_KEY}),
            field("REVF-2", "Other", configuration={"semanticKey": reviews.MEETING_SUMMARY_SEMANTIC_KEY}),
        ]}]}
        updated, plan = apply_definition_backfill(definition)
        self.assertEqual(plan["action"], "ambiguous_multiple_markers")
        self.assertEqual(updated, definition)

    def test_non_text_summary_label_is_reported_instead_of_duplicated(self):
        definition = {"sections": [{"title": "Meeting Summary", "fields": [
            field("REVF-1", "Summary", field_type="boolean"),
        ]}]}
        updated, plan = apply_definition_backfill(definition)
        self.assertEqual(plan["action"], "invalid_summary_field_type")
        self.assertEqual(updated, definition)

    def test_new_snapshot_fields_receive_persistable_ids(self):
        definition = {"sections": [{"title": "Opening", "fields": []}]}
        updated, _ = apply_definition_backfill(definition)
        materialised = materialise_snapshot_ids(updated)
        added_section = materialised["sections"][-1]
        self.assertTrue(added_section["id"].startswith("REVS-"))
        self.assertTrue(added_section["fields"][0]["id"].startswith("REVF-"))
        self.assertNotEqual(added_section["id"], added_section["fields"][0]["id"])
