"""Database-free security, compatibility and query contracts for I7-B4C."""

import inspect
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from learner_api import evidence, reflection_submissions
from learner_api.selectors.identity import ResolutionStatus
from learner_api.selectors.lineage_identity import (
    LineageMatchBasis,
    resolve_lineage_for_enrolment,
)


def canonical_row(profile_id=901, **changes):
    row = {
        "requested_enrolment_id": 42,
        "requested_position": 1,
        "account_match_count": 1,
        "id": profile_id,
        "enrolment_id": 42,
        "aptem_id": 7001,
        "learner_type": "commercial",
        "account_record_id": 42,
        "account_email": "learner@example.test",
        "account_aptem_id": "007001",
        "email": "LEARNER@example.test",
    }
    row.update(changes)
    return row


class ScriptedCursor:
    def __init__(self, results):
        self.results = list(results)
        self.executions = []
        self.current = {}
        self.description = None

    def execute(self, sql, params=None):
        self.executions.append((sql, params))
        self.current = self.results[len(self.executions) - 1]

    def fetchall(self):
        return list(self.current.get("all", []))

    def fetchone(self):
        return self.current.get("one")


class CursorContext:
    def __init__(self, cursor):
        self.cursor = cursor

    def __enter__(self):
        return self.cursor

    def __exit__(self, exc_type, exc, traceback):
        return False


def account(email="learner@example.test", aptem="007001"):
    return {
        "account_record_id": 42,
        "account_email": email,
        "account_aptem_id": aptem,
    }


class LineageAdapterTests(SimpleTestCase):
    databases = set()

    def test_direct_canonical_resolution_is_one_read_with_explicit_basis(self):
        cursor = ScriptedCursor([{"all": [canonical_row()]}])
        result = resolve_lineage_for_enrolment(cursor, 42)

        self.assertEqual(result.status, ResolutionStatus.RESOLVED)
        self.assertEqual(result.match_basis, LineageMatchBasis.EXPLICIT_BRIDGE)
        self.assertEqual(result.profile_ids, ("901",))
        self.assertEqual(len(cursor.executions), 1)
        self.assertIn("l.enrolment_id=accounts.account_record_id", cursor.executions[0][0])

    def test_direct_ambiguity_fails_closed_without_legacy_queries(self):
        cursor = ScriptedCursor([{"all": [canonical_row(901), canonical_row(902)]}])
        result = resolve_lineage_for_enrolment(cursor, 42)

        self.assertEqual(result.status, ResolutionStatus.AMBIGUOUS)
        self.assertEqual(result.profile_ids, ())
        self.assertIsNone(result.match_basis)
        self.assertEqual(len(cursor.executions), 1)

    def test_direct_email_and_aptem_mismatches_are_not_canonical_or_legacy(self):
        for change in (
            {"account_email": "other@example.test"},
            {"account_aptem_id": "9999"},
        ):
            with self.subTest(change=change):
                cursor = ScriptedCursor([{"all": [canonical_row(**change)]}])
                result = resolve_lineage_for_enrolment(cursor, 42)
                self.assertEqual(result.status, ResolutionStatus.MISMATCH)
                self.assertEqual(result.profile_ids, ())
                self.assertEqual(len(cursor.executions), 1)

    def test_unique_primary_email_is_legacy_resolved_in_three_reads(self):
        cursor = ScriptedCursor([
            {"all": []},
            {"all": [account(email="Legacy@Example.test")]},
            {"all": [{
                "profile_id": 901,
                "profile_match_count": 1,
                "account_email_match_count": 1,
            }]},
        ])
        result = resolve_lineage_for_enrolment(cursor, 42)

        self.assertEqual(result.status, ResolutionStatus.LEGACY_RESOLVED)
        self.assertEqual(result.match_basis, LineageMatchBasis.LEGACY_UNIQUE_PRIMARY_EMAIL)
        self.assertEqual(result.profile_ids, ("901",))
        self.assertEqual(len(cursor.executions), 3)
        self.assertTrue(all(sql.lstrip().lower().startswith(("select", "with"))
                            for sql, _params in cursor.executions))
        sql, params = cursor.executions[-1]
        self.assertIn("l.enrolment_id IS NULL", sql)
        self.assertIn("account_email_match_count", sql)
        self.assertEqual(params, ["Legacy@Example.test", "Legacy@Example.test"])

    def test_unique_email_aptem_disagreement_remains_legacy_not_canonical(self):
        cursor = ScriptedCursor([
            {"all": []},
            {"all": [account(email="legacy@example.test", aptem="007001")]},
            {"all": [{
                "profile_id": 901,
                "profile_aptem_id": 9999,
                "profile_match_count": 1,
                "account_email_match_count": 1,
            }]},
        ])
        result = resolve_lineage_for_enrolment(cursor, 42)

        # B4C does not silently retire the approved historical email rule.
        # The result retains its legacy basis and is never canonical identity.
        self.assertEqual(result.status, ResolutionStatus.LEGACY_RESOLVED)
        self.assertEqual(result.match_basis, LineageMatchBasis.LEGACY_UNIQUE_PRIMARY_EMAIL)
        self.assertEqual(result.profile_ids, ("901",))

    def test_email_fallback_requires_uniqueness_on_both_sides(self):
        cases = (
            [{"profile_id": 901, "profile_match_count": 1,
              "account_email_match_count": 2}],
            [
                {"profile_id": 901, "profile_match_count": 2,
                 "account_email_match_count": 1},
                {"profile_id": 902, "profile_match_count": 2,
                 "account_email_match_count": 1},
            ],
        )
        for profiles in cases:
            with self.subTest(profiles=len(profiles)):
                cursor = ScriptedCursor([
                    {"all": []},
                    {"all": [account(email="shared@example.test")]},
                    {"all": profiles},
                ])
                result = resolve_lineage_for_enrolment(cursor, 42)
                self.assertEqual(result.status, ResolutionStatus.AMBIGUOUS)
                self.assertEqual(result.profile_ids, ())
                self.assertEqual(len(cursor.executions), 3)

    def test_missing_account_stops_after_two_reads(self):
        cursor = ScriptedCursor([{"all": []}, {"all": []}])
        result = resolve_lineage_for_enrolment(cursor, 42)
        self.assertEqual(result.status, ResolutionStatus.MISSING)
        self.assertEqual(result.profile_ids, ())
        self.assertEqual(len(cursor.executions), 2)

    def test_safe_no_email_equal_pk_remains_explicit_legacy_only(self):
        cursor = ScriptedCursor([
            {"all": []},
            {"all": [account(email="", aptem="007001")]},
            {"all": [{
                "profile_id": 42,
                "profile_aptem_id": 7001,
                "explicit_bridge_conflict": False,
                "primary_email_owner_conflict": False,
                "aptem_owner_conflict": False,
            }]},
        ])
        result = resolve_lineage_for_enrolment(cursor, 42)

        self.assertEqual(result.status, ResolutionStatus.LEGACY_RESOLVED)
        self.assertEqual(
            result.match_basis,
            LineageMatchBasis.LEGACY_NO_EMAIL_EQUAL_PROFILE_PK,
        )
        self.assertEqual(result.profile_ids, ("42",))
        self.assertEqual(len(cursor.executions), 3)
        self.assertIn("l.id = %s", cursor.executions[-1][0])
        self.assertIn("l.enrolment_id IS NULL", cursor.executions[-1][0])

    def test_equal_pk_rejects_collision_ownership_and_aptem_conflicts(self):
        for change, status in (
            ({"explicit_bridge_conflict": True}, ResolutionStatus.AMBIGUOUS),
            ({"primary_email_owner_conflict": True}, ResolutionStatus.AMBIGUOUS),
            ({"aptem_owner_conflict": True}, ResolutionStatus.AMBIGUOUS),
            ({"profile_aptem_id": 9999}, ResolutionStatus.MISMATCH),
        ):
            with self.subTest(change=change):
                profile = {
                    "profile_id": 42,
                    "profile_aptem_id": 7001,
                    "explicit_bridge_conflict": False,
                    "primary_email_owner_conflict": False,
                    "aptem_owner_conflict": False,
                    **change,
                }
                cursor = ScriptedCursor([
                    {"all": []},
                    {"all": [account(email="", aptem="007001")]},
                    {"all": [profile]},
                ])
                result = resolve_lineage_for_enrolment(cursor, 42)
                self.assertEqual(result.status, status)
                self.assertEqual(result.profile_ids, ())

    def test_empty_or_noncanonical_numeric_input_performs_no_read(self):
        for learner_id in (None, "", "not-an-id", "0042", 0, -1):
            with self.subTest(learner_id=learner_id):
                cursor = ScriptedCursor([])
                result = resolve_lineage_for_enrolment(cursor, learner_id)
                self.assertEqual(result.status, ResolutionStatus.MISSING)
                self.assertEqual(result.profile_ids, ())
                self.assertEqual(cursor.executions, [])


class ConsumerAndPerformanceTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.factory = RequestFactory()

    def test_reflection_lineage_reuses_one_direct_fact_and_three_total_reads(self):
        cursor = ScriptedCursor([
            {"one": ("COMP-1",)},
            {"all": [canonical_row()]},
            {"one": (99, "COMP-1", "P", "C", "G", "M", "W")},
        ])
        connection = MagicMock()
        connection.cursor.return_value = CursorContext(cursor)
        with patch.object(reflection_submissions, "connections", {"enrolment": connection}):
            lineage = reflection_submissions._reflection_lineage(42, "COMP-1")

        self.assertEqual(lineage["progress_entry_id"], 99)
        self.assertEqual(lineage["component_ref"], "COMP-1")
        self.assertEqual(len(cursor.executions), 3)

    def test_evidence_and_reflection_keep_one_shared_adapter(self):
        cursor = object()
        with patch.object(
            reflection_submissions,
            "resolve_lineage_for_enrolment",
            return_value=SimpleNamespace(profile_ids=("901",)),
        ) as resolve:
            self.assertEqual(
                reflection_submissions._learner_profile_ids_for_source(cursor, 42),
                ["901"],
            )
            self.assertEqual(evidence._learner_profile_ids_for_source(cursor, 42), ["901"])
        self.assertEqual(resolve.call_count, 2)

    def test_evidence_list_retains_three_reads_for_nonempty_request(self):
        uploaded_at = SimpleNamespace(isoformat=lambda: "2026-10-24T12:00:00+00:00")
        list_cursor = MagicMock()
        list_cursor.fetchall.return_value = [
            ("file-1", "proof.pdf", "application/pdf", 10, "approved", "clean",
             "COMP-1", uploaded_at, None, "COMP-1", 99)
        ]
        marking_cursor = MagicMock()
        marking_cursor.fetchall.side_effect = [[("901",)], [("COMP-1", "accepted")]]
        connection = MagicMock()
        connection.cursor.side_effect = [CursorContext(list_cursor), CursorContext(marking_cursor)]

        with patch.object(evidence, "_conn", return_value=connection):
            response = inspect.unwrap(evidence.list_evidence)(
                self.factory.get("/evidence/"), kind="commercial", pk=42
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(connection.cursor.call_count, 2)
        self.assertEqual(list_cursor.execute.call_count + marking_cursor.execute.call_count, 3)
        self.assertEqual(json.loads(response.content)["results"][0]["markingStatus"], "accepted")

    def test_staff_read_permission_remains_before_evidence_query(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        connection = MagicMock()
        connection.cursor.return_value = CursorContext(cursor)
        staff = SimpleNamespace(role="staff", subject_type="staff", subject_id=7)
        request = self.factory.get("/learner/evidence/commercial/42/")

        with patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}), \
             patch("login.permissions.authenticate_request", return_value=staff), \
             patch.object(evidence, "_conn", return_value=connection):
            response = evidence.list_evidence(request, kind="commercial", pk=42)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"results": []})
        self.assertEqual(cursor.execute.call_count, 1)
