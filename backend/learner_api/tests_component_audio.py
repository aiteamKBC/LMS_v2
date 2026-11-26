"""Which components offer a learner an audio player.

    python manage.py test learner_api.tests_component_audio

The bug this pins: every imported reading with an attached PDF rendered an
"AUDIO VERSION" player under it, stuck at 0:00, because the learner payload
treated ``uploadedFileUrl`` — the generic "file attached to this component" key
— as audio regardless of what the file was.
"""
from django.test import SimpleTestCase

from learner_api.learner_detail import component_audio_url


class ComponentAudioTests(SimpleTestCase):
    def test_a_reading_with_an_attached_document_offers_no_audio(self):
        for suffix in ('.pdf', '.docx', '.pptx', '.xlsx'):
            self.assertIsNone(
                component_audio_url({'uploadedFileUrl': f'/uploads/handout{suffix}'}, 'reading'),
                suffix,
            )

    def test_a_podcast_upload_is_audio_whatever_it_is_called(self):
        # A podcast's file is its audio by definition; the suffix may be absent
        # or unusual on an uploaded file.
        self.assertEqual(
            component_audio_url({'uploadedFileUrl': '/uploads/episode'}, 'podcast'),
            '/uploads/episode',
        )

    def test_an_audio_file_on_any_component_is_audio(self):
        """A reading with a recorded version of itself is a real case."""
        for suffix in ('.mp3', '.m4a', '.wav', '.ogg', '.flac'):
            self.assertEqual(
                component_audio_url({'uploadedFileUrl': f'/uploads/read-aloud{suffix}'}, 'reading'),
                f'/uploads/read-aloud{suffix}',
            )

    def test_the_suffix_is_read_past_a_query_string(self):
        self.assertEqual(
            component_audio_url({'uploadedFileUrl': '/uploads/a.mp3?token=abc'}, 'reading'),
            '/uploads/a.mp3?token=abc',
        )

    def test_an_explicit_audio_url_always_wins(self):
        self.assertEqual(
            component_audio_url(
                {'podcastUrl': 'https://example.test/show', 'uploadedFileUrl': '/uploads/a.pdf'},
                'reading',
            ),
            'https://example.test/show',
        )
        self.assertEqual(
            component_audio_url({'audioUrl': 'https://example.test/clip.mp3'}, 'reading'),
            'https://example.test/clip.mp3',
        )

    def test_nothing_configured_is_no_player(self):
        for settings in ({}, None, {'uploadedFileUrl': ''}, {'podcastUrl': '   '}):
            self.assertIsNone(component_audio_url(settings, 'reading'), settings)
