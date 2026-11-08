"""Real PostgreSQL quota, ownership, retry and history-preservation checks."""
from importlib import import_module
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from django.core.management import call_command
from django.db import connections
from django.test import SimpleTestCase
from old_otjh.service import ServiceError

from . import legacy_quiz_retakes as retakes, subject_store, progress_transfer_store
from .subject_content import quiz_definition


class LegacyQuizRetakeStorageTests(SimpleTestCase):
    databases = {'enrolment'}

    def setUp(self):
        self.db = connections['enrolment']
        if self.db.vendor != 'postgresql':
            self.skipTest('Requires the verified PostgreSQL test runner.')
        for obj, name, value in (
            (retakes, 'GRANTS', 'pg_temp.retake_grants'),
            (subject_store, 'ATTEMPTS', 'pg_temp.retake_attempts'),
            (subject_store, 'COVERS', 'pg_temp.retake_covers'),
            (progress_transfer_store, 'ITEMS', 'pg_temp.retake_transfers'),
        ):
            self.enterContext(patch.object(obj, name, value))
        self.grant_id = uuid4()
        self.definition = {'title': 'Synthetic quiz', 'available': True, 'has_reading': False,
            'catalogue_kind': 'quiz', 'retakeRequired': True,
            'quiz': quiz_definition({'quiz_id': 60, 'maximum_score': 100, 'passing_score': 80,
                'questions': [{'question_id': 1, 'question_body': 'Example?', 'options': [
                    {'option_order': 1, 'option_text': 'Yes'}, {'option_order': 2, 'option_text': 'No'}]}],
                'solutions': [{'question_id': 1, 'correct_answer': ['Yes']}]})}
        self.addCleanup(self.drop_tables)
        with self.db.cursor() as cur:
            cur.execute('CREATE TEMP TABLE retake_users (id integer PRIMARY KEY)')
            cur.execute('INSERT INTO retake_users VALUES (9),(10)')
            cur.execute('''CREATE TEMP TABLE retake_attempts (
                id uuid PRIMARY KEY,enrolment_id bigint,aptem_id bigint,group_id bigint,activity_id bigint,
                kind text,definition jsonb,answers jsonb,score_percent numeric,passed boolean,
                completed boolean DEFAULT false,reading_confirmed boolean DEFAULT false,
                started_at timestamptz DEFAULT now(),submitted_at timestamptz)''')
            cur.execute('CREATE TEMP TABLE retake_covers (subject_ref text,storage_path text)')
            cur.execute('CREATE TEMP TABLE retake_transfers (enrolment_id bigint,course_ref text)')
            sql = import_module('learner_api.migrations.0025_legacy_quiz_retake_grants').SQL
            sql = (sql.replace('CREATE TABLE', 'CREATE TEMP TABLE')
                .replace('"Learner".legacy_quiz_retake_grants', 'pg_temp.retake_grants')
                .replace('enrolment."Created_users"', 'pg_temp.retake_users')
                .replace('"Learner".subject_activity_attempts', 'pg_temp.retake_attempts'))
            cur.execute(sql)
            cur.execute('''INSERT INTO retake_grants
                (id,enrolment_id,aptem_id,group_id,quiz_id,ticket_ref,reason,granted_by)
                VALUES (%s,9,11,50,60,'TEST-1','Owner requested one new attempt','Test operator')''',[self.grant_id])
            cur.execute('''INSERT INTO retake_attempts
                (id,enrolment_id,aptem_id,group_id,activity_id,kind,definition,answers,score_percent,passed,completed,submitted_at)
                VALUES (%s,9,11,50,60,'quiz','{"catalogue_kind":"quiz"}','{}',100,true,true,now())''',[uuid4()])

    def drop_tables(self):
        with self.db.cursor() as cur:
            for name in ('grants', 'attempts', 'users', 'covers', 'transfers'):
                cur.execute('DROP TABLE IF EXISTS pg_temp.retake_' + name)

    def test_only_exact_learner_identity_course_and_quiz_receive_permission(self):
        self.assertTrue(retakes.allowed(9, 11, 50, 60))
        for args in ((10, 11, 50, 60), (9, 12, 50, 60), (9, 11, 51, 60), (9, 11, 50, 61)):
            self.assertFalse(retakes.allowed(*args))
            with self.assertRaises(ServiceError):
                subject_store.start(*args, self.definition)

    def test_failed_retake_consumes_one_grant_and_keeps_previous_pass_and_best_score(self):
        attempt = subject_store.start(9, 11, 50, 60, self.definition)
        result = subject_store.finish(9, 11, 50, 60, attempt, {'1': ['2']}, False, catalogue_kind='quiz')
        self.assertFalse(result['passed'])
        self.assertFalse(retakes.allowed(9, 11, 50, 60))
        progress = subject_store.state(9, 11, 60, group_id=50, catalogue_kind='quiz')
        self.assertEqual(len(progress['history']), 2)
        self.assertTrue(progress['progress'][0]['completed'])
        self.assertEqual(progress['progress'][0]['best_percent'], 100)
        self.assertEqual(progress['progress'][0]['attempt_count'], 2)
        with self.assertRaises(ServiceError):
            subject_store.start(9, 11, 50, 60, self.definition)

    def test_retried_submission_does_not_consume_another_grant_or_change_saved_answers(self):
        attempt = subject_store.start(9, 11, 50, 60, self.definition)
        subject_store.finish(9, 11, 50, 60, attempt, {'1': ['1']}, False, catalogue_kind='quiz')
        result = subject_store.finish(9, 11, 50, 60, attempt, {'1': ['2']}, False, catalogue_kind='quiz')
        self.assertTrue(result['already_submitted'])
        self.assertTrue(result['passed'])
        with self.db.cursor() as cur:
            cur.execute('SELECT count(*) FROM retake_attempts WHERE submitted_at IS NOT NULL')
            self.assertEqual(cur.fetchone()[0], 2)

    def test_two_started_attempts_cannot_both_spend_one_permission(self):
        first = subject_store.start(9, 11, 50, 60, self.definition)
        second = subject_store.start(9, 11, 50, 60, self.definition)
        subject_store.finish(9, 11, 50, 60, first, {'1': ['1']}, False, catalogue_kind='quiz')
        with self.assertRaises(ServiceError):
            subject_store.finish(9, 11, 50, 60, second, {'1': ['1']}, False, catalogue_kind='quiz')
        with self.db.cursor() as cur:
            cur.execute('SELECT submitted_at FROM retake_attempts WHERE id=%s',[second])
            self.assertIsNone(cur.fetchone()[0])

    def test_invalid_answers_do_not_spend_permission(self):
        attempt = subject_store.start(9, 11, 50, 60, self.definition)
        with self.assertRaises(ValueError):
            subject_store.finish(9, 11, 50, 60, attempt, {'1': ['unknown']}, False, catalogue_kind='quiz')
        self.assertTrue(retakes.allowed(9, 11, 50, 60))

    def test_repeated_operator_request_is_idempotent(self):
        with patch('learner_api.student_activity._owned_quiz', return_value=(11,
                {'completed': True, 'quiz': {'ready': True}})):
            for _ in range(2):
                call_command('grant_legacy_quiz_retake',kind='commercial',enrolment_id=9,
                    course_id=50,quiz_id=60,ticket='TEST-2',reason='One further submission',
                    operator='Test operator',apply=True,stdout=StringIO())
        with self.db.cursor() as cur:
            cur.execute("SELECT count(*) FROM retake_grants WHERE ticket_ref='TEST-2'")
            self.assertEqual(cur.fetchone()[0], 1)

    def test_operator_dry_run_does_not_create_a_permission(self):
        with patch('learner_api.student_activity._owned_quiz', return_value=(11,
                {'completed': True, 'quiz': {'ready': True}})):
            call_command('grant_legacy_quiz_retake',kind='commercial',enrolment_id=9,
                course_id=50,quiz_id=61,ticket='TEST-DRY',reason='Inspect only',
                operator='Test operator',stdout=StringIO(),install_storage=True)
        with self.db.cursor() as cur:
            cur.execute("SELECT count(*) FROM retake_grants WHERE ticket_ref='TEST-DRY'")
            self.assertEqual(cur.fetchone()[0], 0)

    def test_reapplying_consumed_ticket_does_not_reopen_it(self):
        attempt = subject_store.start(9, 11, 50, 60, self.definition)
        subject_store.finish(9, 11, 50, 60, attempt, {'1': ['1']}, False, catalogue_kind='quiz')
        with patch('learner_api.student_activity._owned_quiz', return_value=(11,
                {'completed': True, 'quiz': {'ready': True}})):
            call_command('grant_legacy_quiz_retake',kind='commercial',enrolment_id=9,
                course_id=50,quiz_id=60,ticket='TEST-1',reason='Retry the same request',
                operator='Test operator',apply=True,stdout=StringIO())
        self.assertFalse(retakes.allowed(9, 11, 50, 60))
