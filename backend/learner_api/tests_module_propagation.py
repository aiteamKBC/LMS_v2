"""Module assignments and live authored content, without a database or writes."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .learning_plan import _effective_plan_ids, learning_plan, module_learners
from .learner_detail import _append_week_quizzes, _resolve_from_master
from .mappers import get_training_plan, stored_training_plan, training_plan_field


MODULE = {
    'moduleId': 'MOD-NEW', 'moduleTitle': 'New module', 'programmeId': 'PROG-1',
    'programmeName': 'Programme', 'groupName': 'Group', 'hours': 12, 'startDate': '', 'endDate': '',
}


def learner(**changes):
    return SimpleNamespace(**{
        'id': 101, 'pk': 101, 'username': 'Learner', 'email': 'learner@example.test',
        'programme': 'Programme', 'group': 'Group', 'cohort': 'Cohort',
        'programme_status': 'Delivery', 'learner_type': 'commercial',
        'learning_plan': None, 'training_plan': None, 'save': Mock(), **changes,
    })


class ModuleAssignmentTests(SimpleTestCase):
    def test_both_plan_columns_use_the_same_precedence_for_reads_and_writes(self):
        for training in ([MODULE], json.dumps([MODULE])):
            source = learner(training_plan=training, learning_plan=[{'moduleId': 'OLD'}])
            self.assertEqual(get_training_plan(source), [MODULE])
            self.assertEqual(training_plan_field(source), 'training_plan')
        source = learner(learning_plan=[MODULE])
        self.assertEqual(get_training_plan(source), [MODULE])
        self.assertEqual(training_plan_field(source), 'learning_plan')

    def test_clearing_a_plan_does_not_restore_old_csv_or_group_assignments(self):
        source = learner(training_plan=[], learning_plan=[MODULE], modules='Old course')
        self.assertEqual(get_training_plan(source), [])
        with patch('learner_api.learning_plan._group_module_ids') as preset:
            self.assertEqual(_effective_plan_ids(source, {}), [])
        preset.assert_not_called()

    def test_unsaved_legacy_csv_remains_readable(self):
        source = learner(modules='Historic course')
        self.assertIsNone(stored_training_plan(source))
        self.assertEqual(get_training_plan(source)[0]['moduleTitle'], 'Historic course')

    def test_saving_empty_training_plan_keeps_it_empty_in_the_response(self):
        source = learner(training_plan=[MODULE])
        request = RequestFactory().patch('/', data=json.dumps({'modules': []}), content_type='application/json')
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='admin')), \
                patch('learner_api.learning_plan.EnrolmentUser') as model, \
                patch('learner_api.learning_plan._all_modules', return_value=[MODULE]), \
                patch('learner_api.learning_plan._programme_modules', return_value=[MODULE]), \
                patch('learner_api.learning_plan._group_module_ids', return_value=['MOD-NEW']), \
                patch('learner_api.learning_plan.advance_learner'):
            model.all_learners.get.return_value = source
            response = learning_plan(request, 101)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['plan'], [])
        self.assertTrue(json.loads(response.content)['saved'])
        source.save.assert_called_once_with(update_fields=['training_plan'])

    def test_builder_assignment_uses_the_same_column_and_preserves_other_learners(self):
        source, other = learner(training_plan=[]), learner(id=102, pk=102, learning_plan=[])
        request = RequestFactory().patch('/', data=json.dumps({'learnerIds': ['101']}), content_type='application/json')
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='admin')), \
                patch('learner_api.learning_plan._all_modules', return_value=[MODULE]), \
                patch('learner_api.learning_plan._picker_learners', return_value=[source, other]), \
                patch('learner_api.learning_plan.advance_learner'):
            response = module_learners(request, 'MOD-NEW')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(get_training_plan(source), [MODULE])
        self.assertEqual(get_training_plan(other), [])
        source.save.assert_called_once_with(update_fields=['training_plan'])
        other.save.assert_not_called()


class LiveAssignedModuleTests(SimpleTestCase):
    def resolve(self, rows, modules=None, weeks=None, components=None, assigned=None):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect = rows
        with patch('learner_api.learner_detail.connections', {'enrolment': connection}), \
                patch('learner_api.learner_detail._audit_sources_by_component_id', return_value={}):
            result = _resolve_from_master(modules or [], weeks or [], components or [], assigned_modules=assigned)
        return result, cursor

    def test_new_assignment_is_visible_before_it_has_weeks(self):
        result, cursor = self.resolve([[('MOD-NEW', 'Renamed module')], [], []], assigned=[MODULE])
        self.assertEqual(result, (['Renamed module'], [], []))
        self.assertEqual(cursor.execute.call_args_list[0].args[1], [['MOD-NEW']])

    def test_content_added_after_assignment_is_read_live_without_reassigning(self):
        html = '<iframe src="https://example.test/lesson"></iframe>'
        result, _ = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 1', 1, 0)],
            [('C-NEW', 'W-NEW', 'MOD-NEW', 'reading', 'New activity', '',
              {'readingContent': html}, '', 0, [{'code': 'K1', 'weight': 1}], False, None, False)],
            [],
        ], assigned=[MODULE])
        self.assertEqual(result[2][0]['componentId'], 'C-NEW')
        self.assertEqual(result[2][0]['contentHtml'], html)
        self.assertEqual(result[2][0]['moduleId'], 'MOD-NEW')

    def test_current_membership_replaces_stale_children(self):
        result, cursor = self.resolve([[('MOD-NEW', 'New module')], [], []],
            modules=['Old module'], weeks=[{'moduleId': 'MOD-OLD', 'module': 'Old module'}], assigned=[MODULE])
        self.assertEqual(result, (['New module'], [], []))
        self.assertEqual(cursor.execute.call_args_list[0].args[1], [['MOD-NEW']])

    def test_explicitly_removed_assignments_cannot_reappear_from_snapshot(self):
        result, cursor = self.resolve([], modules=['Old module'], assigned=[])
        self.assertEqual(result, ([], [], []))
        cursor.execute.assert_not_called()

    def test_new_module_can_contain_only_a_published_module_level_quiz(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect = [
            [('MOD-NEW', 'New module', 'PROG-1', 'Programme')],
            [(90, 'MOD-NEW', '')],
            [(90, '', 'Assessment', 3, 30, 'Minutes', '', '', '')],
            [],
        ]
        with patch('learner_api.learner_detail.connections', {'enrolment': connection}):
            weeks, components = _append_week_quizzes([], [], assigned_modules=[MODULE])
        self.assertEqual(weeks[0]['moduleId'], 'MOD-NEW')
        self.assertEqual(components[0]['quizMeta']['quizId'], 90)
        self.assertTrue(components[0]['isQuiz'])

    def test_deleted_new_module_does_not_regain_its_quizzes(self):
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        with patch('learner_api.learner_detail.connections', {'enrolment': connection}):
            self.assertEqual(_append_week_quizzes([], [], assigned_modules=[MODULE]), ([], []))
