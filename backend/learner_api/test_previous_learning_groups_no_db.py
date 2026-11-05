from unittest import TestCase
from unittest.mock import MagicMock
from learner_api.previous_learning_groups import read_previous_learning_groups


class PreviousLearningGroupsTests(TestCase):
    def test_reads_only_owned_active_memberships_and_assigned_targets(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('50', 'M1'), ('60', 'FOREIGN')]
        self.assertEqual(read_previous_learning_groups(cursor, 12, [{'id': 'M1'}]), {'legacy:50': 'current:M1'})
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [12, ['M1']])
        self.assertIn('l.enrolment_id=%s', sql)
        self.assertIn('m.deleted_at IS NULL', sql)
        self.assertIn('c.deleted_at IS NULL', sql)

    def test_no_assigned_modules_never_hides_previous_learning(self):
        cursor = MagicMock()
        self.assertEqual(read_previous_learning_groups(cursor, 12, []), {})
        cursor.execute.assert_not_called()

    def test_conflicting_groups_keep_history_standalone(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('50', 'M1'), ('50', 'M2')]
        self.assertEqual(read_previous_learning_groups(cursor, 12, [{'id': 'M1'}, {'id': 'M2'}]), {})

    def test_endpoint_preserves_ownership_gate_and_returns_explicit_group(self):
        import json
        from types import SimpleNamespace
        from unittest.mock import patch
        from django.test import RequestFactory
        from learner_api.student_activity import subject_covers
        with patch('learner_api.progress_transfer.cover_transfer_metadata', return_value={}), \
             patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch('login.permissions.authenticate_request') as auth, \
             patch('learner_api.student_activity.connections') as connections, \
             patch('learner_api.student_activity.subject_store.ready', return_value=False), \
             patch('learner_api.student_activity._effective_current_subjects', return_value=[{'id': 'M1', 'title': 'Current'}]), \
             patch('learner_api.student_activity._builder_subject_metadata', return_value=({}, {})), \
             patch('learner_api.student_activity.read_builder_activity_dates', return_value={}), \
             patch('learner_api.previous_learning_groups.read_previous_learning_groups', return_value={'legacy:50': 'current:M1'}) as groups:
            auth.return_value = SimpleNamespace(role='staff')
            response = subject_covers(RequestFactory().get('/?refs=legacy:50'), pk=12)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content)['previous_learning_groups'], {'legacy:50': 'current:M1'})
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            groups.assert_called_once_with(cursor, 12, [{'id': 'M1', 'title': 'Current'}])
            groups.reset_mock()
            auth.return_value = SimpleNamespace(role='learner', subject_id=13)
            self.assertEqual(subject_covers(RequestFactory().get('/?refs=legacy:50'), pk=12).status_code, 404)
            groups.assert_not_called()
