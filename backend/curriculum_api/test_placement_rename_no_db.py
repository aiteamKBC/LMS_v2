"""Renames reach learner records through the profile's id; no DB connection.

The statements themselves are PostgreSQL-only and were checked against the
schema with EXPLAIN; these pin which learners each rename may touch.
"""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import cohort_rename, placement_rename


def _connection(lookup=None, updated=((1, 'Apprenticeship'),)):
    cursor = MagicMock()
    cursor.fetchone.return_value = lookup
    cursor.fetchall.return_value = list(updated)
    connection = MagicMock(vendor='postgresql', in_atomic_block=True)
    connection.cursor.return_value.__enter__.return_value = cursor
    return connection, cursor


def _statements(cursor):
    return [(call.args[0], call.args[1]) for call in cursor.execute.call_args_list]


class ProgrammeRenameTests(SimpleTestCase):
    def rename(self, lookup=None, old='Old programme', name='New programme'):
        connection, cursor = _connection(lookup)
        with patch.object(placement_rename, 'connection', connection), \
                patch('learner_api.read_model.enqueue_learner_home_refresh') as refresh:
            placement_rename.propagate_programme_name_to_learners('PROG-1', old, name)
        return _statements(cursor), refresh

    def test_learners_are_renamed_by_their_programme_id_and_only_from_the_old_name(self):
        statements, refresh = self.rename()
        (_, check), (profiles, params), (enrolments, _) = statements
        self.assertEqual(check['id'], 'PROG-1')
        self.assertIn('programme_id = %(id)s', profiles)
        self.assertIn('WHERE programme = %(old)s', profiles)
        self.assertIn('l.programme_id = %(id)s', enrolments)
        self.assertIn('u."Programme" = %(old)s', enrolments)
        self.assertEqual((params['old'], params['name'], params['legacy']), ('Old programme', 'New programme', True))
        refresh.assert_called_once_with('apprenticeship', 1, reason='programme-rename', using='default')

    def test_a_learner_without_an_id_is_left_alone_when_another_programme_has_the_name(self):
        statements, _ = self.rename(lookup=(1,))
        self.assertFalse(statements[1][1]['legacy'])
        self.assertFalse(statements[2][1]['legacy'])

    def test_an_unchanged_or_missing_name_writes_nothing(self):
        for old, name in (('Same', 'Same'), ('', 'New'), ('Old', '')):
            statements, refresh = self.rename(old=old, name=name)
            self.assertEqual(statements, [])
            refresh.assert_not_called()

    def test_sqlite_has_no_learner_tables_to_rename(self):
        connection, cursor = _connection()
        connection.vendor = 'sqlite'
        with patch.object(placement_rename, 'connection', connection):
            placement_rename.propagate_programme_name_to_learners('PROG-1', 'Old', 'New')
        cursor.execute.assert_not_called()


class GroupRenameTests(SimpleTestCase):
    GROUP = {'group_id': 'GRP-1', 'group_name': 'G1 Monday', 'cohort_id': 'COH-1',
             'programme_name': 'Programme', 'cohort_name': 'October 2026'}

    def rename(self, group=None, lookup=None, name='G1 Tuesday'):
        connection, cursor = _connection(lookup)
        with patch.object(placement_rename, 'connection', connection), \
                patch('curriculum_api.views.update_authoring_rows') as modules, \
                patch('learner_api.read_model.enqueue_learner_home_refresh') as refresh:
            placement_rename.propagate_group_name_to_learners(group or self.GROUP, name)
        return _statements(cursor), modules, refresh

    def test_modules_and_learners_follow_the_group_id(self):
        from . import views

        statements, modules, refresh = self.rename()
        modules.assert_called_once_with(
            views.AUTHORING_MODULES_TABLE, "group_id = %s and coalesce(group_name, '') <> %s",
            ['GRP-1', 'G1 Tuesday'], {'group_name': 'G1 Tuesday'},
        )
        (check, _), (profiles, params), (enrolments, _) = statements
        self.assertIn('cohort_id = %(cohort_id)s', check)
        self.assertIn('group_id = %(id)s', profiles)
        self.assertIn('WHERE group_name = %(old)s', profiles)
        self.assertIn('l.group_id = %(id)s', enrolments)
        self.assertIn('u."Group" = %(old)s', enrolments)
        self.assertTrue(params['legacy'])
        refresh.assert_called_once_with('apprenticeship', 1, reason='group-rename', using='default')

    def test_a_namesake_in_the_same_cohort_stops_name_matching(self):
        statements, _, _ = self.rename(lookup=(1,))
        self.assertFalse(statements[1][1]['legacy'])

    def test_a_group_with_no_cohort_renames_only_learners_linked_by_id(self):
        statements, _, _ = self.rename(group={**self.GROUP, 'cohort_id': ''})
        self.assertFalse(statements[1][1]['legacy'])

    def test_an_unchanged_name_writes_nothing(self):
        statements, modules, _ = self.rename(name='G1 Monday')
        self.assertEqual(statements, [])
        modules.assert_not_called()


class CohortRenameEnrolmentLinkTests(SimpleTestCase):
    def test_an_enrolment_linked_by_cohort_id_is_renamed_despite_a_stale_programme_label(self):
        cohort = {'cohort_id': 'COH-1', 'cohort_name': 'Oct 2026', 'programme_name': 'Programme'}
        connection, cursor = _connection()
        with patch.object(cohort_rename, 'connection', connection), \
                patch('curriculum_api.views.update_authoring_rows'), \
                patch('learner_api.read_model.enqueue_learner_home_refresh'):
            cohort_rename.propagate_cohort_name(cohort, 'October 2026')
        enrolments = next((sql, params) for sql, params in _statements(cursor) if 'Created_users' in sql)
        self.assertIn('l.cohort_id = %s', enrolments[0])
        self.assertIn('WHERE u."Cohort" = %s', enrolments[0])
        self.assertEqual(enrolments[1], ['October 2026', 'Oct 2026', 'COH-1', 'Programme', 'COH-1'])
