"""Actual booking policy with mocked storage; no application startup or database."""
import ast
import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


class ResubmissionBookingTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.create_connection'):
            blocker = patch(target, side_effect=AssertionError('No network allowed'))
            blocker.start()
            self.addCleanup(blocker.stop)
        source = Path(__file__).with_name('monthly_assignment.py')
        names = {'text', 'mapping', 'items', 'resubmission_booking_satisfied'}
        nodes = [n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name in names]
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value.__enter__.return_value
        self.ns = {'__package__': 'learner_api', 'connections': {'enrolment': self.connection}}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), self.ns)
        self.payload = {'learnerKind': 'commercial', 'learnerId': '101', 'activityId': 'COMP-1',
                        'monthlyAssignment': {'month': '2026-09'}}
        self.original = {'monthlyAssignment': {'month': '2026-09', 'meetingKey': 'original-booking'},
                         'qualityChecks': [{'key': 'meeting', 'passed': True}]}

    def check(self, status, stored):
        self.cursor.fetchone.return_value = (status, stored)
        return self.ns['resubmission_booking_satisfied'](self.payload)

    def test_rejected_original_booking_is_reused_without_calendar_mutations(self):
        self.assertTrue(self.check('rejected', self.original))
        sql, params = self.cursor.execute.call_args.args
        self.assertTrue(sql.startswith('SELECT '))
        self.assertIn("activity_type = 'assignment'", sql)
        self.assertEqual(params, ['commercial', '101', 'COMP-1'])

    def test_revision_draft_keeps_exemption_from_server_history(self):
        self.assertTrue(self.check('draft', json.dumps({'assignmentAttemptHistory': [
            {'status': 'rejected', 'content': self.original}]})))

    def test_first_submission_and_other_statuses_require_booking(self):
        for status in ('draft', 'accepted', 'submitted_for_tutor_review', 'referred'):
            with self.subTest(status=status):
                self.assertFalse(self.check(status, self.original))

    def test_client_cannot_forge_rejection_or_booking_history(self):
        self.payload.update(status='rejected', assignmentAttemptHistory=[{'status': 'rejected', 'content': self.original}])
        self.assertFalse(self.check('draft', {}))
        self.cursor.fetchone.return_value = None
        self.assertFalse(self.ns['resubmission_booking_satisfied'](self.payload))

    def test_exemption_does_not_cross_months(self):
        self.payload['monthlyAssignment']['month'] = '2026-10'
        self.assertFalse(self.check('rejected', self.original))

    def test_missing_or_unverified_original_booking_is_not_exempt(self):
        self.original['qualityChecks'][0]['passed'] = False
        self.assertFalse(self.check('rejected', self.original))
        self.original['qualityChecks'][0]['passed'] = True
        self.original['monthlyAssignment']['meetingKey'] = ''
        self.assertFalse(self.check('rejected', self.original))

    def test_latest_attempt_must_be_rejected(self):
        self.assertFalse(self.check('draft', {'assignmentAttemptHistory': [
            {'status': 'rejected', 'content': self.original}, {'status': 'accepted', 'content': self.original}]}))

    def test_imported_history_is_not_exempt(self):
        self.original['submissionOrigin'] = 'imported_legacy'
        self.assertFalse(self.check('rejected', self.original))
