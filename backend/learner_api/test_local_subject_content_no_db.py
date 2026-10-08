"""Learner content uses stored snapshots; no DB startup or external requests."""
import ast
from contextlib import nullcontext
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings
settings.configure()
from learner_api.subject_content import build_material, as_list, public_quiz, grade_quiz, ContentUnavailable
from learner_api.source_material_content import hydrate_material


def function(name, scope):
    tree = ast.parse(Path(__file__).with_name('student_activity.py').read_text(encoding='utf-8'))
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name]
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'student_activity.py', 'exec'), scope)
    return scope[name]


class LocalSubjectContentTests(unittest.TestCase):
    def setUp(self):
        self.cursor = Mock()
        self.connection = SimpleNamespace(cursor=lambda: nullcontext(self.cursor))
        self.scope = dict(__package__='learner_api', build_material=build_material, as_list=as_list,
            ContentUnavailable=ContentUnavailable, DatabaseError=RuntimeError,
            _connection=lambda: self.connection,
            material_schema=Mock(side_effect=AssertionError('External schema called')),
            _live_subjects=Mock(side_effect=AssertionError('External learner API called')))
        proxy = ModuleType('learner_api.media_proxy')
        proxy._legacy_attachment_upload_path = Mock(return_value='')
        self.proxy = proxy
        patcher = patch.dict(sys.modules, {'learner_api.media_proxy': proxy})
        patcher.start(); self.addCleanup(patcher.stop)
        patcher = patch('socket.socket', side_effect=AssertionError('Network prohibited'))
        patcher.start(); self.addCleanup(patcher.stop)
        self.stored = {'title': 'Synthetic lesson', 'reading_html': '<p>Saved content</p>',
            '_source': {'activity_id': 1, 'quiz_id': 2}}

    def test_stored_quiz_is_marked_locally_without_exposing_answers(self):
        self.cursor.fetchall.return_value = [({'passing_grade_percent': 80, 'quiz_definition': {
            'question_count': 1, 'questions': [{'question_id': 12, 'question_text': 'Example?',
            'question_type': 'single_choice', 'answer_options': [
                {'option_order': 1, 'option_text': 'Yes'}, {'option_order': 2, 'option_text': 'No'}],
            'correct_answers': ['Yes']}]}},)]
        result = function('_definition_for', self.scope)(self.stored, 5)
        self.assertEqual(self.cursor.execute.call_args.args[1], [5, '2'])
        self.assertEqual(result['reading_html'], '<p>Saved content</p>')
        self.assertTrue(result['quiz']['ready'])
        self.assertTrue(grade_quiz(result, {'12': ['1']})['passed'])
        self.assertNotIn('solution_ids', public_quiz(result['quiz'])['questions'][0])
        self.scope['material_schema'].assert_not_called()

    def test_missing_local_quiz_never_falls_back_to_network(self):
        self.cursor.fetchall.return_value = []
        result = function('_definition_for', self.scope)(self.stored, 5)
        self.assertFalse(result['quiz']['ready'])
        self.scope['material_schema'].assert_not_called()

    def test_archived_file_is_preferred(self):
        self.proxy._legacy_attachment_upload_path.return_value = '_legacy_files/9/lesson.pdf'
        stored = {'title': 'File', '_source': {'activity_id': 1},
                  'reading_url': 'https://source.example/view?attachment_id=9'}
        result = function('_definition_for', self.scope)(stored, 5)
        self.assertEqual(result['media'][0]['url'], '/curriculum_api/curriculum/uploads/_legacy_files/9/lesson.pdf')

    def test_attempt_ownership_uses_database_without_live_source(self):
        model = SimpleNamespace(all_learners=Mock(), DoesNotExist=LookupError)
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(aptem_id=8, email='learner@example.test')
        stored = {'_source': {'learner_email': 'learner@example.test'}}
        self.scope.update(SOURCE_MODELS={'commercial': model}, student_activity_available=lambda _: True,
            read_student_material=Mock(return_value=stored), is_excluded_learner=lambda *_: False,
            _emails_match=lambda a, b: a == b)
        owned = function('_owned_material', self.scope)
        self.assertEqual(owned('commercial', 3, 5, 1), (8, stored))
        self.scope['read_student_material'].assert_called_once_with(self.cursor, 8, 5, 1, include_source=True)
        self.scope['_live_subjects'].assert_not_called()
        stored['_source']['learner_email'] = 'someone-else@example.test'
        with self.assertRaises(LookupError):
            owned('commercial', 3, 5, 1)

    def test_existing_file_link_uses_archive_and_checks_attachment_ownership(self):
        self.scope.update(_owned_material=lambda *_: (8, {'reading_url': 'https://source.example/view?attachment_id=9'}),
            _error=lambda message, status: status, HttpResponseRedirect=lambda url: url)
        self.proxy._legacy_attachment_upload_path.return_value = '_legacy_files/9/lesson.pdf'
        view = function('subject_file', self.scope)
        self.assertEqual(view(None, 'commercial', 3, 5, 1, '9'),
                         '/curriculum_api/curriculum/uploads/_legacy_files/9/lesson.pdf')
        self.assertEqual(view(None, 'commercial', 3, 5, 1, '10'), 404)
        self.proxy._legacy_attachment_upload_path.return_value = ''
        self.assertEqual(view(None, 'commercial', 3, 5, 1, '9'), 404)

    def test_content_and_attempt_routes_have_no_old_api_calls(self):
        tree = ast.parse(Path(__file__).with_name('student_activity.py').read_text(encoding='utf-8'))
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in {
                    'student_activity', '_owned_material', '_definition_for', 'subject_file',
                    'start_subject_attempt', 'submit_subject_attempt'}:
                calls = {ast.unparse(n.func) for n in ast.walk(node) if isinstance(n, ast.Call)}
                self.assertFalse(calls & {'_live_subjects', 'material_schema', 'original_is_pdf', 'subject_source.material'}, node.name)

    def test_material_snapshot_supplies_text_and_quiz_without_legacy_content(self):
        row = hydrate_material({'activity_id': 1, 'material_title': 'Stored quiz',
            'material_payload': {'text_body': '<p>Local reading</p>', 'quiz': {
                'quiz_id': 2, 'passing_score': 80, 'maximum_score': 100,
                'questions': [{'question_id': 3, 'question_body': 'Example?', 'question_type': 'single_choice',
                    'options': [{'option_order': 1, 'option_text': 'Yes'}]}],
                'solutions': [{'question_id': 3, 'correct_answer': ['Yes']}]}}})
        stored = {'title': row['title'], 'reading_html': row['reading_text_body'], '_source': row}
        result = function('_definition_for', self.scope)(stored, 5)
        self.assertTrue(result['quiz']['ready'])
        self.assertEqual(result['reading_html'], '<p>Local reading</p>')
        self.assertTrue(grade_quiz(result, {'3': ['1']})['passed'])
        self.cursor.execute.assert_not_called()
        self.assertNotIn('solution_ids', public_quiz(result['quiz'])['questions'][0])

    def test_typed_video_url_is_not_replaced_by_generic_snapshot_url(self):
        row = hydrate_material({'material_content_type': 'video', 'material_video_url': 'https://video.example/player',
            'material_payload': {'iframe_url': 'https://source.example/stale'}})
        self.assertEqual(row['video_iframe_url'], 'https://video.example/player')
        self.assertNotIn('iframe_url', row['_material_schema'])

    def test_incomplete_snapshot_preserves_exact_stored_material_content(self):
        row = hydrate_material({'material_payload': {}, 'material_content_type': 'reading',
            'video_iframe_url': 'https://example.org/recording',
            'reading_iframe_url': 'https://example.org/reading.pdf',
            'audio_url': 'https://example.org/audio.mp3', 'reading_text_body': '<p>Original text</p>'})
        self.assertEqual(row['video_iframe_url'], 'https://example.org/recording')
        self.assertEqual(row['reading_iframe_url'], 'https://example.org/reading.pdf')
        self.assertEqual(row['audio_url'], 'https://example.org/audio.mp3')
        self.assertEqual(row['reading_text_body'], '<p>Original text</p>')

    def test_recovered_fallback_does_not_override_current_snapshot_link(self):
        row = hydrate_material({'material_content_type': 'video',
            'video_iframe_url': 'https://example.org/old',
            'material_payload': {'iframe_url': 'https://example.org/current'}})
        self.assertEqual(row['video_iframe_url'], 'https://example.org/current')

    def test_pending_blob_is_not_presented_as_available(self):
        row = hydrate_material({'material_blob_container': 'materials', 'material_blob_name': 'lesson.pdf',
                                'material_backup_status': 'pending'})
        self.assertFalse(row['_material_blob_ready'])

    def test_available_blob_uses_owned_route_without_exposing_blob_location(self):
        row = hydrate_material({'activity_id': 1, 'material_title': 'PDF', 'material_blob_container': 'materials',
            'material_blob_name': 'lesson.pdf', 'material_blob_content_type': 'application/pdf', 'material_backup_status': 'available'})
        definition = function('_definition_for', self.scope)({'title': 'PDF', '_source': row}, 5)
        public = function('_local_pdf_urls', self.scope)(definition, 'commercial', 3, 5, 1)
        self.assertEqual(public['media'][0]['url'], '/learner_api/student-activity/commercial/3/5/1/source-file/')
        self.assertEqual(public['media'][0]['kind'], 'pdf')
        self.assertEqual(public['media'][0]['file_name'], 'lesson.pdf')
        self.assertNotIn('source_material_file', public['media'][0])

    def test_blob_redirect_requires_ownership_and_available_backup(self):
        storage = ModuleType('learner_api.material_storage')
        storage.curriculum_archive_url = Mock(return_value='')
        storage.read_url = Mock(return_value='https://storage.example/short-lived')
        owned = Mock(return_value=(8, {'_source': {'_material_blob_ready': True,
            'material_blob_container': 'materials', 'material_blob_name': 'lesson.pdf'}}))
        self.scope.update(_owned_material=owned, _error=lambda message, status: status,
                          HttpResponseRedirect=lambda url: {'Location': url})
        view = function('source_material_file', self.scope)
        with patch.dict(sys.modules, {'learner_api.material_storage': storage}):
            response = view(None, 'commercial', 3, 5, 1)
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            storage.read_url.assert_called_once_with(owned.return_value[1]['_source'], settings)
            storage.read_url.reset_mock()
            owned.side_effect = LookupError('Not owned')
            self.assertEqual(view(None, 'commercial', 3, 5, 1), 404)
            storage.read_url.assert_not_called()

    def test_extensionless_blob_keeps_the_pdf_preview_type(self):
        row = hydrate_material({'activity_id': 1, 'material_title': 'Reading',
            'material_blob_container': 'private', 'material_blob_name': 'source-materials/1/abcdef',
            'material_blob_content_type': 'application/pdf', 'material_backup_status': 'available'})
        result = function('_definition_for', self.scope)({'title': 'Reading', '_source': row}, 5)
        self.assertEqual(result['media'][0]['file_name'], 'Reading.pdf')

    def test_registered_primary_preserves_other_media_and_reading(self):
        row = hydrate_material({'activity_id': 1, 'material_title': 'Video and reading',
            'material_content_type': 'video', 'material_blob_container': 'curriculum',
            'material_blob_name': '_legacy_files/9/lesson.mp4', 'material_blob_content_type': 'video/mp4',
            'material_backup_status': 'available',
            'material_video_url': '/curriculum_api/curriculum/uploads/_legacy_files/9/lesson.mp4',
            'material_reading_url': 'https://example.test/companion.pdf',
            'reading_text_body': '<p>Required companion reading</p>'})
        stored = {'title': row['title'], 'video_url': row['video_iframe_url'],
                  'reading_url': row['reading_iframe_url'], 'reading_html': row['reading_text_body'], '_source': row}
        result = function('_definition_for', self.scope)(stored, 5)
        self.assertTrue(result['media'][0]['source_material_file'])
        self.assertEqual(result['media'][1]['url'], stored['reading_url'])
        self.assertTrue(result['has_reading'])
        self.assertEqual(result['reading_html'], stored['reading_html'])

    def test_registered_primary_keeps_a_different_manifest_attachment(self):
        self.proxy._legacy_attachment_upload_path.return_value = '_legacy_files/11/companion.pdf'
        row = hydrate_material({'activity_id': 1, 'material_title': 'Video and attachment',
            'material_content_type': 'video', 'material_blob_container': 'curriculum',
            'material_blob_name': '_legacy_files/9/lesson.mp4', 'material_blob_content_type': 'video/mp4',
            'material_backup_status': 'available',
            'material_video_url': '/curriculum_api/curriculum/uploads/_legacy_files/9/lesson.mp4',
            'material_payload': {'source': {'attachments': [
                {'attachment_id': 11, 'content_type': 'pdf', 'filename': 'companion.pdf'}]}}})
        stored = {'title': row['title'], 'video_url': row['video_iframe_url'], '_source': row}
        result = function('_definition_for', self.scope)(stored, 5)
        self.assertTrue(result['media'][0]['source_material_file'])
        self.assertEqual(result['media'][1]['url'], '/curriculum_api/curriculum/uploads/_legacy_files/11/companion.pdf')
        self.assertTrue(result['has_reading'])

    def test_material_query_follows_foreign_key_and_rejects_ambiguous_rows(self):
        path = Path(__file__).with_name('student_activity_data.py')
        tree = ast.parse(path.read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'read_student_material')
        scope = {'hydrate_material': hydrate_material, '_json_list': lambda v: v or [],
                 '_dict_rows': lambda _: [{'learner_name': 'Test', 'title': '', 'material_title': 'Local',
                    'quiz_body': None, 'material_payload': {'text_body': 'Local content'}}]}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), scope)
        result = scope['read_student_material'](self.cursor, 8, 5, 1, include_source=True)
        self.assertEqual(result['reading_html'], 'Local content')
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('material.material_id=catalogue.source_material_id', sql)
        self.assertIn('material.deleted_at IS NULL', sql)
        self.assertIn('membership.learner_id=l.id', sql)
        self.assertEqual(params, [1, 8, 5, 'material:1'])
        scope['_dict_rows'] = lambda _: [{}, {}]
        self.assertIsNone(scope['read_student_material'](self.cursor, 8, 5, 1))

    def test_migrated_companion_uses_its_verified_path_without_wordpress_lookup(self):
        local = '/curriculum_api/curriculum/uploads/_legacy_files/11/companion.pdf'
        schema = {'source': {'attachments': [{'attachment_id': 11, 'content_type': 'pdf',
                    'filename': 'companion.pdf', 'lms_url': local}]}}
        resolver = Mock(side_effect=AssertionError('Unnecessary legacy lookup'))
        result = build_material(self.stored, schema, attachment_resolver=resolver)
        self.assertEqual(result['media'][0]['url'], local)
        self.assertEqual(result['unavailable_attachments'], [])
        resolver.assert_not_called()

    def test_inline_migration_does_not_restore_the_old_wordpress_navigation(self):
        row = hydrate_material({'material_content_type': 'video',
            'video_iframe_url': 'https://source.example/stm-lessons/reading/',
            'material_payload': {'reading_text_body': '<p>Stored lesson</p>',
                'video_iframe_url': '', 'lms_cleared_media_fields': ['video_iframe_url']}})
        self.assertEqual(row['video_iframe_url'], '')
        self.assertEqual(row['reading_text_body'], '<p>Stored lesson</p>')

    def test_migrated_companion_rejects_foreign_and_mismatched_attachment_paths(self):
        for url in ('https://outside.example/file.pdf',
                    '/curriculum_api/curriculum/uploads/_legacy_files/12/file.pdf',
                    '/curriculum_api/curriculum/uploads/_legacy_files/11/..%2Fother.pdf'):
            schema = {'source': {'attachments': [{'attachment_id': 11, 'lms_url': url}]}}
            resolver = Mock(return_value='')
            result = build_material(self.stored, schema, attachment_resolver=resolver)
            self.assertFalse(result['media'])
            resolver.assert_called_once_with('11')


if __name__ == '__main__':
    unittest.main()
