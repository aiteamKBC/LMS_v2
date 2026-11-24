"""SELECT-only PostgreSQL fixtures against the verified Development schema."""
import os
from unittest import TestCase, skipUnless
from uuid import UUID
from unittest.mock import patch
from psycopg.types.json import Jsonb
from . import free_course_attempts as attempts


@skipUnless(os.environ.get('RUN_MY_LEARNING_READ_ONLY_TESTS') == '1', 'Development read-only opt-in required')
class FreeCourseAttemptSQLTests(TestCase):
    def setUp(self):
        from scripts.verify_inclusion_canonical_targets import connect_development
        self.connection = connect_development()
        self.addCleanup(self.connection.close)
        self.addCleanup(self.connection.rollback)

    def test_canonical_and_valid_legacy_attempts_keep_their_scores_and_dates(self):
        rows = [dict(id=str(UUID(int=i)),learner_id=501 if i != 3 else 502,
                     free_component_ref='COMP' if i != 2 else None,source_activity_fk=91 if i == 2 else None,
                     score_percent=60+i,passed=False,completed=False,submitted_at='2026-10-01T12:00:00Z')
                for i in (1,2,3)]
        tables = [
            ('"Learner".subject_activity_attempts',rows),
            ('"Learner".learner_progress_entries',[
                dict(id=10,learner_id=501,free_course_ref='FREE',free_component_ref='COMP',
                     deleted_at='2026-01-01T00:00:00Z',accepted=False)]),
            ('"Learner".learner_activity_sources',[
                dict(canonical_progress_id=10,learner_id=501,source_catalog_activity_id=91)]),
        ]
        sql, ctes, params = attempts.HISTORY_SQL, [], []
        for index,(table,records) in enumerate(sorted(tables,key=lambda item:-len(item[0]))):
            name = f'fixture_{index}'
            sql = sql.replace(table,name)
            ctes.append(f'{name} AS (SELECT * FROM jsonb_populate_recordset(NULL::{table},%s::jsonb))')
            params.append(Jsonb(records))
        result = self.connection.execute('WITH '+','.join(ctes)+' '+sql,params+[501,'COMP','COMP']).fetchall()
        self.assertEqual([row[0] for row in result],[UUID(int=2),UUID(int=1)])
        self.assertEqual([int(row[1]) for row in result],[62,61])
        self.assertTrue(all(row[4].isoformat()=='2026-10-01T12:00:00+00:00' for row in result))

    def test_manually_installed_attempt_constraint_matches_recording_migration(self):
        from importlib import import_module
        migration = import_module('learner_api.migrations.0029_free_course_historical_bridges')
        self.assertTrue(callable(migration.install))
        columns = dict(self.connection.execute('''SELECT column_name,is_nullable FROM information_schema.columns
          WHERE table_schema='Learner' AND table_name='subject_activity_attempts' ''').fetchall())
        self.assertEqual(columns['source_activity_fk'],'YES')
        self.assertIn('free_component_ref',columns)
        self.assertIn('source_activity_snapshot',columns)

    def test_prepared_migration_accepts_canonical_identity_but_not_incomplete_legacy_identity(self):
        from importlib import import_module
        migration = import_module('learner_api.migrations.0030_canonical_free_course_attempts')
        condition = migration.SQL.split('CHECK (',1)[1].split(');',1)[0]
        rows = [dict(free_component_ref='COMP',source_activity_snapshot={'free_component_ref':'COMP'}),
                dict(source_activity_fk=1,enrolment_id=2,aptem_id=3,group_id=4,activity_id=5),
                dict(source_activity_fk=1),dict(free_component_ref='COMP'),dict()]
        result = self.connection.execute('SELECT ('+condition+''') FROM jsonb_populate_recordset(
          NULL::"Learner".subject_activity_attempts,%s::jsonb)''',[Jsonb(rows)]).fetchall()
        self.assertEqual(result,[(True,),(True,),(False,),(False,),(False,)])

    def test_resume_projection_reads_saved_times_only_for_owned_assignments(self):
        owner,courses = self.connection.execute('''SELECT learner_id,array_agg(free_course_ref)
          FROM "Learner".learner_free_courses GROUP BY learner_id ORDER BY learner_id LIMIT 1''').fetchone()
        with patch.object(attempts,'connections',{'enrolment':self.connection}):
            times = attempts.activity_times(owner,courses)
            self.assertTrue(all(course in courses and timestamp is not None for (course,_),timestamp in times.items()))
            self.assertEqual(attempts.activity_times(-1,courses),{})
