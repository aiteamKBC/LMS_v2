from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from .media_proxy import (
    _embedded_kbc_media_url,
    _legacy_upload_path_from_hint,
    _load_legacy_attachment_bytes,
    _programme_audit_database_aliases,
    _raw_http_urls,
)


class ProgrammeAuditMediaFallbackTests(SimpleTestCase):
    def test_accepts_upload_hint_for_the_same_legacy_attachment(self):
        source = (
            '/curriculum_api/curriculum/uploads/_legacy_files/80352/'
            'Commercial-Intelligence-1.pptx.pdf'
        )

        self.assertEqual(
            _legacy_upload_path_from_hint('80352', source),
            '_legacy_files/80352/Commercial-Intelligence-1.pptx.pdf',
        )

    def test_rejects_upload_hint_for_another_attachment_or_unsafe_path(self):
        other = '/curriculum_api/curriculum/uploads/_legacy_files/999/file.pdf'
        traversal = '/curriculum_api/curriculum/uploads/_legacy_files/80352/../file.pdf'

        self.assertEqual(_legacy_upload_path_from_hint('80352', other), '')
        self.assertEqual(_legacy_upload_path_from_hint('80352', traversal), '')

    @patch('learner_api.media_proxy.connections')
    def test_prefers_dedicated_audit_database_with_legacy_fallbacks(self, mocked_connections):
        mocked_connections.databases = {'audit': {}, 'enrolment': {}, 'default': {}}

        self.assertEqual(
            _programme_audit_database_aliases(),
            ('audit', 'enrolment', 'default'),
        )

    @patch('learner_api.media_proxy.connections')
    def test_skips_database_aliases_that_are_not_configured(self, mocked_connections):
        mocked_connections.databases = {'default': {}}

        self.assertEqual(_programme_audit_database_aliases(), ('default',))

    def test_extracts_original_kbc_file_from_new_material_table_payload(self):
        raw = {
            'settings': {
                'readingContent': (
                    '<a href="https://kentbusinesscollege.org/'
                    'wp-content/uploads/2026/07/handout.pdf">File</a>'
                ),
            },
        }

        self.assertEqual(
            list(_raw_http_urls(raw)),
            ['https://kentbusinesscollege.org/wp-content/uploads/2026/07/handout.pdf'],
        )

    def test_does_not_turn_untrusted_imported_urls_into_server_side_fetches(self):
        raw = {'settings': {'readingContent': 'https://example.test/private.pdf'}}

        self.assertEqual(list(_raw_http_urls(raw)), [])

    def test_extracts_matching_audio_from_trusted_kbc_embed_wrapper(self):
        page = (
            '<audio><source src="https://kentbusinesscollege.org/wp-json/kbc-lms/v1/'
            'material/12/view?attachment_id=34&#038;token=signed" type="audio/mpeg"></audio>'
        )

        self.assertEqual(
            _embedded_kbc_media_url(page, '34'),
            'https://kentbusinesscollege.org/wp-json/kbc-lms/v1/material/12/view?attachment_id=34&token=signed',
        )

    def test_rejects_embed_source_for_another_attachment_or_host(self):
        wrong_id = '<source src="https://kentbusinesscollege.org/file?attachment_id=99">'
        wrong_host = '<source src="https://example.test/file?attachment_id=34">'

        self.assertEqual(_embedded_kbc_media_url(wrong_id, '34'), '')
        self.assertEqual(_embedded_kbc_media_url(wrong_host, '34'), '')


class LegacyAttachmentPlaceholderTests(SimpleTestCase):
    """Some imported files are zero-byte placeholders; the original still exists."""

    def test_zero_byte_copy_falls_back_to_the_original_source(self):
        upstream = Mock(headers={'Content-Type': 'application/pdf'})
        upstream.read.return_value = b'%PDF-real'
        with patch('learner_api.media_proxy._legacy_attachment_upload_path', return_value='_legacy_files/7/a.pdf'), \
                patch('learner_api.media_proxy.upload_storage.open_stream', return_value=(iter([]), 0, 'application/pdf')), \
                patch('learner_api.media_proxy._open_legacy_attachment', return_value=upstream):
            data, error = _load_legacy_attachment_bytes('7')

        self.assertIsNone(error)
        self.assertEqual(data, b'%PDF-real')

    def test_a_real_stored_copy_is_used_without_fetching_the_original(self):
        with patch('learner_api.media_proxy._legacy_attachment_upload_path', return_value='_legacy_files/7/a.pdf'), \
                patch('learner_api.media_proxy.upload_storage.open_stream', return_value=(iter([b'%PDF-', b'ok']), 7, 'application/pdf')), \
                patch('learner_api.media_proxy._open_legacy_attachment') as original:
            data, error = _load_legacy_attachment_bytes('7')

        self.assertIsNone(error)
        self.assertEqual(data, b'%PDF-ok')
        original.assert_not_called()

    def test_the_legacy_routes_are_routed(self):
        from django.urls import reverse

        self.assertEqual(reverse('legacy-attachment-media', args=['42']), '/learner_api/media/legacy-attachment/42/')
        self.assertEqual(reverse('legacy-attachment-pdf-page', args=['42', 3]), '/learner_api/media/legacy-attachment/42/pdf-page/3/')
