"""Actual old/new SQL and HTTP parity on disposable synthetic PostgreSQL only."""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection, connections, transaction
from django.test import RequestFactory, SimpleTestCase
from django.test.utils import CaptureQueriesContext

from curriculum_api.catalogue.api import free_course_authoring as facade
from curriculum_api.catalogue.api import free_course_authoring_views as api
from curriculum_api.catalogue.infrastructure import free_course_rows as free_course_catalogue
from curriculum_api import schema_gate
from curriculum_api.catalogue.application import free_course_queries as queries
from curriculum_api.catalogue.infrastructure import free_course_document_reads as reads
from curriculum_api.catalogue.tests.parity.free_course_read_oracle import legacy_module
from learner_api.constants import ACCESS_CURRICULUM


class FreeCourseReadPostgreSQL(SimpleTestCase):
    databases = {'default'}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        assert set(connections) == {'default', 'enrolment', 'audit', 'audit_clone',
                                    'kbc_attendance', 'assistant_conversations'}
        for alias in connections:
            config = connections[alias].settings_dict
            assert config['HOST'] == '127.0.0.1' and config['NAME'] == 'phase1f'
        assert connection.vendor == 'postgresql' and not connection.in_atomic_block
        # These tables must be absent in the isolated runner. No IF NOT EXISTS
        # or replacement of any existing data is allowed by this fixture.
        with connection.cursor() as cursor:
            cursor.execute('''CREATE TABLE curriculum.free_courses (
                id text PRIMARY KEY, course_name text, description text, display_order integer,
                component_count integer, total_otjh numeric, created_at timestamptz, updated_at timestamptz,
                cover_image_url text, week_count integer, course_type text, is_for_sale boolean,
                price numeric, currency text);
                CREATE TABLE curriculum.free_course_weeks (
                id text PRIMARY KEY, course_id text REFERENCES curriculum.free_courses(id), display_order integer,
                component_count integer, total_otjh numeric, created_at timestamptz, updated_at timestamptz,
                week_number integer, title text, summary text, learning_outcomes text, status text,
                holiday_note_enabled boolean, holiday_note text, legacy_copied_from_week_id text,
                deleted_at timestamptz);
                CREATE TABLE curriculum.free_programme_components (
                id text PRIMARY KEY, free_module_id text REFERENCES curriculum.free_course_weeks(id),
                programme_id text, type text, title text, description text, expected_otjh numeric,
                points integer, reflection_required boolean, workplace_evidence_required boolean,
                tutor_validation_required boolean, display_order integer, settings_json jsonb,
                created_at timestamptz, updated_at timestamptz, deleted_at timestamptz);
                CREATE TABLE curriculum.quizzes (
                id bigint PRIMARY KEY, free_course_week_id text, status text, week_id text);
                CREATE TABLE curriculum.quiz_course_links (
                id bigint PRIMARY KEY, quiz_id bigint, free_course_week_id text, free_course_id text,
                module_catalogue_id text, week_id text)''')
            cursor.execute('''INSERT INTO curriculum.free_courses
                (id,course_name,display_order,price,currency) VALUES
                ('FC-A','Alpha',0,10.00,'GBP'),('FC-B','Beta',1,NULL,NULL),('FC-EMPTY','Empty',2,0,'GBP');
                INSERT INTO curriculum.free_course_weeks
                (id,course_id,display_order,week_number,title,status,deleted_at,legacy_copied_from_week_id) VALUES
                ('FW-A','FC-A',0,1,'Inactive but visible','inactive',NULL,'NORMAL-PROVENANCE'),
                ('FW-B','FC-B',0,1,'Other owner','active',NULL,NULL),
                ('FW-ARCHIVED','FC-A',1,2,'Hidden','active',current_timestamp,NULL);
                INSERT INTO curriculum.free_programme_components
                (id,free_module_id,programme_id,type,title,expected_otjh,display_order,settings_json,deleted_at) VALUES
                ('CP-A','FW-A','FREE-COURSES','quiz','Canonical',1.50,0,'{"linkedQuizId":"41"}',NULL),
                ('CP-B','FW-B','FREE-COURSES','quiz','Cross owner',2,0,'{"linkedQuizId":"41"}',NULL),
                ('CP-LEGACY','FW-A','FREE-COURSES','quiz','Legacy diagnostic',0,1,'{"linkedQuizId":"43"}',NULL),
                ('CP-HIDDEN','FW-A','FREE-COURSES','reading','Hidden',0,2,'{}',current_timestamp);
                INSERT INTO curriculum.quizzes VALUES
                (41,'FW-A','published',NULL),(42,'FW-ARCHIVED','published',NULL),(43,NULL,'trash','NORMAL-WEEK');
                INSERT INTO curriculum.quiz_course_links VALUES
                (1,41,'FW-A','FC-A',NULL,NULL),(2,42,'FW-ARCHIVED','FC-A',NULL,NULL)''')
        # Actual schema gate verification, done before measuring document reads.
        reads._require_course_tables()
        cls.old_catalogue = legacy_module('free_course_catalogue.py',
                                         connection=connection, schema_gate=schema_gate)
        cls.old = legacy_module('free_course_authoring.py', connection=connection,
                                transaction=transaction, schema_gate=schema_gate,
                                free_course_catalogue=cls.old_catalogue)

    def capture_read(self, call):
        allowed = ('SELECT', 'SET TRANSACTION', 'BEGIN', 'COMMIT')
        def guard(execute, sql, params, many, context):
            self.assertTrue(sql.strip().upper().startswith(allowed), sql)
            return execute(sql, params, many, context)
        with connection.execute_wrapper(guard), CaptureQueriesContext(connection) as log:
            result = call()
        return result, [q['sql'] for q in log.captured_queries]

    def test_catalogue_sql_result_and_snapshot_match_original(self):
        old, old_sql = self.capture_read(self.old.catalogue_document)
        with patch.object(queries, 'catalogue_document', wraps=queries.catalogue_document) as actual:
            new, new_sql = self.capture_read(facade.catalogue_document)
        actual.assert_called_once()
        self.assertEqual(new, old)
        self.assertEqual(new_sql, old_sql)
        self.assertEqual(len([q for q in new_sql if q.startswith('SELECT') or q.startswith('select')]), 1)

    def test_course_sql_revision_and_archive_contract_match_original(self):
        old, old_sql = self.capture_read(lambda: self.old.course_document(' FC-A '))
        new, new_sql = self.capture_read(lambda: facade.course_document(' FC-A '))
        self.assertEqual(new, old)
        self.assertEqual(new_sql, old_sql)
        self.assertEqual([w['freeCourseWeekId'] for w in new['weeks']], ['FW-A'])
        self.assertEqual(new['weeks'][0]['status'], 'inactive')
        self.assertEqual([c['id'] for c in new['weeks'][0]['components']], ['CP-A', 'CP-LEGACY'])
        self.assertEqual(new['integrity']['legacyQuizReferenceCount'], 1)
        self.assertNotIn('unreferenced_canonical_quiz_link', [i['code'] for i in new['integrity']['issues']])
        self.assertEqual(sum(q.lower().startswith('select') for q in new_sql), 5)

    def test_batched_result_order_etag_inputs_and_sql_match_original(self):
        old, old_sql = self.capture_read(self.old.catalogue_with_documents)
        new, new_sql = self.capture_read(facade.catalogue_with_documents)
        self.assertEqual(new, old)
        self.assertEqual(new_sql, old_sql)
        self.assertEqual([d['course']['courseId'] for d in new['documents']], ['FC-A','FC-B','FC-EMPTY'])
        self.assertEqual(new['documents'][1]['integrity']['status'], 'blocked')
        self.assertEqual(new['documents'][2]['weeks'], [])
        self.assertEqual(sum(q.lower().startswith('select') for q in new_sql), 5)

    def test_actual_snapshot_controls_are_read_only(self):
        with reads._read_snapshot(), connection.cursor() as cursor:
            cursor.execute("SELECT current_setting('transaction_read_only'), current_setting('transaction_isolation')")
            self.assertEqual(cursor.fetchone(), ('on', 'repeatable read'))

    def test_http_get_invokes_extracted_queries_and_preserves_payload_headers(self):
        factory = RequestFactory()
        cases = [
            (api._catalogue_get, factory.get('/', {'include':'documents'}), (), self.old.catalogue_with_documents),
            (api._course_get, factory.get('/'), ('FC-A',), lambda: self.old.course_document('FC-A')),
        ]
        account = SimpleNamespace(role='staff', subject_type='staff', subject_id=999999)
        for endpoint, request, args, old_call in cases:
            expected = old_call()
            with patch('login.permissions.authenticate_request', return_value=account), \
                 patch('login.permissions._accesses_of', return_value=frozenset({ACCESS_CURRICULUM})), \
                 patch.object(queries, '_assemble_course_document',
                              wraps=queries._assemble_course_document) as build:
                response, sql = self.capture_read(lambda: endpoint(request, *args))
            self.assertGreater(build.call_count, 0)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content), expected)
            self.assertEqual(response['ETag'], '"' + expected.get('documentsRevision', expected['revision']) + '"')
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertIn('Cookie', response['Vary'])
