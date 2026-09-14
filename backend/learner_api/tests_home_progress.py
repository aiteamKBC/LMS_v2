from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory

from .home_progress import read_home_progress, summarise_home
from .overview_week import merged_activities, overview_week, read_week
from .tests_overview_week import native, old

START, END = date(2026, 9, 3), date(2026, 9, 13)


class HomeProgressTests(SimpleTestCase):
    def summary(self, current=(), historical=(), progress=(), submissions=(), assigned=(),
                start=START, lectures=(), links=None, historical_hours=0):
        return summarise_home(merged_activities(list(historical), list(current), list(progress), set(), links or {}),
                              current, list(progress), submissions, assigned, start, END, lectures, historical_hours)

    def test_period_is_start_date_through_end_of_week_with_programme_wide_hours_and_modules(self):
        current = [native(id='before', date='2026-09-02', module_id='PRE', expected_hours=1),
                   native(id='start', date='2026-09-03', type='assignment', expected_hours=2),
                   native(id='previous-week', date='2026-09-06', expected_hours=3),
                   native(id='sunday', date='2026-09-13', type='assignment', expected_hours=4),
                   native(id='future', date='2026-09-14', module_id='FUTURE', expected_hours=5)]
        progress = [{'kind': 'component', 'componentId': key} for key in ['before', 'start', 'previous-week']]
        result = self.summary(current=current, progress=progress, assigned=[('M1', ''), ('PRE', ''), ('FUTURE', ''), ('EMPTY', '')])
        self.assertEqual(result['activities'], {'completed': 2, 'total': 3})
        self.assertEqual(result['assignments'], {'completed': 1, 'total': 2})
        self.assertEqual(result['modules'], {'completed': 1, 'total': 4})
        self.assertEqual(result['otjh']['planned'], 15)
        self.assertEqual(result['period']['start'], '2026-09-03')

    def test_assignment_hours_move_from_submitted_to_actual_once_accepted(self):
        current = [native(id='assignment', type='assignment', expected_hours=5), native(id='reading', expected_hours=10)]
        progress = [{'kind': 'component', 'componentId': 'assignment', 'claimedSeconds': 7200, 'timeTrackingSource': 'component:input'},
                    {'kind': 'component', 'componentId': 'reading', 'reportedTime': '60 minutes'}]
        submission = {'component_ref': 'assignment', 'status': 'submitted_for_tutor_review', 'actual_time_hours': '2'}
        result = self.summary(current=current, progress=progress, submissions=[submission])
        self.assertEqual(result['otjh'], {'actual': 1, 'submitted': 2, 'planned': 15, 'percent': 6.67, 'missingPlannedActivities': 0})
        self.assertEqual(result['assignments'], {'completed': 0, 'total': 1})
        accepted = self.summary(current=current, progress=progress, submissions=[{**submission, 'status': 'accepted'}])
        self.assertEqual(accepted['otjh']['actual'], 3)
        self.assertEqual(accepted['otjh']['submitted'], 0)
        self.assertEqual(accepted['assignments']['completed'], 1)
        self.assertEqual(accepted['modules']['completed'], 1)

    def test_rejected_draft_and_referred_assignments_do_not_count_as_completed_or_submitted(self):
        for status in ['draft', 'rejected', 'referred', 'resubmission_required']:
            with self.subTest(status=status):
                result = self.summary(current=[native(type='assignment', expected_hours=4)],
                    progress=[{'kind': 'component', 'componentId': 'new', 'expectedOtjh': 4}],
                    submissions=[{'activity_id': 'new', 'status': status, 'actual_time_hours': 4}])
                self.assertEqual(result['otjh']['actual'], 0)
                self.assertEqual(result['otjh']['submitted'], 0)
                self.assertEqual(result['activities']['completed'], 0)

    def test_assignment_actual_uses_recorded_time_if_submission_hours_are_missing(self):
        result = self.summary(current=[native(type='assignment', expected_hours=8)],
            progress=[{'componentId': 'new', 'kind': 'component', 'verifiedSeconds': 1800, 'expectedOtjh': 8}],
            submissions=[{'component_ref': 'new', 'status': 'accepted', 'actual_time_hours': None}])
        self.assertEqual(result['otjh']['actual'], .5)
        unknown = self.summary(current=[native(type='assignment', expected_hours=8)],
            submissions=[{'component_ref': 'new', 'status': 'submitted_for_tutor_review', 'actual_time_hours': None}])
        self.assertIsNone(unknown['otjh']['submitted'])

    def test_imported_submission_does_not_duplicate_historical_actual(self):
        result = self.summary(current=[native(type='assignment', expected_hours=3)],
            progress=[{'componentId': 'new', 'kind': 'component', 'expectedOtjh': 3}], historical_hours=3,
            submissions=[{'activity_id': 'new', 'status': 'accepted', 'actual_time_hours': 3, 'imported': True}])
        self.assertEqual(result['otjh']['actual'], 3)

    def test_submissions_for_unassigned_components_cannot_inflate_totals(self):
        result = self.summary(current=[native(expected_hours=2)],
            submissions=[{'component_ref': 'another-learner', 'status': 'accepted', 'actual_time_hours': 99}])
        self.assertEqual(result['otjh']['actual'], 0)

    def test_previously_earned_hours_survive_curriculum_replacement(self):
        result = self.summary(current=[native(expected_hours=10)],
            progress=[{'componentId': 'archived', 'kind': 'component', 'reportedTime': '120 minutes'}])
        self.assertEqual(result['otjh']['actual'], 2)
        self.assertEqual(result['otjh']['planned'], 10)
        self.assertEqual(result['activities'], {'completed': 0, 'total': 1})

    def test_archived_assignment_progress_still_counts_its_submission_once(self):
        result = self.summary(current=[native(expected_hours=10)],
            progress=[{'componentId': 'archived', 'componentType': 'assignment', 'kind': 'component', 'reportedTime': '120 minutes'}],
            submissions=[{'component_ref': 'archived', 'status': 'submitted_for_tutor_review', 'actual_time_hours': 2}])
        self.assertEqual(result['otjh']['actual'], 0)
        self.assertEqual(result['otjh']['submitted'], 2)

    def test_non_assignment_activity_hours_keep_the_existing_recorded_time_rule(self):
        result = self.summary(current=[native(expected_hours=5)],
            progress=[{'componentId': 'new', 'kind': 'component', 'reportedTime': '30 minutes'}],
            submissions=[{'component_ref': 'new', 'status': 'submitted_for_tutor_review', 'actual_time_hours': .5}])
        self.assertEqual(result['otjh']['actual'], .5)
        self.assertEqual(result['otjh']['submitted'], 0)
        self.assertEqual(result['activities']['completed'], 1)

    def test_lecture_denominator_includes_scheduled_sessions_in_period_and_late_counts_attended(self):
        lectures = [
            {'session_date': '2026-09-02', 'attendance_status': 'present'},
            {'session_date': '2026-09-03', 'attendance_status': 'present'},
            {'session_date': '2026-09-06', 'attendance_status': 'late'},
            {'session_date': '2026-09-10', 'attendance_status': 'absent'},
            {'session_date': '2026-09-13', 'attendance_status': 'upcoming'},
            {'session_date': '2026-09-14', 'attendance_status': 'upcoming'},
        ]
        self.assertEqual(self.summary(lectures=lectures)['lectures'], {'completed': 2, 'total': 4})
        self.assertIsNone(self.summary(lectures=None)['lectures'])

    def test_missing_start_or_undated_work_never_uses_import_timestamps(self):
        current = [native(expected_hours=2, date=None)]
        unknown = self.summary(current=current, start=None)
        for key in ('activities', 'assignments', 'lectures'):
            self.assertIsNone(unknown[key])
        result = self.summary(current=current)
        self.assertEqual(result['undatedActivities'], 1)
        self.assertEqual(result['activities']['total'], 0)
        self.assertEqual(result['otjh']['planned'], 2)
        self.assertEqual(result['modules']['total'], 1)

    def test_future_start_has_zero_period_counts_without_hiding_whole_plan(self):
        result = self.summary(current=[native(expected_hours=2)], start=date(2026, 10, 1))
        self.assertEqual(result['activities'], {'completed': 0, 'total': 0})
        self.assertEqual(result['otjh']['planned'], 2)
        self.assertEqual(result['modules']['total'], 1)

    def test_missing_or_invalid_planned_hours_are_unavailable_not_zero(self):
        for missing in (None, -1, 'NaN', 'Infinity'):
            result = self.summary(current=[native(expected_hours=missing), native(id='valid', expected_hours=3)])
            self.assertIsNone(result['otjh']['planned'])
            self.assertIsNone(result['otjh']['percent'])
            self.assertEqual(result['otjh']['missingPlannedActivities'], 1)
        self.assertEqual(self.summary()['otjh']['planned'], 0)

    def test_export_links_dedupe_plan_hours_and_module_identity_including_empty_assigned_modules(self):
        result = self.summary(historical=[old(expected_hours=2), old(group_id=2, expected_hours=2)],
            current=[native(id='linked', expected_hours=4), native(id='extra', expected_hours=3)],
            links={'linked': ('1', '2')}, assigned=[('M1', ''), ('EMPTY', '')])
        self.assertEqual(result['otjh']['planned'], 7)
        self.assertEqual(result['activities'], {'completed': 2, 'total': 3})
        self.assertEqual(result['modules'], {'completed': 1, 'total': 3})

    def test_repository_filters_submission_identity_and_tolerates_attendance_failure(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        source = SimpleNamespace(pk=499, aptem_id=None)
        with patch('learner_api.home_progress.connections', {'enrolment': connection}), \
             patch('learner_api.home_progress._group_dates', return_value=(START, END, 'learner')), \
             patch('learner_api.home_progress.rows', return_value=[]), \
             patch('learner_api.home_progress.lecture_register', side_effect=DatabaseError('offline')):
            result = read_home_progress(source, 'apprenticeship', [], [], [], [], END)
        self.assertEqual(cursor.execute.call_args.args[1], ['apprenticeship', '499'])
        self.assertIsNone(result['lectures'])
        self.assertEqual(result['otjh']['planned'], 0)

    def test_home_endpoint_keeps_route_enrolment_and_ignores_query_identity(self):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        source = model.all_learners.only.return_value.get.return_value
        with patch.dict('learner_api.overview_week.SOURCE_MODELS', {'commercial': model}), \
             patch('learner_api.overview_week.read_week', return_value={}) as reader:
            response = overview_week.__wrapped__.__wrapped__(RequestFactory().get('/?section=home&id=999&aptem_id=999'), 'commercial', 499)
        reader.assert_called_once_with(source, home_kind='commercial')
        model.all_learners.only.return_value.get.assert_called_once_with(pk=499)
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_home_reads_all_plan_activities_while_preserving_weekly_schedule_payload(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('M1', 'Marketing')]
        current = [native(id='current', expected_hours=2), native(id='future', date='2027-01-01', expected_hours=10)]
        dates = {row['id']: {'date': row['date']} for row in current}
        source = SimpleNamespace(pk=499, aptem_id=None)
        with patch('learner_api.overview_week.connections', {'enrolment': connection}), \
             patch('learner_api.overview_week.rows', return_value=current), \
             patch('learner_api.overview_week.read_builder_activity_dates', return_value=dates), \
             patch('learner_api.overview_week._direct_progress_records', return_value=[]), \
             patch('learner_api.home_progress.read_home_progress', return_value={'sentinel': True}) as home:
            result = read_week(source, datetime(2026, 9, 10, tzinfo=timezone.utc), home_kind='apprenticeship')
        self.assertEqual(result['homeProgress'], {'sentinel': True})
        self.assertEqual(len(list(home.call_args.args[2])), 2)
        self.assertEqual(result['modules'][0]['total'], 1)
