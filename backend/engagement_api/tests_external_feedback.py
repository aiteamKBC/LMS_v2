import json
from contextlib import nullcontext
from io import BytesIO
from types import SimpleNamespace
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase
from openpyxl import Workbook

from login.api_gate import rule_for

from . import external_feedback_views, feedback
from .external_feedback import (
    CAMPAIGN_TYPES, parse_manual_recipients, parse_recipients,
    public_link, send_invitations,
)
from .feedback import VERSIONED_FORM_TYPES
from .models import FeedbackExternalRecipient, FeedbackForm, FeedbackResponse


def xlsx_upload(rows):
    workbook = Workbook(); sheet = workbook.active
    for row in rows: sheet.append(row)
    output = BytesIO(); workbook.save(output)
    return SimpleUploadedFile('recipients.xlsx', output.getvalue(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


def csv_upload(text):
    return SimpleUploadedFile('recipients.csv', text.encode('utf-8'), content_type='text/csv')


class RecipientImportTests(SimpleTestCase):
    def test_excel_groups_valid_invalid_missing_and_case_insensitive_duplicates(self):
        result = parse_recipients(xlsx_upload([
            ['Name', 'Email'], ['Valid Person', ' Person@Example.TEST '],
            ['Duplicate', 'person@example.test'], ['Bad', 'not-an-email'],
            ['', 'missing-name@example.test'], ['Missing email', ''],
        ]))
        self.assertEqual(result['valid'], [{'row': 2, 'name': 'Valid Person', 'email': 'person@example.test'}])
        self.assertEqual([item['row'] for item in result['duplicates']], [3])
        self.assertEqual([item['row'] for item in result['invalidEmails']], [4])
        self.assertEqual([item['missing'] for item in result['missingRows']], ['Name', 'Email'])

    def test_csv_uses_the_same_required_columns_and_deduplication(self):
        result = parse_recipients(csv_upload('Name,Email\nFirst,ONE@example.test\nSecond,one@EXAMPLE.test\n'))
        self.assertEqual(len(result['valid']), 1)
        self.assertEqual(result['duplicates'][0]['email'], 'one@example.test')

    def test_missing_required_header_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Email'):
            parse_recipients(csv_upload('Name,Phone\nPerson,123\n'))

    def test_manual_recipients_use_name_email_lines_and_case_insensitive_deduplication(self):
        result = parse_manual_recipients(
            'First Person, Person@Example.test\nSecond Person,person@example.TEST\nBad,bad-email\nMissing Email\n'
        )
        self.assertEqual(result['valid'], [{'row': 1, 'name': 'First Person', 'email': 'person@example.test'}])
        self.assertEqual([item['row'] for item in result['duplicates']], [2])
        self.assertEqual([item['row'] for item in result['invalidEmails']], [3])
        self.assertEqual(result['missingRows'][0]['missing'], 'Email')

    def test_manual_recipients_reject_extra_columns(self):
        with self.assertRaisesRegex(ValueError, 'Name, Email'):
            parse_manual_recipients('Person,person@example.test,unexpected')


class ExternalFeedbackSeparationTests(SimpleTestCase):
    def test_form_and_campaign_types_are_distinct_and_versioned(self):
        choices = {value for value, _label in FeedbackForm.TYPE_CHOICES}
        self.assertEqual(CAMPAIGN_TYPES, {'information_session', 'commitment_meeting'})
        self.assertTrue(CAMPAIGN_TYPES.issubset(choices))
        self.assertTrue(CAMPAIGN_TYPES.issubset(VERSIONED_FORM_TYPES))
        self.assertTrue(CAMPAIGN_TYPES.isdisjoint({'post_event', 'post_lecture', 'event_rsvp'}))

    @mock.patch('engagement_api.external_feedback.frontend_base_url', return_value='https://lms.example.test')
    def test_personal_link_uses_the_dedicated_public_page(self, _base):
        self.assertEqual(public_link('unguessable'), 'https://lms.example.test/session-feedback#token=unguessable')

    def test_only_public_session_prefix_is_ungated(self):
        self.assertIsNone(rule_for('/engagement_api/feedback/public-session/'))
        self.assertIsNone(rule_for('/engagement_api/feedback/public-session/csrf/'))
        self.assertIsNotNone(rule_for('/engagement_api/feedback/external-campaigns/'))

    def test_legacy_form_history_does_not_query_external_campaign_table(self):
        form = SimpleNamespace(
            form_type='post_lecture',
            responses=SimpleNamespace(exists=mock.Mock(return_value=False)),
            deliveries=SimpleNamespace(exists=mock.Mock(return_value=False)),
            external_campaigns=SimpleNamespace(exists=mock.Mock(side_effect=AssertionError('unexpected query'))),
        )
        self.assertFalse(feedback._form_has_history(form))
        form.external_campaigns.exists.assert_not_called()

    def test_external_response_link_does_not_add_a_column_to_legacy_responses(self):
        response_columns = {field.column for field in FeedbackResponse._meta.local_fields}
        recipient_columns = {field.column for field in FeedbackExternalRecipient._meta.local_fields}
        self.assertNotIn('external_recipient_id', response_columns)
        self.assertIn('response_id', recipient_columns)

    def test_used_templates_create_a_new_version_for_each_external_type(self):
        for form_type in CAMPAIGN_TYPES:
            with self.subTest(form_type=form_type):
                previous = FeedbackForm(
                    id=10, title='Original', form_type=form_type, delivery_scope='manual',
                    version=1, is_current=True, description='', instructions='', status='published',
                    anonymous_responses=False, allow_save_continue=False,
                    allow_edit_after_submission=False, created_by='Author',
                )
                captured = []

                def save(instance, *args, **kwargs):
                    if instance.pk is None:
                        instance.pk = 11
                        captured.append(instance)

                queryset = mock.Mock()
                queryset.get.side_effect = lambda **kwargs: previous if not captured else captured[0]
                request = RequestFactory().patch(
                    '/engagement_api/feedback/forms/10/',
                    data=json.dumps({'title': 'Updated', 'formType': form_type, 'sections': [{'title': 'Section', 'questions': []}]}),
                    content_type='application/json',
                )
                with mock.patch.object(feedback, '_forms_queryset', return_value=queryset), \
                     mock.patch.object(feedback, '_form_has_history', return_value=True), \
                     mock.patch.object(feedback, '_replace_structure'), \
                     mock.patch.object(feedback, 'actor_name', return_value='Editor'), \
                     mock.patch.object(feedback.transaction, 'atomic', side_effect=nullcontext), \
                     mock.patch.object(FeedbackForm, 'save', autospec=True, side_effect=save), \
                     mock.patch.object(feedback, 'form_dict', side_effect=lambda form, **kwargs: {'version': form.version, 'formType': form.form_type}):
                    response = feedback.form_detail.__wrapped__(request, 10)
                self.assertEqual(response.status_code, 200)
                self.assertFalse(previous.is_current)
                self.assertEqual(captured[0].version, 2)
                self.assertEqual(captured[0].form_type, form_type)


class InvitationStateTests(SimpleTestCase):
    @mock.patch('engagement_api.external_feedback.event_logo_attachment', return_value={'name': 'logo'})
    @mock.patch('engagement_api.external_feedback.frontend_base_url', return_value='https://lms.example.test')
    @mock.patch('engagement_api.external_feedback.hash_token', return_value='hashed')
    @mock.patch('engagement_api.external_feedback.generate_token', return_value='secret')
    @mock.patch('engagement_api.external_feedback.email_azure.send_mail', return_value=(True, 'message-id'))
    def test_successful_email_is_recorded_as_sent(self, send_mail, _token, _hash, _base, _logo):
        recipient = SimpleNamespace(
            id=8, recipient_name='Guest', recipient_email='guest@example.test',
            campaign=SimpleNamespace(campaign_type='commitment_meeting', name='Welcome', session_date=SimpleNamespace(isoformat=lambda: '2026-10-17')),
            token_hash=None, token_expires_at=None, delivery_status='pending',
            invitation_error='', invitation_sent_at=None, save=mock.Mock(),
        )
        result = send_invitations([recipient])
        self.assertEqual(result, [{'id': 8, 'sent': True}])
        self.assertEqual(recipient.delivery_status, 'sent')
        self.assertIsNotNone(recipient.invitation_sent_at)
        self.assertEqual(recipient.invitation_error, '')
        send_mail.assert_called_once()

    @mock.patch('engagement_api.external_feedback.event_logo_attachment', return_value={'name': 'logo'})
    @mock.patch('engagement_api.external_feedback.frontend_base_url', return_value='https://lms.example.test')
    @mock.patch('engagement_api.external_feedback.hash_token', return_value='hashed')
    @mock.patch('engagement_api.external_feedback.generate_token', return_value='secret')
    @mock.patch('engagement_api.external_feedback.email_azure.send_mail', return_value=(False, 'mail unavailable'))
    def test_failed_email_is_recorded_without_real_delivery(self, send_mail, _token, _hash, _base, _logo):
        recipient = SimpleNamespace(
            id=9, recipient_name='Guest', recipient_email='guest@example.test',
            campaign=SimpleNamespace(campaign_type='information_session', name='Welcome', session_date=SimpleNamespace(isoformat=lambda: '2026-10-17')),
            token_hash=None, token_expires_at=None, delivery_status='pending',
            invitation_error='', invitation_sent_at=None, save=mock.Mock(),
        )
        result = send_invitations([recipient])
        self.assertEqual(result, [{'id': 9, 'sent': False}])
        self.assertEqual(recipient.delivery_status, 'failed')
        self.assertEqual(recipient.invitation_error, 'mail unavailable')
        send_mail.assert_called_once()


class PublicAccessTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def post(self, payload):
        return self.factory.post('/engagement_api/feedback/public-session/', data=json.dumps(payload), content_type='application/json')

    def test_unknown_or_other_person_token_returns_the_same_safe_error(self):
        with mock.patch.object(external_feedback_views, 'recipient_for_token', return_value=None):
            response = external_feedback_views.public_access(self.post({'action': 'read', 'token': 'other-person-token'}))
        self.assertEqual(response.status_code, 404)
        self.assertNotIn(b'recipient', response.content)

    def test_opening_a_sent_link_records_opened(self):
        recipient = SimpleNamespace(delivery_status='sent', opened_at=None, response_id=None, save=mock.Mock())
        response_query = mock.Mock(); response_query.prefetch_related.return_value.first.return_value = None
        with mock.patch.object(external_feedback_views, 'recipient_for_token', return_value=recipient), \
             mock.patch.object(external_feedback_views.FeedbackResponse.objects, 'filter', return_value=response_query), \
             mock.patch.object(external_feedback_views, '_public_payload', return_value={'ok': True}):
            response = external_feedback_views.public_access(self.post({'action': 'read', 'token': 'mine'}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(recipient.delivery_status, 'opened')
        recipient.save.assert_called_once()

    def test_submitted_recipient_cannot_submit_again_even_with_extra_identifiers(self):
        recipient = SimpleNamespace(delivery_status='submitted', response_id=17)
        with mock.patch.object(external_feedback_views, 'recipient_for_token', return_value=recipient), \
             mock.patch.object(external_feedback_views.transaction, 'atomic', side_effect=nullcontext):
            response = external_feedback_views.public_access(self.post({
                'token': 'mine', 'recipientId': 999, 'formId': 999, 'answers': {},
            }))
        self.assertEqual(response.status_code, 409)
        self.assertIn(b'already been submitted', response.content)

    def test_valid_submission_links_response_and_records_submitted(self):
        form = SimpleNamespace(id=12)
        recipient = SimpleNamespace(
            id=33, delivery_status='opened', response_id=None, response=None,
            recipient_name='Guest', campaign=SimpleNamespace(form=form),
            submitted_at=None, save=mock.Mock(),
        )
        question = SimpleNamespace(id=5, required=True, question_type='short_text', config={})
        saved_response = SimpleNamespace(id=44, status='in_progress', submitted_at=None, save=mock.Mock())
        with mock.patch.object(external_feedback_views, 'recipient_for_token', return_value=recipient), \
             mock.patch.object(external_feedback_views.transaction, 'atomic', side_effect=nullcontext), \
             mock.patch.object(external_feedback_views.FeedbackQuestion.objects, 'filter', return_value=[question]), \
             mock.patch.object(external_feedback_views.FeedbackResponse.objects, 'create', return_value=saved_response), \
             mock.patch.object(external_feedback_views.FeedbackAnswer.objects, 'update_or_create') as save_answer:
            response = external_feedback_views.public_access(self.post({
                'token': 'mine', 'answers': {'5': 'Useful meeting'},
            }))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(saved_response.status, 'completed')
        self.assertEqual(recipient.delivery_status, 'submitted')
        self.assertIs(recipient.response, saved_response)
        save_answer.assert_called_once_with(response=saved_response, question_id=5, defaults={'answer': 'Useful meeting'})
