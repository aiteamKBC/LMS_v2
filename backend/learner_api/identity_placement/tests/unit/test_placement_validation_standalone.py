"""Pure placement interpretation and validation orchestration."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.identity_placement.application.validate_placement import (
    placement_input,
    validate_placement,
)


class InputTests(unittest.TestCase):
    def test_omitted_cleared_and_normalized_ids(self):
        self.assertEqual(placement_input({"phone": "1"}, error_type=ValueError), {})
        self.assertEqual(
            placement_input(
                {"programmeId": " P ", "cohort_id": "C", "groupId": None},
                error_type=ValueError,
            ),
            {"programme_id": "P", "cohort_id": "C", "group_id": None},
        )

    def test_conflicts_types_and_labels_keep_exact_messages(self):
        cases = (
            ({"groupId": "G", "group_id": "OTHER"}, "Conflicting groupId values."),
            ({"groupId": 9}, "groupId must be a string ID or null."),
            ({"group": "Legacy"}, "Use groupId to change placement; names are display-only."),
        )
        for payload, message in cases:
            with self.subTest(payload=payload), self.assertRaisesRegex(ValueError, message):
                placement_input(payload, error_type=ValueError)


class RelationshipTests(unittest.TestCase):
    def validate(self, fields, current=None, **outcomes):
        calls = []

        def reader(kind, result):
            def read(*ids, using):
                calls.append((kind, ids, using))
                return result
            return read

        result = validate_placement(
            fields,
            current,
            using="alias",
            programme_exists=reader("programme", outcomes.get("programme", True)),
            cohort_exists=reader("cohort", outcomes.get("cohort", True)),
            group_exists=reader("group", outcomes.get("group", True)),
            error_type=ValueError,
        )
        return result, calls

    def test_omitted_values_use_current_ids_and_checks_are_ordered(self):
        current = SimpleNamespace(programme_id="P", cohort_id="C", group_id="G")
        result, calls = self.validate({"group_id": "G2"}, current)
        self.assertEqual(result, {"group_id": "G2"})
        self.assertEqual(calls, [
            ("programme", ("P",), "alias"),
            ("cohort", ("C", "P"), "alias"),
            ("group", ("G2", "P", "C"), "alias"),
        ])

    def test_first_failure_stops_later_reads_with_exact_error(self):
        with self.assertRaisesRegex(ValueError, "Choose an existing programme ID"):
            self.validate({"programme_id": "P", "cohort_id": "C"}, programme=False)

    def test_empty_fields_do_not_read_storage(self):
        result, calls = self.validate({"phone": "1"})
        self.assertEqual(result, {})
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
