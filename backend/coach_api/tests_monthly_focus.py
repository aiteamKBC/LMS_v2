"""Synthetic Monthly Focus contracts; no DB, mail, Graph or storage calls."""
from datetime import datetime, timezone
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory
from django.http import JsonResponse
from .monthly_focus import month_bounds, project_month, read_month_activities, read_month_lectures
from .case_file import build_tab, case_file_section, project_month_focus


class MonthlyFocusTests(SimpleTestCase):
    def fixtures(self):
        activities = [{'key': ('native', 'A1'), 'id': 'A1', 'module_id': 'M1', 'title': 'Synthetic assignment',
                       'type': 'assignment', 'date': '2026-10-02', 'expected_hours': 5, 'completed': True,
                       'ksb_mappings': [{'code': 'K1'}, {'code': 'S1'}]},
                      {'key': ('native', 'A2'), 'id': 'A2', 'title': 'Future assignment', 'type': 'assignment',
                       'date': '2026-11-02', 'completed': False, 'ksb_mappings': [{'code': 'K9'}]},
                      {'key': ('native', 'L1'), 'id': 'L1', 'module_id': 'M1', 'title': 'Authored lecture',
                       'type': 'live_session', 'date': '2026-10-04', 'completed': False,
                       'ksb_mappings': [{'code': 'K1'}]}]
        reviews = [{'id': 'R1', 'source': 'progress-review', 'title': 'Review', 'scheduledDate': '2026-10-03',
                    'targetDate': '2026-11-03', 'date': '2026-11-03', 'scheduledTime': '09:00',
                    'durationMinutes': 60, 'status': 'scheduled', 'meetingLink': 'https://example.test/private',
                    'invited': False, 'reviewInstanceId': 'private'},
                   {'id': 'R2', 'source': 'mcr', 'title': 'Other month', 'scheduledDate': '2026-11-03', 'date': '2026-10-03'},
                   {'id': 'R3', 'source': 'student-support', 'date': '2026-10-03'},
                   {'id': 'R4', 'source': 'mcr', 'date': '2026-10-03', 'status': 'cancelled'}]
        lectures = [{'id': 'L1', 'module_id': 'M1', 'title': 'Module', 'tutor_name': 'Synthetic tutor',
                     'start': datetime(2026,10,4,8,tzinfo=timezone.utc), 'finish': datetime(2026,10,4,10,tzinfo=timezone.utc)},
                    {'id': 'L2', 'module_id': 'M1', 'start': datetime(2026,11,4,9,tzinfo=timezone.utc)}]
        return activities, reviews, lectures

    def test_selected_month_contract_and_canonical_display_date(self):
        result = project_month('2026-10', 50, 10, *self.fixtures())
        self.assertEqual(set(result), {'month', 'summary', 'reviews', 'assignments', 'lectures'})
        self.assertEqual(result['summary'], {'requiredHours': 50, 'achievedHours': 10, 'differenceHours': -40, 'ksbCount': 2})
        self.assertEqual([row['id'] for row in result['reviews']], ['R1'])
        self.assertEqual(result['reviews'][0]['date'], '2026-10-03')
        self.assertEqual(set(result['reviews'][0]), {'id', 'type', 'title', 'date', 'time', 'durationMinutes', 'status'})
        self.assertEqual(result['assignments'], [{'id': 'native:A1', 'title': 'Synthetic assignment', 'date': '2026-10-02', 'status': 'completed'}])
        self.assertEqual(result['lectures'][0], {'id': 'L1', 'date': '2026-10-04', 'time': '09:00', 'title': 'Authored lecture', 'tutor': 'Synthetic tutor', 'durationMinutes': 120})
        for section in ('reviews', 'assignments', 'lectures'):
            self.assertTrue(all(row['date'].startswith('2026-10') for row in result[section]))

    def test_missing_target_and_ksbs_remain_unavailable(self):
        result = project_month('2027-01', None, 0, [], [], [])
        self.assertEqual(result['summary'], {'requiredHours': None, 'achievedHours': 0, 'differenceHours': None, 'ksbCount': None})

    def test_uk_month_boundaries_include_dst_and_year_rollover(self):
        self.assertEqual(month_bounds('2026-10'), (datetime(2026,9,30,23,tzinfo=timezone.utc), datetime(2026,11,1,tzinfo=timezone.utc)))
        self.assertEqual(month_bounds('2026-12')[1], datetime(2027,1,1,tzinfo=timezone.utc))
        lectures = [{'id': 'boundary', 'module_id': 'M1', 'title': 'Boundary',
                     'start': datetime(2026,9,30,23,30,tzinfo=timezone.utc), 'finish': datetime(2026,10,1,0,30,tzinfo=timezone.utc)}]
        self.assertEqual(project_month('2026-10', None, 0, [], [], lectures)['lectures'][0]['date'], '2026-10-01')

    def test_narrow_route_never_calls_legacy_dashboard_readers(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201, lifecycle_status='active'), source=SimpleNamespace(pk=201))
        activities, reviews, lectures = self.fixtures()
        with patch('learner_api.canonical_learning.require_profile', return_value={'id': 101}), \
             patch('coach_api.monthly_focus.read_month_activities', return_value=(activities[:1], ['M1'])), \
             patch('learner_api.canonical_learning.targets_for', return_value={'2026-10': 50}) as targets, \
             patch('coach_api.monthly_focus.query', return_value=[{'actual_seconds': 36000, 'accepted': True}, {'actual_seconds': 7200, 'accepted': False}]) as actual, \
             patch('learner_api.calendar.coaching_events_for_learner', return_value=reviews) as calendar, \
             patch('coach_api.monthly_focus.read_month_lectures', return_value=lectures):
            result = build_tab(context, 'monthly-focus', '2026-10')
        self.assertEqual(result['summary']['achievedHours'], 10)
        self.assertEqual(result['summary']['differenceHours'], -40)
        targets.assert_called_once_with({'id': 101}, month='2026-10')
        self.assertIn('reporting_month=%s', actual.call_args.args[0])
        self.assertEqual(actual.call_args.args[1], [101, '2026-10'])
        calendar.assert_called_once_with(context.source, context.profile, month='2026-10')
        context.payload.assert_not_called(); context.parallel.assert_not_called(); context.learner_read.assert_not_called()

    def test_targets_filtered_in_sql_keep_programme_identity_precedence(self):
        from learner_api.canonical_learning import targets_for
        owner = {'id': 101, 'enrolment_id': 201, 'programme_id': 'P1'}
        with patch('learner_api.canonical_learning.query', return_value=[{'report_month': '2026-10', 'target_hours': 50}]) as read:
            self.assertEqual(targets_for(owner, month='2026-10'), {'2026-10': 50})
        self.assertIn('AND report_month=%s', read.call_args.args[0])
        self.assertEqual(read.call_args.args[1], [101, 201, 'P1', '2026-10', 201, 'P1'])

    def test_invalid_month_or_wrong_coach_cannot_read_projection(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201))
        request = RequestFactory().get('/?month=2026-13'); request.coach_email = 'coach@example.test'
        with patch('coach_api.case_file.CaseFileContext', return_value=context), patch('coach_api.monthly_focus.read_monthly_focus') as read:
            self.assertEqual(unwrap(case_file_section)(request, 101, section='monthly-focus').status_code, 400)
            context.profile = None
            self.assertEqual(unwrap(case_file_section)(request, 101, section='monthly-focus').status_code, 404)
        read.assert_not_called()

    def test_lecture_query_is_scoped_without_urls_attendance_or_recurrence_generation(self):
        context = MagicMock(source=SimpleNamespace(pk=201))
        cursor = MagicMock(); connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch('coach_api.monthly_focus.connections', {'enrolment': connection}), \
             patch('learner_api.learning_plan._effective_plan_ids', return_value=['M1']), \
             patch('learner_api.canonical_learning.curriculum_module_ids_for', return_value=['M2']), \
             patch('coach_api.monthly_focus.rows', return_value=[]):
            read_month_lectures(context, {'id': 101}, [], '2026-10')
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [['M1', 'M2'], *month_bounds('2026-10')])
        self.assertIn('scheduled_start', sql); self.assertIn('repeat_pattern', sql)
        self.assertNotIn('join_url', sql); self.assertNotIn('attendance', sql)


    def test_month_component_query_loads_only_selected_ids_and_compact_completion(self):
        context = MagicMock(source=SimpleNamespace(pk=201))
        progress = MagicMock()
        context.profile.progress_entries.using.return_value=progress
        progress.filter.return_value=progress; progress.exclude.return_value=progress
        progress.values.return_value=[{'kind':'component','passed':True,'component_ref':'A1','quiz_ref':None}]
        cursor = MagicMock(); cursor.fetchall.return_value=[('M1','Module')]
        connection=MagicMock(); connection.cursor.return_value.__enter__.return_value=cursor
        dates={'A1':{'date':'2026-10-02','date_needs_review':False},'A2':{'date':'2026-11-02','date_needs_review':False}}
        with patch('coach_api.monthly_focus.connections',{'enrolment':connection}), \
             patch('learner_api.builder_activity_dates.read_builder_activity_dates',return_value=dates), \
             patch('coach_api.monthly_focus.rows',return_value=[{'id':'A1','module_id':'M1','title':'Assignment','type':'assignment','quiz_id':None}]):
            activities,assigned=read_month_activities(context,'2026-10')
        self.assertEqual(assigned,['M1']); self.assertEqual(len(activities),1)
        self.assertTrue(activities[0]['completed'])
        sql,params=cursor.execute.call_args.args
        self.assertEqual(params,[['A1'],['M1']]); self.assertNotIn('brief',sql); self.assertNotIn('html',sql)
        progress.values.assert_called_once_with('kind','passed','component_ref','quiz_ref')


    def test_calendar_month_query_includes_moved_bookings_and_defers_review_bodies(self):
        from learner_api.calendar import coaching_events_for_learner
        profile = SimpleNamespace(id=101, email='learner@example.test')
        source = SimpleNamespace(pk=201, email='learner@example.test')
        query = MagicMock(); query.filter.return_value = query; query.defer.return_value = query
        query.order_by.return_value = []
        with patch('learner_api.calendar.source_for_learner', return_value=SimpleNamespace(kind='curriculum')), \
             patch('learner_api.calendar.CoachCalendarEvent.objects.filter', return_value=query), \
             patch('learner_api.calendar._curriculum_cycle_events', return_value=[]) as generated:
            coaching_events_for_learner(source, profile, month='2026-10')
        date_query = query.filter.call_args_list[0].args[0]
        self.assertEqual(date_query.connector, 'OR')
        self.assertEqual({name for name, _ in date_query.children}, {'scheduled_date__range', 'target_date__range'})
        query.defer.assert_called_once_with('review_responses', 'notes')
        generated.assert_called_once_with(source, profile, [], month='2026-10')

    def test_imported_compact_state_keeps_status_without_loading_answers_or_template(self):
        from coach_api.review_sources import apply_imported_state
        class NoBody:
            @property
            def review_responses(self):
                raise AssertionError('Review body must not load')
            @property
            def template_snapshot(self):
                raise AssertionError('Template must not load')
        record = NoBody()
        record.sync_state='synced'; record.graph_event_id='event'; record.meeting_link='https://example.test/meeting'
        record.graph_web_link=''; record.status='scheduled'; record.pk=1; record.event_key='imported-review:1'
        from datetime import date
        record.scheduled_date=date(2026,10,3); record.scheduled_time=None; record.duration_minutes=60
        record.meeting_provider='teams'; record.owner_name='Synthetic coach'; record.owner_email='coach@example.test'
        overlay = NoBody(); overlay.source_review_id=1; overlay.status='awaiting-signature'; overlay.completed_at=None
        result = apply_imported_state({'status':'not-scheduled'},record,overlay,compact=True)
        self.assertEqual(result['status'],'awaiting-signature')
        self.assertEqual(result['date'],'2026-10-03')
        self.assertEqual(result['reviewResponses'],{})

    def test_imported_review_sql_filters_candidates_before_shared_serialization(self):
        from coach_api.views import fetch_aptem_review_events
        profile = SimpleNamespace(id=101)
        connection = MagicMock(); cursor = connection.cursor.return_value.__enter__.return_value
        cursor.description = []; cursor.fetchall.return_value=[]
        with patch('coach_api.views.connections', {'enrolment': connection}), \
             patch('coach_api.views.get_learner_db_alias', return_value='enrolment'), \
             patch('coach_api.review_sources.imported_learner_identity', return_value={}):
            fetch_aptem_review_events([profile],{101:1},owner_email='coach@example.test',owner_name='Coach',
                                     projection_month='2026-10',projection_review_ids=[77],projection_event_keys=['imported-review:77'])
        sql, params = cursor.execute.call_args.args
        self.assertLess(sql.index('left(coalesce(nullif(lr.planned_scheduled_date'),sql.index('ORDER BY COALESCE'))
        self.assertIn("{source_metadata,Planned / Scheduled Date}", sql)
        self.assertEqual(params, [[101],'2026-10','2026-10',[77],['imported-review:77']])
        self.assertIn('^[0-9]{4}-[0-9]{2}-', sql)


def synthetic_size_report():
    """Reproduce the old month-trimmed shape using only synthetic data."""
    from datetime import date, timedelta
    from copy import deepcopy
    month = '2026-10'
    months = {f'2026-{i:02d}': {'planned': 50} for i in range(1,13)}
    slots = [{'slotNumber': i+1, 'sessionNumber': i+1, 'date': (date(2026,1,5)+timedelta(weeks=i)).isoformat(),
              'type': 'live-session', 'weekId': f'W{i}', 'weekTitle': f'Week {i}'} for i in range(52)]
    activities, reviews, lectures = MonthlyFocusTests().fixtures()
    schedule = {'months': months, 'actual': [{'month': key, 'hours': 10} for key in months], 'actualAvailable': True,
                'modules': [{'id': 'M1', 'title': 'Synthetic module', 'curriculumSlots': slots}], 'moduleLinks': {'current:M1': {'id': 'M1'}},
                'sessions': [{'id': f'L{i}', 'start': slot['date']+'T09:00:00Z', 'joinUrl': 'https://example.test/synthetic'} for i,slot in enumerate(slots)],
                'reviews': reviews, 'coach': {'name': 'Synthetic coach'}, 'generatedAt': '2026-10-07T00:00:00Z'}
    focus = json.loads(project_month_focus(JsonResponse(schedule), month).content)
    schedule.update(focus)
    schedule['sessions'] = [row for row in schedule['sessions'] if row['start'].startswith(month)]
    old = {'schedule': schedule, 'week': {'modules': ['M1'], 'deadlines': slots,
           'planSubjects': [{'id': 'M1', 'dates': [slot['date'] for slot in slots], 'sessionTitles': slots,
             'activityCounts': {'reading': 416}, 'monthlyActivities': [{'date': '2026-10-02', 'title': 'Synthetic assignment'}],
             'ksbCodesByMonth': {month: ['K1','S1']}}], 'monthlyOtjh': {month: {'planned':50,'actual':10}}, 'otjh': {'actual': 120}},
           'hours': {'learner': {'planned_end_date': '2026-12-31'}, 'training_plan_totals': {'actual': 120},
                     'months': [{'month':month,'actual_hours':10,'not_accepted_hours':0,'training_plan_target':50}]}, **deepcopy(focus)}
    compact = project_month(month, 50, 10, activities, reviews, lectures)
    size = lambda obj: len(json.dumps(obj, ensure_ascii=True).encode('utf-8'))
    before, after = size(old), size(compact)
    return {'fixture': '52 scheduled weeks, 12 source months, one selected-month assignment/review/lecture; synthetic uncompressed JSON',
            'oldBytes':before,'newBytes':after,'reductionPercent':round((1-after/before)*100,2)}
