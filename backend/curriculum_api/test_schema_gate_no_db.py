"""The schema gate asks the database once, not once per table.

No database: ``schema_gate.connection`` is replaced by a stub that records every
statement and answers from a dictionary of schema -> table names. That is enough
to pin the two things that matter about this module -- what it concludes, and how
many round trips it spends concluding it.

The regression it guards: ``require_tables`` used to probe
``information_schema.tables`` one table at a time. A cold Curriculum overview
build spent 12 of those probes, ~0.3s each against a remote database, before any
real query ran. Behaviour must not change -- same missing-table report, same
refusal to cache a negative, same silence when the database itself is
unreachable -- only the number of statements.
"""
import unittest
from unittest import mock

from curriculum_api import schema_gate


class StubCursor:
    def __init__(self, connection):
        self._connection = connection
        self._rows = []

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def execute(self, sql, params=None):
        self._connection.statements.append((' '.join(sql.split()), list(params or [])))
        if self._connection.error:
            raise self._connection.error
        self._rows = self._connection.answer(sql, list(params or []))

    def fetchall(self):
        return [(name,) for name in self._rows]


class StubConnection:
    """Answers table-existence questions out of ``tables_by_schema``."""

    def __init__(self, vendor='postgresql', tables_by_schema=None, error=None):
        self.vendor = vendor
        self.tables_by_schema = tables_by_schema or {}
        self.error = error
        self.statements = []

    def cursor(self):
        return StubCursor(self)

    def answer(self, sql, params):
        if self.vendor == 'postgresql':
            schema = params[0]
            known = self.tables_by_schema.get(schema, set())
            wanted = params[1:]
        else:
            known = self.tables_by_schema.get(None, set())
            wanted = params
        # No names in the statement means the whole-schema listing.
        return sorted(known) if not wanted else sorted(set(wanted) & known)

    @property
    def queries(self):
        return len(self.statements)


CURRICULUM_TABLES = {
    'programmes', 'cohorts', 'groups', 'modules', 'weeks', 'components',
    'free_courses', 'free_course_weeks', 'free_programme_components',
    'live_sessions', 'week_templates',
}


class SchemaGateTests(unittest.TestCase):
    def setUp(self):
        schema_gate.reset_verification_cache()
        self.addCleanup(schema_gate.reset_verification_cache)

    def gate(self, **kwargs):
        kwargs.setdefault('tables_by_schema', {schema_gate.CURRICULUM_SCHEMA: set(CURRICULUM_TABLES)})
        connection = StubConnection(**kwargs)
        patcher = mock.patch.object(schema_gate, 'connection', connection)
        patcher.start()
        self.addCleanup(patcher.stop)
        return connection

    # -- all required tables exist -----------------------------------------
    def test_every_required_table_present_costs_one_statement(self):
        connection = self.gate()
        schema_gate.require_tables('programmes', 'cohorts', 'groups', 'modules', 'weeks')
        self.assertEqual(connection.queries, 1)

    def test_separate_calls_after_the_first_cost_nothing(self):
        connection = self.gate()
        schema_gate.require_tables('programmes')
        first = connection.queries
        schema_gate.require_tables('cohorts')
        schema_gate.require_tables('groups', 'modules')
        schema_gate.require_tables('free_courses', 'free_course_weeks')
        self.assertEqual(first, 1)
        self.assertEqual(connection.queries, 1)

    def test_duplicate_names_in_one_call_are_asked_about_once(self):
        connection = self.gate(tables_by_schema={schema_gate.CURRICULUM_SCHEMA: set()})
        with self.assertRaises(schema_gate.SchemaNotProvisioned):
            schema_gate.require_tables('weeks', 'weeks', 'weeks')
        names = [statement for statement in connection.statements if 'in (' in statement[0]]
        self.assertEqual(len(names), 1)
        self.assertEqual(names[0][1].count('weeks'), 1)

    # -- one required table missing ----------------------------------------
    def test_missing_required_table_is_named_with_its_migration(self):
        self.gate(tables_by_schema={
            schema_gate.CURRICULUM_SCHEMA: CURRICULUM_TABLES - {'groups'},
        })
        with self.assertRaises(schema_gate.SchemaNotProvisioned) as caught:
            schema_gate.require_tables('programmes', 'groups', 'modules')
        self.assertEqual(caught.exception.missing, ['groups'])
        message = str(caught.exception)
        self.assertIn('curriculum.groups', message)
        self.assertIn('curriculum_api.0005_create_groups_table', message)
        self.assertNotIn('curriculum.programmes', message)

    def test_several_missing_tables_are_all_reported(self):
        self.gate(tables_by_schema={schema_gate.CURRICULUM_SCHEMA: {'programmes'}})
        with self.assertRaises(schema_gate.SchemaNotProvisioned) as caught:
            schema_gate.require_tables('programmes', 'cohorts', 'weeks')
        self.assertEqual(sorted(caught.exception.missing), ['cohorts', 'weeks'])

    def test_present_tables_are_still_remembered_when_a_sibling_is_missing(self):
        connection = self.gate(tables_by_schema={schema_gate.CURRICULUM_SCHEMA: {'programmes'}})
        with self.assertRaises(schema_gate.SchemaNotProvisioned):
            schema_gate.require_tables('programmes', 'cohorts')
        before = connection.queries
        schema_gate.require_tables('programmes')
        self.assertEqual(connection.queries, before)

    # -- a table provisioned outside the migration graph --------------------
    def test_table_outside_the_migration_map_gets_the_sql_file_hint(self):
        self.gate(tables_by_schema={schema_gate.CURRICULUM_SCHEMA: set()})
        with self.assertRaises(schema_gate.SchemaNotProvisioned) as caught:
            schema_gate.require_tables('week_templates')
        self.assertIn('sql/001_week_templates.sql', str(caught.exception))

    def test_a_table_the_caller_treats_as_optional_is_simply_absent(self):
        # Optionality lives in the callers: they ask table_exists() rather than
        # require_tables(), and a False there is an answer, not an error.
        self.gate(tables_by_schema={schema_gate.CURRICULUM_SCHEMA: CURRICULUM_TABLES})
        self.assertTrue(schema_gate.table_exists('live_sessions'))
        self.assertFalse(schema_gate.table_exists('review_types'))

    # -- schema scoping ------------------------------------------------------
    def test_a_table_of_the_same_name_in_another_schema_does_not_count(self):
        self.gate(tables_by_schema={
            schema_gate.CURRICULUM_SCHEMA: set(),
            'Learner': {'modules'},
            'public': {'modules'},
        })
        with self.assertRaises(schema_gate.SchemaNotProvisioned) as caught:
            schema_gate.require_tables('modules')
        self.assertEqual(caught.exception.missing, ['modules'])

    def test_every_statement_is_scoped_to_the_curriculum_schema(self):
        connection = self.gate()
        schema_gate.require_tables('programmes')
        for sql, params in connection.statements:
            self.assertIn('table_schema = %s', sql)
            self.assertEqual(params[0], schema_gate.CURRICULUM_SCHEMA)

    # -- sqlite (the test runner) -------------------------------------------
    def test_sqlite_reads_sqlite_master_and_still_batches(self):
        connection = self.gate(
            vendor='sqlite',
            tables_by_schema={None: {'programmes', 'cohorts'}},
        )
        schema_gate.require_tables('programmes', 'cohorts')
        self.assertEqual(connection.queries, 1)
        self.assertIn('sqlite_master', connection.statements[0][0])

    def test_sqlite_reports_a_missing_table(self):
        self.gate(vendor='sqlite', tables_by_schema={None: {'programmes'}})
        with self.assertRaises(schema_gate.SchemaNotProvisioned) as caught:
            schema_gate.require_tables('programmes', 'cohorts')
        self.assertEqual(caught.exception.missing, ['cohorts'])

    # -- caching behaviour ---------------------------------------------------
    def test_a_missing_table_is_asked_about_again_next_time(self):
        connection = self.gate(tables_by_schema={schema_gate.CURRICULUM_SCHEMA: set()})
        with self.assertRaises(schema_gate.SchemaNotProvisioned):
            schema_gate.require_tables('cohorts')
        first = connection.queries
        # Provisioned since. Nothing may have pinned it to "missing".
        connection.tables_by_schema[schema_gate.CURRICULUM_SCHEMA] = {'cohorts'}
        schema_gate.require_tables('cohorts')
        self.assertGreater(connection.queries, first)

    def test_reset_clears_what_was_verified(self):
        connection = self.gate()
        schema_gate.require_tables('programmes')
        schema_gate.reset_verification_cache()
        before = connection.queries
        schema_gate.require_tables('programmes')
        self.assertGreater(connection.queries, before)

    def test_the_schema_listing_is_taken_once_per_process(self):
        connection = self.gate()
        schema_gate.require_tables('programmes')
        schema_gate.reset_verification_cache()
        schema_gate.require_tables('programmes')
        listings = [sql for sql, _ in connection.statements if 'in (' not in sql]
        self.assertEqual(len(listings), 2)

    # -- database errors -----------------------------------------------------
    def test_an_unreachable_database_is_not_reported_as_a_schema_problem(self):
        self.gate(error=RuntimeError('connection refused'))
        # No exception: the caller's own query surfaces the real failure.
        schema_gate.require_tables('programmes', 'cohorts')

    def test_an_error_verifies_nothing(self):
        connection = self.gate(error=RuntimeError('connection refused'))
        schema_gate.require_tables('programmes')
        connection.error = None
        connection.tables_by_schema = {schema_gate.CURRICULUM_SCHEMA: set()}
        with self.assertRaises(schema_gate.SchemaNotProvisioned):
            schema_gate.require_tables('programmes')

    def test_table_exists_lets_the_error_through_to_its_caller(self):
        self.gate(error=RuntimeError('connection refused'))
        # views.table_exists owns the decision about what an unanswerable probe
        # means (it returns False and logs); the gate must not decide for it.
        with self.assertRaises(RuntimeError):
            schema_gate.table_exists('programmes')


if __name__ == '__main__':
    unittest.main()
