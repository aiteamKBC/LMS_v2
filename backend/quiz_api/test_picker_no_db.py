import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import views


class QuizPickerTests(SimpleTestCase):
    def setUp(self):
        self.quiz = views.QuizPackage(
            id=7, title='A quiz', programme_id='P1', programme='Programme', module='Module',
            week_id='W1', questions=12, status='published', assessment_type='quiz',
            duration=30, passing_grade=80, lesson_content='Full editor content',
            created_at=datetime(2026, 10, 17, tzinfo=timezone.utc),
            updated_at=datetime(2026, 10, 17, tzinfo=timezone.utc),
        )
        self.queryset = MagicMock()
        self.queryset.filter.return_value = self.queryset
        self.queryset.exclude.return_value = self.queryset
        self.queryset.values.return_value = [{column: getattr(self.quiz, column) for column in views.QUIZ_PICKER_FIELDS.values()}]

    def test_picker_returns_linking_fields_without_reading_assignment_graph(self):
        with patch.object(views, '_ensure_quiz_assessment_type_column'), \
                patch.object(views.QuizPackage.objects, 'all', return_value=self.queryset), \
                patch.object(views, '_sync_quiz_assignment_counts') as sync, \
                patch.object(views, '_sync_quiz_assignment_count') as single_sync:
            response = views.quizzes(RequestFactory().get('/quizzes/', {'view': 'picker', 'status': 'all', 'assessmentType': 'quiz'}))
        expected = {key: views._serialize_quiz(self.quiz)[key] for key in views.QUIZ_PICKER_FIELDS}
        self.assertEqual(json.loads(response.content), {'results': [expected]})
        self.assertNotIn('lessonContent', expected)
        self.assertNotIn('linkedCourses', expected)
        sync.assert_not_called()
        single_sync.assert_not_called()
        self.queryset.exclude.assert_called_once_with(status='trash')
        self.queryset.filter.assert_called_once_with(assessment_type='quiz')

    def test_picker_keeps_search_and_status_filters(self):
        with patch.object(views, '_ensure_quiz_assessment_type_column'), \
                patch.object(views.QuizPackage.objects, 'all', return_value=self.queryset), \
                patch.object(views, '_sync_quiz_assignment_counts') as sync:
            views.quizzes(RequestFactory().get('/quizzes/', {'view': 'picker', 'status': 'pending', 'search': '  A quiz  '}))
        self.queryset.exclude.assert_called_once_with(assessment_type='checkpoint')
        self.queryset.filter.assert_any_call(status__in=['pending', 'validating'])
        self.queryset.filter.assert_any_call(title__icontains='A quiz')
        sync.assert_not_called()

    def test_default_list_keeps_full_editor_fields_and_assignment_counts(self):
        with patch.object(views, '_ensure_quiz_assessment_type_column'), \
                patch.object(views.QuizPackage.objects, 'all', return_value=self.queryset), \
                patch.object(views, '_sync_quiz_assignment_counts', return_value=[self.quiz]) as sync:
            response = views.quizzes(RequestFactory().get('/quizzes/', {'status': 'all', 'assessmentType': 'quiz'}))
        self.assertEqual(json.loads(response.content)['results'][0]['lessonContent'], 'Full editor content')
        self.queryset.values.assert_not_called()
        sync.assert_called_once_with(self.queryset)

    def test_picker_query_selects_only_summary_columns(self):
        sql, _ = views.QuizPackage.objects.values(*views.QUIZ_PICKER_FIELDS.values()).query.sql_with_params()
        selected = sql.split(' FROM ')[0]
        self.assertNotIn('lesson_content', selected)
        self.assertNotIn('uploaded_file', selected)
        self.assertNotIn('linked_courses', selected)
        self.assertIn('passing_grade', selected)
