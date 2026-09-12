"""Offline attendance regression tests; no database creation or mutation."""
from contextlib import nullcontext
import inspect
import json
from datetime import date, datetime, timedelta, timezone as datetime_timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core import signing
from django.test import SimpleTestCase, RequestFactory
from django.urls import resolve
from django.utils import timezone

from .attendance_lectures import (
    _component_for, build_lectures, lecture_register, lecture_totals,
    read_legacy_metadata, report_id, session_key,
    read_native_occurrences, read_native_components, ATTENDANCE_SOURCE_FIELDS,
)
from .attendance_mode import _payload, _manager, MAX_AGE, SALT, review_attendance_mode
from .absence_reports import _fetch_missed_sessions, _resolve_absent_attendance, learner_absence_reports
from .management.commands.send_attendance_reminders import reminder_candidates


def register_row(**overrides):
    return {'session_id': '92_2026-09-01_business', 'learner_id': 12,
            'learner_name': 'Learner', 'learner_email': 'learner@example.test',
            'source': 'kbc-attendance', 'session_title': 'Business introduction',
            'module_title': 'Business', 'session_date': date(2026, 9, 1),
            'session_start_time': None, 'session_end_time': None,
            'attendance_status': 'absent', 'minutes_late': 0,
            'catchup_completed': False, 'updated_at': None, **overrides}


class AttendanceLectureTests(SimpleTestCase):
    def test_monthly_log_link_uses_exact_source_key_and_saved_report_month(self):
        row = register_row()
        result = build_lectures([row], {row['session_id']: {'log_month': '2026-08'}}, [], [], 'commercial', 12)[0]
        self.assertEqual(result['monthlyLog'], {'month': '2026-08', 'sourceRef': f"att:{row['session_id']}"})
        self.assertEqual(result['date'], '2026-09-01')

    def test_native_monthly_log_link_uses_occurrence_and_stored_month(self):
        row = register_row(source='microsoft-teams', session_id='occ-8', module_catalogue_id=3,
                           scheduled_start=datetime(2026, 8, 31, 23, 30, tzinfo=datetime_timezone.utc))
        result = build_lectures([row], {}, [], [], 'commercial', 12)[0]
        self.assertEqual(result['monthlyLog'], {'month': '2026-08', 'sourceRef': 'attendance:occ-8'})
        self.assertEqual(result['date'], '2026-09-01')

    def test_native_timestamp_columns_are_interpreted_as_utc(self):
        source = SimpleNamespace(id=12, username='Learner', email='learner@example.test')
        conn = MagicMock()
        raw = {'scheduled_start': datetime(2026, 9, 1, 23, 30), 'scheduled_end': datetime(2026, 9, 2, 0, 30),
               'updated_at': datetime(2026, 9, 1, 12), 'module_title': 'Business', 'session_number': 1}
        with patch('learner_api.attendance_lectures.connections', {'enrolment': conn}), \
             patch('learner_api.attendance_lectures.dict_rows', return_value=[raw]), \
             timezone.override('Europe/London'):
            result = read_native_occurrences(source)[0]
        self.assertEqual(result['session_date'], date(2026, 9, 2))
        self.assertEqual(result['session_start_time'].strftime('%H:%M'), '00:30')
        self.assertEqual(result['scheduled_start'].tzinfo, datetime_timezone.utc)

    def test_exact_audit_key_and_learner_owned_activity_completion(self):
        row = register_row()
        activity = {'group_id': 20, 'group_name': 'Business', 'activity_id': 4,
                    'activity_date': date(2026, 9, 1), 'title': 'Recording',
                    'activity_type': 'video', 'video_completed': True}
        metadata = {row['session_id']: {'ksbs': [{'code': 'K1'}, {'code': 'S2'}], 'activity_hours': 2}}
        result = build_lectures([row], metadata, [activity], [], 'apprenticeship', 12)[0]
        self.assertEqual(result['ksbs'], ['K1', 'S2'])
        self.assertEqual(result['durationMinutes'], 120)
        self.assertEqual(result['status'], 'absent')
        self.assertEqual(result['catchupStatus'], 'completed')
        self.assertEqual(result['activities'][0]['activityId'], 4)
        totals = lecture_totals([result])
        self.assertEqual((totals['attended'], totals['absent'], totals['covered'], totals['attendanceRate']), (0, 1, 1, 0))

    def test_source_edits_are_reflected_and_missing_data_is_not_invented(self):
        row = register_row()
        first = build_lectures([row], {}, [], [], 'apprenticeship', 12)[0]
        self.assertEqual(first['ksbs'], [])
        self.assertIsNone(first['durationMinutes'])
        self.assertEqual(first['catchupStatus'], 'pending')
        second = build_lectures([{**row, 'attendance_status': 'present'}],
                                {row['session_id']: {'ksbs': ['K3']}}, [], [], 'apprenticeship', 12)[0]
        self.assertEqual(second['ksbs'], ['K3'])
        self.assertEqual(second['status'], 'completed')
        self.assertIsNone(second['catchupStatus'])

    def test_upcoming_unsynced_and_late_have_separate_counting_rules(self):
        lectures = build_lectures([register_row(attendance_status=status) for status in
                                  ('present', 'late', 'absent', 'upcoming', 'pending', 'in_progress')],
                                 {}, [], [], 'apprenticeship', 12)
        totals = lecture_totals(lectures)
        self.assertEqual(totals, {'total': 6, 'attended': 2, 'absent': 1, 'covered': 0,
                                  'upcoming': 1, 'attendanceRate': 67})
        self.assertIsNone(lecture_totals([lectures[-1]])['attendanceRate'])

    def test_native_ids_are_per_learner_and_distinct_from_legacy(self):
        native = register_row(source='microsoft-teams', session_id='occ-1')
        self.assertEqual(session_key(native), 'teams:occ-1')
        self.assertNotEqual(report_id(native), report_id({**native, 'learner_id': 99}))
        self.assertNotEqual(report_id(native), report_id({**native, 'source': 'kbc-attendance'}))
        self.assertEqual(report_id(native), report_id(dict(native)))

    def test_same_date_other_module_does_not_link_activities(self):
        activity = {'group_id': 30, 'group_name': 'Other module', 'activity_id': 4,
                    'activity_date': date(2026, 9, 1), 'title': 'Recording',
                    'activity_type': 'video', 'video_completed': True}
        result = build_lectures([register_row()], {}, [activity], [], 'apprenticeship', 12)[0]
        self.assertEqual(result['activities'], [])
        self.assertEqual(result['catchupStatus'], 'pending')

    def test_legacy_material_ksbs_resolve_module_spelling_and_stay_lecture_scoped(self):
        row = register_row(module_title='Procurement Risk and Contract Management')
        activity = {'group_id': 20, 'group_name': 'Level 7 Procurement Risk, and Contract Management',
                    'activity_id': 4, 'title': 'Recording', 'activity_date': row['session_date'],
                    'activity_type': 'video', 'ksbs': ['K1', 'S2']}
        other_day = {**activity, 'activity_id': 5, 'activity_date': date(2026, 8, 1), 'ksbs': ['K99']}
        lectures = lambda meta: build_lectures([row], meta, [activity, other_day], [], 'commercial', 12)
        result = lectures({})[0]
        self.assertEqual(result['ksbs'], ['K1', 'S2'])
        self.assertEqual(result['ksbScope'], 'activities')
        self.assertEqual([a['activityId'] for a in result['activities']], [4])
        activity['ksbs'] = ['K7']
        self.assertEqual(lectures({})[0]['ksbs'], ['K7'])
        for saved in (['S6'], []):
            with self.subTest(saved=saved):
                self.assertEqual(lectures({row['session_id']: {'ksbs': saved}})[0]['ksbs'], saved)

    def test_module_ksb_fallback_is_labelled_and_does_not_complete_catchup(self):
        row = register_row(module_title='Ray-Project Management Office (PMO)')
        activity = {'group_id': 20, 'group_name': 'Ray -Project Management Office (PMO)',
                    'activity_id': 4, 'title': 'Recording', 'activity_date': date(2026, 8, 1),
                    'activity_type': 'video', 'ksbs': ['S27'], 'video_completed': True}
        result = build_lectures([row], {}, [activity], [], 'commercial', 12)[0]
        self.assertEqual(result['ksbs'], ['S27'])
        self.assertEqual(result['ksbScope'], 'module')
        self.assertEqual(result['activities'], [])
        self.assertEqual(result['catchupStatus'], 'pending')

    def test_ambiguous_legacy_groups_do_not_share_ksbs(self):
        row = register_row(module_title='Procurement')
        activity = {'group_id': 20, 'group_name': 'Level 7 Procurement', 'activity_id': 4,
                    'title': 'Recording', 'activity_date': row['session_date'], 'ksbs': ['K1']}
        other = {**activity, 'group_id': 21, 'group_name': 'Level 6 Procurement', 'ksbs': ['K2']}
        result = build_lectures([row], {}, [activity, other], [], 'commercial', 12)[0]
        self.assertEqual(result['ksbs'], [])
        self.assertEqual(result['activities'], [])

    def test_native_ksbs_fall_back_to_linked_week_then_assigned_module(self):
        row = register_row(source='microsoft-teams', session_id='occ-2', module_catalogue_id='m', live_session_id='live')
        component = {'id': 'c1', 'type': 'live_session', 'module_catalogue_id': 'm', 'week_id': 'w2',
                     'title': 'Live', 'description': '', 'completed': False,
                     'settings': {'teamsOccurrenceId': 'occ-2'}, 'ksb_mappings': []}
        activity = {**component, 'id': 'c2', 'type': 'video', 'ksb_mappings': ['K3']}
        other_week = {**activity, 'id': 'c3', 'week_id': 'w3', 'ksb_mappings': ['S4']}
        unrelated = {**activity, 'id': 'c4', 'module_catalogue_id': 'other', 'ksb_mappings': ['K99']}
        result = build_lectures([row], {}, [], [component, activity, other_week, unrelated], 'commercial', 12)[0]
        self.assertEqual((result['ksbs'], result['ksbScope']), (['K3'], 'activities'))
        result = build_lectures([row], {}, [], [activity, other_week, unrelated], 'commercial', 12)[0]
        self.assertEqual((result['ksbs'], result['ksbScope']), (['K3', 'S4'], 'module'))
        self.assertEqual(result['activities'], [])
        result = build_lectures([row], {}, [], [{**component, 'week_id': None}, {**activity, 'week_id': None}], 'commercial', 12)[0]
        self.assertEqual((result['ksbs'], result['ksbScope']), (['K3'], 'module'))
        self.assertEqual([a['id'] for a in result['activities']], ['c1'])

    def test_native_recurrence_matches_occurrence_not_just_meeting(self):
        row = register_row(source='microsoft-teams', session_id='occ-2', module_catalogue_id='m', live_session_id='live')
        first = {'id': 'c1', 'type': 'live_session', 'module_catalogue_id': 'm',
                 'settings': {'teamsLiveSessionId': 'live', 'teamsOccurrenceId': 'occ-1'}}
        second = {**first, 'id': 'c2', 'settings': {'teamsLiveSessionId': 'live', 'teamsOccurrenceId': 'occ-2'}}
        self.assertIs(_component_for(row, [first, second]), second)
        self.assertIsNone(_component_for(row, [first]))
        self.assertIsNone(_component_for(row, [second, dict(second)]))

    @patch('learner_api.attendance_lectures.read_native_occurrences')
    @patch('learner_api.attendance_lectures.combined_attendance_rows')
    def test_native_schedule_deduplicates_reports_and_excludes_cancelled(self, combined, scheduled):
        now = timezone.now()
        ended = register_row(source='microsoft-teams', session_id='occ-1',
                             scheduled_start=now-timedelta(hours=2), scheduled_end=now-timedelta(hours=1))
        scheduled.return_value = [{**ended, 'attendance_status': 'pending'}]
        combined.return_value = [ended, {**ended, 'session_id': 'cancelled'}]
        source = SimpleNamespace(id=12)
        result = lecture_register(source)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['attendance_status'], 'absent')

    @patch('learner_api.attendance_lectures.read_native_occurrences')
    @patch('learner_api.attendance_lectures.combined_attendance_rows')
    def test_future_zero_attendance_is_upcoming(self, combined, scheduled):
        scheduled.return_value = []
        combined.return_value = [register_row(session_date=timezone.localdate()+timedelta(days=1))]
        self.assertEqual(lecture_register(SimpleNamespace(id=12))[0]['attendance_status'], 'upcoming')

    def test_legacy_query_is_aptem_scoped_and_uses_exact_source_reference(self):
        cur = MagicMock()
        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        with patch('learner_api.attendance_lectures.connections', {'enrolment': conn}), \
             patch('learner_api.attendance_lectures.dict_rows', side_effect=[[], [{'group_id': 20, 'group_name': 'Business'}], []]):
            read_legacy_metadata(SimpleNamespace(aptem_id='92', id=12), [register_row()])
        first_sql, first_params = cur.execute.call_args_list[0].args
        self.assertIn("r.source_ref='att:' || la.source_key", first_sql)
        self.assertIn('r.month AS log_month', first_sql)
        self.assertEqual(first_params, [92, ['92_2026-09-01_business']])
        self.assertEqual(cur.execute.call_args_list[1].args[1], [92])
        self.assertEqual(cur.execute.call_args_list[2].args[1], [12, 92, [20]])

    def test_historical_only_register_skips_curriculum_but_keeps_recent_progress(self):
        progress = [{'componentId': 'c', 'componentTitle': 'Recent reading', 'submittedAt': '2026-09-01'}]
        with patch('learner_api.attendance_lectures.connections') as databases, \
             patch('learner_api.attendance_lectures._direct_progress_records', return_value=progress):
            self.assertEqual(read_native_components(SimpleNamespace(id=12), set()), ([], progress))
        databases.__getitem__.assert_not_called()

    def test_native_only_register_does_not_load_historical_materials(self):
        with patch('learner_api.attendance_lectures.connections') as databases:
            self.assertEqual(read_legacy_metadata(SimpleNamespace(aptem_id=92), [register_row(source='microsoft-teams')]), ({}, []))
        databases.__getitem__.assert_not_called()

    def test_native_activity_query_intersects_invited_and_assigned_modules(self):
        conn = MagicMock()
        cur = conn.cursor.return_value.__enter__.return_value
        cur.fetchall.return_value = [('assigned',), ('unrelated',)]
        with patch('learner_api.attendance_lectures.connections', {'enrolment': conn}), \
             patch('learner_api.attendance_lectures.dict_rows', return_value=[]), \
             patch('learner_api.attendance_lectures._direct_progress_records', return_value=[]):
            read_native_components(SimpleNamespace(id=12), {'assigned', 'not-assigned'})
        self.assertEqual(cur.execute.call_args.args[1], [['assigned']])

    def test_ambiguous_groups_skip_materials_without_choosing_another_course(self):
        conn = MagicMock()
        groups = [{'group_id': 20, 'group_name': 'Level 7 Procurement'}, {'group_id': 21, 'group_name': 'Level 6 Procurement'}]
        with patch('learner_api.attendance_lectures.connections', {'enrolment': conn}), \
             patch('learner_api.attendance_lectures.dict_rows', side_effect=[[], groups]):
            self.assertEqual(read_legacy_metadata(SimpleNamespace(aptem_id=92, id=12), [register_row(module_title='Procurement')]), ({}, []))
        self.assertEqual(conn.cursor.return_value.__enter__.return_value.execute.call_count, 2)

    def test_lecture_group_filter_keeps_exact_audit_group_and_ignores_other_courses(self):
        row = register_row(module_title='Renamed course')
        metadata = {'source_key': row['session_id'], 'group_id': 21}
        groups = [{'group_id': 20, 'group_name': 'Unrelated'}, {'group_id': 21, 'group_name': 'Old course title'}]
        conn = MagicMock()
        with patch('learner_api.attendance_lectures.connections', {'enrolment': conn}), \
             patch('learner_api.attendance_lectures.dict_rows', side_effect=[[metadata], groups, []]):
            read_legacy_metadata(SimpleNamespace(aptem_id=92, id=12), [row])
        self.assertEqual(conn.cursor.return_value.__enter__.return_value.execute.call_args.args[1], [12, 92, [21]])

    def test_module_resolution_is_shared_but_lecture_dates_keep_their_own_activities(self):
        from . import attendance_lectures as views
        first, second = register_row(), register_row(session_id='second', session_date=date(2026, 9, 8))
        activities = [{'group_id': 20, 'group_name': 'Business', 'activity_id': index, 'title': 'Recording',
                       'activity_date': row['session_date'], 'activity_type': 'video', 'video_completed': index == 1}
                      for index, row in enumerate([first, second], 1)]
        with patch.object(views, '_legacy_module_activities', wraps=views._legacy_module_activities) as resolve_module:
            result = build_lectures([first, second], {}, activities, [], 'commercial', 12)
        resolve_module.assert_called_once()
        self.assertEqual([lecture['activities'][0]['activityId'] for lecture in result], [1, 2])
        self.assertEqual([lecture['catchupStatus'] for lecture in result], ['completed', 'pending'])


class AttendanceAbsenceTests(SimpleTestCase):
    def test_reason_only_report_saves_without_optional_evidence(self):
        request = RequestFactory().post('/', {'sessionId': 'teams:future', 'sessionTitle': 'Lecture',
                                             'sessionDate': '2026-10-01', 'reasonCategory': 'illness'})
        source = SimpleNamespace(id=12, username='Learner', email='learner@example.test')
        with patch('learner_api.absence_reports._source_learner', return_value=source), \
             patch('learner_api.absence_reports._resolve_absent_attendance', return_value=8000000000000000001), \
             patch('learner_api.absence_reports.CoachAbsenceReport.objects') as manager, \
             patch('learner_api.absence_reports.learner_profile_for_source', return_value=None), \
             patch('learner_api.absence_reports.transaction.atomic', return_value=nullcontext()), \
             patch('learner_api.absence_reports._serialize', return_value={'id': 1}):
            manager.filter.return_value.exists.return_value = False
            manager.filter.return_value.count.return_value = 0
            response = inspect.unwrap(learner_absence_reports)(request, 'apprenticeship', 12)
        self.assertEqual(response.status_code, 201)
        self.assertFalse(manager.create.call_args.kwargs['evidence_provided'])
        self.assertEqual(manager.create.call_args.kwargs['evidence_kind'], 'none')

    def test_duplicate_report_is_rejected_before_writing(self):
        request = RequestFactory().post('/', {'sessionId': 'same', 'sessionTitle': 'Lecture',
                                             'sessionDate': '2026-09-01', 'reasonCategory': 'illness'})
        source = SimpleNamespace(id=12, username='Learner', email='learner@example.test')
        with patch('learner_api.absence_reports._source_learner', return_value=source), \
             patch('learner_api.absence_reports._resolve_absent_attendance', return_value=123), \
             patch('learner_api.absence_reports.CoachAbsenceReport.objects') as manager:
            manager.filter.return_value.exists.return_value = True
            response = inspect.unwrap(learner_absence_reports)(request, 'apprenticeship', 12)
        self.assertEqual(response.status_code, 409)
        manager.create.assert_not_called()

    @patch('learner_api.absence_reports.lecture_register')
    def test_new_and_old_reportable_sessions_use_source_ids(self, read):
        read.return_value = [register_row(), register_row(source='microsoft-teams', session_id='upcoming', attendance_status='upcoming'),
                             register_row(session_id='present', attendance_status='present'), register_row(attendance_status='pending')]
        source = SimpleNamespace(id=12)
        result = _fetch_missed_sessions(source, 12)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[1]['sessionId'], 'teams:upcoming')
        self.assertIsNotNone(_resolve_absent_attendance(source, 12, 'teams:upcoming', 'Business introduction', date(2026, 9, 1), None))
        self.assertIsNone(_resolve_absent_attendance(source, 12, 'present', 'Business introduction', date(2026, 9, 1), None))
        self.assertIsNone(_resolve_absent_attendance(source, 12, 'teams:other', 'Business introduction', date(2026, 9, 1), None))


class AttendanceLearnerLookupTests(SimpleTestCase):
    """Merged learner IDs work with either nominal kind in a saved URL."""

    def setUp(self):
        self.source = SimpleNamespace(id=12, learner_type='commercial')
        self.model = MagicMock()
        self.model.objects.filter.return_value.first.return_value = None
        self.model.all_learners.filter.return_value.first.return_value = self.source
        self.model.all_learners.filter.return_value.only.return_value.first.return_value = self.source
        self.models = {kind: self.model for kind in ('commercial', 'apprenticeship')}
        self.account = SimpleNamespace(role='learner', subject_id=12)

    def test_lecture_route_reads_commercial_learner_for_either_kind(self):
        with patch('learner_api.attendance_lectures.SOURCE_MODELS', self.models), \
             patch('learner_api.attendance_lectures.read_workspace', return_value={'lectures': []}) as read, \
             patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch('login.permissions.authenticate_request', return_value=self.account):
            for kind in self.models:
                with self.subTest(kind=kind):
                    path = f'/learner_api/attendance/{kind}/12/lectures/'
                    match = resolve(path)
                    response = match.func(RequestFactory().get(path), **match.kwargs)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(json.loads(response.content), {'lectures': []})
                    read.assert_called_with(self.source, kind)
                    self.model.all_learners.filter.return_value.only.assert_called_with(*ATTENDANCE_SOURCE_FIELDS)

    def test_mode_route_reads_commercial_learner_for_either_kind(self):
        with patch('learner_api.attendance_mode.SOURCE_MODELS', self.models), \
             patch('learner_api.attendance_mode.read_mode', return_value={'mode': 'live'}) as read, \
             patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch('login.permissions.authenticate_request', return_value=self.account):
            for kind in self.models:
                with self.subTest(kind=kind):
                    path = f'/learner_api/attendance/{kind}/12/mode/'
                    match = resolve(path)
                    response = match.func(RequestFactory().get(path), **match.kwargs)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(json.loads(response.content), {'mode': 'live'})
                    read.assert_called_with(self.source, kind)

    def test_another_learners_routes_are_rejected_before_lookup(self):
        with patch('learner_api.attendance_lectures.SOURCE_MODELS', self.models), \
             patch('learner_api.attendance_mode.SOURCE_MODELS', self.models), \
             patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch('login.permissions.authenticate_request', return_value=self.account):
            for endpoint in ('lectures', 'mode'):
                path = f'/learner_api/attendance/commercial/99/{endpoint}/'
                match = resolve(path)
                response = match.func(RequestFactory().get(path), **match.kwargs)
                self.assertEqual(response.status_code, 404)
            self.model.all_learners.filter.assert_not_called()

    def test_absence_lookup_accepts_either_nominal_kind(self):
        from .absence_reports import _source_learner
        with patch('learner_api.absence_reports.EnrolmentUser', self.model), \
             patch('learner_api.absence_reports.CommercialUser', self.model):
            for kind in self.models:
                self.assertIs(_source_learner(kind, 12), self.source)
            self.assertIsNone(_source_learner('unknown', 12))


class AttendanceModeTests(SimpleTestCase):
    def test_manager_review_post_requires_csrf(self):
        with patch('learner_api.attendance_mode._state') as state:
            response = review_attendance_mode(RequestFactory().post('/', {'token': 'anything', 'decision': 'approve'}))
        self.assertEqual(response.status_code, 403)
        state.assert_not_called()

    def test_only_the_signed_review_path_is_public(self):
        from login.api_gate import rule_for
        self.assertIsNone(rule_for('/learner_api/attendance-mode/review/'))
        self.assertIsNotNone(rule_for('/learner_api/attendance/apprenticeship/12/mode/'))
        self.assertIsNotNone(rule_for('/learner_api/attendance/apprenticeship/12/lectures/'))
        self.assertIsNotNone(rule_for('/learner_api/attendance-mode/review/extra/'))

    def test_approval_preview_does_not_write_and_consumed_tokens_cannot_replay(self):
        source = SimpleNamespace(id=12, username='Learner', email='learner@example.test')
        model = MagicMock()
        model.all_learners.filter.return_value.first.return_value = source
        conn = MagicMock()
        cur = conn.cursor.return_value.__enter__.return_value
        state = {'request_id': 'request-one', 'status': 'pending', 'manager_email': 'manager@example.test'}
        token = signing.dumps({'learner': 12, 'kind': 'apprenticeship', 'request': 'request-one'}, salt=SALT)
        with patch('learner_api.attendance_mode.SOURCE_MODELS', {'apprenticeship': model}), \
             patch('learner_api.attendance_mode.connections', {'enrolment': conn}), \
             patch('learner_api.attendance_mode.transaction.atomic', return_value=nullcontext()), \
             patch('learner_api.attendance_mode._state', return_value=state), \
             patch('learner_api.attendance_mode._manager', return_value='manager@example.test'):
            response = review_attendance_mode(RequestFactory().get('/', {'token': token}))
            self.assertEqual(response.status_code, 200)
            cur.execute.assert_not_called()
            post = RequestFactory().post('/', {'token': token, 'decision': 'approve'})
            post._dont_enforce_csrf_checks = True
            response = review_attendance_mode(post)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(cur.execute.call_args.args[1], ['lazy', 'approved', 12])
            self.assertIn('request_id=NULL', cur.execute.call_args.args[0])
            state.update(status='approved', request_id=None)
            cur.reset_mock()
            response = review_attendance_mode(post)
            self.assertEqual(response.status_code, 400)
            cur.execute.assert_not_called()

    def test_unsigned_and_expired_approval_tokens_do_not_read_or_write_data(self):
        with patch('learner_api.attendance_mode._state') as state:
            response = review_attendance_mode(RequestFactory().get('/', {'token': 'invalid'}))
            self.assertEqual(response.status_code, 400)
            state.assert_not_called()
            with patch('django.core.signing.time.time', return_value=0):
                token = signing.dumps({'learner': 12, 'kind': 'apprenticeship', 'request': 'old'}, salt=SALT)
            response = review_attendance_mode(RequestFactory().get('/', {'token': token}))
            self.assertEqual(response.status_code, 400)
            state.assert_not_called()

    def test_pending_pauses_reminders_but_keeps_live_allocation_until_approval(self):
        payload = _payload({'mode': 'live', 'requested_mode': 'lazy', 'status': 'pending', 'updated_at': timezone.now()})
        self.assertFalse(payload['remindersEnabled'])
        self.assertEqual(payload['mode'], 'live')
        self.assertEqual(payload['requestedMode'], 'lazy')

    def test_expired_requests_resume_live_reminders_and_can_be_requested_again(self):
        payload = _payload({'mode': 'live', 'requested_mode': 'lazy', 'status': 'pending',
                            'updated_at': timezone.now()-timedelta(seconds=MAX_AGE+1)})
        self.assertTrue(payload['remindersEnabled'])
        self.assertIsNone(payload['requestedMode'])
        self.assertEqual(payload['status'], 'expired')

    def test_approved_mode_pauses_and_declined_live_mode_resumes(self):
        self.assertFalse(_payload({'mode': 'lazy', 'status': 'approved'})['remindersEnabled'])
        self.assertTrue(_payload({'mode': 'live', 'status': 'declined'})['remindersEnabled'])

    @patch('learner_api.attendance_mode._extended_ilr_answers')
    def test_manager_cannot_be_the_requesting_learner(self, answers):
        source = SimpleNamespace(id=12, employer_id=None, email='learner@example.test')
        answers.return_value = {'employer': {'lineManagerEmail': ' Learner@example.test '}}
        self.assertEqual(_manager(source), '')
        answers.return_value = {'employer': {'lineManagerEmail': 'manager@example.test'}}
        self.assertEqual(_manager(source), 'manager@example.test')

    def test_reminders_skip_reported_covered_future_and_old_absences(self):
        today = date(2026, 9, 12)
        row = {'id': 'a', 'status': 'absent', 'catchupStatus': 'pending', 'absenceReport': None, 'date': '2026-09-11'}
        lectures = [row, {**row, 'absenceReport': {'id': 1}}, {**row, 'catchupStatus': 'completed'},
                    {**row, 'date': '2026-01-01'}, {**row, 'date': '2026-09-13'}, {**row, 'status': 'upcoming'}]
        self.assertEqual(reminder_candidates(lectures, {'remindersEnabled': True}, today), [row])
        self.assertEqual(reminder_candidates(lectures, {'remindersEnabled': False}, today), [])
