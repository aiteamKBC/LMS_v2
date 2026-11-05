"""Offline module discovery and group isolation, including legacy/manual history."""
from datetime import date
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import attendance_modules as modules, attendance_loading as loading


class AttendanceModuleOptionsTests(SimpleTestCase):
    def setUp(self):
        self.profiles = {str(i): SimpleNamespace(id=i, _caseload_source=SimpleNamespace(
            id=900+i, learner_type='commercial' if i == 1 else 'apprenticeship')) for i in (1, 2, 3)}
        self.placements = [{'id': str(i), 'programmeId': 'p' if i < 3 else 'other',
            'programmeName': 'Programme', 'groupId': f'g{i}', 'groupName': 'Group',
            'cohortName': f'Cohort {i}'} for i in (1, 2, 3)]
        self.programme = next(row for row in loading.placement_options(self.placements)['programmes'] if row['id'] == 'p')
        self.history = patch.object(modules, 'counted_history', return_value=([], {}, 0)).start()
        self.occurrences = patch.object(modules, 'delivery_occurrences', return_value=[]).start()
        self.addCleanup(patch.stopall)

    def row(self, module='Risk Management', source='kbc-attendance', identity='legacy'):
        return ({'module_title': module, 'source': source, 'session_id': identity,
                 'session_date': date(2026, 9, 1)}, 'present')

    def read(self):
        return modules.with_module_options(self.programme, self.profiles, self.placements)

    def test_all_history_modules_including_older_than_a_page_manual_and_unnamed(self):
        history = [self.row(identity=str(i)) for i in range(120)]
        history += [self.row('Older module'), self.row('Manual module', 'coach-manual'), self.row('')]
        self.history.side_effect = [(history, {}, 0), ([], {}, 0)]
        result = self.read()
        choices = {row['name']: row for row in result['groups'][0]['modules']}
        self.assertEqual(set(choices), {'Risk Management', 'Older module', 'Manual module', 'Unspecified module'})
        self.assertEqual(choices['Older module']['learnerIds'], ['1'])
        self.assertEqual(len(choices['Risk Management']['recentByLearner']['1']), 4)
        self.assertEqual(choices['Manual module']['sessionIds'], [])
        self.assertEqual(result['groups'][1]['modules'], [])

    def test_same_module_names_keep_group_cohort_and_learner_scope(self):
        self.history.return_value = ([self.row()], {}, 0)
        result = self.read()
        self.assertEqual([group['id'] for group in result['groups']], ['g1', 'g2'])
        self.assertEqual([group['modules'][0]['learnerIds'] for group in result['groups']], [['1'], ['2']])
        self.assertEqual([call.args[1] for call in self.history.call_args_list], [1, 2])
        self.assertEqual([call.args[:2] for call in self.occurrences.call_args_list], [('p', 'g1'), ('p', 'g2')])

    def test_native_occurrence_identity_survives_display_title_corrections(self):
        self.history.side_effect = [([self.row('Corrected module', 'microsoft-teams', 'occ')], {}, 0), ([], {}, 0)]
        self.occurrences.side_effect = [[(SimpleNamespace(id='occ'), SimpleNamespace(title='Original module'))], []]
        choices = {row['name']: row for row in self.read()['groups'][0]['modules']}
        self.assertEqual(choices['Corrected module']['sessionIds'], ['occ'])
        self.assertEqual(choices['Corrected module']['learnerIds'], ['1'])
        self.assertNotIn('Original module', choices)

    def test_unrecorded_scheduled_modules_do_not_add_empty_history_choices(self):
        self.occurrences.return_value = [(SimpleNamespace(id='future'), SimpleNamespace(title='Future module'))]
        self.assertTrue(all(group['modules'] == [] for group in self.read()['groups']))

    def test_unavailable_source_never_reads_another_learners_history(self):
        self.profiles['1']._caseload_source = None
        self.read()
        self.history.assert_called_once_with(self.profiles['2']._caseload_source, 2)

    @patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test')
    def test_opt_in_options_require_an_authorised_programme_before_reading_history(self, owner):
        with patch.object(loading, 'attendance_placements', return_value=(self.profiles, self.placements)):
            for programme in ('', 'forbidden'):
                response = unwrap(loading.coach_attendance_options)(RequestFactory().get('/', {
                    'programmeId': programme, 'includeModules': '1'}))
                self.assertEqual(response.status_code, 403)
            self.history.assert_not_called()
            response = unwrap(loading.coach_attendance_options)(RequestFactory().get('/', {
                'programmeId': 'p', 'includeModules': '1'}))
            self.assertEqual(response.status_code, 200)
            self.assertEqual([row['id'] for row in json.loads(response.content)['programmes']], ['p'])

    @patch('login.permissions.authenticate_request', return_value=None)
    def test_anonymous_module_discovery_is_rejected(self, authenticate):
        response = loading.coach_attendance_options(RequestFactory().get('/', {
            'programmeId': 'p', 'includeModules': '1'}))
        self.assertEqual(response.status_code, 401)
        self.history.assert_not_called()
