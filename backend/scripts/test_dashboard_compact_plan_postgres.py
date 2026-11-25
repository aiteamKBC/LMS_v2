"""Isolated PostgreSQL regression for the Learner Dashboard plan projection.

The disposable cluster is provisioned by ``test_source_activity_ksbs_postgres``.
Before Django is imported, every database URL understood by the application is
overridden with either that loopback cluster or an explicit empty value.  The
test then proves every configured alias resolves to the same temporary server.
"""
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def run(config):
    port = int(config['port'])
    local_url = f"postgresql://postgres@127.0.0.1:{port}/postgres"
    isolated = {
        'DJANGO_SETTINGS_MODULE': 'config.settings',
        'DJANGO_USE_SQLITE': 'false',
        'DB_POOL': 'false',
        'DATABASE_URL': local_url,
        'DATABASEURL': local_url,
        'Database_url': local_url,
        'ENROLMENT_DATABASE_URL': local_url,
        'NEW_ENDPOINT_URL': '',
        'ASSISTANT_CONVERSATIONS_DATABASE_URL': '',
        'TICKETING_DATABASE_URL': '',
        'AUDIT_DATABASE_URL': '',
        'AUDIT_CLONE_DATABASE_URL': '',
        'LASR-ADUTIOD-CLNE': '',
        'KBC_ATTENDANCE_DATABASE_URL': '',
        'RUN_APP_ON_TEST_BRANCH': 'false',
        'USE_SECURITY_TEST_BRANCH': 'false',
    }
    os.environ.update(isolated)

    import django
    django.setup()
    from django.conf import settings
    from django.db import connections
    from django.test.utils import CaptureQueriesContext
    from learner_api import canonical_learning
    from learner_api.dashboard_weekly import recorded_ksbs
    from learner_api.ksb_domain import official_progress_relation
    from learner_api.learning_plan import install_canonical_training_plan_modules

    # The portable Windows PostgreSQL bundle has no named timezone data.  This
    # test-only fixed UTC offset preserves instants without changing the app.
    settings.USE_TZ = False
    settings.TIME_ZONE = '+00:00'

    expected_aliases = {'default', 'enrolment'}
    if set(settings.DATABASES) != expected_aliases:
        raise AssertionError(f"Unexpected database aliases: {sorted(settings.DATABASES)}")
    for alias, database in settings.DATABASES.items():
        if not database['ENGINE'].endswith('postgresql'):
            raise AssertionError(f"{alias} is not PostgreSQL")
        if database['HOST'] != '127.0.0.1' or int(database['PORT']) != port:
            raise AssertionError(f"{alias} is not the disposable loopback cluster")
        if database['NAME'] != 'postgres' or database['USER'] != 'postgres':
            raise AssertionError(f"{alias} has an unexpected database identity")

    with psycopg.connect(**config, autocommit=True) as db:
        host, actual_port, _data, branch = db.execute(
            "SELECT host(inet_server_addr()),inet_server_port(),"
            "current_setting('data_directory'),current_setting('neon.branch_id',true)"
        ).fetchone()
        if host != '127.0.0.1' or actual_port != port or branch:
            raise AssertionError('The integration database is not the disposable local cluster.')
        db.execute('DROP SCHEMA IF EXISTS "Learner" CASCADE')
        db.execute('DROP SCHEMA IF EXISTS curriculum CASCADE')
        db.execute('''
            CREATE SCHEMA "Learner";
            CREATE SCHEMA curriculum;
            CREATE TABLE curriculum.programmes(
                programme_id text PRIMARY KEY,standard_ref text,standard_version text);
            CREATE TABLE curriculum.ksb_standard_versions(
                standard_ref text,standard_version text,PRIMARY KEY(standard_ref,standard_version));
            CREATE TABLE curriculum.ksb_standard_definitions(
                id bigint PRIMARY KEY,ksb_code text,ksb_description text,
                standard_ref text,standard_version text);
            CREATE TABLE curriculum.modules(module_catalogue_id text PRIMARY KEY,title text);
            CREATE TABLE curriculum.weeks(id text PRIMARY KEY,title text);
            CREATE TABLE "Learner".learners(
                id bigint PRIMARY KEY,enrolment_id bigint,programme_id text,
                standard_ref text,standard_version text);
            CREATE TABLE "Learner".learner_training_plan_modules(
                id bigint PRIMARY KEY,learner_id bigint NOT NULL,position integer NOT NULL,
                curriculum_module_id text);
            CREATE TABLE "Learner".learner_training_plan_weeks(
                id bigint PRIMARY KEY,plan_module_id bigint NOT NULL,position integer NOT NULL,
                curriculum_week_id text NOT NULL);
            CREATE TABLE "Learner".learner_training_plan_components(
                id bigint PRIMARY KEY,plan_week_id bigint NOT NULL,position integer NOT NULL,
                curriculum_component_id text);
            CREATE TABLE "Learner".learner_progress_entries(
                id bigint PRIMARY KEY,learner_id bigint NOT NULL,component_ref text,
                curriculum_component_ref text,deleted_at timestamptz);
            CREATE TABLE "Learner".ksb_learner_progress(
                progress_id bigint NOT NULL,position integer NOT NULL,standard_ksb_id bigint,
                ksb_code text,classification text,weight numeric,weight_class text,
                source_type text,source_id text,mapping_status text,is_excluded boolean,
                legacy_definition_snapshot jsonb,exclusion_reason text,exclusion_metadata jsonb,
                PRIMARY KEY(progress_id,position));
            INSERT INTO curriculum.programmes VALUES ('P1','ST1','1'),('P2','ST1','2');
            INSERT INTO curriculum.ksb_standard_versions VALUES ('ST1','1'),('ST1','2');
            INSERT INTO curriculum.ksb_standard_definitions VALUES
                (1,'K1','Knowledge 1','ST1','1'),(2,'S2','Skill 2','ST1','1'),
                (3,'K1','Knowledge 1 version 2','ST1','2');
            INSERT INTO curriculum.modules VALUES ('MOD-1','Module 1'),('MOD-2','Module 2'),('FOREIGN','Foreign');
            INSERT INTO curriculum.weeks VALUES ('WEEK-1','Week 1'),('WEEK-2','Week 2'),('FOREIGN-WEEK','Foreign Week');
            INSERT INTO "Learner".learners VALUES
                (407,285,'P1','ST1','1'),(285,207,'P2','ST1','2');
            INSERT INTO "Learner".learner_training_plan_modules VALUES
                (10,407,1,'MOD-1'),(20,407,2,'MOD-2'),(30,285,1,'FOREIGN');
            INSERT INTO "Learner".learner_training_plan_weeks VALUES
                (101,10,1,'WEEK-1'),(201,20,1,'WEEK-2'),(301,30,1,'FOREIGN-WEEK');
            INSERT INTO "Learner".learner_training_plan_components VALUES
                (1001,101,1,'COMP-1'),(1002,101,2,'COMP-2'),(3001,301,1,'FOREIGN-COMP');
            INSERT INTO "Learner".learner_progress_entries VALUES
                (1,407,'COMP-1',NULL,NULL),(2,407,'OLD','COMP-2',NULL),
                (3,407,'COMP-1',NULL,NULL),(4,407,'COMP-1',NULL,NULL),
                (5,407,'COMP-1',NULL,'2026-01-01'),(6,285,'COMP-1',NULL,NULL);
            INSERT INTO "Learner".ksb_learner_progress VALUES
                (1,0,1,'K1','main',1,'hard','standard','ST1', 'verified',false,NULL,NULL,NULL),
                (1,1,2,'S2','main',1,'hard','standard','ST1', 'verified',false,NULL,NULL,NULL),
                (2,0,2,'S2','main',1,'hard','standard','ST1', 'verified',false,NULL,NULL,NULL),
                (3,0,2,'S2','main',1,'hard','standard','ST1', 'verified',true,NULL,'excluded',NULL),
                (4,0,NULL,'Z9','main',1,'hard','legacy','old', 'unresolved',false,'{}',NULL,NULL),
                (5,0,1,'K1','main',1,'hard','standard','ST1', 'verified',false,NULL,NULL,NULL),
                (6,0,3,'K1','main',1,'hard','standard','ST1', 'verified',false,NULL,NULL,NULL);
        ''')

    class DashboardPlanIntegration(unittest.TestCase):
        def test_complete_tree_is_ordered_and_scoped_to_canonical_407(self):
            source = SimpleNamespace(pk=285)
            profile = SimpleNamespace(
                pk=407, enrolment_id=285,
                _state=SimpleNamespace(db='enrolment'),
            )
            with CaptureQueriesContext(connections['enrolment']) as queries:
                result = install_canonical_training_plan_modules(source, profile)
            self.assertEqual(result, [
                {'moduleId': 'MOD-1', 'moduleTitle': 'Module 1', 'weeks': [
                    {'weekId': 'WEEK-1', 'weekTitle': 'Week 1', 'components': [
                        {'componentId': 'COMP-1'}, {'componentId': 'COMP-2'},
                    ]},
                ]},
                {'moduleId': 'MOD-2', 'moduleTitle': 'Module 2', 'weeks': [
                    {'weekId': 'WEEK-2', 'weekTitle': 'Week 2', 'components': []},
                ]},
            ])
            self.assertEqual(len(queries), 1)
            self.assertNotIn('FOREIGN', repr(result))
            self.assertNotIn('description', queries[0]['sql'])
            self.assertNotIn('settings_json', queries[0]['sql'])

        def test_url_285_is_never_used_as_canonical_learner_285(self):
            source = SimpleNamespace(pk=285)
            foreign = SimpleNamespace(
                pk=285, enrolment_id=207,
                _state=SimpleNamespace(db='enrolment'),
            )
            with CaptureQueriesContext(connections['enrolment']) as queries, \
                 self.assertRaisesRegex(ValueError, 'does not own'):
                install_canonical_training_plan_modules(source, foreign)
            self.assertEqual(len(queries), 0)

        def test_empty_plan_is_authoritative(self):
            source = SimpleNamespace(pk=999)
            profile = SimpleNamespace(
                pk=9999, enrolment_id=999,
                _state=SimpleNamespace(db='enrolment'),
            )
            self.assertEqual(install_canonical_training_plan_modules(source, profile), [])
            self.assertEqual(source._canonical_training_plan, [])

        def test_recorded_ksbs_scope_eligibility_and_identity_before_relationship(self):
            with CaptureQueriesContext(connections['enrolment']) as queries:
                rows = recorded_ksbs({'id': 407}, ['COMP-1', 'COMP-2'])
            self.assertEqual(rows, {'COMP-1': ['K1', 'S2'], 'COMP-2': ['S2']})
            self.assertEqual(len(queries), 1)
            sql = queries[0]['sql']
            self.assertIn('WITH canonical AS MATERIALIZED', sql)
            self.assertIn('FROM canonical entry', sql)
            self.assertNotIn('learner_progress_entries entry', sql)
            self.assertNotIn('Z9', repr(rows))
            self.assertEqual(recorded_ksbs({'id': 285}, ['COMP-1']), {'COMP-1': ['K1']})

        def test_overview_metrics_ksbs_scope_owner_and_progress_before_relationship(self):
            sql = f'''WITH canonical AS MATERIALIZED (
                SELECT p.id,p.learner_id
                FROM "Learner".learner_progress_entries p
                WHERE p.learner_id=ANY(%s) AND p.id=ANY(%s) AND p.deleted_at IS NULL
            ) SELECT k.progress_id,k.ksb_code,
                k.standard_ksb_id::text AS ksb_definition_id,k.ksb_code AS definition_code
                FROM {official_progress_relation(progress_relation='canonical')} k
                ORDER BY k.progress_id,k.position'''
            with CaptureQueriesContext(connections['enrolment']) as queries:
                rows = canonical_learning.query(sql, [[407], [1, 2, 3, 4, 5, 6]])
            self.assertEqual(rows, [
                {'progress_id': 1, 'ksb_code': 'K1', 'ksb_definition_id': '1',
                 'definition_code': 'K1'},
                {'progress_id': 1, 'ksb_code': 'S2', 'ksb_definition_id': '2',
                 'definition_code': 'S2'},
                {'progress_id': 2, 'ksb_code': 'S2', 'ksb_definition_id': '2',
                 'definition_code': 'S2'},
            ])
            self.assertEqual(len(queries), 1)
            self.assertIn('WITH canonical AS MATERIALIZED', queries[0]['sql'])
            self.assertIn('FROM canonical entry', queries[0]['sql'])
            self.assertNotIn('learner_progress_entries entry', queries[0]['sql'])
            self.assertNotIn('Z9', repr(rows))

    return unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(DashboardPlanIntegration)
    ).wasSuccessful()


def main():
    from scripts import test_source_activity_ksbs_postgres as isolated
    isolated.run = run
    return isolated.main()


if __name__ == '__main__':
    raise SystemExit(main())
