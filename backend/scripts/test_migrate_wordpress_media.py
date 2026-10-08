"""Isolated transfer planning and content safety tests; no DB or live services."""
import importlib.util
from pathlib import Path
import unittest

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
        self.assertEqual(m.source_key(first.replace('source.example', 'outside.example'), self.host), '')
        self.assertEqual(m.source_key(first.replace('source.example', 'user@source.example'), self.host), '')

    def test_source_urls_do_not_authorize_other_origins_or_attachment_pages(self):
        self.assertEqual(m.source_key('https://source.example/lesson/?attachment_id=9', self.host)[:5], 'page:')
        self.assertEqual(m.source_key('https://outside.example/wp-content/uploads/video.mp4', self.host), '')

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


if __name__ == '__main__':
    unittest.main()
