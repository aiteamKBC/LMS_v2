"""Database-free regressions for incomplete historical course snapshots."""
from contextlib import ExitStack
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import subject_source as source
from . import student_activity as views
from .subject_content import ContentUnavailable, public_quiz
from .subject_dates import activity_schedule


def course():
    return {'id': 500, 'name': 'Course', 'activities': [
        {'activity_id': 10, 'title': 'Recording', 'activity_type': 'Video',
         'activity_date': '2026-08-24', 'video': {'iframe_url': 'https://example.org/video'}},
        {'activity_id': 20, 'title': 'Reading and quiz', 'activity_type': 'Reading+Quiz',
         'activity_date': '2026-08-24', 'reading': {'reading_type': 'pdf',
             'iframe_url': 'https://example.org/reading.pdf', 'text_body': '<p>Companion</p>'},
         'quiz': {'quiz_id': 21, 'maximum_score': 10, 'passing_score': 7}},
    ], 'results': [
        {'activity_id': 10, 'status': 'completed', 'video_result': {'completed': True}},
        {'activity_id': 20, 'status': 'quiz_attempted', 'reading_result': {'viewed': True},
         'quiz_result': {'attempted': True, 'passed': True, 'score': 9, 'maximum_score': 10,
             'answers': [{'question_id': 1, 'learner_answer': 'A', 'correct_answer': 'private'}]}},
    ]}


def page(group=None, ident=7, email='learner@example.org'):
    group = group or course()
    return {'pagination': {'page': 3, 'per_page': 20}, 'groups': [{
        'group_id': group['id'], 'group_name': group['name'], 'activities': group['activities'],
        'learners': [{'learner_id': ident, 'learner_email': email, 'activity_results': group['results']}],
    }]}


def quiz():
    return {'quiz_id': 21, 'maximum_score': 10, 'passing_score': 7,
        'questions': [{'question_id': 1, 'question_body': 'Choose', 'question_type': 'single_choice',
                       'options': [{'option_order': 1, 'option_body': 'A'}, {'option_order': 2, 'option_body': 'B'}]}],
        'solutions': [{'question_id': 1, 'correct_answer': ['A']}]}


@override_settings(KBC_LMS_SCHEMA_URL='https://example.org/schema', KBC_LMS_API_KEY='test-key')
class SubjectSourceTests(SimpleTestCase):
    def setUp(self):
        source._cache.clear()
        self.addCleanup(source._cache.clear)
        self.stack = self.enterContext(ExitStack())
        self._real_schedule = source.course_schedule
        self.schedule = self.stack.enter_context(patch.object(source, 'course_schedule', return_value={}))
        self.live = {'groups': [course()]}
        self.empty = {'aptem_id': 77, 'learner_name': 'Learner', 'subjects': [], 'activities': []}

    def test_snapshot_replaces_obsolete_ids_and_keeps_combined_activity(self):
        previous = source.overlay_subjects(self.empty, self.live, {})
        first = previous['activities'][0]
        first.update(actual=1.5, planned=2, hours_mapped=True, planned_hours_mapped=True)
        previous['activities'].append({**first, 'source_activity_id': 99, 'activity_id': 'la:500:99'})
        previous['activities'].append({**first, 'group_id': 600, 'activity_id': 'la:600:10'})
        result = source.overlay_subjects(previous, self.live, {})
        ids = [(a['group_id'], a['source_activity_id']) for a in result['activities']]
        self.assertEqual(set(ids), {(500, 10), (500, 20), (600, 10)})
        combined = next(a for a in result['activities'] if a['source_activity_id'] == 20)
        self.assertTrue(combined['completed'])
        self.assertEqual(combined['quiz_score'], 9)
        restored = next(a for a in result['activities'] if a['group_id'] == 500 and a['source_activity_id'] == 10)
        self.assertEqual(restored['actual'], 1.5)
        self.assertEqual(restored['planned'], 2)
        self.assertNotIn('private', json.dumps(result))
        self.assertNotIn('quiz_answers', json.dumps(result))

    def test_source_retake_does_not_erase_historical_completion_or_best_score(self):
        before = source.overlay_subjects(self.empty, self.live, {})
        self.live['groups'][0]['results'] = []
        result = source.overlay_subjects(before, self.live, {})
        self.assertTrue(all(a['completed'] for a in result['activities']))
        self.assertEqual(result['activities'][1]['quiz_score'], 9)

    def test_score_and_review_stay_with_best_attempt(self):
        old = {'quiz_score': 9, 'quiz_maximum_score': 10, 'quiz_answers': ['old'], 'quiz_passed': True}
        result = source.merge_result(old, {'quiz_score': 70, 'quiz_maximum_score': 100, 'quiz_answers': ['new'], 'quiz_passed': False})
        self.assertEqual((result['quiz_score'], result['quiz_maximum_score'], result['quiz_answers']), (9, 10, ['old']))
        self.assertTrue(result['quiz_passed'])

    def test_failed_source_preserves_mirror(self):
        self.assertIs(source.overlay_subjects(self.empty, None, {}), self.empty)

    def test_source_requires_exact_identity_and_email(self):
        self.assertIsNone(source._select(page(), 8, 'learner@example.org'))
        with self.assertRaises(ValueError):
            source._select(page(), 7, 'someoneelse@example.org')
        payload = page()
        payload['groups'][0]['learners'].append({'learner_id': 8, 'learner_email': 'other@example.org', 'activity_results': ['other private results']})
        chosen = source._select(payload, 7, 'learner@example.org')
        self.assertEqual(chosen, [course()])
        self.assertNotIn('other private results', json.dumps(chosen))

    def test_duplicate_or_incomplete_source_is_rejected(self):
        payload = page()
        payload['groups'][0]['activities'].append(payload['groups'][0]['activities'][0])
        with self.assertRaises(ValueError):
            source._select(payload, 7, 'learner@example.org')
        payload = page()
        payload['groups'][0]['learners'][0].pop('activity_results')
        with self.assertRaises(ValueError):
            source._select(payload, 7, 'learner@example.org')

    def test_hint_is_routing_only_and_neighbour_page_can_recover(self):
        with patch.object(source, 'hints', return_value={'7': 3}), patch.object(source, '_page', side_effect=[page(ident=8), page()]) as fetch:
            result = source._read_identity('url', 'secret', 7, 'learner@example.org', {})
        self.assertEqual(result, [course()])
        self.assertEqual([c.args[-1] for c in fetch.call_args_list], [3, 2])

    def test_scoped_cache_avoids_repeated_fetch_and_cannot_mix_learners(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [(7, 7)]
        with patch.object(source, '_read_identity', return_value=[course()]) as fetch:
            first = source.read_learner(cursor, 77, 'learner@example.org')
            first['groups'][0]['name'] = 'Changed outside cache'
            second = source.read_learner(cursor, 77, 'learner@example.org')
            self.assertEqual(second['groups'][0]['name'], 'Course')
            self.assertEqual(fetch.call_count, 1)
            cursor.fetchall.return_value = []
            self.assertIsNone(source.read_learner(cursor, 78, 'another@example.org'))
            self.assertEqual(fetch.call_count, 1)

    def test_failure_reuses_recent_complete_snapshot_with_retry_backoff(self):
        with patch.object(source, 'monotonic', return_value=0):
            source._remember('test', lambda: self.live)
        failed = MagicMock(side_effect=OSError('unavailable'))
        with patch.object(source, 'monotonic', return_value=301):
            self.assertEqual(source._remember('test', failed), self.live)
            self.assertEqual(source._remember('test', failed), self.live)
        self.assertEqual(failed.call_count, 1)
        with patch.object(source, 'monotonic', return_value=3601):
            self.assertIsNone(source._remember('test', failed))

    def test_alias_failure_cannot_publish_partial_results(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [(7, 7), (7, 8)]
        with patch.object(source, '_read_identity', side_effect=[[course()], ValueError('unmatched')]):
            self.assertIsNone(source.read_learner(cursor, 77, 'learner@example.org'))

    def test_mixed_dates_missing_year_and_undated_final_lecture(self):
        sections = [{'title': 'L9 8/18/2026', 'ids': [10]}, {'title': 'L10 25/8', 'ids': [20]},
                    {'title': 'L11 1/9/2026', 'ids': [30]}, {'title': 'L13', 'ids': [40]}]
        dates = source._section_dates(sections)
        self.assertEqual(activity_schedule(dates[10]['schedule_title'])['date'], '2026-08-18')
        self.assertEqual(activity_schedule(dates[20]['schedule_title'])['date'], '2026-08-25')
        self.assertEqual(activity_schedule(dates[30]['schedule_title'])['date'], '2026-09-01')
        self.assertEqual(activity_schedule('Lesson', '2026-08-24', section_title=dates[40]['schedule_title'])['date'], '2026-08-24')
        self.assertEqual(activity_schedule('8/9/2026')['date'], '2026-09-08')

    def test_missing_year_is_not_guessed_from_creation_date(self):
        self.assertEqual(source._section_dates([{'title': 'L10 25/8', 'ids': [20]}])[20]['schedule_title'], 'L10 25/8')

    def test_current_builder_schedule_overrides_source_only_when_edited(self):
        self.schedule.return_value = {10: {'schedule_title': 'Lecture 1/9/2026', 'section_title': 'Lecture 1/9/2026'}}
        stored = {(500, 10): {'section_title': 'Lecture 18/8/2026', 'exported_section_title': 'Lecture 18/8/2026', 'section_source': 'builder_section_title'}}
        result = source.overlay_subjects(self.empty, self.live, stored)
        self.assertEqual(result['activities'][0]['date'], '2026-09-01')
        stored[(500, 10)]['section_title'] = 'Moved lecture 7/9/2026'
        result = source.overlay_subjects(self.empty, self.live, stored)
        self.assertEqual(result['activities'][0]['date'], '2026-09-07')

    def test_extra_section_keeps_ids_results_and_hours_without_using_upload_month(self):
        group = course()
        group['id'] = 125600
        self.schedule.return_value = source._section_dates([
            {'id': '2040', 'title': 'L10 25/8/2026', 'ids': [10]},
            {'id': '2043', 'title': 'Lec13: Financial Accounts', 'ids': [20, 21]},
        ])
        before = source.overlay_subjects(self.empty, {'groups': [group]}, {})
        before['activities'][1].update(actual=1.5, planned=2, hours_mapped=True, planned_hours_mapped=True)
        result = source.overlay_subjects(before, {'groups': [group]}, {})
        dated, extra = result['activities']
        self.assertEqual((dated['month'], dated['week_start']), ('2026-08', '2026-08-24'))
        self.assertEqual((extra['source_activity_id'], extra['date_source'], extra['month']), (20, 'extra_activity', 'undated'))
        self.assertIsNone(extra['date'])
        self.assertIsNone(extra['week_start'])
        self.assertEqual(extra['source_date'], '2026-08-24')
        self.assertTrue(extra['completed'])
        self.assertEqual((extra['quiz_score'], extra['quiz_maximum_score'], extra['actual'], extra['planned']), (9, 10, 1.5, 2))
        self.assertEqual(len(result['activities']), 2)  # Reading+Quiz stays combined.
        # A same-named section, or the same ID in another course, stays put.
        group['id'] = 500
        other = source.overlay_subjects(self.empty, {'groups': [group]}, {})
        self.assertEqual(other['activities'][1]['month'], '2026-08')
        group['id'] = 125600
        self.schedule.return_value[20]['source_section_id'] = '9999'
        other = source.overlay_subjects(self.empty, {'groups': [group]}, {})
        self.assertEqual(other['activities'][1]['month'], '2026-08')

    def test_extra_section_survives_export_fallback_but_not_a_new_source_placement(self):
        from .student_activity_data import apply_curriculum_schedules, read_curriculum_schedules
        row = dict(course_id=125600, activity_id='20', section_id='2043', section_title='Lec13',
                   original_created_at='2026-08-24', builder_week_id='builder-week', builder_week_title='Lec13')
        with patch('learner_api.student_activity_data._dict_rows', return_value=[row]):
            schedules = read_curriculum_schedules(MagicMock(), [125600])
        item = dict(group_id=125600, source_activity_id=20, activity='Reading', source_date='2026-08-24')
        apply_curriculum_schedules([item], schedules)
        self.assertEqual(item['date_source'], 'extra_activity')
        group = course()
        group['id'] = 125600
        result = source.overlay_subjects(self.empty, {'groups': [group]}, schedules)
        self.assertEqual(result['activities'][1]['date_source'], 'extra_activity')
        self.schedule.return_value = source._section_dates([
            {'id': '2044', 'title': 'L14 15/9/2026', 'ids': [20, 21]},
        ])
        result = source.overlay_subjects(self.empty, {'groups': [group]}, schedules)
        self.assertEqual(result['activities'][1]['date'], '2026-09-15')
        self.assertEqual(result['activities'][1]['date_source'], 'section_title')

    def test_live_material_uses_exact_membership_and_keeps_reading(self):
        material = source.material(self.live, 500, 20, None, 'Learner')
        self.assertEqual(material['_source']['quiz_id'], 21)
        self.assertEqual(material['reading_html'], '<p>Companion</p>')
        self.assertIsNone(source.material(self.live, 501, 20, None, 'Learner'))
        self.assertIsNone(source.material(self.live, 500, 99, {'_source': {}}, 'Learner'))

    def test_course_introduction_is_not_scheduled_by_its_old_creation_date(self):
        group = course()
        group['id'] = 80621
        group['activities'][1]['activity_date'] = '2025-05-27'
        self.schedule.return_value = source._section_dates([
            {'id': '764', 'title': ' Introduction', 'ids': [20, 21]},
            {'id': '782', 'title': 'L1 21/10/2025', 'ids': [10]},
        ])
        result = source.overlay_subjects(self.empty, {'groups': [group]}, {})
        lecture, intro = result['activities']
        self.assertEqual(lecture['date'], '2025-10-21')
        self.assertEqual(intro['date_source'], 'introduction')
        self.assertEqual(intro['source_date'], '2025-05-27')
        self.assertIsNone(intro['date'])
        self.assertIsNone(intro['week_start'])
        self.assertEqual(intro['month'], 'undated')
        self.assertTrue(intro['completed'])
        self.assertEqual((intro['quiz_score'], intro['quiz_maximum_score']), (9, 10))
        self.assertEqual(len(result['activities']), 2)
        # Every course uses its own Introduction section without an ID allowlist.
        group['id'] = 500
        result = source.overlay_subjects(self.empty, {'groups': [group]}, {})
        self.assertEqual(result['activities'][1]['date_source'], 'introduction')

    def test_introduction_placement_also_applies_to_the_retained_export(self):
        from .student_activity_data import apply_curriculum_schedules, read_curriculum_schedules
        row = dict(course_id=80621, activity_id='61039', section_id='764', section_title=' Introduction',
                   original_created_at='2025-05-27T10:58:57Z', builder_week_id='builder-week', builder_week_title='Introduction')
        with patch('learner_api.student_activity_data._dict_rows', return_value=[row]):
            schedules = read_curriculum_schedules(MagicMock(), [80621])
        item = dict(group_id=80621, source_activity_id=61039, activity='Safeguarding', source_date='2025-05-27',
                    completed=True, quiz_score=80, quiz_maximum_score=100, actual=0.07, planned=0.47)
        before = dict(item)
        apply_curriculum_schedules([item], schedules)
        self.assertEqual(item['date_source'], 'introduction')
        self.assertIsNone(item['date'])
        self.assertTrue(all(item[key] == value for key, value in before.items()))

    def test_material_compares_scores_using_each_attempts_own_maximum(self):
        old = {'_source': {'quiz_score': 80, 'quiz_maximum_score': 10, 'result_maximum_score': 100}}
        result = source.material(self.live, 500, 20, old, 'Learner')
        self.assertEqual(result['_source']['quiz_score'], 9)
        self.assertEqual(result['_source']['result_maximum_score'], 10)

    def test_combined_material_loads_linked_quiz_without_splitting_reading(self):
        material = source.material(self.live, 500, 20, None, 'Learner')
        with patch.object(views, 'material_schema', side_effect=[{'component_type': 'lesson'}, {'quiz': quiz()}]) as schemas, \
                patch('learner_api.media_proxy._legacy_attachment_upload_path', return_value=''):
            result = views._definition_for(material)
        self.assertEqual([call.args[0] for call in schemas.call_args_list], [20, 21])
        self.assertTrue(result['has_reading'])
        self.assertTrue(result['quiz']['ready'])
        self.assertNotIn('solution_ids', json.dumps(public_quiz(result['quiz'])))

    def test_missing_linked_quiz_cannot_be_completed_as_reading_only(self):
        material = source.material(self.live, 500, 20, None, 'Learner')
        with patch.object(views, 'material_schema', side_effect=[{}, ContentUnavailable('Unavailable')]), \
                patch('learner_api.media_proxy._legacy_attachment_upload_path', return_value=''):
            result = views._definition_for(material)
        self.assertIsNotNone(result['quiz'])
        self.assertFalse(result['quiz']['ready'])

    def _view_setup(self):
        model = MagicMock()
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(aptem_id='77', email='learner@example.org')
        self.stack.enter_context(patch.object(views, 'SOURCE_MODELS', {'apprenticeship': model}))
        self.stack.enter_context(patch.object(views, '_connection'))
        self.stack.enter_context(patch.object(views, 'read_student_material', return_value=None))
        self.stack.enter_context(patch.object(views, '_live_subjects', return_value=self.live))
        self.stack.enter_context(patch('login.permissions._auth_gate_enabled', return_value=True))
        self.stack.enter_context(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=123)))

    def test_new_activity_opens_even_without_a_mirror_row(self):
        self._view_setup()
        with patch.object(views, '_material_response', return_value='opened') as render:
            response = views.student_activity(RequestFactory().get('/', {'group_id': 500, 'activity_id': 10}), kind='apprenticeship', pk=123)
        self.assertEqual(response, 'opened')
        self.assertEqual(render.call_args.args[-1]['_source']['activity_id'], 10)

    def test_new_activity_uses_existing_attempt_path_and_rejects_other_courses(self):
        self._view_setup()
        with patch.object(views, '_definition_for', return_value={'quiz': None, 'available': True}), \
                patch.object(views.subject_store, 'start', return_value='attempt') as start:
            response = views.start_subject_attempt(RequestFactory().post('/'), kind='apprenticeship', pk=123, group_id=500, activity_id=10)
            self.assertEqual(response.status_code, 201)
            self.assertEqual(start.call_args.args[:4], (123, 77, 500, 10))
            response = views.start_subject_attempt(RequestFactory().post('/'), kind='apprenticeship', pk=123, group_id=999, activity_id=10)
            self.assertEqual(response.status_code, 404)
            start.assert_called_once()

    def test_live_listing_merges_local_progress_before_totalling(self):
        self._view_setup()
        self.live['groups'][0]['results'] = []
        saved = {'ready': True, 'history': [], 'covers': {}, 'progress': [
            {'activity_id': 10, 'completed': True, 'best_percent': None, 'attempt_count': 1}]}
        with patch.object(views, 'read_student_activity', return_value=deepcopy(self.empty)), \
                patch.object(views.subject_store, 'state', return_value=saved):
            response = views.student_activity(RequestFactory().get('/'), kind='apprenticeship', pk=123)
        self.assertEqual(response.status_code, 200)
        result = json.loads(response.content)
        self.assertEqual((result['count'], result['completed_count']), (2, 1))
        self.assertEqual(result['module_count'], 1)

    def test_new_activity_submission_uses_existing_scoped_completion_store(self):
        self._view_setup()
        attempt_id = '9310dcde-f545-4269-990a-fbf2db424c76'
        expected = {'score_percent': 100, 'passed': True, 'completed': True}
        request = RequestFactory().post('/', json.dumps({'answers': {'1': ['1']}, 'reading_confirmed': True}), content_type='application/json')
        with patch.object(views.subject_store, 'finish', return_value=expected) as finish:
            response = views.submit_subject_attempt(request, kind='apprenticeship', pk=123, group_id=500, activity_id=20, attempt_id=attempt_id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), expected)
        finish.assert_called_once_with(123, 77, 500, 20, attempt_id, {'1': ['1']}, True)

    def test_mismatched_historical_email_does_not_enable_live_activity_access(self):
        self._view_setup()
        stored = {'learner_name': 'Someone else', '_source': {'learner_email': 'other@example.org'}}
        with patch.object(views, 'read_student_material', return_value=stored), patch.object(views, '_live_subjects') as read:
            response = views.student_activity(RequestFactory().get('/', {'group_id': 500, 'activity_id': 10}), kind='apprenticeship', pk=123)
        self.assertEqual(response.status_code, 404)
        read.assert_not_called()

    def test_course_schedule_uses_exact_identity_and_curriculum_order(self):
        payload = [{'user_id': 7, 'course_id': 500, 'email': 'learner@example.org', 'materials': [
            {'component_id': 10, 'section_id': 5, 'section_order': 10, 'section_title': 'L10 25/8'},
            {'component_id': 11, 'section_id': 8, 'section_order': 9, 'section_title': 'L9 8/18/2026'},
            {'component_id': 12, 'section_id': 6, 'section_order': 11, 'section_title': 'L11 1/9/2026'},
        ], 'quizzes': [
            {'component_id': 20, 'section_id': 5, 'section_order': 10, 'section_title': 'L10 25/8'},
        ]}]
        sections = source._course_sections(payload, 500, 7, 'learner@example.org')
        self.assertEqual([s['order'] for s in sections], [9, 10, 11])
        dates = source._section_dates(sections)
        self.assertEqual(dates[10], dates[20])
        self.assertEqual(activity_schedule(dates[10]['schedule_title'])['date'], '2026-08-25')
        for group_id, learner_id, email in ((501, 7, 'learner@example.org'), (500, 8, 'learner@example.org'), (500, 7, 'other@example.org')):
            with self.assertRaises(ValueError):
                source._course_sections(payload, group_id, learner_id, email)

    def test_late_august_lecture_cannot_split_across_upload_weeks(self):
        group = deepcopy(course())
        group['activities'][0]['activity_date'] = '2026-08-26'
        group['activities'][1]['activity_date'] = '2026-08-12'
        sections = source._section_dates([
            {'title': 'L9 8/18/2026', 'ids': [9]}, {'title': 'L10 25/8', 'ids': [10, 20, 21]},
            {'title': 'L11 1/9/2026', 'ids': [30]},
        ])
        self.schedule.return_value = sections
        stored = {(500, 20): {'section_title': 'L10', 'exported_section_title': 'L10',
                             'section_source': 'builder_section_title', 'original_created_at': '2026-08-12'}}
        result = source.overlay_subjects(self.empty, {'groups': [group]}, stored)
        self.assertEqual(len(result['activities']), 2)
        self.assertTrue(all(a['week_start'] == '2026-08-24' for a in result['activities']))
        self.assertTrue(all(a['date'] == '2026-08-25' for a in result['activities']))
        self.assertTrue(all(a['completed'] for a in result['activities']))

    def test_schedule_request_uses_json_api_and_never_the_login_redirect(self):
        # Call the real function while the overlay helper's mock stays isolated.
        real_schedule = self._real_schedule
        payload = [{'user_id': 7, 'course_id': 500, 'email': 'learner@example.org',
                    'materials': [{'component_id': 10, 'section_id': 1, 'section_order': 1, 'section_title': 'L10 25/8/2026'}],
                    'quizzes': []}]
        with patch('learner_api.subject_source.urllib.request.build_opener') as opener:
            response = opener.return_value.open.return_value.__enter__.return_value
            response.headers = {}
            response.read.return_value = json.dumps(payload).encode()
            result = real_schedule(500, 7, 'learner@example.org')
        request = opener.return_value.open.call_args.args[0]
        self.assertIn('/wp-json/custom/v1/courses-progress?', request.full_url)
        self.assertIn('user_id=7&course_id=500', request.full_url)
        self.assertIn('include_answers=false', request.full_url)
        self.assertEqual(result[10]['section_title'], 'L10 25/8/2026')
