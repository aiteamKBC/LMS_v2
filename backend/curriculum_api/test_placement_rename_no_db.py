"""Renames write only curriculum names; learners are found by id for a refresh.

No remote database connection: fake PostgreSQL cursors record statements and
an in-memory SQLite adapter checks transaction rollback. The
canonical name lives in its owning curriculum table, and "Learner".learners /
enrolment."Created_users" keep only placement ids, so a rename must never write
or match on a learner/enrolment name column.
"""
import re
import sys
import types
import unittest
from contextlib import nullcontext
from unittest.mock import MagicMock, call, patch

class SimpleTestCase(unittest.TestCase):
    """Isolate the rename boundary: no Django setup, app imports or remote DB."""

    def setUp(self):
        super().setUp()
        from . import __name__ as package_name
        package = sys.modules[package_name]
        views = types.ModuleType(package_name + '.views')
        views.GROUPS_TABLE = 'groups'
        views.AUTHORING_MODULES_TABLE = 'modules'
        views.COHORT_AUTHORING_DETAILS_TABLE = 'cohorts'
        views.authoring_table_name = lambda table: 'curriculum.' + table
        views.update_authoring_rows = MagicMock()
        versioning = types.ModuleType(package_name + '.versioning')
        versioning.ACTOR_SYSTEM = 'system'
        versioning.audit_context = lambda **kw: nullcontext()
        read_model = types.ModuleType('learner_api.read_model')
        read_model.enqueue_learner_home_refresh = MagicMock()
        import learner_api
        for parent, key, value in ((package, 'views', views),
                                   (package, 'versioning', versioning),
                                   (learner_api, 'read_model', read_model)):
            self.enterContext(patch.object(parent, key, value, create=True))
        self.enterContext(patch.dict(sys.modules, {
            views.__name__: views, versioning.__name__: versioning,
            read_model.__name__: read_model,
        }))


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
    def fetched():
        sql = cursor.execute.call_args.args[0]
        if 'information_schema.columns' in sql:
            return [(name,) for name in ('programme_name', 'cohort_name', 'group_name', 'deleted_at')]
        return list(rows)
    cursor.fetchall.side_effect = fetched
    connection = MagicMock(vendor='postgresql', in_atomic_block=True, alias='default')
    connection.cursor.return_value.__enter__.return_value = cursor
    connection.introspection.get_table_description.return_value = [
        types.SimpleNamespace(name=name)
        for name in ('programme_name', 'cohort_name', 'group_name', 'deleted_at')
    ]
    return connection, cursor


def _statements(cursor):
    return [(' '.join(c.args[0].split()), c.args[1]) for c in cursor.execute.call_args_list
            if 'information_schema.columns' not in c.args[0]]


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

    def test_no_module_row_is_written_and_learners_are_found_by_group_id(self):
        # Modules hold the group id and read its name through it.
        statements, modules, _, refresh = self.rename()
        modules.assert_not_called()
        self.assertEqual(statements, [('SELECT enrolment_id, learner_type FROM "Learner".learners '
                                       'WHERE group_id = %s', ['GRP-1'])])
        self.assert_no_removed_columns(statements)
        self.assertCountEqual(refresh.call_args_list, _refreshes('group-rename'))

    def test_zero_matching_learners_queues_nothing(self):
        statements, modules, _, refresh = self.rename(rows=[])
        modules.assert_not_called()
        self.assertEqual(len(statements), 1)
        refresh.assert_not_called()

    def test_namesakes_and_a_missing_cohort_no_longer_change_the_lookup(self):
        for group in ({**self.GROUP, 'cohort_id': ''}, self.GROUP):
            with self.subTest(group=group):
                statements, _, _, _ = self.rename(group=group)
                self.assertFalse(any('curriculum.groups' in sql for sql, _ in statements))
                self.assertEqual(statements[0][1], ['GRP-1'])

    def test_an_unnamed_group_keeps_the_previous_no_refresh_rule(self):
        statements, modules, _, refresh = self.rename(group={**self.GROUP, 'group_name': ''})
        modules.assert_not_called()
        self.assertEqual(statements, [])
        refresh.assert_not_called()

    def test_an_unchanged_name_does_nothing(self):
        statements, modules, _, refresh = self.rename(name='G1 Monday')
        self.assertEqual(statements, [])
        modules.assert_not_called()
        refresh.assert_not_called()


class CohortRenameTests(RenameSqlGuard, SimpleTestCase):
    COHORT = {'cohort_id': 'COH-1', 'cohort_name': 'Oct 2026', 'programme_id': 'PROG-1',
              'programme_name': 'Programme'}

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

    def test_conflict_lock_then_read_only_lookup_then_refresh(self):
        statements, copies, _, refresh, error = self.rename()
        self.assertIsNone(error)
        (conflict_sql, conflict_params), (lookup_sql, lookup_params) = statements
        self.assertIn('FOR UPDATE', conflict_sql)                                      # lock kept
        self.assertIn('c.programme_id = %s', conflict_sql)                           # scoped by id
        self.assertEqual(conflict_params, ['PROG-1', 'Oct 2026', 'October 2026', 'COH-1'])
        self.assertEqual((lookup_sql, lookup_params), (
            'SELECT enrolment_id, learner_type FROM "Learner".learners WHERE cohort_id = %s', ['COH-1']))
        self.assert_no_removed_columns(statements)
        copies.assert_not_called()                     # groups/modules read the name by id
        self.assertCountEqual(refresh.call_args_list, _refreshes('cohort-rename'))

    def test_duplicate_name_raises_conflict_before_any_copy_or_refresh(self):
        statements, copies, _, refresh, error = self.rename(conflict=('OTHER-COHORT',))
        self.assertIsInstance(error, cohort_rename.CohortRenameConflict)               # view -> HTTP 409
        self.assertEqual(len(statements), 1)
        copies.assert_not_called()
        refresh.assert_not_called()

    def test_zero_matching_learners_queues_nothing(self):
        statements, copies, _, refresh, error = self.rename(rows=[])
        self.assertIsNone(error)
        self.assertEqual(len(statements), 2)
        copies.assert_not_called()
        refresh.assert_not_called()

    def test_unchanged_name_does_nothing_and_a_rename_requires_the_parent_transaction(self):
        statements, copies, _, refresh, error = self.rename(name='Oct 2026')
        self.assertEqual((statements, error), ([], None))
        copies.assert_not_called()
        statements, _, _, _, error = self.rename(atomic=False)
        self.assertIsInstance(error, RuntimeError)
        self.assertEqual(statements, [])

    def test_sqlite_checks_conflicts_without_learner_lookup(self):
        statements, copies, _, refresh, error = self.rename(vendor='sqlite')
        self.assertIsNone(error)
        self.assertEqual(len(statements), 1)
        self.assertNotIn('FOR UPDATE', statements[0][0])
        copies.assert_not_called()
        refresh.assert_not_called()


class PlacedLearnersTests(SimpleTestCase):
    def test_only_known_placement_columns_are_accepted(self):
        with self.assertRaises(ValueError):
            placement_rename.placed_learners('programme; DROP TABLE x', 'P')

    def test_the_callers_connection_is_used(self):
        connection, cursor = _connection(rows=[(1, 'commercial')])
        self.assertEqual(placement_rename.placed_learners('group_id', 'G', connection), {(1, 'commercial')})
        cursor.execute.assert_called_once()


class ConnectionCompatibilityTests(SimpleTestCase):
    def test_two_arguments_use_default_connection(self):
        db, cursor = _connection(rows=[(7, 'commercial')])
        with patch.object(placement_rename, 'connection', db):
            self.assertEqual(placement_rename.placed_learners('group_id', 'G'), {(7, 'commercial')})
        cursor.execute.assert_called_once()

    def test_keyword_connection_never_uses_default(self):
        db, cursor = _connection(rows=[(8, 'commercial')])
        with patch.object(placement_rename, 'connection', MagicMock()) as default:
            self.assertEqual(placement_rename.placed_learners('cohort_id', 'C', connection=db),
                             {(8, 'commercial')})
        default.cursor.assert_not_called()
        cursor.execute.assert_called_once()

    def test_conflicting_connections_are_rejected(self):
        with self.assertRaises(ValueError):
            placement_rename.placed_learners('group_id', 'G', object(), connection=object())

    def test_refresh_uses_the_transaction_alias(self):
        db, _ = _connection()
        db.alias = 'rename_test'
        with patch.object(placement_rename, 'connection', db), \
                patch('learner_api.read_model.enqueue_learner_home_refresh') as refresh:
            placement_rename.propagate_programme_name_to_learners('P', 'Old', 'New')
        self.assertEqual(refresh.call_count, 2)
        self.assertTrue(all(c.kwargs['using'] == 'rename_test' for c in refresh.call_args_list))


class MemoryCursor:
    """Execute real SQLite transactions; adapt only PG metadata/placeholder syntax.

    FOR UPDATE is checked by the SQL tests above, not simulated as a SQLite lock.
    This does not test PostgreSQL isolation or the real Django endpoint/outbox.
    """
    def __init__(self, db):
        self.db = db
        self.cursor = db.raw.cursor()
        self.metadata = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.cursor.close()

    def execute(self, sql, params=()):
        if 'information_schema.columns' in sql:
            self.metadata = [(row[1],) for row in self.db.raw.execute(
                'PRAGMA curriculum.table_info(' + params[1] + ')')]
        else:
            self.metadata = None
            self.cursor.execute(sql.replace('%s', '?').replace('FOR UPDATE', ''), params)

    def fetchall(self):
        return self.metadata if self.metadata is not None else self.cursor.fetchall()

    def fetchone(self):
        return self.cursor.fetchone()


class RenameTransactionTests(SimpleTestCase):
    def setUp(self):
        super().setUp()
        import sqlite3
        from . import views
        from learner_api import read_model
        self.raw = sqlite3.connect(':memory:')
        self.addCleanup(self.raw.close)
        self.raw.create_function('btrim', 1, lambda value: value.strip())
        self.raw.executescript("""
            ATTACH DATABASE ':memory:' AS curriculum;
            ATTACH DATABASE ':memory:' AS Learner;
            ATTACH DATABASE ':memory:' AS enrolment;
            CREATE TABLE curriculum.cohorts
                (cohort_id TEXT PRIMARY KEY, cohort_name TEXT, programme_id TEXT, status TEXT);
            CREATE TABLE curriculum.groups
                (group_id TEXT PRIMARY KEY, group_name TEXT, cohort_id TEXT);
            CREATE TABLE curriculum.modules (module_id TEXT, cohort_id TEXT, group_id TEXT);
            CREATE TABLE Learner.learners
                (enrolment_id INTEGER, learner_type TEXT, programme_id TEXT, cohort_id TEXT, group_id TEXT);
            CREATE TABLE enrolment.Created_users (id INTEGER, cohort_id TEXT, group_id TEXT);
            CREATE TABLE refresh_events (learner_id INTEGER, kind TEXT, reason TEXT);
            INSERT INTO curriculum.cohorts VALUES ('C', 'Old cohort', 'P', 'active'),
                ('OTHER', 'Other cohort', 'P', 'active');
            INSERT INTO curriculum.groups VALUES ('G', 'Old group', 'C'), ('G2', 'Other group', 'OTHER');
            INSERT INTO curriculum.modules VALUES ('M', 'C', 'G'), ('M2', 'OTHER', 'G2');
            INSERT INTO Learner.learners VALUES (1, 'commercial', 'P', 'C', 'G'),
                (2, 'apprenticeship', 'P', 'OTHER', 'G2');
            INSERT INTO enrolment.Created_users VALUES (1, 'C', 'G'), (2, 'OTHER', 'G2');
        """)
        self.db = types.SimpleNamespace(raw=self.raw, vendor='postgresql', alias='rename_test',
                                        in_atomic_block=True)
        self.db.cursor = lambda: MemoryCursor(self.db)
        self.enterContext(patch.object(cohort_rename, 'connection', self.db))
        self.enterContext(patch.object(placement_rename, 'connection', self.db))
        self.views = views
        views.update_authoring_rows.side_effect = self.update_copies
        read_model.enqueue_learner_home_refresh.side_effect = self.refresh
        self.cohort = dict(cohort_id='C', cohort_name='Old cohort', programme_id='P')
        self.group = dict(group_id='G', group_name='Old group')

    def update_copies(self, table, where, params, payload):
        assignments = ', '.join(column + ' = ?' for column in payload)
        self.raw.execute('UPDATE curriculum.' + table + ' SET ' + assignments +
                         ' WHERE ' + where.replace('%s', '?'), [*payload.values(), *params])

    def refresh(self, kind, learner_id, *, reason, using):
        self.assertEqual(using, self.db.alias)
        self.raw.execute('INSERT INTO refresh_events VALUES (?, ?, ?)', [learner_id, kind, reason])

    def placements(self):
        return (self.raw.execute('SELECT * FROM Learner.learners').fetchall(),
                self.raw.execute('SELECT * FROM enrolment.Created_users').fetchall())

    def displayed(self):
        return self.raw.execute("""SELECT l.enrolment_id, c.cohort_name, g.group_name
            FROM Learner.learners l JOIN curriculum.cohorts c ON c.cohort_id=l.cohort_id
            JOIN curriculum.groups g ON g.group_id=l.group_id ORDER BY l.enrolment_id""").fetchall()

    def rename(self, kind):
        if kind == 'cohort':
            cohort_rename.propagate_cohort_name(self.cohort, 'New cohort')
            self.raw.execute("UPDATE curriculum.cohorts SET cohort_name='New cohort' WHERE cohort_id='C'")
        else:
            self.raw.execute("UPDATE curriculum.groups SET group_name='New group' WHERE group_id='G'")
            placement_rename.propagate_group_name_to_learners(self.group, 'New group')

    def test_canonical_renames_change_display_without_touching_placements(self):
        before = self.placements()
        with self.raw:
            self.rename('cohort')
            self.rename('group')
        self.assertEqual(self.placements(), before)
        self.assertEqual(self.displayed(), [(1, 'New cohort', 'New group'),
                                            (2, 'Other cohort', 'Other group')])
        self.views.update_authoring_rows.assert_not_called()
        self.assertEqual(self.raw.execute('SELECT learner_id, reason FROM refresh_events').fetchall(),
                         [(1, 'cohort-rename'), (1, 'group-rename')])

    def test_failure_rolls_back_parent_and_refresh_requests(self):
        before = self.placements(), self.displayed()
        for kind in ('cohort', 'group'):
            with self.subTest(kind=kind):
                with self.assertRaisesRegex(RuntimeError, 'after refresh'), self.raw:
                    self.rename(kind)
                    raise RuntimeError('after refresh')
                self.assertEqual((self.placements(), self.displayed()), before)
                self.assertEqual(self.raw.execute('SELECT * FROM refresh_events').fetchall(), [])

    def test_duplicate_in_same_programme_blocks_rename(self):
        self.raw.execute("UPDATE curriculum.cohorts SET cohort_name='New cohort' WHERE cohort_id='OTHER'")
        self.raw.commit()
        with self.assertRaises(cohort_rename.CohortRenameConflict), self.raw:
            self.rename('cohort')
        self.assertEqual(self.raw.execute('SELECT * FROM refresh_events').fetchall(), [])

    def test_namesake_in_another_programme_does_not_block_rename(self):
        self.raw.execute("UPDATE curriculum.cohorts SET cohort_name='New cohort', programme_id='P2' WHERE cohort_id='OTHER'")
        self.raw.commit()
        with self.raw:
            self.rename('cohort')
        self.assertEqual(self.displayed()[0][1], 'New cohort')
