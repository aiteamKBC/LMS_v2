"""Parity of selectors/curriculum_catalogue.py with LearnerProfile.training_plan.

Disposable local PostgreSQL only: fresh initdb in a temp dir, loopback random
port, PG* environment stripped, stopped in finally. No project settings, .env,
shared DSN, migrations or external services. Synthetic rows only.

Run: python -I -B backend/learner_api/test_curriculum_catalogue_local_postgres.py
"""
import importlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest

CLUSTER = Path(tempfile.mkdtemp(prefix='lms-curriculum-synthetic-'))
ENV = {k: v for k, v in os.environ.items() if not k.upper().startswith('PG')}
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    PORT = probe.getsockname()[1]

SCHEMA = '''
CREATE SCHEMA "Learner";
CREATE TABLE "Learner".learners(id bigint PRIMARY KEY);
CREATE TABLE "Learner".learner_training_plan_modules(id bigserial PRIMARY KEY,
  learner_id bigint NOT NULL REFERENCES "Learner".learners(id) ON DELETE CASCADE,
  position integer NOT NULL, module_ref text, module_title text NOT NULL DEFAULT '');
CREATE TABLE "Learner".learner_training_plan_weeks(id bigserial PRIMARY KEY,
  plan_module_id bigint NOT NULL REFERENCES "Learner".learner_training_plan_modules(id) ON DELETE CASCADE,
  position integer NOT NULL, week_ref text, week_title text NOT NULL DEFAULT '');
CREATE TABLE "Learner".learner_training_plan_components(id bigserial PRIMARY KEY,
  plan_week_id bigint NOT NULL REFERENCES "Learner".learner_training_plan_weeks(id) ON DELETE CASCADE,
  position integer NOT NULL, component_ref text, component_title text NOT NULL DEFAULT '');
CREATE TABLE "Learner".learner_ksb_assignments(learner_id bigint PRIMARY KEY
  REFERENCES "Learner".learners(id) ON DELETE CASCADE, profile_version_id bigint NOT NULL);
INSERT INTO "Learner".learners VALUES (501),(502),(503);
-- Learner 501: modules inserted out of position order; equal positions tie on id.
INSERT INTO "Learner".learner_training_plan_modules(id,learner_id,position,module_ref,module_title) VALUES
 (12,501,2,'M2','Second'),(11,501,1,'M1','First'),(13,501,2,NULL,'Title-only tie'),
 (21,502,1,'M1','Shared module ref, other learner');
INSERT INTO "Learner".learner_training_plan_weeks(id,plan_module_id,position,week_ref,week_title) VALUES
 (32,11,2,'W2',''),(31,11,1,'W1','Week one'),(33,12,1,NULL,'Orphan week'),(41,21,1,'W9','Other learner week');
INSERT INTO "Learner".learner_training_plan_components(id,plan_week_id,position,component_ref,component_title) VALUES
 (52,31,2,'C2','Second activity'),(51,31,1,'C1','First activity'),(53,31,2,'C3','Tie on position'),
 (61,41,1,'C9','Other learner activity');
INSERT INTO "Learner".learner_ksb_assignments VALUES (501,7);
'''


def command(*args):
    subprocess.run([str(a) for a in args], check=True, env=ENV,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class CurriculumParityTests(unittest.TestCase):
    def test_selector_matches_orm_training_plan_with_fewer_queries(self):
        from django.db import connections
        from django.test.utils import CaptureQueriesContext
        from learner_api.models import LearnerProfile
        from learner_api.selectors.curriculum_catalogue import assigned_curricula

        connection = connections['enrolment']

        def query(sql, params):
            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                names = [column[0] for column in cursor.description]
                return [dict(zip(names, row)) for row in cursor.fetchall()]

        with CaptureQueriesContext(connection) as selector_queries:
            result = assigned_curricula([501, 502, 503], query=query)
        for learner_id in (501, 502, 503):
            with self.subTest(learner=learner_id):
                with CaptureQueriesContext(connection) as orm_queries:
                    expected = LearnerProfile(pk=learner_id).training_plan
                self.assertEqual(result[learner_id]['modules'], expected)
                print(f'learner {learner_id}: ORM training_plan {len(orm_queries)} queries')
        self.assertEqual(len(selector_queries), 2)
        print(f'selector: {len(selector_queries)} queries for 3 learners')
        self.assertEqual([m['moduleId'] for m in result[501]['modules']], ['M1', 'M2', None])
        self.assertEqual([c['componentId'] for c in result[501]['modules'][0]['weeks'][0]['components']],
                         ['C1', 'C2', 'C3'])
        self.assertEqual(result[501]['ksbProfileVersionId'], 7)
        self.assertEqual(result[502]['ksbProfileVersionId'], None)
        self.assertEqual(result[503], {'modules': [], 'ksbProfileVersionId': None})
        # Learner isolation: 502's activity never appears under 501.
        self.assertNotIn('C9', str(result[501]))
        for sql in (q['sql'] for q in selector_queries.captured_queries):
            self.assertNotRegex(sql, r'\b(curriculum|enrolment|login)\.')


if __name__ == '__main__':
    started = False
    try:
        command('initdb', '-D', CLUSTER / 'data', '-U', 'curriculum_test_owner', '-A', 'trust',
                '--no-locale', '--encoding=UTF8')
        command('pg_ctl', '-D', CLUSTER / 'data', '-l', CLUSTER / 'server.log',
                '-o', f'-h 127.0.0.1 -p {PORT}', '-w', 'start')
        started = True
        command('psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', PORT,
                '-U', 'curriculum_test_owner', '-d', 'postgres', '-c', SCHEMA)
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from django.apps import AppConfig
        from django.conf import settings
        settings.configure(
            SECRET_KEY='synthetic-local-only', USE_TZ=True, TIME_ZONE='Europe/London',
            INSTALLED_APPS=['django.contrib.contenttypes', 'django.contrib.auth',
                            AppConfig('learner_api', importlib.import_module('learner_api'))],
            DATABASES={'default': {'ENGINE': 'django.db.backends.dummy'},
                       'enrolment': {'ENGINE': 'django.db.backends.postgresql', 'NAME': 'postgres',
                                     'USER': 'curriculum_test_owner', 'HOST': '127.0.0.1', 'PORT': str(PORT)}},
            DATABASE_ROUTERS=['learner_api.routers.EnrolmentRouter'])
        import django
        django.setup()
        result = unittest.TextTestRunner(verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(CurriculumParityTests))
        from django.db import connections
        connections.close_all()
        raise SystemExit(0 if result.wasSuccessful() else 1)
    finally:
        if started:
            command('pg_ctl', '-D', CLUSTER / 'data', '-m', 'fast', '-w', 'stop')
        shutil.rmtree(CLUSTER, ignore_errors=True)
