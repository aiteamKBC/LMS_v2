"""Isolated transfer planning and content safety tests; no DB or live services."""
import importlib.util
import hashlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from collections import Counter
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('migration', Path(__file__).with_name('migrate_wordpress_media.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class WordPressMigrationTests(unittest.TestCase):
    host = 'source.example'

    def test_attachment_keys_ignore_temporary_tokens_and_unwrap_office(self):
        first = 'https://source.example/wp-json/kbc-lms/v1/material/1/view?attachment_id=9&token=old'
        second = 'https://view.officeapps.live.com/op/embed.aspx?src=' + m.quote(first, safe='')
        self.assertEqual(m.source_key(first, self.host), 'attachment:9')
        self.assertEqual(m.source_key(second, self.host), 'attachment:9')
        self.assertEqual(m.source_key(first.replace('/view?', '/embed?'), self.host), 'attachment:9')
        self.assertEqual(m.source_key(first.replace('source.example', 'outside.example'), self.host), '')
        self.assertEqual(m.source_key(first.replace('source.example', 'user@source.example'), self.host), '')

    def test_source_urls_do_not_authorize_other_origins_or_attachment_pages(self):
        self.assertEqual(m.source_key('https://source.example/lesson/?attachment_id=9', self.host)[:5], 'page:')
        self.assertEqual(m.source_key('https://outside.example/wp-content/uploads/video.mp4', self.host), '')

    def test_wordpress_audio_player_resolves_to_its_exact_migrated_attachment(self):
        url = 'https://source.example/wp-json/kbc-lms/v1/material/12/embed?attachment_id=9&token=old'
        local = m.PREFIX + '_legacy_files/9/podcast.mp3'
        row = {'content_type': 'podcast', 'audio_iframe_url': url,
               'payload': {'iframe_url': url, 'completion': {'threshold': 80}}}
        fields, payload = m.material_patch(row, {'attachment:9': {'url': local}}, self.host, [])
        self.assertEqual(fields, {'audio_iframe_url': local})
        self.assertEqual(payload, {'iframe_url': local})
        self.assertEqual(row['payload']['completion'], {'threshold': 80})

    def test_office_pdf_replacement_uses_local_preview_url(self):
        url = 'https://source.example/wp-json/kbc-lms/v1/material/1/view?attachment_id=9&token=old'
        viewer = 'https://view.officeapps.live.com/op/embed.aspx?src=' + m.quote(url, safe='')
        local = m.PREFIX + '_legacy_files/9/file.pdf'
        self.assertEqual(m.replace_urls(viewer, {'attachment:9': {'url': local}}, self.host), local)

    def test_html_escaped_source_tokens_and_other_providers(self):
        content = '<img src="https://source.example/wp-content/uploads/image.png?v=1&amp;x=2">'
        key = m.source_key('https://source.example/wp-content/uploads/image.png', self.host)
        result = m.replace_urls(content, {key: {'url': '/local/image.png'}}, self.host)
        self.assertEqual(result, '<img src="/local/image.png">')
        self.assertEqual(m.replace_urls('https://youtube.com/watch?v=9', {}, self.host), 'https://youtube.com/watch?v=9')

    def test_patch_preserves_quiz_history_unknown_fields_and_other_lesson_links(self):
        url = 'https://source.example/stm-lessons/one/'
        other = 'https://source.example/stm-lessons/two/'
        row = {'content_type': 'video', 'source_url': url, 'video_iframe_url': url, 'audio_iframe_url': '', 'reading_iframe_url': other,
               'payload': {'quiz': {'questions': [{'correct': 'retained'}]}, 'completed': True,
                           'iframe_url': url, 'custom': {'keep': 1}}}
        mapping = {m.source_key(url, self.host): {'url': '/reading.html', 'inline': True}}
        fields, patch = m.material_patch(row, mapping, self.host, [], '<p>Lesson</p>')
        self.assertEqual(fields, {'source_url': '', 'video_iframe_url': ''})
        self.assertEqual(patch, {'iframe_url': '', 'reading_text_body': '<p>Lesson</p>',
            'lms_cleared_media_fields': ['source_url', 'video_iframe_url']})
        self.assertEqual(row['payload']['quiz']['questions'][0]['correct'], 'retained')
        self.assertEqual(row['reading_iframe_url'], other)

    def test_manifest_addition_preserves_other_source_attributes(self):
        row = {'payload': {'source': {'can_embed': False, 'attachments': [{'attachment_id': 9}]}}}
        attachment = {'attachment_id': 9, 'lms_url': m.PREFIX + '_legacy_files/9/file.pdf'}
        _, patch = m.material_patch(row, {}, self.host, [attachment])
        self.assertFalse(patch['source']['can_embed'])
        self.assertEqual(patch['source']['attachments'], [attachment])
        self.assertNotIn('lms_url', row['payload']['source']['attachments'][0])

    def test_migration_keeps_string_provenance_and_stores_companions_separately(self):
        row = {'payload': {'source': 'legacy_import', 'source_reference': 'original:12'}}
        attachments = [{'attachment_id': 9, 'lms_url': m.PREFIX + '_legacy_files/9/file.pdf'}]
        fields, patch = m.material_patch(row, {}, self.host, attachments)
        self.assertEqual(fields, {})
        self.assertEqual(patch, {'lms_media_attachments': attachments})
        self.assertEqual(row['payload'], {'source': 'legacy_import', 'source_reference': 'original:12'})

    def test_serialised_component_files_preserve_order_and_metadata(self):
        url = 'https://source.example/wp-content/uploads/first.pdf'
        entries = [{'url': url, 'fileName': 'First', 'size': 20, 'contentType': 'application/pdf'},
                   {'url': 'https://outside.example/second.pdf', 'fileName': 'Second', 'size': 30}]
        result = m.replace_urls(json.dumps(entries), {m.source_key(url, self.host): {'url': '/local.pdf'}}, self.host)
        self.assertEqual(json.loads(result), [{**entries[0], 'url': '/local.pdf'}, entries[1]])

    def test_patch_is_idempotent(self):
        row = {'source_url': '/local.pdf', 'payload': {'iframe_url': '/local.pdf'}}
        self.assertEqual(m.material_patch(row, {}, self.host, []), ({}, {}))

    def test_local_quiz_does_not_restore_a_legacy_navigation_fallback(self):
        url = 'https://source.example/stm-quizzes/example/'
        row = {'content_type': 'quiz', 'source_url': url, 'reading_iframe_url': '',
               'payload': {'iframe_url': url, 'quiz': {'questions': [{'text': 'Retained'}]}}}
        _, patch = m.material_patch(row, {m.source_key(url, self.host): {'url': ''}}, self.host, [])
        self.assertIn('reading_iframe_url', patch['lms_cleared_media_fields'])
        self.assertNotIn('quiz', patch)

    def test_snapshot_cannot_publish_scripts_events_or_javascript_links(self):
        value = '<p onclick="bad()">Safe</p><script>alert(1)</script><a href="javascript:bad()">link</a><img src="/image.png" onerror="bad()">'
        self.assertEqual(m.clean_reading(value), '<p>Safe</p><a>link</a><img src="/image.png">')
        self.assertNotIn('iframe', m.clean_reading('<iframe src="https://source.example/login"></iframe>'))

    def test_file_validation_rejects_html_and_mime_mismatches(self):
        self.assertFalse(m.valid_signature('video/mp4', b'<html>Login</html>'))
        self.assertFalse(m.valid_signature('application/pdf', b'not pdf'))
        self.assertTrue(m.valid_signature('application/pdf', b'%PDF-1.7'))
        self.assertTrue(m.valid_signature('video/mp4', b'\0\0\0\x18ftypmp42'))
        self.assertTrue(m.valid_signature('image/png', b'\x89PNG\r\n'))

    def test_filenames_cannot_escape_storage_folder(self):
        self.assertEqual(m.safe_filename('../../lesson.pdf'), 'lesson.pdf')
        self.assertEqual(m.safe_filename('..%2f..%2flesson.pdf'), 'lesson.pdf')
        with self.assertRaises(ValueError):
            m.safe_filename('..')


class RangeDownloadTests(unittest.TestCase):
    @staticmethod
    def response(data, start, total, *, etag='"original"', status=206, mime='application/pdf', end=None):
        response = Mock()
        response.status_code = status
        response.headers = {'Content-Type': mime, 'Content-Length': str(len(data)), 'ETag': etag}
        if status == 206:
            response.headers['Content-Range'] = f'bytes {start}-{start + len(data) - 1 if end is None else end}/{total}'
        response.iter_content.return_value = iter([data])
        context = Mock()
        context.__enter__ = Mock(return_value=response)
        context.__exit__ = Mock(return_value=False)
        return context

    def test_incomplete_range_retries_only_that_range_without_duplicate_bytes(self):
        block = 512 * 1024
        data = b'%PDF-' + b'x' * block
        session = Mock()
        session.get.side_effect = [self.response(data[:block], 0, len(data)),
            self.response(data[block:block + 2], block, len(data), end=len(data)-1),
            self.response(data[block:], block, len(data))]
        output = io.BytesIO()
        with patch.object(m.time, 'sleep'):
            mime, size, sha = m.download_parts(session, 'https://source.example/file.pdf', output, len(data))
        self.assertEqual(output.getvalue(), data)
        self.assertEqual((mime, size, sha), ('application/pdf', len(data), hashlib.sha256(data).hexdigest()))
        self.assertEqual(session.get.call_args_list[1].kwargs['headers']['Range'],
                         session.get.call_args_list[2].kwargs['headers']['Range'])
        self.assertEqual(session.get.call_args_list[1].kwargs['headers']['If-Range'], '"original"')

    def test_changing_source_version_is_not_combined_into_one_file(self):
        block = 512 * 1024
        data = b'%PDF-' + b'x' * block
        session = Mock()
        session.get.side_effect = [self.response(data[:block], 0, len(data)),
            self.response(data[block:], block, len(data), etag='"replacement"')]
        with self.assertRaisesRegex(ValueError, 'source_changed_during_download'):
            m.download_parts(session, 'https://source.example/file.pdf', io.BytesIO(), len(data))

    def test_wrong_range_is_rejected_before_writing(self):
        session = Mock()
        session.get.return_value = self.response(b'%PDF-', 1, 6)
        output = io.BytesIO()
        with self.assertRaisesRegex(ValueError, 'invalid_content_range'):
            m.download_parts(session, 'https://source.example/file.pdf', output, 100)
        self.assertEqual(output.getvalue(), b'')

    def test_full_response_without_range_support_still_streams_correctly(self):
        data = b'%PDF-small-file'
        session = Mock()
        session.get.return_value = self.response(data, 0, len(data), status=200)
        output = io.BytesIO()
        self.assertEqual(m.download_parts(session, 'https://source.example/file.pdf', output, 100)[1], len(data))
        self.assertEqual(output.getvalue(), data)

    def test_login_page_cannot_be_saved_as_a_document(self):
        session = Mock()
        session.get.return_value = self.response(b'<html>Login</html>', 0, 18, status=200)
        output = io.BytesIO()
        with self.assertRaisesRegex(ValueError, 'invalid_file_content'):
            m.download_parts(session, 'https://source.example/file.pdf', output, 100)
        self.assertEqual(output.getvalue(), b'')


class MigrationRecoveryTests(unittest.TestCase):
    def test_provider_players_remove_wordpress_without_changing_activity_or_completion(self):
        for provider, target in [('spotify', 'https://open.spotify.com/embed/show/abc123'),
                                 ('youtube', 'https://www.youtube.com/embed/abc123xyz')]:
            with self.subTest(provider=provider):
                page = 'https://source.example/stm-lessons/example/'
                known = m.provider_reference(provider, target)
                row = {'source_url': page, 'audio_iframe_url': page, 'content_type': 'audio',
                       'payload': {'iframe_url': page, 'completion': {'threshold': 80}}}
                fields, patch = m.material_patch(row, {m.source_key(page, 'source.example'): known},
                                                'source.example', [])
                self.assertEqual(fields, {'source_url': target, 'audio_iframe_url': target})
                self.assertEqual(patch, {'iframe_url': target})
                self.assertEqual(row['payload']['completion'], {'threshold': 80})

    def test_provider_mapping_rejects_untrusted_origins_and_non_player_urls(self):
        for url in ('http://open.spotify.com/embed/show/abc', 'https://user@open.spotify.com/embed/show/abc',
                    'https://open.spotify.com.evil.example/embed/show/abc', 'https://open.spotify.com/show/abc'):
            self.assertIsNone(m.provider_reference('spotify', url))
        self.assertIsNone(m.provider_reference('unknown', 'https://open.spotify.com/embed/show/abc'))

    def test_staged_video_must_match_the_source_identity_and_downloaded_digest(self):
        source = 'https://kentbusinesscollege.sharepoint.com/sites/video/_layouts/15/embed.aspx?UniqueId=25705c9d-2b3e-4dd0-8aad-db9f0f30f929'
        identity = m.sharepoint_identity(source)
        data = b'\x00\x00\x00\x18ftypmp42' + b'video-data'
        with TemporaryDirectory() as temp:
            worker = m.Migrator.__new__(m.Migrator)
            worker.state_path = Path(temp) / 'state.json'
            worker.known = Mock(return_value=None)
            worker.upload = Mock(return_value={'blob': 'verified-video'})
            worker.save_file = Mock()
            folder = Path(temp) / 'sharepoint-staging'
            folder.mkdir()
            video = folder / (identity['unique_id'] + '.mp4')
            manifest = folder / (identity['unique_id'] + '.json')
            video.write_bytes(data)
            record = {**identity, 'mime': 'video/mp4', 'size': len(data),
                      'sha256': hashlib.sha256(data).hexdigest()}
            manifest.write_text(json.dumps({**record, 'site_path': '/sites/another'}))
            with self.assertRaisesRegex(ValueError, 'staged_source_identity_mismatch'):
                worker.staged_sharepoint_file(source)
            manifest.write_text(json.dumps(record))
            video.write_bytes(data[:-1] + b'X')
            with self.assertRaisesRegex(ValueError, 'staged_source_digest_mismatch'):
                worker.staged_sharepoint_file(source)
            worker.upload.assert_not_called()
            worker.save_file.assert_not_called()
            video.write_bytes(data)
            self.assertEqual(worker.staged_sharepoint_file(source), {'blob': 'verified-video'})
            worker.upload.assert_called_once()
            worker.save_file.assert_called_once()

    def test_sharepoint_identity_uses_exact_site_and_guid_without_token(self):
        source = 'https://kentbusinesscollege.sharepoint.com/sites/video/_layouts/15/embed.aspx?UniqueId=25705c9d-2b3e-4dd0-8aad-db9f0f30f929&token=secret'
        self.assertEqual(m.sharepoint_identity(source), {'host': 'kentbusinesscollege.sharepoint.com',
            'site_path': '/sites/video', 'unique_id': '25705c9d-2b3e-4dd0-8aad-db9f0f30f929'})
        self.assertIsNone(m.sharepoint_identity(source.replace('kentbusinesscollege.', 'outside.')))
        self.assertIsNone(m.sharepoint_identity(source.replace('UniqueId=', 'other=')))

    def test_exact_attachment_manifest_reuses_existing_file_without_filename_guessing(self):
        url = 'https://source.example/wp-content/uploads/2025/lesson.pdf'
        blob = {'blob': '_legacy_files/9/lesson.pdf', 'mime': 'application/pdf', 'url': '/local.pdf'}
        aliases = m.attachment_file_aliases([{'attachment_id': 9, 'file_url': url,
            'open_url': 'https://outside.example/lesson.pdf', 'mime_type': 'application/pdf'}],
            {'attachment:9': blob}, 'source.example')
        self.assertEqual(aliases, {m.source_key(url, 'source.example'): blob})
        self.assertNotIn(m.source_key(url.replace('/2025/', '/2026/'), 'source.example'), aliases)

    def test_attachment_alias_conflicts_and_wrong_media_are_not_reused(self):
        url = 'https://source.example/wp-content/uploads/file.pdf'
        attachments = [{'attachment_id': n, 'file_url': url, 'mime_type': 'application/pdf'} for n in (1, 2)]
        mapping = {f'attachment:{n}': {'blob': str(n), 'mime': 'application/pdf'} for n in (1, 2)}
        self.assertEqual(m.attachment_file_aliases(attachments, mapping, 'source.example'), {})
        mapping['attachment:1']['mime'] = 'video/mp4'
        self.assertEqual(m.attachment_file_aliases(attachments[:1], mapping, 'source.example'), {})

    def test_committed_aliases_recover_after_state_write_interruption(self):
        key = 'page:' + 'a' * 64
        name = '_wordpress_text/12/abc.html'
        files, conflicts = m.recovered_files([{'verified_files': {key: name}}],
            {name: {'size': 12, 'mime': 'text/html', 'sha256': 'abc'}})
        self.assertEqual(files[key]['url'], m.PREFIX + name)
        self.assertTrue(files[key]['inline'])
        self.assertEqual(conflicts, 0)

    def test_recovery_does_not_guess_ambiguous_or_missing_files(self):
        records = [{'verified_files': {'attachment:1': 'first', 'attachment:2': 'missing'}},
                   {'verified_files': {'attachment:1': 'second'}}]
        files, conflicts = m.recovered_files(records, {'first': {'size': 12, 'mime': 'application/pdf'}})
        self.assertEqual(files, {})
        self.assertEqual(conflicts, 1)

    def test_cached_alias_rejects_same_sized_replaced_blob(self):
        worker = m.Migrator.__new__(m.Migrator)
        worker.state = {'files': {'attachment:1': {'blob': 'first', 'size': 12,
            'mime': 'application/pdf', 'sha256': 'original'}}}
        worker.blobs = {'first': {'size': 12, 'mime': 'application/pdf', 'sha256': 'changed'}}
        worker.by_attachment = {'1': ['first']}
        self.assertIsNone(worker.known('attachment:1'))

    def test_metadata_retries_network_failure(self):
        import requests
        session = Mock()
        session.get.side_effect = [requests.ConnectionError(),
            RangeDownloadTests.response(b'{"id":9}', 0, 8, status=200)]
        with patch.object(m.time, 'sleep'):
            self.assertEqual(m.read_source_json(session, 'https://source.example/schema', {}), {'id': 9})
        self.assertEqual(session.get.call_count, 2)

    def test_metadata_does_not_retry_denied_or_missing_sources(self):
        import requests
        for status in (403, 404):
            with self.subTest(status=status):
                session = Mock()
                response = Mock(status_code=status)
                session.get.side_effect = requests.HTTPError(response=response)
                with self.assertRaises(requests.HTTPError):
                    m.read_source_json(session, 'https://source.example/schema', {})
                self.assertEqual(session.get.call_count, 1)

    def test_metadata_retry_remains_bounded(self):
        import requests
        session = Mock()
        session.get.side_effect = requests.Timeout()
        with patch.object(m.time, 'sleep'), self.assertRaises(requests.Timeout):
            m.read_source_json(session, 'https://source.example/schema', {})
        self.assertEqual(session.get.call_count, 3)


class AzureTransferTests(unittest.TestCase):
    def worker(self):
        worker = m.Migrator.__new__(m.Migrator)
        worker.store = Mock()
        worker.ContentSettings = Mock()
        worker.guard, worker.counts, worker.blobs = Lock(), Counter(), {}
        worker.host, worker.emit = 'source.example', Mock()
        return worker, worker.store.get_blob_client.return_value

    def test_source_probe_requires_a_strong_version_and_valid_signature(self):
        session = Mock()
        session.get.return_value = RangeDownloadTests.response(b'%PDF-small', 0, 1000)
        result = m.source_file_header(session, 'https://source.example/file.pdf', 2000, 'application/pdf')
        self.assertEqual(result['size'], 1000)
        self.assertEqual(result['head'], b'%PDF-small')
        session.get.return_value = RangeDownloadTests.response(b'%PDF-small', 0, 1000, etag='W/"weak"')
        self.assertIsNone(m.source_file_header(session, 'https://source.example/file.pdf', 2000))
        session.get.return_value = RangeDownloadTests.response(b'<html>login', 0, 1000)
        with self.assertRaisesRegex(ValueError, 'invalid_file_content'):
            m.source_file_header(session, 'https://source.example/file.pdf', 2000)

    def test_conditional_copy_checks_version_size_mime_and_destination_signature(self):
        import requests
        from azure.core import MatchConditions
        from azure.core.exceptions import ResourceNotFoundError
        worker, blob = self.worker()
        worker.requests, worker.args = requests, SimpleNamespace(max_mb=1)
        source = {'head': b'%PDF-small', 'etag': '"version-one"', 'size': 1000, 'mime': 'application/pdf'}
        def properties():
            if not blob.upload_blob_from_url.called:
                raise ResourceNotFoundError()
            return SimpleNamespace(size=1000, metadata=blob.upload_blob_from_url.call_args.kwargs['metadata'],
                                   content_settings=SimpleNamespace(content_type='application/pdf'))
        blob.get_blob_properties.side_effect = properties
        blob.download_blob.return_value.readall.return_value = source['head']
        with patch.object(m, 'source_file_header', return_value=source):
            result = worker.copy_public_file('attachment:9', 'https://source.example/wp-content/uploads/lesson.pdf', '', '')
        self.assertEqual(blob.upload_blob_from_url.call_args.kwargs['source_etag'], source['etag'])
        self.assertEqual(blob.upload_blob_from_url.call_args.kwargs['source_match_condition'], MatchConditions.IfNotModified)
        self.assertFalse(blob.upload_blob_from_url.call_args.kwargs['overwrite'])
        self.assertIsNone(result['sha256'])
        self.assertTrue(result['source_version'])
        blob.upload_blob.assert_not_called()
        blob.download_blob.return_value.readall.return_value = b'wrong file'
        with patch.object(m, 'source_file_header', return_value=source), self.assertRaisesRegex(ValueError, 'copied_signature_mismatch'):
            worker.copy_public_file('attachment:9', 'https://source.example/wp-content/uploads/lesson.pdf', '', '')

    def test_conditional_copy_does_not_accept_a_changed_source_version(self):
        import requests
        from azure.core.exceptions import ResourceModifiedError, ResourceNotFoundError
        worker, blob = self.worker()
        worker.requests, worker.args = requests, SimpleNamespace(max_mb=1)
        source = {'head': b'%PDF-small', 'etag': '"version-one"', 'size': 1000, 'mime': 'application/pdf'}
        blob.get_blob_properties.side_effect = ResourceNotFoundError()
        blob.upload_blob_from_url.side_effect = ResourceModifiedError()
        with patch.object(m, 'source_file_header', return_value=source):
            self.assertIsNone(worker.copy_public_file('attachment:9', 'https://source.example/wp-content/uploads/lesson.pdf', '', ''))
        self.assertEqual(worker.blobs, {})
        blob.download_blob.assert_not_called()

    def test_server_copy_validates_source_bytes_and_never_overwrites(self):
        from azure.core.exceptions import ResourceNotFoundError
        worker, blob = self.worker()
        data = b'%PDF-verified'
        sha = hashlib.sha256(data).hexdigest()
        blob.get_blob_properties.side_effect = [ResourceNotFoundError(),
            SimpleNamespace(size=len(data), metadata={'sha256': sha})]
        result = worker.upload(io.BytesIO(data), 'asset.pdf', 'application/pdf', len(data), sha,
                               source_url='https://source.example/wp-content/uploads/asset.pdf')
        self.assertEqual(result['sha256'], sha)
        self.assertEqual(blob.upload_blob_from_url.call_args.kwargs['source_content_md5'], hashlib.md5(data).digest())
        self.assertFalse(blob.upload_blob_from_url.call_args.kwargs['overwrite'])
        blob.upload_blob.assert_not_called()

    def test_existing_verified_copy_is_reused_without_uploading_again(self):
        worker, blob = self.worker()
        blob.get_blob_properties.return_value = SimpleNamespace(size=12, metadata={'sha256': 'same'})
        worker.upload(b'%PDF-archive', 'asset.pdf', 'application/pdf', 12, 'same')
        blob.upload_blob.assert_not_called()
        blob.upload_blob_from_url.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'upload_verification_failed'):
            worker.upload(b'different', 'asset.pdf', 'application/pdf', 9, 'different')
        blob.upload_blob.assert_not_called()

    def test_copy_failure_can_use_only_the_already_verified_download(self):
        from azure.core.exceptions import HttpResponseError, ResourceNotFoundError
        worker, blob = self.worker()
        data = io.BytesIO(b'%PDF-verified')
        sha = hashlib.sha256(data.getvalue()).hexdigest()
        blob.get_blob_properties.side_effect = [ResourceNotFoundError(), ResourceNotFoundError(),
            SimpleNamespace(size=13, metadata={'sha256': sha})]
        blob.upload_blob_from_url.side_effect = HttpResponseError()
        worker.upload(data, 'asset.pdf', 'application/pdf', 13, sha,
                      source_url='https://source.example/wp-content/uploads/asset.pdf')
        self.assertEqual(data.tell(), 0)
        self.assertFalse(blob.upload_blob.call_args.kwargs['overwrite'])
        self.assertEqual(worker.emit.call_args.kwargs['stage'], 'server_copy_fallback')


if __name__ == '__main__':
    unittest.main()
