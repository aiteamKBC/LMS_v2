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
             patch.object(weekly_learning, 'build_learning_content_summary', side_effect=[global_detail, rich]) as read, \
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
             patch.object(training, 'selected_detail', side_effect=lambda *args, **kwargs: {'id': args[4]['id']}) as details:
            result = training.read_training(SimpleNamespace(pk=265, email=''), 'commercial', {}, None, request)
        self.assertEqual(len(result['timeline']['modules']), 2)
        self.assertEqual(result['selectedModule'], {'id': 'current:M2'})
        self.assertEqual(result['selectedModuleId'], 'current:M2')
        details.assert_called_once()
        self.assertIs(details.call_args.kwargs['metadata'], modules['M2'])
        self.assertNotIn('actual', result['timeline'])
        self.assertNotIn('months', result['timeline'])
        self.assertEqual(result['timeline']['monthKeys'], [])

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

    def test_module_endpoint_reuses_the_verified_canonical_profile(self):
        import os
        from . import identity, case_file_sources
        from login import permissions
        owner = {
            'id': 8, 'enrolment_id': 265, 'aptem_id': 987,
            'name': 'Synthetic Learner', 'email': 'learner@example.test',
            'lifecycle_status': 'active', 'learner_type': 'commercial',
            'programme': 'Programme', 'programme_id': 'P1',
            'programme_status': 'In learning', 'cohort': 'Cohort',
            'cohort_id': 'C1', 'group_name': 'Group', 'group_id': 'G1',
            'coach_name': 'Coach', 'coach_email': 'coach@example.test',
            'start_date': None, 'end_date': None,
        }
        source = SimpleNamespace(pk=265)
        factory = RequestFactory()
        with patch.dict(os.environ, {'LEARNER_API_REQUIRE_AUTH': '1'}), \
             patch.object(permissions, 'authenticate_request',
                          return_value=SimpleNamespace(role='learner', subject_id=265)), \
             patch.object(case_file_sources, 'source_for_case_file', return_value=source), \
             patch.object(identity, 'learner_profile_for_source') as legacy_profile, \
             patch.object(training.canonical, 'require_profile', return_value=owner), \
             patch.object(training, 'read_training', return_value={'id': 'current:M1'}) as read:
            response = training.training_module(
                factory.get('/learner_api/dashboard/commercial/265/training/modules/current:M1/'),
                kind='commercial', pk=265, module_id='current:M1')
        self.assertEqual(response.status_code, 200)
        legacy_profile.assert_not_called()
        profile = read.call_args.args[3]
        self.assertEqual((profile.pk, profile.enrolment_id, profile.lifecycle_status),
                         (8, 265, 'active'))

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

class TrainingMetadataReuseTests(SimpleTestCase):
    """Static curriculum snapshots with real orchestration/projection bodies."""

    def _fixture(self, size=1, subject='current:M0', *, missing=False,
                 suppressed=False, undated=False, module_id=None, failure=None):
        from contextlib import ExitStack
        from copy import deepcopy
        from datetime import date
        ids = [f'M{i}' for i in range(size)]
        source = SimpleNamespace(pk=265, email='synthetic@example.invalid')
        subjects = [{'id': f'current:{mid}', 'title': 'Duplicate title',
                     'activities': []} for mid in ids]
        if suppressed and subjects:
            subjects[0] = {'id': 'legacy:99', 'moduleId': ids[0],
                           'title': 'Duplicate title', 'activities': []}
        queries, attachments, metadata, facts, sessions = [], [], [], [], []
        cursor = MagicMock()
        def execute(sql, params):
            if failure == 'metadata':
                raise RuntimeError('metadata failure')
            queries.append((sql, deepcopy(params)))
        cursor.execute.side_effect = execute
        def rows(cur):
            sql, params = queries[-1]
            if 'FROM curriculum.modules m' in sql:
                rich, asked = params
                return [{'id': mid, 'title': 'Duplicate title',
                         'description': '<p>Selected &amp; rich</p>' if mid == rich else '',
                         'start_date': None if undated else date(2026, 3, 28),
                         'end_date': None if undated else date(2026, 10, 26),
                         'total_otjh': 0, 'cohort_id': 'C',
                         'session_week_day': None} for mid in asked
                        if not (missing and mid == 'M0')]
            if 'SELECT module_catalogue_id AS id,title' in sql:
                return [{'id': mid, 'title': 'Duplicate title'} for mid in params[0]]
            asked, rich, _ = params
            return [{'id': 'W:' + mid, 'module_catalogue_id': mid, 'week_number': 1,
                     'title': 'Teaching', 'learning_outcomes': ['<b>Outcome</b>'] if mid == rich else [],
                     'holiday_note_enabled': True, 'holiday_note': '<p>Published</p>',
                     'live_session_count': 0} for mid in asked]
        real_module_rows = training.module_rows
        def read_rows(cur, asked, **kwargs):
            result = real_module_rows(cur, asked, **kwargs)
            metadata.append((list(asked), dict(kwargs), result))
            return result
        def attach(found, modules, counts, weeks, strict):
            attachments.append(([r['id'] for r in found], strict))
            if failure == 'scheduler':
                raise RuntimeError('scheduler failure')
            for mid, detail in modules.items():
                detail['curriculumSlots'] = [
                    {'slotNumber': 1, 'type': 'live-session', 'date': None if undated else '2026-03-28',
                     'learningOutcomes': weeks[(mid, 1)]['learningOutcomes']},
                    {'slotNumber': 2, 'type': 'reading-week', 'date': None if undated else '2026-04-04',
                     'holidayNote': weeks[(mid, 1)]['holidayNote'], 'holidays': [{'name': 'Holiday'}]}]
                detail['effectiveEndDate'] = None if undated else '2026-10-26'
        def learning(*args, **kwargs):
            facts.append((deepcopy(args[4]), dict(kwargs)))
            if failure == 'facts' and kwargs.get('selected'):
                raise RuntimeError('facts failure')
            return deepcopy(subjects), {}
        def plan_sessions(cur, email, asked):
            sessions.append(list(asked))
            if failure == 'sessions':
                raise RuntimeError('sessions failure')
            return [] if undated else [{'id': 'S', 'start': '2026-03-28T23:30:00Z', 'title': 'Session'}]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        detail_calls = []
        real_detail = training.selected_detail
        def detail(*args, **kwargs):
            detail_calls.append((args[4], kwargs))
            return real_detail(*args, **kwargs)
        with ExitStack() as stack:
            for obj, name, value in [
                (training, 'connections', {'enrolment': connection}),
                (training.canonical, 'entries_for', MagicMock(return_value=[])),
                (training.canonical, 'targets_for', MagicMock(return_value={'2026-04': 0})),
                (training.schedule, 'plan_module_ids', MagicMock(return_value=(ids, {}))),
                (training.schedule, 'rows', rows),
                (training.schedule, 'attach_curriculum_slots', attach),
                (training.schedule, 'is_educational_live_session_week', lambda title: title == 'Teaching'),
                (training.schedule, '_plan_session_rows', MagicMock(return_value=[])),
                (training, 'learning_facts', learning),
                (training, 'module_rows', read_rows),
                (training, 'selected_detail', detail),
                (training.schedule, 'plan_sessions', plan_sessions),
                (training.schedule, '_canonical_module_progress', MagicMock(return_value={})),
                (training.schedule, '_canonical_actual_rows', MagicMock(return_value=[])),
                (training.schedule, 'plan_reviews', MagicMock(return_value=[])),
                (training.schedule, 'current_coach', MagicMock(return_value={'coach_name': 'Coach', 'coach_email': ''})),
            ]:
                stack.enter_context(patch.object(obj, name, value))
            # A request-shaped input only; these tests do not exercise HTTP.
            params = {'month': '2026-04', 'programmeStartDate': '2026-01-01',
                      'programmeEndDate': '2026-12-31'}
            if subject is not None:
                params['subject'] = subject
            payload = training.read_training(source, 'commercial', {}, None,
                                             SimpleNamespace(GET=params), module_id)
        return payload, SimpleNamespace(queries=queries, attachments=attachments,
            metadata=metadata, facts=facts, sessions=sessions, details=detail_calls)

    def test_explicit_current_reuses_exact_first_read_metadata_at_all_sizes(self):
        for size in (1, 10, 100):
            with self.subTest(size=size):
                payload, trace = self._fixture(size)
                self.assertEqual(len(trace.queries), 2)
                self.assertEqual(len(trace.attachments), 1)
                self.assertEqual(trace.metadata[0][1], {'rich_id': 'M0'})
                reused = trace.details[0][1]['metadata']
                self.assertIs(reused, trace.metadata[0][2]['M0'])
                self.assertIs(payload['selectedModule']['detail'], reused)
                self.assertEqual(reused['description'], 'Selected & rich')
                self.assertEqual(reused['learning_outcomes'], ['Outcome'])
                for mid, item in trace.metadata[0][2].items():
                    if mid != 'M0':
                        self.assertEqual(item['description'], '')
                        self.assertEqual(item['learning_outcomes'], [])
                self.assertEqual(trace.sessions, [['M0']])
                self.assertEqual(trace.facts, [
                    ([f'M{i}' for i in range(size)], {}),
                    (['M0'], {'selected': True, 'subject_id': 'current:M0'})])
                self.assertEqual(payload['timeline']['modules'][0]['detail']['curriculumSlots'][1]['holidayNote'], 'Published')
                self.assertNotIn('description', payload['timeline']['modules'][0]['detail'])

    def test_ineligible_subjects_keep_original_two_metadata_reads(self):
        for subject in (None, '', 'legacy:99', 'current:', 'current:OTHER',
                        'current: M0', 'CURRENT:M0', 'unknown'):
            with self.subTest(subject=subject):
                payload, trace = self._fixture(10, subject)
                self.assertEqual(payload['selectedModuleId'], 'current:M0')
                self.assertEqual(len(trace.queries), 4)
                self.assertEqual(len(trace.attachments), 2)
                self.assertEqual(trace.metadata[0][1], {})
                self.assertEqual(trace.details[0][1], {})
                self.assertEqual(trace.metadata[1][0], ['M0'])

    def test_suppressed_current_never_lends_metadata_to_legacy_selection(self):
        payload, trace = self._fixture(10, suppressed=True)
        self.assertEqual(payload['selectedModuleId'], 'legacy:99')
        self.assertEqual(trace.details[0][1], {})
        self.assertEqual(len(trace.queries), 4)
        self.assertEqual(len(trace.attachments), 2)

    def test_matching_subject_with_different_final_module_does_not_reuse(self):
        real_display = training.display_modules
        def display(*args):
            result = real_display(*args)
            result[0]['moduleId'] = 'M1'
            return result
        with patch.object(training, 'display_modules', side_effect=display):
            payload, trace = self._fixture(10)
        self.assertEqual(payload['selectedModule']['moduleId'], 'M1')
        self.assertEqual(trace.details[0][1], {})
        self.assertEqual(len(trace.queries), 4)

    def test_missing_metadata_keeps_selected_fallback(self):
        payload, trace = self._fixture(10, missing=True)
        self.assertEqual(payload['selectedModuleId'], 'current:M0')
        self.assertEqual(payload['selectedModule']['detail'], {})
        self.assertEqual(trace.details[0][1], {})
        self.assertEqual(len(trace.queries), 4)
        self.assertEqual(len(trace.attachments), 2)

    def test_no_selection_keeps_empty_response_and_initial_dispatches(self):
        for size in (0, 1, 10, 100):
            with self.subTest(size=size):
                payload, trace = self._fixture(size, subject='unknown', undated=True)
                self.assertIsNone(payload['selectedModule'])
                self.assertIsNone(payload['selectedModuleId'])
                self.assertEqual(len(trace.queries), 2)
                self.assertEqual(len(trace.attachments), 1)
                self.assertEqual(trace.details, [])

    def test_standalone_detail_keeps_singleton_metadata_path(self):
        payload, trace = self._fixture(10, module_id='current:M0')
        self.assertEqual(payload['id'], 'current:M0')
        # Includes the existing whole-title ambiguity query.
        self.assertEqual(len(trace.queries), 3)
        self.assertEqual(len(trace.attachments), 1)
        self.assertEqual(trace.metadata[0][0], ['M0'])
        self.assertEqual(trace.metadata[0][1], {'rich_id': 'M0'})

    def test_remaining_failures_propagate_without_fabricated_success(self):
        for failure in ('metadata', 'scheduler', 'facts', 'sessions'):
            with self.subTest(failure=failure):
                with self.assertRaisesRegex(RuntimeError, failure + ' failure'):
                    self._fixture(10, failure=failure)

    def test_undated_selected_metadata_preserves_nulls_and_zero(self):
        payload, trace = self._fixture(1, undated=True)
        selected = payload['selectedModule']
        self.assertIsNone(selected['detail']['start_date'])
        self.assertIsNone(selected['detail']['effectiveEndDate'])
        self.assertEqual(selected['detail']['total_otjh'], 0)
        self.assertEqual(selected['start'], '')
        self.assertEqual(selected['sessions'], [])
        self.assertIsNone(selected['actual'])
        self.assertEqual(len(trace.queries), 2)

    def test_complete_response_matches_frozen_before_image_with_module_growth(self):
        import json
        from copy import deepcopy
        # Captured from the unchanged reader before R02 edits; full wire payload.
        before = json.loads('''{
  "timeline": {
    "start": "2026-01",
    "end": "2026-12",
    "programmeStartDate": "2026-01-01",
    "monthKeys": [
      "2026-04"
    ],
    "modules": [
      {
        "id": "current:M0",
        "title": "Duplicate title",
        "moduleId": "M0",
        "start": "2026-03-28",
        "end": "2026-10-26",
        "done": 0,
        "activityCount": 0,
        "progress": 0,
        "weekAnchor": "2026-03-28",
        "detail": {
          "effectiveEndDate": "2026-10-26",
          "session_week_day": "",
          "curriculumSlots": [
            {
              "slotNumber": 1,
              "type": "live-session",
              "date": "2026-03-28"
            },
            {
              "slotNumber": 2,
              "type": "reading-week",
              "date": "2026-04-04",
              "holidays": [
                {
                  "name": "Holiday"
                }
              ],
              "holidayNote": "Published"
            }
          ]
        }
      }
    ],
    "reviews": [],
    "coachName": "Coach"
  },
  "selectedModuleId": "current:M0",
  "selectedModule": {
    "id": "current:M0",
    "title": "Duplicate title",
    "moduleId": "M0",
    "start": "2026-03-28",
    "end": "2026-10-26",
    "weekAnchor": "2026-03-28",
    "detail": {
      "id": "M0",
      "title": "Duplicate title",
      "description": "Selected & rich",
      "tutor_name": "",
      "coach_name": "",
      "programme_name": "",
      "cohort_name": "",
      "group_name": "",
      "session_week_day": "",
      "session_start_time": "",
      "session_end_time": "",
      "start_date": "2026-03-28",
      "end_date": "2026-10-26",
      "total_otjh": 0,
      "weeks_number": null,
      "sessions_number": null,
      "educational_session_count": 0,
      "learning_outcomes": [
        "Outcome"
      ],
      "curriculumSlots": [
        {
          "slotNumber": 1,
          "type": "live-session",
          "date": "2026-03-28",
          "learningOutcomes": [
            "Outcome"
          ]
        },
        {
          "slotNumber": 2,
          "type": "reading-week",
          "date": "2026-04-04",
          "holidayNote": "Published",
          "holidays": [
            {
              "name": "Holiday"
            }
          ]
        }
      ],
      "effectiveEndDate": "2026-10-26"
    },
    "done": 0,
    "activityCount": 0,
    "progress": 0,
    "activityCounts": {},
    "ksbCodes": [],
    "achievedKsbCodes": null,
    "ksbMappingMissing": false,
    "weeks": 1,
    "actual": null,
    "sessions": [
      {
        "id": "S",
        "start": "2026-03-28T23:30:00Z",
        "title": "Session"
      }
    ],
    "activities": []
  }
}''')
        for size in (0, 1, 10, 100):
            with self.subTest(size=size):
                payload, _ = self._fixture(size)
                expected = deepcopy(before)
                expected['timeline']['modules'] = []
                for i in range(size):
                    module = deepcopy(before['timeline']['modules'][0])
                    module['id'], module['moduleId'] = f'current:M{i}', f'M{i}'
                    expected['timeline']['modules'].append(module)
                if not size:
                    expected['selectedModule'] = expected['selectedModuleId'] = None
                self.assertEqual(payload, expected)

    def test_nonfirst_current_subject_enriches_only_requested_module(self):
        payload, trace = self._fixture(10, subject='current:M2')
        self.assertEqual(payload['selectedModuleId'], 'current:M2')
        self.assertEqual(trace.metadata[0][1], {'rich_id': 'M2'})
        self.assertIs(trace.details[0][1]['metadata'], trace.metadata[0][2]['M2'])
        self.assertEqual(trace.metadata[0][2]['M0']['description'], '')
        self.assertEqual(trace.metadata[0][2]['M0']['learning_outcomes'], [])
        self.assertEqual(len(trace.queries), 2)


class TrainingAutomaticMetadataReuseTests(SimpleTestCase):
    """Only genuinely absent-subject, sole-ID initial reads can opt in."""

    _fixture = TrainingMetadataReuseTests._fixture

    def _automatic_fixture(self, size=1, subject=None, *, params=None,
                           source_linked=False, final_module_id=None,
                           dated_selection=False, **kwargs):
        real_read = training.read_training
        real_display = training.display_modules
        def read(source, kind, owner, profile, request, module_id=None):
            if params:
                request.GET.update(params)
            if source_linked:
                # Resolved scheduling IDs can come from source links with no
                # native assignment. The canonical resolver remains mocked.
                source.training_plan = []
                source.learning_plan = []
            payload = real_read(source, kind, owner, profile, request, module_id)
            if source_linked:
                self.assertEqual(source.training_plan, [])
                self.assertEqual(source.learning_plan, [])
            return payload
        def display(*args):
            displayed = real_display(*args)
            if dated_selection and displayed:
                # Model an ordinary date-derived selection when the Builder
                # metadata row is missing; selection remains the reader's job.
                displayed[0].update(start='2026-04-01', end='2026-04-30',
                                    dates=['2026-04-01'])
            if final_module_id is not None and displayed:
                displayed[0]['moduleId'] = final_module_id
            return displayed
        with patch.object(training, 'read_training', side_effect=read), \
             patch.object(training, 'display_modules', side_effect=display):
            return self._fixture(size, subject, **kwargs)

    def test_absent_subject_reuses_only_exact_automatic_current_selection(self):
        payload, trace = self._automatic_fixture()
        self.assertEqual(payload['selectedModuleId'], 'current:M0')
        self.assertEqual(payload['selectedModule']['moduleId'], 'M0')
        self.assertEqual(trace.metadata[0][0], ['M0'])
        self.assertEqual(trace.metadata[0][1], {'rich_id': 'M0'})
        metadata = trace.metadata[0][2]['M0']
        self.assertIs(trace.details[0][1]['metadata'], metadata)
        self.assertIs(payload['selectedModule']['detail'], metadata)
        self.assertEqual(metadata['description'], 'Selected & rich')
        self.assertEqual(metadata['learning_outcomes'], ['Outcome'])
        self.assertIsNone(metadata['weeks_number'])
        self.assertEqual(metadata['total_otjh'], 0)
        self.assertEqual(len(trace.queries), 2)
        self.assertEqual(len(trace.attachments), 1)
        self.assertEqual(trace.sessions, [['M0']])
        self.assertEqual(trace.facts, [
            (['M0'], {}), (['M0'], {'selected': True, 'subject_id': 'current:M0'})])

    def test_complete_automatic_response_matches_existing_explicit_snapshot(self):
        automatic, _ = self._automatic_fixture()
        explicit, _ = self._fixture()
        self.assertEqual(automatic, explicit)
        self.assertEqual(automatic['selectedModule']['weeks'], 1)
        self.assertEqual(automatic['selectedModule']['sessions'][0]['start'],
                         '2026-03-28T23:30:00Z')
        self.assertEqual(automatic['selectedModule']['detail']['curriculumSlots'][1]['holidayNote'],
                         'Published')

    def test_explicit_subject_values_never_enter_automatic_batch(self):
        for value in ('', 'legacy:99', 'current:', 'current:OTHER',
                      'current: M0', 'CURRENT:M0', 'unknown', None):
            with self.subTest(value=value):
                payload, trace = self._automatic_fixture(params={'subject': value})
                self.assertEqual(payload['selectedModuleId'], 'current:M0')
                self.assertEqual(trace.metadata[0][1], {})
                self.assertEqual(trace.details[0][1], {})
                self.assertEqual(len(trace.queries), 4)
                self.assertEqual(len(trace.attachments), 2)

    def test_absent_subject_does_not_enrich_zero_or_multiple_resolved_ids(self):
        for size in (0, 2, 10, 100):
            with self.subTest(size=size):
                payload, trace = self._automatic_fixture(size)
                self.assertEqual(trace.metadata[0][1], {})
                self.assertEqual(len(trace.queries), 4 if size else 2)
                self.assertEqual(len(trace.attachments), 2 if size else 1)
                if size:
                    self.assertEqual(trace.details[0][1], {})
                else:
                    self.assertIsNone(payload['selectedModule'])

    def test_sole_plan_id_does_not_override_month_or_no_selection(self):
        for params, undated in [({'month': '2027-01'}, False),
                                ({'month': '2026-01'}, False), ({}, True)]:
            with self.subTest(params=params, undated=undated):
                payload, trace = self._automatic_fixture(params=params, undated=undated)
                self.assertIsNone(payload['selectedModule'])
                self.assertIsNone(payload['selectedModuleId'])
                self.assertEqual(trace.details, [])
                self.assertEqual(trace.sessions, [])
                self.assertEqual(len(trace.queries), 2)

    def test_programme_bounds_preserve_payload_and_ordinary_selection(self):
        payload, trace = self._automatic_fixture(params={
            'programmeStartDate': '2026-02-01', 'programmeEndDate': '2026-11-30'})
        self.assertEqual(payload['timeline']['programmeStartDate'], '2026-02-01')
        self.assertEqual(payload['timeline']['start'], '2026-02')
        self.assertEqual(payload['timeline']['end'], '2026-11')
        self.assertEqual(payload['selectedModule']['start'], '2026-03-28')
        self.assertEqual(payload['selectedModule']['end'], '2026-10-26')
        self.assertEqual(len(trace.queries), 2)

    def test_source_linked_sole_id_does_not_require_native_assignment(self):
        payload, trace = self._automatic_fixture(source_linked=True)
        self.assertEqual(payload['selectedModuleId'], 'current:M0')
        self.assertEqual(len(trace.queries), 2)
        self.assertIs(payload['selectedModule']['detail'], trace.metadata[0][2]['M0'])

    def test_imported_suppression_keeps_legacy_metadata_fallback(self):
        payload, trace = self._automatic_fixture(suppressed=True)
        self.assertEqual(payload['selectedModuleId'], 'legacy:99')
        self.assertEqual(trace.details[0][1], {})
        self.assertEqual(len(trace.queries), 4)
        self.assertEqual(len(trace.attachments), 2)
        self.assertEqual(trace.facts[-1][1]['subject_id'], 'legacy:99')

    def test_missing_metadata_keeps_original_fallback(self):
        payload, trace = self._automatic_fixture(missing=True, dated_selection=True)
        self.assertEqual(payload['selectedModuleId'], 'current:M0')
        self.assertEqual(payload['selectedModule']['detail'], {})
        self.assertEqual(trace.details[0][1], {})
        self.assertEqual(len(trace.queries), 4)
        self.assertEqual(len(trace.attachments), 2)

    def test_missing_metadata_without_dates_does_not_infer_selection(self):
        payload, trace = self._automatic_fixture(missing=True)
        self.assertIsNone(payload['selectedModuleId'])
        self.assertIsNone(payload['selectedModule'])
        self.assertEqual(trace.details, [])
        self.assertEqual(len(trace.queries), 2)

    def test_final_module_mismatch_cannot_reuse_sole_module_metadata(self):
        payload, trace = self._automatic_fixture(final_module_id='OTHER')
        self.assertEqual(payload['selectedModuleId'], 'current:M0')
        self.assertEqual(payload['selectedModule']['moduleId'], 'OTHER')
        self.assertEqual(trace.details[0][1], {})
        self.assertEqual(trace.metadata[-1][0], ['OTHER'])
        self.assertEqual(len(trace.queries), 4)

    def test_automatic_request_preserves_failures_and_date_validation(self):
        for failure in ('metadata', 'scheduler', 'facts', 'sessions'):
            with self.subTest(failure=failure):
                with self.assertRaisesRegex(RuntimeError, failure + ' failure'):
                    self._automatic_fixture(failure=failure)
        for params in ({'month': '2026-13'}, {'programmeStartDate': '2026-02-30'},
                       {'programmeEndDate': 'bad'}):
            with self.subTest(params=params):
                with self.assertRaises(ServiceError) as caught:
                    self._automatic_fixture(params=params)
                self.assertEqual(caught.exception.status, 400)

    def test_standalone_detail_path_is_unchanged_for_absent_subject(self):
        payload, trace = self._automatic_fixture(module_id='current:M0')
        self.assertEqual(payload['id'], 'current:M0')
        self.assertEqual(trace.metadata[0][0], ['M0'])
        self.assertEqual(trace.metadata[0][1], {'rich_id': 'M0'})
        self.assertEqual(len(trace.queries), 3)
        self.assertEqual(len(trace.attachments), 1)
