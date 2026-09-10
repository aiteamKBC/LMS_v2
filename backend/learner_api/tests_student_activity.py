"""Database-free tests for the historical modules pilot and ownership gate."""

import json
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from learner_api.student_activity import (
    student_activity, subject_covers, upload_subject_cover,
    _builder_cover_url, _builder_subject_metadata, _material_response,
    combined_recorded_otjh, _direct_progress_otjh,
)
from learner_api.student_activity_data import (
    read_audit_hour_totals, read_student_activity, summarize_activities, read_student_material,
)
from learner_api.subject_dates import activity_schedule
from learner_api.student_activity_access import student_activity_available
from learner_api.subject_content import build_material, grade_quiz


class StudentActivityTests(SimpleTestCase):
    def test_fractional_pass_mark_is_checked_before_display_rounding(self):
        definition = {'quiz': {'ready': True, 'passing_percent': 1 / 3 * 100,
            'questions': [{'id': str(index), 'type': 'single_choice', 'solution_ids': ['a'],
                           'options': [{'id': 'a'}, {'id': 'b'}]} for index in range(3)]}}
        result = grade_quiz(definition, {'0': ['a'], '1': ['b'], '2': ['b']})
        self.assertEqual(result['score_percent'], 33.3333)
        self.assertTrue(result['passed'])
        self.assertFalse(grade_quiz(definition, {'0': ['b'], '1': ['b'], '2': ['b']})['passed'])

    def test_audio_sources_keep_html_players_out_of_the_native_audio_element(self):
        cases = [
            ('https://kentbusinesscollege.org/wp-json/kbc-lms/v1/material/71833/embed?attachment_id=71832', 'embed'),
            ('https://kentbusinesscollege.org/stm-lessons/podcast/', 'embed'),
            ('https://open.spotify.com/embed/episode/example', 'embed'),
            ('https://example.org/recording.mp3?download=1', 'audio'),
            ('https://drive.google.com/file/d/abcdefghijklm/view', 'audio'),
        ]
        for url, expected in cases:
            with self.subTest(url=url):
                stored = {'title': 'Podcast', 'audio_url': url, '_source': {}}
                for schema in (None, {'component_type': 'lesson', 'content_type': 'podcast', 'iframe_url': url}):
                    material = build_material(stored, schema)
                    self.assertEqual(material['media'][0]['kind'], expected)
                    self.assertEqual(material['media'][0]['url'], url)
                    self.assertTrue(material['available'])
                    self.assertFalse(material['has_reading'])

    def test_material_is_membership_scoped_and_omits_grading_keys(self):
        cursor = MagicMock()
        row = dict(learner_name='Anna', title='Quiz', video_iframe_url=None,
                   reading_iframe_url=None, reading_text_body=None, audio_url=None,
                   quiz_body='Brief', quiz_questions=[{'question_body': 'Question',
                       'correct_answer': 'Secret', 'options': [{'option_body': 'A', 'is_correct': True}]}])
        with patch('learner_api.student_activity_data._dict_rows', return_value=[row]):
            result = read_student_material(cursor, 4176, 1, 10)
        self.assertEqual(cursor.execute.call_args.args[1], [4176, 1, 10])
        self.assertEqual(result['questions'], [{'text': 'Question', 'options': ['A']}])
        with patch('learner_api.student_activity_data._dict_rows', return_value=[]):
            self.assertIsNone(read_student_material(cursor, 4176, 2, 10))

    def test_every_valid_aptem_identity_is_eligible(self):
        for value in (92, "4176", " 2030 ", 14183, 999999):
            self.assertTrue(student_activity_available(value))
        for value in (None, "", "Anna Rundell", 0, -1, "4176.0"):
            self.assertFalse(student_activity_available(value))

    def test_material_completion_agrees_with_historical_rules_and_saved_attempts(self):
        cases = [
            ({'status': 'completed'}, [], True),
            ({'video_completed': True}, [], True),
            ({'reading_type': 'pdf', 'reading_viewed': True}, [], True),
            ({'quiz_id': 5, 'quiz_passed': False}, [], False),
            ({'quiz_id': 5, 'quiz_passed': True, 'reading_type': 'pdf', 'reading_viewed': False}, [], False),
            ({'quiz_id': 5, 'quiz_passed': True, 'reading_type': 'pdf', 'reading_viewed': True}, [], True),
            ({}, [{'completed': True}, {'completed': False}], True),
            ({}, [{'completed': False}], False),
        ]
        with patch('learner_api.student_activity._definition_for', return_value={'quiz': None}), \
             patch('learner_api.student_activity.authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=132)):
            for historical, attempts, expected in cases:
                with self.subTest(historical=historical, attempts=attempts), \
                     patch('learner_api.student_activity.subject_store.state', return_value={'ready': True, 'history': attempts}):
                    response = _material_response(self.factory.get('/'), 132, 4176, {
                        'learner_name': 'Anna', '_source': {'activity_id': 10, **historical},
                    })
                payload = json.loads(response.content)
                self.assertEqual(payload['completed'], expected)
                self.assertTrue(payload['can_attempt'])

    def test_missing_hours_are_not_zero_and_shared_activities_count_once(self):
        item = {"source_activity_id": 10, "group_id": 1, "completed": True,
                "hours_mapped": True, "actual": 1.5,
                "planned_hours_mapped": False, "planned": 0}
        payload = summarize_activities([item, {**item, "group_id": 2}])
        self.assertEqual(payload["count"], 2)
        self.assertEqual(payload["unique_activity_count"], 1)
        self.assertEqual(payload["module_count"], 2)
        self.assertEqual(payload["actual_total"], 1.5)
        self.assertIsNone(payload["planned_total"])
        self.assertEqual(payload["mapped_count"], 1)
        self.assertIsNone(summarize_activities([])["actual_total"])

    def test_recorded_zero_is_available(self):
        payload = summarize_activities([{
            "source_activity_id": 10, "group_id": 1, "completed": False,
            "hours_mapped": True, "actual": 0,
            "planned_hours_mapped": True, "planned": 0,
        }])
        self.assertEqual(payload["actual_total"], 0)
        self.assertEqual(payload["planned_total"], 0)
        self.assertEqual(payload["mapped_count"], 1)

    def test_audit_hours_match_the_learner_search_sources(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (867, 1171.3406)

        totals = read_audit_hour_totals(cursor, 92)

        self.assertEqual(totals, {
            'audit_tp_planned': 867.0,
            'audit_lms_actual': 1171.34,
        })
        self.assertEqual(cursor.execute.call_args.args[1], [92])

    def test_shared_activity_uses_available_hours_even_if_first_placement_is_unmapped(self):
        missing = {"source_activity_id": 10, "group_id": 1, "completed": False,
                   "hours_mapped": False, "actual": 0,
                   "planned_hours_mapped": False, "planned": 0}
        mapped = {**missing, "group_id": 2, "hours_mapped": True, "actual": 1.5}
        self.assertEqual(summarize_activities([missing, mapped])["actual_total"], 1.5)
        self.assertFalse(missing["hours_mapped"])

    def test_reader_uses_pipeline_hours_and_reserved_hours_fallback(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (623, "Anna Rundell")
        base = {"group_id": 1, "learner_id": 623, "aptem_id": 4176,
                "learner_name": "Anna Rundell", "activity_id": 10,
                "activity_type": "Video", "title": "Lesson", "status": "completed",
                "mapped_seconds": 7200, "otjh_actual": 1.25, "otjh_planned": None}
        with patch("learner_api.student_activity_data._dict_rows", return_value=[base]):
            payload = read_student_activity(cursor, 4176)
        self.assertEqual(payload["actual_total"], 1.25)
        self.assertTrue(payload["activities"][0]["completed"])
        self.assertFalse(payload["activities"][0]["planned_hours_mapped"])
        self.assertNotIn("iframe_url", payload["activities"][0])
        self.assertEqual(cursor.execute.call_args.args[1], [4176])
        with patch("learner_api.student_activity_data._dict_rows", return_value=[{**base, "otjh_actual": None}]):
            self.assertEqual(read_student_activity(cursor, 4176)["actual_total"], 2)

    def test_unknown_audit_identity_is_not_an_empty_success(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        self.assertIsNone(read_student_activity(cursor, 4176))
        self.assertEqual(cursor.execute.call_count, 1)

    def setUp(self):
        self.factory = RequestFactory()
        state_patch = patch('learner_api.student_activity.subject_store.state', return_value={
            'ready': False, 'progress': [], 'history': [], 'covers': {},
        })
        state_patch.start()
        self.addCleanup(state_patch.stop)
        direct_progress_patch = patch('learner_api.student_activity._direct_progress_records', return_value=[])
        direct_progress_patch.start()
        self.addCleanup(direct_progress_patch.stop)
        audit_hours_patch = patch('learner_api.student_activity.read_audit_hour_totals', return_value={
            'audit_tp_planned': 867.0,
            'audit_lms_actual': 1171.34,
        })
        audit_hours_patch.start()
        self.addCleanup(audit_hours_patch.stop)

    def test_recorded_otjh_adds_new_platform_time_to_all_historical_subjects(self):
        self.assertEqual(combined_recorded_otjh(285.4038, 1.5), 286.9038)
        self.assertEqual(combined_recorded_otjh(0, 0), 0)
        self.assertIsNone(combined_recorded_otjh(None, 0))

    def test_new_platform_time_keeps_minute_precision(self):
        progress = [{
            'kind': 'component', 'componentId': 'new-reading',
            'reportedTime': '32m', 'submittedAt': '2026-09-10T09:00:00Z',
        }]
        self.assertAlmostEqual(_direct_progress_otjh(progress), 32 / 60)

    @patch("login.permissions._auth_gate_enabled", return_value=True)
    @patch("login.permissions.authenticate_request")
    def test_learner_cannot_read_another_learners_activity(self, authenticate, _gate):
        authenticate.return_value = SimpleNamespace(role="learner", subject_id=133)
        with patch("learner_api.student_activity.read_student_activity") as reader:
            response = student_activity(self.factory.get("/"), kind="commercial", pk=132)
        self.assertEqual(response.status_code, 404)
        reader.assert_not_called()

    @patch("login.permissions._auth_gate_enabled", return_value=True)
    @patch("login.permissions.authenticate_request")
    def test_identity_resolved_from_enrolment_ignores_query_filters(self, authenticate, _gate):
        authenticate.return_value = SimpleNamespace(role="learner", subject_id=132)
        model = MagicMock()
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(aptem_id="4176")
        expected = {"learner_name": "Anna Rundell", **summarize_activities([])}
        with patch("learner_api.student_activity.SOURCE_MODELS", {"commercial": model}), \
             patch("learner_api.student_activity._connection") as connection, \
             patch("learner_api.student_activity.read_student_activity", return_value=expected) as reader:
            request = self.factory.get("/?aptem_id=92&offset=999&category=attendance")
            response = student_activity(request, kind="commercial", pk=132)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["learner_name"], "Anna Rundell")
        model.all_learners.only.return_value.get.assert_called_once_with(pk=132)
        reader.assert_called_once_with(connection.return_value.cursor.return_value.__enter__.return_value, 4176)
        self.assertEqual(request.GET["aptem_id"], "92")

    @patch("login.permissions._auth_gate_enabled", return_value=True)
    @patch("login.permissions.authenticate_request")
    def test_activity_response_preserves_saved_progress(self, authenticate, _gate):
        authenticate.return_value = SimpleNamespace(role='learner', subject_id=132)
        model = MagicMock()
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(aptem_id='4176', email='')
        item = dict(activity_id='la:1:10', source_activity_id=10, group_id=1, activity='Workshop',
                    completed=False, hours_mapped=False, planned_hours_mapped=False, actual=0, planned=0,
                    quiz_score=None, quiz_maximum_score=None, **activity_schedule('Workshop', '2026-05-14'))
        payload = {'learner_name': 'Anna', **summarize_activities([item])}
        saved = {'ready': True, 'covers': {}, 'history': [], 'progress': [{'activity_id': 10, 'completed': True, 'best_percent': 90, 'attempt_count': 1}]}
        with patch('learner_api.student_activity.SOURCE_MODELS', {'commercial': model}), \
             patch('learner_api.student_activity._connection'), \
             patch('learner_api.student_activity.read_student_activity', return_value=payload), \
             patch('learner_api.student_activity.subject_store.state', return_value=saved):
            response = student_activity(self.factory.get('/'), kind='commercial', pk=132)
        self.assertEqual(response.status_code, 200)
        result = json.loads(response.content)
        self.assertEqual(result['activities'][0]['date'], '2026-05-14')
        self.assertEqual(result['activities'][0]['best_score_percent'], 90)
        self.assertEqual(result['count'], 1)
        self.assertEqual(result['completed_count'], 1)
        self.assertEqual(result['audit_tp_planned'], 867.0)
        self.assertEqual(result['audit_lms_actual'], 1171.34)
        self.assertIsNone(result['recorded_otjh_total'])
        self.assertEqual(result['direct_otjh_activities'], [])

    @patch("login.permissions._auth_gate_enabled", return_value=True)
    @patch("login.permissions.authenticate_request")
    def test_unknown_audit_identity_returns_not_found(self, authenticate, _gate):
        authenticate.return_value = SimpleNamespace(role="staff")
        model = MagicMock()
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(aptem_id="999999")
        with patch("learner_api.student_activity.SOURCE_MODELS", {"commercial": model}), \
             patch("learner_api.student_activity._connection") as connection, \
             patch("learner_api.student_activity.read_student_activity", return_value=None) as reader:
            response = student_activity(self.factory.get("/"), kind="commercial", pk=900)
        self.assertEqual(response.status_code, 404)
        reader.assert_called_once_with(connection.return_value.cursor.return_value.__enter__.return_value, 999999)

    @patch("login.permissions._auth_gate_enabled", return_value=True)
    @patch("login.permissions.authenticate_request")
    def test_audit_database_failure_returns_retryable_response(self, authenticate, _gate):
        authenticate.return_value = SimpleNamespace(role="staff")
        model = MagicMock()
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(aptem_id="4176")
        with patch("learner_api.student_activity.SOURCE_MODELS", {"commercial": model}), \
             patch("learner_api.student_activity._connection", side_effect=DatabaseError("private connection details")):
            response = student_activity(self.factory.get("/"), kind="commercial", pk=132)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private connection details", response.content.decode())


class SubjectScheduleTests(SimpleTestCase):
    def test_activity_title_precedes_lecture_date_and_creation_date(self):
        schedule = activity_schedule('Workshop 20/02/26', '2026-03-06', '2026-03-03', section_title='Lecture 06/03/26')
        self.assertEqual(schedule['date'], '2026-02-20')
        self.assertEqual(schedule['date_source'], 'title')
        self.assertFalse(schedule['date_needs_review'])

    def test_lecture_title_date_precedes_cloned_upload_and_source_dates(self):
        for title in ('Lecture 5 - 06/03/26', 'Lecture 5 6 March 2026', 'Lecture 5 March 6, 2026', 'Lecture 5 2026-03-06', 'Lecture 5 ٠٦/٠٣/٢٠٢٦'):
            with self.subTest(title=title):
                schedule = activity_schedule('Critical Chain', '2026-04-10', '2026-04-11', section_title=title)
                self.assertEqual(schedule['date'], '2026-03-06')
                self.assertEqual(schedule['date_source'], 'section_title')
                self.assertEqual(schedule['source_date'], '2026-04-10')
                self.assertFalse(schedule['date_needs_review'])

    def test_ambiguous_and_partial_lecture_dates_need_review_without_upload_fallback(self):
        for title in ('Workshop 6 March', 'Workshop 06/03/26 or 13/03/26', 'Workshop 31/02/26'):
            with self.subTest(title=title):
                schedule = activity_schedule('Critical Chain', '2026-04-10', section_title=title)
                self.assertIsNone(schedule['date'])
                self.assertEqual(schedule['month'], 'undated')
                self.assertTrue(schedule['date_needs_review'])

    def test_creation_and_stored_dates_remain_available_but_need_confirmation(self):
        for created, expected, source in ((None, '2026-04-10', 'source_date'), ('2026-03-06T10:00:00Z', '2026-03-06', 'original_created_at')):
            schedule = activity_schedule('Course templates', '2026-04-10', created, section_title='Important templates')
            self.assertEqual(schedule['date'], expected)
            self.assertEqual(schedule['date_source'], source)
            self.assertTrue(schedule['date_needs_review'])

class SubjectBuilderCoverTests(SimpleTestCase):
    @patch('login.permissions.authenticate_request')
    def test_builder_image_save_only_updates_artwork(self, authenticate):
        from curriculum_api.views import curriculum_module_detail
        authenticate.return_value = SimpleNamespace(role='staff')
        image = 'data:image/png;base64,aGVsbG8='
        with patch('curriculum_api.views.connection') as connection, \
             patch('curriculum_api.views.invalidate_curriculum_cache') as invalidate, \
             patch('curriculum_api.views.save_module_authoring_structure') as save_structure:
            cursor = connection.cursor.return_value.__enter__.return_value
            cursor.fetchone.return_value = ('MOD-1',)
            for cover in (image, ''):
                request = RequestFactory().patch('/', json.dumps({'coverImage': cover}), content_type='application/json')
                response = curriculum_module_detail(request, identifier='MOD-1')
                self.assertEqual(response.status_code, 200)
                sql, params = cursor.execute.call_args.args
                self.assertEqual(params, [cover, 'MOD-1'])
                self.assertIn('cover_image_url=%s,updated_at=CURRENT_TIMESTAMP', sql)
                self.assertNotIn('weeks', sql)
                self.assertEqual(json.loads(response.content)['coverImage'], cover)
            self.assertEqual(cursor.execute.call_count, 2)
            self.assertEqual(invalidate.call_count, 2)
            save_structure.assert_not_called()

    @patch('login.permissions.authenticate_request')
    def test_learner_cannot_save_a_builder_image(self, authenticate):
        from curriculum_api.views import curriculum_module_detail
        authenticate.return_value = SimpleNamespace(role='learner', subject_id=132)
        with patch('curriculum_api.views.connection') as connection:
            request = RequestFactory().patch('/', json.dumps({'coverImage': ''}), content_type='application/json')
            response = curriculum_module_detail(request, identifier='MOD-1')
        self.assertEqual(response.status_code, 403)
        connection.cursor.assert_not_called()

    @patch('login.permissions.authenticate_request')
    def test_invalid_builder_image_does_not_reach_storage(self, authenticate):
        from curriculum_api.views import curriculum_module_detail
        authenticate.return_value = SimpleNamespace(role='admin')
        with patch('curriculum_api.views.connection') as connection:
            for image in ('javascript:alert(1)', 'data:text/html;base64,aGVsbG8=', None):
                request = RequestFactory().patch('/', json.dumps({'coverImage': image}), content_type='application/json')
                self.assertEqual(curriculum_module_detail(request, identifier='MOD-1').status_code, 400)
            connection.cursor.assert_not_called()

    def test_builder_upload_data_urls_are_images_only(self):
        image = 'data:image/png;base64,aGVsbG8='
        self.assertEqual(_builder_cover_url(image), image)
        for value in ('data:text/html;base64,aGVsbG8=', 'javascript:alert(1)',
                      'data:image/png;base64,not valid', '//example.com/image.png'):
            self.assertEqual(_builder_cover_url(value), '')
        self.assertEqual(_builder_cover_url('/curriculum_api/curriculum/uploads/image.webp'),
                         '/curriculum_api/curriculum/uploads/image.webp')

    def test_current_card_uses_its_builder_cover_by_id(self):
        cursor = MagicMock()
        image = 'data:image/webp;base64,aGVsbG8='
        cursor.fetchall.return_value = [('MOD-1', 'Impact &amp; Planning', image)]
        covers, links = _builder_subject_metadata(cursor, ['legacy:42', 'current:MOD-1', 'legacy:99'])
        self.assertEqual(covers, {'current:MOD-1': image})
        self.assertEqual(links['current:MOD-1'], {'id': 'MOD-1', 'title': 'Impact & Planning'})
        self.assertEqual(cursor.execute.call_args.args[1], [['MOD-1']])
        self.assertNotIn('legacy:99', links)

    @patch('login.permissions._auth_gate_enabled', return_value=True)
    @patch('login.permissions.authenticate_request')
    def test_current_builder_cover_does_not_override_historical_subject_image(self, authenticate, _gate):
        authenticate.return_value = SimpleNamespace(role='staff')
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            [('legacy:42', '/media/curriculum_components/old.webp')],
            [('MOD-1', 'Renamed subject')],
            [('MOD-1', 'Renamed subject', '')],
            [('COMP-1', 'Lesson', '2026-08-22', 'Lecture 06/03/26')],
        ]
        with patch('learner_api.student_activity.connections') as connections, \
             patch('learner_api.student_activity.subject_store.ready', return_value=True), \
             patch('learner_api.student_activity._cover_url', return_value='https://example.com/old.webp'):
            connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            response = subject_covers(RequestFactory().get('/?refs=legacy:42'), pk=132)
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload['covers'], {'legacy:42': 'https://example.com/old.webp', 'current:MOD-1': ''})
        self.assertFalse(payload['can_manage'])
        self.assertNotIn('legacy:42', payload['builder_subjects'])
        self.assertEqual(payload['builder_subjects']['current:MOD-1']['id'], 'MOD-1')
        self.assertEqual(payload['activity_dates']['COMP-1']['date'], '2026-03-06')
        self.assertEqual(payload['activity_dates']['COMP-1']['date_source'], 'builder_section_title')
        self.assertFalse(payload['activity_dates']['COMP-1']['date_needs_review'])
        self.assertNotIn('activity_sources', payload)

    @patch('login.permissions.authenticate_request')
    def test_old_upload_route_cannot_write_a_separate_cover(self, authenticate):
        with patch.dict(os.environ, {'LEARNER_API_REQUIRE_AUTH': '1'}), \
             patch('learner_api.student_activity.subject_store.save_cover') as save:
            for role, expected in [('learner', 403), ('staff', 409)]:
                authenticate.return_value = SimpleNamespace(role=role, subject_id=132)
                response = upload_subject_cover(RequestFactory().post('/'), subject_ref='legacy:42')
                self.assertEqual(response.status_code, expected)
            save.assert_not_called()
