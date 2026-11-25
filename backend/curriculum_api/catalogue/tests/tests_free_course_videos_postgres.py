"""Canonical course -> durable queue -> mocked Bunny, on disposable PostgreSQL."""
import io
import json
import os
from contextlib import nullcontext
from copy import deepcopy
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import Mock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.test import RequestFactory, SimpleTestCase, override_settings

from curriculum_api.catalogue.tests import tests_free_course_soft_delete_postgres as fixtures
from curriculum_api.catalogue.api import free_course_authoring as documents
from curriculum_api.catalogue.api import free_course_mutations as mutations
from curriculum_api import video_imports as imports, video_uploads as uploads
from curriculum_api.models import CurriculumVideoChange, CurriculumVideoImport
from curriculum_api.video_changes import capture_pending
from learner_api.constants import ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING

MP4 = b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64
VIDEO_ID = 'c1c2c3c4-1234-5678-abcd-123456789abc'


@skipUnless(os.environ.get('FREE_COURSE_BUNNY_POSTGRES_TESTS') == '1', 'requires verified disposable PostgreSQL')
@override_settings(FREE_COURSE_AUTHORING_WRITE_MODE='canonical')
class FreeCourseVideoPostgresTests(SimpleTestCase):
    databases = {'default'}
    query = fixtures.FreeCourseSoftDeletePostgresTests.query
    rollback = fixtures.FreeCourseSoftDeletePostgresTests.rollback
    save = fixtures.FreeCourseSoftDeletePostgresTests.save
    replace_video = fixtures.FreeCourseSoftDeletePostgresTests.replace_video

    def setUp(self):
        fixtures.FreeCourseSoftDeletePostgresTests.setUp(self)
        CurriculumVideoChange.objects.all().delete()
        for mocked in (patch.object(imports, 'enabled', return_value=True),
                       patch.object(imports, 'wake_worker'),
                       patch.object(uploads.upload_storage, 'exists', return_value=False),
                       patch.object(uploads.upload_storage, 'store', side_effect=lambda _file, name, _mime: name)):
            mocked.start(); self.addCleanup(mocked.stop)
        self.factory = RequestFactory()

    def edit_source(self, source='https://example.test/new.mp4'):
        week = deepcopy(self.week)
        week['components'][0]['settings']['videoUrl'] = source
        return self.save(weeks=[week])

    def call(self, request, *, accesses=(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING), role='staff'):
        request._dont_enforce_csrf_checks = True
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role=role)), \
             patch('login.permissions._accesses_of', return_value=frozenset(accesses)):
            return imports.component_video(request, 'free_course', self.course_id, self.video['id'])

    def test_save_queues_changed_or_requested_video_once_and_retries_failure(self):
        self.save(course={'courseName': 'Metadata only'})
        self.assertFalse(CurriculumVideoImport.objects.exists())
        self.edit_source()
        asset = CurriculumVideoImport.objects.get()
        self.assertEqual((asset.target_kind, asset.target_id, asset.component_id), ('free_course', self.course_id, self.video['id']))
        self.assertEqual(asset.scope['collection_name'], 'Free course')
        self.assertEqual(asset.scope['free_course_id'], self.course_id)
        self.assertEqual(asset.scope['programme_id'], '')
        self.assertTrue(imports._matches_current_source(asset))
        capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)
        asset.status = 'failed'; asset.save()
        self.save(importVideoComponentIds=[self.video['id']])
        asset.refresh_from_db()
        self.assertEqual(asset.status, 'queued')
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_new_client_id_and_other_courses_do_not_share_imports(self):
        result = self.replace_video()
        asset = CurriculumVideoImport.objects.get()
        self.assertEqual(asset.component_id, result['clientIdMap']['components']['replacement:video'])
        self.assertNotEqual(asset.component_id, self.video['id'])
        self.assertFalse(imports.target('free_course', self.course_id)[1][0].get('module_catalogue_id'))
        with self.assertRaises(imports.VideoImportError):
            imports.target('free_course', 'FREECOURSE-OTHER')
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_create_only_queues_the_new_course_and_replay_does_not_duplicate_it(self):
        payload = {'expectedRevision': documents.catalogue_document(read_snapshot=False)['revision'],
                   'clientId': 'another:course', 'course': {'courseName': 'Another synthetic course'},
                   'weeks': [{'clientId': 'another:week', 'title': 'Week', 'components': [
                       {'clientId': 'another:video', 'type': 'video', 'title': 'Same name',
                        'settings': {'videoUrl': 'https://example.test/original'}}]}]}
        first = mutations.create_course(payload, staff_id=999999, idempotency_key='bunny:create:second')
        again = mutations.create_course(payload, staff_id=999999, idempotency_key='bunny:create:second')
        self.assertTrue(again['replayed'])
        asset = CurriculumVideoImport.objects.get()
        self.assertEqual(asset.target_id, first['body']['course']['courseId'])
        self.assertNotEqual(asset.target_id, self.course_id)
        with patch.object(uploads.upload_storage, 'store') as store:
            request = self.factory.post('/video/', {'file': SimpleUploadedFile('lesson.mp4', MP4), 'expectedRevision': self.document['revision']})
            response = imports._component_video(request, 'free_course', self.course_id, asset.component_id,
                                                expected_revision=self.document['revision'])
            self.assertEqual(response.status_code, 400)
            store.assert_not_called()

    def test_video_write_requires_csrf(self):
        request = self.factory.post('/video/', {'expectedRevision': self.document['revision']})
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')):
            response = imports.component_video(request, 'free_course', self.course_id, self.video['id'])
        self.assertEqual(response.status_code, 403)
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_actual_worker_uploads_to_shared_free_collection_and_keeps_source_and_progress_settings(self):
        self.edit_source()
        asset = CurriculumVideoImport.objects.get()
        before = documents.course_document(self.course_id, read_snapshot=False)
        client = Mock()
        client.free_course_collection.return_value = 'free-collection'
        client.find_import.return_value = None
        client.create.return_value = {'guid': VIDEO_ID}
        client.video.return_value = {'guid': VIDEO_ID, 'status': 4}
        with patch.object(imports, 'BunnyStream', return_value=client), \
             patch.object(imports, 'download_url'), \
             patch.object(imports, 'download_video', side_effect=lambda _url: nullcontext(io.BytesIO(MP4))):
            result = imports.process(asset.pk)
        self.assertEqual(result.status, 'ready')
        client.upload.assert_called_once()
        client.collection.assert_not_called()
        client.free_course_collection.assert_called_once()
        self.assertEqual(documents.course_document(self.course_id, read_snapshot=False), before)

    def test_mp4_uses_physical_identity_and_returns_next_revision(self):
        request = self.factory.post('/video/', {'file': SimpleUploadedFile('lesson.mp4', MP4), 'expectedRevision': self.document['revision']})
        response = self.call(request)
        self.assertEqual(response.status_code, 202, response.content)
        result = json.loads(response.content)
        self.assertNotEqual(result['course']['revision'], self.document['revision'])
        self.assertIn(f'/videos/free_course/{self.course_id}/{self.video["id"]}/', result['savedSettings']['videoUrl'])
        self.assertIsNotNone(uploads.stored_video_path(result['savedSettings']['videoUrl']))
        self.assertEqual(result['course']['weeks'][0]['components'][0]['expectedOtjh'], self.video['expectedOtjh'])
        self.assertEqual(result['import']['status'], 'queued')
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)
        capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_mp4_rejects_stale_revision_and_unavailable_storage_without_mutating_content(self):
        before = documents.course_document(self.course_id, read_snapshot=False)
        stale = self.factory.post('/video/', {'file': SimpleUploadedFile('lesson.mp4', MP4), 'expectedRevision': 'fcv1:' + '0' * 64})
        self.assertEqual(self.call(stale).status_code, 409)
        self.assertEqual(documents.course_document(self.course_id, read_snapshot=False), before)
        with patch.object(uploads.upload_storage, 'store', side_effect=RuntimeError('Unavailable')):
            failed = self.factory.post('/video/', {'file': SimpleUploadedFile('lesson.mp4', MP4), 'expectedRevision': before['revision']})
            self.assertEqual(self.call(failed).status_code, 400)
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_permissions_writer_gate_and_revision_required(self):
        read = self.factory.get('/video/')
        self.assertEqual(self.call(read, accesses=()).status_code, 403)
        self.assertEqual(self.call(read, role='learner').status_code, 403)
        self.assertEqual(self.call(read, accesses=(ACCESS_CURRICULUM,)).status_code, 200)
        write = self.factory.post('/video/', {'expectedRevision': self.document['revision']})
        self.assertEqual(self.call(write, accesses=(ACCESS_CURRICULUM,)).status_code, 403)
        self.assertEqual(self.call(self.factory.post('/video/', {})).status_code, 428)
        with override_settings(FREE_COURSE_AUTHORING_WRITE_MODE='frozen'):
            self.assertEqual(self.call(write).status_code, 503)
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_sql_capture_ignores_unchanged_archived_and_rolled_back_sources(self):
        self.query("UPDATE curriculum.free_programme_components SET title='Rename' WHERE id=%s", [self.video['id']])
        self.assertFalse(CurriculumVideoChange.objects.exists())
        with transaction.atomic():
            self.query("UPDATE curriculum.free_programme_components SET settings_json=jsonb_build_object('videoUrl','https://example.test/rolled-back.mp4') WHERE id=%s", [self.video['id']])
            self.assertEqual(CurriculumVideoChange.objects.count(), 1)
            transaction.set_rollback(True)
        self.assertFalse(CurriculumVideoChange.objects.exists())
        self.query("UPDATE curriculum.free_programme_components SET settings_json=jsonb_build_object('videoUrl','https://example.test/sql.mp4') WHERE id=%s", [self.video['id']])
        capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.get().target_id, self.course_id)
        self.query('UPDATE curriculum.free_programme_components SET deleted_at=now() WHERE id=%s', [self.video['id']])
        self.assertFalse(imports._matches_current_source(CurriculumVideoImport.objects.get()))
        self.query("UPDATE curriculum.free_programme_components SET settings_json=jsonb_build_object('videoUrl','https://example.test/archived.mp4') WHERE id=%s", [self.video['id']])
        self.assertFalse(CurriculumVideoChange.objects.exists())

    def test_failed_course_save_rolls_back_the_video_event_and_queue(self):
        week = deepcopy(self.week)
        week['components'][0]['settings']['videoUrl'] = 'https://example.test/no-save.mp4'
        week['components'][1]['displayOrder'] = 0
        with self.assertRaises(mutations.MutationError):
            self.save(weeks=[week])
        self.assertFalse(CurriculumVideoChange.objects.exists())
        self.assertFalse(CurriculumVideoImport.objects.exists())
