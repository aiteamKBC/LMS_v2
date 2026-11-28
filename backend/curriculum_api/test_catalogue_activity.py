"""Read-only catalogue facts on an isolated in-memory schema; no integrations."""
import json
from datetime import date, datetime
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from django.db import DatabaseError, connections
from django.db.backends.sqlite3.base import DatabaseWrapper
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import resolve

from . import catalogue_activity as activity


@override_settings(TIME_ZONE='Europe/London')
class CatalogueActivityFactsTests(SimpleTestCase):
    def test_dates_use_the_business_day_and_reject_invalid_dates(self):
        self.assertEqual(activity.teaching_day('2026-06-30T23:30:00Z'), '2026-07-01')
        self.assertEqual(activity.teaching_day(datetime(2026, 6, 30, 23, 30)), '2026-07-01')
        self.assertEqual(activity.teaching_day(date(2026, 11, 1)), '2026-11-01')
        for value in ['', 'not a date', '2026-02-30', '2026-13-01T10:00:00Z']:
            self.assertEqual(activity.teaching_day(value), '')

    def test_request_timezone_does_not_move_the_business_teaching_day(self):
        from django.utils import timezone as django_timezone
        with django_timezone.override('America/Los_Angeles'):
            self.assertEqual(activity.teaching_day('2026-06-30T23:30:00Z'), '2026-07-01')

    def test_a_standalone_overnight_session_includes_its_finish_day(self):
        result = activity.catalogue_facts([dict(module_catalogue_id='A', start_date='2026-10-01')],
            [dict(id='S1', module_catalogue_id='A', start_datetime='2026-11-01T23:30:00Z', duration_minutes=90, occurrence_count=0)])
        self.assertEqual(result['A']['lastLiveDate'], '2026-11-02')

    def test_invalid_standalone_calendar_values_do_not_manufacture_activity(self):
        for start, duration in [('2026-13-01T10:00:00Z', 60), ('2026-11-01T10:00:00Z', 'invalid')]:
            with self.subTest(start=start, duration=duration):
                result = activity.catalogue_facts([dict(module_catalogue_id='A', start_date='2026-10-01')],
                    [dict(id='S1', module_catalogue_id='A', start_datetime=start, duration_minutes=duration, occurrence_count=0)])
                self.assertEqual(result['A']['lastLiveDate'], '')

    def test_provenance_uses_the_stored_import_flag_and_does_not_guess(self):
        self.assertEqual(activity.source_label('mba-legacy'), 'old_lms')
        self.assertEqual(activity.source_label('module_authoring'), 'new_lms')
        self.assertEqual(activity.source_label('training_plan'), 'new_lms')
        self.assertEqual(activity.source_label(''), 'unknown')

    def test_postponed_teaching_extends_a_module_and_keeps_both_sources(self):
        modules = [dict(module_catalogue_id='A', start_date='2026-09-01', source_type='mba-legacy'),
                   dict(module_catalogue_id='B', start_date='2026-10-01', source_type='module_authoring')]
        series = [dict(id='S1', module_catalogue_id='A', status='active', occurrence_count=3,
                       last_live_end='2026-11-03T12:00:00Z'),
                  dict(id='S2', module_catalogue_id='B', status='active', occurrence_count=1,
                       last_live_end='2026-11-05T12:00:00Z')]
        facts = activity.catalogue_facts(modules, series)
        self.assertEqual(facts['A'], dict(source='old_lms', startDate='2026-09-01', lastLiveDate='2026-11-03'))
        self.assertEqual(facts['B']['lastLiveDate'], '2026-11-05')

    def test_cancellations_do_not_reappear_through_series_fallback(self):
        modules = [dict(module_catalogue_id='A', start_date='2026-10-01')]
        series = [dict(id='cancelled', module_catalogue_id='A', status='cancelled', start_datetime='2026-12-01T12:00:00Z'),
                  dict(id='empty', module_catalogue_id='A', status='active', occurrence_count=2,
                       start_datetime='2026-12-02T12:00:00Z')]
        self.assertEqual(activity.catalogue_facts(modules, series)['A']['lastLiveDate'], '')

    def test_shared_copies_keep_their_own_start_and_source_and_cycles_are_safe(self):
        modules = [dict(module_catalogue_id='A', start_date='2026-09-01', source_type='mba-legacy'),
                   dict(module_catalogue_id='B', start_date='2026-10-01', source_type='module_authoring', teams_shared_source_module_id='A')]
        facts = activity.catalogue_facts(modules, [dict(id='S1', module_catalogue_id='A', occurrence_count=1, last_live_end='2026-12-01')])
        self.assertEqual(facts['B'], dict(source='new_lms', startDate='2026-10-01', lastLiveDate='2026-12-01'))
        modules[0]['teams_shared_source_module_id'] = 'B'
        self.assertEqual(activity.catalogue_facts(modules, [])['A']['lastLiveDate'], '')


class CatalogueActivityReadTests(TestCase):
    def setUp(self):
        config = {**connections['default'].settings_dict, 'NAME': ':memory:'}
        if config['ENGINE'] != 'django.db.backends.sqlite3':
            raise RuntimeError('Catalogue tests require verified isolated SQLite settings.')
        self.db = DatabaseWrapper(config, alias='catalogue_activity_test')
        self.addCleanup(self.db.close)
        for target in ['curriculum_api.views.connection']:
            patcher = patch(target, self.db)
            patcher.start()
            self.addCleanup(patcher.stop)
        schema = [
            'CREATE TABLE modules (module_catalogue_id text, start_date text, source_type text, status text, teams_shared_source_module_id text, deleted_at text, is_programme_deleted boolean)',
            'CREATE TABLE weeks (id text, module_catalogue_id text, deleted_at text, is_programme_deleted boolean, library_state text)',
            'CREATE TABLE components (id text, module_catalogue_id text, week_id text, type text, settings_json text, deleted_at text, is_programme_deleted boolean, library_state text)',
            "CREATE TABLE live_sessions (id text, module_catalogue_id text, status text, start_datetime text, duration_minutes integer, provider text DEFAULT 'Microsoft Teams', graph_event_id text DEFAULT '', online_meeting_id text DEFAULT '', join_url text DEFAULT '')",
            'CREATE TABLE live_session_occurrences (id text, live_session_id text, status text, scheduled_start text, scheduled_end text)',
        ]
        with self.db.cursor() as cursor:
            for sql in schema:
                cursor.execute(sql)
        columns = {}
        with self.db.cursor() as cursor:
            for table in ['modules', 'weeks', 'components', 'live_sessions', 'live_session_occurrences']:
                cursor.execute(f'PRAGMA table_info({table})')
                columns[table] = {row[1] for row in cursor.fetchall()}
            cursor.execute("INSERT INTO modules VALUES ('A','2026-09-01','mba-legacy','published',NULL,NULL,0),('B','2026-10-01','module_authoring','draft',NULL,NULL,0)")
            cursor.execute("INSERT INTO weeks VALUES ('W1','A',NULL,0,NULL),('W2','B',NULL,0,NULL),('deleted','B','2026-10-01',0,NULL)")
        patcher = patch.object(activity.views, 'has_column', side_effect=lambda table, key: key in columns.get(table, set()))
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch.object(activity.views, 'ensure_module_authoring_tables', side_effect=AssertionError('No DDL on reads'))
        patcher.start()
        self.addCleanup(patcher.stop)

    def component(self, identifier, settings, kind='live-session', week='W2', library=None):
        with self.db.cursor() as cursor:
            cursor.execute('INSERT INTO components VALUES (%s,%s,%s,%s,%s,NULL,0,%s)',
                           [identifier, 'B', week, kind, json.dumps(settings), library])

    def test_bulk_read_uses_teams_dates_without_loading_component_content(self):
        self.component('C1', {'sessionDate': '2026-11-04', 'htmlContent': 'Long content' * 10000})
        self.component('C2', {'sessionDate': '2099-01-01'}, kind='video')
        self.component('C3', {'sessionDate': '2099-01-02'}, library=' library ')
        self.component('C4', {'sessionDate': '2099-01-03'}, week='deleted')
        self.component('C5', {'sessionDate': '2099-01-04'}, week='missing')
        with self.db.cursor() as cursor:
            cursor.execute("INSERT INTO live_sessions (id,module_catalogue_id,status,start_datetime,duration_minutes,graph_event_id) VALUES ('S1','A','active','2026-09-01',60,'event-1')")
            cursor.execute("INSERT INTO live_session_occurrences VALUES ('O1','S1','scheduled','2026-11-05T10:00:00Z','2026-11-05T11:00:00Z'),('O2','S1','cancelled','2099-01-01','2099-01-01')")
        with patch.object(activity.views, 'fetch_all', wraps=activity.views.fetch_all) as fetch:
            result = activity.read_catalogue_facts()
        self.assertEqual(fetch.call_count, 1)
        self.assertNotIn('settings_json', fetch.call_args.args[0])
        self.assertNotIn('components', fetch.call_args.args[0])
        self.assertEqual(result['A']['lastLiveDate'], '2026-11-05')
        self.assertEqual(result['B']['lastLiveDate'], '')
        self.assertLess(len(json.dumps(result)), 300)

    def test_a_cancelled_occurrence_is_not_counted_from_a_stale_component_date(self):
        with self.db.cursor() as cursor:
            cursor.execute("INSERT INTO live_sessions (id,module_catalogue_id,status,start_datetime,duration_minutes,graph_event_id) VALUES ('S2','B','active','2026-09-01',60,'event-2')")
            cursor.execute("INSERT INTO live_session_occurrences VALUES ('O2','S2','cancelled','2099-01-01','2099-01-01'),('O3','S2','completed','2026-09-01','2026-09-01')")
        self.component('C1', dict(teamsOccurrenceId='O2', teamsLiveSessionId='S2', sessionDate='2099-01-01'))
        self.assertEqual(activity.read_catalogue_facts()['B']['lastLiveDate'], '2026-09-01')

    def test_only_real_teams_calendar_rows_qualify_and_rescheduled_dates_win(self):
        with self.db.cursor() as cursor:
            cursor.execute("INSERT INTO live_sessions (id,module_catalogue_id,status,start_datetime,duration_minutes,provider,graph_event_id) VALUES ('draft','A','active','2099-01-01T10:00:00Z',60,'Microsoft Teams',''),('other','A','active','2099-01-02T10:00:00Z',60,'Zoom','event-other'),('real','B','active','2026-09-01T10:00:00Z',60,'Microsoft Teams','event-real')")
            cursor.execute("INSERT INTO live_session_occurrences VALUES ('O1','real','scheduled','2026-11-08T10:00:00Z','2026-11-08T11:00:00Z')")
        self.component('C1', dict(teamsLiveSessionId='real', teamsOccurrenceId='O1', sessionDate='2099-12-31'))
        facts = activity.read_catalogue_facts()
        self.assertEqual(facts['A']['lastLiveDate'], '')
        self.assertEqual(facts['B']['lastLiveDate'], '2026-11-08')
        # An edit to the tracked occurrence is reflected by the next read, even
        # if the content and the old series start still carry the previous date.
        with self.db.cursor() as cursor:
            cursor.execute("UPDATE live_session_occurrences SET scheduled_start='2026-11-15T10:00:00Z',scheduled_end='2026-11-15T11:00:00Z' WHERE id='O1'")
        self.assertEqual(activity.read_catalogue_facts()['B']['lastLiveDate'], '2026-11-15')

    def test_module_batches_are_bounded_instead_of_one_query_per_card(self):
        with self.db.cursor() as cursor:
            cursor.executemany('INSERT INTO modules (module_catalogue_id,start_date,source_type,status,is_programme_deleted) VALUES (%s,%s,%s,%s,%s)',
                               [(f'M{i}', '2026-10-01', 'module_authoring', 'draft', 0) for i in range(801)])
        with patch.object(activity.views, 'fetch_all', wraps=activity.views.fetch_all) as fetch:
            facts = activity.read_catalogue_facts()
        self.assertEqual(len(facts), 803)
        self.assertEqual(fetch.call_count, 3)
        self.assertTrue(all(len(call.args[1]) <= 400 for call in fetch.call_args_list))

    def test_endpoint_requires_curriculum_access_and_reports_failure_instead_of_empty_success(self):
        factory = RequestFactory()
        actor = SimpleNamespace(id=1, role='staff')
        def authenticate(request):
            request.login_account = actor
            return actor
        with patch('login.permissions.authenticate_request', side_effect=authenticate), patch('login.permissions._accesses_of', return_value={'curriculum'}):
            self.assertEqual(activity.catalogue_activity(factory.get('/')).status_code, 200)
            for role in ['learner', 'employer']:
                actor.role = role
                self.assertEqual(activity.catalogue_activity(factory.get('/')).status_code, 403)
            actor.role = 'staff'
            with patch.object(activity, 'read_catalogue_facts', side_effect=DatabaseError('Synthetic unavailable')):
                self.assertEqual(activity.catalogue_activity(factory.get('/')).status_code, 503)
        with patch('login.permissions.authenticate_request', return_value=None):
            self.assertEqual(activity.catalogue_activity(factory.get('/')).status_code, 401)
        with patch('login.permissions.authenticate_request', side_effect=authenticate), patch('login.permissions._accesses_of', return_value={'coach'}):
            self.assertEqual(activity.catalogue_activity(factory.get('/')).status_code, 403)
        self.assertEqual(resolve('/curriculum/modules/catalogue-activity/', urlconf='curriculum_api.urls').url_name, 'module-catalogue-activity')
