from unittest.mock import patch

from django.test import SimpleTestCase

from .media_proxy import (
    _embedded_kbc_media_url,
    _programme_audit_database_aliases,
    _raw_http_urls,
)


class ProgrammeAuditMediaFallbackTests(SimpleTestCase):
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
