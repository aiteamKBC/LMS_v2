"""A video's lesson content reaches the one opened activity; nothing else changes.

Database-free: the cursor and the learner graph are scripted.
"""
from types import SimpleNamespace
from unittest.mock import patch
import json

from django.test import SimpleTestCase, RequestFactory

from curriculum_api.week_visibility import visible_child_sql, visible_week_sql

from . import learner_detail as reader
from .tests import ScriptedConnection, ScriptedCursor

# Stored curriculum HTML comes back byte for byte: no stripping, escaping or
# re-serialisation on the way out. Sanitising happens where it is displayed.
STORED_HTML = ("<h2 class='title'>Week 1</h2><ol><li>One</li></ol>"
               "<p><a href=\"/curriculum_api/curriculum/uploads/2026/notes.pdf\" target=\"_blank\">Notes</a></p>"
               "<table><tr><td>1 week&lt;US$100K</td></tr></table>")


class LessonContentReadTests(SimpleTestCase):
    def read(self, rows, component_id='V1', plan=({'moduleId': 'M1'},), setting=reader._lesson_content):
        cursor = ScriptedCursor([rows])
        with patch.object(reader, 'connections', {'enrolment': ScriptedConnection(cursor)}), \
                patch.object(reader, 'effective_training_plan', return_value=list(plan)), \
                patch.object(cursor, 'execute', wraps=cursor.execute) as execute:
            result = setting(SimpleNamespace(), component_id)
        return result, execute

    def test_lesson_content_is_read_scoped_like_a_reading_and_returned_unchanged(self):
        selected = "V1' OR true --"
        result, execute = self.read([('V1', STORED_HTML)], component_id=selected)
        sql, params = execute.call_args.args
        self.assertIn("c.settings_json->>'lessonContent'", sql)
        self.assertNotIn(selected, sql)
        self.assertIn('c.module_catalogue_id=ANY(%s)', sql)
        self.assertIn(visible_child_sql('c'), sql)
        self.assertIn(visible_week_sql('w'), sql)
        self.assertEqual(params, [selected, ['M1']])
        self.assertEqual(result, {'componentId': 'V1', 'lessonContentHtml': STORED_HTML})

    def test_reading_query_is_unchanged(self):
        result, execute = self.read([('R1', STORED_HTML)], component_id='R1', setting=reader._reading_content)
        sql, _params = execute.call_args.args
        self.assertTrue(sql.startswith("SELECT c.id, c.settings_json->>'readingContent'\n"))
        self.assertEqual(result, {'componentId': 'R1', 'contentHtml': STORED_HTML})

    def test_unassigned_video_returns_nothing(self):
        result, _ = self.read([], component_id='V2')
        self.assertIsNone(result)

    def test_only_known_settings_can_be_selected(self):
        with self.assertRaises(ValueError):
            reader._authored_setting(SimpleNamespace(), 'V1', "x' FROM pg_shadow --", 'x')


class ActivityResponseTests(SimpleTestCase):
    def respond(self, component, lesson=None, reading=None):
        source = SimpleNamespace()
        model = SimpleNamespace(all_learners=SimpleNamespace(get=lambda **kwargs: source), DoesNotExist=LookupError)
        detail = {'id': '7', 'components': [component]}
        request = RequestFactory().get('/learner_api/learner-detail/commercial/7/',
                                       {'content': 'activity', 'component_id': component['componentId']})
        with patch.dict(reader.SOURCE_MODELS, {'commercial': model}), \
                patch.object(reader, 'build_learner_detail', return_value=detail), \
                patch.object(reader, '_lesson_content', return_value=lesson) as lesson_read, \
                patch.object(reader, '_reading_content', return_value=reading) as reading_read:
            response = reader.learner_detail.__wrapped__(request, 'commercial', 7)
        body = json.loads(response.content)['components'][0] if response.status_code == 200 else None
        return response, body, lesson_read, reading_read

    def test_video_activity_carries_its_lesson_content_exactly(self):
        component = {'componentId': 'V1', 'type': 'video', 'videoUrl': 'https://youtu.be/abc',
                     'description': 'Short description', 'component': 'Clip'}
        response, body, lesson_read, reading_read = self.respond(
            component, lesson={'componentId': 'V1', 'lessonContentHtml': STORED_HTML})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(body['lessonContentHtml'], STORED_HTML)
        # Its own field: the video's other fields are what they were.
        self.assertEqual(body['videoUrl'], 'https://youtu.be/abc')
        self.assertEqual(body['description'], 'Short description')
        self.assertEqual(body['component'], 'Clip')
        self.assertNotIn('contentHtml', body)
        lesson_read.assert_called_once()
        reading_read.assert_not_called()

    def test_video_outside_the_curriculum_tables_still_opens(self):
        response, body, _lesson, _reading = self.respond({'componentId': 'V9', 'type': 'Video'}, lesson=None)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(body['lessonContentHtml'])

    def test_reading_activity_is_unchanged_and_gets_no_lesson_content(self):
        response, body, lesson_read, reading_read = self.respond(
            {'componentId': 'R1', 'type': 'reading'}, reading={'componentId': 'R1', 'contentHtml': STORED_HTML})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body['contentHtml'], STORED_HTML)
        self.assertNotIn('lessonContentHtml', body)
        lesson_read.assert_not_called()
        reading_read.assert_called_once()

    def test_reading_outside_the_plan_still_404s(self):
        response, *_ = self.respond({'componentId': 'R2', 'type': 'reading'}, reading=None)
        self.assertEqual(response.status_code, 404)
