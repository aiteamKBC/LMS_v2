"""No-database checks for the private Advanced Admin assignment boundary."""
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase

from login.advanced_admin_assignment_uploads import assignment_document, assignments, save_record, validate_record


def document(name='example.docx'):
    return SimpleUploadedFile(
        name, b'synthetic document content',
        content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )


class AdvancedAdminAssignmentUploadTests(SimpleTestCase):
    def test_advanced_admin_can_read_only_its_scoped_learner(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/assignment-uploads/')
        account = SimpleNamespace(role='staff', subject_type='staff')
        profile = SimpleNamespace(pk=42, aptem_id=123)
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch('login.permissions._accesses_of', return_value=frozenset({'advanced-admin'})), \
             patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin_assignment_uploads.list_records', return_value=[]) as read:
            response = assignments(request, 42)
        self.assertEqual(response.status_code, 200)
        read.assert_called_once_with(profile)

    def test_learner_role_cannot_open_admin_records(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/assignment-uploads/')
        with patch('login.permissions.authenticate_request',
                   return_value=SimpleNamespace(role='learner')), \
             patch('login.advanced_admin._profile_in_scope') as lookup:
            response = assignments(request, 42)
        self.assertEqual(response.status_code, 403)
        lookup.assert_not_called()

        with patch('login.permissions.authenticate_request',
                   return_value=SimpleNamespace(role='learner')), \
             patch('login.advanced_admin._profile_in_scope') as lookup:
            response = assignment_document(request, 42, 'record-id')
        self.assertEqual(response.status_code, 403)
        lookup.assert_not_called()

    def test_rejects_invalid_month_hours_and_file(self):
        with self.assertRaises(ValueError):
            validate_record('2026-13', '2', document())
        with self.assertRaises(ValueError):
            validate_record('2026-07', 'NaN', document())
        with self.assertRaises(ValueError):
            validate_record('2026-07', '2.001', document())
        with self.assertRaises(ValueError):
            validate_record('2026-07', '2', document('example.exe'))
        self.assertEqual(validate_record('2026-07', '12', document()), Decimal('12'))

    def test_accepts_powerpoint_assignment(self):
        presentation = SimpleUploadedFile(
            'assignment.pptx', b'synthetic presentation content',
            content_type='application/vnd.openxmlformats-officedocument.presentationml.presentation',
        )
        self.assertEqual(validate_record('2026-07', '14', presentation), Decimal('14'))

    def test_out_of_scope_learner_cannot_list_or_upload(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/assignment-uploads/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('login.advanced_admin_assignment_uploads.list_records') as read:
            response = assignments.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 404)
        read.assert_not_called()

    def test_same_file_and_hours_do_not_upload_again(self):
        profile = SimpleNamespace(aptem_id=123, pk=7)
        with patch('login.advanced_admin_assignment_uploads.azure_configured', return_value=True), \
             patch('login.advanced_admin_assignment_uploads._existing', return_value=('saved-id', Decimal('12'))), \
             patch('login.advanced_admin_assignment_uploads.upload_to_quarantine') as upload:
            result = save_record(profile, '2026-07', '12', document(), 'Advanced Admin')
        self.assertEqual(result, ('saved-id', False))
        upload.assert_not_called()
