"""Evidence reads and document ownership without a test database or schema writes."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import json

from django.test import SimpleTestCase, RequestFactory
from . import historical_evidence as history


def source(**changes):
    return {'evidence_id': 123, 'evidence_name': 'Assignment.docx', 'component_name': 'Leadership - Assignment',
        'evidence_kind': 'File', 'evidence_status': 'Accepted', 'evidence_date': date(2026, 8, 7),
        'file_blob': '42/assignment.docx', 'report_blob': '42/assessment.pdf', 'note_blob': None,
        'note_content': '<p>Saved reflection</p>', 'note_preview': 'Saved reflection', 'feedbacks': '[{"author":"Coach","message":"Accepted work"}]',
        'spent_time': 90, 'ksb_codes': '["K1", "S2"]', **changes}


class HistoricalEvidenceTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(role='learner', subject_id=7)

    def call(self, view, *, pk=7, query=None, **kwargs):
        request = self.factory.get('/', data=query or {})
        with patch('login.permissions.authenticate_request', return_value=self.account), \
             patch('login.permissions._auth_gate_enabled', return_value=True):
            return view(request, kind='apprenticeship', pk=pk, **kwargs)

    def test_other_learners_cannot_list_or_open_evidence(self):
        with patch.object(history, 'resolve_aptem') as resolve:
            for view, kwargs in [(history.list_historical_evidence, {}),
                (history.historical_evidence_detail, {'source': 'aptem', 'source_id': 123}),
                (history.open_historical_document, {'source': 'aptem', 'source_id': 123})]:
                self.assertEqual(self.call(view, pk=8, **kwargs).status_code, 404)
            resolve.assert_not_called()

    def test_identity_requires_matching_kind_email_link_and_unique_owner(self):
        cursor = MagicMock()
        with patch.object(history, 'dict_rows', return_value=[{'kind': 'apprenticeship', 'aptem_id': '42', 'verified_id': 42, 'links': 1}]):
            self.assertEqual(history.resolve_aptem(cursor, 'apprenticeship', 7), 42)
            with self.assertRaises(history.EvidenceError):
                history.resolve_aptem(cursor, 'commercial', 7)
        for verified, links in [(None, 1), (42, 2)]:
            with patch.object(history, 'dict_rows', return_value=[{'kind': 'apprenticeship', 'aptem_id': '42', 'verified_id': verified, 'links': links}]):
                with self.assertRaises(history.EvidenceError) as error:
                    history.resolve_aptem(cursor, 'apprenticeship', 7)
                self.assertEqual(error.exception.status, 409)
        self.assertIn('u."Email"', cursor.execute.call_args.args[0])

    def test_no_previous_link_is_an_empty_library(self):
        with patch.object(history, 'connections'), patch.object(history, 'resolve_aptem', return_value=None), patch.object(history, 'source_rows') as rows:
            response = self.call(history.list_historical_evidence)
        self.assertEqual(json.loads(response.content), {'items': [], 'total': 0})
        rows.assert_not_called()
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_source_reads_are_owner_scoped_and_never_create_tables(self):
        cursor = MagicMock()
        cursor.description = []
        cursor.fetchall.return_value = []
        tables = {history.EVIDENCE_ITEMS, history.CLASSIFICATIONS, history.EVIDENCE_OVERRIDES, history.EVIDENCE_REPLACEMENTS, history.ARCHIVES}
        history.source_rows(cursor, 42, tables, 123)
        sql, params = cursor.execute.call_args.args
        self.assertTrue(sql.strip().startswith('SELECT'))
        self.assertIn('e.learner_id=%s', sql)
        self.assertIn('e.evidence_id=%s', sql)
        self.assertIn('archive.archived_at IS NOT NULL', sql)
        self.assertEqual(params, [42, 123])
        history.source_rows(cursor, 42, {history.EVIDENCE_ITEMS})
        sql = cursor.execute.call_args.args[0]
        self.assertNotIn('LEFT JOIN', sql)
        self.assertIn('NULL AS override_name', sql)
        self.assertNotIn('CREATE', sql)

    def test_missing_source_does_not_look_like_zero_evidence(self):
        with self.assertRaises(history.EvidenceError) as error:
            history.source_rows(MagicMock(), 42, set())
        self.assertEqual(error.exception.status, 503)

    def test_audit_overrides_and_all_categories_are_preserved(self):
        rows = [source(override_name='Reviewed assignment', override_category='assignment'),
                source(evidence_id=124, component_name='Progress Review', evidence_status='Awaiting review')]
        items = history.project_source(rows, 42)
        self.assertEqual(items[0]['name'], 'Reviewed assignment')
        self.assertEqual(items[0]['status'], 'Accepted')
        self.assertEqual(items[0]['ksb_codes'], ['K1', 'S2'])
        self.assertEqual(items[1]['category'], 'review')
        self.assertEqual(items[1]['status'], 'Awaiting review')
        self.assertNotIn('file_blob', items[0])

    def test_document_detail_retains_original_report_note_and_feedback(self):
        row = source(replacement_blob='replacement/new.docx', replacement_name='Updated.docx', replacement_container='evidence-replacements')
        with patch.object(history, 'resolve_aptem', return_value=42), patch.object(history, 'available_tables', return_value=set()), patch.object(history, 'source_rows', return_value=[row]):
            item, docs, note, feedback = history.load_detail(MagicMock(), 'apprenticeship', 7, 'aptem', 123)
        self.assertEqual([d['part'] for d in docs], ['file', 'report', 'original'])
        self.assertEqual(docs[0]['blob'], 'replacement/new.docx')
        self.assertTrue(docs[1]['name'].endswith('.pdf'))
        self.assertEqual(docs[1]['content_type'], 'application/pdf')
        self.assertEqual(note, '<p>Saved reflection</p>')
        self.assertEqual(feedback[0]['message'], 'Accepted work')

    def test_forged_evidence_id_never_mints_a_blob_url(self):
        with patch.object(history, 'connections'), patch.object(history, 'resolve_aptem', return_value=42), \
             patch.object(history, 'available_tables', return_value=set()), patch.object(history, 'source_rows', return_value=[]), \
             patch.object(history.evidence_storage, 'get_read_sas') as sign:
            response = self.call(history.open_historical_document, source='aptem', source_id=999, query={'part': 'file'})
        self.assertEqual(response.status_code, 404)
        sign.assert_not_called()

    def test_staff_can_read_a_selected_learners_file_and_bad_parts_are_rejected(self):
        self.account.role = 'staff'
        doc = {'part': 'report', 'name': 'Assessment.pdf', 'container': 'fetch-aptem-evidences', 'blob': '42/report.pdf', 'content_type': 'application/pdf'}
        with patch.object(history, 'connections'), patch.object(history, 'load_detail', return_value=({}, [doc], None, [])), \
             patch.object(history.evidence_storage, 'azure_configured', return_value=True), \
             patch.object(history.evidence_storage, 'get_read_sas', return_value='https://files.example.test/report.pdf') as sign, \
             patch.object(history.evidence_storage, 'get_download_sas', return_value='https://files.example.test/download.pdf'):
            bad = self.call(history.open_historical_document, source='aptem', source_id=123, query={'part': '../../other'})
            self.assertEqual(bad.status_code, 404)
            sign.assert_not_called()
            response = self.call(history.open_historical_document, source='aptem', source_id=123, query={'part': 'report'})
        self.assertEqual(response.status_code, 200)
        sign.assert_called_once_with('fetch-aptem-evidences', '42/report.pdf')

    def test_manual_documents_are_scoped_and_mirrored_copies_are_not_duplicated(self):
        cursor = MagicMock()
        cursor.description = []
        cursor.fetchall.return_value = []
        history.manual_documents(cursor, 42, {history.MANUAL_ROWS, history.MANUAL_DOCS, history.EVIDENCE_ITEMS}, 19)
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [42, 19])
        self.assertIn('r.aptem_id=d.aptem_id', sql)
        self.assertIn('NOT EXISTS', sql)
        self.assertIn('d.deleted_at IS NULL', sql)
        self.assertIn('r.deleted_at IS NULL', sql)

    def test_auditor_uploads_and_selected_activities_require_an_owned_active_record(self):
        cursor = MagicMock()
        cursor.description = []
        cursor.fetchall.return_value = []
        history.uploaded_rows(cursor, 42, {history.ARCHIVES, history.MANUAL_ROWS}, 'audit-file-123')
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [42, 'audit-file-123'])
        self.assertIn('o.learner_id=%s', sql)
        self.assertIn('r.aptem_id=o.learner_id', sql)
        self.assertIn('o.archived_at IS NULL', sql)
        self.assertIn('o.deleted_at IS NULL', sql)
        self.assertIn('r.deleted_at IS NULL', sql)
        with patch.object(history, 'connections'), patch.object(history, 'resolve_aptem', return_value=42), \
             patch.object(history, 'available_tables', return_value={history.ARCHIVES}), \
             patch.object(history, 'uploaded_rows', return_value=[]), \
             patch.object(history.evidence_storage, 'get_read_sas') as sign:
            response = self.call(history.open_historical_document, source='uploaded', source_id='audit-other-person', query={'part': 'file'})
        self.assertEqual(response.status_code, 404)
        sign.assert_not_called()

    def test_uploaded_file_and_selected_activity_use_the_existing_documents(self):
        row = {'evidence_id': 'audit-123', 'document_name': 'Uploaded assignment.pdf', 'component_name': 'Assignment',
            'evidence_status': 'Uploaded', 'evidence_date': date(2026, 8, 7), 'azure_container': 'evidence-approved',
            'azure_blob_name': '42/test.pdf', 'source_activity_id': None, 'source_activity_category': None,
            'source_activity_month': None, 'activity_id': None}
        with patch.object(history, 'resolve_aptem', return_value=42), patch.object(history, 'available_tables', return_value=set()), \
             patch.object(history, 'uploaded_rows', return_value=[row]):
            item, docs, _, _ = history.load_detail(MagicMock(), 'apprenticeship', 7, 'uploaded', 'audit-123')
        self.assertEqual(item['status'], 'Uploaded')
        self.assertEqual(item['category'], 'assignment')
        self.assertEqual(docs[0]['content_type'], 'application/pdf')
        activity = {**row, 'azure_container': None, 'azure_blob_name': None, 'activity_id': 19,
            'activity_title': 'Saved assignment', 'activity_category': 'assignment', 'activity_month': '2026-08',
            'activity_activity_date': date(2026, 8, 1), 'activity_completion_note': 'Completed',
            'activity_actual_hours': 2, 'activity_planned_hours': 3, 'activity_accepted': True}
        with patch.object(history, 'resolve_aptem', return_value=42), patch.object(history, 'available_tables', return_value=set()), \
             patch.object(history, 'uploaded_rows', return_value=[activity]), patch.object(history, 'manual_documents', return_value=[]) as documents:
            item, _, note, _ = history.load_detail(MagicMock(), 'apprenticeship', 7, 'uploaded', 'audit-123')
        self.assertEqual(item['activity']['id'], 19)
        self.assertEqual(item['activity']['month'], '2026-08')
        self.assertEqual(note, 'Completed')
        self.assertTrue(documents.call_args.kwargs['include_mirrored'])

    def test_feedback_exposes_only_display_fields_and_ignores_malformed_entries(self):
        self.assertEqual(history.feedback_list('[null,"wrong",{"message":"Saved", "report_url":"private", "id":1}]'),
                         [{'id': '1', 'message': 'Saved'}])
        self.assertEqual(history.feedback_list('invalid'), [])
