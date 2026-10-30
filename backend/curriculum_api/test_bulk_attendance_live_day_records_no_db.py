"""Direct stdlib checks for the date-scoped live register reader.

Run with: ``python backend/curriculum_api/test_bulk_attendance_live_day_records_no_db.py``.
No Django setup, database, network, or Teams API is used.
"""
import ast
from datetime import date, datetime, time, timezone
from pathlib import Path
from types import SimpleNamespace
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
        load_members({"_parse_request", "_parse_month_request"}, self.ns)

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

    def test_month_reader_requires_one_module_and_uses_local_month_boundaries(self):
        request = type("Request", (), {"GET": {"month": "2026-12", "module_catalogue_id": "module-1"}})()
        self.assertEqual(
            self.ns["_parse_month_request"](request),
            (date(2026, 12, 1), date(2027, 1, 1), "module-1", "", []),
        )
        for query in (
            {"month": "2026-02"}, {"month": "2026-13", "module_catalogue_id": "module-1"},
            {"month": "2026-2", "module_catalogue_id": "module-1"},
        ):
            with self.assertRaises(ValueError):
                self.ns["_parse_month_request"](type("Request", (), {"GET": query})())
        source = SOURCE.read_text(encoding="utf-8-sig")
        self.assertIn("scheduled_start__gte=start, scheduled_start__lt=end", source)
        self.assertIn("timezone.make_aware", source)

    def test_month_reader_keeps_two_occurrences_on_one_day_distinct(self):
        class Query:
            def __init__(self, rows):
                self.rows = rows

            def using(self, _database):
                return self

            def filter(self, **conditions):
                rows = self.rows
                for name, expected in conditions.items():
                    if name.endswith("__in"):
                        rows = [row for row in rows if row[name[:-4]] in expected]
                    elif name.endswith("__isnull"):
                        rows = [row for row in rows if (row[name[:-8]] is None) == expected]
                    elif name.endswith("__gte"):
                        rows = [row for row in rows if row[name[:-5]] >= expected]
                    elif name.endswith("__lt"):
                        rows = [row for row in rows if row[name[:-4]] < expected]
                    else:
                        rows = [row for row in rows if row[name] == expected]
                return Query(rows)

            def exclude(self, **conditions):
                statuses = conditions["status__in"]
                return Query([row for row in self.rows if row["status"] not in statuses])

            def values(self, *fields):
                return [{field: row[field] for field in fields} for row in self.rows]

            def values_list(self, *fields, flat=False):
                return [row[fields[0]] for row in self.rows] if flat else [tuple(row[field] for field in fields) for row in self.rows]

        series = SimpleNamespace(objects=Query([{
            "id": "series-1", "module_catalogue_id": "module-1",
            "status": "completed", "module_title": "Module A", "repeat_pattern": "weekly",
        }]))
        occurrences = SimpleNamespace(objects=Query([
            {"id": "occ-1", "live_session_id": "series-1", "scheduled_start": datetime(2026, 10, 17, 9, tzinfo=timezone.utc), "session_number": 1, "status": "scheduled"},
            {"id": "occ-2", "live_session_id": "series-1", "scheduled_start": datetime(2026, 10, 17, 11, tzinfo=timezone.utc), "session_number": 2, "status": "scheduled"},
            {"id": "cancelled", "live_session_id": "series-1", "scheduled_start": datetime(2026, 10, 18, tzinfo=timezone.utc), "session_number": 3, "status": "cancelled"},
            {"id": "next-month", "live_session_id": "series-1", "scheduled_start": datetime(2026, 11, 1, tzinfo=timezone.utc), "session_number": 4, "status": "scheduled"},
        ]))
        register = SimpleNamespace(objects=Query([
            {"id": 1, "occurrence_id": "occ-1", "module_catalogue_id": "module-1", "learner_profile_id": 11, "attendance_status": "present"},
            {"id": 2, "occurrence_id": "occ-2", "module_catalogue_id": "module-1", "learner_profile_id": 11, "attendance_status": "absent"},
            {"id": 3, "occurrence_id": "occ-1", "module_catalogue_id": "shared-module", "learner_profile_id": 11, "attendance_status": "absent"},
        ]))

        class Response:
            def __init__(self, payload, status=200):
                self.payload = payload
                self.status_code = status

        scope = {
            **self.ns,
            "require_GET": lambda function: function,
            "router": SimpleNamespace(db_for_read=lambda _model: "default"),
            "LiveSession": series,
            "ModuleAuthoringModule": SimpleNamespace(objects=Query([{
                "module_catalogue_id": "module-1", "group_id": "group-1",
                "deleted_at": None, "is_programme_deleted": False,
            }])),
            "LiveSessionOccurrence": occurrences,
            "LiveSessionLearnerAttendance": register,
            "timezone": SimpleNamespace(
                get_current_timezone=lambda: timezone.utc,
                make_aware=lambda value, zone: value.replace(tzinfo=zone),
            ),
            "datetime": datetime,
            "time": time,
            "JsonResponse": Response,
            "DatabaseError": RuntimeError,
            "_local_date": lambda value: value.date(),
            "_aptem_ids_by_profile": lambda _ids: {11: "301"},
            "parallel_recovery_links": lambda _rows, **_kwargs: ({}, {}),
        }
        load_members({"bulk_attendance_live_month_records"}, scope)
        result = scope["bulk_attendance_live_month_records"](
            SimpleNamespace(GET={"month": "2026-10", "module_catalogue_id": "module-1"})
        )
        self.assertEqual(result.status_code, 200)
        self.assertEqual([row["id"] for row in result.payload["occurrences"]], ["occ-1", "occ-2"])
        self.assertEqual(
            [(row["occurrenceId"], row["attendance"]) for row in result.payload["records"]],
            [("occ-1", "present"), ("occ-2", "absent")],
        )

        scope["parallel_recovery_links"] = lambda _rows, **_kwargs: (
            {(11, "occ-2"): {"effectiveAttendance": "present", "recoveryOccurrenceId": "occ-1"}},
            {(11, "occ-1"): {"countsAsSession": False, "makeupForDate": "2026-10-17"}},
        )
        projected = scope["bulk_attendance_live_month_records"](
            SimpleNamespace(GET={"month": "2026-10", "module_catalogue_id": "module-1"})
        )
        self.assertEqual(projected.payload["records"][0]["countsAsSession"], False)
        self.assertEqual(projected.payload["records"][1]["effectiveAttendance"], "present")
        scope["parallel_recovery_links"] = lambda _rows, **_kwargs: ({}, {})

        group_result = scope["bulk_attendance_live_month_records"](
            SimpleNamespace(GET={"month": "2026-10", "group_id": "group-1"})
        )
        self.assertEqual(group_result.status_code, 200)
        self.assertEqual([row["moduleCatalogueId"] for row in group_result.payload["occurrences"]], ["module-1", "module-1"])

        excluded_series = SimpleNamespace(objects=Query([{
            "id": "series-2", "module_catalogue_id": "module-1",
            "status": "cancelled", "module_title": "Cancelled module", "repeat_pattern": "weekly",
        }]))
        scope["LiveSession"] = excluded_series
        excluded_result = scope["bulk_attendance_live_month_records"](
            SimpleNamespace(GET={"month": "2026-10", "module_catalogue_id": "module-1"})
        )
        self.assertEqual(excluded_result.payload["occurrences"], [])

        # A one-off addition on the same module: the module view keeps only
        # the weekly series, while the group view still lists both.
        scope["LiveSession"] = SimpleNamespace(objects=Query(series.objects.rows + [{
            "id": "one-off", "module_catalogue_id": "module-1",
            "status": "week-meeting", "module_title": "Master class", "repeat_pattern": "none",
        }]))
        scope["LiveSessionOccurrence"] = SimpleNamespace(objects=Query(occurrences.objects.rows + [
            {"id": "occ-one-off", "live_session_id": "one-off", "scheduled_start": datetime(2026, 10, 2, 9, tzinfo=timezone.utc), "session_number": 1, "status": "scheduled"},
        ]))
        pattern_result = scope["bulk_attendance_live_month_records"](
            SimpleNamespace(GET={"month": "2026-10", "module_catalogue_id": "module-1"})
        )
        self.assertEqual(pattern_result.status_code, 200)
        self.assertEqual([row["id"] for row in pattern_result.payload["occurrences"]], ["occ-1", "occ-2"])
        group_with_one_off = scope["bulk_attendance_live_month_records"](
            SimpleNamespace(GET={"month": "2026-10", "group_id": "group-1"})
        )
        self.assertEqual(
            [row["id"] for row in group_with_one_off.payload["occurrences"]],
            ["occ-one-off", "occ-1", "occ-2"],
        )
        scope["LiveSessionOccurrence"] = occurrences

        scope["LiveSession"] = series
        frontend_membership_result = scope["bulk_attendance_live_month_records"](
            SimpleNamespace(GET={
                "month": "2026-10", "group_id": "group-without-authoring-id",
                "module_catalogue_ids": "module-1",
            })
        )
        self.assertEqual(frontend_membership_result.status_code, 200)
        self.assertEqual(
            [row["id"] for row in frontend_membership_result.payload["occurrences"]],
            ["occ-1", "occ-2"],
        )

    def test_month_request_accepts_a_group_without_a_module(self):
        request = type("Request", (), {"GET": {"month": "2026-10", "group_id": "group-1"}})()
        self.assertEqual(
            self.ns["_parse_month_request"](request),
            (date(2026, 10, 1), date(2026, 11, 1), "", "group-1", []),
        )
        both = type("Request", (), {"GET": {
            "month": "2026-10", "module_catalogue_id": "module-1", "group_id": "group-1",
        }})()
        self.assertEqual(
            self.ns["_parse_month_request"](both),
            (date(2026, 10, 1), date(2026, 11, 1), "module-1", "group-1", []),
        )

    def test_month_request_accepts_frontend_module_ids_for_group_membership(self):
        request = type("Request", (), {"GET": {
            "month": "2026-10", "group_id": "group-1", "module_catalogue_ids": "module-1,module-2,module-1",
        }})()
        self.assertEqual(
            self.ns["_parse_month_request"](request),
            (date(2026, 10, 1), date(2026, 11, 1), "", "group-1", ["module-1", "module-2", "module-1"]),
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
