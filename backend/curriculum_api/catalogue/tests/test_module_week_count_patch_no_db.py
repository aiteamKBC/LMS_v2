"""Week-count edits through the real PATCH endpoint, with storage/provider doubles."""
import copy
import json
from contextlib import nullcontext
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import views
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture


class ModuleWeekCountPatchTests(SimpleTestCase):
    def stub(self, name, **kwargs):
        return self.enterContext(composition_fixture(views, name, **kwargs))

    def setUp(self):
        self.stored = {'module_catalogue_id': 'MOD-SYNTHETIC', 'title': 'Synthetic module',
                       'weeks_number': 2, 'sessions_number': 4, 'start_date': '2026-11-01',
                       'end_date': '2026-11-08', 'week_boundary_mode': 'calendar',
                       'week_starts_on': 'Monday', 'tutor_name': 'Synthetic tutor',
                       'session_week_day': 'Monday, Wednesday', 'session_start_time': '10:00',
                       'session_end_time': '12:00'}
        self.structure = {'catalogueId': 'MOD-SYNTHETIC', 'title': 'Synthetic module', 'weeks': 2,
                          'sessionsNumber': 4, 'startDate': '2026-11-01', 'endDate': '2026-11-08',
                          'weekBoundaryMode': 'calendar', 'weekStartsOn': 'Monday',
                          'tutor': 'Synthetic tutor', 'weekDays': 'Monday, Wednesday',
                          'startTime': '10:00', 'endTime': '12:00',
                          'weekStructure': [
                              {'id': 'WEEK-1', 'weekNumber': 1, 'title': 'Keep reading', 'components': [
                                  {'id': 'READING-1', 'type': 'reading', 'title': 'Keep material', 'settings': {}}]},
                              {'id': 'WEEK-2', 'weekNumber': 2, 'title': 'Keep booking', 'components': [
                                  {'id': 'LIVE-1', 'type': 'live-session', 'title': 'Booked session', 'settings': {
                                      'teamsLiveSessionId': 'SERIES-1', 'teamsEventId': 'EVENT-1',
                                      'liveSessionUrl': 'https://example.invalid/meeting', 'sessionDate': '2026-11-02'}}]},
                          ]}
        self.stub('resolve_stored_module_catalogue_id', return_value='MOD-SYNTHETIC')
        self.stub('authoring_module_exists', return_value=self.stored)
        self.stub('module_structure_revision', return_value='revision-1')
        self.stub('get_authoring_structure_payload', side_effect=lambda _: copy.deepcopy(self.structure))
        self.stub('archived_programme_module_edit_error', return_value=None)
        self.stub('module_parent_cohort', return_value=None)
        self.stub('lock_module_structure_row')
        self.enterContext(patch.object(views.transaction, 'atomic', side_effect=lambda: nullcontext()))
        self.enterContext(patch('curriculum_api.module_collaboration.check_structure_save', return_value=None))
        self.enterContext(patch('curriculum_api.module_collaboration.announce_saved'))
        self.save = self.stub('save_module_authoring_structure', side_effect=lambda _id, body: body)
        self.stub('stale_teams_calendar_modules', return_value=[])
        # The real conflict planner must date the candidate before comparing it.
        # This unrelated synthetic booking has the same tutor, on another date.
        other = {'module_catalogue_id': 'MOD-OTHER', 'tutor_name': 'Synthetic tutor',
                 'sessions_number': 1, 'start_date': '2027-01-04', 'session_week_day': 'Monday',
                 'session_start_time': '10:00', 'session_end_time': '12:00'}
        self.conflict_context = self.stub('tutor_conflict_context', return_value={'stored': [other], 'groups': {}, 'holidays': {}})

    def request(self, end_date, **extra):
        request = RequestFactory().patch('/synthetic/module/', json.dumps({
            'weeks': 3, 'sessionsNumber': 6, 'endDate': end_date, **extra,
        }), content_type='application/json')
        return views.curriculum_module_detail(request, 'MOD-SYNTHETIC')

    def test_increasing_two_to_three_weeks_keeps_existing_content_and_booking(self):
        before = copy.deepcopy(self.structure)
        response = self.request('2026-11-15')
        self.assertEqual(response.status_code, 200, response.content)
        body = self.save.call_args.args[1]
        self.assertEqual(body['weeksNumber'], 3)
        self.assertEqual(body['weekStructure'][:2], before['weekStructure'])
        self.assertEqual(body['weekStructure'][2]['components'], [])
        self.assertEqual(self.structure, before)
        self.conflict_context.assert_called()

    def test_invalid_final_week_is_a_validation_error_before_planning_or_writing(self):
        for end_date in ('2026-11-08', '2026-11-21'):
            with self.subTest(end_date=end_date):
                response = self.request(end_date)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn('endDate', json.loads(response.content)['fields'])
                self.save.assert_not_called()
                self.conflict_context.assert_not_called()

    def test_valid_calendar_window_still_runs_the_tutor_conflict_guard(self):
        with composition_fixture(views, 'tutor_schedule_conflicts_created', return_value=[{
            'moduleCatalogueId': 'MOD-OTHER', 'moduleName': 'Synthetic conflict',
            'startTime': '10:00', 'endTime': '12:00', 'dates': ['2026-11-09'],
        }]):
            response = self.request('2026-11-15')
        self.assertEqual(response.status_code, 409, response.content)
        self.save.assert_not_called()
