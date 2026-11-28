"""Read-only classification projection and file ownership tests; no real DB."""
from datetime import date, datetime, timezone
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.test import RequestFactory, SimpleTestCase
from .legacy_assignments import classified_rows, classified_submission, open_legacy_assignment_document, restored_rows


def source_row():
    return dict(evidence_id=20128, aptem_id=92, component_id=14499, evidence_name='Original.pdf',
                component_name='Old assignment', evidence_status='Accepted', file_blob='owned.pdf',
                report_blob='owned-report.pdf', feedbacks=[], submission_date=datetime(2026, 1, 4, tzinfo=timezone.utc),
                activity_date=date(2025, 6, 20), learner_name='Mohamed Elmasry', programme_name='Programme', run_id=4)


class LegacyAssignmentTests(SimpleTestCase):
    def test_archive_preview_checks_ownership_before_extracting(self):
        request = self.request()
        request.GET = request.GET.copy()
        request.GET.update({'part': 'file', 'delivery': 'preview'})
        row = {**source_row(), 'evidence_name': 'Submission.zip'}
        with patch('learner_api.legacy_assignments.classified_rows', return_value=[row]), \
             patch('learner_api.legacy_assignments.evidence_storage.azure_configured', return_value=True), \
             patch('learner_api.assignment_content._cached_extract', return_value={
                 'files': ['Notes.txt'], 'documents': [], 'notices': []}) as extract:
            self.assertEqual(unwrap(open_legacy_assignment_document)(request, 99).status_code, 404)
            extract.assert_not_called()
            response = unwrap(open_legacy_assignment_document)(request, 20128)
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, 'Notes.txt')
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            extract.assert_called_once()

    def test_projection_and_detail_query_follow_each_learner_identity(self):
        for kind, learner_id, aptem_id, evidence_id in (
            ('commercial', '501', 601, 701),
            ('apprenticeship', '502', 602, 702),
        ):
            with self.subTest(kind=kind):
                row = {**source_row(), 'aptem_id': aptem_id, 'evidence_id': evidence_id,
                       'learner_name': 'Another learner', 'run_id': 19}
                result = classified_submission(row, kind, learner_id)
                activity_id = f'aptem:{aptem_id}:evidence:{evidence_id}'
                self.assertEqual(result['activityId'], activity_id)
                self.assertEqual(result['learnerId'], learner_id)
                self.assertEqual(result['learnerKind'], kind)
                self.assertEqual(result['legacyAssignment']['runId'], 19)
                self.assertEqual(result['legacyAssignment']['documents'][0]['evidenceId'], evidence_id)
                cursor = MagicMock()
                cursor.description = [('evidence_id',)]
                cursor.fetchall.return_value = [(evidence_id,)]
                connection = MagicMock()
                connection.cursor.return_value.__enter__.return_value = cursor
                with patch('learner_api.legacy_assignments.connections', {'enrolment': connection}), \
                     patch('learner_api.legacy_assignments.restored_rows', return_value=[]):
                    self.assertEqual(classified_rows(kind, learner_id, activity_id),
                                     [{'evidence_id': evidence_id}])
                self.assertEqual(cursor.execute.call_args.args[1],
                                 [kind, learner_id, activity_id, activity_id])

    def test_word_content_is_served_from_owned_blob_with_download_limit(self):
        row = {**source_row(), 'evidence_name': 'Original.docx', 'file_blob': 'owned.docx'}
        request = self.request()
        request.GET = request.GET.copy()
        request.GET.update({'part': 'file', 'delivery': 'content'})
        with patch('learner_api.legacy_assignments.classified_rows', return_value=[row]), \
             patch('learner_api.legacy_assignments.evidence_storage.azure_configured', return_value=True), \
             patch('learner_api.legacy_assignments.evidence_storage.download_blob_bytes', return_value=b'word bytes') as download:
            response = unwrap(open_legacy_assignment_document)(request, 20128)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, b'word bytes')
            self.assertIn('wordprocessingml.document', response['Content-Type'])
            self.assertIn('attachment', response['Content-Disposition'])
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            download.assert_called_once_with('fetch-aptem-evidences', 'owned.docx', max_bytes=30 * 1024 * 1024)
            download.reset_mock()
            self.assertEqual(unwrap(open_legacy_assignment_document)(request, 53008).status_code, 404)
            download.assert_not_called()
            download.side_effect = ValueError('Too large')
            self.assertEqual(unwrap(open_legacy_assignment_document)(request, 20128).status_code, 413)

    def request(self):
        return RequestFactory().get('/', {'learnerKind': 'commercial', 'learnerId': '125',
            'activityId': 'aptem:92:evidence:20128', 'part': 'report'})

    def test_projection_preserves_dates_status_and_does_not_expose_blob_names(self):
        result = classified_submission(source_row(), 'commercial', '125')
        self.assertEqual(result['submissionOrigin'], 'classified_legacy')
        self.assertEqual(result['monthlyAssignment']['month'], '2025-06')
        self.assertEqual(result['status'], 'accepted')
        self.assertTrue(result['locked'])
        self.assertNotIn('owned.pdf', str(result))
        self.assertNotIn('assignmentAnswer', result)
        self.assertEqual(len(result['legacyAssignment']['documents']), 2)

    def test_query_scopes_identity_run_and_source_membership(self):
        cursor = MagicMock()
        cursor.description = [('evidence_id',)]
        cursor.fetchall.return_value = [(20128,)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch('learner_api.legacy_assignments.connections', {'enrolment': connection}), \
             patch('learner_api.legacy_assignments.restored_rows', return_value=[]):
            self.assertEqual(classified_rows('commercial', '125'), [{'evidence_id': 20128}])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, ['commercial', '125', '', ''])
        self.assertIn('u.aptem_id', sql)
        self.assertIn('u."Email"', sql)
        self.assertIn("r.status = 'completed'", sql)
        self.assertIn('source_evidence_ids', sql)
        self.assertNotIn('learning_reflection_submissions', sql)

    def test_report_is_resolved_from_classified_owned_source(self):
        with patch('learner_api.legacy_assignments.classified_rows', return_value=[source_row()]), \
             patch('learner_api.legacy_assignments.evidence_storage.azure_configured', return_value=True), \
             patch('learner_api.legacy_assignments.evidence_storage.get_read_sas', return_value='https://example.test/file') as sign, \
             patch('learner_api.legacy_assignments.evidence_storage.get_download_sas', return_value='https://example.test/download'):
            response = unwrap(open_legacy_assignment_document)(self.request(), 20128)
        self.assertEqual(response.status_code, 200)
        sign.assert_called_once_with('fetch-aptem-evidences', 'owned-report.pdf')

    def test_unclassified_or_unmatched_source_is_not_found(self):
        with patch('learner_api.legacy_assignments.classified_rows', return_value=[]):
            response = unwrap(open_legacy_assignment_document)(self.request(), 20128)
        self.assertEqual(response.status_code, 404)

    def test_cannot_open_a_different_evidence_id(self):
        with patch('learner_api.legacy_assignments.classified_rows', return_value=[source_row()]):
            response = unwrap(open_legacy_assignment_document)(self.request(), 53008)
        self.assertEqual(response.status_code, 404)

    def test_other_learner_is_blocked_before_database_access(self):
        with patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=126)), \
             patch('learner_api.legacy_assignments.classified_rows') as read:
            response = open_legacy_assignment_document(self.request(), 20128)
        self.assertEqual(response.status_code, 404)
        read.assert_not_called()


class RestoredAssignmentTests(SimpleTestCase):
    def test_restoration_does_not_duplicate_a_later_classified_upload(self):
        cursor = MagicMock()
        cursor.description = [('evidence_id',), ('run_id',)]
        cursor.fetchall.return_value = [(701, 19)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch('learner_api.legacy_assignments.connections', {'enrolment': connection}), \
             patch('learner_api.legacy_assignments.restored_rows', return_value=[
                 {'evidence_id': 701, 'run_id': None}, {'evidence_id': 702, 'run_id': None},
             ]) as restored:
            self.assertEqual(classified_rows('commercial', 501), [
                {'evidence_id': 701, 'run_id': 19}, {'evidence_id': 702, 'run_id': None},
            ])
        restored.assert_called_once_with('commercial', 501, '')

    def test_no_registry_preserves_existing_deployments_without_writes(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (None,)
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch('learner_api.legacy_assignments.connections', {'enrolment': connection}):
            self.assertEqual(restored_rows('commercial', 501), [])
        cursor.execute.assert_called_once()
        self.assertTrue(cursor.execute.call_args.args[0].startswith('SELECT to_regclass'))

    def test_registry_read_requires_owner_component_active_restore_and_requested_file(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = ('registry',)
        cursor.description = [('evidence_id',)]
        cursor.fetchall.return_value = [(701,)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), patch('learner_api.legacy_assignments.connections', {'enrolment': connection}):
                self.assertEqual(restored_rows(kind, 501, 'aptem:601:evidence:701'), [{'evidence_id': 701}])
            sql, params = cursor.execute.call_args.args
            self.assertEqual(params, [kind, '501', 'aptem:601:evidence:701', 'aptem:601:evidence:701'])
            for gate in ('r.enrolment_id=u.id', 'r.aptem_id=a."ID"', 'r.revoked_at IS NULL',
                         'e.learner_id=r.aptem_id', 'e.evidence_id=r.evidence_id',
                         'e.component_id=r.component_id', 'u."Email"'):
                self.assertIn(gate, sql)

    def test_unassessed_and_referred_uploads_keep_status_dates_and_read_only_files(self):
        for status in ('PendingAssessment', 'Referred', 'Accepted'):
            with self.subTest(status=status):
                row = {**source_row(), 'evidence_status': status, 'run_id': None,
                       'submission_origin': 'imported_legacy'}
                result = classified_submission(row, 'commercial', '501')
                self.assertEqual(result['status'], status.lower())
                self.assertEqual(result['legacyAssignment']['sourceStatus'], status)
                self.assertIsNone(result['legacyAssignment']['runId'])
                self.assertEqual(result['submittedAt'], row['submission_date'].isoformat())
                self.assertEqual(result['dateCompleted'], row['activity_date'].isoformat())
                self.assertEqual(result['submissionOrigin'], 'imported_legacy')
                self.assertTrue(result['locked'])
                self.assertEqual(len(result['legacyAssignment']['documents']), 2)
                self.assertNotIn('actualTimeHours', result)
                self.assertNotIn('assignmentAnswer', result)

    def test_restored_upload_without_completion_keeps_only_its_submission_date(self):
        row = {**source_row(), 'evidence_status': 'PendingAssessment',
               'original_completed_date': None, 'submission_origin': 'imported_legacy', 'run_id': None}
        result = classified_submission(row, 'commercial', '501')
        self.assertEqual(result['dateCompleted'], '')
        self.assertEqual(result['submittedAt'], row['submission_date'].isoformat())
        self.assertEqual(result['monthlyAssignment']['month'], row['activity_date'].isoformat()[:7])
