"""Raw SQL calendar regressions; all database reads are test doubles."""
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from curriculum_api.views import module_session_plan_for_count
from curriculum_api.weekly_schedule import normalise_weekly_schedule
from .weekly_calendar import normalise_projected_calendar


class WeeklyJsonNullTests(SimpleTestCase):
    module = {
        'id': 'MOD-20260911110642658914', 'title': 'Synthetic module',
        'start_date': date(2026, 10, 1), 'end_date': date(2026, 11, 30),
        'weeks_number': 2, 'sessions_number': 2, 'cohort_id': None,
        'session_week_day': 'Thursday', 'session_start_time': '09:00',
        'session_end_time': '11:00',
    }

    def plan(self, **values):
        return module_session_plan_for_count(normalise_projected_calendar({**self.module, **values}), 2, holidays=[])

    def test_sql_and_json_null_match_canonical_thursday_fallback(self):
        expected = module_session_plan_for_count(self.module, 2, holidays=[])
        for value in (None, 'null', ' null '):
            with self.subTest(value=value):
                actual = self.plan(weekly_schedule=value)
                self.assertEqual(actual, expected)
                self.assertEqual(actual['sessions'][0]['day'], 'Thursday')
                self.assertEqual(actual['sessions'][0]['startTime'], '09:00')
                self.assertEqual(actual['sessions'][0]['endTime'], '11:00')

    def test_custom_schedule_retains_canonical_plan(self):
        slots = [{'day': 'Tuesday', 'startTime': '13:00', 'endTime': '14:00'}]
        self.assertEqual(self.plan(weekly_schedule=json.dumps(slots)), self.plan(weekly_schedule=slots))
        self.assertEqual(self.plan(weekly_schedule=slots)['sessions'][0]['day'], 'Tuesday')

    def test_invalid_schedules_still_reach_strict_validator(self):
        for value in (json.dumps([{}] * 8), '[broken', '{}', 'false', '"null"'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.plan(weekly_schedule=value)
        with self.assertRaises(ValueError):
            normalise_weekly_schedule('null')  # validator itself remains strict

    def test_null_holidays_and_overrides_match_absent_fields(self):
        for value in (None, 'null'):
            self.assertEqual(self.plan(session_holidays=value, session_overrides=value), self.plan())

    def test_valid_holidays_and_overrides_match_native_calendar(self):
        holidays = [{'id': 'H1', 'label': 'Synthetic closure', 'startDate': '2026-10-01'}]
        overrides = {'2': {'date': '2026-10-09', 'startTime': '10:00', 'endTime': '11:00', 'durationMinutes': 60}}
        self.assertEqual(self.plan(session_holidays=json.dumps(holidays), session_overrides=json.dumps(overrides)),
                         self.plan(session_holidays=holidays, session_overrides=overrides))
        actual = self.plan(session_holidays=json.dumps(holidays), session_overrides=json.dumps(overrides))
        self.assertEqual(actual['slots'][0]['holidays'][0]['id'], 'H1')
        self.assertEqual(actual['sessions'][1]['date'], '2026-10-09')

    def test_projection_decodes_without_mutating_source(self):
        original = {**self.module, 'weekly_schedule': 'null'}
        self.assertIsNone(normalise_projected_calendar(original)['weekly_schedule'])
        self.assertEqual(original['weekly_schedule'], 'null')

    def test_api_null_boundary_returns_200_but_invalid_schedule_returns_503(self):
        from . import dashboard_weekly as weekly
        view = weekly.dashboard_weekly
        while hasattr(view, '__wrapped__'):
            view = view.__wrapped__
        model = MagicMock()
        model.DoesNotExist = type('MissingSource', (Exception,), {})
        for value, status in (('null', 200), ('[broken', 503), (json.dumps([{}] * 8), 503)):
            def read(*args, **kwargs):
                plan = self.plan(weekly_schedule=value)
                return {'weeks': plan['slots'], 'selectedWeek': None}
            with self.subTest(value=value), \
                 patch.dict(weekly.SOURCE_MODELS, {'commercial': model}), \
                 patch.object(weekly, 'assignment_projection', return_value=MagicMock()), \
                 patch.object(weekly, 'read_dashboard_weekly', side_effect=read):
                response = view(RequestFactory().get('/weekly'), 'commercial', 101)
            self.assertEqual(response.status_code, status)

    def test_assigned_module_and_multi_module_navigation_use_real_scheduler(self):
        from coach_api.weekly_learning import read_weekly_learning
        modules = [{**self.module, 'weekly_schedule': 'null', 'session_holidays': 'null', 'session_overrides': 'null'},
                   {**self.module, 'id': 'OTHER', 'title': 'Other module', 'weekly_schedule': 'null'}]
        ids = [row['id'] for row in modules]
        authored = [{'id': f'{mid}-W{i}', 'module_catalogue_id': mid, 'week_number': i,
                     'title': f'Week {i}', 'holiday_note_enabled': False} for mid in ids for i in (1, 2)]
        source = SimpleNamespace(pk=101, email='synthetic@example.test', _canonical_profile={'id': 248})
        profile = MagicMock()
        profile.progress_entries.filter.return_value.filter.return_value.values.return_value = []
        context = SimpleNamespace(source=source, profile=profile)
        for mid in ids:
            with self.subTest(module=mid), \
                 patch('coach_api.weekly_learning.connections'), \
                 patch('coach_api.weekly_learning.read_weekly_live_evidence', return_value=([], [])), \
                 patch('learner_api.selectors.assignments._effective_plan_ids', return_value=ids), \
                 patch('learner_api.canonical_learning.curriculum_module_ids_for', return_value=[]), \
                 patch('learner_api.canonical_learning.weekly_hour_records', return_value=[]), \
                 patch('learner_api.training_plan_dashboard.rows', side_effect=[modules, authored, [], [], []]), \
                 patch('learner_api.weekly_calendar.cohort_holidays', return_value={}):
                result = read_weekly_learning(context, module_id=mid)
            self.assertEqual({row['moduleId'] for row in result['weeks']}, set(ids))
            self.assertEqual(len(result['weeks']), 4)
            self.assertEqual(next(week['moduleId'] for week in result['weeks'] if week['id'] == result['selectedWeek']['weekId']), mid)
