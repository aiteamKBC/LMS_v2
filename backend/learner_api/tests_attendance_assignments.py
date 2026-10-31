"""Effective attendance assignments; isolated reads, no database or Teams calls."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .attendance_assignments import assigned_module_ids, module_roster, roster_sources
from .attendance_lectures import read_assigned_modules, read_native_components, read_native_occurrences
from curriculum_api.session_results import effective_module_register_rows, merge_session_register_rows


def learner(pk=1, **values):
    return SimpleNamespace(pk=pk, id=pk, username='Example Learner', email='learner@example.test',
                           **{'programme': 'P', 'group': 'G', 'training_plan': None,
                              'learning_plan': None, **values})


class EffectiveAttendanceAssignmentsTests(SimpleTestCase):
    def test_roster_projection_resolves_programme_from_fk(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = []
        with patch('learner_api.attendance_assignments.connections', {'enrolment': connection}):
            self.assertEqual(roster_sources(), [])
        sql = cursor.execute.call_args.args[0]
        self.assertIn("coalesce(nullif(btrim(programme.name),''),u.programme_id,'') AS programme", sql)
        self.assertIn('LEFT JOIN curriculum.programmes programme', sql)
        self.assertNotIn('u."Programme"', sql)

    def test_inherited_modules_match_learning_plan_for_both_learner_types(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), patch('learner_api.selectors.assignments._group_module_ids', return_value=['NEW', 'OLD']):
                source = learner(learner_type=kind, learning_plan=[{'moduleId': 'OLD'}])
                self.assertEqual(assigned_module_ids(source), ['OLD', 'NEW'])

    def test_missing_plan_inherits_but_empty_or_explicit_plan_does_not(self):
        with patch('learner_api.selectors.assignments._group_module_ids', return_value=['GROUP']) as preset:
            self.assertEqual(assigned_module_ids(learner()), ['GROUP'])
            preset.reset_mock()
            self.assertEqual(assigned_module_ids(learner(training_plan=[])), [])
            self.assertEqual(assigned_module_ids(learner(training_plan=[{'moduleId': 'OTHER', 'assignmentMode': 'explicit'}])), ['OTHER'])
            preset.assert_not_called()

    def test_training_plan_precedence_does_not_resurrect_old_learning_plan(self):
        source = learner(training_plan=[], learning_plan=[{'moduleId': 'STALE'}])
        self.assertEqual(assigned_module_ids(source), [])

    def test_roster_uses_effective_membership_and_enrolment_identity_in_bulk(self):
        members = [learner(1, learning_plan=[{'moduleId': 'OLD'}]),
                   learner(2, group='OTHER'), learner(3, training_plan=[]),
                   learner(4, training_plan=[{'moduleId': 'OLD', 'assignmentMode': 'explicit'}])]
        with patch('learner_api.attendance_assignments.roster_sources', return_value=members), \
             patch('learner_api.attendance_assignments.LearnerProfile.objects') as profiles, \
             patch('learner_api.attendance_assignments.group_module_ids_bulk', return_value={('P', 'G'): ['NEW'], ('P', 'OTHER'): []}) as presets:
            profiles.filter.return_value.values.return_value = [
                {'id': 90, 'enrolment_id': 1, 'email': 'old@example.test', 'full_name': 'Old Name'}]
            self.assertEqual(module_roster('NEW'), [{'learner_profile_id': 90,
                'learner_email': 'learner@example.test', 'learner_name': 'Example Learner'}])
            self.assertEqual(set(profiles.filter.call_args.kwargs['enrolment_id__in']), {1})
            presets.assert_called_once()

    def test_projection_is_not_presence_and_preserves_verified_history(self):
        member = {'learner_profile_id': 90, 'learner_email': 'learner@example.test', 'learner_name': 'Example Learner'}
        with patch('learner_api.attendance_assignments.module_roster', return_value=[member]):
            rows = effective_module_register_rows('M', [
                {'id': 'PAST', 'attendance_report_id': 'R', 'actual_end': '2026-10-01'},
                {'id': 'FUTURE'},
            ])
        self.assertEqual([r['attendance_status'] for r in rows], ['absent', 'pending'])
        self.assertTrue(all(r['attended_seconds'] == 0 for r in rows))
        saved = {**rows[0], 'attendance_status': 'present', 'attended_seconds': 600, 'recovery_status': 'completed'}
        merged = merge_session_register_rows([saved, rows[0]])
        self.assertEqual((merged[0]['attendance_status'], merged[0]['attended_seconds'], merged[0]['recovery_status']), ('present', 600, 'completed'))

    def test_selector_schedule_and_components_use_the_same_effective_ids(self):
        from unittest.mock import MagicMock
        source = learner(training_plan=[{'moduleId': 'OLD'}])
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('NEW', 'Inherited module')]
        with patch('learner_api.selectors.assignments._group_module_ids', return_value=['NEW']), \
             patch('learner_api.attendance_lectures.connections', {'enrolment': connection}), \
             patch('learner_api.attendance_lectures.dict_rows', return_value=[]):
            self.assertEqual(read_assigned_modules(source), [{'id': 'NEW', 'title': 'Inherited module'}])
            read_native_occurrences(source)
            read_native_components(source, monthly=True)
        assignment_calls = [call for call in cursor.execute.call_args_list if 'SELECT DISTINCT cm.module_catalogue_id,cm.title' in call.args[0]]
        self.assertEqual(len(assignment_calls), 3)
        self.assertTrue(all(call.args[1] == [['OLD', 'NEW']] for call in assignment_calls))
