"""SQL-shape regressions for learner-scoped canonical KSB readers."""
from unittest import TestCase
from unittest.mock import MagicMock

from .aptem_ksb_breakdown import read_breakdown
from .ksb_domain import point_counts_sql


class LearnerScopedKsbReaderTests(TestCase):
    def test_point_counts_scope_progress_before_the_ksb_relationship(self):
        sql = point_counts_sql()

        self.assertTrue(sql.startswith('WITH canonical AS'))
        self.assertIn('WHERE p.learner_id=%s AND p.deleted_at IS NULL', sql)
        self.assertIn('FROM canonical entry', sql)
        self.assertIn('FROM canonical p', sql)
        self.assertNotIn('FROM "Learner".ksb_learner_progress k\n        JOIN "Learner".learner_progress_entries entry', sql)
        self.assertEqual(sql.count('"Learner".learner_progress_entries'), 1)

    def test_breakdown_scope_is_single_owner_and_does_not_repeat_eligibility(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = []

        read_breakdown(connection, 407)

        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [407])
        self.assertTrue(sql.startswith('WITH canonical AS'))
        self.assertIn('WHERE p.learner_id=%s AND p.deleted_at IS NULL', sql)
        self.assertIn('FROM canonical entry', sql)
        self.assertIn("k.is_excluded=false AND k.mapping_status='verified'", sql)
        self.assertNotIn('EXISTS (SELECT 1 FROM', sql)
        self.assertEqual(sql.count('"Learner".learner_progress_entries'), 1)

    def test_breakdown_code_filter_keeps_the_same_parameter_contract(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = []

        read_breakdown(connection, 407, code='K1')

        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [407, 'K1'])
        self.assertIn('WHERE k.ksb_code=%s', sql)
