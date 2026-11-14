from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from .legacy_ksbs import LEGACY_KSB_READ_SQL, read_legacy_learner_ksbs
from .models import LearnerKsbAssignment, LearnerProfile


class _MissingAssignmentProfile:
    pk = 41
    _state = SimpleNamespace(db="enrolment")

    @property
    def ksb_assignment(self):
        raise LearnerKsbAssignment.DoesNotExist


class LearnerKsbSourceTests(SimpleTestCase):
    def test_canonical_assignment_remains_primary(self):
        definitions = MagicMock()
        definitions.all.return_value = [
            SimpleNamespace(
                code="K1", number="1", ksb_type="Knowledge",
                description="Canonical knowledge",
            ),
        ]
        profile = SimpleNamespace(
            ksb_assignment=SimpleNamespace(
                profile_version=SimpleNamespace(definitions=definitions),
            ),
        )

        with patch("learner_api.legacy_ksbs.read_legacy_learner_ksbs") as legacy:
            result = LearnerProfile.ksbs.fget(profile)

        self.assertEqual(result, [{
            "code": "K1",
            "number": "1",
            "type": "Knowledge",
            "description": "Canonical knowledge",
        }])
        legacy.assert_not_called()

    def test_profile_without_assignment_uses_learner_scoped_adapter(self):
        expected = [{
            "code": "S2", "number": "", "type": "Skill",
            "description": "Saved skill", "level": "Occasionally",
        }]
        profile = _MissingAssignmentProfile()
        with patch(
            "learner_api.legacy_ksbs.read_legacy_learner_ksbs",
            return_value=expected,
        ) as legacy:
            result = LearnerProfile.ksbs.fget(profile)
            repeated = LearnerProfile.ksbs.fget(profile)

        self.assertEqual(result, expected)
        self.assertIs(repeated, result)
        legacy.assert_called_once_with(41, using="enrolment")

    def test_database_errors_are_not_silently_changed_to_empty_data(self):
        with patch(
            "learner_api.legacy_ksbs.read_legacy_learner_ksbs",
            side_effect=DatabaseError("unavailable"),
        ):
            with self.assertRaises(DatabaseError):
                LearnerProfile.ksbs.fget(_MissingAssignmentProfile())


class LegacyLearnerKsbAdapterTests(SimpleTestCase):
    def connection(self, rows=None, failure=None):
        cursor = MagicMock()
        cursor.fetchall.return_value = list(rows or [])
        if failure is not None:
            cursor.execute.side_effect = failure
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        return connection, cursor

    def read(self, rows=None, failure=None, learner_id=41):
        connection, cursor = self.connection(rows, failure)
        with patch.dict("learner_api.legacy_ksbs.connections", {"enrolment": connection}):
            result = read_legacy_learner_ksbs(learner_id)
        return result, cursor

    def test_missing_legacy_rows_are_an_empty_list(self):
        result, _ = self.read([])
        self.assertEqual(result, [])

    def test_multiple_rows_preserve_contract_and_assessment_level(self):
        result, _ = self.read([
            ("Behaviour", "B1", "Saved behaviour", None),
            ("Knowledge", "K1", "Saved knowledge", "Moderate understanding"),
            ("Skill", "S1", "Saved skill", "Frequently"),
        ])
        self.assertEqual(result, [
            {"code": "B1", "number": "", "type": "Behaviour",
             "description": "Saved behaviour", "level": ""},
            {"code": "K1", "number": "", "type": "Knowledge",
             "description": "Saved knowledge", "level": "Moderate understanding"},
            {"code": "S1", "number": "", "type": "Skill",
             "description": "Saved skill", "level": "Frequently"},
        ])

    def test_unknown_category_is_preserved_without_guessing(self):
        result, _ = self.read([("Emerging", "X1", "Unknown category", "Observed")])
        self.assertEqual(result[0]["type"], "Emerging")
        self.assertEqual(result[0]["code"], "X1")

    def test_duplicate_snapshot_identity_is_not_returned_twice(self):
        row = ("Knowledge", "K1", "Saved knowledge", None)
        result, _ = self.read([row, row])
        self.assertEqual(len(result), 1)

    def test_query_uses_only_actual_columns_and_owner_id(self):
        _, cursor = self.read([], learner_id=73)
        sql, params = cursor.execute.call_args.args
        normalized = " ".join(sql.split()).lower()
        self.assertEqual(params, [73])
        self.assertIn("select category, code, title, level", normalized)
        self.assertIn("where learner_id = %s", normalized)
        for removed in (" position", " number", " ksb_type", " description", " id"):
            self.assertNotIn(removed, normalized)
        self.assertEqual(sql, LEGACY_KSB_READ_SQL)

    def test_different_owners_are_queried_independently(self):
        _, first = self.read([], learner_id=41)
        _, second = self.read([], learner_id=42)
        self.assertEqual(first.execute.call_args.args[1], [41])
        self.assertEqual(second.execute.call_args.args[1], [42])

    def test_database_error_propagates(self):
        with self.assertRaises(DatabaseError):
            self.read(failure=DatabaseError("connection lost"))

    def test_unsaved_profile_has_no_legacy_owner(self):
        connection, cursor = self.connection()
        with patch.dict("learner_api.legacy_ksbs.connections", {"enrolment": connection}):
            self.assertEqual(read_legacy_learner_ksbs(None), [])
        cursor.execute.assert_not_called()
