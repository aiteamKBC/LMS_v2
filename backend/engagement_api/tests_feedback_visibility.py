"""Local/production learner visibility, without database or external effects."""
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import feedback
from .tests import _account, _patched


class FeedbackVisibilityTests(SimpleTestCase):
    def test_all_form_types_are_local_only_even_with_old_production_flags_enabled(self):
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
                        if debug:
                            self.assertIsNone(response)
                        else:
                            self.assertEqual(response.status_code, 404)

    @override_settings(DEBUG=True, LEARNER_FEEDBACK_ENABLED=False, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False)
    def test_local_learner_needs_no_production_flag_to_access_feedback(self):
        with _patched(_account(role='learner', subject_type='learner')):
            self.assertFalse(feedback._learner_feedback_disabled(RequestFactory().get('/')))

    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=True, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=True)
    def test_production_reads_writes_and_uploads_stop_before_database_access_or_sync(self):
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
    def test_authentication_checks_still_apply_before_the_hidden_response(self):
        factory = RequestFactory()
        with mock.patch('engagement_api.permissions.authenticate_request', return_value=None):
            self.assertEqual(feedback.learner_forms(factory.get('/')).status_code, 401)
            self.assertEqual(feedback.learner_form_detail(factory.get('/'), pk=4).status_code, 401)
            self.assertEqual(feedback.learner_response_save(factory.post('/'), pk=4).status_code, 401)
