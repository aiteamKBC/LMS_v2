"""Renames write only curriculum names; learners are found by id for a refresh.

No database connection: a fake PostgreSQL cursor records every statement. The
canonical name lives in its owning curriculum table, and "Learner".learners /
enrolment."Created_users" keep only placement ids, so a rename must never write
or match on a learner/enrolment name column.
"""
import re
from unittest.mock import MagicMock, call, patch

from django.test import SimpleTestCase

from . import cohort_rename, placement_rename

#: Name columns that no longer exist on learner/enrolment rows, and any write to them.
REMOVED = re.compile(
    r'"Programme"|"Cohort"|"Group"|Created_users|UPDATE\s+"Learner"\.learners'
    r'|\b(?:l|u|learners)\.(?:programme|cohort|group_name)\b|\bSET\s+(?:programme|cohort|group_name)\b',
    re.IGNORECASE,
)
LEARNERS = [(101, 'Apprenticeship'), (102, 'commercial'), (None, 'commercial')]


def _connection(lookup=None, rows=LEARNERS):
    cursor = MagicMock()
    cursor.fetchone.return_value = lookup
    cursor.fetchall.return_value = list(rows)
    connection = MagicMock(vendor='postgresql', in_atomic_block=True)
    connection.cursor.return_value.__enter__.return_value = cursor
    return connection, cursor


def _statements(cursor):
    return [(' '.join(c.args[0].split()), c.args[1]) for c in cursor.execute.call_args_list]


def _refreshes(reason):
    # (None, ...) is skipped; learner type maps to the projection kind.
    return [call('apprenticeship', 101, reason=reason, using='default'),
            call('commercial', 102, reason=reason, using='default')]


class RenameSqlGuard:
    def assert_no_removed_columns(self, statements):
        for sql, _ in statements:
            self.assertIsNone(REMOVED.search(sql), sql)
            self.assertTrue(sql.upper().startswith('SELECT'), sql)


class ProgrammeRenameTests(RenameSqlGuard, SimpleTestCase):
    def rename(self, old='Old programme', name='New programme', rows=LEARNERS, vendor='postgresql'):
        connection, cursor = _connection(rows=rows)
        connection.vendor = vendor
        with patch.object(placement_rename, 'connection', connection), \
                patch('learner_api.read_model.enqueue_learner_home_refresh') as refresh:
            placement_rename.propagate_programme_name_to_learners('PROG-1', old, name)
        return _statements(cursor), refresh

    def test_learners_are_found_read_only_by_programme_id_and_refreshed(self):
        statements, refresh = self.rename()
        self.assertEqual(statements, [('SELECT enrolment_id, learner_type FROM "Learner".learners '
                                       'WHERE programme_id = %s', ['PROG-1'])])
        self.assert_no_removed_columns(statements)
        self.assertCountEqual(refresh.call_args_list, _refreshes('programme-rename'))

    def test_zero_matching_learners_queues_nothing(self):
        statements, refresh = self.rename(rows=[])
        self.assertEqual(len(statements), 1)
        refresh.assert_not_called()

    def test_a_namesake_programme_no_longer_matters(self):
        # The old legacy name match needed this check; ids are unambiguous.
        statements, refresh = self.rename()
        self.assertFalse(any('curriculum.programmes' in sql for sql, _ in statements))
        self.assertEqual(refresh.call_count, 2)

    def test_an_unchanged_or_missing_name_reads_nothing(self):
        for old, name in (('Same', 'Same'), ('', 'New'), ('Old', '')):
            with self.subTest(old=old, name=name):
                statements, refresh = self.rename(old=old, name=name)
                self.assertEqual(statements, [])
                refresh.assert_not_called()

    def test_sqlite_has_no_learner_tables(self):
        statements, refresh = self.rename(vendor='sqlite')
        self.assertEqual(statements, [])
        refresh.assert_not_called()


class GroupRenameTests(RenameSqlGuard, SimpleTestCase):
    GROUP = {'group_id': 'GRP-1', 'group_name': 'G1 Monday', 'cohort_id': 'COH-1',
             'programme_name': 'Programme', 'cohort_name': 'October 2026'}

    def rename(self, group=None, name='G1 Tuesday', rows=LEARNERS):
        connection, cursor = _connection(rows=rows)
        with patch.object(placement_rename, 'connection', connection), \
                patch('curriculum_api.views.update_authoring_rows') as modules, \
                patch('curriculum_api.versioning.audit_context') as audit, \
                patch('learner_api.read_model.enqueue_learner_home_refresh') as refresh:
            placement_rename.propagate_group_name_to_learners(group or self.GROUP, name)
        return _statements(cursor), modules, audit, refresh

    def test_module_copy_is_renamed_and_learners_are_found_by_group_id(self):
        from . import views

        statements, modules, audit, refresh = self.rename()
        modules.assert_called_once_with(
            views.AUTHORING_MODULES_TABLE, "group_id = %s and coalesce(group_name, '') <> %s",
            ['GRP-1', 'G1 Tuesday'], {'group_name': 'G1 Tuesday'},
        )
        self.assertEqual(audit.call_args.kwargs['metadata'],
                         {'recalculated_from': 'group_rename', 'reason_code': 'group_name_propagation'})
        self.assertEqual(statements, [('SELECT enrolment_id, learner_type FROM "Learner".learners '
                                       'WHERE group_id = %s', ['GRP-1'])])
        self.assert_no_removed_columns(statements)
        self.assertCountEqual(refresh.call_args_list, _refreshes('group-rename'))

    def test_zero_matching_learners_still_renames_the_module_copy(self):
        statements, modules, _, refresh = self.rename(rows=[])
        modules.assert_called_once()
        self.assertEqual(len(statements), 1)
        refresh.assert_not_called()

    def test_namesakes_and_a_missing_cohort_no_longer_change_the_lookup(self):
        for group in ({**self.GROUP, 'cohort_id': ''}, self.GROUP):
            with self.subTest(group=group):
                statements, _, _, _ = self.rename(group=group)
                self.assertFalse(any('curriculum.groups' in sql for sql, _ in statements))
                self.assertEqual(statements[0][1], ['GRP-1'])

    def test_an_unnamed_group_renames_modules_but_keeps_the_previous_no_refresh_rule(self):
        statements, modules, _, refresh = self.rename(group={**self.GROUP, 'group_name': ''})
        modules.assert_called_once()
        self.assertEqual(statements, [])
        refresh.assert_not_called()

    def test_an_unchanged_name_does_nothing(self):
        statements, modules, _, refresh = self.rename(name='G1 Monday')
        self.assertEqual(statements, [])
        modules.assert_not_called()
        refresh.assert_not_called()


class CohortRenameTests(RenameSqlGuard, SimpleTestCase):
    COHORT = {'cohort_id': 'COH-1', 'cohort_name': 'Oct 2026', 'programme_name': 'Programme'}

    def rename(self, name='October 2026', conflict=None, rows=LEARNERS, vendor='postgresql', atomic=True):
        connection, cursor = _connection(lookup=conflict, rows=rows)
        connection.vendor, connection.in_atomic_block = vendor, atomic
        with patch.object(cohort_rename, 'connection', connection), \
                patch('curriculum_api.views.update_authoring_rows') as copies, \
                patch('curriculum_api.versioning.audit_context') as audit, \
                patch('learner_api.read_model.enqueue_learner_home_refresh') as refresh:
            error = None
            try:
                cohort_rename.propagate_cohort_name(self.COHORT, name)
            except Exception as exc:  # noqa: BLE001 - asserted by the caller
                error = exc
        return _statements(cursor), copies, audit, refresh, error

    def test_conflict_lock_then_read_only_lookup_then_copies_and_refresh(self):
        from . import views

        statements, copies, audit, refresh, error = self.rename()
        self.assertIsNone(error)
        (conflict_sql, conflict_params), (lookup_sql, lookup_params) = statements
        self.assertIn('FOR UPDATE', conflict_sql)                                      # lock kept
        self.assertEqual(conflict_params, ['Programme', 'Oct 2026', 'October 2026', 'COH-1'])
        self.assertEqual((lookup_sql, lookup_params), (
            'SELECT enrolment_id, learner_type FROM "Learner".learners WHERE cohort_id = %s', ['COH-1']))
        self.assert_no_removed_columns(statements)
        self.assertEqual(copies.call_args_list, [
            call(table, "cohort_id = %s and coalesce(cohort_name, '') <> %s", ['COH-1', 'October 2026'],
                 {'cohort_name': 'October 2026'})
            for table in (views.GROUPS_TABLE, views.AUTHORING_MODULES_TABLE)])
        self.assertEqual(audit.call_args.kwargs['metadata'],
                         {'recalculated_from': 'cohort_rename', 'reason_code': 'cohort_name_propagation'})
        self.assertCountEqual(refresh.call_args_list, _refreshes('cohort-rename'))

    def test_duplicate_name_raises_conflict_before_any_copy_or_refresh(self):
        statements, copies, _, refresh, error = self.rename(conflict=('OTHER-COHORT',))
        self.assertIsInstance(error, cohort_rename.CohortRenameConflict)               # view -> HTTP 409
        self.assertEqual(len(statements), 1)
        copies.assert_not_called()
        refresh.assert_not_called()

    def test_zero_matching_learners_still_renames_the_copies(self):
        statements, copies, _, refresh, error = self.rename(rows=[])
        self.assertIsNone(error)
        self.assertEqual(len(statements), 2)
        self.assertEqual(copies.call_count, 2)
        refresh.assert_not_called()

    def test_a_failed_copy_write_queues_no_refresh(self):
        connection, cursor = _connection()
        with patch.object(cohort_rename, 'connection', connection), \
                patch('curriculum_api.views.update_authoring_rows', side_effect=RuntimeError('synthetic')), \
                patch('learner_api.read_model.enqueue_learner_home_refresh') as refresh, \
                self.assertRaises(RuntimeError):
            cohort_rename.propagate_cohort_name(self.COHORT, 'October 2026')
        refresh.assert_not_called()

    def test_unchanged_name_does_nothing_and_a_rename_requires_the_parent_transaction(self):
        statements, copies, _, refresh, error = self.rename(name='Oct 2026')
        self.assertEqual((statements, error), ([], None))
        copies.assert_not_called()
        statements, _, _, _, error = self.rename(atomic=False)
        self.assertIsInstance(error, RuntimeError)
        self.assertEqual(statements, [])

    def test_sqlite_checks_conflicts_and_copies_without_learner_lookup(self):
        statements, copies, _, refresh, error = self.rename(vendor='sqlite')
        self.assertIsNone(error)
        self.assertEqual(len(statements), 1)
        self.assertNotIn('FOR UPDATE', statements[0][0])
        self.assertEqual(copies.call_count, 2)
        refresh.assert_not_called()


class PlacedLearnersTests(SimpleTestCase):
    def test_only_known_placement_columns_are_accepted(self):
        with self.assertRaises(ValueError):
            placement_rename.placed_learners('programme; DROP TABLE x', 'P')

    def test_the_callers_connection_is_used(self):
        connection, cursor = _connection(rows=[(1, 'commercial')])
        self.assertEqual(placement_rename.placed_learners('group_id', 'G', connection), {(1, 'commercial')})
        cursor.execute.assert_called_once()
