"""Run directly with Python: synthetic ORM doubles, no Django setup, DB or network."""
import ast
import json
import re
import sys
import types
import unittest
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


BACKEND = Path(__file__).resolve().parents[1]


def load_functions(path, names, namespace):
    tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(nodes) == len(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), namespace)


def matches(row, key, value):
    field, *lookups = key.split("__")
    actual = getattr(row, field)
    for lookup in lookups:
        if lookup == "date":
            actual = actual.date() if actual else None
        elif lookup == "in":
            return actual in value
        elif lookup == "isnull":
            return (actual is None) == value
        elif lookup == "gte":
            return actual is not None and actual >= value
        elif lookup == "lte":
            return actual is not None and actual <= value
        elif lookup == "exact":
            return actual == value
        else:
            raise AssertionError(f"Unsupported lookup: {lookup}")
    return actual == value


class Predicate:
    def __init__(self, **conditions):
        self.empty = not conditions
        self.check = lambda row: all(matches(row, key, value) for key, value in conditions.items())

    def __or__(self, other):
        if self.empty:
            return other
        if other.empty:
            return self
        combined = Predicate()
        combined.empty = False
        combined.check = lambda row: self.check(row) or other.check(row)
        return combined


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def using(self, database):
        assert database == "synthetic"
        return self

    def filter(self, *predicates, **conditions):
        return Rows([row for row in self.rows if all(p.check(row) for p in predicates)
                     and all(matches(row, key, value) for key, value in conditions.items())])

    def exclude(self, predicate):
        return Rows([row for row in self.rows if not predicate.check(row)])

    def only(self, *fields):
        return self

    def annotate(self, **expressions):
        assert set(expressions) == {"normalized_email"}
        return Rows([SimpleNamespace(**vars(row), normalized_email=str(row.email or "").strip().lower())
                     for row in self.rows])

    def values_list(self, *fields):
        return [tuple(getattr(row, field) for field in fields) for row in self.rows]

    def order_by(self, *fields):
        return Rows(sorted(self.rows, key=lambda row: tuple(getattr(row, field) for field in fields)))

    def __iter__(self):
        return iter(self.rows)


class AttendanceProfilesTests(unittest.TestCase):
    def setUp(self):
        self.start = datetime(2026, 9, 1, 9, tzinfo=timezone.utc)
        self.profiles = [SimpleNamespace(id=1, email="one@example.invalid", email_normalized="one@example.invalid",
                                        full_name="Learner One", enrolment_id=101, coach_name="Coach", learner_type="commercial"),
                         SimpleNamespace(id=2, email="two@example.invalid", email_normalized="two@example.invalid",
                                         full_name="Learner Two", enrolment_id=202, coach_name="Coach", learner_type="apprenticeship")]
        self.series = [SimpleNamespace(id="S1", attendees=[], module_catalogue_id="M1", module_title="Module One"),
                       SimpleNamespace(id="S2", attendees=[], module_catalogue_id="M2", module_title="Module Two")]
        self.occurrences = [self.occurrence("O1", "S1", 1), self.occurrence("O2", "S1", 2),
                            self.occurrence("P1", "S1", 3), self.occurrence("P2", "S1", 4),
                            self.occurrence("B1", "S2", 1)]
        self.occurrences[2].actual_end = None
        self.occurrences[3].attendance_report_id = ""
        first = self.record("O1", " ONE@example.invalid ", [(0, 2)])
        self.records = [first, first, self.record("O1", "one@example.invalid", [(1, 4)]),
                        self.record("P1", "one@example.invalid", [(0, 5)]),
                        self.record("P2", "one@example.invalid", [(0, 5)]),
                        self.record("B1", "two@example.invalid", [(0, 5)])]
        self.launches = (defaultdict(set), defaultdict(set))
        self.recovery = Mock(side_effect=lambda rows: rows)
        results_module = types.ModuleType("curriculum_api.session_results")
        results_module.launch_expectations = Mock(side_effect=lambda *args: self.launches)
        recovery_module = types.ModuleType("learner_api.session_recovery")
        recovery_module.apply_recovery_to_rows = self.recovery
        # Use the real shared invitation parser without importing Django views.
        views_module = types.ModuleType("curriculum_api.views")
        views_module.__dict__.update(json=json, re=re)
        load_functions(BACKEND / "curriculum_api/views.py",
                       {"teams_series_email_list", "parse_json_value", "clean_str"}, views_module.__dict__)
        self.modules = patch.dict(sys.modules, {"curriculum_api.views": views_module,
                                               "curriculum_api.session_results": results_module,
                                               "learner_api.session_recovery": recovery_module})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.namespace = {
            "__package__": "learner_api", "defaultdict": defaultdict, "datetime": datetime,
            "datetime_timezone": timezone, "parse_datetime": lambda value: datetime.fromisoformat(value),
            "Q": Predicate, "Lower": lambda value: value, "Trim": lambda value: value,
            "router": SimpleNamespace(db_for_read=lambda model: "synthetic"),
            "timezone": SimpleNamespace(now=lambda: self.start, is_aware=lambda value: value.tzinfo is not None,
                                        is_naive=lambda value: value.tzinfo is None,
                                        make_aware=lambda value, tz: value.replace(tzinfo=tz),
                                        localtime=lambda value: value.astimezone(timezone(timedelta(hours=1)))),
        }
        policy_namespace = {"datetime": datetime, "timezone": timezone}
        load_functions(BACKEND / "curriculum_api/session_results_policy.py",
                       {"instant", "attendance_seconds", "evidence_seconds"}, policy_namespace)
        self.namespace["evidence_seconds"] = policy_namespace["evidence_seconds"]
        self.bind_rows()
        load_functions(BACKEND / "learner_api/teams_attendance.py",
                       {"_email", "_session_expected_emails", "_local_datetime", "_graph_datetime",
                        "_attendance_interval_bounds", "_reported_participant_emails", "fetch_verified_teams_attendance_rows"},
                       self.namespace)

    def bind_rows(self):
        for name, rows in [("LearnerProfile", self.profiles), ("LiveSession", self.series),
                           ("LiveSessionOccurrence", self.occurrences), ("LiveSessionAttendance", self.records),
                           ("ModuleAuthoringModule", [SimpleNamespace(module_catalogue_id="M1", group_id="G1", group_name="Group One"),
                                                      SimpleNamespace(module_catalogue_id="M2", group_id="G2", group_name="Group Two")])]:
            self.namespace[name] = type(name, (), {"objects": Rows(rows)})

    def occurrence(self, identifier, series_id, number):
        start = self.start + timedelta(days=number - 1)
        return SimpleNamespace(id=identifier, live_session_id=series_id, session_number=number,
                               scheduled_start=start, scheduled_end=start + timedelta(hours=1),
                               actual_start=start, actual_end=start + timedelta(hours=1),
                               attendance_report_id=f"report-{identifier}", artifacts_synced_at=start, updated_at=start)

    def record(self, occurrence_id, email, intervals):
        return SimpleNamespace(occurrence_id=occurrence_id, email=email, graph_record_id="record",
                               display_name="Synthetic Participant", total_attendance_seconds=300,
                               intervals=[{"joinDateTime": (self.start + timedelta(minutes=start)).isoformat(),
                                           "leaveDateTime": (self.start + timedelta(minutes=end)).isoformat()}
                                          for start, end in intervals])

    def fetch(self, learner_id=1, **kwargs):
        self.bind_rows()
        return self.namespace["fetch_verified_teams_attendance_rows"]([learner_id], **kwargs)

    def test_default_roster_still_excludes_non_invitees(self):
        self.assertEqual(self.fetch(), [])

    def test_reported_participant_is_visible_once_without_becoming_expected(self):
        rows = self.fetch(include_reported_participants=True)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["session_id"], "O1")
        self.assertEqual(rows[0]["attended_seconds"], 240)
        self.assertEqual(rows[0]["attendance_status"], "present")
        self.assertFalse(rows[0]["is_expected"])
        self.assertEqual(rows[0]["eligibility_reason"], "verified_teams_participant")
        self.assertEqual(rows[0]["session_start_time"].hour, 10)

    def test_participation_does_not_create_absences_in_other_occurrences(self):
        self.assertEqual([row["session_id"] for row in self.fetch(include_reported_participants=True)], ["O1"])

    def test_pending_and_missing_reports_are_not_displayed(self):
        self.records = [row for row in self.records if row.occurrence_id in {"P1", "P2"}]
        self.assertEqual(self.fetch(include_reported_participants=True), [])

    def test_removed_participation_does_not_turn_into_an_absence(self):
        self.namespace["_reported_participant_emails"] = Mock(return_value=(
            defaultdict(set, {"S1": {"one@example.invalid"}}),
            defaultdict(set, {"O1": {"one@example.invalid"}}),
        ))
        self.records = []
        self.assertEqual(self.fetch(include_reported_participants=True), [])

    def test_unknown_email_is_not_attributed_by_display_name(self):
        self.records = [self.record("O1", "", [(0, 5)])]
        self.assertEqual(self.fetch(include_reported_participants=True), [])

    def test_learner_module_and_date_scopes_are_preserved(self):
        rows = self.fetch(2, include_reported_participants=True)
        self.assertEqual([(row["learner_id"], row["session_id"]) for row in rows], [(2, "B1")])
        self.assertEqual(self.fetch(module_refs=["M2"], include_reported_participants=True), [])
        self.assertEqual(self.fetch(start_date=(self.start + timedelta(days=1)).date(), include_reported_participants=True), [])
        self.assertEqual(self.fetch(end_date=(self.start - timedelta(days=1)).date(), include_reported_participants=True), [])
        self.assertEqual(self.fetch(99, include_reported_participants=True), [])

    def test_invitees_keep_the_same_rows_and_absences(self):
        self.series[0].attendees = ["one@example.invalid"]
        original = self.fetch()
        expanded = self.fetch(include_reported_participants=True)
        self.assertEqual(original, expanded)
        self.assertEqual([row["attendance_status"] for row in expanded], ["present", "absent"])
        self.assertTrue(all(row["is_expected"] for row in expanded))

    def test_authenticated_launch_stays_limited_to_its_occurrence(self):
        self.launches[0]["S1"].add("one@example.invalid")
        self.launches[1]["O1"].add("one@example.invalid")
        self.assertEqual(self.fetch(), self.fetch(include_reported_participants=True))
        self.assertEqual(self.fetch()[0]["eligibility_reason"], "assigned_lms_join")

    def test_existing_duration_threshold_is_preserved(self):
        for seconds, status in [(180, "absent"), (181, "present")]:
            with self.subTest(seconds=seconds):
                row = self.record("O1", "one@example.invalid", [])
                row.total_attendance_seconds = seconds
                self.records = [row]
                self.assertEqual(self.fetch(include_reported_participants=True)[0]["attendance_status"], status)

    def test_recovery_still_receives_the_exact_occurrence_and_learner(self):
        self.fetch(include_reported_participants=True)
        recovered = self.recovery.call_args.args[0]
        self.assertEqual([(row["learner_id"], row["occurrence_id"]) for row in recovered], [(1, "O1")])


class CoachAttendanceContractTests(unittest.TestCase):
    def setUp(self):
        self.reader = Mock(return_value=[])
        self.namespace = {
            "fetch_verified_teams_attendance_rows": self.reader,
            "normalize_email": lambda value: str(value or "").strip().lower(),
            "clean_text": lambda value: str(value or "").strip(), "to_int": int,
            "empty_attendance_detail_summary": lambda: {"empty": True},
            "build_attendance_detail_summary_payload": lambda rows: {"rows": rows},
        }
        load_functions(BACKEND / "coach_api/views.py",
                       {"fetch_attendance_detail_summary_data", "fetch_attendance_detail_rows"}, self.namespace)

    def test_other_summary_consumers_keep_the_existing_roster(self):
        self.namespace["fetch_attendance_detail_summary_data"]([1], ["one@example.invalid"])
        self.reader.assert_called_once_with([1], ["one@example.invalid"])

    def test_attendance_summary_explicitly_opts_in(self):
        self.namespace["fetch_attendance_detail_summary_data"]([1], ["one@example.invalid"], include_reported_participants=True)
        self.reader.assert_called_once_with([1], ["one@example.invalid"], include_reported_participants=True)

    def test_profile_details_use_the_same_expanded_source(self):
        self.assertEqual(self.namespace["fetch_attendance_detail_rows"]({"id": "1", "email": "one@example.invalid"}), [])
        self.reader.assert_called_once_with([1], ["one@example.invalid"], include_reported_participants=True)


if __name__ == "__main__":
    with patch("socket.socket", side_effect=AssertionError("Network forbidden")):
        unittest.main()
