"""Synthetic Overview regressions; every database connection is forbidden."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory
from . import dashboard_overview as overview


class OverviewProjectionTests(SimpleTestCase):
    def test_target_to_date_reuses_verified_owner_without_replacing_canonical_rule(self):
        from . import dashboard_metrics
        source = SimpleNamespace(pk=265)
        with patch.object(dashboard_metrics.canonical_learning, 'require_profile', return_value={'id': 17}) as identity, \
             patch('coach_api.selectors.otjh.learner_programme_window', return_value=('2026-01-01', '2026-12-31')), \
             patch('coach_api.views.apply_otjh_to_date_metrics', return_value={'otjhTargetAsOfToday': 40}) as target:
            result = dashboard_metrics.coach_otjh_target_to_date(source, {'actual': 12, 'planned': 100}, owner={'id': 17})
            identity.assert_not_called()
            self.assertEqual(dashboard_metrics.coach_otjh_target_to_date(source, {'actual': 12, 'planned': 100}), result)
        self.assertEqual(result, 40)
        identity.assert_called_once_with(265)
        self.assertEqual(target.call_args.args[0]['otjhPlanned'], 100)

    def test_hours_only_reader_skips_plan_subjects_ksb_lookup_and_reuses_dates(self):
        from . import overview_week
        source = SimpleNamespace(pk=265, _case_file_profile=object())
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = []
        with patch.object(overview_week, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}), \
             patch.object(overview_week, '_direct_progress_records', return_value=[]), \
             patch.object(overview_week, 'rows', return_value=[]), \
             patch.object(overview_week, 'read_builder_activity_dates', return_value={}), \
             patch.object(overview_week, 'summarise_plan') as subjects:
            self.assertEqual(overview_week.read_week(source, monthly_hours_only=True), {})
        subjects.assert_not_called()
        self.assertEqual(source._dashboard_activity_dates, (set(), {}))
        self.assertNotIn('FROM curriculum.ksb_mappings', cursor.execute.call_args_list[-1].args[0])

    def test_native_and_historical_duplicate_cards_preserve_first_and_merged_completion(self):
        learning = {'activity': {'subjects': [{'id': 1, 'name': 'Legacy', 'module_id': 'M1'}],
            'activities': [
                {'group_id': 1, 'activity_id': 2, 'source_activity_id': 2, 'completed': False},
                {'group_id': 1, 'activity_id': 2, 'source_activity_id': 2, 'completed': True}],
            'activity_sources': {'C1': {'group_id': 1, 'activity_id': 2, 'module_id': 'M1'},
                                 'C2': {'group_id': 1, 'activity_id': 2, 'module_id': 'M1'}}},
            'metadata': {'builder_subjects': {'legacy:1': {'id': 'M1', 'title': 'Legacy'}}, 'activity_dates': {}, 'current_subjects': []},
            'detail': {'components': [
                {'componentId': 'C1', 'moduleId': 'M1', 'module': 'Legacy'},
                {'componentId': 'C2', 'moduleId': 'M1', 'module': 'Legacy'},
                {'componentId': 'C3', 'moduleId': 'M2', 'module': 'Native', 'sessionDate': '2026-02-31'},
                {'componentId': 'C3', 'moduleId': 'M2', 'module': 'Native', 'isQuiz': True, 'quizMeta': {'quizId': 'Q'}}],
                'componentProgress': [{'kind': 'component', 'componentId': 'C1', 'passed': True},
                                      {'kind': 'component', 'componentId': 'C3', 'passed': True}],
                'quizAttempts': []}}
        subjects = {s['id']: s for s in overview.overview_subjects(learning)}
        self.assertEqual(len(subjects['legacy:1']['activities']), 1)
        self.assertTrue(subjects['legacy:1']['activities'][0]['completed'])
        self.assertTrue(subjects['current:M2']['activities'][0]['completed'])
        self.assertEqual(subjects['current:M2']['activities'][0]['date'], '')
        learning['detail']['componentProgress'] = []
        subjects = {s['id']: s for s in overview.overview_subjects(learning)}
        self.assertFalse(subjects['legacy:1']['activities'][0]['completed'])

    def test_chart_months_preserve_log_precedence_future_fallback_and_negative_clamp(self):
        records = [
            {'reporting_month': '2026-09', 'actual_seconds': 3600, 'accepted': True},
            {'reporting_month': '2026-09', 'actual_seconds': 7200, 'accepted': False},
            {'reporting_month': '2026-10', 'actual_seconds': -3600, 'accepted': True},
            {'reporting_month': '2026-11', 'actual_seconds': 1800, 'accepted': True},
        ]
        rows = overview.hour_rows(records, {'2026-09': 10, '2026-11': 99},
            {'2026-09': {'actual': 80, 'submitted': 90, 'planned': 30},
             '2026-11': {'actual': 3, 'submitted': 2, 'planned': 8}}, ['2026-08'], '2026-10')
        self.assertEqual(rows, [
            {'key': '2026-08', 'target': None, 'submitted': 0, 'completed': 0},
            {'key': '2026-09', 'target': 10, 'submitted': 2, 'completed': 1},
            {'key': '2026-10', 'target': None, 'submitted': 0, 'completed': 0},
            {'key': '2026-11', 'target': 8, 'submitted': 2, 'completed': .5}])
        owner_rows = overview.schedule._canonical_actual_rows({'id': 17}, records)
        with patch.object(overview.schedule, '_canonical_actual_rows') as recomputed:
            reused = overview.hour_rows(records, {'2026-09': 10, '2026-11': 99},
                {'2026-09': {'actual': 80, 'submitted': 90, 'planned': 30},
                 '2026-11': {'actual': 3, 'submitted': 2, 'planned': 8}}, ['2026-08'], '2026-10',
                actual_rows=owner_rows)
        recomputed.assert_not_called()
        self.assertEqual(reused, rows)
        self.assertEqual(overview.hour_rows([], {'2099-01': 99}, {}, [], '2026-10'), [])
        self.assertEqual(overview.hour_rows([], {'2026-00': 2}, {'2026-99': {}}, [], '2026-10'), [])

    def test_review_count_uses_due_target_dedup_and_excludes_support_cancelled_future(self):
        reviews = [{'eventKey': '1', 'source': 'progress-review', 'status': 'completed', 'targetDate': '2026-10-01'},
                   {'eventKey': '1', 'source': 'progress-review', 'status': 'scheduled', 'targetDate': '2026-10-01'},
                   {'eventKey': '2', 'source': 'mcr', 'status': 'completed', 'targetDate': '2026-10-15', 'scheduledDate': '2026-11-01'},
                   {'eventKey': '3', 'source': 'mcr', 'status': 'completed', 'targetDate': '2026-11-01'},
                   {'eventKey': '4', 'source': 'student-support', 'status': 'completed', 'targetDate': '2026-10-01'},
                   {'eventKey': '5', 'source': 'mcr', 'status': 'cancelled', 'targetDate': '2026-10-01'},
                   {'eventKey': '6', 'source': 'mcr', 'status': 'completed', 'targetDate': 'invalid'}]
        self.assertEqual(overview.reviews_to_date(reviews, '2026-10-15'), {'completed': 1, 'total': 2, 'percent': 50})

    def test_compact_read_reuses_learning_progress_and_preserves_authoritative_totals(self):
        from . import dashboard_tabs, overview_week, attendance_lectures, attendance, dashboard_metrics
        from .selectors import assignments as assignment_reads
        source = SimpleNamespace(id=265, pk=265, email='synthetic@example.test')
        owner = {'id': 17, 'start_date': date(2026, 9, 1), 'end_date': date(2026, 11, 30)}
        module = {'id': 'M1', 'title': 'Module', 'start_date': '2026-09-01', 'end_date': '2026-11-30',
                  'total_otjh': 12, 'educational_session_count': 2}
        learning = {'activity': None, 'metadata': {'current_subjects': [{'id': 'M1', 'title': 'Module'}], 'builder_subjects': {}, 'activity_dates': {}},
                    'detail': {'components': [{'componentId': 'C1', 'moduleId': 'M1', 'module': 'Module', 'type': 'reading'}],
                               'componentProgress': [{'componentId': 'C1', 'kind': 'component', 'passed': True}],
                               'quizAttempts': [], 'videoProgress': []}}
        records = [{'id': 1, 'module_ref': 'M1', 'accepted': True, 'reporting_month': '2026-10', 'actual_seconds': 3600, 'ksbs': ['K1']}]
        metrics = {'programme': {'completed': 1, 'total': 2, 'percent': 50, 'status': 'ready'},
                   'ksb': {'completed': 1, 'total': 3, 'percent': 33.33, 'points': [{'secret': 'unused'}]},
                   'otjh': {'actual': 7, 'planned': 100, 'historical': 7, 'new': 0}}
        with patch.object(overview.canonical, 'entries_for', return_value=records) as entries, \
             patch.object(overview.canonical, 'targets_for', return_value={'2026-10': 10}), \
             patch.object(overview.canonical, 'query', return_value=[]), \
             patch.object(overview.canonical, 'metrics_bulk', return_value={265: metrics}) as totals, \
             patch.object(overview, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: MagicMock())}), \
             patch.object(overview.schedule, 'plan_module_ids', return_value=(['M1'], {})), \
             patch.object(overview, 'module_rows', return_value={'M1': module}), \
             patch.object(overview.schedule, '_plan_session_rows', return_value=[]), \
             patch.object(overview.schedule, 'plan_reviews', return_value=[]), \
             patch.object(overview.schedule, 'read_dashboard') as legacy, \
             patch.object(dashboard_tabs, 'learning_projection', return_value=learning) as facts, \
             patch.object(assignment_reads, '_effective_plan_ids', return_value=['M1']), \
             patch.object(overview_week, 'read_week', return_value={}) as weekly, \
             patch.object(attendance_lectures, 'lecture_register', return_value=[]), \
             patch.object(attendance, '_summarize_attendance', return_value=None), \
             patch.object(dashboard_metrics, 'coach_otjh_target_to_date', return_value=40), \
             patch.object(overview.timezone, 'localdate', return_value=date(2026, 10, 15)):
            result = overview.read_overview(source, 'commercial', owner, object(), RequestFactory().get('/overview/'))
        self.assertEqual(set(result), {'metrics', 'attendance', 'reviews', 'modules', 'programme', 'hours', 'programmeStartDate', 'programmeEndDate'})
        self.assertEqual(result['metrics']['otjh'], {'actual': 7, 'targetToDate': 40})
        self.assertNotIn('points', result['metrics']['ksb'])
        self.assertIsNone(result['attendance'])
        self.assertEqual(result['modules'][0]['activities'], {'completed': 1, 'total': 1})
        self.assertEqual(result['modules'][0]['hours'], {'actual': 1, 'planned': 12})
        self.assertEqual(result['programme'][0]['percent'], 100)
        entries.assert_called_once_with(owner, training_summary=True)
        totals.assert_called_once_with([265], learner_workspace=True)
        weekly.assert_called_once_with(source, monthly_hours_only=True)
        facts.assert_called_once()
        legacy.assert_not_called()

    def test_dispatch_verifies_identity_before_overview(self):
        from . import dashboard_tabs, identity
        source = SimpleNamespace(pk=265)
        with patch.object(dashboard_tabs.canonical, 'require_profile', return_value={'id': 17}), \
             patch.object(identity, 'learner_profile_for_source', return_value=SimpleNamespace(pk=18, enrolment_id=265)), \
             patch.object(overview, 'read_overview') as read:
            from old_otjh.service import ServiceError
            with self.assertRaises(ServiceError):
                dashboard_tabs.read_tab(source, 'commercial', 'overview', object())
            read.assert_not_called()

    def test_planned_hours_reuses_resolved_plan_ids_and_keeps_authored_sum(self):
        schedule = overview.schedule
        cursor = MagicMock()
        cursor.fetchone.return_value = ('576.125',)
        cursor.__enter__.return_value = cursor
        with patch.object(schedule, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}), \
             patch.object(schedule, 'plan_module_ids') as resolve:
            self.assertEqual(schedule.plan_planned_hours(object(), {'id': 17}, ids=['M1', 'M2']), 576.12)
            resolve.assert_not_called()
            sql, params = cursor.execute.call_args.args
            self.assertIn('sum(total_otjh)', sql)
            self.assertEqual(params, [['M1', 'M2']])
            cursor.execute.reset_mock()
            self.assertIsNone(schedule.plan_planned_hours(object(), {'id': 17}, ids=[]))
            cursor.execute.assert_not_called()
            resolve.assert_not_called()
