"""Persisted API regression cases, run only in the verified isolated test DB."""
import copy
from contextlib import ExitStack
from types import SimpleNamespace
import importlib
from django.db import connection
from unittest.mock import patch
from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceTransactionHarness
from coach_api.tests_support.persisted_fixtures import curriculum_session
from curriculum_api.tests_module_weekly_schedule import GraphCalendar, GRAPH_SETTINGS


class StudyWeekPersistenceTests(CurriculumPersistenceTransactionHarness):
    def setUp(self):
        super().setUp()
        curriculum_session(self, self.client)
        tree = self.tree_payload()
        tree['cohorts'][0]['groups'][0]['modules'] = []
        self.assertEqual(self.post_json('/curriculum_api/curriculum/programmes/tree/', tree).status_code, 200)

    def create_delivery(self, **extra):
        payload = {'moduleName': 'Synthetic study weeks', 'startDate': '2026-09-10', 'weeks': 3,
                   'scheduleMode': 'custom', 'weekBoundaryMode': 'calendar', 'weekStartsOn': 'Monday',
                   'weeklySchedule': [{'day': day, 'startTime': '09:00', 'endTime': '10:00'} for day in ('Tuesday', 'Thursday')],
                   'calendarPolicy': {'country': 'GB', 'observePublicHolidays': False, 'weekendDays': ['Saturday', 'Sunday'],
                                      'manualHolidays': [{'label': 'Synthetic closure', 'startDate': '2026-09-16', 'endDate': '2026-09-16'}]},
                   'tutor': 'Tutor One', **extra}
        response = self.post_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/modules/', payload)
        self.assertEqual(response.status_code, 200, response.content)
        return views.get_authoring_structure_payload(response.json()['created'][0]['catalogueId'])

    def test_chosen_day_is_not_overwritten_with_first_live_session(self):
        module = self.create_delivery()
        self.assertEqual(module['weekBoundaryMode'], 'calendar')
        self.assertEqual(module['weekStartsOn'], 'Monday')
        self.assertEqual(module['endDate'], '2026-09-27')
        self.assertEqual([len(w['components']) for w in module['weekStructure']], [1, 0, 2])
        self.assertEqual([(w['studyWeekStartDate'], w['studyWeekEndDate']) for w in module['weekStructure']], [
            ('2026-09-10', '2026-09-13'), ('2026-09-14', '2026-09-20'), ('2026-09-21', '2026-09-27')])
        self.assertEqual([h['label'] for h in module['weekStructure'][1]['studyWeekHolidays']], ['Synthetic closure'])
        row = views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module['catalogueId']])[0]
        plan = views.module_session_plan_for_weeks(row, 3, holidays=[])
        self.assertEqual([s['date'] for s in plan['sessions']], ['2026-09-10', '2026-09-22', '2026-09-24'])
        self.assertEqual(views.authoring_summary_catalogue_item(views.authoring_catalogue_summaries()[module['catalogueId']])['weekBoundaryMode'], 'calendar')

    def test_holiday_week_keeps_materials_and_manually_added_live_component(self):
        module = self.create_delivery()
        weeks = copy.deepcopy(module['weekStructure'])
        weeks[1]['components'] = [
            {'id': 'COMP-SYNTHETIC-READING', 'type': 'lesson', 'title': 'Independent reading', 'settings': {}},
            {'id': 'COMP-SYNTHETIC-MANUAL', 'type': 'live-session', 'title': 'Optional workshop',
             'settings': {'sessionDate': '2026-09-17', 'sessionTime': '14:00', 'durationMinutes': 60}},
        ]
        result = self.patch_json(f"/curriculum_api/curriculum/modules/{module['catalogueId']}/", {'weekStructure': weeks})
        self.assertEqual(result.status_code, 200, result.content)
        after = views.get_authoring_structure_payload(module['catalogueId'])
        self.assertEqual(len(after['weekStructure']), 3)
        self.assertEqual([c['title'] for c in after['weekStructure'][1]['components']], ['Independent reading', 'Optional workshop'])
        self.assertEqual(after['weekStructure'][1]['components'][1]['settings']['sessionDate'], '2026-09-17')
        self.assertEqual(after['weekStartsOn'], 'Monday')

    def test_an_entirely_closed_module_does_not_fall_back_to_weekly_live_sessions(self):
        module = self.create_delivery(weeks=1, calendarPolicy={'country': 'GB', 'observePublicHolidays': False,
            'manualHolidays': [{'label': 'Closed', 'startDate': '2026-09-11', 'endDate': '2026-09-11'}]})
        self.assertEqual(len(module['weekStructure']), 1)
        self.assertEqual(module['weekStructure'][0]['components'], [])
        row = views.module_schedule_view(module)
        self.assertEqual(views.module_session_plan_for_weeks(row, 1, holidays=[])['sessions'], [])

    def test_preview_matches_group_creation_and_does_not_call_microsoft(self):
        with patch('coach_api.views.microsoft_graph_request', side_effect=AssertionError('No live Teams call')):
            response = self.post_json('/curriculum_api/curriculum/preview/module-session-plan/', {
                'startDate': '2026-09-10', 'weeksNumber': 3, 'numberOfSessions': 6, 'weekBoundaryMode': 'calendar',
                'weekStartsOn': 'Monday', 'weekDays': 'Tuesday, Thursday', 'scheduleMode': 'group',
                'holidays': [{'label': 'Synthetic closure', 'startDate': '2026-09-16', 'endDate': '2026-09-16'}],
            })
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([s['date'] for s in response.json()['sessions']], ['2026-09-10', '2026-09-22', '2026-09-24'])
        self.assertEqual(len(response.json()['weeks']), 3)

    def test_legacy_module_keeps_first_session_weeks_on_unrelated_save(self):
        module = self.create_delivery(weekBoundaryMode=None, weekStartsOn='Thursday', calendarPolicy=None)
        before = copy.deepcopy(module['weekStructure'])
        result = self.patch_json(f"/curriculum_api/curriculum/modules/{module['catalogueId']}/", {'name': 'Renamed legacy'})
        self.assertEqual(result.status_code, 200, result.content)
        after = views.get_authoring_structure_payload(module['catalogueId'])
        self.assertIsNone(after['weekBoundaryMode'])
        self.assertEqual(after['weekStartsOn'], 'Thursday')
        self.assertEqual(after['weekStructure'], before)

    def test_unassigned_creation_retains_the_choice_for_later_placement(self):
        response = self.post_json('/curriculum_api/curriculum/modules/', {
            'moduleType': 'authoring', 'title': 'Unassigned synthetic study weeks', 'weeks': 3,
            'weekBoundaryMode': 'calendar', 'weekStartsOn': 'Sunday',
        })
        self.assertEqual(response.status_code, 201, response.content)
        after = views.get_authoring_structure_payload(response.json()['moduleCatalogueId'])
        self.assertEqual(after['weekBoundaryMode'], 'calendar')
        self.assertEqual(after['weekStartsOn'], 'Sunday')

    def test_migration_refreshes_existing_read_views_and_preserves_legacy_rows(self):
        from curriculum_api.tests_free_course_native_storage import prepare_native_authoring_fixture
        from curriculum_api import free_course_native_schema as schema
        from curriculum_api.free_course_contract import COLUMNS
        from curriculum_api import learning_storage
        legacy = self.create_delivery(weekBoundaryMode=None, weekStartsOn='Thursday', calendarPolicy=None)
        self.addCleanup(learning_storage.reset)
        prepare_native_authoring_fixture()
        previous_contract = {**COLUMNS, 'modules': COLUMNS['modules'][:-1]}
        with patch.object(schema, 'COLUMNS', previous_contract):
            schema.prepare(connection)
        with connection.cursor() as cursor:
            cursor.execute('ALTER TABLE curriculum.modules DROP COLUMN week_boundary_mode')
            cursor.execute('SELECT to_jsonb(m) FROM curriculum.modules m ORDER BY module_catalogue_id')
            before = cursor.fetchall()
        migration = importlib.import_module('curriculum_api.migrations.0091_module_week_boundary_mode')
        migration.add_week_boundary_mode(None, SimpleNamespace(connection=connection))
        migration.add_week_boundary_mode(None, SimpleNamespace(connection=connection))
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_jsonb(m) - 'week_boundary_mode' FROM curriculum.modules m ORDER BY module_catalogue_id")
            self.assertEqual(cursor.fetchall(), before)
            cursor.execute('SELECT week_boundary_mode FROM curriculum.learning_courses WHERE module_catalogue_id=%s', [legacy['catalogueId']])
            self.assertEqual(cursor.fetchone(), (None,))
        fresh = self.create_delivery(moduleName='New layout after migration', tutor='')
        with connection.cursor() as cursor:
            cursor.execute('SELECT week_boundary_mode FROM curriculum.learning_courses WHERE module_catalogue_id=%s', [fresh['catalogueId']])
            self.assertEqual(cursor.fetchone(), ('calendar',))

    def test_existing_legacy_module_cannot_be_silently_converted(self):
        module = self.create_delivery(weekBoundaryMode=None, weekStartsOn='Thursday', calendarPolicy=None)
        before = copy.deepcopy(module)
        response = self.patch_json(f"/curriculum_api/curriculum/modules/{module['catalogueId']}/", {
            'weekBoundaryMode': 'calendar', 'weekStartsOn': 'Monday',
        })
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(views.get_authoring_structure_payload(module['catalogueId']), before)

    def test_invalid_study_week_requests_are_reported_before_writing(self):
        response = self.post_json('/curriculum_api/curriculum/preview/module-session-plan/', {
            'weekBoundaryMode': 'calendar', 'weekStartsOn': 'Monday', 'startDate': '2026-09-10',
            'weekDays': 'Thursday', 'weeksNumber': 10**9,
        })
        self.assertEqual(response.status_code, 400, response.content)
        module = self.create_delivery()
        before = copy.deepcopy(module)
        for end in ('2026-09-13', '2026-10-01'):
            response = self.patch_json(f"/curriculum_api/curriculum/modules/{module['catalogueId']}/", {'endDate': end})
            self.assertEqual(response.status_code, 400, response.content)
            self.assertEqual(views.get_authoring_structure_payload(module['catalogueId']), before)

    def test_mock_teams_create_and_update_keep_the_holiday_week_out_of_the_series(self):
        module = self.create_delivery(weeks=4, startDate='2027-03-01', calendarPolicy={
            'country': 'GB', 'observePublicHolidays': False,
            'manualHolidays': [{'label': 'Synthetic closure', 'startDate': '2027-03-10', 'endDate': '2027-03-10'}],
        })
        row = views.module_schedule_view(module)
        plan = views.module_session_plan_for_weeks(row, 4, holidays=[])
        dates = [session['date'] for session in plan['sessions']]
        self.assertEqual(dates, ['2027-03-02', '2027-03-04', '2027-03-16', '2027-03-18', '2027-03-23', '2027-03-25'])
        graph = GraphCalendar()
        payload = {'title': 'Synthetic study weeks', 'moduleCatalogueId': module['catalogueId'],
                   'organizerEmail': 'tutor@example.com', 'attendees': ['learner@example.com'],
                   'startDateTimeUtc': dates[0] + 'T09:00:00Z', 'localStartDateTime': dates[0] + 'T09:00',
                   'durationMinutes': 60, 'repeat': 'weekly', 'repeatOccurrences': len(dates), 'seriesMode': 'per_day',
                   'scheduledOccurrences': [{'sessionNumber': index + 1, 'startDateTimeUtc': day + 'T09:00:00Z', 'durationMinutes': 60} for index, day in enumerate(dates)]}
        with ExitStack() as stack:
            for target, kwargs in (
                ('coach_api.views.microsoft_graph_request', {'side_effect': graph}),
                ('coach_api.views.has_graph_credentials', {'return_value': True}),
                ('coach_api.views.get_graph_settings', {'return_value': GRAPH_SETTINGS}),
                ('curriculum_api.views.apply_teams_meeting_options', {'side_effect': lambda organizer, join_url, **kw: (True, {'id': 'meeting-' + join_url.rsplit('/', 1)[-1]}, [])}),
            ):
                stack.enter_context(patch(target, **kwargs))
            response = self.post_json('/curriculum_api/curriculum/teams-meetings/', payload)
            self.assertEqual(response.status_code, 201, response.content)
            meeting = response.json()['meeting']
            occurrences = views.authoring_fetch_all(views.LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [meeting['liveSessionId']], 'session_number')
            self.assertEqual([item['scheduled_start'].date().isoformat() for item in occurrences], dates)
            self.assertEqual(sorted(item['start']['dateTime'][:10] for group in graph.instances.values() for item in group), dates)
            masters = len(graph.posts)
            response = self.patch_json(f"/curriculum_api/curriculum/teams-meetings/{meeting['liveSessionId']}/schedule/", payload)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(len(graph.posts), masters)
            self.assertEqual(sorted(item['start']['dateTime'][:10] for group in graph.instances.values() for item in group), dates)
            after = views.get_authoring_structure_payload(module['catalogueId'])
            self.assertEqual(after['weekStructure'][1]['components'], [])
