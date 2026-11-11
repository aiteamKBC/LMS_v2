"""Scheduled Native submission rules with all database access mocked."""
from contextlib import nullcontext
from inspect import unwrap
from unittest.mock import patch

from django.test import SimpleTestCase

from . import review_instances as reviews


class ScheduledSignatureSubmissionTests(SimpleTestCase):
    def run_submission(self, *, status='scheduled', signatures=None, missing=None, updated=True, locked_status=None, type_code='progress_review'):
        row = {'id': 'synthetic', 'status': status, 'definition_snapshot': {
            'reviewTypeCode': type_code,
            'signatures': signatures if signatures is not None else {'advisor': True}, 'sections': []}}
        locked = {**row, 'status': locked_status or status}
        with patch.object(reviews.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(reviews, 'get_review_instance', return_value=locked), \
             patch.object(reviews, '_refresh_locked_editable_definition_snapshot', side_effect=lambda row, **_: row), \
             patch.object(reviews, '_save_review_instance_answers_locked', side_effect=lambda row, *a, **kw: row) as save, \
             patch.object(reviews, 'get_review_instance_answers', return_value={}), \
             patch.object(reviews, '_visible_required_unanswered_fields', return_value=missing or []), \
             patch.object(reviews.curriculum_views, 'update_rows',
                          side_effect=lambda table, where, params, values: [{**locked, **values}] if updated else []) as update:
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

    def test_scheduled_without_signatures_completes_without_attendance(self):
        (ok, errors), update, save = self.run_submission(signatures={})
        self.assertTrue(ok, errors)
        self.assertEqual(update.call_args.args[3]['status'], 'completed')
        self.assertNotIn('started_at', update.call_args.args[3])
        save.assert_called_once()

    def test_status_change_under_lock_is_rejected(self):
        (ok, errors), update, _ = self.run_submission(locked_status='completed')
        self.assertFalse(ok)
        self.assertIn('status', errors)
        update.assert_not_called()

    def test_failed_conditional_update_is_reported(self):
        (ok, errors), _, _ = self.run_submission(updated=False)
        self.assertFalse(ok)
        self.assertIn('status', errors)

    def test_mcm_submission_does_not_require_a_booking_or_attendance(self):
        for status in ('not-scheduled', 'scheduled', 'in-progress'):
            with self.subTest(status=status):
                (ok, errors), update, _ = self.run_submission(status=status, type_code='mcm')
                self.assertTrue(ok, errors)
                self.assertEqual(update.call_args.args[2], ['synthetic', status])
                self.assertEqual(update.call_args.args[3]['status'], 'awaiting-signature')
                self.assertNotIn('started_at', update.call_args.args[3])

    def test_mcm_without_required_signatures_completes_without_booking(self):
        (ok, errors), update, _ = self.run_submission(status='not-scheduled', type_code='mcm', signatures={})
        self.assertTrue(ok, errors)
        self.assertEqual(update.call_args.args[2], ['synthetic', 'not-scheduled'])
        self.assertEqual(update.call_args.args[3]['status'], 'completed')
        self.assertIsNotNone(update.call_args.args[3]['completed_at'])

    def test_unbooked_mcm_still_requires_answers_and_rechecks_locked_status(self):
        (ok, errors), update, _ = self.run_submission(status='not-scheduled', type_code='mcm', missing=['required'])
        self.assertFalse(ok)
        self.assertEqual(errors, {'fields': ['required']})
        update.assert_not_called()
        for locked_status in ('awaiting-signature', 'completed'):
            with self.subTest(locked_status=locked_status):
                (ok, errors), update, save = self.run_submission(
                    status='not-scheduled', type_code='mcm', locked_status=locked_status)
                self.assertFalse(ok)
                self.assertIn('status', errors)
                update.assert_not_called()
                save.assert_not_called()

    def test_unbooked_progress_review_also_requires_fields_and_signatures(self):
        for signatures, expected in (({'advisor': True}, 'awaiting-signature'), ({}, 'completed')):
            with self.subTest(signatures=signatures):
                (ok, errors), update, save = self.run_submission(
                    status='not-scheduled', type_code='progress_review', signatures=signatures)
                self.assertTrue(ok, errors)
                self.assertEqual(update.call_args.args[3]['status'], expected)
                self.assertNotIn('started_at', update.call_args.args[3])
                save.assert_called_once()
        (ok, errors), update, _ = self.run_submission(status='not-scheduled', missing=['required'])
        self.assertFalse(ok)
        self.assertEqual(errors, {'fields': ['required']})
        update.assert_not_called()

    def test_submitted_progress_review_does_not_persist_a_template_refresh(self):
        row = {'id': 'synthetic', 'status': 'not-scheduled',
               'definition_snapshot': {'reviewTypeCode': 'progress_review', 'sections': []}}
        with patch.object(reviews.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(reviews, 'get_review_instance', return_value={**row, 'status': 'awaiting-signature'}), \
             patch.object(reviews, '_refresh_locked_editable_definition_snapshot',
                          side_effect=AssertionError('Rejected submission must not write a new snapshot')):
            ok, errors = unwrap(reviews.complete_review_instance)(row, answers={})
        self.assertFalse(ok)
        self.assertIn('status', errors)

