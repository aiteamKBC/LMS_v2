"""Weekly overview regressions. SimpleTestCase prohibits database access."""
from datetime import date, datetime, timezone
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory
from .overview_week import summarise_week, week_bounds, progress_day, overview_week, read_week, focus_latest_module, merged_activities, summarise_plan
from .subject_dates import activity_schedule

START, END = date(2026, 9, 7), date(2026, 9, 13)


def old(**changes):
    return {'group_id': 1, 'activity_id': 2, 'module_title': 'Marketing', 'title': 'Learn', 'status': 'completed',
            'ksb_mappings': ['K1'], 'section_title': 'Week 6', **activity_schedule('9/9/2026'), **changes}


def native(**changes):
    return {'id': 'new', 'module_id': 'M1', 'module_title': 'Marketing', 'title': 'Apply', 'type': 'reading',
            'ksb_mappings': ['S1'], 'section_title': 'Week 6', **activity_schedule('9/9/2026'), **changes}


class OverviewWeekTests(SimpleTestCase):
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

    def test_newest_assigned_module_is_visible_without_this_week_activities(self):
        summary = self.summary([old(expected_hours=2)])
        result = focus_latest_module(summary, ('NEW', 'Latest module'))
        self.assertEqual(result['latestModuleId'], 'current:NEW')
        self.assertEqual(result['modules'][0]['moduleIds'], ['NEW'])
        self.assertEqual(result['modules'][0]['total'], 0)
        self.assertIsNone(result['modules'][0]['percent'])
        self.assertEqual(result['expectedHours'], 2)

    def test_newest_module_uses_merged_historical_identity_without_duplicate(self):
        summary = self.summary([old()], [native()], links={'new': ('1', '2')})
        result = focus_latest_module(summary, ('M1', 'Latest module'))
        self.assertEqual(result['latestModuleId'], 'legacy:1')
        self.assertEqual(len(result['modules']), 1)
        self.assertEqual(result['modules'][0]['title'], 'Latest module')

    def test_cleared_plan_does_not_keep_a_stale_latest_module(self):
        summary = self.summary([old()])
        self.assertIsNone(focus_latest_module(summary, None)['latestModuleId'])

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
        cursor.fetchone.return_value = ('M1', 'Marketing')
        progress = [{'componentId': 'new', 'kind': 'component', 'submittedAt': '2026-09-09T12:00:00Z',
                     'claimedSeconds': 3600, 'timeTrackingSource': 'component:input'},
                    {'componentId': 'older', 'kind': 'component', 'submittedAt': '2026-09-01T12:00:00Z',
                     'claimedSeconds': 7200, 'timeTrackingSource': 'component:input'}]
        with patch('learner_api.overview_week.connections', {'enrolment': connection}), \
             patch('learner_api.overview_week.rows', return_value=[native(title='9/9/2026', expected_hours=2)]), \
             patch('learner_api.overview_week._direct_progress_records', return_value=progress), \
             patch('learner_api.overview_week.read_curriculum_schedules') as imported:
            result = read_week(SimpleNamespace(pk=125, aptem_id=None), datetime(2026, 9, 12, tzinfo=timezone.utc))
        self.assertEqual(result['otjh']['actual'], 1)
        self.assertEqual(result['expectedHours'], 2)
        self.assertEqual(result['modules'][0]['completed'], 1)
        self.assertEqual(result['latestModuleId'], 'current:M1')
        latest_query = cursor.execute.call_args_list[1]
        self.assertIn('WHERE module_catalogue_id=ANY(%s)', latest_query.args[0])
        self.assertIn('ORDER BY created_at DESC', latest_query.args[0])
        self.assertNotIn('updated_at', latest_query.args[0])
        self.assertEqual(latest_query.args[1], [['M1']])
        imported.assert_not_called()
        self.assertTrue(all('Last_audit' not in call.args[0] for call in cursor.execute.call_args_list))

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
