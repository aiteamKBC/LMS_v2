"""Focused ownership checks for reflection readers that feed learner pages."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .mappers import _component_marking_statuses
from .module_shift import _reviews_by_component


class CanonicalReflectionReaderTests(SimpleTestCase):
    def _cursor(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        return connection, cursor

    def test_learner_detail_binds_profile_id_and_kind_not_enrolment_id(self):
        for kind, enrolment_id, profile_id in (
            ("commercial", 125, 272),
            ("apprenticeship", 670, 1101),
        ):
            connection, cursor = self._cursor()
            source = SimpleNamespace(id=enrolment_id, learner_type=kind)
            profile = SimpleNamespace(
                id=profile_id, pk=profile_id, enrolment_id=enrolment_id, learner_type=kind,
            )
            with patch("django.db.connections", {"enrolment": connection}):
                self.assertEqual(_component_marking_statuses(source, profile), {})
            sql, params = cursor.execute.call_args.args
            self.assertIn("learner_id = %s and learner_kind = %s", sql)
            self.assertEqual(params, [profile_id, kind])
            self.assertNotIn(enrolment_id, params)

    def test_monthly_coaching_module_review_binds_same_owner_pair(self):
        component_ids = ["component-a", "component-b"]
        for kind, enrolment_id, profile_id in (
            ("commercial", 125, 272),
            ("apprenticeship", 670, 1101),
        ):
            connection, cursor = self._cursor()
            profile = SimpleNamespace(
                id=profile_id, pk=profile_id, enrolment_id=enrolment_id, learner_type=kind,
            )
            with patch("learner_api.module_shift.connections", {"enrolment": connection}):
                self.assertEqual(_reviews_by_component(profile, component_ids), {})
            sql, params = cursor.execute.call_args.args
            self.assertIn("learner_id = %s", sql)
            self.assertIn("learner_kind = %s", sql)
            self.assertEqual(params[:2], [profile_id, kind])
            self.assertNotIn(enrolment_id, params[:2])

