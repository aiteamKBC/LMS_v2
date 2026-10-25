"""The tutor picker's roster answers for every name it can show; no database.

The picker lists two kinds of name: tutors in the staff directory, and any name
a module already carries (an archived tutor, or one that was never in the
directory). The roster used to answer for the first kind only, so a module-only
name reached the picker with no verdict, was shown as free, and the save then
refused it. What is pinned here is that the roster covers both kinds and agrees
with the save-time check, which is the authority.
"""
import json
from contextlib import nullcontext
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import views


SLOT = {
    'startDate': '2026-10-19',
    'sessionsNumber': 4,
    'weekDays': 'Monday',
    'startTime': '11:00',
    'endTime': '13:00',
}


def module_row(catalogue_id, title, tutor, start_time='11:00', end_time='13:00', **extra):
    return {
        'module_catalogue_id': catalogue_id,
        'title': title,
        'tutor_name': tutor,
        'start_date': '2026-10-19',
        'sessions_number': 4,
        'session_week_day': 'Monday',
        'session_start_time': start_time,
        'session_end_time': end_time,
        **extra,
    }


DIRECTORY = [
    {'name': 'Tutor Directory', 'email': 'directory@example.test'},
    {'name': 'Tutor Busy', 'email': 'busy@example.test'},
]


class TutorAvailabilityRosterTests(SimpleTestCase):
    def preview(self, modules, directory=DIRECTORY, **overrides):
        request = RequestFactory().post(
            '/curriculum_api/curriculum/preview/tutor-availability/',
            data=json.dumps({**SLOT, **overrides}),
            content_type='application/json',
        )
        with patch.object(views, 'curriculum_read_scope', lambda *a, **k: nullcontext()), \
                patch.object(views, 'safe_authoring_module_rows', return_value=modules), \
                patch.object(views, 'get_tutor_rows', return_value=directory), \
                patch.object(views, 'safe_group_delivery_rows', return_value={}), \
                patch.object(views, 'module_schedule_holidays', return_value=[]), \
                patch.object(views, 'resolve_stored_module_catalogue_id', side_effect=lambda value: value or ''):
            response = views.curriculum_preview_tutor_availability(request)
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content)

    def by_tutor(self, body):
        return {item['tutor']: item for item in body['results']}

    def test_directory_tutors_are_still_answered_for(self):
        results = self.by_tutor(self.preview([]))
        self.assertTrue(results['Tutor Directory']['available'])
        self.assertTrue(results['Tutor Directory']['inDirectory'])

    def test_a_name_only_a_module_carries_is_answered_for(self):
        """The reported case: a module's tutor that is not in the directory."""
        body = self.preview([module_row('MOD-REPLAC', 'Test-Replac', 'kentbusinesscollege.org')])
        verdict = self.by_tutor(body)['kentbusinesscollege.org']
        self.assertFalse(verdict['available'])
        self.assertFalse(verdict['inDirectory'])
        clash = verdict['conflicts'][0]
        self.assertEqual(clash['moduleName'], 'Test-Replac')
        self.assertEqual((clash['startTime'], clash['endTime']), ('11:00', '13:00'))
        self.assertIn('kentbusinesscollege.org is already teaching "Test-Replac"', verdict['message'])
        self.assertEqual(body['busyCount'], 1)

    def test_a_module_only_name_is_free_when_its_sessions_do_not_overlap(self):
        body = self.preview([
            module_row('MOD-LATE', 'Late Module', 'Former Tutor', start_time='13:00', end_time='15:00'),
        ])
        verdict = self.by_tutor(body)['Former Tutor']
        self.assertTrue(verdict['available'])
        self.assertFalse(verdict['inDirectory'])

    def test_overlapping_sessions_mark_a_directory_tutor_busy(self):
        body = self.preview([module_row('MOD-A', 'Module A', 'Tutor Busy', start_time='12:00', end_time='14:00')])
        results = self.by_tutor(body)
        self.assertFalse(results['Tutor Busy']['available'])
        self.assertEqual(results['Tutor Busy']['conflicts'][0]['moduleName'], 'Module A')
        self.assertTrue(results['Tutor Directory']['available'])

    def test_a_name_is_listed_once_however_many_modules_carry_it(self):
        body = self.preview([
            module_row('MOD-A', 'Module A', 'Tutor Busy'),
            module_row('MOD-B', 'Module B', 'tutor busy', start_date='2027-01-04'),
            module_row('MOD-C', 'Module C', 'Unassigned'),
            module_row('MOD-D', 'Module D', ''),
        ])
        names = [item['tutor'] for item in body['results']]
        self.assertEqual(names, ['Tutor Directory', 'Tutor Busy'])

    def test_a_differently_spelt_module_name_gets_the_same_verdict_as_the_save(self):
        """The save matches on the normalised key, so the roster does too."""
        body = self.preview([module_row('MOD-A', 'Module A', 'Tutor  Busy.')])
        results = self.by_tutor(body)
        self.assertFalse(results['Tutor Busy']['available'])
        self.assertFalse(results['Tutor  Busy.']['available'])
        self.assertTrue(results['Tutor  Busy.']['inDirectory'])
        self.assertIn('Tutor  Busy. is already teaching', results['Tutor  Busy.']['message'])

    def test_archived_modules_add_no_names(self):
        body = self.preview([
            module_row('MOD-OLD', 'Old Module', 'Gone Tutor', deleted_at='2026-01-01T00:00:00Z'),
        ])
        self.assertNotIn('Gone Tutor', self.by_tutor(body))

    def test_the_roster_agrees_with_the_save_time_check(self):
        """Every roster verdict is the answer find_tutor_schedule_conflicts gives."""
        modules = [
            module_row('MOD-REPLAC', 'Test-Replac', 'kentbusinesscollege.org'),
            module_row('MOD-A', 'Module A', 'Tutor Busy', start_time='09:00', end_time='11:30'),
        ]
        body = self.preview(modules)
        with patch.object(views, 'safe_group_delivery_rows', return_value={}), \
                patch.object(views, 'module_schedule_holidays', return_value=[]):
            candidate = views.module_schedule_view(SLOT)
            for item in body['results']:
                conflicts = views.find_tutor_schedule_conflicts(
                    {**candidate, 'tutor_name': item['tutor']},
                    module_rows=modules,
                )
                self.assertEqual(item['available'], not conflicts, item['tutor'])
