"""Dashboard regression tests: canonical reads mocked; database access forbidden."""
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase
from . import dashboard_weekly as weekly, training_plan_dashboard as schedule, learner_detail


class DashboardWeeklyTests(SimpleTestCase):
    def test_selected_quiz_metadata_and_question_availability_are_reused(self):
        component = ('Q1', 'W1', 'M1', 'quiz', 'Quiz', '', {}, None, 0, None, False, None, False)
        baseline_cursor = MagicMock()
        baseline_cursor.fetchall.side_effect = [[('M1', 'Module')], [('W1', 'M1', 'Week 1', 1, 0)],
                                               [component], [('Q1', 9)], [(9, 'Quiz', 4, 10, 'mins')], []]
        baseline_connection = MagicMock()
        baseline_connection.cursor.return_value.__enter__.return_value = baseline_cursor
        with patch.object(learner_detail, 'connections', {'enrolment': baseline_connection}):
            _, _, baseline = learner_detail._resolve_from_master([], [], [], assigned_modules=[{'moduleId': 'M1'}],
                compact=True, strict=True, live_session_ids=False, week_ids=['W1'])
        self.assertEqual(baseline_cursor.execute.call_count, 6)
        cursor = MagicMock()
        cursor.fetchall.return_value = [component]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        metadata = {'module_titles': {'M1': 'Module'}, 'weeks': [('W1', 'M1', 'Week 1', 1, 0)],
                    'quiz_links': {'Q1': 9}, 'quiz_meta': {9: {'quizId': 9, 'title': 'Quiz', 'questions': 4, 'duration': 10, 'timeUnit': 'mins'}}}
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            _, _, components = learner_detail._resolve_from_master([], [], [], assigned_modules=[{'moduleId': 'M1'}],
                compact=True, strict=True, live_session_ids=False, week_ids=['W1'], resolved_metadata=metadata, routing_only=True)
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertTrue(weekly._weekly_component(components[0])['contentAvailable'])
        self.assertEqual(components[0]['quizMeta']['quizId'], 9)
        self.assertEqual(weekly._weekly_component(components[0]), weekly._weekly_component(baseline[0]))

    def test_request_metadata_reuses_module_week_and_ksb_reads_for_routing(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[('C1', 'W1', 'M1', 'reflection', 'Reflect', '', {}, None, 0, None, False, None, False)], []]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        metadata = {'module_titles': {'M1': 'Module'}, 'weeks': [('W1', 'M1', 'Week 1', 1, 0)]}
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            _, _, components = learner_detail._resolve_from_master([], [], [], assigned_modules=[{'moduleId': 'M1'}],
                compact=True, strict=True, live_session_ids=False, week_ids=['W1'], resolved_metadata=metadata, routing_only=True)
        self.assertEqual(components[0]['componentId'], 'C1')
        self.assertEqual(cursor.execute.call_count, 2)
        self.assertTrue(cursor.execute.call_args_list[0].args[0].startswith('SELECT id, week_id,'))
        self.assertTrue(cursor.execute.call_args_list[1].args[0].startswith('SELECT link.component_id,'))

    def test_student_delegates_to_canonical_reader_and_sends_only_required_contract(self):
        source = SimpleNamespace(pk=265)
        profile = SimpleNamespace(pk=17, enrolment_id=265)
        payload = {'weeks': [], 'selectedWeek': None}
        with patch.object(weekly.canonical_learning, 'require_profile', return_value={'id': 17}), \
             patch.object(weekly, 'learner_profile_for_source', return_value=profile) as identity, \
             patch.object(weekly, 'read_weekly_learning', return_value=payload) as read:
            result = weekly.read_dashboard_weekly(source, 265, module_id='M1')
        self.assertIs(result, payload)
        self.assertEqual(set(result), {'weeks', 'selectedWeek'})
        self.assertEqual(read.call_args.kwargs, {'module_id': 'M1', 'include_weeks': True, 'include_actions': True})
        self.assertIs(read.call_args.args[0].profile, profile)
        identity.assert_called_once_with(source, 265, heal=False, fields=('id', 'enrolment_id'))

    def test_week_detail_omits_rail_and_preserves_delivery_slot_identity(self):
        navigation = {'id': 'M1:2', 'moduleId': 'M1', 'kind': 'live-session', 'slotNumber': 2}
        selected = {'weekId': 'M1:2', 'activities': [], 'summary': {}, 'liveSession': None}
        source = SimpleNamespace(pk=265)
        with patch.object(weekly.canonical_learning, 'require_profile', return_value={'id': 17}), \
             patch.object(weekly, 'learner_profile_for_source', return_value=SimpleNamespace(pk=17, enrolment_id=265)), \
             patch.object(weekly, 'read_weekly_learning', return_value={'modules': [], 'weeks': [navigation], 'selectedWeek': selected}) as read:
            result = weekly.read_dashboard_weekly(source, 265, module_id='M1', week_id='slot:M1:2')
        self.assertEqual(result, {'modules': [], 'weeks': [navigation], 'selectedWeek': selected})
        self.assertEqual(read.call_args.args[1], 'M1:2')
        self.assertFalse(read.call_args.kwargs['include_weeks'])

    def test_routing_loads_only_selected_week_without_progress_or_unrelated_quizzes(self):
        navigation = {'id': 'M1:1', 'moduleId': 'M1', 'weekId': 'W1', 'kind': 'live-session', 'slotNumber': 1}
        selected = {'weekId': 'M1:1', 'activities': [{'id': 'C1', 'status': 'not-started', 'expectedHours': 2}], 'summary': {}, 'liveSession': None}
        source = SimpleNamespace(pk=265, programme='P')
        with patch.object(weekly.canonical_learning, 'require_profile', return_value={'id': 17}), \
             patch.object(weekly, 'learner_profile_for_source', return_value=SimpleNamespace(pk=17, enrolment_id=265)), \
             patch.object(weekly, 'read_weekly_learning', return_value={'modules': [], 'weeks': [navigation], 'selectedWeek': selected}), \
             patch.object(weekly, '_resolve_from_master', return_value=([], [], [{'componentId': 'C1', 'type': 'reflection'}])) as routing, \
             patch.object(weekly, '_apply_programme_assignment_template', side_effect=lambda rows, programme: rows):
            result = weekly.read_dashboard_weekly(source, 265, module_id='M1', week_id='slot:M1:1')
        self.assertEqual(routing.call_args.kwargs['week_ids'], ['W1'])
        self.assertEqual(routing.call_args.kwargs['assigned_modules'], [{'moduleId': 'M1'}])
        self.assertEqual(result['selectedWeek']['activities'][0]['expectedHours'], 2)
        self.assertTrue(result['selectedWeek']['activities'][0]['contentAvailable'])
        self.assertNotIn('components', result)

    def test_repeated_authored_week_slots_have_distinct_request_ids(self):
        slots = [{'slotNumber': n, 'weekId': 'W1', 'type': 'live-session'} for n in (1, 2)]
        self.assertEqual([weekly.slot_id('M1', slot) for slot in slots], ['slot:M1:1', 'slot:M1:2'])

    def test_invalid_module_or_slot_fails_closed(self):
        with patch.object(weekly.canonical_learning, 'require_profile', return_value={'id': 17}), \
             patch.object(weekly, 'learner_profile_for_source', return_value=SimpleNamespace(pk=17, enrolment_id=265)), \
             patch.object(weekly, 'read_weekly_learning', side_effect=LookupError('missing')) as read:
            for wid, mid in [('slot:M1:1', 'M2'), ('invalid', 'M1'), ('slot:M1:1', 'M1')]:
                with self.assertRaises(weekly.ServiceError) as error:
                    weekly.read_dashboard_weekly(SimpleNamespace(pk=265), 265, module_id=mid, week_id=wid)
                self.assertEqual(error.exception.status, 404)
        self.assertEqual(read.call_count, 1)

    def test_selected_week_sql_is_scoped_and_does_not_select_description_bodies(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[('M1', 'Module')], [('W1', 'M1', 'Week 1', 1, 0), ('W2', 'M1', 'Week 2', 2, 1)], []]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            learner_detail._resolve_from_master([], [], [], assigned_modules=[{'moduleId': 'M1'}],
                compact=True, expected_otjh=True, live_session_ids=False, strict=True, week_ids=['W1'])
        sql, parameters = cursor.execute.call_args_list[2].args
        self.assertIn('AND week_id = ANY(%s)', sql)
        self.assertEqual(parameters, [['M1'], ['W1']])
        self.assertIn("THEN 'content' ELSE '' END AS description", sql)
        self.assertNotIn('title, description,', sql)
        self.assertNotIn("settings_json::jsonb - 'lessonContent'", sql)
        self.assertNotIn("'componentFiles'", sql)

    def test_duplicate_week_labels_keep_native_quiz_membership(self):
        weeks = [{'module': 'Module', 'moduleId': 'M1', 'week': 'Same title', 'weekId': wid} for wid in ('W1', 'W2')]
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[('M1', 'Module', 'P', 'Programme')],
            [(9, 'W1', 'Quiz', 4, 10, 'mins', 'P', 'Programme', 'Module')], [], [],
            []]  # Independent quiz: no authored component or revision.
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            result_weeks, components = learner_detail._append_week_quizzes(weeks, [],
                assigned_modules=[{'moduleId': 'M1'}], strict=True, native_week_ids=True)
        self.assertEqual([row['weekId'] for row in components], ['W1'])
        self.assertEqual(result_weeks, weeks)
        self.assertEqual(cursor.execute.call_args_list[1].args[1], [['W1', 'W2']])

    def test_mismatched_profile_fails_closed_before_delivery_reads(self):
        for profile in (None, SimpleNamespace(pk=18, enrolment_id=265), SimpleNamespace(pk=17, enrolment_id=266)):
            with patch.object(weekly.canonical_learning, 'require_profile', return_value={'id': 17}), \
                 patch.object(weekly, 'learner_profile_for_source', return_value=profile), \
                 patch.object(weekly, 'read_weekly_learning') as read:
                with self.assertRaises(weekly.ServiceError):
                    weekly.read_dashboard_weekly(SimpleNamespace(pk=265), 265)
                read.assert_not_called()

    def test_dashboard_schedule_skips_reviews_coach_targets_and_module_metadata_lookup(self):
        source = SimpleNamespace(pk=265, email='learner@example.test', _canonical_profile={'id': 17},
                                 _case_file_profile=SimpleNamespace(pk=17), _dashboard_module_ids=['M1'])
        module = {'id': 'M1', 'title': 'Teaching', 'start_date': date(2026, 10, 13), 'end_date': date(2026, 10, 27)}
        week = {'id': 'W1', 'module_catalogue_id': 'M1', 'week_number': 1, 'title': 'Week 1',
                'learning_outcomes': [], 'holiday_note_enabled': False, 'holiday_note': '', 'live_session_count': 1}
        def attach(_rows, by_id, _counts, _weeks, **kwargs):
            self.assertEqual(kwargs, {'strict': True})
            by_id['M1']['curriculumSlots'] = [{'slotNumber': 1, 'weekId': 'W1', 'date': '2026-10-13'}]
        with patch.object(schedule, 'connections', {'enrolment': MagicMock()}), \
             patch.object(schedule, 'rows', side_effect=[[module], [week]]), \
             patch.object(schedule, 'attach_curriculum_slots', side_effect=attach), \
             patch.object(schedule, 'plan_sessions', return_value=[{'id': 'S1', 'attended': True}]), \
             patch.object(schedule, 'plan_reviews', side_effect=AssertionError('review read')), \
             patch.object(schedule, 'current_coach', side_effect=AssertionError('coach read')), \
             patch.object(schedule, 'plan_module_ids', side_effect=AssertionError('duplicate membership read')), \
             patch.object(schedule.canonical_learning, 'targets_for', side_effect=AssertionError('target read')), \
             patch.object(schedule.canonical_learning, 'entries_for', return_value=[]):
            result = schedule.read_dashboard(source, section='weekly', dashboard_tab='weekly')
        self.assertEqual(set(result), {'modules', 'sessions', 'moduleActivityHours'})
        self.assertEqual(result['modules'][0]['curriculumSlots'][0]['weekId'], 'W1')
        self.assertEqual(result['sessions'], [{'id': 'S1', 'attended': True}])
        self.assertNotIn('description', result['modules'][0])

    def test_master_and_quiz_database_failures_propagate_only_in_strict_mode(self):
        connection = MagicMock()
        connection.cursor.side_effect = DatabaseError('offline')
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            for reader in (learner_detail._resolve_from_master, learner_detail._append_week_quizzes):
                with self.subTest(reader=reader.__name__):
                    args = ([], [], []) if reader is learner_detail._resolve_from_master else ([], [])
                    with self.assertRaises(DatabaseError):
                        reader(*args, assigned_modules=[{'moduleId': 'M1'}], strict=True)
                    self.assertEqual(reader(*args, assigned_modules=[{'moduleId': 'M1'}]), tuple(args))

    def test_dashboard_endpoint_access_and_failed_read_are_never_empty_success(self):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        cases = [(None, 401), (SimpleNamespace(role='learner', subject_id=266), 404),
                 (SimpleNamespace(role='employer', subject_id=265), 403),
                 (SimpleNamespace(role='learner', subject_id=265), 503),
                 (SimpleNamespace(role='staff', subject_id=9), 503)]
        for kind in ('commercial', 'apprenticeship'):
            for account, expected in cases:
                with self.subTest(kind=kind, status=expected), \
                     patch('login.permissions.authenticate_request', return_value=account), \
                     patch.dict(weekly.SOURCE_MODELS, {kind: model}), \
                     patch.object(weekly, 'read_dashboard_weekly', side_effect=DatabaseError('offline')) as read, \
                     patch.object(weekly, 'assignment_projection', side_effect=lambda query: query):
                    request = RequestFactory().get(f'/learner_api/dashboard/{kind}/265/weekly/')
                    request.login_account = account
                    response = weekly.dashboard_weekly(request, kind=kind, pk=265)
                    self.assertEqual(response.status_code, expected)
                    self.assertNotIn('schedule', json.loads(response.content))
                    if expected != 503:
                        read.assert_not_called()
