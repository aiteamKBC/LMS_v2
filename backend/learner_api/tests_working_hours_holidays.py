"""Learner working-hours holidays use the canonical cohort-scoped resolver."""
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from .working_hours_holidays import (
    component_holiday_ranges,
    is_working_hours_holiday,
    working_hours_holidays,
)


class WorkingHoursHolidayTests(SimpleTestCase):
    def test_component_ranges_preserve_contract_and_do_not_duplicate_a_day(self):
        details = {
            date(2026, 12, 25): [
                {'label': 'Christmas Day'},
                {'label': 'Overlapping duplicate'},
            ],
            date(2026, 12, 28): [{'label': 'Boxing Day'}],
        }
        with patch('learner_api.working_hours_holidays.learner_holiday_details', return_value=details):
            ranges = component_holiday_ranges('COMP-1')
        self.assertEqual(ranges, [
            {'start': '2026-12-25', 'end': '2026-12-25', 'label': 'Christmas Day'},
            {'start': '2026-12-28', 'end': '2026-12-28', 'label': 'Boxing Day'},
        ])

    def test_holiday_predicate_is_scoped_to_the_named_component(self):
        details = {date(2026, 12, 25): [{'label': 'Christmas Day'}]}
        with patch('learner_api.working_hours_holidays.learner_holiday_details', return_value=details) as resolver:
            self.assertTrue(is_working_hours_holiday(date(2026, 12, 25), component_id='COMP-1'))
            self.assertFalse(is_working_hours_holiday(date(2026, 12, 24), component_id='COMP-1'))
        resolver.assert_called_with('COMP-1', quiz_id=None)

    def test_unscoped_calendar_is_empty_instead_of_global(self):
        with patch('learner_api.working_hours_holidays.learner_holiday_details') as resolver:
            self.assertFalse(is_working_hours_holiday(date(2026, 12, 25)))
        resolver.assert_not_called()

    def test_endpoint_returns_the_scoped_calendar_to_authenticated_users(self):
        request = RequestFactory().get('/learner_api/working-hours/holidays/?componentId=COMP-1')
        details = {date(2026, 12, 25): [{'label': 'Christmas Day'}]}
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner')), \
                patch('learner_api.working_hours_holidays.learner_holiday_details', return_value=details):
            response = working_hours_holidays(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'holidays': [
            {'start': '2026-12-25', 'end': '2026-12-25', 'label': 'Christmas Day'},
        ]})

    def test_missing_or_invalid_activity_has_no_cohort_holidays(self):
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner')), \
                patch('learner_api.working_hours_holidays.learner_holiday_details', return_value={}):
            invalid = working_hours_holidays(
                RequestFactory().get('/learner_api/working-hours/holidays/?componentId=missing')
            )
            unscoped = working_hours_holidays(
                RequestFactory().get('/learner_api/working-hours/holidays/')
            )
        self.assertEqual(json.loads(invalid.content), {'holidays': []})
        self.assertEqual(json.loads(unscoped.content), {'holidays': []})

    def test_quiz_scope_uses_the_same_response_contract(self):
        details = {date(2026, 8, 31): [{'label': 'Summer bank holiday'}]}
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner')), \
                patch('learner_api.working_hours_holidays.learner_holiday_details', return_value=details) as resolver:
            response = working_hours_holidays(
                RequestFactory().get('/learner_api/working-hours/holidays/?quizId=77')
            )
        self.assertEqual(response.status_code, 200)
        resolver.assert_called_once_with('', quiz_id='77')

    def test_anonymous_requests_are_denied(self):
        with patch('login.permissions.authenticate_request', return_value=None):
            response = working_hours_holidays(RequestFactory().get('/learner_api/working-hours/holidays/'))
        self.assertEqual(response.status_code, 401)

    def test_database_failure_returns_a_sanitized_503(self):
        with patch(
            'learner_api.working_hours_holidays.learner_holiday_details',
            side_effect=DatabaseError('relation curriculum.calendar_holidays does not exist'),
        ):
            response = working_hours_holidays.__wrapped__(
                RequestFactory().get('/learner_api/working-hours/holidays/?componentId=COMP-1')
            )
        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(payload, {
            'error': 'Could not load the working-hours holiday calendar. Please try again.',
        })
        self.assertNotIn('curriculum', response.content.decode())
