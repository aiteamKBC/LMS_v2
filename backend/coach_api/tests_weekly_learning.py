"""Weekly projection contracts: mocked DB cursors, no database or Graph calls."""
from datetime import date, datetime, timedelta, timezone
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory
from .weekly_learning import read_weekly_learning, week_rows, activity_completion, progress_index, assignment_projection, derived_session, visible_week_rows
from .case_file import case_file_section


def synthetic_size_report():
    """Same 52-week / 8-activity programme, synthetic content; no live reads."""
    from .case_file import build_tab
    compact, _, _ = WeeklyLearningTests().projection()
    slots = [{'slotNumber': i + 1, 'sessionNumber': i + 1, 'date': (date(2026, 10, 5) + timedelta(weeks=i)).isoformat(),
              'type': 'live-session', 'weekId': f'W{i+1}', 'weekTitle': f'Week {i+1}'} for i in range(52)]
    compact['weeks'] = week_rows([{'id': 'M1', 'title': 'Synthetic module', 'curriculumSlots': slots}], '2026-10-07')
    compact['weeks'][0].update(completedActivities=8, totalActivities=8, progress=100)
    prototype = compact['selectedWeek']['activities'][0]
    compact['selectedWeek']['activities'] = [{**prototype, 'id': f'C1-{i}', 'title': f'Reading {i}'} for i in range(8)]
    compact['selectedWeek']['summary'].update(completedActivities=8, totalActivities=8, progress=100, otjhHours=8, plannedOtjhHours=8)
    content = 'Synthetic lesson content. ' * 80
    components = [{'componentId': f'C{week}-{i}', 'moduleId': 'M1', 'weekId': f'W{week}', 'component': f'Reading {i}', 'type': 'reading',
                   'description': content[:120], 'assignmentTopics': [], 'assignmentBrief': None,
                   'assignmentBriefHtml': None, 'contentHtml': None, 'hasReadingContent': True,
                   'reflectionPrompt': content[:200], 'reflectionQuestion': content[:120],
                   **{field: 'https://example.test/synthetic' for field in ('videoUrl', 'audioUrl', 'resourceUrl', 'liveSessionUrl')},
                   'fileName': 'synthetic.pdf', 'reflectionRequired': True, 'tutorValidationRequired': True,
                   'teamsLiveSessionId': 'synthetic', 'teamsSessionNumber': week, 'sessionDate': slots[week-1]['date'],
                   'sessionTime': '09:00', 'sessionDateTimeUtc': f"{slots[week-1]['date']}T08:00:00Z", 'durationMinutes': 60,
                   'ksbMappings': [{'code': 'K1', 'description': content[:120], 'weight': 1}], 'quizMeta': None}
                  for week in range(1,53) for i in range(8)]
    months = {f'2026-{i:02d}': {'planned': 40} for i in range(1,13)}
    sources = {'schedule': {'months': months, 'contractStatus': 'ready', 'actual': [], 'modules': [{'id': 'M1', 'title': 'Synthetic module', 'curriculumSlots': slots}],
                            'moduleLinks': {}, 'sessions': [{'id': f'O{i}', 'moduleId': 'M1', 'start': f"{slot['date']}T08:00:00Z"} for i,slot in enumerate(slots)],
                            'reviews': [{'id': i, 'title': 'Synthetic review'} for i in range(12)], 'coach': {'name': 'Synthetic coach'}, 'generatedAt': ''},
               'week': {'deadlines': slots, 'planSubjects': [{'id': 'M1', 'dates': slots, 'sessionTitles': slots, 'activityCounts': {},
                        'monthlyActivities': [{'date': slots[week-1]['date'], 'title': f'Reading {i}', 'type': 'reading', 'hours': 1} for week in range(1,53) for i in range(8)],
                        'ksbCodesByMonth': {month: ['K1'] for month in months}, 'directHours': 416}], 'monthlyOtjh': months},
               'hours': {'learner': {}, 'training_plan_totals': {'actual': 416}, 'months': [{'month': month, 'actual_hours': 40} for month in months]}}
    context = MagicMock()
    context.parallel.side_effect = lambda readers: {name: reader() for name,reader in readers.items()}
    context.payload.side_effect = lambda name: sources[name]
    with patch('coach_api.case_file.read_plan_detail', return_value={'modules': ['Synthetic module'], 'week': slots, 'components': components}):
        old = build_tab(context, 'weekly-learning')
    size = lambda payload: len(json.dumps(payload, ensure_ascii=True).encode('utf-8'))
    old_size, new_size = size(old), size(compact)
    return {'fixture': '52 weeks; 8 activities/week; synthetic content only; uncompressed JSON',
            'oldTopLevel': list(old), 'newTopLevel': list(compact), 'oldBytes': old_size, 'newBytes': new_size,
            'reductionPercent': round((1 - new_size / old_size) * 100, 2)}


class WeeklyLearningTests(SimpleTestCase):
    def test_future_completed_report_is_upcoming_not_absent(self):
        now = datetime(2026, 10, 7, 12, tzinfo=timezone.utc)
        start = datetime(2026, 10, 9, 8, tzinfo=timezone.utc)
        result = derived_session(start, start + timedelta(hours=2), 'completed', False, now)
        self.assertEqual(result, {'state': 'upcoming', 'status': 'scheduled', 'attended': None})
        self.assertEqual(derived_session(start, start + timedelta(hours=2), 'completed', True, now)['state'], 'upcoming')

    def test_future_report_normalized_consistently_in_entire_response(self):
        with patch('coach_api.weekly_learning.datetime', wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 10, 7, 12, tzinfo=timezone.utc)
            payload, _, _ = self.projection(future_report=True)
        for week in [payload['weeks'][0], payload['selectedWeek']]:
            self.assertEqual(week['status'], 'upcoming')
            self.assertEqual(week['sessionState'], 'upcoming')
            self.assertIsNone(week['attended'])
        session = payload['selectedWeek']['liveSession']
        self.assertEqual(session['sessionState'], 'upcoming')
        self.assertNotEqual(session['status'], 'completed')
        self.assertIsNone(session['attended'])

    def test_ended_session_requires_verified_attendance(self):
        start = datetime(2026, 10, 5, 8, tzinfo=timezone.utc)
        now = start + timedelta(hours=3)
        for attendance, expected in [(True, 'attended'), (False, 'missed'), (None, 'unmarked')]:
            self.assertEqual(derived_session(start, start + timedelta(hours=2), 'completed', attendance, now)['state'], expected)
        self.assertEqual(derived_session(start, now, 'cancelled', True, now)['state'], 'cancelled')
        self.assertEqual(derived_session(None, None, 'scheduled', None, now)['state'], 'unscheduled')

    def test_generated_slots_removed_but_authored_empty_and_required_weeks_kept(self):
        base = {'moduleId': 'M1', 'startDate': '2026-10-09', 'kind': 'live-session', 'weekId': None, 'totalActivities': 0}
        authored = {**base, 'weekId': 'W1'}
        activity = {**base, 'totalActivities': 1}
        reading = {**base, 'kind': 'reading-week'}
        holiday = {**base, 'holidays': [{'id': 'H1'}]}
        self.assertEqual(visible_week_rows([base, authored, activity, reading, holiday], {}), [authored, activity, reading, holiday])
        self.assertEqual(visible_week_rows([base], {('M1', '2026-10-09'): {}}), [base])

    def test_synthetic_payload_size_reduction(self):
        report = synthetic_size_report()
        self.assertEqual(report['oldTopLevel'], ['schedule', 'week', 'hours', 'detail'])
        self.assertEqual(report['newTopLevel'], ['weeks', 'selectedWeek'])
        self.assertGreater(report['reductionPercent'], 90)

    def projection(self, selection='M1:1', kind='commercial', future_report=False):
        context = MagicMock()
        context.source = SimpleNamespace(pk=201, email='learner@example.test', learner_type=kind)
        context.profile.progress_entries.filter.return_value.values.return_value = [
            {'kind': 'component', 'component_ref': 'C1', 'quiz_ref': None, 'passed': None, 'submitted_at': None}]
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        module = {'id': 'M1', 'title': 'Synthetic module', 'start_date': date(2026, 10, 5), 'end_date': date(2026, 10, 18)}
        slots = [{'slotNumber': index, 'sessionNumber': index, 'date': day, 'type': 'live-session', 'weekId': f'W{index}', 'weekTitle': f'Week {index}'}
                 for index, day in ((1, '2026-10-05'), (2, '2026-10-12'))]
        def spine(_modules, by_id, _counts, _authored):
            by_id['M1']['curriculumSlots'] = slots
        selected = 2 if selection == 'M1:2' else 1
        datasets = [[module], [], [
            {'id': 'C1', 'week_id': 'W1', 'module_catalogue_id': 'M1', 'type': 'reading', 'quiz_id': None, 'is_quiz': False, 'has_content': True},
            {'id': 'C2', 'week_id': 'W2', 'module_catalogue_id': 'M1', 'type': 'reading', 'quiz_id': None, 'is_quiz': False, 'has_content': True}],
            [], [{'id': f'C{selected}', 'title': f'Reading {selected}', 'type': 'reading', 'ksb_mappings': [{'code': 'K1'}],
              'duration_minutes': '60', 'quiz_title': None, 'quiz_duration': None, 'quiz_time_unit': None}],
            [{'session_id': 'S1', 'module_id': 'M1', 'module_title': 'Synthetic session', 'start_datetime': datetime(2026,10,5 if selected == 1 else 12,8),
              'duration_minutes': 120, 'series_join_url': 'https://example.test/teams', 'series_status': 'scheduled',
              'occurrence_id': f'O{selected}', 'scheduled_start': None, 'scheduled_end': None, 'join_url': None, 'status': None, 'attended': True}]]
        if future_report:
            start = datetime(2026, 10, 9, 8)
            slots[0]['date'] = '2026-10-09'
            datasets[3] = [{'module_catalogue_id': 'M1', 'day': date(2026, 10, 9),
                            'start': start, 'finish': start + timedelta(hours=2),
                            'status': 'completed', 'attended': False}]
            datasets[-1][0].update(start_datetime=start, scheduled_start=start,
                                  scheduled_end=start + timedelta(hours=2), status='completed', attended=False)
        with patch('coach_api.weekly_learning.connections') as connections, \
             patch('learner_api.learning_plan._effective_plan_ids', return_value=['M1']), \
             patch('learner_api.canonical_learning.require_profile', return_value={}), \
             patch('learner_api.canonical_learning.curriculum_module_ids_for', return_value=[]), \
             patch('learner_api.training_plan_dashboard.attach_curriculum_slots', side_effect=spine), \
             patch('learner_api.training_plan_dashboard.rows', side_effect=datasets):
            connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            payload = read_weekly_learning(context, selection)
        return payload, cursor, context

    def test_compact_response_and_selected_activity_session_for_each_learner_type(self):
        for kind in ('commercial', 'apprenticeship'):
            first, cursor, context = self.projection(kind=kind)
            second, _, _ = self.projection('M1:2', kind)
            self.assertEqual(set(first), {'weeks', 'selectedWeek'})
            self.assertEqual([item['id'] for item in first['selectedWeek']['activities']], ['C1'])
            self.assertEqual([item['id'] for item in second['selectedWeek']['activities']], ['C2'])
            self.assertEqual(first['selectedWeek']['liveSession']['id'], 'O1')
            self.assertEqual(second['selectedWeek']['liveSession']['id'], 'O2')
            self.assertEqual(first['selectedWeek']['liveSession']['startTime'], '09:00')
            self.assertTrue(first['selectedWeek']['liveSession']['attended'])
            self.assertEqual(first['selectedWeek']['summary']['completedActivities'], 1)
            self.assertEqual(second['selectedWeek']['summary']['completedActivities'], 0)
            self.assertEqual(first['selectedWeek']['summary']['otjhHours'], 1)
            self.assertEqual(first['selectedWeek']['summary']['achievedKsbCount'], 1)
            self.assertEqual(first['weeks'][0]['progress'], 100)
            self.assertEqual(first['weeks'][1]['progress'], 0)
            self.assertTrue(all('activities' not in row for row in first['weeks']))
            serialized = json.dumps(first)
            for forbidden in ('schedule', 'reviews', 'curriculumSlots', 'planSubjects', 'training_plan_totals', 'assignmentBrief', 'contentHtml', 'quizMeta', 'videoUrl', 'monthlyOtjh'):
                self.assertNotIn(f'"{forbidden}"', serialized)
            context.payload.assert_not_called()
            queries = [call.args for call in cursor.execute.call_args_list]
            self.assertEqual(len(queries), 7)
            self.assertEqual(queries[4][1], [['C1']])
            self.assertEqual(queries[-1][1][1:], ['M1', '2026-10-05'])
            self.assertIn('LIMIT 1', queries[-1][0])
            self.assertNotIn('description', queries[4][0])
            self.assertNotIn('reflection', queries[4][0])

    def test_unknown_week_rejected_before_component_or_session_reads(self):
        with self.assertRaisesMessage(LookupError, 'Week not found'):
            self.projection('other-module:1')

    def test_status_uses_london_date_when_utc_still_on_previous_day(self):
        with patch('coach_api.weekly_learning.datetime', wraps=datetime) as clock:
            clock.now.return_value = datetime(2026,10,4,23,30,tzinfo=timezone.utc)
            payload, _, _ = self.projection()
        self.assertEqual(payload['weeks'][0]['status'], 'current')

    def test_dynamic_week_windows_and_reading_week_are_canonical(self):
        modules = [{'id': 'M1', 'title': 'Module', 'curriculumSlots': [
            {'slotNumber': 1, 'sessionNumber': 1, 'type': 'live-session', 'date': '2026-10-19'},
            {'slotNumber': 2, 'type': 'reading-week', 'date': '2026-10-26'},
            {'slotNumber': 3, 'sessionNumber': 2, 'type': 'live-session', 'date': '2026-11-02'}]}]
        for today, expected in [('2026-10-18', ['upcoming'] * 3), ('2026-10-26', ['past','current','upcoming']), ('2026-11-09', ['past'] * 3)]:
            result = week_rows(modules, today)
            self.assertEqual([row['status'] for row in result], expected)
            self.assertEqual(result[0]['endDate'], '2026-10-25')
            self.assertEqual(result[1]['title'], 'Reading week')
            self.assertEqual(result[-1]['endDate'], '2026-11-08')

    def test_completion_keeps_any_pass_and_excludes_failed_or_unsubmitted_progress(self):
        def entry(kind, passed=None, component='C1', quiz=None, submitted=None):
            return {'kind': kind, 'passed': passed, 'component_ref': component, 'quiz_ref': quiz, 'submitted_at': submitted}
        ordinary = {'id': 'C1', 'quiz_id': None}
        quiz = {'id': 'C2', 'quiz_id': 42}
        cases = [([entry('component')], ordinary, (True,'completed')),
                 ([entry('component', False)], ordinary, (False,'not-started')),
                 ([entry('quiz_reading')], ordinary, (False,'not-started')),
                 ([entry('quiz_reading', submitted='2026-01-01')], ordinary, (True,'completed')),
                 ([entry('quiz', False, quiz='42')], quiz, (False,'in-progress')),
                 ([entry('quiz', True, quiz='42'), entry('quiz', False, quiz='42')], quiz, (True,'completed')),
                 ([entry('quiz', True, component='C2')], quiz, (True,'completed'))]
        for entries, component, expected in cases:
            self.assertEqual(activity_completion(component, progress_index(entries)), expected)

    def test_assignment_json_projection_retains_empty_and_explicit_semantics_without_content(self):
        query = MagicMock()
        query.annotate.return_value = query
        assignment_projection(query)
        for call in query.annotate.call_args_list:
            sql = next(iter(call.kwargs.values())).sql
            self.assertIn('moduleId', sql)
            self.assertIn('assignmentMode', sql)
            self.assertIn("'[]'::jsonb", sql)
            self.assertNotIn('components', sql)

    def test_endpoint_uses_narrow_reader_and_denies_legacy_resource_escape(self):
        request = RequestFactory().get('/coach_api/coach/case-file/101/weekly-learning?week=M1:2')
        request.coach_email = 'coach@example.test'
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201), stage_measurements=[])
        with patch('coach_api.case_file.CaseFileContext', return_value=context), patch('coach_api.weekly_learning.read_weekly_learning', return_value={'weeks': [], 'selectedWeek': None}) as read:
            response = unwrap(case_file_section)(request, 101, section='weekly-learning')
            self.assertEqual(response.status_code, 200)
            read.assert_called_once_with(context, 'M1:2')
            request.GET = request.GET.copy()
            request.GET['resource'] = 'schedule'
            self.assertEqual(unwrap(case_file_section)(request, 101, section='weekly-learning').status_code, 400)
            context.learner_read.assert_not_called()
