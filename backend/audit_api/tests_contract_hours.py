"""Training-plan upload regression tests; database and storage are mocked."""
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json
from unittest.mock import MagicMock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase

from learner_api.tests_training_plan_dashboard import contract_pdf
from .contract_documents import upload_contract


class ContractPlannedHoursUploadTests(SimpleTestCase):
    def upload(self, data, name='Training Plan.pdf'):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (9001, datetime(2026, 9, 12, tzinfo=timezone.utc))
        service = MagicMock(account_name='teststorage')
        client = service.get_blob_client.return_value
        uploaded = []
        client.upload_blob.side_effect = lambda chunks, **kwargs: uploaded.append(b''.join(chunks))
        request = RequestFactory().post('/audit_api/contracts/upload', {
            'learner_id': '4443', 'document_name': name,
            'file': SimpleUploadedFile(name, data, content_type='application/pdf'),
        })
        learner = {'name': 'Test learner', 'email': 'learner@example.test',
                   'programme': 'Test programme', 'programme_status': 'Delivery',
                   'break_in_learning': {}, 'programme_understanding': {}}
        with patch('audit_api.contract_documents._has_audit_permission', return_value=True), \
             patch('audit_api.contract_documents._learner_upload_metadata', return_value=learner), \
             patch('audit_api.contract_documents.resolve', return_value='enrolment'), \
             patch('audit_api.contract_documents.connections', {'enrolment': connection}), \
             patch('audit_api.contract_documents.transaction.atomic'), \
             patch('audit_api.contract_documents._azure_service_client', return_value=service):
            response = upload_contract(request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(uploaded, [data])
        sql, params = cursor.execute.call_args.args
        self.assertIn('training_plan_planned_hours', sql)
        self.assertEqual(sql.count('%s'), len(params))
        return json.loads(response.content), params[-1], json.loads(params[4])

    def test_upload_persists_verified_hours_and_pdf_provenance(self):
        data = contract_pdf()
        response, hours, raw = self.upload(data)
        self.assertEqual(hours, Decimal('30.00'))
        self.assertEqual(response['training_plan_planned_hours'], 30)
        self.assertEqual(response['training_plan_hours_status'], 'verified')
        self.assertEqual(raw['_training_plan_hours']['pdf_sha256'], sha256(data).hexdigest())
        self.assertEqual(raw['_training_plan_hours']['source'], 'learning-plan-table')

    def test_inconsistent_table_is_uploaded_with_unknown_hours_and_review_status(self):
        response, hours, raw = self.upload(contract_pdf(total=31))
        self.assertIsNone(hours)
        self.assertIsNone(response['training_plan_planned_hours'])
        self.assertEqual(response['training_plan_hours_status'], 'needs-review')
        self.assertNotIn('_training_plan_hours', raw)

    def test_unreadable_pdf_does_not_prevent_document_upload(self):
        with self.assertLogs('audit_api.contract_documents', level='WARNING'):
            response, hours, _ = self.upload(b'unreadable PDF')
        self.assertIsNone(hours)
        self.assertEqual(response['training_plan_hours_status'], 'needs-review')

    def test_other_document_does_not_acquire_training_plan_hours(self):
        with patch('audit_api.contract_documents.verified_planned_hours') as extract:
            response, hours, _ = self.upload(contract_pdf(), 'Apprenticeship Agreement.pdf')
        extract.assert_not_called()
        self.assertIsNone(hours)
        self.assertEqual(response['training_plan_hours_status'], 'not-applicable')

    def test_scanned_or_non_pdf_training_plan_requires_review(self):
        with patch('audit_api.contract_documents.verified_planned_hours') as extract:
            response, hours, _ = self.upload(b'image bytes', 'Training_Plan.png')
        extract.assert_not_called()
        self.assertIsNone(hours)
        self.assertEqual(response['training_plan_hours_status'], 'needs-review')
