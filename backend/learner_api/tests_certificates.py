from unittest.mock import MagicMock, patch
from types import SimpleNamespace
import json

from django.test import SimpleTestCase, RequestFactory

from .certificates import (
    _learner_progress,
    _template_summary,
    _template_dict,
    _published_template,
    learner_certificate_template,
    issue_learner_certificate,
    issue_learner_module_certificate,
)


class LearnerCertificateProgressTests(SimpleTestCase):
    def test_template_summary_avoids_loading_artwork_from_database(self):
        cursor = MagicMock()
        full = (1, 2, 'Completion', 'Body', 100, True,
                {'backgroundDataUrl': 'data:image/png;base64,large'})
        cursor.fetchone.side_effect = [full, (1, 2, 'Completion', None, 100, True, None)]
        complete = _published_template(cursor)
        summary = _published_template(cursor, summary=True)
        self.assertEqual(_template_summary(_template_dict(summary)),
                         _template_summary(_template_dict(complete)))
        full_sql, lean_sql = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertIn('layout_config', full_sql)
        self.assertNotIn('layout_config', lean_sql)
        self.assertNotIn('body_text', lean_sql)
        self.assertIn('ORDER BY version DESC LIMIT 1', lean_sql)
        self.assertEqual(cursor.execute.call_args_list[0].args[1],
                         cursor.execute.call_args_list[1].args[1])

    def test_template_endpoint_selects_summary_only_when_requested(self):
        for query in ('', '?summary=1'):
            with self.subTest(query=query):
                request = RequestFactory().get('/learner_api/certificates/commercial/7/template/' + query)
                request.login_account = SimpleNamespace(role='admin', pk=3)
                with patch('learner_api.certificates.connections') as databases, \
                     patch('learner_api.certificates._canonical_certificate_owner', return_value=9) as owner, \
                     patch('learner_api.certificates._published_template',
                           return_value=(1, 2, 'Completion', 'Body', 100, False, {})) as read:
                    response = learner_certificate_template(request, 'commercial', 7)
                owner.assert_called_once_with(databases['enrolment'].cursor.return_value.__enter__.return_value, 'commercial', 7)
                read.assert_called_once_with(databases['enrolment'].cursor.return_value.__enter__.return_value,
                                             summary=bool(query))
                self.assertEqual(response.status_code, 200)
                template = json.loads(response.content)['template']
                self.assertEqual('layoutConfig' in template, not bool(query))

    def test_catalogue_template_summary_omits_embedded_artwork(self):
        template = {
            'id': 1, 'version': 2, 'title': 'Completion', 'minimumProgress': 100,
            'requireFinalTest': True, 'layoutConfig': {'backgroundDataUrl': 'data:image/png;base64,large'},
            'bodyText': 'Body',
        }
        self.assertEqual(_template_summary(template), {
            'id': 1, 'version': 2, 'title': 'Completion', 'minimumProgress': 100,
            'requireFinalTest': True,
        })

    def test_certificate_issue_endpoints_require_django_csrf_validation(self):
        self.assertFalse(getattr(issue_learner_certificate, 'csrf_exempt', False))
        self.assertFalse(getattr(issue_learner_module_certificate, 'csrf_exempt', False))

    def test_counts_imported_video_from_generic_component_progress(self):
        detail = {
            "components": [{
                "componentId": "VIDEO-1",
                "expectedOtjh": 1,
                "component": "Lesson video",
                "type": "video",
                "videoUrl": "https://example.test/video",
            }],
            "videoProgress": [],
            "componentProgress": [{"componentId": "VIDEO-1", "passed": None}],
            "quizAttempts": [],
        }

        self.assertEqual(_learner_progress(detail)["trackableDone"], 1)

    def test_failed_quiz_attempt_does_not_count_as_certificate_progress(self):
        detail = {
            "components": [{
                "componentId": "QUIZ-COMP-1",
                "expectedOtjh": 1,
                "component": "Knowledge quiz",
                "type": "quiz",
                "isQuiz": True,
                "quizMeta": {"quizId": 7, "questions": 2},
            }],
            "videoProgress": [],
            "componentProgress": [],
            "quizAttempts": [{"quizId": 7, "passed": False}],
        }

        self.assertEqual(_learner_progress(detail)["trackableDone"], 0)

    def test_any_passed_quiz_attempt_preserves_completion(self):
        detail = {
            "components": [{
                "componentId": "QUIZ-COMP-1",
                "expectedOtjh": 1,
                "component": "Knowledge quiz",
                "type": "quiz",
                "isQuiz": True,
                "quizMeta": {"quizId": 7, "questions": 2},
            }],
            "videoProgress": [],
            "componentProgress": [],
            "quizAttempts": [
                {"quizId": 7, "passed": True},
                {"quizId": 7, "passed": False},
            ],
        }

        self.assertEqual(_learner_progress(detail)["trackableDone"], 1)

    def test_optional_quiz_pass_does_not_complete_required_sibling(self):
        detail = {'components': [
            {'componentId': 'REQUIRED', 'expectedOtjh': 1, 'isQuiz': True, 'quizMeta': {'quizId': 7}},
            {'componentId': 'OPTIONAL', 'expectedOtjh': 0, 'isQuiz': True, 'quizMeta': {'quizId': 7}}],
            'quizAttempts': [{'componentId': 'OPTIONAL', 'quizId': 7, 'passed': True}]}
        result = _learner_progress(detail)
        self.assertEqual((result['trackableTotal'], result['trackableDone'], result['progressPercent']), (1, 0, 0))

    def test_missing_required_content_is_not_silently_removed(self):
        result = _learner_progress({'components': [
            {'componentId': 'REQUIRED', 'expectedOtjh': 1, 'type': 'reading'},
            {'componentId': 'OPTIONAL', 'expectedOtjh': 0, 'type': 'reading'}],
            'componentProgress': [{'componentId': 'OPTIONAL', 'passed': True}]})
        self.assertEqual((result['trackableTotal'], result['trackableDone']), (1, 0))
