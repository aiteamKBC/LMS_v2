"""Public creation must never fall back to ordinary module storage."""
import json
from unittest.mock import patch

from django.db import connection
from django.test import RequestFactory

from . import free_course_native_schema as schema, learning_storage as store, views as v
from .tests import CurriculumPersistenceHarness
from .tests_free_course_native_storage import prepare_native_authoring_fixture


class FreeCourseCreationTests(CurriculumPersistenceHarness):
    def setUp(self):
        super().setUp()
        prepare_native_authoring_fixture()
        self.addCleanup(store.reset)
        self.factory = RequestFactory()

    def payload(self, reference='MOD-FREE-PUBLIC', **kind):
        return {
            'catalogueId': reference, 'title': 'Independent study',
            **(kind or {'isFreeCourse': True}),
            'weekStructure': [{'id': 'WEEK-' + reference, 'title': 'Study', 'components': [
                {'id': 'COMP-' + reference, 'type': 'reading', 'title': 'Reading',
                 'expectedOtjh': 2, 'settings': {'readingContent': '<p>Study</p>'}},
            ]}],
        }

    def call(self, method, payload):
        request = getattr(self.factory, method)('/', json.dumps(payload), content_type='application/json')
        if method == 'post':
            return v.curriculum_module_collection(request)
        return v.curriculum_module_structure(request, payload['catalogueId'])

    def counts(self):
        tables = (*schema.TABLES, 'free_courses', 'free_course_weeks', 'free_programme_components')
        with connection.cursor() as cursor:
            result = {}
            for table in tables:
                cursor.execute(f'SELECT count(*) FROM curriculum.{table}')
                result[table] = cursor.fetchone()[0]
            return result

    def test_unmigrated_post_refuses_every_free_course_flag_without_writing(self):
        before = self.counts()
        for kind in ({'isFreeCourse': True}, {'sourceType': 'free_course'}, {'source_type': 'free_course'}):
            with self.subTest(kind=kind), patch.object(v, 'save_module_authoring_structure') as save:
                response = self.call('post', self.payload(**kind))
                self.assertEqual(response.status_code, 503, response.content)
                self.assertEqual(json.loads(response.content)['code'], 'free_course_storage_not_ready')
                self.assertEqual(response['Cache-Control'], 'no-store')
                save.assert_not_called()
                self.assertEqual(self.counts(), before)

    def test_unmigrated_first_structure_save_cannot_bypass_creation_guard(self):
        before = self.counts()
        for kind in ({'isFreeCourse': True}, {'sourceType': 'free_course'}, {'source_type': 'free_course'}):
            with self.subTest(kind=kind), patch.object(v, 'save_module_authoring_structure') as save:
                response = self.call('patch', self.payload(**kind))
                self.assertEqual(response.status_code, 503, response.content)
                save.assert_not_called()
                self.assertEqual(self.counts(), before)

    def test_ordinary_module_creation_still_works_before_cutover(self):
        response = self.call('post', self.payload('MOD-REGULAR-PUBLIC', isFreeCourse=False))
        self.assertEqual(response.status_code, 201, response.content)
        with connection.cursor() as cursor:
            cursor.execute('SELECT source_type FROM curriculum.modules WHERE module_catalogue_id=%s',
                           ['MOD-REGULAR-PUBLIC'])
            self.assertNotEqual(cursor.fetchone()[0], 'free_course')

    def assert_native(self, reference, response, status):
        self.assertEqual(response.status_code, status, response.content)
        data = json.loads(response.content)
        saved = data.get('module', data)
        self.assertTrue(saved['isFreeCourse'])
        self.assertEqual(saved['weekStructure'][0]['components'][0]['title'], 'Reading')
        with connection.cursor() as cursor:
            for table, ref in [('free_courses', reference), ('free_course_weeks', 'WEEK-' + reference),
                               ('free_programme_components', 'COMP-' + reference)]:
                cursor.execute(f'SELECT count(*) FROM curriculum.{table} WHERE content_ref=%s', [ref])
                self.assertEqual(cursor.fetchone()[0], 1, table)
            for table in schema.TABLES:
                cursor.execute(f'SELECT count(*) FROM curriculum.{table} WHERE module_catalogue_id=%s', [reference])
                self.assertEqual(cursor.fetchone()[0], 0, table)

    def test_migrated_post_creates_course_and_children_only_in_free_tables(self):
        schema.detach(connection)
        for i, kind in enumerate(({'isFreeCourse': True}, {'sourceType': 'free_course'}, {'source_type': 'free_course'})):
            reference = f'MOD-FREE-PUBLIC-{i}'
            with self.subTest(kind=kind):
                self.assert_native(reference, self.call('post', self.payload(reference, **kind)), 201)

    def test_migrated_first_structure_save_uses_only_free_tables(self):
        schema.detach(connection)
        payload = self.payload()
        self.assert_native(payload['catalogueId'], self.call('patch', payload), 200)

    def test_public_creation_does_not_require_ordinary_content_tables(self):
        schema.detach(connection)
        # Disposable database only: prove both public entry points remain
        # functional without any ordinary module/week/component storage.
        with connection.cursor() as cursor:
            for table in schema.TABLES:
                cursor.execute(f'DROP TABLE curriculum.{table} CASCADE')
        v._TABLE_COLUMNS_CACHE.clear()
        for method, expected in [('post', 201), ('patch', 200)]:
            payload = self.payload('MOD-NATIVE-' + method.upper())
            response = self.call(method, payload)
            self.assertEqual(response.status_code, expected, response.content)
            saved = json.loads(response.content)
            self.assertTrue(saved.get('module', saved)['isFreeCourse'])
            owner = store.course(payload['catalogueId'])
            self.assertIsNotNone(owner)
            with connection.cursor() as cursor:
                cursor.execute('''SELECT count(*) FROM curriculum.free_course_weeks w
                    JOIN curriculum.free_programme_components c ON c.free_module_id=w.id
                    WHERE w.course_id=%s''', [owner['id']])
                self.assertEqual(cursor.fetchone()[0], 1)

    def test_worker_observes_cutover_after_an_earlier_negative_read(self):
        self.assertFalse(store.enabled())
        # Simulate migration in a separate process: the application worker's
        # cache cannot rely on the migration resetting its local dictionary.
        with patch.object(store, 'reset'):
            schema.detach(connection)
        payload = self.payload()
        self.assert_native(payload['catalogueId'], self.call('post', payload), 201)
        self.assertTrue(store.enabled())

    def test_negative_readiness_cache_expires_for_catalogue_readers(self):
        with patch.object(store, 'monotonic', return_value=100):
            self.assertFalse(store.enabled())
        with patch.object(store, 'reset'):
            schema.detach(connection)
        with patch.object(store, 'monotonic', return_value=106):
            self.assertTrue(store.enabled())
