"""Disposable PostgreSQL regressions for learner-125 schema compatibility.

Every application database URL is replaced before Django starts.  The shared
launcher creates a fresh loopback-only cluster and proves it is not Neon.
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
    local_url = f'postgresql://postgres@127.0.0.1:{port}/postgres'
    os.environ.update({
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
    })

    import django
    django.setup()
    from curriculum_api import calendar_holidays, curriculum_names
    from django.conf import settings
    from django.db import connections
    from learner_api.learner_detail import _activity_plan_assignments
    from old_otjh.service import ServiceError

    settings.USE_TZ = False
    settings.TIME_ZONE = '+00:00'
    if set(settings.DATABASES) != {'default', 'enrolment'}:
        raise AssertionError(f'Unexpected database aliases: {sorted(settings.DATABASES)}')
    for alias, database in settings.DATABASES.items():
        if (not database['ENGINE'].endswith('postgresql')
                or database['HOST'] != '127.0.0.1'
                or int(database['PORT']) != port
                or database['NAME'] != 'postgres'
                or database['USER'] != 'postgres'):
            raise AssertionError(f'{alias} is not the disposable loopback PostgreSQL cluster')

    with psycopg.connect(**config, autocommit=True) as db:
        host, actual_port, data_directory, branch = db.execute(
            "SELECT host(inet_server_addr()),inet_server_port(),"
            "current_setting('data_directory'),current_setting('neon.branch_id',true)"
        ).fetchone()
        if host != '127.0.0.1' or actual_port != port or branch or not data_directory:
            raise AssertionError('The integration database is not the disposable local cluster')
        db.execute('''
            CREATE SCHEMA "Learner";
            CREATE SCHEMA curriculum;
            CREATE TABLE "Learner".learners(
                id bigint PRIMARY KEY,enrolment_id bigint UNIQUE NOT NULL);
            CREATE TABLE "Learner".learner_training_plan_modules(
                id bigint PRIMARY KEY,learner_id bigint NOT NULL,position integer NOT NULL,
                curriculum_module_id text);
            CREATE TABLE "Learner".learner_training_plan_weeks(
                id bigint PRIMARY KEY,plan_module_id bigint NOT NULL,position integer NOT NULL,
                curriculum_week_id text);
            CREATE TABLE "Learner".learner_training_plan_components(
                id bigint PRIMARY KEY,plan_week_id bigint NOT NULL,position integer NOT NULL,
                curriculum_component_id text);
            CREATE TABLE curriculum.components(
                id text PRIMARY KEY,module_catalogue_id text NOT NULL,week_id text);
            CREATE TABLE curriculum.calendar_holidays(
                id text PRIMARY KEY,source_record_id text NOT NULL);
            CREATE TABLE curriculum.cohort_calendar_holidays(
                id bigint PRIMARY KEY,cohort_id text NOT NULL,
                calendar_holiday_id text NOT NULL,decision text NOT NULL);

            INSERT INTO "Learner".learners VALUES (272,125),(125,999);
            INSERT INTO "Learner".learner_training_plan_modules VALUES
                (10,272,1,'MOD-OWNED'),(20,125,1,'MOD-FOREIGN');
            INSERT INTO "Learner".learner_training_plan_weeks VALUES
                (100,10,1,'W-OLD'),(200,20,1,'W-FOREIGN');
            INSERT INTO "Learner".learner_training_plan_components VALUES
                (1000,100,1,'CONTROL-EXACT'),(1001,100,2,'HISTORICAL-MOVED'),
                (2000,200,1,'FOREIGN-EXACT');
            INSERT INTO curriculum.components VALUES
                ('CONTROL-EXACT','MOD-OWNED','W-CONTROL'),
                ('NEW-COMPONENT','MOD-OWNED','W-23'),
                ('HISTORICAL-MOVED','MOD-FOREIGN','W-NOW'),
                ('FOREIGN-CURRENT','MOD-FOREIGN','W-FOREIGN');
            INSERT INTO curriculum.calendar_holidays VALUES
                ('holiday:1','1'),('holiday:2','2');
            INSERT INTO curriculum.cohort_calendar_holidays VALUES
                (1,'COHORT-1','holiday:1','include'),
                (2,'COHORT-1','holiday:2','exclude');
        ''')

    class Learner125Integration(unittest.TestCase):
        def test_url_identity_maps_only_to_canonical_272(self):
            with connections['enrolment'].cursor() as cursor:
                cursor.execute('SELECT id FROM "Learner".learners WHERE enrolment_id=%s', [125])
                self.assertEqual(cursor.fetchall(), [(272,)])
                cursor.execute('SELECT enrolment_id FROM "Learner".learners WHERE id=%s', [125])
                self.assertEqual(cursor.fetchall(), [(999,)])

        def test_decision_schema_supplies_include_and_exclude_without_legacy_columns(self):
            self.assertEqual(calendar_holidays.cohort_choices(['COHORT-1']), {
                'COHORT-1': {'selected': ['1'], 'excluded': ['2']},
            })
            sql = curriculum_names._CHOICES_SQL.format(
                selected=calendar_holidays.choice_flag_sql('h', 'include', 'is_selected'),
                excluded=calendar_holidays.choice_flag_sql('h', 'exclude', 'is_excluded'),
            ).replace("union all select", "select", 1)
            with connections['default'].cursor() as cursor:
                cursor.execute(sql)
                rows = cursor.fetchall()
            self.assertEqual([(row[2], row[3], row[4]) for row in rows],
                             [('1', 'true', 'false'), ('2', 'false', 'true')])

        def assignment(self, component_id, *, source_id=125, learner_id=272):
            source = SimpleNamespace(pk=source_id)
            profile = SimpleNamespace(pk=learner_id, enrolment_id=source_id)
            return _activity_plan_assignments(source, profile, component_id)

        def test_exact_control_and_historical_placement_keep_precedence(self):
            assignments, owner = self.assignment('CONTROL-EXACT')
            self.assertIs(owner, assignments[0])
            self.assertEqual(owner['weeks'][0]['components'], [{'componentId': 'CONTROL-EXACT'},
                                                               {'componentId': 'HISTORICAL-MOVED'}])
            assignments, owner = self.assignment('HISTORICAL-MOVED')
            self.assertEqual(owner['moduleId'], 'MOD-OWNED')
            self.assertEqual(owner['weeks'][0]['weekId'], 'W-OLD')

        def test_new_component_uses_one_current_owned_module(self):
            assignments, owner = self.assignment('NEW-COMPONENT')
            self.assertIs(owner, assignments[0])
            self.assertEqual(owner['weeks'], [{
                'weekId': 'W-23', 'components': [{'componentId': 'NEW-COMPONENT'}],
            }])

        def test_cross_learner_and_wrong_canonical_identity_fail_closed(self):
            for operation in (
                lambda: self.assignment('FOREIGN-CURRENT'),
                lambda: self.assignment('FOREIGN-EXACT'),
                lambda: self.assignment('NEW-COMPONENT', learner_id=125),
            ):
                with self.subTest(operation=operation):
                    with self.assertRaises(ServiceError) as caught:
                        operation()
                    self.assertEqual(caught.exception.status, 404)

    return unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(Learner125Integration)
    ).wasSuccessful()


def main():
    from scripts import test_source_activity_ksbs_postgres as isolated
    isolated.run = run
    return isolated.main()


if __name__ == '__main__':
    raise SystemExit(main())
