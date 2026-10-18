"""Direct stdlib checks for the date-scoped live register reader.

Run with: ``python backend/curriculum_api/test_bulk_attendance_live_day_records_no_db.py``.
No Django setup, database, network, or Teams API is used.
"""
import ast
from datetime import date
from pathlib import Path
import unittest


ROOT = Path(__file__).parent
SOURCE = ROOT / "bulk_attendance_live_day_records.py"


def load_members(names, namespace):
    tree = ast.parse(SOURCE.read_text(encoding="utf-8-sig"))
    nodes = [
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    assert len(nodes) == len(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), namespace)


class LiveAttendanceDayRecordsTests(unittest.TestCase):
    def setUp(self):
        self.ns = {"date": date}
        load_members({"_parse_request"}, self.ns)

    def test_requires_a_valid_local_date_and_bounded_optional_module_id(self):
        request = type("Request", (), {"GET": {"date": "2026-10-17", "module_catalogue_id": "module-1"}})()
        self.assertEqual(self.ns["_parse_request"](request), (date(2026, 10, 17), "module-1"))
        invalid = type("Request", (), {"GET": {"date": "17/10/2026"}})()
        with self.assertRaises(ValueError):
            self.ns["_parse_request"](invalid)
        too_long = type("Request", (), {"GET": {"date": "2026-10-17", "module_catalogue_id": "x" * 129}})()
        with self.assertRaises(ValueError):
            self.ns["_parse_request"](too_long)

    def test_reader_is_limited_to_the_lms_register_and_never_calls_teams(self):
        source = SOURCE.read_text(encoding="utf-8-sig").lower()
        self.assertIn("livesessionlearnerattendance", source)
        self.assertIn("livesessionoccurrence", source)
        self.assertNotIn("graph_client", source)
        self.assertNotIn(".create(", source)
        self.assertNotIn(".update(", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
