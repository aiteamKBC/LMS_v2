"""Weekly performance regressions: synthetic records, database access forbidden."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import canonical_learning, weekly_hours
from .current_learning import current_records


def payload_size_report():
    """Reproducible wire-size comparison, synthetic programme, not live timing."""
    import gzip
    import json
    from coach_api.weekly_learning import week_rows
    from coach_api.weekly_contract import compact_weekly
    slots = [{'slotNumber': number, 'sessionNumber': number, 'type': 'live-session',
              'date': (date(2026, 10, 5) + timedelta(weeks=number - 1)).isoformat(),
              'weekId': f'W{number}', 'weekTitle': f'Week {number}'} for number in range(1, 53)]
    weeks = week_rows([{'id': 'M1', 'title': 'Synthetic module', 'curriculumSlots': slots}], '2026-10-07')
    selected = {**weeks[0], 'summary': {'completedActivities': 4, 'totalActivities': 8, 'progress': 50,
                'ksbCount': 2, 'achievedKsbCount': 1, 'otjhHours': 2, 'plannedOtjhHours': 4, 'untimedActivities': 0},
                'liveSession': None, 'activities': [{'id': f'C{i}', 'title': f'Reading {i}', 'type': 'reading',
                'completed': i < 4, 'status': 'completed' if i < 4 else 'not-started', 'isQuiz': False,
                'expectedHours': 0.5, 'actualHours': 0.5 if i < 4 else 0, 'durationMinutes': 30,
                'quizDuration': None, 'quizTimeUnit': None, 'ksbCodes': ['K1'], 'contentAvailable': True} for i in range(8)]}
    weeks[0].update(completedActivities=4, totalActivities=8, progress=50)
    selected.update(completedActivities=4, totalActivities=8, progress=50)
    before = {'weeks': weeks, 'selectedWeek': selected}
    after = compact_weekly(weeks=weeks, selected=selected, summary={key: value for key, value in selected['summary'].items() if key not in {'completedActivities', 'totalActivities', 'progress'}}, activities=[{key: value for key, value in activity.items() if key != 'completed'} for activity in selected['activities']])
    result = {}
    for label, payload in [('before', before), ('after', after)]:
        encoded = json.dumps(payload).encode('utf-8')
        result[label] = {'json_bytes': len(encoded), 'gzip_bytes': len(gzip.compress(encoded, mtime=0))}
    return result


class WeeklyCompactContractTests(SimpleTestCase):
    def test_sizes_use_identical_synthetic_weeks_and_selected_activities(self):
        report = payload_size_report()
        self.assertLess(report['after']['json_bytes'], report['before']['json_bytes'])
        print('Weekly synthetic 52-week/8-selected-activity bytes:', report)

    def test_canonical_references_navigation_and_preserves_holidays_actions_and_null_hours(self):
        from coach_api.weekly_contract import compact_weekly
        holiday = {'id': 'H1', 'label': 'College', 'startDate': '2026-12-27', 'endDate': '2026-12-29'}
        navigation = {'id': 'M1:1', 'moduleId': 'M1', 'moduleTitle': 'Module', 'kind': 'reading-week',
                      'slotNumber': 1, 'holidays': [holiday], 'sessionState': 'unmarked', 'attended': None}
        selected = {**navigation, 'summary': {'completedActivities': 0, 'totalActivities': 0, 'progress': 0,
                    'otjhHours': None}, 'liveSession': None, 'activities': []}
        before = {'weeks': [navigation], 'selectedWeek': selected}
        result = compact_weekly(weeks=[navigation], selected=navigation, summary={'otjhHours': None})
        self.assertNotIn('version', result)
        self.assertEqual(result['selectedWeek']['weekId'], 'M1:1')
        self.assertNotIn('holidays', result['selectedWeek'])
        self.assertEqual(result['weeks'][0]['holidays'], [holiday])
        self.assertEqual(result['weeks'][0]['attendance'], 'unmarked')
        self.assertIsNone(result['selectedWeek']['summary']['otjhHours'])
        detail = compact_weekly(weeks=[navigation], selected=navigation, summary={'otjhHours': None})
        self.assertEqual(detail['weeks'][0]['id'], 'M1:1')
        self.assertEqual(set(detail), {'modules', 'weeks', 'selectedWeek'})
        self.assertIn('attended', selected)  # serializer never mutates legacy contracts


class WeeklyHoursProjectionTests(SimpleTestCase):
    def test_hours_projection_matches_canonical_across_types_and_lineages(self):
        at = datetime(2026, 10, 5, 9, tzinfo=timezone.utc)
        for kind in ('commercial', 'apprenticeship'):
            for lineage in ('old_lms', None):  # Native direct saves have no source_system.
                with self.subTest(kind=kind, lineage=lineage):
                    owner = {'id': 901, 'enrolment_id': 902, 'learner_type': kind}
                    base = dict(learner_id=owner['id'], kind='component', module_ref='module-alpha',
                                component_ref='activity-alpha', component_type='reading',
                                component_link_source='direct', submitted_at=at, source_system=lineage,
                                actual_seconds=None, accepted=None, passed=None, verified_seconds=1800)
                    records = [dict(base, id=1), dict(base, id=2, verified_seconds=3600),
                               dict(base, id=3, module_ref='module-beta', component_ref='activity-beta',
                                    verified_seconds=900),
                               dict(base, id=4, component_ref='assignment-alpha', component_type='assignment',
                                    actual_seconds=1200, accepted=True, actual_basis='staff:module-progress')]
                    with patch('learner_api.current_learning.query', return_value=[]):
                        expected = canonical_learning.progress_records_with_completion(records, current_records(owner, records))
                    with patch.object(canonical_learning, 'query', side_effect=[records, []]) as query:
                        actual = canonical_learning.weekly_hour_records(owner)
                    modules = [{'id': mid, 'title': mid} for mid in ('module-alpha', 'module-beta')]
                    self.assertEqual(weekly_hours.module_activity_hours(actual, modules),
                                     weekly_hours.module_activity_hours(expected, modules))
                    self.assertEqual(query.call_args_list[0].args[1], [owner['id'], owner['id']])

    def test_narrow_hours_preserve_native_dedupe_manual_corrections_and_history(self):
        at = datetime(2026, 10, 5, 9, tzinfo=timezone.utc)
        base = dict(learner_id=17, kind='component', component_link_source='direct',
                    submitted_at=at, actual_seconds=None, accepted=None, passed=None,
                    module_ref='M1', component_ref='C1', verified_seconds=1800)
        records = [dict(base, id=1), dict(base, id=2, verified_seconds=3600),
                   dict(base, id=3, component_ref='C2', source_system='old_lms',
                        source_payload={'original_source_ref': 'progress:4'}, actual_seconds=900, accepted=True),
                   dict(base, id=4, component_ref='C2'),
                   dict(base, id=5, component_ref='C3', actual_seconds=1200, accepted=True,
                        actual_basis='staff:module-progress'), dict(base, id=6, component_ref='C3'),
                   dict(base, id=7, component_ref='C4', segments=[{'id': 1}]),
                   dict(base, id=8, component_ref='A1', component_type='assignment')]
        markings = [{'id': 99, 'component_ref': 'A1', 'status': 'accepted', 'actual_time_hours': '0.75'}]
        owner = {'id': 17, 'enrolment_id': 201, 'learner_type': 'commercial'}
        with patch('learner_api.current_learning.query', return_value=markings):
            expected = canonical_learning.progress_records_with_completion(records, current_records(owner, records))
        with patch.object(canonical_learning, 'query', side_effect=[records, markings]) as query:
            actual = canonical_learning.weekly_hour_records(owner)
        modules = [{'id': 'M1', 'title': 'Module'}]
        self.assertEqual(weekly_hours.module_activity_hours(actual, modules),
                         weekly_hours.module_activity_hours(expected, modules))
        self.assertEqual(weekly_hours.module_activity_hours(actual, modules)['M1']['components'],
                         {'C1': 1, 'C2': 0.25, 'C3': 1 / 3, 'A1': 0.75})
        sql = query.call_args_list[0].args[0]
        self.assertNotIn('progress.*', sql)
        self.assertNotIn('jsonb_agg', sql)
        self.assertIn('progress.learner_id=%s', sql)
        self.assertIn('s.learner_id=progress.learner_id AND s.learner_id=%s', sql)
        self.assertEqual(query.call_args_list[0].args[1], [17, 17])
        self.assertEqual(query.call_args_list[1].args[1][-1], ['A1'])

    def test_hours_without_pending_assignments_need_no_submission_query(self):
        with patch.object(canonical_learning, 'query', return_value=[]) as query:
            self.assertEqual(canonical_learning.weekly_hour_records({'id': 17}), [])
        query.assert_called_once()

    def test_indexed_activity_hours_preserve_ambiguous_quiz_attribution(self):
        components = [{'id': 'A', 'quiz_id': 4}, {'id': 'B', 'quiz_id': 4}, {'id': 'C', 'quiz_id': 5}]
        hours = {'components': {'A': 1, 'C': 0.25}, 'quizzes': {'4': 8, '5': 0.5}}
        lookup = weekly_hours.activity_hours_index(hours, components)
        for selected in [components[:1], components[1:2], components[2:], components]:
            self.assertEqual(round(sum(lookup[str(row['id'])] for row in selected), 4),
                             weekly_hours.selected_activity_hours(hours, selected, components))


class WeeklyCalendarTests(SimpleTestCase):
    def test_explicit_session_override_and_module_closure_do_not_change_other_modules(self):
        from curriculum_api.views import module_session_plan_for_count
        module = {'start_date': date(2026, 10, 19), 'session_week_day': 'Monday',
                  'session_start_time': '09:00', 'session_end_time': '10:00',
                  'session_holidays': [{'id': 'own', 'label': 'Module closure', 'startDate': '2026-10-19'}],
                  'session_overrides': {'2': {'date': '2026-10-27', 'startTime': '09:00', 'endTime': '10:00', 'durationMinutes': 60}}}
        plan = module_session_plan_for_count(module, 2, holidays=[])
        self.assertEqual([slot['date'] for slot in plan['slots']], ['2026-10-19', '2026-10-27'])
        self.assertEqual(plan['slots'][0]['holidays'][0]['label'], 'Module closure')
        other = module_session_plan_for_count({**module, 'session_holidays': [], 'session_overrides': {}}, 2, holidays=[])
        self.assertEqual([slot['date'] for slot in other['slots']], ['2026-10-19', '2026-10-26'])
        self.assertEqual(other['slots'][0]['holidays'], [])

    def test_overlapping_official_and_college_holidays_keep_both_labels_once_per_day(self):
        from curriculum_api.views import holiday_date_set, holiday_details_by_date, build_module_session_plan
        holidays = [{'id': 'official', 'label': 'Bank holiday', 'startDate': '2026-12-28', 'endDate': '2026-12-28'},
                    {'id': 'college', 'label': 'College closure', 'startDate': '2026-12-27', 'endDate': '2026-12-29'}]
        self.assertEqual(len(holiday_date_set(holidays)), 3)
        details = holiday_details_by_date(holidays)
        self.assertEqual(len(details[date(2026, 12, 28)]), 2)
        plan = build_module_session_plan('2026-12-28', 2, 'Monday', holidays)
        self.assertEqual([row['date'] for row in plan['slots']], ['2026-12-28', '2027-01-04'])
        self.assertEqual(plan['slots'][0]['type'], 'live-session')
        self.assertEqual(len(plan['slots'][0]['holidays']), 2)

    def test_strict_holiday_resolution_does_not_turn_failure_into_empty_calendar(self):
        from .weekly_calendar import cohort_holidays
        with patch('curriculum_api.views.fetch_all', side_effect=DatabaseError('offline')), \
             patch('curriculum_api.views.table_exists', return_value=True), \
             patch('curriculum_api.views.authored_holiday_table_name', return_value='curriculum.holidays'):
            with self.assertRaises(DatabaseError):
                cohort_holidays(['C1'])

    def test_cohort_exclusions_and_empty_calendar_are_distinct_from_failure(self):
        from .weekly_calendar import cohort_holidays
        holidays = [{'id': 'H1', 'label': 'Excluded', 'start_date': date(2026, 10, 19)},
                    {'id': 'H2', 'label': 'Retained', 'start_date': date(2026, 10, 26)}]
        cohort = {'cohort_id': 'C1', 'start_date': date(2026, 10, 1), 'excluded_holiday_ids': ['H1']}
        envelopes = [{'source': 'cohort', 'payload': cohort},
                     *[{'source': 'authored', 'payload': row} for row in holidays],
                     {'source': 'authored', 'payload': {'id': 'H3', 'label': 'Archived',
                         'start_date': date(2026, 10, 26), 'status': 'archived'}}]
        with patch('curriculum_api.views.fetch_all', return_value=envelopes) as read, \
             patch('curriculum_api.views.table_exists', return_value=True), \
             patch('curriculum_api.views.authored_holiday_table_name', return_value='curriculum.holidays'):
            result = cohort_holidays(['C1'])
            read.assert_called_once()
            self.assertIn('UNION ALL', read.call_args.args[0])
        self.assertEqual([row['id'] for row in result['C1']], ['H2'])
        self.assertEqual(cohort_holidays([]), {})

    def test_module_closures_and_reading_overrides_are_passed_to_scheduler(self):
        from . import training_plan_dashboard as schedule
        module = {'id': 'M1', 'cohort_id': 'C1', 'session_holidays': [{'date': '2026-10-19'}],
                  'session_overrides': {'1': {'type': 'reading-week'}}, 'weeks_number': 2}
        result = {'M1': {}}
        with patch('curriculum_api.views.module_stored_session_count', return_value=2), \
             patch('curriculum_api.views.module_session_plan_for_count', return_value={'slots': []}) as plan:
            schedule.attach_curriculum_slots([module], result, {}, strict=True, holiday_loader=lambda ids: {'C1': []})
        self.assertIs(plan.call_args.args[0], module)
        self.assertEqual(plan.call_args.kwargs['holidays'], [])


class WeeklyAttendanceTests(SimpleTestCase):
    def test_canonical_attendance_is_separate_from_lifecycle(self):
        from coach_api.weekly_contract import learner_attendance
        for state, attended, expected in [('unmarked', None, 'unmarked'), ('missed', False, 'absent'),
                                         ('attended', True, 'present'), ('upcoming', True, 'upcoming'),
                                         ('live', None, 'unmarked'), ('unscheduled', None, 'unmarked')]:
            self.assertEqual(learner_attendance({'sessionState': state, 'attended': attended}), expected)
