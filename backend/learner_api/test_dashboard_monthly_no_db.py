"""Selected-month contracts with synthetic records and forbidden DB access."""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase
from old_otjh.service import ServiceError
from . import dashboard_monthly as monthly


class MonthlyProjectionTests(SimpleTestCase):
    def fixture(self, query='', *, records=None, targets=None, subjects=None, bounds=None, sessions=None, reviews=None, fallback=None, lectures=None):
        from . import dashboard_tabs, attendance_lectures, overview_week
        source = SimpleNamespace(pk=265, id=265, email='synthetic@example.invalid')
        owner = {'id': 17, 'start_date': date(2026, 1, 1), 'end_date': date(2027, 1, 1)}
        spine = {'modules': [{'id': 'M1', 'title': 'Module', 'start_date': '2026-01-01', 'end_date': '2027-01-01', 'tutor_name': 'Tutor', 'coach_name': ''}],
                 'moduleLinks': {}, 'reviews': reviews or [], 'coach': {'name': 'Coach'}}
        subjects = subjects if subjects is not None else [{'id': 'current:M1', 'title': 'Unified title', 'activities': []}]
        cursor = MagicMock()
        with patch.object(monthly.canonical, 'entries_for', return_value=records or []) as entries, \
             patch.object(monthly.canonical, 'targets_for', return_value={'2026-10': 50} if targets is None else targets), \
             patch.object(monthly.canonical, 'query', return_value=[]), \
             patch.object(dashboard_tabs, 'learning_projection', return_value={}), \
             patch.object(monthly, 'display_subjects', return_value=subjects), \
             patch.object(monthly.schedule, 'read_dashboard', return_value=spine) as schedule, \
             patch.object(monthly.schedule, '_plan_session_rows', side_effect=[bounds or [], sessions or []]) as session_rows, \
             patch.object(monthly.schedule, '_plan_session_list', side_effect=lambda rows: rows), \
             patch.object(monthly, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}), \
             patch.object(monthly.timezone, 'localdate', return_value=date(2026, 10, 15)), \
             patch.object(attendance_lectures, 'read_workspace', return_value={'lectures': lectures or []}) as attendance, \
             patch.object(overview_week, 'read_week', return_value=fallback or {}) as week:
            result = monthly.read_monthly(source, 'commercial', owner, object(), RequestFactory().get('/monthly/' + query))
        return result, entries, schedule, session_rows, attendance, week

    def test_exact_payload_and_selected_month_queries_without_week(self):
        result, entries, schedule, rows, attendance, week = self.fixture('?month=2026-10', records=[
            {'reporting_month': '2026-10', 'actual_seconds': 3600, 'accepted': True},
            {'reporting_month': '2026-10', 'actual_seconds': 7200, 'accepted': False},
            {'reporting_month': '2026-09', 'actual_seconds': 10800, 'accepted': True}])
        self.assertEqual(set(result), {'month', 'navigation', 'summary', 'topics', 'contractStatus', 'selectedSubjectId', 'coachName', 'reviews', 'assignments', 'lectures'})
        self.assertEqual(result['summary'], {'requiredHours': 50, 'achievedHours': 1, 'ksbs': []})
        self.assertEqual(result['month'], '2026-10')
        self.assertEqual(result['navigation'], {'previous': '2026-09', 'next': '2026-11'})
        self.assertTrue(schedule.call_args.kwargs['compact_monthly'])
        attendance.assert_not_called()
        self.assertEqual(rows.call_args_list[0].kwargs, {'rail_only': True, 'navigation_only': True})
        start, end = rows.call_args_list[1].args[-2:]
        self.assertEqual(start.astimezone(timezone.utc).isoformat(), '2026-09-30T23:00:00+00:00')
        self.assertEqual(end.astimezone(timezone.utc).isoformat(), '2026-11-01T00:00:00+00:00')
        week.assert_not_called()
        entries.assert_called_once()

    def test_sessions_without_a_display_subject_skip_attendance(self):
        result, *_, attendance, week = self.fixture('?month=2026-10', subjects=[], sessions=[
            {'id': 81, 'moduleId': 'M1', 'start': '2026-10-10T09:00:00Z'}])
        self.assertEqual(result['lectures'], [])
        attendance.assert_not_called()

    def test_displayed_sessions_still_read_canonical_attendance(self):
        result, *_, attendance, week = self.fixture('?month=2026-10', sessions=[
            {'id': 81, 'moduleId': 'M1', 'start': '2026-10-10T09:00:00Z'}])
        self.assertEqual(len(result['lectures']), 1)
        attendance.assert_called_once()
        self.assertEqual(attendance.call_args.kwargs, {'monthly': '2026-10'})

    def test_indexed_attendance_preserves_first_match_and_occurrence_date(self):
        session = {'id': 81, 'moduleId': 'M1', 'start': '2026-10-10T09:00:00Z'}
        first = {'id': 'first', 'source': 'microsoft-teams', 'sessionId': 'teams:81',
                 'date': '2026-10-10', 'status': 'upcoming', 'canReportAbsence': True,
                 'recovery': {'method': 'catch-up', 'calendarKey': 'owned:1', 'ended': False}}
        result, *_ = self.fixture('?month=2026-10', sessions=[session], lectures=[
            {**first, 'id': 'wrong-source', 'source': 'kbc-attendance'},
            {**first, 'id': 'wrong-day', 'date': '2026-10-11'},
            first, {**first, 'id': 'duplicate', 'status': 'absent'}])
        lecture = result['lectures'][0]['attendance']
        self.assertEqual(lecture['id'], 'first')
        self.assertEqual(lecture['status'], 'upcoming')
        self.assertTrue(lecture['canReportAbsence'])
        self.assertEqual(lecture['recovery'], first['recovery'])

    def test_unlogged_month_reuses_one_canonical_actual_projection(self):
        # A future month is never "logged", so achieved hours come from the
        # canonical actual rows that also bound navigation.
        records = [{'reporting_month': '2026-11', 'actual_seconds': 7200, 'accepted': True}]
        expected, *_ = self.fixture('?month=2026-11', records=records, targets={}, fallback={'2026-11': {'actual': 0}})
        with patch.object(monthly.schedule, '_canonical_actual_rows',
                          wraps=monthly.schedule._canonical_actual_rows) as actual_rows:
            result, *_ = self.fixture('?month=2026-11', records=records, targets={}, fallback={'2026-11': {'actual': 0}})
        actual_rows.assert_called_once()
        self.assertEqual(result, expected)
        self.assertEqual(result['summary']['achievedHours'], 2)

    def test_invalid_month_fails_before_any_source_read(self):
        from . import dashboard_tabs
        for value in ('', '2026-13', '2026-1', '0000-01', '9999-12', '2026-10-01', '2026-10 OR 1=1'):
            with self.subTest(value=value), patch.object(monthly.canonical, 'entries_for') as entries:
                with self.assertRaises(ServiceError) as raised:
                    monthly.read_monthly(object(), 'commercial', {}, object(), RequestFactory().get('/monthly/', {'month': value}))
                self.assertEqual(raised.exception.status, 400)
                entries.assert_not_called()

    def test_default_clamps_but_explicit_deep_link_survives(self):
        result, *_ = self.fixture('?month=2028-02')
        self.assertEqual(result['month'], '2028-02')
        self.assertIsNone(result['navigation']['next'])
        self.assertEqual(result['navigation']['previous'], '2027-01')
        result, *_ = self.fixture()
        self.assertEqual(result['month'], '2026-10')

    def test_future_hours_preserve_direct_learning_fallback(self):
        result, *_, week = self.fixture('?month=2026-11', targets={'2026-11': 7}, records=[
            {'reporting_month': '2026-11', 'actual_seconds': 3600, 'accepted': True}],
            fallback={'2026-11': {'planned': 8, 'actual': 2}})
        self.assertEqual(result['summary']['requiredHours'], 8)
        self.assertEqual(result['summary']['achievedHours'], 3)
        week.assert_called_once()

    def test_accepted_hour_clamp_and_missing_target_fallback(self):
        result, *_ = self.fixture('?month=2026-10', targets={}, records=[
            {'reporting_month': '2026-10', 'actual_seconds': -3600, 'accepted': True}],
            fallback={'2026-10': {'planned': 8, 'actual': 2}})
        self.assertEqual(result['summary']['requiredHours'], 8)
        self.assertEqual(result['summary']['achievedHours'], 0)

    def test_lecture_title_actions_and_review_ownership_fields_survive(self):
        review = {'id': 'r1', 'eventKey': 'owned:r1', 'source': 'progress-review', 'status': 'scheduled',
                  'scheduledDate': '2026-10-10', 'reviewTemplateId': 'T1', 'reviewInstanceId': 'I1', 'sequence': 2, 'invited': False}
        session = {'id': 81, 'moduleId': 'M1', 'title': 'Session title', 'start': '2026-10-10T09:00:00Z',
                   'end': '2026-10-10T10:00:00Z', 'minutes': 60, 'joinUrl': 'https://example.invalid/join', 'status': 'scheduled'}
        result, *_ = self.fixture('?month=2026-10&subject=current:M1', sessions=[session], reviews=[review,
            {**review, 'id': 'outside', 'scheduledDate': '2026-09-10'}, {**review, 'source': 'student-support'}])
        self.assertEqual(result['reviews'], [review])
        self.assertEqual(result['lectures'][0]['title'], 'Unified title')
        self.assertEqual(result['lectures'][0]['tutor'], 'Tutor')
        self.assertEqual(result['selectedSubjectId'], 'current:M1')
        self.assertEqual(set(result['lectures'][0]['session']), {'id', 'start', 'end', 'minutes', 'joinUrl', 'status'})
        self.assertEqual(result['assignments'], [])

    def test_subject_membership_historical_suppression_and_native_dedupe(self):
        result = monthly.display_subjects({'activity': {'progress_basis': 'catalogue_activities',
            'subjects': [{'id': 1, 'name': 'Historical', 'module_id': 'M1'}], 'activities': []},
            'metadata': {'current_subjects': [{'id': 'M1', 'title': 'Hidden'}, {'id': 'M2', 'title': 'Native'}],
                'activity_dates': {'C2': {'date': '2026-10-02', 'date_source': 'curriculum'}}},
            'detail': {'components': [
                {'componentId': 'C1', 'moduleId': 'M1', 'module': 'Hidden'},
                {'componentId': 'C2', 'moduleId': 'M2', 'module': 'Native', 'ksbMappings': [{'code': 'K2'}]},
                {'componentId': 'C2', 'moduleId': 'M3', 'module': 'Other', 'ksbMappings': [{'code': 'K3'}]}]}})
        self.assertEqual([s['id'] for s in result], ['legacy:1', 'current:M2', 'current:M3'])
        self.assertEqual(result[1]['activities'][0]['date'], '2026-10-02')
        self.assertEqual(result[1]['activities'][0]['ksbs'], ['K2'])
        self.assertEqual(result[2]['activities'], [])

    def test_navigation_sql_aggregates_without_returning_sessions(self):
        cursor = MagicMock()
        with patch.object(monthly.schedule, 'rows', return_value=[]):
            monthly.schedule._plan_session_rows(cursor, 'synthetic@example.invalid', ['M1'], navigation_only=True, rail_only=True)
        sql, params = cursor.execute.call_args.args
        self.assertIn('min(coalesce(scheduled_start,start_datetime)) AS first_start', sql)
        self.assertIn('GROUP BY module_id', sql)
        self.assertIn('occurrence_id IS NOT NULL', sql)
        self.assertEqual(params, [['M1'], 'synthetic@example.invalid'])


class MonthlySourceReadTests(SimpleTestCase):
    def test_compact_ksb_mapping_preserves_codes_weights_and_hours(self):
        from . import learner_detail
        metadata = {'module_titles': {'M1': 'Module'},
                    'weeks': [('W1', 'M1', 'Week 1', 1, 0)], 'quiz_links': {}}
        component = ('C1', 'W1', 'M1', 'reflection', 'Reflect', '', {}, None,
                     0, None, False, None, False, 1.5)
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[component], [('C1', 'K1', None, 'knowledge', 2, None)]]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            _, _, components = learner_detail._resolve_from_master([], [], [],
                assigned_modules=[{'moduleId': 'M1'}], resolved_metadata=metadata,
                compact=True, compact_content=True, expected_otjh=True, live_session_ids=False, strict=True)
        mapping = components[0]['ksbMappings'][0]
        self.assertEqual((mapping['code'], mapping['weight']), ('K1', 2))
        self.assertEqual(components[0]['expectedOtjh'], 1.5)
        self.assertIn('NULL AS ksb_description', cursor.execute.call_args.args[0])
        self.assertNotIn('JOIN curriculum.components', cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1], [['C1']])

    def test_compact_quiz_links_reuse_visible_component_identities(self):
        from . import learner_detail
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[('M1', 'Module')], [('W1', 'M1', 'Week 1', 1, 0)],
            [('Q1', 'W1', 'M1', 'quiz', 'Quiz', '', {}, None, 0, None, False, None, False, 1)], [], []]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            learner_detail._resolve_from_master([], [], [], assigned_modules=[{'moduleId': 'M1'}],
                compact=True, compact_content=True, expected_otjh=True, live_session_ids=False, strict=True)
        sql, parameters = cursor.execute.call_args_list[3].args
        self.assertIn('FROM curriculum.quiz_component_links', sql)
        self.assertNotIn('JOIN curriculum.components', sql)
        self.assertEqual(parameters, [['Q1']])

    def test_ambiguous_quiz_links_keep_legacy_query_precedence(self):
        from . import learner_detail
        metadata = {'module_titles': {'M1': 'Module'}, 'weeks': [('W1', 'M1', 'Week 1', 1, 0)],
                    'quiz_meta': {qid: {'quizId': qid, 'title': 'Quiz', 'questions': 4,
                                      'duration': 10, 'timeUnit': 'mins'} for qid in (9, 10)}}
        component = ('Q1', 'W1', 'M1', 'quiz', 'Quiz', '', {}, None, 0, None, False, None, False, 1)
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[component], [('Q1', 9), ('Q1', 10)], [('Q1', 10), ('Q1', 9)], []]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            _, _, components = learner_detail._resolve_from_master([], [], [],
                assigned_modules=[{'moduleId': 'M1'}], resolved_metadata=metadata,
                compact=True, compact_content=True, expected_otjh=True, live_session_ids=False, strict=True)
        self.assertIn('JOIN curriculum.components', cursor.execute.call_args_list[2].args[0])
        self.assertEqual(components[0]['quizMeta']['quizId'], 9)

    def test_compact_content_keeps_all_weeks_and_timing_and_ksb_columns(self):
        from . import learner_detail
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[('M1', 'Module')],
            [('W1', 'M1', 'Week 1', 1, 0), ('W2', 'M1', 'Week 2', 2, 1)], []]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            learner_detail._resolve_from_master([], [], [], assigned_modules=[{'moduleId': 'M1'}],
                compact=True, compact_content=True, expected_otjh=True, live_session_ids=False, strict=True)
        sql, parameters = cursor.execute.call_args_list[2].args
        self.assertNotIn('AND week_id = ANY(%s)', sql)
        self.assertEqual(parameters, [['M1']])
        self.assertIn("'' AS description", sql)
        self.assertNotIn("'sessionDateTimeUtc'", sql)  # Timing keys are not subtracted.
        self.assertIn('ksb_mappings', sql)
        self.assertIn('expected_otjh', sql)
        self.assertIn("settings_json::jsonb - ARRAY['lessonContent'", sql)
        self.assertNotIn("regexp_replace(regexp_replace(coalesce(description", sql)
        self.assertIn("'assignmentTopics'", sql)

    def test_compact_schedule_keeps_review_action_contract_and_skips_unused_metrics(self):
        plan = monthly.schedule
        source = SimpleNamespace(pk=265, email='synthetic@example.invalid', _canonical_profile={'id': 17}, _case_file_profile=object())
        cursor = MagicMock()
        with patch.object(plan, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}), \
             patch.object(plan, 'plan_module_ids', return_value=([], {})), \
             patch.object(plan.canonical_learning, 'entries_for') as entries, \
             patch.object(plan, 'plan_sessions') as sessions, \
             patch.object(plan, 'current_coach', return_value={'coach_name': 'Coach', 'coach_email': ''}), \
             patch.object(plan, 'coach_phone') as phone, \
             patch.object(plan, 'plan_reviews', return_value=[]) as reviews, \
             patch.object(plan, '_canonical_module_progress') as progress:
            result = plan.read_dashboard(source, section='overview', targets={}, dashboard_tab='monthly', compact_monthly=True)
        self.assertEqual(set(result), {'months', 'contractStatus', 'programmeStartDate', 'programmeEndDate', 'modules', 'moduleLinks', 'reviews', 'coach'})
        self.assertEqual(reviews.call_args.kwargs, {})
        self.assertEqual(reviews.call_args.args[2], ('mcr', 'progress-review', 'student-support'))
        for unused in (entries, sessions, phone, progress):
            unused.assert_not_called()

    def test_compact_attendance_normalizes_first_and_skips_history_sources(self):
        from . import attendance_lectures as attendance, attendance_mode
        source = SimpleNamespace(pk=265, id=265)
        register = [{'source': 'microsoft-teams', 'session_date': date(2026, 10, 10), 'module_catalogue_id': 'M1'},
                    {'source': 'microsoft-teams', 'session_date': date(2026, 9, 10), 'module_catalogue_id': 'M2'},
                    {'source': 'kbc-attendance', 'session_date': date(2026, 10, 10)}]
        with patch.object(attendance, 'lecture_register', return_value=register) as normalized, \
             patch.object(attendance, 'read_legacy_metadata') as legacy, \
             patch.object(attendance, 'read_native_components', return_value=([], [])) as native, \
             patch.object(attendance, 'build_lectures', return_value=[]) as build, \
             patch.object(attendance, 'read_assigned_modules') as assigned, \
             patch.object(attendance_mode, 'read_mode') as mode, \
             patch.object(attendance, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: MagicMock())}), \
             patch.object(attendance, '_attach_recovery') as recovery, \
             patch.object(attendance, '_attach_recording_views') as recordings, \
             patch.object(attendance, '_mark_missed_catchups') as missed:
            result = attendance.read_workspace(source, 'commercial', monthly='2026-10')
        self.assertEqual(result, {'lectures': []})
        self.assertEqual(build.call_args.args[0], [register[0]])
        native.assert_called_once_with(source, {'M1'}, monthly=True)
        normalized.assert_called_once_with(source)
        for unused in (legacy, assigned, mode, recordings):
            unused.assert_not_called()
        recovery.assert_called_once()
        missed.assert_called_once()
