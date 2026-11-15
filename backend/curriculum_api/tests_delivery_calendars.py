"""Disposable-database checks: cache isolation, real saves and custom calendars."""
import copy
import importlib
import json
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection
from django.test import RequestFactory

from coach_api.tests_support.persisted_fixtures import curriculum_session
from . import calendar_endpoints, country_calendars, views
from .calendar_policy import DAYS, normalise_policy
from .tests import CurriculumPersistenceTransactionHarness


def official(country='SA', day='2026-09-23'):
    return dict(id=f'calendarific:{country}:national', label=f'{country} synthetic national day',
                startDate=day, endDate=day, source='calendarific', country=country, type='Public holiday')


class DeliveryCalendarPersistenceTests(CurriculumPersistenceTransactionHarness):
    def setUp(self):
        super().setUp()
        curriculum_session(self, self.client)
        migration = importlib.import_module('curriculum_api.migrations.0090_delivery_calendars')
        with connection.schema_editor() as editor:
            migration.add_delivery_calendars(None, editor)
        with connection.cursor() as cursor:
            cursor.execute(f'delete from {views.table_name(country_calendars.TABLE)}')
        views.invalidate_curriculum_cache()

    def test_repeated_selection_reads_one_country_year_and_preserves_other_country(self):
        with patch.object(country_calendars, 'fetch_holidays', side_effect=lambda country, year: [official(country)]) as fetch:
            first = country_calendars.ensure_calendar('SA', 2026)
            second = country_calendars.ensure_calendar('SA', 2026)
            country_calendars.ensure_calendar('EG', 2026)
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(len(country_calendars.saved_calendars()), 2)
        self.assertEqual([item['country'] for item in country_calendars.holidays_for_period('SA', '2026-01-01', '2026-12-31')], ['SA'])

    def test_sync_updates_cached_dates_without_duplicates_or_writing_manual_data(self):
        with patch.object(country_calendars, 'fetch_holidays', return_value=[official()]):
            country_calendars.ensure_calendar('SA', 2026)
        manual_before = copy.deepcopy(views.get_holiday_rows())
        with patch.object(country_calendars, 'fetch_holidays', return_value=[official(day='2026-09-24')]):
            result = country_calendars.sync_saved()
        self.assertEqual(result[0]['status'], 'ok')
        self.assertEqual(len(country_calendars.saved_calendars()), 1)
        self.assertEqual(country_calendars.holidays_for_period('SA', '2026-01-01')[0]['startDate'], '2026-09-24')
        self.assertEqual(views.get_holiday_rows(), manual_before)

    def test_failed_sync_is_visible_and_expired_provider_data_is_purged(self):
        with patch.object(country_calendars, 'fetch_holidays', return_value=[official()]):
            country_calendars.ensure_calendar('SA', 2026)
        with connection.cursor() as cursor:
            cursor.execute(f'update {views.table_name(country_calendars.TABLE)} set fetched_at=%s', [datetime.now(timezone.utc) - timedelta(days=31)])
        with patch.object(country_calendars, 'fetch_holidays', side_effect=country_calendars.CalendarUnavailable('Synthetic provider outage')):
            result = country_calendars.sync_saved()
        self.assertEqual(result[0]['status'], 'error')
        saved = country_calendars.saved_calendars()[0]
        self.assertEqual(views.parse_json_value(saved['holidays'], []), [])
        self.assertIn('outage', saved['last_error'])
        with self.assertRaises(country_calendars.CalendarUnavailable):
            country_calendars.holidays_for_period('SA', '2026-01-01')

    def test_cohort_country_round_trip_rename_and_explicit_restore(self):
        selected = normalise_policy({'country': 'EG', 'observePublicHolidays': False})
        response = self.post_json('/curriculum_api/curriculum/cohorts/', dict(name='Synthetic Egypt cohort', programme='Synthetic programme',
                                  startDate='2026-09-01', durationMonths=3, calendarPolicy=selected))
        self.assertEqual(response.status_code, 201, response.content)
        identifier = response.json()['cohort']['id']
        row = views.fetch_cohort_row(identifier)
        self.assertEqual(views.parse_json_value(row['calendar_policy'], None), selected)
        response = self.patch_json(f'/curriculum_api/curriculum/cohorts/{identifier}/', {'name': 'Egypt renamed'})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(views.parse_json_value(views.fetch_cohort_row(identifier)['calendar_policy'], None), selected)
        response = self.patch_json(f'/curriculum_api/curriculum/cohorts/{identifier}/', {'calendarPolicy': None})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(views.fetch_cohort_row(identifier)['calendar_policy'])

    def test_custom_two_to_seven_day_weeks_keep_dated_components_and_partial_edits(self):
        tree = self.tree_payload()
        tree['cohorts'][0]['groups'][0]['modules'] = []
        self.assertEqual(self.post_json('/curriculum_api/curriculum/programmes/tree/', tree).status_code, 200)
        for count in (2, 3, 7):
            with self.subTest(count=count):
                selected = normalise_policy({'country': 'SA', 'observePublicHolidays': False, 'weekendDays': []})
                slots = [dict(day=day, startTime='09:00', endTime='10:00') for day in DAYS[:count]]
                response = self.post_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/modules/', dict(
                    moduleName=f'Synthetic {count} sessions weekly', startDate='2026-09-07', endDate='2026-09-20',
                    weeks=2, sessionsNumber=2 * count, weeklySchedule=slots, scheduleMode='custom', weekStartsOn='Monday',
                    tutor='Unassigned', calendarPolicy=selected))
                self.assertEqual(response.status_code, 200, response.content)
                identifier = response.json()['created'][0]['catalogueId']
                structure = views.get_authoring_structure_payload(identifier)
                self.assertEqual(structure['calendarPolicy'], selected)
                self.assertEqual([len(week['components']) for week in structure['weekStructure']], [count, count])
                dates = [component['settings']['sessionDate'] for week in structure['weekStructure'] for component in week['components']]
                self.assertEqual(len(set(dates)), 2 * count)
                self.assertTrue(all('2026-09-07' <= day <= '2026-09-20' for day in dates))
                before = copy.deepcopy(structure['weekStructure'])
                response = self.patch_json(f'/curriculum_api/curriculum/modules/{identifier}/', {'name': f'Renamed {count}'})
                self.assertEqual(response.status_code, 200, response.content)
                after = views.get_authoring_structure_payload(identifier)
                self.assertEqual(after['calendarPolicy'], selected)
                self.assertEqual(after['weekStructure'], before)

    def test_teams_uses_saved_module_policy_and_existing_england_default(self):
        target = [{'start': datetime(2026, 9, 19, 10, tzinfo=timezone.utc), 'session_number': 1}]
        self.assertIn('Monday to Friday', views.teams_non_delivery_reason(target, holiday_rows=[]))
        mba = normalise_policy({'weekendDays': ['Sunday']})
        with patch.object(views, 'authoring_module_exists', return_value={'calendar_policy': mba}):
            self.assertEqual(views.teams_non_delivery_reason(target, holiday_rows=[], module_catalogue_id='MBA'), '')
        self.assertIn('Monday to Friday', views.teams_non_delivery_reason(target, holiday_rows=[]))

    def test_staff_only_import_endpoint_does_not_spend_quota_for_other_roles(self):
        request = RequestFactory().post('/curriculum_api/curriculum/country-calendars/', json.dumps(dict(country='SA', startDate='2026-01-01', endDate='2026-12-31')), content_type='application/json')
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner')), patch.object(country_calendars, 'fetch_holidays') as fetch:
            self.assertEqual(calendar_endpoints.country_calendars(request).status_code, 403)
            fetch.assert_not_called()
        with patch('login.permissions.authenticate_request', return_value=None):
            self.assertEqual(calendar_endpoints.country_calendars(request).status_code, 401)

    def test_duplicate_sources_on_one_date_count_as_one_closed_date(self):
        imported = official()
        manual = {**imported, 'id': 'manual:closure', 'source': 'authored', 'label': 'College closure'}
        self.assertEqual(views.holiday_date_set([imported, manual]), {date(2026, 9, 23)})
