"""Weekly overview regressions. SimpleTestCase prohibits database access."""
from datetime import date, datetime, timezone
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory
from .overview_week import (summarise_week, week_bounds, progress_day, overview_week, read_week,
                            merged_activities, summarise_plan, direct_hours_by_subject,
                            monthly_otjh_summary)
from .subject_dates import activity_schedule

START, END = date(2026, 9, 7), date(2026, 9, 13)


def old(**changes):
    return {'group_id': 1, 'activity_id': 2, 'module_title': 'Marketing', 'title': 'Learn', 'status': 'completed',
            'ksb_mappings': ['K1'], 'section_title': 'Week 6', **activity_schedule('9/9/2026'), **changes}


def native(**changes):
    return {'id': 'new', 'module_id': 'M1', 'module_title': 'Marketing', 'title': 'Apply', 'type': 'reading',
            'ksb_mappings': ['S1'], 'section_title': 'Week 6', **activity_schedule('9/9/2026'), **changes}


class OverviewWeekTests(SimpleTestCase):
    def test_module_ksb_progress_counts_completed_point_occurrences_not_distinct_codes(self):
        current = [native(id='one', ksb_mappings=['K1', 'S1']), native(id='two', ksb_mappings=['K1'])]
        activities = merged_activities([], current, [{'componentId': 'one', 'kind': 'component', 'passed': True}], set(), {})
        result = summarise_plan(activities, [], {'current:M1': 2.5})[0]
        self.assertEqual(result['ksbProgress'], {'completed': 2, 'total': 3})
        self.assertEqual(result['ksbCodes'], ['K1', 'S1'])
        self.assertEqual(result['ksbCodesByMonth'], {'2026-09': ['K1', 'S1']})
        self.assertEqual(result['directHours'], 2.5)
        unavailable = summarise_plan(merged_activities([], [native(ksb_mappings=None)], [], set(), {}), [])[0]
        self.assertIsNone(unavailable['ksbProgress'])

    def test_direct_hours_use_verified_components_and_do_not_guess_from_repeated_titles_or_ambiguous_quizzes(self):
        current = [native(id='linked', quiz_id='shared'), native(id='other', module_id='M2', quiz_id='shared')]
        progress = [
            {'componentId': 'linked', 'kind': 'component', 'claimedSeconds': 3600, 'timeTrackingSource': 'component:input'},
            {'componentId': 'other', 'kind': 'component', 'claimedSeconds': 7200, 'timeTrackingSource': 'component:input'},
            {'quizId': 'shared', 'kind': 'quiz', 'claimedSeconds': 36000, 'timeTrackingSource': 'component:input'},
            {'componentId': 'unknown', 'moduleTitle': 'Marketing', 'kind': 'component', 'claimedSeconds': 36000, 'timeTrackingSource': 'component:input'},
        ]
        self.assertEqual(direct_hours_by_subject(current, progress, {'linked': ('1', '2')}), {'legacy:1': 1, 'current:M2': 2})

    def test_monthly_hours_use_activity_dates_and_real_progress_timestamps(self):
        activities = list(merged_activities(
            [old(expected_hours=2)],
            [native(expected_hours=4), native(id='october', date='2026-10-02', expected_hours=3)],
            [], set(), {'new': ('1', '2')},
        ))
        progress = [
            {'componentId': 'new', 'kind': 'component', 'submittedAt': '2026-09-09T12:00:00Z',
             'claimedSeconds': 5400, 'timeTrackingSource': 'component:input'},
            {'componentId': 'october', 'kind': 'component', 'submittedAt': '2026-10-02T12:00:00Z',
             'claimedSeconds': 3600, 'timeTrackingSource': 'component:input'},
        ]
        self.assertEqual(monthly_otjh_summary(activities, progress), {
            '2026-09': {'planned': 4, 'submitted': 1.5, 'actual': 1.5, 'missingPlannedActivities': 0},
            '2026-10': {'planned': 3, 'submitted': 1, 'actual': 1, 'missingPlannedActivities': 0},
        })

    def test_monthly_planned_hours_stay_unknown_when_an_activity_has_no_hours(self):
        activities = list(merged_activities([], [native(expected_hours=2), native(id='missing')], [], set(), {}))
        self.assertEqual(monthly_otjh_summary(activities, [])['2026-09'], {
            'planned': None, 'submitted': 0, 'actual': 0, 'missingPlannedActivities': 1,
        })

    def test_monthly_hours_separate_submitted_time_from_achieved_time(self):
        activities = list(merged_activities([], [native(expected_hours=4)], [], set(), {}))
        progress = [
            {'componentId': 'new', 'kind': 'component', 'submittedAt': '2026-09-09T12:00:00Z',
             'claimedSeconds': 3600, 'timeTrackingSource': 'component:input'},
            {'quizId': 'failed', 'kind': 'quiz', 'passed': False, 'submittedAt': '2026-09-10T12:00:00Z',
             'claimedSeconds': 1800, 'timeTrackingSource': 'component:input'},
        ]
        self.assertEqual(monthly_otjh_summary(activities, progress)['2026-09'], {
            'planned': 4, 'submitted': 1.5, 'actual': 1, 'missingPlannedActivities': 0,
        })

    def test_monthly_hours_apply_pending_marking_only_to_assignments(self):
        activities = list(merged_activities([], [native(expected_hours=4)], [], set(), {}))
        progress = [{
            'componentId': 'assignment', 'componentType': 'assignment', 'kind': 'component',
            'markingStatus': 'submitted_for_tutor_review',
            'submittedAt': '2026-09-10T12:00:00Z', 'claimedSeconds': 1800,
            'timeTrackingSource': 'component:input',
        }]
        self.assertEqual(monthly_otjh_summary(activities, progress)['2026-09'], {
            'planned': 4, 'submitted': 0.5, 'actual': 0, 'missingPlannedActivities': 0,
        })

    def test_monthly_hours_keep_quiz_submission_semantics_unchanged(self):
        activities = list(merged_activities([], [native(expected_hours=4)], [], set(), {}))
        progress = [{
            'quizId': 'pending', 'kind': 'quiz', 'passed': None,
            'submittedAt': '2026-09-10T12:00:00Z', 'claimedSeconds': 1800,
            'timeTrackingSource': 'component:input',
        }]
        self.assertEqual(monthly_otjh_summary(activities, progress)['2026-09'], {
            'planned': 4, 'submitted': 0.5, 'actual': 0, 'missingPlannedActivities': 0,
        })

    def test_plan_details_count_merged_activities_and_distinct_ksbs_across_all_dates(self):
        current = [native(id='linked', type='quiz', ksb_mappings=['K1', 'S2']),
                   native(id='future', type='live_session', date='2027-01-01', ksb_mappings=['B1', 'S2']),
                   native(id='undated', type='assignment', date=None, ksb_mappings=None)]
        subjects = summarise_plan(merged_activities([old()], current, [], set(), {'linked': ('1', '2')}), [('M1', 'Marketing')])
        old_subject = next(item for item in subjects if item['id'] == 'legacy:1')
        new_subject = next(item for item in subjects if item['id'] == 'current:M1')
        self.assertEqual(old_subject['activityCounts'], {'quiz': 1})
        self.assertEqual(old_subject['ksbCodes'], ['K1', 'S2'])
        self.assertEqual(new_subject['activityCounts'], {'live_session': 1, 'assignment': 1})
        self.assertEqual(new_subject['ksbCodes'], ['B1', 'S2'])
        self.assertTrue(new_subject['ksbMappingMissing'])
        self.assertEqual(sum(sum(item['activityCounts'].values()) for item in subjects), 3)

    def test_plan_summary_exposes_compact_dated_assignments_for_the_monthly_card(self):
        assignments = [
            native(id='essay', type='assignment', title='Professional Practice Essay', expected_hours=10,
                   section_title='Assignment 1', ksb_mappings=['K2', 'S4']),
            native(id='later', type='assignment', title='Case Study Analysis', date='2026-10-02', expected_hours=8),
        ]
        progress = [{'componentId': 'essay', 'kind': 'component', 'passed': True}]
        subject = summarise_plan(merged_activities([], assignments, progress, set(), {}), [])[0]
        september = subject['monthlyActivities'][0]
        self.assertEqual(september, {
            'id': 'native:essay', 'componentId': 'essay', 'title': 'Professional Practice Essay',
            'type': 'assignment', 'date': '2026-09-09', 'weekTitle': 'Assignment 1',
            'expectedHours': 10, 'completed': True, 'ksbCodes': ['K2', 'S4'],
        })
        self.assertEqual(subject['monthlyActivities'][1]['date'], '2026-10-02')

    def test_plan_summary_keeps_all_dates_and_counts_without_activity_content(self):
        historical = [old(), old(activity_id=3, date=None, status='not_started')]
        current = [native(id='linked'), native(id='new', date='2025-01-08')]
        progress = [{'componentId': 'new', 'kind': 'component', 'passed': True}]
        activities = merged_activities(historical, current, progress, set(), {'linked': ('1', '2')})
        subjects = summarise_plan(activities, [('M1', 'Marketing'), ('EMPTY', 'New module')])
        self.assertEqual(sum(item['total'] for item in subjects), 3)
        self.assertEqual(sum(item['completed'] for item in subjects), 2)
        self.assertEqual(next(item for item in subjects if item['id'] == 'legacy:1')['dates'], ['2026-09-09'])
        self.assertEqual(next(item for item in subjects if item['id'] == 'current:M1')['dates'], ['2025-01-08'])
        self.assertEqual(next(item for item in subjects if item['id'] == 'current:EMPTY')['total'], 0)
        self.assertTrue(all('activities' not in item for item in subjects))

    def test_plan_summary_never_merges_repeated_titles_or_counts_failed_quizzes(self):
        current = [native(quiz_id='Q', date_needs_review=True)]
        activities = merged_activities([old()], current, [{'quizId': 'Q', 'kind': 'quiz', 'passed': False}], set(), {})
        subjects = summarise_plan(activities, [('M1', 'Marketing')])
        self.assertEqual(len(subjects), 2)
        new = next(item for item in subjects if item['source'] == 'current')
        self.assertEqual((new['total'], new['completed'], new['dates']), (1, 0, []))

    def summary(self, historical=None, current=None, progress=None, attempts=None, links=None):
        return summarise_week(historical or [], current or [], progress or [], attempts or set(), links or {}, START, END)

    def test_only_modules_with_current_week_activities_are_selectable(self):
        current = [native(id='this-week', expected_hours=2),
                   native(id='other', module_id='M2', module_title='Other weekly module', expected_hours=3),
                   native(id='future', module_id='FUTURE', date='2027-02-15', expected_hours=20),
                   native(id='overdue', module_id='PAST', date='2026-09-06', expected_hours=30)]
        result = self.summary(current=current)
        self.assertEqual({item['id'] for item in result['modules']}, {'current:M1', 'current:M2'})
        self.assertEqual(result['expectedHours'], 5)
        self.assertEqual(sum(item['total'] for item in result['modules']), 2)

    def test_empty_week_does_not_fall_back_to_future_or_unfinished_past_activities(self):
        result = self.summary([old(date='2026-09-06', status='not_started')],
                              [native(date='2027-02-15')])
        self.assertEqual(result['modules'], [])
        self.assertIsNone(result['expectedHours'])

    def test_week_moves_forward_even_when_previous_week_is_unfinished(self):
        current = [native(id='unfinished', expected_hours=2),
                   native(id='next', module_id='NEXT', date='2026-09-14', expected_hours=3)]
        previous = self.summary(current=current)
        self.assertEqual(previous['modules'][0]['completed'], 0)
        start, end = week_bounds(datetime(2026, 9, 13, 23, 30, tzinfo=timezone.utc))
        result = summarise_week([], current, [], set(), {}, start, end)
        self.assertEqual([item['id'] for item in result['modules']], ['current:NEXT'])
        self.assertEqual(result['expectedHours'], 3)
        # Leaving the weekly focus does not remove unfinished work from the plan.
        plan = summarise_plan(merged_activities([], current, [], set(), {}), [])
        self.assertEqual(next(item for item in plan if item['id'] == 'current:M1')['completed'], 0)

    def test_explicit_old_new_identity_keeps_completion_and_unions_ksbs(self):
        result = self.summary([old()], [native()], links={'new': ('1', '2')})
        self.assertEqual(len(result['modules']), 1)
        self.assertEqual(result['modules'][0]['total'], 1)
        self.assertEqual(result['modules'][0]['completed'], 1)
        self.assertEqual(result['modules'][0]['ksbCodes'], ['K1', 'S1'])
        self.assertEqual(result['modules'][0]['moduleIds'], ['M1'])

    def test_same_module_title_never_merges_unlinked_subjects(self):
        self.assertEqual(len(self.summary([old()], [native()])['modules']), 2)

    def test_new_completion_is_dynamic_and_failed_quiz_does_not_count(self):
        rows = [native(id='a', quiz_id='9'), native(id='b')]
        progress = [{'componentId': 'b', 'kind': 'component', 'passed': False}, {'quizId': '9', 'kind': 'quiz', 'passed': None}]
        self.assertEqual(self.summary(current=rows, progress=progress)['modules'][0]['completed'], 0)
        progress.append({'quizId': '9', 'kind': 'quiz', 'passed': True})
        self.assertEqual(self.summary(current=rows, progress=progress)['modules'][0]['completed'], 1)

    def test_new_subject_attempt_adds_to_historical_completion(self):
        result = self.summary([old(status='notstarted')], attempts={('1', '2')})
        self.assertEqual(result['modules'][0]['percent'], 100)

    def test_undated_import_timestamp_is_not_this_week(self):
        result = self.summary([old(date_needs_review=True)], [native(date=None)])
        self.assertEqual(result['modules'], [])
        self.assertEqual(result['undatedActivities'], 2)

    def test_rescheduling_builder_activity_removes_old_week_placement(self):
        result = self.summary([old()], [native(**activity_schedule('16/9/2026'))], links={'new': ('1', '2')})
        self.assertEqual(result['modules'], [])

    def test_only_authored_due_rule_produces_deadline(self):
        result = self.summary(current=[native(id='a', type='assignment'), native(id='b', type='checkpoint', due_timing='End of week')])
        self.assertEqual([d['id'] for d in result['deadlines']], ['native:b'])
        self.assertEqual(result['deadlines'][0]['date'], '2026-09-13')

    def test_completed_assignment_has_no_upcoming_deadline(self):
        result = self.summary(current=[native(type='assignment', due_timing='End of week')], progress=[{'kind': 'component', 'componentId': 'new'}])
        self.assertEqual(result['deadlines'], [])

    def test_missing_ksb_mapping_does_not_claim_zero_coverage(self):
        self.assertTrue(self.summary([old(ksb_mappings=None)])['modules'][0]['ksbMappingMissing'])

    def test_week_rolls_over_in_uk_time_not_server_timezone(self):
        value = datetime(2026, 9, 13, 23, 30, tzinfo=timezone.utc)
        self.assertEqual(week_bounds(value), (date(2026, 9, 14), date(2026, 9, 20)))
        self.assertEqual(progress_day('2026-09-13T23:30:00Z'), date(2026, 9, 14))
        self.assertIsNone(progress_day('invalid'))

    def test_expected_hours_sum_the_week_and_dedupe_old_new_identity(self):
        result = self.summary([old(expected_hours=2), old(group_id=3, expected_hours=2)],
                              [native(expected_hours=4)], links={'new': ('1', '2')})
        self.assertEqual(result['expectedHours'], 4)
        self.assertEqual(self.summary(current=[native(expected_hours=0)])['expectedHours'], 0)

    def test_missing_expected_hours_do_not_become_zero(self):
        result = self.summary([old()], [native(expected_hours=2)])
        self.assertIsNone(result['expectedHours'])
        self.assertEqual(result['missingExpectedHours'], 1)
        self.assertIsNone(self.summary()['expectedHours'])

    def test_new_learner_reads_only_native_sources_and_weekly_recorded_hours(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('M1', 'Marketing')]
        progress = [{'componentId': 'new', 'kind': 'component', 'submittedAt': '2026-09-09T12:00:00Z',
                     'claimedSeconds': 3600, 'timeTrackingSource': 'component:input'},
                    {'componentId': 'older', 'kind': 'component', 'submittedAt': '2026-09-01T12:00:00Z',
                     'claimedSeconds': 7200, 'timeTrackingSource': 'component:input'}]
        with patch('learner_api.overview_week.connections', {'enrolment': connection}), \
             patch('learner_api.overview_week.rows', return_value=[native(title='9/9/2026', expected_hours=2)]), \
             patch('learner_api.overview_week.read_builder_activity_dates', return_value={'new': activity_schedule('9/9/2026')}) as dates, \
             patch('learner_api.overview_week._direct_progress_records', return_value=progress), \
             patch('learner_api.overview_week.read_curriculum_schedules') as imported:
            result = read_week(SimpleNamespace(pk=125, aptem_id=None), datetime(2026, 9, 12, tzinfo=timezone.utc))
        self.assertEqual(result['otjh']['actual'], 1)
        self.assertEqual(result['expectedHours'], 2)
        self.assertEqual(result['monthlyOtjh']['2026-09'], {
            'planned': 2, 'actual': 3, 'missingPlannedActivities': 0,
        })
        self.assertEqual(result['modules'][0]['completed'], 1)
        self.assertNotIn('latestModuleId', result)
        dates.assert_called_once_with(cursor, ['M1'])
        imported.assert_not_called()
        self.assertTrue(all('Last_audit' not in call.args[0] for call in cursor.execute.call_args_list))

    def test_read_week_uses_builder_delivery_dates_and_keeps_future_modules_in_full_plan_only(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('M1', 'Marketing'), ('FUTURE', 'Future module'), ('EMPTY', 'Empty module')]
        current = [native(id='this-week', title='Reading without a date', expected_hours=2),
                   native(id='future', module_id='FUTURE', title='Future reading', expected_hours=20)]
        dates = {'this-week': activity_schedule('9/9/2026'), 'future': activity_schedule('15/2/2027')}
        with patch('learner_api.overview_week.connections', {'enrolment': connection}), \
             patch('learner_api.overview_week.rows', return_value=current), \
             patch('learner_api.overview_week.read_builder_activity_dates', return_value=dates) as calendar, \
             patch('learner_api.overview_week._direct_progress_records', return_value=[]):
            result = read_week(SimpleNamespace(pk=125, aptem_id=None), datetime(2026, 9, 12, tzinfo=timezone.utc))
        calendar.assert_called_once_with(cursor, ['M1', 'FUTURE', 'EMPTY'])
        self.assertEqual([item['id'] for item in result['modules']], ['current:M1'])
        self.assertEqual(result['modules'][0]['total'], 1)
        self.assertEqual(result['expectedHours'], 2)
        self.assertEqual({item['id'] for item in result['planSubjects']}, {'current:M1', 'current:FUTURE', 'current:EMPTY'})
        self.assertEqual(next(item for item in result['planSubjects'] if item['id'] == 'current:FUTURE')['dates'], ['2027-02-15'])

    def test_endpoint_uses_enrolment_identity_and_private_no_store(self):
        source = SimpleNamespace(pk=125)
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        model.all_learners.only.return_value.get.return_value = source
        with patch.dict('learner_api.overview_week.SOURCE_MODELS', {'commercial': model}), patch('learner_api.overview_week.read_week', return_value={'modules': []}) as reader:
            response = overview_week.__wrapped__.__wrapped__(RequestFactory().get('/?aptem_id=999'), 'commercial', 125)
        reader.assert_called_once_with(source)
        model.all_learners.only.return_value.get.assert_called_once_with(pk=125)
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_endpoint_errors_are_retryable_without_sql_details(self):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        with patch.dict('learner_api.overview_week.SOURCE_MODELS', {'commercial': model}), patch('learner_api.overview_week.read_week', side_effect=DatabaseError('private SQL')):
            response = overview_week.__wrapped__.__wrapped__(RequestFactory().get('/'), 'commercial', 125)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private SQL', json.loads(response.content)['error'])
