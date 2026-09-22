"""The module's AI Material book: upload, replace, preview.

    python manage.py test curriculum_api.tests_ai_material

No database. The authoring row is a two-function seam — ``authoring_fetch_all``
and ``authoring_upsert`` — so it is stubbed with a dict here and the tests stay
`SimpleTestCase`, in line with this repository's standing restriction on
database-provisioning test runs. What is pinned is the view's own decisions, and
those are what break silently:

* a *replace* points the record at the new bytes and deletes only the file it
  replaced -- a replace that left the record on the file it just deleted reads
  as a working upload right up until someone opens the book;
* a *failed* upload leaves the previous book recorded and readable;
* the *bytes* go to the Azure curriculum container through ``upload_storage``,
  like every other authoring upload, and the record still stores the stable LMS
  path rather than a storage URL;
* the *preview* is the existing uploads route, framed same-origin, serving the
  file back with its own content type and byte ranges.

The Azure SDK is stubbed throughout: this is about routing, not about the SDK.
"""
from __future__ import annotations

from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, SimpleTestCase, override_settings

from curriculum_api import upload_storage, views

MODULE_ID = 'MOD-AIMAT-1'
AI_MATERIAL_URL = f'/curriculum_api/curriculum/modules/{MODULE_ID}/ai-material/'
PDF_BYTES = b'%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n'


def book(name='handbook.pdf', payload=PDF_BYTES, content_type='application/pdf'):
    return SimpleUploadedFile(name, payload, content_type=content_type)


class FakeModuleDetails:
    """The one ``curriculum.module_details`` row the view reads and writes.

    ``authoring_upsert`` merges the keys it is given and leaves every other
    column alone, which is the property the AI material relies on to survive a
    module save. The stub reproduces exactly that.
    """

    def __init__(self):
        self.rows = {}

    def fetch_all(self, table, where_sql='', params=None, **kwargs):
        assert table == views.AUTHORING_ADVANCED_TABLE, table
        row = self.rows.get((params or [''])[0])
        return [row] if row else []

    def upsert(self, table, key_columns, payload, allow_null_columns=None):
        assert table == views.AUTHORING_ADVANCED_TABLE, table
        key = payload['module_catalogue_id']
        row = dict(self.rows.get(key) or {})
        row.update({name: value for name, value in payload.items() if value is not None})
        self.rows[key] = row
        return row


class AiMaterialTestCase(SimpleTestCase):
    """Local-disk storage: no Azure credentials, so uploads land in MEDIA_ROOT."""

    def setUp(self):
        self.details = FakeModuleDetails()
        self.media = TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        stack = ExitStack()
        self.addCleanup(stack.close)
        # Explicitly credential-free: this machine's .env holds real kbcdocs
        # credentials, and without this the "local disk" cases would upload
        # their fixtures to the live container. Azure is switched on only in
        # AiMaterialAzureRoutingTests, where the SDK is stubbed.
        stack.enter_context(override_settings(
            MEDIA_ROOT=self.media.name,
            AZURE_STORAGE_ACCOUNT='',
            AZURE_STORAGE_KEY='',
            AZURE_CURRICULUM_CONTAINER='',
        ))
        self.assertFalse(upload_storage.azure_enabled())
        stack.enter_context(patch.object(views, 'ensure_module_authoring_tables'))
        stack.enter_context(patch.object(views, 'has_column', return_value=True))
        stack.enter_context(patch.object(views, 'invalidate_curriculum_cache'))
        stack.enter_context(patch.object(views, 'authoring_fetch_all', self.details.fetch_all))
        stack.enter_context(patch.object(views, 'authoring_upsert', self.details.upsert))
        self.client = Client()

    def upload(self, uploaded=None):
        return self.client.post(AI_MATERIAL_URL, {'file': uploaded or book()})


class AiMaterialRecordTests(AiMaterialTestCase):
    def test_a_module_with_no_book_reports_none(self):
        response = self.client.get(AI_MATERIAL_URL)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['hasMaterial'])
        self.assertIsNone(response.json()['material'])

    def test_upload_then_read_the_book_back(self):
        response = self.upload()
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertTrue(payload['uploaded'])
        self.assertFalse(payload['replaced'])
        self.assertEqual(payload['material']['fileName'], 'handbook.pdf')
        self.assertEqual(payload['material']['size'], len(PDF_BYTES))
        self.assertEqual(payload['material']['contentType'], 'application/pdf')
        self.assertTrue(payload['material']['url'].startswith('/curriculum_api/curriculum/uploads/'))
        # A second request re-reads the stored row rather than any in-memory copy.
        self.assertEqual(self.client.get(AI_MATERIAL_URL).json()['material'], payload['material'])

    def test_a_non_book_format_is_refused_and_nothing_is_recorded(self):
        response = self.client.post(AI_MATERIAL_URL, {
            'file': book('slides.pptx', b'PK\x03\x04', 'application/vnd.ms-powerpoint'),
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn('must use one of', response.json()['error'])
        self.assertFalse(self.client.get(AI_MATERIAL_URL).json()['hasMaterial'])

    def test_a_request_with_no_file_is_refused(self):
        response = self.client.post(AI_MATERIAL_URL, {})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'No file was uploaded.')

    def test_replacing_points_the_record_at_the_new_book_and_drops_the_old_bytes(self):
        first = self.upload(book('first.pdf')).json()['material']
        second = self.upload(book('second.pdf', PDF_BYTES + b'second\n')).json()
        self.assertTrue(second['replaced'])
        self.assertEqual(second['material']['fileName'], 'second.pdf')
        self.assertNotEqual(second['material']['storedPath'], first['storedPath'])
        self.assertEqual(self.client.get(AI_MATERIAL_URL).json()['material'], second['material'])
        self.assertFalse(upload_storage.exists(first['storedPath']))
        self.assertTrue(upload_storage.exists(second['material']['storedPath']))

    def test_a_failed_replace_leaves_the_previous_book_recorded_and_readable(self):
        original = self.upload(book('first.pdf')).json()['material']
        with patch.object(views, 'component_upload_metadata', side_effect=OSError('storage unavailable')):
            failed = self.upload(book('second.pdf'))
        self.assertEqual(failed.status_code, 503)
        self.assertEqual(self.client.get(AI_MATERIAL_URL).json()['material'], original)
        self.assertTrue(upload_storage.exists(original['storedPath']))

    def test_a_book_that_cannot_be_recorded_does_not_leave_bytes_behind(self):
        with patch.object(views, 'authoring_upsert', side_effect=RuntimeError('database down')), \
                patch.object(upload_storage, 'delete') as delete:
            response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(delete.call_count, 1)

    def test_removing_clears_the_record_and_the_bytes(self):
        material = self.upload().json()['material']
        removed = self.client.delete(AI_MATERIAL_URL)
        self.assertEqual(removed.status_code, 200)
        self.assertTrue(removed.json()['removed'])
        self.assertFalse(self.client.get(AI_MATERIAL_URL).json()['hasMaterial'])
        self.assertFalse(upload_storage.exists(material['storedPath']))

    def test_removing_when_there_is_no_book_is_not_an_error(self):
        response = self.client.delete(AI_MATERIAL_URL)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['removed'])

    def test_a_module_save_does_not_wipe_the_book(self):
        """``module_details`` is written on every module save; the book must survive."""
        material = self.upload().json()['material']
        self.details.upsert(views.AUTHORING_ADVANCED_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': MODULE_ID,
            'background': 'Rewritten by a module save.',
            'intent': 'Something else entirely.',
        })
        self.assertEqual(self.client.get(AI_MATERIAL_URL).json()['material'], material)

    def test_an_unprovisioned_column_is_reported_rather_than_silently_dropping_the_book(self):
        with patch.object(views, 'has_column', return_value=False):
            response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertIn('ai_material', response.json()['error'])


class AiMaterialPreviewTests(AiMaterialTestCase):
    def test_the_recorded_url_serves_the_book_back_framed_same_origin(self):
        material = self.upload().json()['material']
        served = self.client.get(material['url'])
        self.assertEqual(served.status_code, 200)
        self.assertEqual(b''.join(served.streaming_content), PDF_BYTES)
        self.assertEqual(served['Content-Type'], 'application/pdf')
        self.assertEqual(served['Accept-Ranges'], 'bytes')
        # DENY here would leave the dialog's viewer blank.
        self.assertEqual(served['X-Frame-Options'], 'SAMEORIGIN')

    def test_the_preview_serves_a_byte_range_so_a_reader_can_page_through(self):
        material = self.upload().json()['material']
        served = self.client.get(material['url'], HTTP_RANGE='bytes=4-9')
        self.assertEqual(served.status_code, 206)
        self.assertEqual(b''.join(served.streaming_content), PDF_BYTES[4:10])
        self.assertEqual(served['Content-Range'], f'bytes 4-9/{len(PDF_BYTES)}')

    def test_a_word_book_is_previewed_through_the_office_viewer(self):
        material = self.upload(book(
            'handbook.docx', b'PK\x03\x04word',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )).json()['material']
        served = self.client.get(material['url'], {'preview': '1'})
        self.assertEqual(served.status_code, 200)
        self.assertIn(b'view.officeapps.live.com', served.content)


class AiMaterialAzureRoutingTests(AiMaterialTestCase):
    """With Azure configured the bytes go to the container, not to local disk."""

    @override_settings(
        AZURE_STORAGE_ACCOUNT='kbcdocs',
        AZURE_STORAGE_KEY='test-key',
        AZURE_CURRICULUM_CONTAINER='curriculum-uploads',
    )
    def test_the_book_is_uploaded_to_the_curriculum_container(self):
        with patch.object(upload_storage, 'ensure_container'), \
                patch('learner_api.evidence_storage.upload_blob') as upload_blob:
            self.assertTrue(upload_storage.azure_enabled())
            response = self.upload()

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(upload_blob.call_count, 1)
        _stream, container, blob_name, content_type = upload_blob.call_args.args
        self.assertEqual(container, 'curriculum-uploads')
        self.assertEqual(content_type, 'application/pdf')
        # The blob sits under the module, in its own AI-material folder, and
        # nothing was written to this machine's disk.
        self.assertTrue(blob_name.startswith(f'{MODULE_ID}/{views.AI_MATERIAL_UPLOAD_SLOT}/'))
        self.assertTrue(blob_name.endswith('.pdf'))
        self.assertEqual(list(Path(self.media.name).rglob('*.pdf')), [])

        # The record keeps the stable LMS path, never a storage URL.
        self.assertEqual(
            response.json()['material']['url'],
            f'/curriculum_api/curriculum/uploads/{MODULE_ID}/'
            f'{views.AI_MATERIAL_UPLOAD_SLOT}/{Path(blob_name).name}',
        )

    @override_settings(
        AZURE_STORAGE_ACCOUNT='kbcdocs',
        AZURE_STORAGE_KEY='test-key',
        AZURE_CURRICULUM_CONTAINER='curriculum-uploads',
    )
    def test_replacing_deletes_the_old_blob_from_the_container(self):
        with patch.object(upload_storage, 'ensure_container'), \
                patch('learner_api.evidence_storage.upload_blob'), \
                patch('learner_api.evidence_storage.blob_exists', return_value=False), \
                patch('learner_api.evidence_storage.delete_blob') as delete_blob:
            first = self.upload(book('first.pdf')).json()['material']
            self.upload(book('second.pdf'))

        self.assertEqual(delete_blob.call_count, 1)
        _container, deleted = delete_blob.call_args.args
        self.assertEqual(deleted, upload_storage.blob_name_for(first['storedPath']))
