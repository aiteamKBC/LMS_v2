"""Evidence removal must agree with saved attempts without touching storage."""
import inspect
import json
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import evidence
from .evidence_retention import retained_by_submission


class EvidenceRetentionTests(SimpleTestCase):
    def row(self, status='draft', payload=None, activity='COMP-1', names=None):
        return (activity, status, payload or {}, names or [])

    def test_a_first_draft_can_replace_its_mistaken_upload(self):
        rows = [self.row(payload={'monthlyAssignment': {'evidence': [{'id': 'old'}]}})]
        self.assertFalse(retained_by_submission(rows, 'old', 'wrong.pdf', 'COMP-1'))

    def test_returned_attempt_retains_its_file_but_not_a_new_upload(self):
        for status in ('rejected', 'referred', 'accepted', 'submitted_for_tutor_review'):
            with self.subTest(status=status):
                rows = [self.row(status, {'monthlyAssignment': {'evidence': [{'id': 'old'}]}})]
                self.assertTrue(retained_by_submission(rows, 'old', 'wrong.pdf', 'COMP-1'))
                self.assertFalse(retained_by_submission(rows, 'new', 'correct.pdf', 'COMP-1'))

    def test_revision_draft_keeps_archived_files_and_feedback_unchanged(self):
        payload = {'assignmentAttemptHistory': [{'status': 'rejected', 'coachFeedback': 'Revise',
            'content': {'monthlyAssignment': {'evidence': [{'id': 'old'}]}}}]}
        before = json.dumps(payload)
        self.assertTrue(retained_by_submission([self.row(payload=payload)], 'old', 'old.pdf', 'COMP-1'))
        self.assertFalse(retained_by_submission([self.row(payload=payload)], 'new', 'new.pdf', 'COMP-1'))
        self.assertEqual(json.dumps(payload), before)

    def test_reused_file_is_retained_by_another_activities_submission(self):
        rows = [self.row('accepted', {'monthlyAssignment': {'evidence': [{'id': 'old'}]}}, activity='COMP-2')]
        self.assertTrue(retained_by_submission(rows, 'old', 'old.pdf', 'COMP-1'))

    def test_legacy_names_and_uploaded_presentations_remain_protected(self):
        self.assertTrue(retained_by_submission([self.row('rejected', names=['old.pdf'])], 'old', 'old.pdf', 'COMP-1'))
        payload = {'monthlyAssignment': {'uploadedPresentation': {'id': 'presentation'}}}
        self.assertTrue(retained_by_submission([self.row('rejected', payload)], 'presentation', 'slides.pptx', 'COMP-1'))
        self.assertFalse(retained_by_submission([self.row('rejected', names=['same.pdf'], activity='COMP-2')], 'new', 'same.pdf', 'COMP-1'))

    def test_malformed_history_and_unavailable_storage_fail_closed(self):
        self.assertFalse(evidence._can_delete_evidence('draft', None, 'file', 'file.pdf', 'COMP-1'))
        self.assertFalse(evidence._can_delete_evidence('draft', [self.row(payload={'assignmentAttemptHistory': 'bad'})], 'file', 'file.pdf', 'COMP-1'))
        self.assertFalse(evidence._can_delete_evidence('draft', [self.row(payload={'assignmentAttemptHistory': [{'status': 'rejected'}]})], 'file', 'file.pdf', 'COMP-1'))
        for status in ('accepted', 'submitted_for_tutor_review', 'partial', 'unknown'):
            self.assertFalse(evidence._can_delete_evidence(status, [], 'file', 'file.pdf', 'COMP-1'))

    def test_list_and_delete_agree_and_never_delete_a_historical_blob(self):
        for kind in ('commercial', 'apprenticeship'):
            for retained in (False, True):
                with self.subTest(kind=kind, retained=retained):
                    connection = MagicMock()
                    cursor = connection.cursor.return_value.__enter__.return_value
                    cursor.fetchall.return_value = [('file-id', 'wrong.pdf', 'application/pdf', 12, 'approved', 'clean', 'COMP-1', None, None, 'COMP-1', None)]
                    cursor.fetchone.return_value = ('blob', 'approved', 'COMP-1', None, 'wrong.pdf')
                    submissions = [('COMP-1', 'draft', {'assignmentAttemptHistory': [{'status': 'rejected', 'content': {'evidenceFiles': ['wrong.pdf']}}]} if retained else {}, [])]
                    with patch.object(evidence, '_conn', return_value=connection), \
                         patch.object(evidence, 'ensure_evidence_tables'), \
                         patch.object(evidence, '_marking_status', return_value='draft'), \
                         patch.object(evidence, '_evidence_submissions', return_value=submissions), \
                         patch.object(evidence, 'azure_configured', return_value=True), \
                         patch.object(evidence, 'delete_blob') as delete_blob, \
                         patch.object(evidence, '_record_evidence_file'):
                        listing = inspect.unwrap(evidence.list_evidence)(RequestFactory().get('/'), kind=kind, pk=101)
                        self.assertEqual(json.loads(listing.content)['results'][0]['canDelete'], not retained)
                        response = inspect.unwrap(evidence.delete_evidence)(RequestFactory().delete('/'), kind=kind, pk=101, file_id='file-id')
                        self.assertEqual(response.status_code, 409 if retained else 200)
                        self.assertEqual(delete_blob.call_count, 0 if retained else 1)

    def test_history_lookup_is_scoped_by_learner_and_kind(self):
        connection = MagicMock()
        with patch.object(evidence, '_conn', return_value=connection), \
             patch.object(evidence, '_learner_profile_ids_for_source', return_value=['248']):
            evidence._evidence_submissions('apprenticeship', '101')
        sql, params = connection.cursor.return_value.__enter__.return_value.execute.call_args.args
        self.assertIn('learner_kind = %s and learner_id::text = any(%s)', sql)
        self.assertEqual(params, ['apprenticeship', ['101', '248']])
