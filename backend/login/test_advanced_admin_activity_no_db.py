"""Read-only activity review keeps answer keys inside the scoped admin API."""

import json
from email.message import Message
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.parse import quote

from django.http import HttpResponse, JsonResponse
from django.test import RequestFactory, SimpleTestCase
from django.test import override_settings

from login.advanced_admin import (
    _inline_admin_pdf, _legacy_material_response, learner_component_quiz_review,
    learner_legacy_quiz_review, learner_material, learner_material_file,
    learner_material_media,
)
from login.advanced_admin_activity import (
    _review, _saved_pdf_source, legacy_quiz_review, native_quiz_review,
    live_kbc_media_response,
    saved_extra_pdf_response, saved_extra_pdf_source,
    saved_google_drive_file_id, saved_google_drive_response, saved_kbc_material_id,
    saved_kbc_source_url, saved_media_metadata, saved_office_embed, saved_pdf_response,
)


QUIZ = {
    'quiz_id': 12, 'quiz_body': '<p>Review the material</p>',
    'maximum_score': 100, 'passing_score': 60,
    'questions': [{
        'question_id': 1, 'question_body': '<p>Choose one</p>',
        'question_type': 'single_choice',
        'options': [{'option_order': 1, 'option_body': 'First'},
                    {'option_order': 2, 'option_body': 'Second'}],
    }],
    'solutions': [{'question_id': 1, 'correct_answer': ['Second']}],
}


class AdvancedAdminActivityReviewTests(SimpleTestCase):
    def test_review_contains_saved_body_options_correct_and_learner_answers(self):
        result = _review(QUIZ, [{'question_id': 1, 'learner_answer': ['First']}])
        self.assertEqual(result['body'], '<p>Review the material</p>')
        self.assertEqual(result['questions'][0]['options'], ['First', 'Second'])
        self.assertEqual(result['questions'][0]['correctAnswers'], ['Second'])
        self.assertEqual(result['questions'][0]['learnerAnswers'], ['First'])

    def test_unknown_correct_answer_is_not_invented(self):
        quiz = {**QUIZ, 'solutions': []}
        self.assertEqual(_review(quiz)['questions'][0]['correctAnswers'], [])

    def test_material_review_rejects_another_source_identity_before_opening_activity(self):
        profile = SimpleNamespace(enrolment_id=3, aptem_id=42)
        with patch('login.advanced_admin_activity.EnrolmentUser.all_learners') as learners, \
             patch('login.advanced_admin_activity._connection') as connection:
            learners.only.return_value.get.return_value = SimpleNamespace(aptem_id=43, email='person@example.test')
            with self.assertRaises(LookupError):
                legacy_quiz_review(profile, 8, 12, 'material')
        connection.assert_not_called()

    def test_out_of_scope_legacy_and_native_routes_do_not_read_quiz_data(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('login.advanced_admin_activity.legacy_quiz_review') as legacy, \
             patch('login.advanced_admin_activity.native_quiz_review') as native:
            old = learner_legacy_quiz_review.__wrapped__.__wrapped__(request, 42, 8, 12, 'material')
            current = learner_component_quiz_review.__wrapped__.__wrapped__(request, 42, 'component-1')
        self.assertEqual(old.status_code, 404)
        self.assertEqual(current.status_code, 404)
        legacy.assert_not_called()
        native.assert_not_called()

    def test_other_staff_grant_cannot_read_answer_keys(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/')
        with patch('login.permissions.authenticate_request',
                   return_value=SimpleNamespace(role='staff')) as auth, \
             patch('login.permissions._accesses_of', return_value={'enrolment'}), \
             patch('login.advanced_admin._profile_in_scope') as scoped:
            response = learner_legacy_quiz_review(request, 42, 8, 12, 'material')
        self.assertEqual(response.status_code, 403)
        auth.assert_called_once()
        scoped.assert_not_called()

    def test_scoped_legacy_route_returns_private_read_only_review(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/')
        profile = SimpleNamespace(enrolment_id=3)
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin_activity.legacy_quiz_review', return_value=_review(QUIZ)) as reader:
            response = learner_legacy_quiz_review.__wrapped__.__wrapped__(request, 42, 8, 12, 'material')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(json.loads(response.content)['quiz']['questions'][0]['correctAnswers'], ['Second'])
        reader.assert_called_once_with(profile, 8, 12, 'material')

    def test_native_quiz_uses_authored_key_and_only_the_selected_attempt(self):
        quiz = SimpleNamespace(lesson_content='<p>Lesson</p>', short_description='')
        attempt = SimpleNamespace(id=9)
        answer = SimpleNamespace(question_ref=5, chosen_answer_ref=None)
        answer.chosen_answers = MagicMock()
        answer.chosen_answers.all.return_value = [SimpleNamespace(answer_ref=7)]
        question = SimpleNamespace(id=5, question_text='Question')
        question.answers = MagicMock()
        question.answers.all.return_value = [
            SimpleNamespace(id=6, answer_text='Wrong', is_correct=False),
            SimpleNamespace(id=7, answer_text='Right', is_correct=True),
        ]
        with patch('login.advanced_admin_activity.QuizPackage.objects') as quizzes, \
             patch('login.advanced_admin_activity.LearnerProgressEntry.objects') as progress, \
             patch('login.advanced_admin_activity.LearnerQuizAnswer.objects') as selections, \
             patch('login.advanced_admin_activity.QuizQuestion.objects') as questions:
            quizzes.using.return_value.filter.return_value.first.return_value = quiz
            progress.using.return_value.filter.return_value.order_by.return_value.first.return_value = attempt
            selections.using.return_value.filter.return_value.prefetch_related.return_value = [answer]
            questions.using.return_value.filter.return_value.prefetch_related.return_value.order_by.return_value = [question]
            review = native_quiz_review(SimpleNamespace(id=42), 'component-1', {'quizMeta': {'quizId': 3}})
        self.assertEqual(review['body'], '<p>Lesson</p>')
        self.assertEqual(review['questions'][0]['correctAnswers'], ['Right'])
        self.assertEqual(review['questions'][0]['learnerAnswers'], ['Right'])
        progress.using.return_value.filter.assert_called_once_with(
            learner_id=42, component_ref='component-1', quiz_ref='3')


class AdvancedAdminSavedFileTests(SimpleTestCase):
    @override_settings(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema')
    def test_saved_media_type_uses_mime_then_attachment_extension(self):
        self.assertEqual(saved_media_metadata({
            'content_type': 'document', 'source': {'attachments': [{
                'attachment_id': 34, 'filename': 'lesson.MP4',
                'mime_type': 'application/octet-stream',
            }]},
        }), {
            'kind': 'video', 'file_name': 'lesson.MP4',
            'mime_type': 'application/octet-stream', 'attachment_id': '34',
        })
        self.assertEqual(saved_media_metadata({
            'content_type': 'document', 'source': {'attachments': [{
                'attachment_id': 35, 'filename': 'recording.bin', 'mime_type': 'audio/mpeg',
            }]},
        })['kind'], 'audio')

    @override_settings(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema')
    def test_only_exact_kbc_material_urls_are_stream_candidates(self):
        self.assertEqual(saved_kbc_material_id(
            'https://source.example/wp-json/kbc-lms/v1/material/12/view?attachment_id=34'), 12)
        self.assertIsNone(saved_kbc_material_id(
            'https://source.example.evil.test/wp-json/kbc-lms/v1/material/12/view?attachment_id=34'))
        self.assertIsNone(saved_kbc_material_id(
            'https://source.example/wp-json/kbc-lms/v1/material/12/schema'))
        self.assertTrue(saved_kbc_source_url(
            'https://source.example/stm-lessons/the-social-media-party-part-1/'))
        self.assertFalse(saved_kbc_source_url(
            'https://source.example.evil.test/stm-lessons/the-social-media-party-part-1/'))

    @override_settings(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema')
    def test_kbc_media_proxy_refreshes_and_streams_verified_video_ranges(self):
        request = RequestFactory().get(
            '/login_api/advanced-admin/learners/42/learning/material/8/12/media/0/',
            HTTP_RANGE='bytes=0-15',
        )
        schema = {
            'material_id': 12, 'content_type': 'video',
            'iframe_url': ('https://source.example/wp-json/kbc-lms/v1/material/12/view'
                           '?attachment_id=34&token=synthetic'),
            'source': {'attachments': [{
                'attachment_id': 34, 'filename': 'lesson.mp4', 'mime_type': 'video/mp4',
            }]},
        }
        headers = Message()
        headers['Content-Type'] = 'video/mp4'
        headers['Content-Length'] = '16'
        headers['Content-Range'] = 'bytes 0-15/100'
        upstream = BytesIO(b'0123456789abcdef')
        upstream.status = 206
        upstream.headers = headers
        with patch('login.advanced_admin_activity.material_schema', return_value=schema), \
             patch('login.advanced_admin_activity.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = upstream
            response = live_kbc_media_response(request, 12, 'video')
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response['Content-Type'], 'video/mp4')
        self.assertEqual(response['Content-Range'], 'bytes 0-15/100')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(b''.join(response.streaming_content), b'0123456789abcdef')
        response.close()
        sent = opener.return_value.open.call_args.args[0]
        self.assertEqual(sent.get_header('Range'), 'bytes=0-15')

    @override_settings(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema')
    def test_kbc_media_proxy_rejects_login_html_instead_of_framing_it(self):
        request = RequestFactory().get(
            '/login_api/advanced-admin/learners/42/learning/material/8/12/media/0/')
        schema = {
            'material_id': 12, 'content_type': 'video',
            'iframe_url': ('https://source.example/wp-json/kbc-lms/v1/material/12/view'
                           '?attachment_id=34&token=synthetic'),
            'source': {'attachments': [{
                'attachment_id': 34, 'filename': 'lesson.mp4', 'mime_type': 'video/mp4',
            }]},
        }
        headers = Message()
        headers['Content-Type'] = 'text/html'
        upstream = BytesIO(b'<p>Login</p>')
        upstream.status = 200
        upstream.headers = headers
        with patch('login.advanced_admin_activity.material_schema', return_value=schema), \
             patch('login.advanced_admin_activity.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = upstream
            response = live_kbc_media_response(request, 12, 'video')
        self.assertEqual(response.status_code, 502)
        self.assertTrue(upstream.closed)

    @override_settings(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema')
    def test_extra_pdf_source_requires_the_saved_stable_file_and_matching_attachment(self):
        stored = self._stored()
        stored['_source'] = {'_material_schema': {'source': {'attachments': [
            {'attachment_id': 34, 'mime_type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'},
            {'attachment_id': 35, 'mime_type': 'application/pdf', 'is_temporary': False,
             'file_url': 'https://source.example/wp-content/uploads/2026/05/companion.pdf'},
        ]}}}
        self.assertTrue(saved_extra_pdf_source(stored, '35').endswith('/companion.pdf'))
        self.assertEqual(saved_extra_pdf_source(stored, '34'), '')
        self.assertEqual(saved_extra_pdf_source(stored, '36'), '')
        stored['_source']['_material_schema']['source']['attachments'][1]['file_url'] = (
            'https://other.example/wp-content/uploads/2026/05/companion.pdf')
        self.assertEqual(saved_extra_pdf_source(stored, '35'), '')

    def test_extra_pdf_is_listed_without_archive_lookup_or_exposing_original_url(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/')
        stored = self._stored()
        stored['_source'] = {'_material_blob_ready': False, '_material_schema': {
            'content_type': 'pdf', 'source': {'attachments': [
                {'attachment_id': 34, 'filename': 'slides.pptx'},
                {'attachment_id': 35, 'filename': 'companion.pdf'},
            ]},
        }}
        with patch('learner_api.student_activity._owned_material', return_value=(123, stored)), \
             patch('login.advanced_admin_activity.saved_office_embed', return_value='office-embed'), \
             patch('login.advanced_admin_activity.saved_extra_pdf_source', return_value='saved-source'), \
             patch('learner_api.student_activity._material_response',
                   return_value=JsonResponse({'media': [{'kind': 'document', 'url': 'office-embed'}],
                                              'unavailable_attachments': ['companion.pdf']})) as material:
            response = _legacy_material_response(request, SimpleNamespace(id=42, enrolment_id=7), 8, 12)
        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(material.call_args.kwargs['attachment_resolver']('35'), '')
        self.assertEqual(payload['media'][1]['url'],
                         '/login_api/advanced-admin/learners/42/learning/material/8/12/files/35/')
        self.assertEqual(payload['unavailable_attachments'], [])
        self.assertNotIn('saved-source', response.content.decode())

    def test_extra_pdf_already_used_by_primary_player_is_not_duplicated(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/')
        stored = self._stored()
        stored['_source'] = {'_material_blob_ready': False, '_material_schema': {
            'content_type': 'pdf', 'source': {'attachments': [
                {'attachment_id': 34, 'filename': 'slides.pptx'},
                {'attachment_id': 35, 'filename': 'companion.pdf'},
            ]},
        }}
        with patch('learner_api.student_activity._owned_material', return_value=(123, stored)), \
             patch('login.advanced_admin_activity.saved_office_embed', return_value='office-embed'), \
             patch('login.advanced_admin_activity.saved_extra_pdf_source', return_value='saved-source'), \
             patch('learner_api.student_activity._material_response',
                   return_value=JsonResponse({'media': [{
                       'kind': 'pdf', 'attachment_id': '35',
                       'url': '/learner_api/student-activity/commercial/7/8/12/files/35/',
                   }], 'unavailable_attachments': ['companion.pdf']})):
            response = _legacy_material_response(request, SimpleNamespace(id=42, enrolment_id=7), 8, 12)
        payload = json.loads(response.content)
        self.assertEqual(len(payload['media']), 1)
        self.assertEqual(payload['unavailable_attachments'], [])

    def test_saved_audio_without_attachments_skips_archive_scan(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/')
        stored = self._stored()
        stored['_source'] = {'_material_schema': {'content_type': 'audio', 'source': {'attachments': []}}}
        with patch('learner_api.student_activity._owned_material', return_value=(123, stored)), \
             patch('learner_api.student_activity._material_response',
                   return_value=JsonResponse({'media': []})) as material:
            response = _legacy_material_response(request, SimpleNamespace(enrolment_id=7), 8, 12)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['X-Has-Quiz-Review'], '0')
        self.assertEqual(material.call_args.kwargs['attachment_resolver']('34'), '')

    def test_pending_single_pdf_skips_archive_scan_in_admin_material(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/')
        stored = self._stored()
        stored['_source'] = {'_material_blob_ready': False, '_material_schema': {
            'content_type': 'pdf', 'source': {'attachments': [{'attachment_id': 34}]},
        }}
        with patch('learner_api.student_activity._owned_material', return_value=(123, stored)) as owned, \
             patch('login.advanced_admin_activity._saved_pdf_source', return_value='verified-source'), \
             patch('learner_api.student_activity._material_response',
                   return_value=JsonResponse({'media': []})) as material:
            response = _legacy_material_response(request, SimpleNamespace(enrolment_id=7), 8, 12)
        self.assertEqual(response.status_code, 200)
        owned.assert_called_once_with('commercial', 7, 8, 12)
        self.assertEqual(material.call_args.kwargs['attachment_resolver']('34'), '')

    def test_saved_office_player_skips_archive_scan_for_one_attachment(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/')
        stored = self._stored()
        stored['_source'] = {'_material_blob_ready': False, '_material_schema': {
            'content_type': 'ppt', 'source': {'attachments': [{'attachment_id': 34}]},
        }}
        with patch('learner_api.student_activity._owned_material', return_value=(123, stored)), \
             patch('login.advanced_admin_activity.saved_office_embed', return_value='verified-office-embed'), \
             patch('learner_api.student_activity._material_response',
                   return_value=JsonResponse({'media': []})) as material:
            response = _legacy_material_response(request, SimpleNamespace(enrolment_id=7), 8, 12)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(material.call_args.kwargs['attachment_resolver']('34'), '')

    def test_pending_pdf_streams_before_the_slow_archive_lookup(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/files/34/')
        stored = self._stored()
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(enrolment_id=7)), \
             patch('learner_api.student_activity._owned_material', return_value=(123, stored)), \
             patch('login.advanced_admin_activity._saved_pdf_source', return_value='verified-source'), \
             patch('login.advanced_admin_activity.saved_pdf_response',
                   return_value=HttpResponse(b'%PDF-test', content_type='application/pdf')) as saved_pdf, \
             patch('learner_api.student_activity.subject_file') as archived:
            response = learner_material_file.__wrapped__.__wrapped__(request, 42, 8, 12, '34')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['X-Frame-Options'], 'SAMEORIGIN')
        saved_pdf.assert_called_once()
        archived.assert_not_called()

    def test_scoped_extra_pdf_streams_before_the_archive_lookup(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/files/35/')
        stored = self._stored()
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(enrolment_id=7)), \
             patch('learner_api.student_activity._owned_material', return_value=(123, stored)), \
             patch('login.advanced_admin_activity._saved_pdf_source', return_value=''), \
             patch('login.advanced_admin_activity.saved_extra_pdf_response',
                   return_value=HttpResponse(b'%PDF-test', content_type='application/pdf')) as extra, \
             patch('learner_api.student_activity.subject_file') as archived:
            response = learner_material_file.__wrapped__.__wrapped__(request, 42, 8, 12, '35')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['X-Frame-Options'], 'SAMEORIGIN')
        extra.assert_called_once_with(request, stored, '35')
        archived.assert_not_called()

    def test_extra_pdf_proxy_streams_verified_ranges(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/files/35/',
                                       HTTP_RANGE='bytes=0-15')
        headers = Message()
        headers['Content-Type'] = 'application/pdf'
        headers['Content-Length'] = '16'
        headers['Content-Range'] = 'bytes 0-15/100'
        upstream = BytesIO(b'%PDF-test-content')
        upstream.status = 206
        upstream.headers = headers
        with patch('login.advanced_admin_activity.saved_extra_pdf_source',
                   return_value='https://source.example/wp-content/uploads/companion.pdf'), \
             patch('login.advanced_admin_activity.urllib.request.build_opener') as build_opener:
            build_opener.return_value.open.return_value = upstream
            response = saved_extra_pdf_response(request, self._stored(), '35')
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response['Content-Range'], 'bytes 0-15/100')
        self.assertEqual(response['X-Frame-Options'], 'SAMEORIGIN')
        self.assertEqual(b''.join(response.streaming_content), b'%PDF-test-content')
        response.close()

    def test_only_scoped_pdf_responses_are_frameable(self):
        pdf = HttpResponse(b'%PDF-test', content_type='application/pdf')
        pdf['Content-Disposition'] = 'attachment; filename="slides.pdf"'
        self.assertIs(_inline_admin_pdf(pdf), pdf)
        self.assertEqual(pdf['X-Frame-Options'], 'SAMEORIGIN')
        self.assertEqual(pdf['Content-Disposition'], 'inline; filename="material.pdf"')
        html = HttpResponse('<p>Not a PDF</p>', content_type='text/html')
        self.assertIs(_inline_admin_pdf(html), html)
        self.assertNotIn('X-Frame-Options', html)

    def test_only_saved_drive_file_urls_are_stream_candidates(self):
        file_id = 'synthetic-file-id-12345'
        self.assertEqual(saved_google_drive_file_id(
            f'https://drive.google.com/file/d/{file_id}/preview'), file_id)
        self.assertEqual(saved_google_drive_file_id(
            f'https://drive.google.com/file/d/{file_id}/view?usp=sharing'), file_id)
        self.assertEqual(saved_google_drive_file_id(
            f'https://drive.google.com.evil.test/file/d/{file_id}/preview'), '')
        self.assertEqual(saved_google_drive_file_id(
            f'https://drive.google.com/file/d/{file_id}/edit'), '')

    @override_settings(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema')
    def test_admin_video_uses_a_scoped_media_url(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/')
        drive = 'https://drive.google.com/file/d/synthetic-file-id-12345/preview'
        kbc = 'https://source.example/stm-lessons/the-social-media-party-part-1/'
        youtube = 'https://www.youtube.com/embed/example-video'
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(enrolment_id=7)), \
             patch('login.advanced_admin._legacy_material_response',
                   return_value=JsonResponse({'media': [
                       {'kind': 'video', 'url': drive}, {'kind': 'video', 'url': kbc},
                       {'kind': 'video', 'url': youtube},
                   ]})):
            response = learner_material.__wrapped__.__wrapped__(request, 42, 8, 12)
        media = json.loads(response.content)['media']
        self.assertEqual(media[0]['url'],
                         '/login_api/advanced-admin/learners/42/learning/material/8/12/media/0/')
        self.assertEqual(media[1]['url'],
                         '/login_api/advanced-admin/learners/42/learning/material/8/12/media/1/')
        self.assertEqual(media[2]['url'], youtube)

    @override_settings(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema')
    def test_extensionless_kbc_video_is_typed_from_saved_attachment_metadata(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/')
        stored = self._stored()
        stored['_source'] = {'_material_schema': {
            'content_type': 'video', 'source': {'attachments': [{
                'attachment_id': 34, 'filename': 'lesson.mp4', 'mime_type': 'video/mp4',
            }]},
        }}
        source = 'https://source.example/stm-lessons/the-social-media-party-part-1/'
        with patch('learner_api.student_activity._owned_material', return_value=(123, stored)), \
             patch('learner_api.student_activity._material_response', return_value=JsonResponse({
                 'media': [{'kind': 'document', 'url': source}],
             })):
            response = _legacy_material_response(
                request, SimpleNamespace(id=42, enrolment_id=7), 8, 12)
        item = json.loads(response.content)['media'][0]
        self.assertEqual(item['kind'], 'video')
        self.assertEqual(item['file_name'], 'lesson.mp4')
        self.assertEqual(item['content_type'], 'video/mp4')

    @override_settings(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema')
    def test_scoped_kbc_stream_checks_activity_before_proxying(self):
        request = RequestFactory().get(
            '/login_api/advanced-admin/learners/42/learning/material/8/12/media/0/',
            HTTP_RANGE='bytes=0-1023',
        )
        source = 'https://source.example/stm-lessons/the-social-media-party-part-1/'
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(enrolment_id=7)), \
             patch('login.advanced_admin._legacy_material_response', return_value=JsonResponse({
                 'media': [{'kind': 'video', 'url': source}],
             })), \
             patch('login.advanced_admin_activity.live_kbc_media_response',
                   return_value=HttpResponse(b'video', content_type='video/mp4')) as proxy:
            response = learner_material_media.__wrapped__.__wrapped__(request, 42, 8, 12, 0)
        self.assertEqual(response.status_code, 200)
        proxy.assert_called_once_with(request, 12, 'video')

    def test_scoped_video_stream_checks_activity_and_media_before_proxying(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/media/0/',
                                       HTTP_RANGE='bytes=0-1023')
        drive = 'https://drive.google.com/file/d/synthetic-file-id-12345/preview'
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('login.advanced_admin_activity.saved_google_drive_response') as proxy:
            response = learner_material_media.__wrapped__.__wrapped__(request, 42, 8, 12, 0)
        self.assertEqual(response.status_code, 404)
        proxy.assert_not_called()

        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(enrolment_id=7)), \
             patch('login.advanced_admin._legacy_material_response',
                   return_value=JsonResponse({'media': [{'kind': 'video', 'url': drive}]})), \
             patch('login.advanced_admin_activity.saved_google_drive_response',
                   return_value=HttpResponse(b'video', content_type='video/mp4')) as proxy:
            response = learner_material_media.__wrapped__.__wrapped__(request, 42, 8, 12, 0)
        self.assertEqual(response.status_code, 200)
        proxy.assert_called_once_with(request, 'synthetic-file-id-12345')
        self.assertEqual(request.headers['Range'], 'bytes=0-1023')

        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(enrolment_id=7)), \
             patch('login.advanced_admin._legacy_material_response',
                   return_value=JsonResponse({'media': [{'kind': 'video', 'url': drive}]})), \
             patch('login.advanced_admin_activity.saved_google_drive_response') as proxy:
            response = learner_material_media.__wrapped__.__wrapped__(request, 42, 8, 12, 1)
        self.assertEqual(response.status_code, 404)
        proxy.assert_not_called()

    def test_scoped_drive_response_streams_ranges_without_buffering_on_wsgi(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/media/0/',
                                       HTTP_RANGE='bytes=0-15')
        headers = Message()
        headers['Content-Type'] = 'video/mp4'
        headers['Content-Length'] = '16'
        headers['Content-Range'] = 'bytes 0-15/100'
        upstream = BytesIO(b'0123456789abcdef')
        upstream.status = 206
        upstream.headers = headers
        with patch('learner_api.media_proxy._open_google_drive_file', return_value=upstream) as open_file:
            response = saved_google_drive_response(request, 'synthetic-file-id-12345')
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response['Content-Range'], 'bytes 0-15/100')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(b''.join(response.streaming_content), b'0123456789abcdef')
        response.close()
        open_file.assert_called_once_with('synthetic-file-id-12345', 'bytes=0-15')

    def _stored(self, host='source.example', material_id=12, attachment_id=34):
        original = (f'https://{host}/wp-json/kbc-lms/v1/material/{material_id}/view'
                    f'?attachment_id={attachment_id}&token=synthetic')
        return {'reading_url': 'https://view.officeapps.live.com/op/embed.aspx?src='
                + quote(original, safe=''), '_source': {}}

    @override_settings(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema')
    def test_only_exact_saved_attachment_can_be_proxied(self):
        stored = self._stored()
        self.assertIn('attachment_id=34', _saved_pdf_source(stored, 12, '34'))
        self.assertEqual(_saved_pdf_source(stored, 12, '99'), '')
        self.assertEqual(_saved_pdf_source(self._stored(host='other.example'), 12, '34'), '')
        self.assertEqual(_saved_pdf_source(self._stored(material_id=13), 12, '34'), '')
        self.assertTrue(saved_office_embed(stored).startswith('https://view.officeapps.live.com/op/embed.aspx'))

    @override_settings(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema')
    def test_pending_pdf_streams_from_saved_iframe_on_the_lms_origin(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/files/34/')
        headers = Message()
        headers['Content-Type'] = 'application/pdf'
        headers['Content-Length'] = '9'
        upstream = BytesIO(b'%PDF-test')
        upstream.status = 200
        upstream.headers = headers
        with patch('login.advanced_admin_activity.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = upstream
            response = saved_pdf_response(request, self._stored(), 12, '34')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(b''.join(response.streaming_content), b'%PDF-test')
        opener.return_value.open.assert_called_once()

    def test_scoped_file_route_uses_saved_pdf_only_after_local_file_is_missing(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/files/34/')
        profile = SimpleNamespace(enrolment_id=7)
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('learner_api.student_activity.subject_file', return_value=HttpResponse(status=404)), \
             patch('learner_api.student_activity._owned_material', return_value=(42, self._stored())) as owned, \
             patch('login.advanced_admin_activity.saved_pdf_response',
                   return_value=HttpResponse(b'%PDF-test', content_type='application/pdf')) as fallback:
            response = learner_material_file.__wrapped__.__wrapped__(request, 42, 8, 12, '34')
        self.assertEqual(response.status_code, 200)
        owned.assert_called_once_with('commercial', 7, 8, 12)
        fallback.assert_called_once()

    def test_admin_material_uses_saved_office_iframe_for_available_deck(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/')
        source = '/learner_api/student-activity/commercial/7/8/12/source-file/'
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(enrolment_id=7)), \
             patch('login.advanced_admin._legacy_material_response',
                   return_value=JsonResponse({'media': [{'kind': 'document', 'url': source}]})), \
             patch('learner_api.student_activity._owned_material', return_value=(42, self._stored())):
            response = learner_material.__wrapped__.__wrapped__(request, 42, 8, 12)
        media = json.loads(response.content)['media']
        self.assertEqual(media[0]['url'], self._stored()['reading_url'])
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_admin_material_keeps_pending_pdf_on_its_scoped_lms_route(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/8/12/')
        source = '/learner_api/student-activity/commercial/7/8/12/files/34/'
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(enrolment_id=7)), \
             patch('login.advanced_admin._legacy_material_response',
                   return_value=JsonResponse({'media': [{
                       'kind': 'pdf', 'url': source, 'attachment_id': '34',
                       'file_name': 'slides.pdf',
                   }], 'unavailable_attachments': ['slides.pdf', 'missing-notes.pdf']})):
            response = learner_material.__wrapped__.__wrapped__(request, 42, 8, 12)
        payload = json.loads(response.content)
        self.assertEqual(payload['media'][0]['url'],
                         '/login_api/advanced-admin/learners/42/learning/material/8/12/files/34/')
        self.assertEqual(payload['unavailable_attachments'], ['missing-notes.pdf'])
