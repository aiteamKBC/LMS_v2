"""Weekly projection contracts: mocked DB cursors, no database or Graph calls."""
from datetime import date, datetime, timedelta, timezone
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory
from .weekly_learning import read_weekly_learning, week_rows, activity_completion, progress_index, assignment_projection, derived_session, visible_week_rows
from .case_file import case_file_section
from learner_api.weekly_display import display_policies, display_weeks, default_week


def selected_navigation(payload):
    return next(week for week in payload['weeks'] if week['id'] == payload['selectedWeek']['weekId'])


def synthetic_size_report():
    """Same 52-week / 8-activity programme, synthetic content; no live reads."""
    compact, _, _ = WeeklyLearningTests().projection()
    slots = [{'slotNumber': i + 1, 'sessionNumber': i + 1, 'date': (date(2026, 10, 5) + timedelta(weeks=i)).isoformat(),
              'type': 'live-session', 'weekId': f'W{i+1}', 'weekTitle': f'Week {i+1}'} for i in range(52)]
    from .weekly_contract import compact_weekly
    compact['weeks'] = compact_weekly(weeks=week_rows([{'id': 'M1', 'title': 'Synthetic module', 'curriculumSlots': slots}], '2026-10-07'))['weeks']
    compact['weeks'][0].update(completedActivities=8, totalActivities=8, progress=100)
    prototype = compact['selectedWeek']['activities'][0]
    compact['selectedWeek']['activities'] = [{**prototype, 'id': f'C1-{i}', 'title': f'Reading {i}'} for i in range(8)]
    compact['selectedWeek']['summary'].update(otjhHours=8, plannedOtjhHours=8)
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
    old = {**sources, 'detail': {'modules': ['Synthetic module'], 'week': slots, 'components': components}}
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
        for week in [payload['weeks'][0], selected_navigation(payload)]:
            self.assertEqual(week['status'], 'upcoming')
            self.assertEqual(week['sessionState'], 'upcoming')
            self.assertEqual(week['attendance'], 'upcoming')
        session = payload['selectedWeek']['liveSession']
        self.assertEqual(session['sessionState'], 'upcoming')
        self.assertNotEqual(session['status'], 'completed')
        self.assertEqual(session['attendance'], 'upcoming')

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
        self.assertEqual(report['newTopLevel'], ['modules', 'weeks', 'selectedWeek'])
        self.assertGreater(report['reductionPercent'], 90)

    def projection(self, selection='M1:1', kind='commercial', future_report=False, records=None, duration='60', reader_options=None, session_only=False, fallback_ksbs=None, live_evidence=None,
                   display_policy=None, cohort_id='COHORT1', detail_week=None, empty_future=False):
        context = MagicMock()
        context.source = SimpleNamespace(pk=201, email='learner@example.test', learner_type=kind, cohort_id=cohort_id)
        context.profile.progress_entries.filter.return_value.values.return_value = [
            {'kind': 'component', 'component_ref': 'C1', 'quiz_ref': None, 'passed': None, 'submitted_at': None}]
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        module = {'id': 'M1', 'title': 'Synthetic module', 'start_date': date(2026, 10, 5), 'end_date': date(2026, 10, 18)}
        if display_policy is not None:
            module['source_weekly_display'] = [display_policy]
        slots = [{'slotNumber': index, 'sessionNumber': index, 'date': day, 'type': 'live-session', 'weekId': f'W{index}', 'weekTitle': f'Week {index}'}
                 for index, day in ((1, '2026-10-05'), (2, '2026-10-12'))]
        def spine(_modules, by_id, _counts, _authored, **kwargs):
            by_id['M1']['curriculumSlots'] = slots
        if empty_future:
            slots.append({'slotNumber': 3, 'sessionNumber': 3, 'date': '2026-10-19',
                          'type': 'live-session', 'weekId': 'W3', 'weekTitle': 'Week 3'})
        selected = detail_week or (2 if selection == 'M1:2' else 1)
        datasets = [[module], [], [
            {'id': 'C1', 'week_id': 'W1', 'module_catalogue_id': 'M1', 'type': 'reading', 'quiz_id': None, 'is_quiz': False, 'has_content': True},
            {'id': 'C2', 'week_id': 'W2', 'module_catalogue_id': 'M1', 'type': 'reading', 'quiz_id': None, 'is_quiz': False, 'has_content': True}],
            [], [{'id': f'C{selected}', 'title': f'Reading {selected}', 'type': 'reading', 'ksb_mappings': [{'code': 'K1'}],
              'duration_minutes': duration, 'quiz_title': None, 'quiz_duration': None, 'quiz_time_unit': None}],
            [{'session_id': 'S1', 'module_id': 'M1', 'module_title': 'Synthetic session', 'start_datetime': datetime(2026,10,5 if selected == 1 else 12,8),
              'duration_minutes': 120, 'series_join_url': 'https://example.test/teams', 'series_status': 'scheduled',
              'occurrence_id': f'O{selected}', 'scheduled_start': None, 'scheduled_end': None, 'join_url': None, 'status': None, 'attended': True}]]
        if live_evidence is not None:
            context.profile.progress_entries.filter.return_value.values.return_value = []
            for component in datasets[2]:
                component['type'] = 'live_session'
            datasets[4][0]['type'] = 'live_session'
            # Shared modules have no direct Teams rows of their own.
            datasets[-1] = []
        if session_only:
            slots[0].pop('weekId')
            start = datetime(2026, 10, 5, 8)
            datasets[2] = [datasets[2][1]]
            datasets[3] = [{'module_catalogue_id': 'M1', 'day': date(2026, 10, 5),
                'start': start, 'finish': start + timedelta(hours=2), 'status': 'scheduled', 'attended': True}]
            datasets[4] = []
        if future_report:
            start = datetime(2026, 10, 9, 8)
            slots[0]['date'] = '2026-10-09'
            datasets[3] = [{'module_catalogue_id': 'M1', 'day': date(2026, 10, 9),
                            'start': start, 'finish': start + timedelta(hours=2),
                            'status': 'completed', 'attended': False}]
            datasets[-1][0].update(start_datetime=start, scheduled_start=start,
                                  scheduled_end=start + timedelta(hours=2), status='completed', attended=False)
        # Both roles now use the unified optimized projection.
        if fallback_ksbs is not None:
            datasets[4][0]['ksb_mappings'] = []
            datasets[4][0]['fallback_ksb_mappings'] = fallback_ksbs
        sessions = datasets.pop()
        if sessions:
            session = sessions[0]
            start = session['scheduled_start'] or session['start_datetime']
            datasets[3] = [{**session, 'module_catalogue_id': 'M1', 'day': start.date(),
                            'start': start, 'finish': session['scheduled_end'] or start + timedelta(minutes=session['duration_minutes'])}]
        context.profile.progress_entries.filter.return_value.filter.return_value = context.profile.progress_entries.filter.return_value
        with patch('coach_api.weekly_learning.connections') as connections, \
             patch('coach_api.weekly_learning.read_weekly_live_evidence', return_value=live_evidence or ([], [])), \
             patch('learner_api.learning_plan._effective_plan_ids', return_value=['M1']), \
             patch('learner_api.canonical_learning.require_profile', return_value={}), \
             patch('learner_api.canonical_learning.curriculum_module_ids_for', return_value=[]), \
             patch('learner_api.canonical_learning.entries_for', return_value=records if records is not None else [
                 {'module_ref': 'M1', 'component_ref': 'C1', 'accepted': True, 'actual_seconds': 3600}]), \
             patch('learner_api.canonical_learning.weekly_hour_records', return_value=records if records is not None else [
                 {'module_ref': 'M1', 'component_ref': 'C1', 'accepted': True, 'actual_seconds': 3600}]), \
             patch('learner_api.training_plan_dashboard.attach_curriculum_slots', side_effect=spine), \
             patch('learner_api.training_plan_dashboard.rows', side_effect=datasets):
            connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            payload = read_weekly_learning(context, selection, **(reader_options or {}))
        return payload, cursor, context

    def test_source_display_opens_latest_content_and_omits_empty_authored_week(self):
        policy = {'version': 1, 'mode': 'available-content', 'moduleId': 'M1',
                  'cohortId': 'COHORT1', 'weekDates': {'W1': '2026-10-07', 'W2': '2026-10-21'}}
        with patch('coach_api.weekly_learning.datetime', wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 10, 27, 12, tzinfo=timezone.utc)
            for kind in ('commercial', 'apprenticeship'):
                payload, _, _ = self.projection(None, kind=kind, display_policy=policy, detail_week=2, empty_future=True)
                self.assertEqual([week['weekId'] for week in payload['weeks']], ['W1', 'W2'])
                self.assertEqual(payload['selectedWeek']['weekId'], 'M1:2')
                self.assertEqual(selected_navigation(payload)['startDate'], '2026-10-21')
                self.assertEqual(selected_navigation(payload)['endDate'], '2026-10-27')
                self.assertEqual([activity['id'] for activity in payload['selectedWeek']['activities']], ['C2'])

    def test_source_display_preserves_hours_progress_meetings_and_explicit_selection(self):
        policy = {'version': 1, 'mode': 'available-content', 'moduleId': 'M1',
                  'cohortId': 'COHORT1', 'weekDates': {'W1': '2026-10-07', 'W2': '2026-10-21'}}
        for selection in ('M1:1', 'M1:2'):
            baseline, _, _ = self.projection(selection)
            changed, _, _ = self.projection(selection, display_policy=policy)
            detail, _, _ = self.projection(selection, display_policy=policy,
                reader_options={'include_weeks': False, 'module_id': 'M1', 'include_actions': True})
            self.assertEqual(changed['selectedWeek'], baseline['selectedWeek'])
            self.assertEqual(changed['selectedWeek'], detail['selectedWeek'])
            self.assertEqual(selected_navigation(changed), selected_navigation(detail))
            self.assertEqual(changed['selectedWeek']['weekId'], selection)
        with self.assertRaises(LookupError):
            self.projection('M1:3', display_policy=policy, empty_future=True)

    def test_source_display_does_not_change_another_cohort(self):
        policy = {'version': 1, 'mode': 'available-content', 'moduleId': 'M1',
                  'cohortId': 'COHORT1', 'weekDates': {'W1': '2026-10-07'}}
        before, _, _ = self.projection(empty_future=True)
        after, _, _ = self.projection(display_policy=policy, cohort_id='COHORT2', empty_future=True)
        self.assertEqual(before, after)
        self.assertIn('W3', [week['weekId'] for week in after['weeks']])

    def test_source_display_dates_allow_multiple_sections_per_day_without_mutating_facts(self):
        from copy import deepcopy
        weeks = [dict(id=f'M1:{i}', moduleId='M1', weekId=f'W{i}', slotNumber=i,
                      startDate='2026-06-10', endDate='2026-06-16', status='past', totalActivities=1)
                 for i in range(1, 5)]
        original = deepcopy(weeks)
        policy = {'weekDates': {'W1': '2026-06-09', 'W2': '2026-06-10',
                                'W3': '2026-06-10', 'W4': '2026-07-01'}}
        result = display_weeks(weeks, {'M1': policy}, '2026-06-10')
        self.assertEqual(weeks, original)
        self.assertEqual(result[0]['endDate'], '2026-06-09')
        self.assertEqual(result[1]['endDate'], '2026-06-16')
        self.assertEqual(result[1]['startDate'], result[2]['startDate'])
        self.assertEqual(default_week(result, latest_available=True, today='2026-06-10')['weekId'], 'W3')
        self.assertEqual(default_week(result, latest_available=True, today='2026-06-01')['weekId'], 'W1')
        self.assertIsNone(default_week([], latest_available=True, today='2026-06-10'))

    def test_source_display_rejects_ambiguous_or_invalid_configuration(self):
        policy = {'version': 1, 'mode': 'available-content', 'moduleId': 'M1',
                  'cohortId': 'COHORT1', 'weekDates': {'W1': '2026-06-10'}}
        self.assertEqual(display_policies([{'id': 'M1', 'source_weekly_display': json.dumps([policy])}], 'COHORT1'), {'M1': policy})
        for candidates in ([policy, policy], [{**policy, 'moduleId': 'OTHER'}],
                           [{**policy, 'weekDates': {'W1': '2026-02-30'}}]):
            with self.assertRaises(ValueError):
                display_policies([{'id': 'M1', 'source_weekly_display': candidates}], 'COHORT1')

    def test_roles_have_identical_facts_and_reader_calls(self):
        from .weekly_contract import compact_weekly
        for kind in ('commercial', 'apprenticeship'):
            for selection in ('M1:1', 'M1:2'):
                with self.subTest(kind=kind, selection=selection):
                    coach, coach_cursor, _ = self.projection(selection, kind=kind,
                        reader_options={'include_actions': False})
                    learner, learner_cursor, _ = self.projection(selection, kind=kind,
                        reader_options={'include_actions': True})
                    self.assertEqual(coach, learner)
                    self.assertEqual(coach_cursor.execute.call_args_list, learner_cursor.execute.call_args_list)
                    self.assertNotIn('version', coach)
                    self.assertEqual(set(coach), {'modules', 'weeks', 'selectedWeek'})

    def test_compact_contract_preserves_corrected_occurrence_date_and_unmarked_evidence(self):
        from .weekly_contract import compact_weekly
        facts = {'id': 'M1:1', 'moduleId': 'M1', 'moduleTitle': 'Module', 'sessionState': 'unmarked', 'attended': None}
        live = {'id': 'O1', 'date': '2026-10-06', 'startTime': '10:00', 'endTime': '12:00',
                'attended': None, 'sessionState': 'unmarked'}
        wire = compact_weekly(weeks=[facts], selected=facts, summary={}, live_session=live,
                              activities=[{'id': 'C1', 'status': 'not-started'}])
        self.assertEqual(wire['selectedWeek']['liveSession']['date'], '2026-10-06')
        self.assertEqual(wire['selectedWeek']['liveSession']['startTime'], '10:00')
        self.assertEqual(wire['selectedWeek']['liveSession']['endTime'], '12:00')
        self.assertEqual(wire['selectedWeek']['liveSession']['attendance'], 'unmarked')
        self.assertNotIn('completed', wire['selectedWeek']['activities'][0])
        self.assertNotIn('moduleTitle', wire['weeks'][0])

    def test_week_detail_limits_nonquiz_components_but_retains_shared_quiz_placements(self):
        payload, cursor, _ = self.projection('M1:2', reader_options={
            'include_actions': True, 'include_weeks': False, 'module_id': 'M1'})
        call = next(call for call in cursor.execute.call_args_list if 'AS has_content' in call.args[0])
        self.assertIn('c.week_id=%s OR l.quiz_id IS NOT NULL', call.args[0])
        self.assertIn("linkedQuizId' ~ '^[0-9]+$'", call.args[0])
        self.assertEqual(call.args[1], [['M1'], 'W2'])
        self.assertEqual([activity['id'] for activity in payload['selectedWeek']['activities']], ['C2'])
        _, coach, _ = self.projection('M1:2')
        coach_sql = next(call.args[0] for call in coach.execute.call_args_list if 'AS has_content' in call.args[0])
        self.assertNotIn('c.week_id=%s OR', coach_sql)

    def test_student_inline_fallback_ksbs_keep_achievement_and_codes(self):
        for value in ([{'code': 'K2'}, {'code': 'K3'}], '[{"code":"K2"},{"code":"K3"}]'):
            payload, cursor, _ = self.projection(reader_options={'include_actions': True}, fallback_ksbs=value)
            self.assertEqual(payload['selectedWeek']['activities'][0]['ksbCodes'], ['K2', 'K3'])
            self.assertEqual(payload['selectedWeek']['summary']['ksbCount'], 2)
            self.assertEqual(payload['selectedWeek']['summary']['achievedKsbCount'], 2)
            self.assertFalse(any('SELECT component_id,ksb_code' in call.args[0] for call in cursor.execute.call_args_list))

    def test_actions_projection_reuses_attendance_and_preserves_selected_calculations(self):
        for selection in ('M1:1', 'M1:2'):
            expected, before, _ = self.projection(selection)
            actual, after, _ = self.projection(selection, reader_options={'include_actions': True})
            self.assertEqual(actual['selectedWeek'], expected['selectedWeek'])
            # Student reads combine both attendance detail and fallback KSBs.
            self.assertEqual(after.execute.call_count, before.execute.call_count)
            self.assertEqual(after.execute.call_count, 5)
            statements = [call.args[0] for call in after.execute.call_args_list]
            self.assertEqual(sum('live_session_attendance' in sql for sql in statements), 1)
            self.assertIn("to_jsonb(m)->'session_holidays'", statements[0])
            self.assertIn("to_jsonb(m)->'session_overrides'", statements[0])

    def test_shared_live_attendance_reaches_both_weekly_views_without_cross_week_credit(self):
        from learner_api.live_session_progress import project_live_credits
        now = datetime(2026, 10, 19, tzinfo=timezone.utc)
        start = datetime(2026, 10, 5, 8, tzinfo=timezone.utc)
        row = {'source': 'microsoft-teams', 'session_id': 'O1:M1', 'occurrence_id': 'O1:M1',
               'attendance_source_occurrence_id': 'O1', 'module_catalogue_id': 'M1',
               'live_session_id': 'SHARED', 'session_number': 1, 'session_date': start.date(),
               'scheduled_start': start, 'scheduled_end': start + timedelta(hours=2),
               'attendance_report_id': 'R1', 'attendance_status': 'present', 'attended_seconds': 181,
               'join_url': 'https://example.test/shared-meeting'}
        credits = project_live_credits([{'componentId': 'C1', 'moduleId': 'M1', 'type': 'live_session',
                                         'sessionDate': '2026-10-05'}], [row], now=now)
        credits = [{**credit, 'sessionDate': '2026-10-05'} for credit in credits]
        for kind in ('commercial', 'apprenticeship'):
            for options in ({}, {'module_id': 'M1', 'include_weeks': False},
                            {'include_actions': True},
                            {'include_actions': True, 'module_id': 'M1', 'include_weeks': False}):
                with self.subTest(kind=kind, options=options):
                    first, _, _ = self.projection(kind=kind, reader_options=options, records=[], duration='120',
                                                  live_evidence=([row], credits))
                    second, _, _ = self.projection(selection='M1:2', kind=kind, reader_options=options,
                                                   records=[], duration='120', live_evidence=([row], credits))
                    self.assertEqual(selected_navigation(first)['completedActivities'], 1)
                    self.assertEqual(selected_navigation(first)['progress'], 100)
                    self.assertEqual(first['selectedWeek']['summary']['otjhHours'], 2)
                    self.assertEqual(first['selectedWeek']['activities'][0]['actualHours'], 2)
                    self.assertEqual(first['selectedWeek']['summary']['achievedKsbCount'], 1)
                    self.assertEqual(first['selectedWeek']['liveSession']['joinUrl'], row['join_url'])
                    self.assertEqual(first['selectedWeek']['liveSession']['sessionState'], 'attended')
                    self.assertEqual(first['weeks'][0]['sessionState'], 'attended')
                    self.assertEqual(selected_navigation(second)['completedActivities'], 0)
                    self.assertEqual(second['selectedWeek']['summary']['otjhHours'], 0)
                    self.assertIsNone(second['selectedWeek']['liveSession'])

    def test_session_only_generated_slot_survives_scoped_detail_read(self):
        expected, _, _ = self.projection(session_only=True)
        actual, _, _ = self.projection(session_only=True,
            reader_options={'module_id': 'M1', 'include_weeks': False})
        self.assertEqual(actual['selectedWeek'], expected['selectedWeek'])
        self.assertIsNotNone(actual['selectedWeek']['liveSession'])
        self.assertEqual(actual['selectedWeek']['activities'], [])

    def test_student_scoped_reader_preserves_canonical_week_one_and_two_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            for selection in ('M1:1', 'M1:2'):
                expected, _, _ = self.projection(selection=selection, kind=kind)
                actual, cursor, _ = self.projection(selection=selection, kind=kind,
                    reader_options={'module_id': 'M1', 'include_weeks': False})
                self.assertEqual(actual['selectedWeek'], expected['selectedWeek'])
                queries = cursor.execute.call_args_list
                marker = next(call for call in queries if 'WITH markers' in call.args[0])
                self.assertIn('::date=%s::date', marker.args[0])
                self.assertEqual(marker.args[1][1], ['M1'])
                self.assertEqual(marker.args[1][2], selected_navigation(actual)['startDate'])
                detail = next(call for call in queries if 'SELECT c.id,c.title' in call.args[0])
                self.assertEqual(detail.args[1], [[actual['selectedWeek']['activities'][0]['id']]])

    def test_completed_two_hour_assignment_uses_one_accepted_hour_only(self):
        records = [
            {'module_ref': 'M1', 'component_ref': 'C1', 'accepted': True, 'actual_seconds': 3600},
            {'module_ref': 'M1', 'component_ref': 'C1', 'accepted': False, 'actual_seconds': 7200},
            {'module_ref': 'M1', 'component_ref': 'C2', 'accepted': True, 'actual_seconds': 18000},
            {'module_ref': 'M2', 'component_ref': 'C1', 'accepted': True, 'actual_seconds': 18000},
        ]
        for kind in ('commercial', 'apprenticeship'):
            payload, _, _ = self.projection(kind=kind, records=records, duration='120')
            self.assertEqual(payload['selectedWeek']['summary']['otjhHours'], 1)
            self.assertEqual(payload['selectedWeek']['summary']['plannedOtjhHours'], 2)
            self.assertEqual(selected_navigation(payload)['completedActivities'], 1)
            self.assertEqual(payload['selectedWeek']['activities'][0]['status'], 'completed')
            self.assertEqual(payload['selectedWeek']['activities'][0]['expectedHours'], 2)
            self.assertEqual(payload['selectedWeek']['activities'][0]['actualHours'], 1)
            empty, _, _ = self.projection(kind=kind, records=[], duration='120')
            self.assertEqual(empty['selectedWeek']['summary']['otjhHours'], 0)
            self.assertEqual(empty['selectedWeek']['activities'][0]['actualHours'], 0)
            second, _, _ = self.projection(selection='M1:2', kind=kind, records=records, duration='120')
            self.assertEqual(second['selectedWeek']['activities'][0]['actualHours'], 5)

    def test_compact_response_and_selected_activity_session_for_each_learner_type(self):
        for kind in ('commercial', 'apprenticeship'):
            first, cursor, context = self.projection(kind=kind)
            second, _, _ = self.projection('M1:2', kind)
            self.assertEqual(set(first), {'modules', 'weeks', 'selectedWeek'})
            self.assertEqual([item['id'] for item in first['selectedWeek']['activities']], ['C1'])
            self.assertEqual([item['id'] for item in second['selectedWeek']['activities']], ['C2'])
            self.assertEqual(first['selectedWeek']['liveSession']['id'], 'O1')
            self.assertEqual(second['selectedWeek']['liveSession']['id'], 'O2')
            self.assertEqual(first['selectedWeek']['liveSession']['startTime'], '09:00')
            self.assertEqual(first['selectedWeek']['liveSession']['attendance'], 'present')
            self.assertEqual(selected_navigation(first)['completedActivities'], 1)
            self.assertEqual(selected_navigation(second)['completedActivities'], 0)
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
            self.assertEqual(len(queries), 5)
            self.assertEqual(queries[4][1], [['C1']])
            self.assertEqual(queries[3][1][1], ['M1'])
            self.assertIn('SELECT DISTINCT ON', queries[3][0])
            self.assertEqual(sum('live_session_attendance' in sql for sql, _ in queries), 1)
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

    def test_weekly_authentication_denies_anonymous_and_learner_before_reader(self):
        for account, status in ((None, 401), (SimpleNamespace(role='learner'), 403)):
            with self.subTest(status=status), \
                 patch('login.permissions.authenticate_request', return_value=account), \
                 patch('coach_api.weekly_learning.read_weekly_learning') as read:
                response = case_file_section(RequestFactory().get('/weekly'), 101,
                                             section='weekly-learning')
                self.assertEqual(response.status_code, status)
                read.assert_not_called()

    def test_weekly_ownership_filter_is_scoped_to_authenticated_coach(self):
        from .case_file import CaseFileContext
        with patch('coach_api.case_file.authenticated_coach_email', return_value='owner@example.test'), \
             patch('coach_api.case_file.LearnerProfile.objects') as objects, \
             patch('coach_api.weekly_learning.read_weekly_learning') as read:
            query = objects.annotate.return_value
            query.filter.return_value.only.return_value.first.return_value = None
            context = CaseFileContext(RequestFactory().get('/weekly'), 101)
            query.filter.assert_called_once_with(id=101, coach_email_key='owner@example.test')
            self.assertIsNone(context.profile)
            self.assertIsNone(context.source)
            read.assert_not_called()

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
