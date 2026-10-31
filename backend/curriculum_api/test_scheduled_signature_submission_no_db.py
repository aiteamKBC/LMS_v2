"""Scheduled Native submission rules with all database access mocked."""
from contextlib import nullcontext
from inspect import unwrap
from unittest.mock import patch

from django.test import SimpleTestCase

from . import review_instances as reviews


class ScheduledSignatureSubmissionTests(SimpleTestCase):
    def run_submission(self, *, status='scheduled', signatures=None, missing=None, updated=True, locked_status=None):
        row = {'id': 'synthetic', 'status': status, 'definition_snapshot': {
            'signatures': signatures if signatures is not None else {'advisor': True}, 'sections': []}}
        locked = {**row, 'status': locked_status or status}
        with patch.object(reviews.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(reviews, 'get_review_instance', return_value=locked), \
             patch.object(reviews, '_refresh_locked_editable_definition_snapshot', side_effect=lambda row, **_: row), \
             patch.object(reviews, '_save_review_instance_answers_locked', side_effect=lambda row, *a, **kw: row) as save, \
             patch.object(reviews, 'get_review_instance_answers', return_value={}), \
             patch.object(reviews, '_visible_required_unanswered_fields', return_value=missing or []), \
             patch.object(reviews.curriculum_views, 'update_rows', return_value=[{}] if updated else []) as update:
            result = unwrap(reviews.complete_review_instance)(row, actor='coach@example.invalid', answers={})
            return result, update, save

    def test_scheduled_signature_submission_is_guarded_and_does_not_start_meeting(self):
        (ok, errors), update, _ = self.run_submission()
        self.assertTrue(ok)
        self.assertIsNone(errors)
        self.assertEqual(update.call_args.args[2], ['synthetic', 'scheduled'])
        self.assertEqual(update.call_args.args[3]['status'], 'awaiting-signature')
        self.assertNotIn('started_at', update.call_args.args[3])

    def test_scheduled_submission_still_requires_answers(self):
        (ok, errors), update, _ = self.run_submission(missing=['required'])
        self.assertFalse(ok)
        self.assertEqual(errors, {'fields': ['required']})
        update.assert_not_called()

    def test_scheduled_without_signatures_is_rejected_before_saving_answers(self):
        (ok, errors), update, save = self.run_submission(signatures={})
        self.assertFalse(ok)
        self.assertIn('status', errors)
        update.assert_not_called()
        save.assert_not_called()

    def test_status_change_under_lock_is_rejected(self):
        (ok, errors), update, _ = self.run_submission(locked_status='completed')
        self.assertFalse(ok)
        self.assertIn('status', errors)
        update.assert_not_called()

    def test_failed_conditional_update_is_reported(self):
        (ok, errors), _, _ = self.run_submission(updated=False)
        self.assertFalse(ok)
        self.assertIn('status', errors)

