"""Where a component upload's bytes go, and how they are found again.

    python manage.py test curriculum_api.tests_upload_storage

The Azure SDK is stubbed out — these tests pin the routing decisions, not the
SDK: which backend a path resolves to, that the stored URL is the same either
way, and that a local file is never trusted to be in Azure without proof. The
real round trip was exercised against the kbcdocs account by hand; what breaks
silently later is the routing, so that is what is pinned here.
"""
from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, SimpleTestCase, override_settings

from curriculum_api import upload_storage
from curriculum_api.management.commands.repoint_programme_audit_to_azure import (
    attachment_id_from_row, attachment_id_from_url, stable_urls,
)
from curriculum_api.views import (
    COMPONENT_UPLOAD_MAX_BYTES,
    COMPONENT_UPLOAD_ROOT,
    component_upload_metadata,
    parse_byte_range,
)

RELATIVE = f'{COMPONENT_UPLOAD_ROOT}/MOD-1/COMP-1/deck.pptx'


class UploadFailureResponseTests(SimpleTestCase):
    def setUp(self):
        self.client = Client()

    @patch('curriculum_api.views.component_upload_metadata', side_effect=OSError('storage unavailable'))
    def test_module_component_upload_returns_a_retryable_json_error(self, _metadata):
        response = self.client.post(
            '/curriculum_api/curriculum/components/COMP-1/upload/',
            {
                'componentType': 'powerpoint',
                'moduleCatalogueId': 'MOD-1',
                'file': SimpleUploadedFile('deck.pptx', b'fake-deck'),
            },
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['error'], 'The file could not be stored. Please retry the upload.')

    @patch('curriculum_api.views.component_upload_metadata', side_effect=OSError('storage unavailable'))
    def test_week_component_upload_returns_a_retryable_json_error(self, _metadata):
        response = self.client.post(
            '/curriculum_api/curriculum/week-components/COMP-1/upload/',
            {
                'componentType': 'powerpoint',
                'file': SimpleUploadedFile('deck.pptx', b'fake-deck'),
            },
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['error'], 'The file could not be stored. Please retry the upload.')


class ComponentUploadLimitTests(SimpleTestCase):
    @patch('curriculum_api.views.upload_storage.store')
    def test_file_over_limit_is_rejected_before_storage(self, store):
        # Set .size past the cap rather than allocating a 300 MB buffer in memory.
        uploaded = SimpleUploadedFile('large-deck.pptx', b'x')
        uploaded.size = COMPONENT_UPLOAD_MAX_BYTES + 1

        metadata, error = component_upload_metadata('MOD-1', 'COMP-1', 'powerpoint', uploaded)

        self.assertIsNone(metadata)
        self.assertEqual(error, 'File is too large. Maximum upload size is 300 MB.')
        store.assert_not_called()

    @patch('curriculum_api.views.upload_storage.store', return_value=RELATIVE)
    def test_every_upload_component_type_uses_the_shared_storage_path(self, store):
        cases = {
            'reading': 'guide.docx',
            'podcast': 'episode.mp3',
            'powerpoint': 'deck.pptx',
            'assignment': 'brief.pdf',
        }

        for component_type, filename in cases.items():
            with self.subTest(component_type=component_type):
                uploaded = SimpleUploadedFile(filename, b'component-bytes')
                metadata, error = component_upload_metadata(
                    'MOD-1', f'COMP-{component_type}', component_type, uploaded,
                )
                self.assertEqual(error, '')
                self.assertEqual(metadata['componentType'], component_type)
                self.assertEqual(metadata['fileName'], filename)

        self.assertEqual(store.call_count, len(cases))


class BlobNameTests(SimpleTestCase):
    def test_the_upload_root_is_dropped_because_the_container_replaces_it(self):
        self.assertEqual(upload_storage.blob_name_for(RELATIVE), 'MOD-1/COMP-1/deck.pptx')
        # Already-relative names and stray slashes both survive unchanged.
        self.assertEqual(upload_storage.blob_name_for('MOD-1/COMP-1/deck.pptx'), 'MOD-1/COMP-1/deck.pptx')
        self.assertEqual(upload_storage.blob_name_for(f'/{RELATIVE}/'), 'MOD-1/COMP-1/deck.pptx')

    def test_the_stored_url_does_not_depend_on_where_the_bytes_are(self):
        """Every settings_json reference already in the database keeps working."""
        self.assertEqual(
            upload_storage.upload_url(RELATIVE),
            '/curriculum_api/curriculum/uploads/MOD-1/COMP-1/deck.pptx',
        )


class ProgrammeAuditAzureMappingTests(SimpleTestCase):
    def test_reads_attachment_id_from_a_stable_azure_upload_path(self):
        self.assertEqual(
            attachment_id_from_url(
                '/curriculum_api/curriculum/uploads/_legacy_files/137315/handout.pdf'
            ),
            '137315',
        )

    def test_reads_attachment_id_from_an_office_wrapped_wordpress_url(self):
        wrapped = (
            'https://view.officeapps.live.com/op/embed.aspx?src='
            'https%3A%2F%2Fkentbusinesscollege.org%2Fwp-json%2Fkbc-lms%2Fv1%2F'
            'material%2F43%2Fview%3Fattachment_id%3D42%26token%3Dsecret'
        )
        self.assertEqual(attachment_id_from_url(wrapped), '42')

    def test_raw_component_keeps_the_mapping_idempotent_after_repointing(self):
        raw = {'reading': {'iframe_url': 'https://example.test/view?attachment_id=42'}}
        self.assertEqual(attachment_id_from_row('/curriculum_api/new.pdf', raw), '42')
        self.assertEqual(
            attachment_id_from_row(
                '/curriculum_api/new.pdf',
                '{"reading":{"iframe_url":"https://example.test/view?attachment_id=42"}}',
            ),
            '42',
        )

    def test_office_files_use_preview_but_pdf_files_embed_directly(self):
        pdf = stable_urls('_legacy_files/42/handout.pdf')
        deck = stable_urls('_legacy_files/43/deck.pptx')
        self.assertEqual(pdf[0], pdf[1])
        self.assertEqual(deck[1], f'{deck[0]}?preview=1')


class LocalBackendTests(SimpleTestCase):
    """With no Azure credentials the module behaves exactly as before."""

    def setUp(self):
        self._directory = TemporaryDirectory()
        self.addCleanup(self._directory.cleanup)
        self.media = Path(self._directory.name)

    def local(self):
        return override_settings(MEDIA_ROOT=self.media, AZURE_STORAGE_ACCOUNT='', AZURE_STORAGE_KEY='')

    def test_uploads_go_to_disk_and_are_found_there(self):
        with self.local():
            self.assertFalse(upload_storage.azure_enabled())
            saved = upload_storage.store(SimpleUploadedFile('deck.pptx', b'deck-bytes'), RELATIVE)
            self.assertTrue(upload_storage.exists(saved))
            stream, size, _content_type = upload_storage.open_stream(saved)
            self.assertEqual(b''.join(stream), b'deck-bytes')
            self.assertEqual(size, len('deck-bytes'))

    def test_a_missing_file_reports_missing_rather_than_raising(self):
        with self.local():
            self.assertFalse(upload_storage.exists(RELATIVE))
            self.assertIsNone(upload_storage.open_stream(RELATIVE))
            self.assertIsNone(upload_storage.content_stamp(RELATIVE))
            path, cleanup = upload_storage.local_copy(RELATIVE)
            self.assertIsNone(path)
            cleanup()  # must be safe to call even when nothing was copied

    def test_a_local_file_is_never_copied_or_deleted_by_local_copy(self):
        with self.local():
            upload_storage.store(SimpleUploadedFile('deck.pptx', b'deck-bytes'), RELATIVE)
            path, cleanup = upload_storage.local_copy(RELATIVE)
            cleanup()
            self.assertTrue(path.is_file(), 'cleanup deleted the original file')

    def test_a_path_that_escapes_the_media_root_resolves_to_nothing(self):
        with self.local():
            self.assertIsNone(upload_storage.local_path(f'{COMPONENT_UPLOAD_ROOT}/../../secrets.env'))

    def test_the_stamp_changes_when_the_bytes_change(self):
        with self.local():
            upload_storage.store(SimpleUploadedFile('deck.pptx', b'one'), RELATIVE)
            first = upload_storage.content_stamp(RELATIVE)
            path = upload_storage.local_path(RELATIVE)
            path.write_bytes(b'different length')
            self.assertNotEqual(first, upload_storage.content_stamp(RELATIVE))


class FakeBlobClient:
    """Just enough of the SDK's blob client for the routing tests."""

    def __init__(self, store, blob):
        self.store = store
        self.blob = blob

    class _Properties:
        def __init__(self, size, content_type, etag):
            self.size = size
            self.content_settings = type('CS', (), {'content_type': content_type})()
            self.etag = etag

    def exists(self, **_kwargs):
        return self.blob in self.store

    def get_blob_properties(self):
        if self.blob not in self.store:
            raise KeyError(self.blob)
        return self._Properties(len(self.store[self.blob]), 'application/octet-stream', 'etag-1')

    def upload_blob(self, data, overwrite=True, **_kwargs):
        payload = data.read() if hasattr(data, 'read') else bytes(data)
        self.store[self.blob] = payload
        return {'etag': 'etag-1'}

    def download_blob(self, offset=0, length=None):
        payload = self.store[self.blob]
        end = len(payload) if length is None else (offset or 0) + length
        payload = payload[offset or 0:end]

        class Downloader:
            def chunks(self_inner):
                yield payload

            def readall(self_inner):
                return payload

            def readinto(self_inner, handle):
                handle.write(payload)
                return len(payload)

        return Downloader()


class FakeServiceClient:
    def __init__(self, store):
        self.store = store

    def get_blob_client(self, container, blob):
        return FakeBlobClient(self.store, blob)

    def get_container_client(self, _container):
        store = self.store

        class Container:
            def exists(self_inner, **_kwargs):
                return True

            def create_container(self_inner, **_kwargs):
                store.setdefault('__created__', b'')

        return Container()


class AzureBackendTests(SimpleTestCase):
    def setUp(self):
        self._directory = TemporaryDirectory()
        self.addCleanup(self._directory.cleanup)
        self.media = Path(self._directory.name)
        self.blobs = {}
        patcher = patch(
            'curriculum_api.upload_storage.evidence_storage._service_client',
            return_value=FakeServiceClient(self.blobs),
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def azure(self):
        return override_settings(
            MEDIA_ROOT=self.media,
            AZURE_STORAGE_ACCOUNT='kbcdocs',
            AZURE_STORAGE_KEY='key',
            AZURE_CURRICULUM_CONTAINER='curriculum-uploads',
        )

    def test_an_upload_goes_to_the_container_and_not_to_disk(self):
        with self.azure():
            upload_storage.store(SimpleUploadedFile('deck.pptx', b'deck-bytes'), RELATIVE)
            self.assertEqual(self.blobs['MOD-1/COMP-1/deck.pptx'], b'deck-bytes')
            self.assertIsNone(upload_storage.local_path(RELATIVE).exists() or None)

    @patch('curriculum_api.upload_storage.evidence_storage.upload_blob')
    def test_curriculum_uploads_request_small_azure_blocks(self, upload_blob):
        with self.azure():
            upload_storage.store(SimpleUploadedFile('deck.pptx', b'deck-bytes'), RELATIVE)

        self.assertEqual(upload_blob.call_args.kwargs['upload_block_bytes'], 256 * 1024)
        self.assertEqual(upload_blob.call_args.kwargs['max_concurrency'], 1)
        self.assertEqual(upload_blob.call_args.kwargs['retry_total'], 1)
        self.assertTrue(upload_blob.call_args.kwargs['overwrite'])

    @patch('curriculum_api.upload_storage.ensure_container')
    @patch('curriculum_api.upload_storage.evidence_storage.upload_blob')
    def test_a_transient_failure_rewinds_and_retries_the_same_upload(self, upload_blob, _ensure):
        upload_blob.side_effect = [TimeoutError('slow'), TimeoutError('slow again'), None]
        uploaded = SimpleUploadedFile('guide.docx', b'reading-material')

        with self.azure():
            saved = upload_storage.store(uploaded, RELATIVE, 'application/octet-stream')

        self.assertEqual(saved, RELATIVE)
        self.assertEqual(upload_blob.call_count, 3)
        self.assertEqual([call.args[0].tell() for call in upload_blob.call_args_list], [0, 0, 0])

    @patch('curriculum_api.upload_storage.evidence_storage._service_client')
    def test_container_check_is_cached_and_has_a_bounded_timeout(self, service_client):
        container = service_client.return_value.get_container_client.return_value
        container.exists.return_value = True
        key = ('kbcdocs', 'curriculum-uploads')
        upload_storage._ready_containers.discard(key)

        with self.azure():
            upload_storage.ensure_container()
            upload_storage.ensure_container()

        container.exists.assert_called_once_with(connection_timeout=30, read_timeout=30)

    def test_reads_fall_back_to_the_container(self):
        with self.azure():
            self.blobs['MOD-1/COMP-1/deck.pptx'] = b'deck-bytes'
            self.assertTrue(upload_storage.exists(RELATIVE))
            stream, size, content_type = upload_storage.open_stream(RELATIVE)
            self.assertEqual(b''.join(stream), b'deck-bytes')
            self.assertEqual(size, len(b'deck-bytes'))
            self.assertEqual(content_type, 'application/octet-stream')

    def test_local_disk_still_wins_so_older_uploads_keep_working(self):
        """Files uploaded before the move, and the render cache, stay readable."""
        with self.azure():
            path = upload_storage.local_path(RELATIVE)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'on-disk')
            self.blobs['MOD-1/COMP-1/deck.pptx'] = b'in-azure'
            stream, _size, _content_type = upload_storage.open_stream(RELATIVE)
            self.assertEqual(b''.join(stream), b'on-disk')

    def test_a_copy_is_made_for_disk_only_readers_and_then_removed(self):
        with self.azure():
            self.blobs['MOD-1/COMP-1/deck.pptx'] = b'deck-bytes'
            path, cleanup = upload_storage.local_copy(RELATIVE)
            self.assertTrue(path.is_file())
            self.assertEqual(path.read_bytes(), b'deck-bytes')
            self.assertEqual(path.suffix, '.pptx', 'python-pptx needs the extension')
            cleanup()
            self.assertFalse(path.exists(), 'the temporary copy was left behind')

    def test_a_range_is_fetched_as_a_range_not_as_the_whole_blob(self):
        with self.azure():
            self.blobs['MOD-1/COMP-1/deck.pptx'] = bytes(range(64))
            stream, total, _content_type = upload_storage.open_stream(RELATIVE, offset=8, length=4)
            self.assertEqual(b''.join(stream), bytes(range(8, 12)))
            self.assertEqual(total, 64, 'the total size is the whole blob, not the slice')

    def test_the_stamp_identifies_the_blob_not_the_temporary_copy(self):
        """Otherwise every request re-renders: a fresh copy has a fresh mtime."""
        with self.azure():
            self.blobs['MOD-1/COMP-1/deck.pptx'] = b'deck-bytes'
            first = upload_storage.content_stamp(RELATIVE)
            upload_storage.local_copy(RELATIVE)
            self.assertEqual(first, upload_storage.content_stamp(RELATIVE))
            self.assertTrue(first.startswith('azure:'))

    def test_migrating_returns_the_size_azure_reports(self):
        """The migration deletes a local file only on this number matching."""
        with self.azure():
            path = upload_storage.local_path(RELATIVE)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'0123456789')
            self.assertEqual(upload_storage.copy_local_to_azure(RELATIVE), 10)
            self.assertEqual(self.blobs['MOD-1/COMP-1/deck.pptx'], b'0123456789')

    def test_migrating_a_file_that_is_not_there_is_an_error_not_a_silent_pass(self):
        with self.azure():
            with self.assertRaises(FileNotFoundError):
                upload_storage.copy_local_to_azure(RELATIVE)


class ByteRangeTests(SimpleTestCase):
    """Seeking a podcast or paging a PDF is a byte-range request."""

    def test_reads_the_forms_clients_send(self):
        self.assertEqual(parse_byte_range('bytes=0-99', 1000), (0, 100))
        self.assertEqual(parse_byte_range('bytes=500-', 1000), (500, 500))
        self.assertEqual(parse_byte_range('bytes=-100', 1000), (900, 100))
        # An end past the file is clamped, not refused.
        self.assertEqual(parse_byte_range('bytes=900-5000', 1000), (900, 100))

    def test_ignores_what_it_does_not_handle_so_the_whole_file_is_served(self):
        for header in (None, '', 'items=0-9', 'bytes=0-9,20-29', 'bytes=abc-def', 'bytes=nonsense'):
            self.assertIsNone(parse_byte_range(header, 1000), header)

    def test_rejects_a_range_that_cannot_be_satisfied(self):
        self.assertEqual(parse_byte_range('bytes=1000-', 1000), 'unsatisfiable')
        self.assertEqual(parse_byte_range('bytes=900-800', 1000), 'unsatisfiable')
        self.assertEqual(parse_byte_range('bytes=-0', 1000), 'unsatisfiable')


class RangeServingTests(SimpleTestCase):
    """The uploads route, end to end, over a local file."""

    def setUp(self):
        self._directory = TemporaryDirectory()
        self.addCleanup(self._directory.cleanup)
        self.media = Path(self._directory.name)
        self.payload = bytes(range(256)) * 8  # 2048 bytes
        path = self.media / COMPONENT_UPLOAD_ROOT / 'MOD-1' / 'COMP-1' / 'audio.mp3'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.payload)
        self.url = '/curriculum_api/curriculum/uploads/MOD-1/COMP-1/audio.mp3'
        self.client = Client()

    def local(self):
        return override_settings(
            MEDIA_ROOT=self.media, AZURE_STORAGE_ACCOUNT='', AZURE_STORAGE_KEY='',
        )

    def test_a_whole_file_is_served_with_ranges_advertised(self):
        with self.local():
            response = self.client.get(self.url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Accept-Ranges'], 'bytes')
            self.assertEqual(b''.join(response.streaming_content), self.payload)

    def test_a_range_comes_back_as_exactly_those_bytes(self):
        with self.local():
            response = self.client.get(self.url, headers={'range': 'bytes=100-199'})
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response['Content-Range'], f'bytes 100-199/{len(self.payload)}')
            self.assertEqual(response['Content-Length'], '100')
            self.assertEqual(b''.join(response.streaming_content), self.payload[100:200])

    def test_the_tail_of_a_file_can_be_asked_for_by_suffix(self):
        with self.local():
            response = self.client.get(self.url, headers={'range': 'bytes=-64'})
            self.assertEqual(response.status_code, 206)
            self.assertEqual(b''.join(response.streaming_content), self.payload[-64:])

    def test_a_range_past_the_end_is_refused_with_the_real_size(self):
        with self.local():
            response = self.client.get(self.url, headers={'range': 'bytes=99999-'})
            self.assertEqual(response.status_code, 416)
            self.assertEqual(response['Content-Range'], f'bytes */{len(self.payload)}')

    def test_a_traversal_path_is_a_404_not_a_500(self):
        with self.local():
            response = self.client.get('/curriculum_api/curriculum/uploads/../../secrets.env')
            self.assertIn(response.status_code, (301, 404))


class OfficePreviewTests(SimpleTestCase):
    """Office uploads get an iframe page without persisting an Azure token."""

    def setUp(self):
        self.client = Client()
        self.url = '/curriculum_api/curriculum/uploads/_legacy_files/42/deck.pptx?preview=1'

    @patch('curriculum_api.views.upload_storage.signed_read_url')
    @patch('curriculum_api.views.upload_storage.exists', return_value=True)
    def test_preview_wraps_a_short_lived_azure_url_in_office_online(
        self, _exists, signed_read_url,
    ):
        signed_read_url.return_value = (
            'https://kbcdocs.blob.core.windows.net/curriculum-uploads/'
            '_legacy_files/42/deck.pptx?sig=short-lived'
        )

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(response['X-Frame-Options'], 'SAMEORIGIN')
        self.assertIn('https://view.officeapps.live.com/op/embed.aspx?src=', response.content.decode())
        self.assertIn('sig%3Dshort-lived', response.content.decode())

    @patch('curriculum_api.views.upload_storage.exists', return_value=False)
    def test_a_missing_office_upload_is_a_404(self, _exists):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 404)
