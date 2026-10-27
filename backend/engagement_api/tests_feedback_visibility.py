"""Local/production learner visibility, without database or external effects."""
from types import SimpleNamespace
from unittest import mock
from datetime import datetime, timezone

from django.conf import settings
from django.test import RequestFactory, SimpleTestCase, override_settings

from . import feedback
from .tests import _account, _patched


class FeedbackVisibilityTests(SimpleTestCase):
    def test_all_form_types_are_available_in_production_and_local_development(self):
        request = RequestFactory().get('/')
        for debug in (False, True):
            for kind in ('apprenticeship', 'commercial'):
                account = _account(role='learner', subject_type='learner')
                account.learner_type = kind
                with (
                    self.subTest(debug=debug, kind=kind),
                    self.settings(DEBUG=debug, LEARNER_FEEDBACK_ENABLED=True, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=True),
                    _patched(account),
                ):
                    for form_type in feedback.FORM_TYPES:
                        response = feedback._learner_feedback_disabled_response(
                            request, form=SimpleNamespace(form_type=form_type), delivery=object(),
                        )
                        self.assertIsNone(response)

    @override_settings(DEBUG=False)
    def test_production_release_defaults_to_enabled(self):
        self.assertTrue(settings.LEARNER_FEEDBACK_ENABLED)
        with _patched(_account(role='learner', subject_type='learner')):
            self.assertIsNone(feedback._learner_feedback_disabled_response(RequestFactory().get('/')))

    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=True)
    def test_production_queue_returns_assigned_forms_for_the_signed_in_learner(self):
        form = SimpleNamespace(id=4, title='Assigned feedback', description='', due_date=None)
        forms = mock.MagicMock()
        forms.filter.return_value = forms
        forms.distinct.return_value = forms
        forms.__iter__.side_effect = lambda: iter([form])
        empty_source = mock.MagicMock()
        empty_source.filter.return_value = empty_source
        empty_source.distinct.return_value = empty_source
        empty_source.order_by.return_value = []
        assigned = SimpleNamespace(assigned_at=datetime(2026, 10, 27, tzinfo=timezone.utc), due_date=None)
        with (
            _patched(_account(role='learner', subject_type='learner')),
            mock.patch.object(feedback, '_forms_queryset', return_value=forms),
            mock.patch.object(feedback, '_assignment_for', return_value=assigned) as assignment,
            mock.patch.object(feedback.FeedbackResponse.objects, 'filter', return_value=[]),
            mock.patch.object(feedback.FeedbackDeliveryRecipient.objects, 'select_related', return_value=empty_source),
            mock.patch.object(feedback.FeedbackReviewDelivery.objects, 'select_related', return_value=empty_source),
            mock.patch.object(feedback.FeedbackEventRecipient.objects, 'select_related', return_value=empty_source),
            mock.patch.object(feedback, 'sync_module_feedback') as module_sync,
            mock.patch.object(feedback, '_sync_review_feedback_deliveries') as review_sync,
        ):
            response = feedback.learner_forms(RequestFactory().get('/?learnerId=999'))
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Assigned feedback', response.content)
        assignment.assert_called_once_with(form, '61')
        module_sync.assert_called_once_with('61')
        review_sync.assert_called_once_with('61')

    @override_settings(DEBUG=True, LEARNER_FEEDBACK_ENABLED=False, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False)
    def test_local_learner_needs_no_production_flag_to_access_feedback(self):
        with _patched(_account(role='learner', subject_type='learner')):
            self.assertFalse(feedback._learner_feedback_disabled(RequestFactory().get('/')))

    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=False, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False)
    def test_explicitly_disabled_release_stops_before_database_access_or_sync(self):
        factory = RequestFactory()
        with (
            _patched(_account(role='learner', subject_type='learner')),
            mock.patch.object(feedback, '_learner_feedback_context') as context,
            mock.patch.object(feedback, 'sync_module_feedback') as module_sync,
            mock.patch.object(feedback, '_sync_review_feedback_deliveries') as review_sync,
            mock.patch.object(feedback.FeedbackUpload.objects, 'select_related') as uploads,
        ):
            queue = feedback.learner_forms(factory.get('/?learnerId=999'))
            self.assertJSONEqual(queue.content, {'forms': []})
            for identity in (
                {'pk': 4}, {'delivery_id': 4}, {'review_delivery_id': 4},
                {'pk': 4, 'event_recipient_id': 9},
            ):
                with self.subTest(identity=identity):
                    self.assertEqual(feedback.learner_form_detail(factory.get('/'), **identity).status_code, 404)
                    self.assertEqual(feedback.learner_response_save(factory.post('/'), **identity).status_code, 404)
            for identity in ({'pk': 4}, {'delivery_id': 4}, {'review_delivery_id': 4}):
                self.assertEqual(feedback.learner_photo_upload(factory.post('/'), question_id=1, **identity).status_code, 404)
            self.assertEqual(feedback.feedback_upload_content(factory.get('/'), upload_id='unused').status_code, 404)
            context.assert_not_called()
            module_sync.assert_not_called()
            review_sync.assert_not_called()
            uploads.assert_not_called()

    @override_settings(DEBUG=False)
    def test_staff_and_admin_preview_and_reporting_are_not_hidden(self):
        for role in ('staff', 'admin'):
            with self.subTest(role=role), _patched(_account(role=role, subject_type='staff')):
                self.assertIsNone(feedback._learner_feedback_disabled_response(RequestFactory().get('/?learnerId=61')))

    @override_settings(DEBUG=False)
    def test_authentication_checks_still_apply_to_released_feedback(self):
        factory = RequestFactory()
        with mock.patch('engagement_api.permissions.authenticate_request', return_value=None):
            self.assertEqual(feedback.learner_forms(factory.get('/')).status_code, 401)
            self.assertEqual(feedback.learner_form_detail(factory.get('/'), pk=4).status_code, 401)
            self.assertEqual(feedback.learner_response_save(factory.post('/'), pk=4).status_code, 401)

    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=True)
    def test_production_learner_only_reaches_their_own_record_context(self):
        factory = RequestFactory()
        for kind in ('apprenticeship', 'commercial'):
            account = _account(role='learner', subject_type='learner')
            account.learner_type = kind
            with (
                self.subTest(kind=kind), _patched(account),
                mock.patch.object(feedback, '_learner_feedback_context', return_value=(None, None, None)) as context,
            ):
                for identity in ({'pk': 4}, {'delivery_id': 4}, {'review_delivery_id': 4}, {'pk': 4, 'event_recipient_id': 9}):
                    self.assertEqual(feedback.learner_form_detail(factory.get('/?learnerId=999'), **identity).status_code, 404)
                    self.assertEqual(context.call_args.args[0], '61')
                    self.assertEqual(feedback.learner_response_save(factory.post('/?learnerId=999'), **identity).status_code, 404)
                    self.assertEqual(context.call_args.args[0], '61')

    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=True)
    def test_other_roles_cannot_use_learner_read_or_write_endpoints(self):
        factory = RequestFactory()
        for role in ('employer', 'tutor', 'coach'):
            with (
                self.subTest(role=role), _patched(_account(role=role, subject_type=role)),
                mock.patch.object(feedback, '_learner_feedback_context') as context,
            ):
                self.assertEqual(feedback.learner_forms(factory.get('/')).status_code, 403)
                self.assertEqual(feedback.learner_form_detail(factory.get('/'), pk=4).status_code, 403)
                self.assertEqual(feedback.learner_response_save(factory.post('/'), pk=4).status_code, 403)
                context.assert_not_called()
