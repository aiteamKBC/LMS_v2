"""The stored-file list behind "use a file already uploaded in this module".

No database and no network: storage is an in-memory container, local disk is a
temporary MEDIA_ROOT.
"""
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase, override_settings

from curriculum_api import module_uploads, upload_storage
from curriculum_api.views import COMPONENT_UPLOAD_ROOT

PREFIX = '/curriculum_api/curriculum/uploads/'


class FakeContainer:
    def __init__(self, names, error=None):
        self.names = names
        self.error = error
        self.prefixes = []

    def list_blobs(self, name_starts_with=None):
        self.prefixes.append(name_starts_with)
        if self.error:
            raise self.error
        when = datetime(2026, 11, 8, 9, 0, tzinfo=timezone.utc)
        return [SimpleNamespace(name=name, size=size, last_modified=when)
                for name, size in self.names if name.startswith(name_starts_with or '')]


class ModuleUploadsTests(SimpleTestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(override.disable)

    def call(self, module_id, container=None, enabled=True, method='get'):
        request = getattr(RequestFactory(), method)(f'/curriculum_api/curriculum/module-uploads/{module_id}/')
        client = SimpleNamespace(get_container_client=lambda name: container)
        with mock.patch.object(upload_storage, 'azure_enabled', return_value=enabled), \
                mock.patch.object(upload_storage, 'container_name', return_value='curriculum-uploads'), \
                mock.patch.object(module_uploads.evidence_storage, '_service_client', return_value=client):
            response = module_uploads.module_uploaded_files(request, module_id)
        return response.status_code, json.loads(response.content)

    def test_lists_stored_files_for_the_module_only(self):
        container = FakeContainer([
            ('MOD-1/COMP-A/Handbook-20261108085803428328.pdf', 2048),
            ('MOD-1/COMP-B/deck-20261108085803428329.pptx', 4096),
            ('MOD-1/ai-material/book-20261108085803428330.pdf', 10),
            ('MOD-1/stray.pdf', 1),
            ('MOD-12/COMP-C/other-20261108085803428331.pdf', 1),
        ])
        status, body = self.call('MOD-1', container)
        self.assertEqual(status, 200)
        self.assertEqual(container.prefixes, ['MOD-1/'])
        by_url = {item['url']: item for item in body['files']}
        self.assertEqual(set(by_url), {
            f'{PREFIX}MOD-1/COMP-A/Handbook-20261108085803428328.pdf',
            f'{PREFIX}MOD-1/COMP-B/deck-20261108085803428329.pptx',
        })
        item = by_url[f'{PREFIX}MOD-1/COMP-A/Handbook-20261108085803428328.pdf']
        self.assertEqual(item['fileName'], 'Handbook.pdf')
        self.assertEqual(item['componentId'], 'COMP-A')
        self.assertEqual(item['size'], 2048)
        self.assertEqual(item['contentType'], 'application/pdf')
        self.assertFalse(body['truncated'])

    def test_includes_files_only_on_local_disk(self):
        folder = Path(self.media.name, COMPONENT_UPLOAD_ROOT, 'MOD-1', 'COMP-L')
        folder.mkdir(parents=True)
        (folder / 'old-20250101000000000000.docx').write_bytes(b'abc')
        renders = Path(self.media.name, COMPONENT_UPLOAD_ROOT, 'MOD-1', '_slide_renders')
        renders.mkdir()
        (renders / 'deck.json').write_text('{}')
        status, body = self.call('MOD-1', FakeContainer([]))
        self.assertEqual(status, 200)
        self.assertEqual([item['url'] for item in body['files']], [f'{PREFIX}MOD-1/COMP-L/old-20250101000000000000.docx'])
        self.assertEqual(body['files'][0]['fileName'], 'old.docx')
        self.assertEqual(body['files'][0]['size'], 3)

    def test_without_cloud_storage_only_local_disk_is_read(self):
        status, body = self.call('MOD-1', container=None, enabled=False)
        self.assertEqual((status, body['files']), (200, []))

    def test_a_storage_failure_is_reported_not_hidden(self):
        status, body = self.call('MOD-1', FakeContainer([], error=OSError('down')))
        self.assertEqual(status, 503)
        self.assertNotIn('files', body)

    def test_rejects_ids_that_are_not_an_upload_folder(self):
        for bad in ('..', 'MOD 1', 'a/b'):
            status, _ = self.call(bad, FakeContainer([]))
            self.assertEqual(status, 400, bad)

    def test_get_only(self):
        status, _ = self.call('MOD-1', FakeContainer([]), method='post')
        self.assertEqual(status, 405)
