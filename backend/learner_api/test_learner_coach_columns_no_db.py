"""Learner coach on the legacy (copied columns) and canonical (coach_id) schemas.

No network and no Django database: the scoping tests compile the production
ORM queries and raw SQL as usual, then execute them on a private in-memory
sqlite3 connection holding synthetic "Learner"/curriculum/enrolment tables.
The schema probe is patched to choose the legacy or canonical SQL.
"""
import sqlite3
import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db.models.sql.compiler import SQLCompiler
from django.db.models.sql.constants import MULTI, NO_RESULTS, SINGLE
from django.test import SimpleTestCase

from old_otjh import repository
from . import learner_coach_columns as coach

COACH_A, COACH_B, COACH_C = 'a@example.test', 'b@example.test', 'c@example.test'
SCHEMAS = ('Learner', 'curriculum', 'enrolment')


def postgres(answer):
    cursor = MagicMock()
    cursor.fetchone.return_value = (answer,)
    connection = MagicMock(vendor='postgresql')
    connection.cursor.return_value.__enter__.return_value = cursor
    return {'enrolment': connection}


class SchemaProbeTests(SimpleTestCase):
    def setUp(self):
        coach._keyed_cache.clear()
        self.addCleanup(coach._keyed_cache.clear)

    def test_legacy_schema_keeps_the_copied_columns(self):
        with patch.object(coach, 'connections', postgres(False)):
            self.assertEqual(coach.owner_coach_sql('l', 'enrolment'), 'l.coach_name,l.coach_email')
            self.assertEqual(coach.learner_coach_sql('l', 'email', 'enrolment'), 'l.coach_email')

    def test_canonical_schema_reads_the_coach_through_coach_id(self):
        with patch.object(coach, 'connections', postgres(True)):
            sql = coach.owner_coach_sql('l', 'enrolment')
        self.assertNotIn('l.coach_name', sql)
        self.assertNotIn('l.coach_email', sql)
        self.assertIn('FROM curriculum.coaches learner_coach WHERE learner_coach.id=l.coach_id) AS coach_name', sql)
        self.assertIn('SELECT learner_coach.email FROM', sql)

    def test_canonical_answer_is_cached_per_database(self):
        connections_ = postgres(True)
        with patch.object(coach, 'connections', connections_):
            coach.learner_coach_keyed('enrolment')
            coach.learner_coach_keyed('enrolment')
        self.assertEqual(connections_['enrolment'].cursor.call_count, 1)

    def test_failed_probe_is_not_cached(self):
        from django.db import DatabaseError
        connection = MagicMock(vendor='postgresql')
        connection.cursor.side_effect = DatabaseError('offline')
        with patch.object(coach, 'connections', {'enrolment': connection}):
            self.assertFalse(coach.learner_coach_keyed('enrolment'))
        self.assertNotIn('enrolment', coach._keyed_cache)

    def test_non_postgres_database_uses_the_copied_columns_without_a_query(self):
        connection = MagicMock(vendor='sqlite')
        with patch.object(coach, 'connections', {'default': connection}):
            self.assertEqual(coach.owner_coach_sql('l', 'default'), 'l.coach_name,l.coach_email')
        connection.cursor.assert_not_called()

    def test_unknown_attribute_is_rejected(self):
        with self.assertRaises(ValueError):
            coach.learner_coach_sql('l', 'rag', 'default')

    def test_model_fields_keep_their_plain_migration_state(self):
        from .models import LearnerProfile
        for name, path in (('coach_name', 'django.db.models.TextField'),
                           ('coach_email', 'django.db.models.EmailField')):
            self.assertEqual(LearnerProfile._meta.get_field(name).deconstruct()[1], path)

    def test_monthly_log_queries_use_the_canonical_coach_expression(self):
        from . import monthly_log_sources

        with patch.object(coach, 'learner_coach_keyed', return_value=True), \
             patch.object(monthly_log_sources, 'query', return_value=[]) as read:
            monthly_log_sources.profile(125)
            profile_sql = read.call_args.args[0]
            monthly_log_sources.learners('coach@example.test', '')
            learners_sql = read.call_args.args[0]
        for sql in (profile_sql, learners_sql):
            self.assertIn('curriculum.coaches', sql)
            self.assertNotIn('learner.coach_name', sql)
            self.assertNotIn('learner.coach_email', sql)
            self.assertNotIn('p.coach_email', sql)

    def test_curriculum_activity_enrichment_uses_the_shared_coach_reader(self):
        from curriculum_api import learner_activity_status

        source = inspect.getsource(learner_activity_status.enrich)
        self.assertIn("owner_coach_sql('learner')", source)
        self.assertNotIn('learner.coach_email', source)


class _ScopingBase:
    """Learners 10 -> coach A, 11 -> coach B, 12 unassigned, 13 dangling coach id."""
    keyed = None

    @classmethod
    def learner_columns(cls):
        raise NotImplementedError

    def setUp(self):
        self.db = raw = sqlite3.connect(':memory:')
        self.addCleanup(raw.close)
        raw.create_function('btrim', 1, lambda value: value.strip() if value is not None else None)
        for schema in SCHEMAS:
            raw.execute(f"ATTACH DATABASE ':memory:' AS \"{schema}\"")
        raw.executescript(f'''
                CREATE TABLE curriculum.coaches (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
                CREATE TABLE curriculum.programmes (programme_id TEXT PRIMARY KEY, name TEXT);
                CREATE TABLE enrolment."Created_users" (id INTEGER PRIMARY KEY, "Email" TEXT);
                CREATE TABLE enrolment."Staff_users" (id INTEGER PRIMARY KEY, "Email" TEXT,
                    "Access" TEXT, "Access_extra" TEXT);
                CREATE TABLE "Learner".learners (id INTEGER PRIMARY KEY, enrolment_id INTEGER,
                    email TEXT, full_name TEXT, learner_type TEXT, programme_id TEXT,
                    lifecycle_status TEXT, {self.learner_columns()});
                INSERT INTO curriculum.coaches VALUES (1,'Coach A',' A@Example.test '),(2,'Coach B','{COACH_B}');
                INSERT INTO curriculum.programmes VALUES ('P1','Programme One');
                INSERT INTO enrolment."Created_users" VALUES
                    (10,'l10@example.test'),(11,'l11@example.test'),(12,'l12@example.test'),(13,'l13@example.test');
                INSERT INTO enrolment."Staff_users" VALUES
                    (1,'{COACH_A}','coach',NULL),(2,'{COACH_B}','coach',NULL),(3,'{COACH_C}','coach',NULL),
                    (4,'','coach',NULL);
            ''')
        raw.executescript(self.learner_rows())

        def execute_sql(compiler, result_type=MULTI, chunked_fetch=False, chunk_size=100):
            sql, params = compiler.as_sql()
            rows = raw.execute(sql.replace('%s', '?'), params).fetchall()
            if result_type == SINGLE:
                return rows[0] if rows else None
            return None if result_type == NO_RESULTS else iter([rows])

        def query_rows(alias, sql, params):
            cursor = raw.execute(sql.replace('%s', '?'), list(params))
            names = [column[0] for column in cursor.description]
            return [dict(zip(names, row)) for row in cursor.fetchall()]

        for patcher in (patch.object(coach, 'learner_coach_keyed', return_value=self.keyed),
                        patch.object(SQLCompiler, 'execute_sql', execute_sql),
                        patch.object(repository, '_query_rows', side_effect=query_rows)):
            patcher.start()
            self.addCleanup(patcher.stop)

    # -- production readers ------------------------------------------------
    def owns(self, staff_id, enrolment_id):
        from login.permissions import coach_owns_learner
        account = SimpleNamespace(role='staff', subject_type='staff', subject_id=staff_id)
        return coach_owns_learner(account, enrolment_id)

    def mobile_caseload(self, email):
        from learner_api import mobile_coach
        with patch.object(mobile_coach, 'authenticated_coach_email', return_value=email):
            return sorted(mobile_coach._caseload(object()).values_list('enrolment_id', flat=True))

    def extra_caseload(self, email):
        from coach_api import extra_activities
        return extra_activities.caseload(email)

    # -- behaviour -----------------------------------------------------------
    def test_coach_permission_allows_only_their_own_learner(self):
        self.assertTrue(self.owns(1, 10))
        self.assertFalse(self.owns(1, 11))   # another coach's learner
        self.assertFalse(self.owns(2, 10))
        self.assertTrue(self.owns(2, 11))

    def test_unassigned_and_unknown_coach_learners_are_denied_to_everyone(self):
        for staff_id in (1, 2, 3, 4):
            self.assertFalse(self.owns(staff_id, 12))
            self.assertFalse(self.owns(staff_id, 13))

    def test_caseload_queryset_is_scoped_and_never_matches_an_empty_owner(self):
        self.assertEqual(self.mobile_caseload(COACH_A), [10])
        self.assertEqual(self.mobile_caseload(COACH_B), [11])
        self.assertEqual(self.mobile_caseload(COACH_C), [])
        self.assertEqual(self.mobile_caseload(''), self.empty_owner_caseload)

    def test_loaded_profile_exposes_coach_name_and_email(self):
        from learner_api.models import LearnerProfile
        row = LearnerProfile.objects.only('id', 'coach_name', 'coach_email').get(enrolment_id=10)
        self.assertEqual((row.coach_name.strip(), row.coach_email.strip().lower()), ('Coach A', COACH_A))
        unassigned = LearnerProfile.objects.only('id', 'coach_name', 'coach_email').get(enrolment_id=12)
        self.assertFalse(unassigned.coach_name)
        self.assertFalse(unassigned.coach_email)

    def test_extra_activity_caseload_is_scoped_by_coach(self):
        self.assertEqual([(row['id'], row['programme']) for row in self.extra_caseload(COACH_A)],
                         [(10, 'Programme One')])
        self.assertEqual([row['id'] for row in self.extra_caseload(COACH_C)], [])


class CanonicalSchemaScopingTests(_ScopingBase, SimpleTestCase):
    keyed = True
    empty_owner_caseload = []  # NULL coach never equals ''

    @classmethod
    def learner_columns(cls):
        return 'coach_id INTEGER'

    @classmethod
    def learner_rows(cls):
        return '''INSERT INTO "Learner".learners VALUES
            (10,10,'l10@example.test','Learner Ten','commercial','P1','active',1),
            (11,11,'l11@example.test','Learner Eleven','commercial','P1','active',2),
            (12,12,'l12@example.test','Learner Twelve','commercial','P1','active',NULL),
            (13,13,'l13@example.test','Learner Thirteen','commercial','P1','active',99);'''

    def test_sql_has_no_copied_coach_column(self):
        from learner_api.models import LearnerProfile
        sql = str(LearnerProfile.objects.only('id', 'coach_name', 'coach_email').query)
        self.assertNotIn('"coach_name"', sql)
        self.assertNotIn('"coach_email"', sql)
        self.assertIn('curriculum.coaches', sql)

    def test_profile_model_does_not_select_removed_learning_plan(self):
        from learner_api.models import LearnerProfile

        self.assertNotIn('learning_plan', {field.name for field in LearnerProfile._meta.concrete_fields})
        sql = str(LearnerProfile.objects.filter(enrolment_id=10).query)
        self.assertNotIn('learning_plan', sql.lower())


class LegacySchemaScopingTests(_ScopingBase, SimpleTestCase):
    keyed = False
    # Unchanged legacy behaviour: blank copied columns compare equal to ''.
    empty_owner_caseload = [12, 13]

    @classmethod
    def learner_columns(cls):
        return 'coach_name TEXT, coach_email TEXT'

    @classmethod
    def learner_rows(cls):
        return f'''INSERT INTO "Learner".learners VALUES
            (10,10,'l10@example.test','Learner Ten','commercial','P1','active','Coach A',' A@Example.test '),
            (11,11,'l11@example.test','Learner Eleven','commercial','P1','active','Coach B','{COACH_B}'),
            (12,12,'l12@example.test','Learner Twelve','commercial','P1','active','',''),
            (13,13,'l13@example.test','Learner Thirteen','commercial','P1','active','','');'''
