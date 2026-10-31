from unittest.mock import patch

from django.test import SimpleTestCase

from . import review_instances


class LearnerReviewAdditionProjectionTests(SimpleTestCase):
    def test_learner_calendar_reads_only_the_review_addition_projection(self):
        expected = [{
            'id': 'LRA-1', 'review_template_id': 'RT-1',
            'programme_id': 'P-1', 'learner_id': 21,
            'target_date': '2026-10-30', 'reason_code': 'learner-request',
            'reason': 'Requested', 'deleted_at': None,
        }]
        with patch.object(review_instances, 'ensure_learner_review_additions_table'), \
             patch.object(review_instances.curriculum_views, 'fetch_all', return_value=expected) as fetch:
            result = review_instances.list_active_learner_review_additions('P-1', 21)

        self.assertEqual(result, expected)
        sql, params = fetch.call_args.args
        self.assertNotIn('select *', sql.casefold())
        for column in review_instances.LEARNER_REVIEW_ADDITION_READ_COLUMNS:
            self.assertIn(f'"{column}"', sql)
        for audit_column in ('created_by', 'created_at', 'updated_by', 'updated_at', 'deleted_by'):
            self.assertNotIn(f'"{audit_column}"', sql)
        self.assertEqual(params, ['P-1', 21])
