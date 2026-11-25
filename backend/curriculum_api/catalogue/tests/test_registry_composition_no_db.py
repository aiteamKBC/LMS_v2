"""Actual owner imports and synthetic revision/storage contracts; isolated runner only."""
import importlib
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views, learning_storage
from curriculum_api.catalogue.infrastructure import course_storage_reads as reads, course_storage_writes as writes, revision_runtime
from curriculum_api.catalogue.api import revision_adapters
from curriculum_api.catalogue.tests.parity.test_registry_composition_standalone import MANIFEST
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture


class RegistryCompositionRuntime(SimpleTestCase):
    def test_exports_reference_single_actual_owner(self):
        for name, module in MANIFEST['functions'].items():
            self.assertIs(getattr(views, name), getattr(importlib.import_module('curriculum_api.' + module), name), name)
        for owner, names in ((reads, ('course', 'free_rows', 'with_course_storage', 'read_sql')),
                             (writes, ('upsert', 'update', 'refresh_totals'))):
            for name in names:
                self.assertIs(getattr(learning_storage, name), getattr(owner, name))
        self.assertIs(views.CURRICULUM_RECORD_REVISIONS, revision_runtime.CURRICULUM_RECORD_REVISIONS)
        self.assertIs(revision_adapters.CURRICULUM_RECORD_REVISIONS, revision_runtime.CURRICULUM_RECORD_REVISIONS)

    def test_registry_order_unknown_and_failed_reader_preserved(self):
        self.assertEqual(list(revision_runtime.CURRICULUM_RECORD_REVISIONS), ['programme', 'cohort', 'group', 'module', 'weekTemplate'])
        with patch.dict(revision_runtime.CURRICULUM_RECORD_REVISIONS, {'module': Mock(side_effect=RuntimeError('synthetic'))}):
            self.assertEqual(revision_runtime.curriculum_record_revision('module', 'M'), '')
        self.assertEqual(revision_runtime.curriculum_record_revision('unknown', 'M'), '')

    def test_revision_endpoint_uses_current_owner_and_deduplicates_ids(self):
        request = RequestFactory().get('/curriculum/revisions/', {'module': ['M', 'M', 'N']})
        with patch.object(revision_adapters, 'curriculum_record_revision', side_effect=lambda kind, key: 'rev-' + key) as read:
            response = views.curriculum_record_revisions(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([call.args for call in read.call_args_list], [('module', 'M'), ('module', 'N')])
        self.assertIn(b'rev-M', response.content)

    def test_ordinary_row_lock_keeps_sql_and_params(self):
        db = Mock(vendor='postgresql')
        cursor = Mock()
        db.cursor.return_value.__enter__ = Mock(return_value=cursor)
        db.cursor.return_value.__exit__ = Mock(return_value=False)
        with patch.object(revision_runtime, 'connection', db), patch.object(revision_runtime, 'native_only', return_value=False), \
             patch.object(revision_runtime, 'table_name', return_value='curriculum.modules'):
            revision_runtime.lock_record_row('modules', 'id=%s', ('M',))
        cursor.execute.assert_called_once_with('select 1 from curriculum.modules where id=%s for update', ['M'])
        cursor.fetchall.assert_called_once_with()

    def test_native_row_locks_use_course_owner_without_ordinary_table_query(self):
        db = Mock(vendor='postgresql')
        with patch.object(revision_runtime, 'connection', db), patch.object(revision_runtime, 'native_only', return_value=True), \
             patch.object(reads, 'free_rows', return_value=[{'module_catalogue_id': 'FC'}]) as rows, \
             patch.object(reads, 'course') as course:
            revision_runtime.lock_record_row('modules', 'id=%s', ['M'])
        rows.assert_called_once_with('modules', 'id=%s', ['M'])
        course.assert_called_once_with('FC', lock=True)
        db.cursor.assert_not_called()

    def test_sqlite_lock_path_remains_noop(self):
        db = Mock(vendor='sqlite')
        with patch.object(revision_runtime, 'connection', db):
            revision_runtime.lock_record_row('modules', 'id=%s', ['M'])
        db.cursor.assert_not_called()

    def test_course_scope_resets_after_exception(self):
        from curriculum_api.catalogue.infrastructure.storage_context import native_only
        def fail(module_catalogue_id):
            self.assertTrue(native_only())
            raise ValueError('synthetic save refusal')
        with patch.object(reads, 'enabled', return_value=True), patch.object(reads, 'course', return_value={'id': 'FC'}):
            with self.assertRaisesRegex(ValueError, 'synthetic save refusal'):
                reads.with_course_storage(fail)('M')
        self.assertFalse(native_only())

    def test_fixture_injection_reaches_read_write_owners_and_restores_identity(self):
        original = learning_storage.course
        with composition_fixture(learning_storage, 'course', return_value=None) as fake:
            self.assertIs(reads.course, fake)
            self.assertIs(writes.course, fake)
        self.assertIs(reads.course, original)
        self.assertIs(writes.course, original)
