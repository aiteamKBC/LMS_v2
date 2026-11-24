"""Pure policy/provider regressions; provider transport is always mocked."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import copy
import os
from datetime import date
from unittest import TestCase
from unittest.mock import Mock, patch

from . import calendar_policy as policy, country_calendars as provider, delivery_calendar


def holiday(identity='official-a', day='2026-09-22', **extra):
    return dict(id=identity, label='Synthetic public holiday', startDate=day, endDate=day, source='calendarific', **extra)


class DeliveryCalendarPolicyTests(TestCase):
    def test_omitted_keeps_saved_policy_and_null_restores_inheritance(self):
        saved = {'calendar_policy': policy.normalise_policy({'country': 'SA'})}
        self.assertEqual(policy.merge_policy({}, saved), saved['calendar_policy'])
        self.assertIsNone(policy.merge_policy({'calendarPolicy': None}, saved))

    def test_default_country_presets_and_explicit_seven_day_delivery(self):
        self.assertIsNone(policy.normalise_policy(None))
        self.assertEqual(policy.normalise_policy({})['weekendDays'], ['Saturday', 'Sunday'])
        for country in ('SA', 'EG'):
            self.assertEqual(policy.normalise_policy({'country': country})['weekendDays'], ['Friday', 'Saturday'])
        self.assertEqual(policy.normalise_policy({'country': 'SA', 'weekendDays': []})['weekendDays'], [])

    def test_rejects_invalid_country_weekday_boolean_and_manual_ranges(self):
        for value in ({'country': 'ZZ'}, {'weekendDays': ['Someday']}, {'observePublicHolidays': 'false'},
                      {'manualHolidays': [{'label': 'Closure', 'startDate': '2026-09-23', 'endDate': '2026-09-22'}]}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                policy.normalise_policy(value)

    def test_manual_is_preserved_when_public_holidays_are_disabled(self):
        manual = {'label': 'Local workshop', 'startDate': '2026-09-22'}
        selected = policy.normalise_policy({'country': 'SA', 'observePublicHolidays': False, 'manualHolidays': [manual]})
        self.assertEqual([row['label'] for row in policy.apply_holiday_choices(selected, [holiday()])], ['Local workshop'])
        self.assertEqual(manual, {'label': 'Local workshop', 'startDate': '2026-09-22'})

    def test_exclusions_survive_provider_refresh_without_mutating_either_source(self):
        selected = policy.normalise_policy({'country': 'SA', 'excludedHolidayIds': ['official-a']})
        rows = [holiday(), holiday('official-b', '2026-09-23')]
        before = copy.deepcopy(rows)
        self.assertEqual([row['id'] for row in policy.apply_holiday_choices(selected, rows)], ['official-b'])
        self.assertEqual(rows, before)
        self.assertEqual(selected['excludedHolidayIds'], ['official-a'])

    def test_saturday_mba_override_does_not_change_england_preset(self):
        regular = policy.normalise_policy({})
        mba = policy.normalise_policy({'weekendDays': ['Sunday']})
        saturday = date(2026, 9, 19)
        self.assertIn('rest day', policy.non_delivery_reason(saturday, regular, []))
        self.assertEqual(policy.non_delivery_reason(saturday, mba, []), '')
        self.assertEqual(regular['weekendDays'], ['Saturday', 'Sunday'])

    def test_weekend_and_public_holiday_have_distinct_reasons(self):
        selected = policy.normalise_policy({'country': 'SA'})
        self.assertIn('Public holiday:', policy.non_delivery_reason(date(2026, 9, 22), selected, [holiday()]))
        self.assertIn('weekly rest day', policy.non_delivery_reason(date(2026, 9, 25), selected, []))

    def test_legacy_path_does_not_request_another_country(self):
        rows = [holiday('existing-england')]
        with composition_fixture(delivery_calendar, 'holidays_for_period', side_effect=AssertionError('No provider read')):
            self.assertEqual(delivery_calendar.policy_holidays(None, None, None, rows), rows)
            self.assertEqual(delivery_calendar.policy_holidays(policy.normalise_policy({}), None, None, rows), rows)

    def test_foreign_country_does_not_inherit_england_or_global_manual_closures(self):
        selected = policy.normalise_policy({'country': 'SA'})
        with composition_fixture(delivery_calendar, 'holidays_for_period', return_value=[holiday('sa')]):
            self.assertEqual([row['id'] for row in delivery_calendar.policy_holidays(selected, '2026-01-01', '2026-12-31', [holiday('gb')])], ['sa'])


class CountryProviderTests(TestCase):
    def response(self, day='2026-09-23'):
        return {'meta': {'code': 200}, 'response': {'holidays': [
            {'name': 'Synthetic national day', 'urlid': 'sa/national', 'date': {'iso': day}, 'type': ['National holiday']},
            {'name': 'An observance', 'date': {'iso': day}, 'type': ['Observance']},
        ]}}

    @patch.dict(os.environ, {'CALENDARIFIC_API_KEY': 'synthetic-test-key'})
    def test_one_country_year_request_filters_observances_and_has_stable_ids(self):
        with patch.object(provider.requests, 'get', return_value=Mock(status_code=200, json=lambda: self.response())) as request:
            rows = provider.fetch_holidays('SA', 2026)
            request.assert_called_once()
            self.assertEqual(request.call_args.kwargs['params']['country'], 'SA')
            self.assertEqual(request.call_args.kwargs['params']['year'], 2026)
            self.assertEqual(len(rows), 1)
        with patch.object(provider.requests, 'get', return_value=Mock(status_code=200, json=lambda: self.response('2026-09-24'))):
            moved = provider.fetch_holidays('SA', 2026)
        self.assertEqual(rows[0]['id'], moved[0]['id'])
        self.assertNotEqual(rows[0]['startDate'], moved[0]['startDate'])

    @patch.dict(os.environ, {'CALENDARIFIC_API_KEY': 'synthetic-test-key'})
    def test_provider_failure_is_visible_and_does_not_expose_key(self):
        with patch.object(provider.requests, 'get', side_effect=provider.requests.Timeout('secret-bearing-url')):
            with self.assertRaises(provider.CalendarUnavailable) as result:
                provider.fetch_holidays('SA', 2026)
        self.assertNotIn('secret-bearing-url', str(result.exception))
        self.assertNotIn('synthetic-test-key', str(result.exception))

    @patch.dict(os.environ, {'CALENDARIFIC_API_KEY': 'synthetic-test-key'})
    def test_empty_or_wrong_year_data_is_not_a_successful_empty_calendar(self):
        for body in ({'meta': {'code': 200}, 'response': {'holidays': []}}, self.response('2027-09-23')):
            with patch.object(provider.requests, 'get', return_value=Mock(status_code=200, json=lambda: body)):
                with self.assertRaises(provider.CalendarUnavailable):
                    provider.fetch_holidays('SA', 2026)
