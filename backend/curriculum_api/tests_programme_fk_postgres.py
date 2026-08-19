"""PostgreSQL integration tests for migration 0038's programme foreign keys.

Why these exist
---------------
The Curriculum suite runs on SQLite, where migration 0038 short-circuits on
``connection.vendor != 'postgresql'``. That means the FK behaviour the migration
exists to provide was never actually exercised. These tests run the real DDL
against a real PostgreSQL server and assert the semantics we are relying on.

Running them
------------
They are skipped unless a PostgreSQL URL is supplied:

    FK_TEST_DATABASE_URL=postgresql://user:pass@host:5432/dbname \\
        python manage.py test curriculum_api.tests_programme_fk_postgres

Everything happens inside a dedicated throwaway schema (``fk_it_<pid>``) that is
dropped in tearDown, and every test body runs in a transaction that is rolled
back. Never point this at production: the suite creates and drops its own schema.
"""
from __future__ import annotations

import os
import unittest

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None

FK_TEST_DATABASE_URL = os.environ.get('FK_TEST_DATABASE_URL', '').strip()

# Mirrors the constants in migrations/0038_programme_foreign_keys.py.
ON_DELETE = 'restrict'
ON_UPDATE = 'restrict'

# PostgreSQL reports the two directions with different SQLSTATEs, and psycopg
# maps them to sibling classes (both under IntegrityError, neither a subclass of
# the other):
#   * child-side bad reference (INSERT/UPDATE on the child)  -> ForeignKeyViolation (23503)
#   * parent-side RESTRICT     (DELETE/UPDATE on the parent) -> RestrictViolation (23001)
# Asserting the precise class keeps the two failure modes honest rather than
# collapsing them into one loose check.


@unittest.skipUnless(FK_TEST_DATABASE_URL, 'FK_TEST_DATABASE_URL is not set')
@unittest.skipUnless(psycopg is not None, 'psycopg is not installed')
class ProgrammeForeignKeyPostgresTests(unittest.TestCase):
    """Exercise the real ON DELETE/ON UPDATE RESTRICT + NOT VALID semantics."""

    schema = f'fk_it_{os.getpid()}'

    def setUp(self):
        self.conn = psycopg.connect(FK_TEST_DATABASE_URL, autocommit=True)
        self.addCleanup(self.conn.close)
        with self.conn.cursor() as cur:
            cur.execute(f'drop schema if exists {self.schema} cascade')
            cur.execute(f'create schema {self.schema}')
            cur.execute(f'''
                create table {self.schema}.programmes (
                    programme_id varchar(150) primary key,
                    name varchar(255) not null default ''
                )
            ''')
            cur.execute(f'''
                create table {self.schema}.children (
                    child_id varchar(128) primary key,
                    programme_id varchar(255)
                )
            ''')
        self.addCleanup(self._drop_schema)

    def _drop_schema(self):
        try:
            with self.conn.cursor() as cur:
                cur.execute(f'drop schema if exists {self.schema} cascade')
        except Exception:  # pragma: no cover - cleanup best effort
            pass

    # -- helpers ---------------------------------------------------------

    def _add_fk(self, *, valid=False):
        clause = '' if valid else 'not valid'
        with self.conn.cursor() as cur:
            cur.execute(f'''
                alter table {self.schema}.children
                add constraint children_programme_id_fkey
                foreign key (programme_id)
                references {self.schema}.programmes (programme_id)
                on delete {ON_DELETE}
                on update {ON_UPDATE}
                {clause}
            ''')

    def _insert_programme(self, programme_id, name=''):
        with self.conn.cursor() as cur:
            cur.execute(
                f'insert into {self.schema}.programmes (programme_id, name) values (%s, %s)',
                [programme_id, name],
            )

    def _insert_child(self, child_id, programme_id):
        with self.conn.cursor() as cur:
            cur.execute(
                f'insert into {self.schema}.children (child_id, programme_id) values (%s, %s)',
                [child_id, programme_id],
            )

    def _child_programme_id(self, child_id):
        with self.conn.cursor() as cur:
            cur.execute(
                f'select programme_id from {self.schema}.children where child_id = %s',
                [child_id],
            )
            row = cur.fetchone()
            return row[0] if row else None

    def _constraint_meta(self):
        with self.conn.cursor() as cur:
            cur.execute('''
                select con.convalidated, con.confdeltype, con.confupdtype
                from pg_constraint con
                join pg_class rel on rel.oid = con.conrelid
                join pg_namespace ns on ns.oid = rel.relnamespace
                where ns.nspname = %s and rel.relname = 'children'
                  and con.conname = 'children_programme_id_fkey'
            ''', [self.schema])
            return cur.fetchone()

    # -- Case A ----------------------------------------------------------

    def test_a_not_valid_accepts_existing_orphans_and_leaves_them_untouched(self):
        """NOT VALID ignores pre-existing bad rows and does not rewrite them."""
        self._insert_programme('P1')
        self._insert_child('C-ORPHAN', 'P-MISSING')

        self._add_fk(valid=False)  # must not raise

        self.assertEqual(self._child_programme_id('C-ORPHAN'), 'P-MISSING')
        validated, _, _ = self._constraint_meta()
        self.assertFalse(validated, 'constraint should be recorded as NOT VALID')

    # -- Case B ----------------------------------------------------------

    def test_b_future_orphan_insert_is_rejected(self):
        """A NOT VALID FK still enforces every future INSERT."""
        self._insert_programme('P1')
        self._insert_child('C-ORPHAN', 'P-MISSING')
        self._add_fk(valid=False)

        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            self._insert_child('C-NEW', 'P-MISSING-NEW')

    def test_b2_future_orphan_update_is_rejected(self):
        """A NOT VALID FK also enforces UPDATEs of the FK column."""
        self._insert_programme('P1')
        self._insert_child('C-OK', 'P1')
        self._add_fk(valid=False)

        with self.conn.cursor() as cur:
            with self.assertRaises(psycopg.errors.ForeignKeyViolation):
                cur.execute(
                    f"update {self.schema}.children set programme_id = 'P-NOPE' "
                    'where child_id = %s', ['C-OK'],
                )

    # -- Case C ----------------------------------------------------------

    def test_c_parent_delete_with_children_is_restricted(self):
        """ON DELETE RESTRICT blocks removing a referenced programme..."""
        self._insert_programme('P2')
        self._insert_child('C1', 'P2')
        self._add_fk(valid=False)

        with self.conn.cursor() as cur:
            with self.assertRaises(psycopg.errors.RestrictViolation):
                cur.execute(
                    f'delete from {self.schema}.programmes where programme_id = %s', ['P2']
                )

        self.assertEqual(self._child_programme_id('C1'), 'P2')

    def test_c2_parent_delete_without_children_still_allowed(self):
        """...but an unreferenced programme remains deletable."""
        self._insert_programme('P-LONELY')
        self._add_fk(valid=False)

        with self.conn.cursor() as cur:
            cur.execute(
                f'delete from {self.schema}.programmes where programme_id = %s', ['P-LONELY']
            )
            cur.execute(
                f'select count(*) from {self.schema}.programmes where programme_id = %s',
                ['P-LONELY'],
            )
            self.assertEqual(cur.fetchone()[0], 0)

    def test_c3_parent_delete_blocked_even_by_a_pre_existing_orphan_sibling(self):
        """RESTRICT applies to rows that existed before the constraint, too."""
        self._insert_programme('P3')
        self._insert_child('C-OLD', 'P3')   # inserted before the FK exists
        self._add_fk(valid=False)

        with self.conn.cursor() as cur:
            with self.assertRaises(psycopg.errors.RestrictViolation):
                cur.execute(
                    f'delete from {self.schema}.programmes where programme_id = %s', ['P3']
                )

    # -- Case D ----------------------------------------------------------

    def test_d_parent_id_update_is_restricted_and_child_not_rewritten(self):
        """ON UPDATE RESTRICT: re-keying a parent fails, child keeps its value.

        This is the behaviour that distinguishes the hardened migration from the
        original ON UPDATE CASCADE design, which would have silently rewritten
        every child row.
        """
        self._insert_programme('P3')
        self._insert_child('C1', 'P3')
        self._add_fk(valid=False)

        with self.conn.cursor() as cur:
            with self.assertRaises(psycopg.errors.RestrictViolation):
                cur.execute(
                    f"update {self.schema}.programmes set programme_id = 'P3-NEW' "
                    'where programme_id = %s', ['P3'],
                )

        self.assertEqual(
            self._child_programme_id('C1'), 'P3',
            'child programme_id must NOT be automatically rewritten',
        )

    def test_d2_delete_and_update_actions_are_restrict_in_catalog(self):
        """pg_constraint records 'r' (RESTRICT) for both actions."""
        self._add_fk(valid=False)
        _, confdeltype, confupdtype = self._constraint_meta()
        self.assertEqual(confdeltype, 'r', 'ON DELETE should be RESTRICT')
        self.assertEqual(confupdtype, 'r', 'ON UPDATE should be RESTRICT')

    # -- Case E ----------------------------------------------------------

    def test_e_valid_writes_still_work(self):
        """Ordinary valid parent/child writes are unaffected."""
        self._insert_programme('P-GOOD', 'Good Programme')
        self._add_fk(valid=False)

        self._insert_child('C-GOOD', 'P-GOOD')
        self.assertEqual(self._child_programme_id('C-GOOD'), 'P-GOOD')

        # NULL is permitted by a foreign key (unknown reference, not a bad one).
        self._insert_child('C-NULL', None)
        self.assertIsNone(self._child_programme_id('C-NULL'))

        # Re-pointing a child at another real programme is fine.
        self._insert_programme('P-GOOD-2')
        with self.conn.cursor() as cur:
            cur.execute(
                f'update {self.schema}.children set programme_id = %s where child_id = %s',
                ['P-GOOD-2', 'C-GOOD'],
            )
        self.assertEqual(self._child_programme_id('C-GOOD'), 'P-GOOD-2')

    def test_e2_empty_string_is_rejected_because_it_is_not_null(self):
        """'' is a real value with no parent, so the FK rejects it.

        This is why the empty-string rows in groups/week_templates keep their
        constraint NOT VALID rather than being converted to NULL.
        """
        self._add_fk(valid=False)
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            self._insert_child('C-EMPTY', '')

    # -- Case F ----------------------------------------------------------

    def test_f_validate_succeeds_on_clean_table(self):
        """A clean table can be promoted from NOT VALID to validated."""
        self._insert_programme('P1')
        self._insert_child('C1', 'P1')
        self._add_fk(valid=False)

        self.assertFalse(self._constraint_meta()[0])
        with self.conn.cursor() as cur:
            cur.execute(
                f'alter table {self.schema}.children '
                'validate constraint children_programme_id_fkey'
            )
        self.assertTrue(self._constraint_meta()[0], 'constraint should now be validated')

    def test_f2_validate_fails_on_dirty_table(self):
        """A dirty table cannot be validated — which is why 0038 must not try.

        The migration decides from measured counts instead of attempting this
        and catching the error, because a failed VALIDATE aborts the surrounding
        transaction and would take the whole migration down with it.
        """
        self._insert_programme('P1')
        self._insert_child('C-ORPHAN', 'P-MISSING')
        self._add_fk(valid=False)

        with self.conn.cursor() as cur:
            with self.assertRaises(psycopg.errors.ForeignKeyViolation):
                cur.execute(
                    f'alter table {self.schema}.children '
                    'validate constraint children_programme_id_fkey'
                )

        self.assertEqual(self._child_programme_id('C-ORPHAN'), 'P-MISSING')
        self.assertFalse(self._constraint_meta()[0], 'still NOT VALID after failed validate')
