"""Training contract tests: mocks only; no database or external services."""
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

from django.test import SimpleTestCase, RequestFactory
from django.db import DatabaseError
from old_otjh.service import ServiceError
from . import dashboard_training as training


class TrainingProjectionTests(SimpleTestCase):
    def test_week_session_counts_are_grouped_once_without_changing_scope(self):
        cursor = MagicMock()
        cursor.description = []
        with patch.object(training.schedule, 'rows', return_value=[]), \
             patch.object(training.schedule, 'attach_curriculum_slots'):
            training.module_rows(cursor, ['M1', 'M2'], rich_id='M2')
        sql, params = cursor.execute.call_args_list[1].args
        self.assertIn('GROUP BY c.module_catalogue_id,c.week_id', sql)
        self.assertIn('coalesce(live_counts.live_session_count,0)', sql)
        self.assertIn("c.deleted_at IS NULL OR COALESCE(c.deleted_via_parent,'')<>''", sql)
        self.assertEqual(params, [['M1', 'M2'], 'M2', ['M1', 'M2']])

    def test_selected_native_facts_use_global_retained_quiz_decision(self):
        from . import weekly_learning, student_activity_access, student_activity, builder_activity_dates
        global_detail = {'modules': ['One', 'Two'], 'components': [
            {'moduleId': 'M1', 'module': 'One', 'componentId': 'C1', 'component': 'One quiz', 'isQuiz': True, 'quizMeta': {'quizId': 10}},
            {'moduleId': 'M2', 'module': 'Two', 'componentId': 'C2', 'component': 'Two quiz', 'isQuiz': True, 'quizMeta': {'quizId': 20}}],
            'quizAttempts': [{'quizId': 99, 'passed': True}], 'videoProgress': [], 'componentProgress': [], 'retiredQuizComponents': []}
        rich = {'modules': ['Two'], 'components': [{**global_detail['components'][1], 'type': 'quiz', 'ksbMappings': []}],
                'retiredQuizComponents': [{'moduleId': 'M2', 'componentId': 'PHANTOM', 'component': 'Ambiguous credit'}],
                'quizAttempts': global_detail['quizAttempts'], 'videoProgress': [], 'componentProgress': []}
        source = SimpleNamespace(pk=265, aptem_id=None, _training_module_ids=['M1', 'M2'])
        connection = MagicMock()
        builder = {f'current:{mid}': {'id': mid, 'title': title} for mid, title in (('M1', 'One'), ('M2', 'Two'))}
        with patch.object(training, 'connections', {'enrolment': connection}), \
             patch.object(weekly_learning, 'build_weekly_learning', side_effect=[global_detail, rich]) as read, \
             patch.object(student_activity_access, 'student_activity_available', return_value=False), \
             patch.object(student_activity, '_builder_subject_metadata', return_value=({}, builder)), \
             patch.object(builder_activity_dates, 'read_builder_activity_dates', return_value={}):
            subjects, native = training.learning_facts(source, {}, None, [], ['M2'], selected=True, subject_id='current:M2')
        self.assertEqual(read.call_args_list[0].kwargs['assigned_modules'], [{'moduleId': 'M1'}, {'moduleId': 'M2'}])
        self.assertIn('progress', read.call_args_list[1].kwargs)
        self.assertEqual(native['retiredQuizComponents'], [])
        selected = next(s for s in subjects if s['id'] == 'current:M2')
        self.assertEqual([a['id'] for a in selected['activities']], ['C2'])

    def test_initial_request_loads_only_explicit_selected_module(self):
        request = RequestFactory().get('/', {'subject': 'current:M2'})
        connection = MagicMock()
        modules = {mid: {'id': mid, 'title': mid, 'start_date': '2026-01-01', 'end_date': '2026-12-31'} for mid in ('M1', 'M2')}
        subjects = [{'id': f'current:{mid}', 'title': mid, 'activities': []} for mid in modules]
        with patch.object(training, 'connections', {'enrolment': connection}), \
             patch.object(training.canonical, 'entries_for', return_value=[]), \
             patch.object(training.canonical, 'targets_for', return_value={}), \
             patch.object(training.schedule, 'plan_module_ids', return_value=(list(modules), {})), \
             patch.object(training, 'module_rows', return_value=modules), \
             patch.object(training.schedule, '_plan_session_rows', return_value=[]), \
             patch.object(training, 'learning_facts', return_value=(subjects, {})), \
             patch.object(training.schedule, 'plan_reviews', return_value=[]), \
             patch.object(training.schedule, 'current_coach', return_value={'coach_name': 'Coach', 'coach_email': ''}), \
             patch.object(training, 'selected_detail', side_effect=lambda *args: {'id': args[4]['id']}) as details:
            result = training.read_training(SimpleNamespace(pk=265, email=''), 'commercial', {}, None, request)
        self.assertEqual(len(result['timeline']['modules']), 2)
        self.assertEqual(result['selectedModule'], {'id': 'current:M2'})
        self.assertEqual(result['selectedModuleId'], 'current:M2')
        details.assert_called_once()
        self.assertNotIn('actual', result['timeline'])

    def test_module_request_bypasses_programme_timeline_readers(self):
        connection = MagicMock()
        request = RequestFactory().get('/module/')
        with patch.object(training, 'connections', {'enrolment': connection}), \
             patch.object(training.canonical, 'entries_for', return_value=[]) as records, \
             patch.object(training.schedule, 'plan_module_ids', return_value=(['M1', 'M2'], {})), \
             patch.object(training, 'read_selected', return_value={'id': 'current:M2'}) as selected, \
             patch.object(training, 'module_rows', side_effect=AssertionError('all metadata')), \
             patch.object(training, 'learning_facts', side_effect=AssertionError('all activity facts')), \
             patch.object(training.schedule, 'plan_reviews', side_effect=AssertionError('all reviews')):
            result = training.read_training(SimpleNamespace(pk=265), 'commercial', {'id': 8}, None, request, 'current:M2')
        self.assertEqual(result, {'id': 'current:M2'})
        records.assert_called_once_with({'id': 8}, training_summary=True)
        selected.assert_called_once()

    def test_explicit_programme_bounds_require_valid_iso_dates(self):
        factory = RequestFactory()
        self.assertEqual(training.requested_date(factory.get('/', {'programmeStartDate': '2026-10-09'}), 'programmeStartDate'), '2026-10-09')
        with self.assertRaises(ServiceError) as caught:
            training.requested_date(factory.get('/', {'programmeStartDate': '2026-02-30'}), 'programmeStartDate')
        self.assertEqual(caught.exception.status, 400)

    def test_unknown_module_rejected_before_unrelated_detail_reads(self):
        for subject_id in ('current:OTHER', 'legacy:999', 'unknown'):
            cursor = MagicMock()
            cursor.fetchall.return_value = []
            with self.subTest(subject_id=subject_id), \
                 patch.object(training, 'learning_facts') as learning, \
                 patch.object(training, 'module_rows') as details:
                with self.assertRaises(ServiceError) as caught:
                    training.read_selected(SimpleNamespace(email=''), {'id': 8}, None, [], ['M1'], {}, subject_id, cursor)
                self.assertEqual(caught.exception.status, 404)
                learning.assert_not_called()
                details.assert_not_called()

    def test_selected_endpoint_identity_and_error_contract_for_both_learner_types(self):
        import os
        from . import identity, case_file_sources
        from login import permissions
        factory = RequestFactory()
        source = SimpleNamespace(pk=265)
        owner = {'id': 8}
        profile = SimpleNamespace(pk=8, enrolment_id=265)
        for kind in ('commercial', 'apprenticeship'):
            for role, subject_id, expected in (('learner', 265, 200), ('learner', 266, 404),
                                               ('staff', 3, 200), ('employer', 3, 403)):
                with self.subTest(kind=kind, role=role, subject_id=subject_id), \
                     patch.dict(os.environ, {'LEARNER_API_REQUIRE_AUTH': '1'}), \
                     patch.object(permissions, 'authenticate_request', return_value=SimpleNamespace(role=role, subject_id=subject_id)), \
                     patch.object(case_file_sources, 'source_for_case_file', return_value=source), \
                     patch.object(identity, 'learner_profile_for_source', return_value=profile), \
                     patch.object(training.canonical, 'require_profile', return_value=owner), \
                     patch.object(training, 'read_training', return_value={'id': 'current:M1'}) as read:
                    request = factory.get(f'/learner_api/dashboard/{kind}/265/training/modules/current:M1/')
                    response = training.training_module(request, kind=kind, pk=265, module_id='current:M1')
                    self.assertEqual(response.status_code, expected)
                    self.assertEqual(read.call_count, int(expected == 200))
            with self.subTest(kind=kind, state='database-error'), \
                 patch.dict(os.environ, {'LEARNER_API_REQUIRE_AUTH': '1'}), \
                 patch.object(permissions, 'authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=265)), \
                 patch.object(case_file_sources, 'source_for_case_file', return_value=source), \
                 patch.object(identity, 'learner_profile_for_source', return_value=profile), \
                 patch.object(training.canonical, 'require_profile', return_value=owner), \
                 patch.object(training, 'read_training', side_effect=DatabaseError('offline')):
                response = training.training_module(factory.get('/module/'), kind=kind, pk=265, module_id='current:M1')
                self.assertEqual(response.status_code, 503)
                self.assertIn(b'Could not load your module', response.content)
        response = training.training_module(factory.post('/module/'), kind='commercial', pk=265, module_id='current:M1')
        self.assertEqual(response.status_code, 405)

    def test_timeline_keeps_undated_modules_and_does_not_publish_detail(self):
        subject = {'id': 'current:M1', 'title': 'Undated', 'activities': []}
        rows = training.display_modules([subject], {'M1': {'id': 'M1', 'description': 'private detail',
            'curriculumSlots': []}}, {}, {})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['start'], '')
        wire = training.timeline_module(rows[0])
        self.assertEqual(wire['id'], 'current:M1')
        self.assertNotIn('description', wire['detail'])
        self.assertNotIn('_subject', wire)

    def test_session_bounds_use_business_date(self):
        subject = {'id': 'current:M1', 'title': 'Dates', 'activities': []}
        bounds = {'M1': {'first_start': datetime(2026, 7, 1, 23, 30), 'last_start': datetime(2026, 7, 2, 23, 30)}}
        row = training.display_modules([subject], {}, {}, bounds)[0]
        self.assertEqual((row['start'], row['end']), ('2026-07-02', '2026-07-03'))

    def test_timeline_retains_anchor_and_only_published_holiday_notes(self):
        slots = [{'slotNumber': 1, 'type': 'live-session', 'date': '2026-01-01'},
                 {'slotNumber': 2, 'type': 'live-session', 'date': '2026-01-08', 'learningOutcomes': ['large']},
                 {'slotNumber': 3, 'type': 'live-session', 'date': '2026-01-15', 'holidayNote': 'Published', 'holidays': [{'name': 'Holiday'}]}]
        row = {'id': 'current:M1', 'title': 'M', 'moduleId': 'M1', 'start': '', 'end': '', 'done': 0,
               'activityCount': 0, 'progress': 0, 'detail': {'curriculumSlots': slots}}
        wire = training.timeline_module(row)
        self.assertEqual([s['slotNumber'] for s in wire['detail']['curriculumSlots']], [1, 3])
        self.assertNotIn('learningOutcomes', str(wire))

    def test_completion_rounding_matches_browser(self):
        self.assertEqual(training.percentage(2, 3), 66.67)
        self.assertEqual(training.percentage(0, 0), 0)

    def test_selected_detail_keeps_legacy_catalogue_counts_and_preview_limit(self):
        activities = [{'id': str(i), 'title': f'A{i}', 'category': 'quiz', 'completed': i < 3,
                       'date': '2026-01-01', 'ksbs': [], '_native': False} for i in range(9)]
        subject = {'id': 'legacy:99', 'title': 'Imported', 'activities': activities}
        selected = {'id': 'legacy:99', 'title': 'Imported', 'moduleId': 'M1', 'start': '2026-01-01',
                    'end': '2026-01-30', 'dates': ['2026-01-01'], '_subject': subject}
        cursor = MagicMock()
        with patch.object(training, 'learning_facts', return_value=([subject], {})), \
             patch.object(training, 'connections', {'enrolment': cursor}), \
             patch.object(training, 'module_rows', return_value={'M1': {'id': 'M1'}}), \
             patch.object(training.schedule, 'plan_sessions', return_value=[]), \
             patch.object(training.schedule, '_canonical_module_progress', return_value={'M1': {
                 'ksb': {'achievedCodes': []}, 'hours': {'actual': 2.5}}}):
            result = training.selected_detail(SimpleNamespace(email='synthetic@example.invalid'), {}, None, [], selected, {}, {})
        self.assertEqual((result['done'], result['activityCount'], result['progress']), (3, 9, 33.33))
        self.assertEqual(result['activityCounts'], {'quiz': 9})
        self.assertEqual(len(result['activities']), 5)
        self.assertEqual(result['actual'], 2.5)
        self.assertTrue(result['ksbMappingMissing'])

    def test_training_tab_short_circuits_all_legacy_projections(self):
        from . import dashboard_tabs, identity
        owner = {'id': 8}
        profile = SimpleNamespace(pk=8, enrolment_id=265)
        source = SimpleNamespace(pk=265)
        with patch.object(dashboard_tabs.canonical, 'require_profile', return_value=owner), \
             patch.object(identity, 'learner_profile_for_source', return_value=profile), \
             patch.object(training, 'read_training', return_value={'timeline': {}}) as compact, \
             patch.object(dashboard_tabs.canonical, 'entries_for', side_effect=AssertionError('legacy path')), \
             patch.object(dashboard_tabs, 'learning_projection', side_effect=AssertionError('legacy learning')):
            self.assertEqual(dashboard_tabs.read_tab(source, 'commercial', 'training', object()), {'timeline': {}})
        compact.assert_called_once()
