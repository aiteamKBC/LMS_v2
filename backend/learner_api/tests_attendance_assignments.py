"""Effective attendance assignments; isolated reads, no database or Teams calls."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import attendance_assignments as assignments
from .attendance_assignments import assigned_module_ids, module_roster
from .attendance_lectures import read_assigned_modules, read_native_components, read_native_occurrences
from curriculum_api.session_results import effective_module_register_rows, merge_session_register_rows


def learner(pk=1, **values):
    return SimpleNamespace(pk=pk, id=pk, username='Example Learner', email='learner@example.test',
                           **{'programme': 'P', 'group': 'G', 'group_id': 'G', 'training_plan': None,
                              'learning_plan': None, **values})


class EffectiveAttendanceAssignmentsTests(SimpleTestCase):
    def test_canonical_modules_replace_stale_legacy_projection_for_both_learner_types(self):
        for kind in ('commercial', 'apprenticeship'):
            source = learner(learner_type=kind, learning_plan=[{'moduleId': 'STALE'}])
            profile = SimpleNamespace(pk=248, enrolment_id=source.pk)
            with self.subTest(kind=kind), \
                    patch.object(assignments, 'learner_profile_for_source', return_value=profile), \
                    patch.object(assignments, 'install_canonical_training_plan_module_ids',
                                 side_effect=lambda item, _profile: setattr(
                                     item, '_canonical_training_plan', [{'moduleId': 'CANONICAL'}]
                                 ) or item._canonical_training_plan):
                self.assertEqual(assigned_module_ids(source), ['CANONICAL'])
                self.assertEqual(source.learning_plan, [{'moduleId': 'STALE'}])

    def test_empty_canonical_plan_does_not_fall_back_to_legacy_or_preset(self):
        source = learner(training_plan=[{'moduleId': 'STALE'}])
        source._canonical_training_plan = []
        with patch('learner_api.learning_plan._group_module_ids',
                   side_effect=AssertionError('legacy preset fallback')) as preset:
            self.assertEqual(assigned_module_ids(source), [])
        preset.assert_not_called()

    def test_missing_canonical_identity_fails_closed_without_installing(self):
        source = learner(training_plan=[{'moduleId': 'STALE'}])
        with patch.object(assignments, 'learner_profile_for_source', return_value=None), \
             patch.object(assignments, 'install_canonical_training_plan_module_ids') as install:
            self.assertEqual(assigned_module_ids(source), [])
        install.assert_not_called()

    def test_roster_uses_effective_membership_and_enrolment_identity_in_bulk(self):
        members = [learner(1, learning_plan=[{'moduleId': 'OLD'}]),
                   learner(2, group='OTHER', group_id='OTHER'), learner(3, training_plan=[]),
                   learner(4, training_plan=[{'moduleId': 'OLD', 'assignmentMode': 'explicit'}])]
        with patch('learner_api.attendance_assignments.roster_sources', return_value=members), \
             patch('learner_api.attendance_assignments.LearnerProfile.objects') as profiles, \
             patch('curriculum_api.learner_assignment_counts_sql.seed_preset_cache',
                   return_value={('group_id', 'G'): ['NEW'], ('group_id', 'OTHER'): []}) as presets:
            profiles.filter.return_value.values.return_value = [
                {'id': 90, 'enrolment_id': 1, 'email': 'old@example.test', 'full_name': 'Old Name'}]
            self.assertEqual(module_roster('NEW'), [{'learner_profile_id': 90,
                'learner_email': 'learner@example.test', 'learner_name': 'Example Learner'}])
            self.assertEqual(set(profiles.filter.call_args.kwargs['enrolment_id__in']), {1})
            presets.assert_called_once()

    def test_projection_is_not_presence_and_preserves_verified_history(self):
        member = {'learner_profile_id': 90, 'learner_email': 'learner@example.test', 'learner_name': 'Example Learner'}
        with patch('curriculum_api.attendance_membership.module_roster', return_value=[member]):
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
        source = learner(training_plan=[{'moduleId': 'OLD'}],
                         _canonical_training_plan=[{'moduleId': 'OLD'}, {'moduleId': 'NEW'}])
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('NEW', 'Inherited module')]
        with patch('learner_api.attendance_lectures.connections', {'enrolment': connection}), \
             patch('learner_api.attendance_lectures.dict_rows', return_value=[]):
            self.assertEqual(read_assigned_modules(source), [{'id': 'NEW', 'title': 'Inherited module'}])
            read_native_occurrences(source)
            read_native_components(source, monthly=True)
        assignment_calls = [call for call in cursor.execute.call_args_list if 'SELECT DISTINCT cm.module_catalogue_id,cm.title' in call.args[0]]
        self.assertEqual(len(assignment_calls), 3)
        self.assertTrue(all(call.args[1] == [['OLD', 'NEW']] for call in assignment_calls))
