"""Historical constraints and cache triggers on an explicitly isolated PostgreSQL cluster.

Development access is SELECT-only. Copy table definitions, never learner data.
Run with --port PORT --data-directory PATH (a new lms_hist_closure_* cluster).
"""
import argparse
import json
from pathlib import Path
import unittest
from uuid import uuid4

import psycopg
from psycopg import sql

from verify_inclusion_canonical_targets import connect_development

TABLES = ('curriculum.historical_components', '"Learner".learner_progress_historical_components')


def development_schema():
    with connect_development() as connection:
        schema = {}
        for table in TABLES:
            columns = connection.execute('''SELECT a.attname,format_type(a.atttypid,a.atttypmod),
                a.attnotnull,pg_get_expr(d.adbin,d.adrelid) FROM pg_attribute a
                LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped
                ORDER BY a.attnum''', [table]).fetchall()
            constraints = connection.execute('''SELECT conname,contype,pg_get_constraintdef(oid),convalidated
                FROM pg_constraint WHERE conrelid=to_regclass(%s) AND contype<>'n' ORDER BY conname''', [table]).fetchall()
            indexes = connection.execute('''SELECT indexrelid::regclass::text,pg_get_indexdef(indexrelid),indisvalid
                FROM pg_index WHERE indrelid=to_regclass(%s) AND indexrelid NOT IN
                (SELECT conindid FROM pg_constraint WHERE conrelid=to_regclass(%s)) ORDER BY 1''', [table, table]).fetchall()
            triggers = connection.execute('''SELECT pg_get_triggerdef(oid),tgenabled FROM pg_trigger
                WHERE tgrelid=to_regclass(%s) AND NOT tgisinternal ORDER BY tgname''', [table]).fetchall()
            digest = connection.execute('SELECT count(*),md5(string_agg(md5(to_jsonb(t)::text),%s '
                'ORDER BY to_jsonb(t)::text)) FROM ' + table + ' t', ['']).fetchone()
            assert all(row[3] for row in constraints) and all(row[2] for row in indexes)
            assert len(triggers) == 3 and all(row[1] == 'O' for row in triggers)
            schema[table] = (columns, constraints, indexes, triggers, digest)
        assert [schema[t][-1][0] for t in TABLES] == [2997, 7922]
        functions = ('"Learner".invalidate_monthly_actuals(bigint[])',
                     '"Learner".monthly_actual_event_25()', '"Learner".monthly_actual_event_10()')
        schema['functions'] = [connection.execute('SELECT pg_get_functiondef(%s::regprocedure)', [f]).fetchone()[0]
                               for f in functions]
        connection.rollback()
        return schema


def prepare(port, directory, schema):
    config = dict(host='127.0.0.1', port=port, user='postgres', dbname='postgres', connect_timeout=5)
    with psycopg.connect(**config, autocommit=True) as admin:
        host, actual_port, actual_directory, branch = admin.execute('''SELECT host(inet_server_addr()),
            inet_server_port(),current_setting('data_directory'),current_setting('neon.branch_id',true)''').fetchone()
        if (host != '127.0.0.1' or actual_port != port or branch
                or Path(actual_directory).resolve() != (directory / 'data').resolve()
                or not directory.name.startswith('lms_hist_closure_')):
            raise RuntimeError('Not the selected disposable historical-component cluster.')
        others = admin.execute("SELECT datname FROM pg_database WHERE NOT datistemplate AND datname<>'postgres'").fetchall()
        if any(not name.startswith('hist_closure_test_') for (name,) in others):
            raise RuntimeError('Cluster contains a non-test database.')
        config['dbname'] = 'hist_closure_test_' + uuid4().hex
        admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(config['dbname'])))
    with psycopg.connect(**config) as connection:
        connection.execute('''CREATE SCHEMA curriculum; CREATE SCHEMA "Learner";
            CREATE TABLE curriculum.programmes(programme_id varchar(128) PRIMARY KEY);
            CREATE TABLE curriculum.modules(module_catalogue_id varchar(128) PRIMARY KEY,
                programme_id varchar(128), UNIQUE(module_catalogue_id,programme_id));
            CREATE TABLE curriculum.weeks(id varchar(128) PRIMARY KEY,module_catalogue_id varchar(128),
                UNIQUE(id,module_catalogue_id));
            CREATE TABLE curriculum.source_courses(id bigint PRIMARY KEY);
            CREATE TABLE curriculum.source_activities(id bigint PRIMARY KEY);
            CREATE TABLE "Learner".learner_progress_entries(id bigint PRIMARY KEY,learner_id bigint);
            CREATE TABLE "Learner".learner_activity_sources(id bigint PRIMARY KEY);
            CREATE TABLE "Learner".learner_monthly_targets(id bigint PRIMARY KEY,learner_id bigint,
                actual_seconds_total bigint,actual_updated_at timestamptz,actual_summary jsonb);
            INSERT INTO curriculum.programmes VALUES ('P1'),('P2');
            INSERT INTO curriculum.modules VALUES ('M1','P1'),('M2','P2');
            INSERT INTO curriculum.weeks VALUES ('W1','M1'),('W2','M2');
            INSERT INTO curriculum.source_courses VALUES (1);
            INSERT INTO curriculum.source_activities VALUES (1);
            INSERT INTO "Learner".learner_progress_entries VALUES (1,101),(2,102);
            INSERT INTO "Learner".learner_activity_sources VALUES (1),(2),(3);
            INSERT INTO "Learner".learner_monthly_targets VALUES
                (1,101,3600,now(),'{}'),(2,101,1800,now(),'{}'),(3,102,7200,now(),'{}');''')
        for table in TABLES:
            columns, constraints, indexes, triggers, _ = schema[table]
            fields = [sql.SQL('{} {}{}{}').format(sql.Identifier(name), sql.SQL(kind),
                sql.SQL(' NOT NULL' if required else ''), sql.SQL(' DEFAULT '+default if default else ''))
                for name, kind, required, default in columns]
            connection.execute(sql.SQL('CREATE TABLE {} ({})').format(sql.SQL(table), sql.SQL(',').join(fields)))
            for name, _, definition, _ in constraints:
                connection.execute(sql.SQL('ALTER TABLE {} ADD CONSTRAINT {} {}').format(
                    sql.SQL(table), sql.Identifier(name), sql.SQL(definition)))
            for _, definition, _ in indexes:
                connection.execute(definition)
        for definition in schema['functions']:
            connection.execute(definition)
        for table in TABLES:
            for definition, _ in schema[table][3]:
                connection.execute(definition)
        connection.execute('''INSERT INTO curriculum.historical_components
            (id,source_system,source_activity_id,source_catalog_activity_id,source_course_id,
             curriculum_programme_ref,curriculum_module_ref,curriculum_week_ref,placement_status)
            VALUES ('H1','synthetic','material:1',1,1,'P1','M1','W1','mapped_week'),
                   ('H2','synthetic','material:2',NULL,NULL,NULL,NULL,NULL,'unmapped');
            INSERT INTO "Learner".learner_progress_historical_components
                (progress_id,historical_component_ref,source_row_id) VALUES (1,'H1',1);''')
    return config


def run(config):
    class HistoricalTests(unittest.TestCase):
        def setUp(self):
            self.c = psycopg.connect(**config)
            self.addCleanup(self.c.close)
            self.addCleanup(self.c.rollback)
            self.reset_cache()

        def reset_cache(self):
            self.c.execute('''UPDATE "Learner".learner_monthly_targets
                SET actual_seconds_total=3600,actual_updated_at=now(),actual_summary='{}' ''')

        def invalidated(self):
            return self.c.execute('''SELECT DISTINCT learner_id FROM "Learner".learner_monthly_targets
                WHERE actual_seconds_total IS NULL AND actual_updated_at IS NULL AND actual_summary IS NULL
                ORDER BY learner_id''').fetchall()

        def reject(self, statement, params=()):
            with self.assertRaises(psycopg.IntegrityError), self.c.transaction():
                self.c.execute(statement, params)

        def test_all_historical_foreign_keys_reject_orphans(self):
            for field, value in [('source_catalog_activity_id',999),('source_course_id',999),
                                 ('curriculum_programme_ref','missing'),('curriculum_module_ref','missing'),
                                 ('curriculum_week_ref','missing')]:
                with self.subTest(field=field):
                    self.reject(sql.SQL("UPDATE curriculum.historical_components SET {}=%s WHERE id='H1'")
                                .format(sql.Identifier(field)), [value])

        def test_composite_foreign_keys_reject_valid_but_inconsistent_placement(self):
            self.reject("UPDATE curriculum.historical_components SET curriculum_programme_ref='P2' WHERE id='H1'")
            self.reject("UPDATE curriculum.historical_components SET curriculum_week_ref='W2' WHERE id='H1'")

        def test_placement_checks_and_historical_only(self):
            for change in ["curriculum_programme_ref=NULL", "curriculum_module_ref=NULL", "curriculum_week_ref=NULL",
                           "placement_status='mapped_module'", "placement_status='unmapped'", "placement_status='invalid'",
                           "historical_only=false"]:
                with self.subTest(change=change):
                    self.reject("UPDATE curriculum.historical_components SET "+change+" WHERE id='H1'")

        def test_nullable_historical_placements_remain_supported(self):
            for status in ['unmapped','source_course_only','source_section_only']:
                self.c.execute("UPDATE curriculum.historical_components SET placement_status=%s WHERE id='H2'",[status])
            self.c.execute("UPDATE curriculum.historical_components SET curriculum_programme_ref='P1' WHERE id='H2'")
            self.c.execute("UPDATE curriculum.historical_components SET curriculum_week_ref=NULL,placement_status='mapped_module' WHERE id='H1'")

        def test_primary_and_live_identity_uniqueness(self):
            self.reject("INSERT INTO curriculum.historical_components (id,source_system,source_activity_id) VALUES ('H1','new','new')")
            self.reject("INSERT INTO curriculum.historical_components (id,source_system,source_activity_id) VALUES ('H3','synthetic','material:2')")
            self.c.execute("UPDATE curriculum.historical_components SET deleted_at=now() WHERE id='H2'")
            self.c.execute("INSERT INTO curriculum.historical_components (id,source_system,source_activity_id) VALUES ('H3','synthetic','material:2')")

        def test_all_link_foreign_keys_uniqueness_and_relationship(self):
            for values in [(999,'H2',2),(2,'missing',2),(2,'H2',999),(1,'H1',1),(2,'H2',1)]:
                with self.subTest(values=values):
                    self.reject('INSERT INTO "Learner".learner_progress_historical_components (progress_id,historical_component_ref,source_row_id) VALUES (%s,%s,%s)', values)
            self.reject('UPDATE "Learner".learner_progress_historical_components SET relationship=%s',['current'])

        def test_referenced_history_delete_and_identity_update_are_restricted(self):
            self.reject("DELETE FROM curriculum.historical_components WHERE id='H1'")
            self.reject("UPDATE curriculum.historical_components SET id='changed' WHERE id='H1'")
            self.assertEqual(self.c.execute('SELECT count(*) FROM "Learner".learner_progress_historical_components').fetchone()[0],1)
            self.assertEqual(self.invalidated(),[])

        def test_placement_parent_deletions_and_updates_preserve_history(self):
            for statement in ["DELETE FROM curriculum.programmes WHERE programme_id='P1'",
                "DELETE FROM curriculum.modules WHERE module_catalogue_id='M1'",
                "DELETE FROM curriculum.weeks WHERE id='W1'",
                "UPDATE curriculum.programmes SET programme_id='new' WHERE programme_id='P1'",
                "UPDATE curriculum.modules SET programme_id='P2' WHERE module_catalogue_id='M1'",
                "UPDATE curriculum.modules SET module_catalogue_id='new' WHERE module_catalogue_id='M1'",
                "UPDATE curriculum.weeks SET module_catalogue_id='M2' WHERE id='W1'",
                "UPDATE curriculum.weeks SET id='new' WHERE id='W1'"]:
                with self.subTest(statement=statement): self.reject(statement)
            self.assertEqual(self.c.execute("SELECT curriculum_programme_ref,curriculum_module_ref,curriculum_week_ref,placement_status FROM curriculum.historical_components WHERE id='H1'").fetchone(),('P1','M1','W1','mapped_week'))

        def test_source_and_progress_parent_key_updates_are_restricted(self):
            for statement in [
                'UPDATE curriculum.source_courses SET id=999 WHERE id=1',
                'UPDATE curriculum.source_activities SET id=999 WHERE id=1',
                'UPDATE "Learner".learner_progress_entries SET id=999 WHERE id=1',
                'UPDATE "Learner".learner_activity_sources SET id=999 WHERE id=1',
            ]:
                with self.subTest(statement=statement):
                    self.reject(statement)

        def test_batch_history_change_invalidates_each_linked_owner(self):
            self.c.execute('INSERT INTO "Learner".learner_progress_historical_components '
                           '(progress_id,historical_component_ref,source_row_id) VALUES (2,\'H2\',2)')
            self.reset_cache()
            self.c.execute("UPDATE curriculum.historical_components SET source_course_ref='batch'")
            self.assertEqual(self.invalidated(),[(101,),(102,)])

        def test_catalogue_parent_detachment_preserves_history_and_links(self):
            self.c.execute('DELETE FROM curriculum.source_activities WHERE id=1')
            self.c.execute('DELETE FROM curriculum.source_courses WHERE id=1')
            self.assertEqual(self.c.execute("SELECT source_catalog_activity_id,source_course_id,source_system,source_activity_id FROM curriculum.historical_components WHERE id='H1'").fetchone(),(None,None,'synthetic','material:1'))
            self.assertEqual(self.c.execute('SELECT count(*) FROM "Learner".learner_progress_historical_components').fetchone()[0],1)
            self.assertEqual(self.invalidated(),[])

        def test_history_lineage_and_soft_delete_invalidate_only_owners(self):
            for change in ["source_course_ref='updated'","source_activity_id='material:updated'",
                           "source_system='updated'","deleted_at=now()"]:
                self.reset_cache()
                self.c.execute("UPDATE curriculum.historical_components SET "+change+" WHERE id='H1'")
                self.assertEqual(self.invalidated(),[(101,)])

        def test_metadata_and_noop_changes_do_not_invalidate_hours(self):
            self.c.execute("UPDATE curriculum.historical_components SET title='display',updated_at=now() WHERE id='H1'")
            self.c.execute("UPDATE curriculum.historical_components SET source_system=source_system WHERE id='H1'")
            self.assertEqual(self.invalidated(),[])

        def test_link_insert_update_delete_invalidate_old_and_new_owners(self):
            self.c.execute('INSERT INTO "Learner".learner_progress_historical_components (progress_id,historical_component_ref,source_row_id) VALUES (2,\'H2\',2)')
            self.assertEqual(self.invalidated(),[(102,)])
            self.reset_cache()
            self.c.execute('UPDATE "Learner".learner_progress_historical_components SET progress_id=2 WHERE source_row_id=1')
            self.assertEqual(self.invalidated(),[(101,),(102,)])
            self.reset_cache()
            self.c.execute('DELETE FROM "Learner".learner_progress_historical_components WHERE source_row_id=1')
            self.assertEqual(self.invalidated(),[(102,)])

        def test_unlinked_history_insert_delete_does_not_invalidate_unrelated_learners(self):
            self.c.execute("INSERT INTO curriculum.historical_components (id,source_system,source_activity_id) VALUES ('H3','new','new')")
            self.c.execute("DELETE FROM curriculum.historical_components WHERE id='H3'")
            self.assertEqual(self.invalidated(),[])

        def test_parent_source_cascade_invalidates_and_keeps_historical_component(self):
            self.c.execute('DELETE FROM "Learner".learner_activity_sources WHERE id=1')
            self.assertEqual(self.invalidated(),[(101,)])
            self.assertEqual(self.c.execute("SELECT count(*) FROM curriculum.historical_components WHERE id='H1'").fetchone()[0],1)

        def test_committed_invalidation_notifies_the_owner(self):
            # Release this test's cache-row locks before the second connection.
            self.c.rollback()
            with psycopg.connect(**config,autocommit=True) as listener:
                listener.execute('LISTEN lms_monthly_actuals_changed')
                with psycopg.connect(**config) as writer:
                    writer.execute("UPDATE curriculum.historical_components SET source_course_ref='notify' WHERE id='H1'")
                notices=list(listener.notifies(timeout=2,stop_after=1))
                self.assertEqual(len(notices),1)
                self.assertEqual(json.loads(notices[0].payload),[101])

    return unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(HistoricalTests)).wasSuccessful()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,required=True)
    parser.add_argument('--data-directory',type=Path,required=True)
    args=parser.parse_args()
    before=development_schema()
    config=prepare(args.port,args.data_directory,before)
    try:
        passed=run(config)
    finally:
        assert development_schema()==before, 'Development metadata or preservation digest changed.'
        print('Development preserved: 2997 historical components and 7922 links; schema and row digests unchanged.')
    return 0 if passed else 1


if __name__=='__main__':
    raise SystemExit(main())
