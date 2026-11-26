"""Imported-course provenance regressions; no Django startup, DB or network."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch

from learner_api.subject_origins import read_imported_courses, read_replacement_courses


class ImportedCourseOriginTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network prohibited'))
        network.start()
        self.addCleanup(network.stop)
        self.cursor = MagicMock()

    def test_reads_import_provenance_only_within_effective_assignments(self):
        self.cursor.fetchall.return_value = [('M-OLD', '50')]
        self.assertEqual(read_imported_courses(self.cursor, [{'id': 'M-OLD'}, {'id': 'M-NEW'}]),
                         {'current:M-OLD': 'legacy:50'})
        sql, params = self.cursor.execute.call_args.args
        self.assertEqual(params, [['M-NEW', 'M-OLD']])
        self.assertIn("source_type='mba-legacy'", sql)
        self.assertIn('module_catalogue_id=ANY(%s)', sql)
        self.assertIn('deleted_at IS NULL OR deleted_via_parent IS NOT NULL', sql)

    def test_empty_assignment_never_queries_other_modules(self):
        self.assertEqual(read_imported_courses(self.cursor, []), {})
        self.cursor.execute.assert_not_called()

    def test_invalid_or_unassigned_origins_are_not_published(self):
        self.cursor.fetchall.return_value = [('FOREIGN', '50'), ('M1', ''), ('M2', 'bad'), ('M3', '0')]
        self.assertEqual(read_imported_courses(self.cursor, [{'id': mid} for mid in ('M1', 'M2', 'M3')]), {})

    def test_course_identity_is_numeric_like_student_activity_group_ids(self):
        self.cursor.fetchall.return_value = [('M1', '00050'), ('M2', '50')]
        self.assertEqual(read_imported_courses(self.cursor, [{'id': 'M1'}, {'id': 'M2'}]),
                         {'current:M1': 'legacy:50', 'current:M2': 'legacy:50'})

    def test_metadata_endpoint_uses_assigned_modules_not_client_refs(self):
        # Execute the real response builder with all I/O replaced. The existing
        # route decorators remain unchanged and are covered by endpoint tests.
        path = Path(__file__).with_name('student_activity.py')
        node = next(node for node in ast.parse(path.read_text(encoding='utf-8')).body
                    if isinstance(node, ast.FunctionDef) and node.name == 'subject_covers')
        node.decorator_list = []
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = self.cursor
        self.cursor.fetchall.return_value = [('M1', '50')]
        scope = {'__package__': 'learner_api', 'connections': {'enrolment': connection},
                 'subject_store': SimpleNamespace(ready=lambda cursor: False),
                 '_effective_current_subjects': Mock(return_value=[{'id': 'M1', 'title': 'Assigned'}]),
                 '_builder_subject_metadata': Mock(return_value=({}, {})),
                 'read_builder_activity_dates': Mock(return_value={}),
                 '_private': lambda payload: payload, 'DatabaseError': RuntimeError}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), scope)
        with patch('learner_api.progress_transfer.cover_transfer_metadata', return_value={}), \
             patch('learner_api.previous_learning_groups.read_previous_learning_groups', return_value={}), \
             patch('learner_api.subject_origins.read_replacement_courses', return_value={'current:M1': 'legacy:50'}) as replacements:
            result = scope['subject_covers'](SimpleNamespace(GET={'refs': 'current:FOREIGN'}), 12)
        replacements.assert_called_once_with(self.cursor, [{'id': 'M1', 'title': 'Assigned'}], 12)
        self.assertEqual(result['replacement_courses'], {'current:M1': 'legacy:50'})
        self.assertEqual(result['imported_courses'], {'current:M1': 'legacy:50'})
        self.assertEqual(self.cursor.execute.call_args.args[1], [['M1']])
        self.assertEqual(result['current_subjects'], [{'id': 'M1', 'title': 'Assigned'}])
        self.assertEqual(result['previous_learning_groups'], {})

    def test_verified_successor_requires_owned_course_and_explicit_assignment(self):
        self.cursor.fetchall.return_value = [('M1', '50')]
        self.assertEqual(read_replacement_courses(self.cursor, [{'id': 'M1'}], 12), {'current:M1': 'legacy:50'})
        sql, params = self.cursor.execute.call_args.args
        self.assertEqual(params, [False, 12, ['M1']])
        for condition in ("mapping_method='verified_source_replacement'", "mapping_status='matched'",
                          "source_system='old_lms'", "l.enrolment_id=%s", "m.deleted_at IS NULL",
                          "c.deleted_at IS NULL", "'{verified_replacement,module_id}'=c.curriculum_module_ref"):
            self.assertIn(condition, sql)

    def test_ambiguous_invalid_and_unassigned_replacements_are_not_grouped(self):
        self.cursor.fetchall.return_value = [('M1', '50'), ('M1', '51'), ('FOREIGN', '60'), ('M2', 'bad'), ('M3', '050'), ('M3', '50')]
        self.assertEqual(read_replacement_courses(self.cursor, [{'id': key} for key in ('M1', 'M2', 'M3')], 12),
                         {'current:M3': 'legacy:50'})

    def test_personal_replacement_is_bound_to_membership_owner_and_course(self):
        self.cursor.fetchall.return_value = [('M1', '50')]
        self.assertEqual(read_replacement_courses(self.cursor, [{'id': 'M1'}], 12, include_personal=True), {'current:M1': 'legacy:50'})
        sql, params = self.cursor.execute.call_args.args
        self.assertEqual(params, [True, 12, ['M1']])
        for condition in (
            "'{verified_replacement,scope}'='learner'",
            "'{verified_replacement,learner_id}'=m.learner_id::text",
            "'{verified_replacement,enrolment_id}'=l.enrolment_id::text",
            "'{verified_replacement,source_course_ref}'=c.source_course_ref",
            "'{verified_replacement,verified_by}' ~ '^[1-9][0-9]*$'",
            'COALESCE(personal.module_id,c.curriculum_module_ref)=ANY(%s)',
        ):
            self.assertIn(condition, sql)

    def test_no_assignments_never_queries_replacements(self):
        self.assertEqual(read_replacement_courses(self.cursor, [], 12), {})
        self.cursor.execute.assert_not_called()


if __name__ == '__main__':
    unittest.main()
