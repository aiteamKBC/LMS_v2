from io import BytesIO
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase
from openpyxl import Workbook

from login.api_gate import rule_for

from . import event_feedback_views
from .event_feedback import event_feedback_link, parse_attendance


def workbook_upload(rows):
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    output = BytesIO()
    workbook.save(output)
    return SimpleUploadedFile(
        'attendance.xlsx', output.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )


class AttendanceSpreadsheetTests(SimpleTestCase):
    def test_only_present_rows_are_accepted_and_email_is_normalised(self):
        preview = parse_attendance(workbook_upload([
            ['Name', 'Email', 'Attendance Status'],
            ['Guest One', ' Guest@One.TEST ', 'Present'],
            ['Guest Two', 'two@example.test', 'Absent'],
            ['Guest Three', 'three@example.test', 'Attended'],
        ]))
        self.assertEqual(preview['presentCount'], 2)
        self.assertEqual(preview['ignoredCount'], 1)
        self.assertEqual(preview['attendees'][0]['email'], 'guest@one.test')

    def test_duplicate_present_email_is_reported_with_its_row(self):
        preview = parse_attendance(workbook_upload([
            ['Name', 'Email', 'Attendance Status'],
            ['First', 'same@example.test', 'Present'],
            ['Second', 'SAME@example.test', 'Present'],
        ]))
        self.assertEqual(preview['presentCount'], 1)
        self.assertEqual(preview['errors'], [{'row': 3, 'error': 'email is duplicated'}])

    def test_missing_required_header_fails_without_importing(self):
        with self.assertRaisesRegex(ValueError, 'Status'):
            parse_attendance(workbook_upload([
                ['Name', 'Email'], ['Guest', 'guest@example.test'],
            ]))


class PublicEventFeedbackAccessTests(SimpleTestCase):
    @mock.patch('engagement_api.event_feedback.frontend_base_url', return_value='https://lms.example.test')
    def test_invitation_link_uses_dedicated_public_page(self, _frontend_base_url):
        self.assertEqual(
            event_feedback_link('private-token'),
            'https://lms.example.test/event-feedback#token=private-token',
        )

    def test_public_token_prefix_is_the_only_ungated_engagement_feedback_path(self):
        self.assertIsNone(rule_for('/engagement_api/feedback/public-event/'))
        self.assertIsNone(rule_for('/engagement_api/feedback/public-event/csrf/'))
        self.assertIsNotNone(rule_for('/engagement_api/feedback/events/4/campaign/'))

    def test_unknown_token_returns_same_safe_error(self):
        request = RequestFactory().get('/engagement_api/feedback/public-event/', {'token': 'unknown'})
        with mock.patch.object(event_feedback_views, 'recipient_for_token', return_value=None):
            response = event_feedback_views.public_event_access(request)
        self.assertEqual(response.status_code, 404)
        self.assertIn(b'invalid or has expired', response.content)
