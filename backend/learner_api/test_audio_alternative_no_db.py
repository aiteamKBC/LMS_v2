"""Native serializer and mocked reader: no database or provider access."""
import json
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from curriculum_api.views import normalise_component_settings_payload
from . import learner_detail
from .audio_alternative import audio_alternative_projection
from .tests_weekly_learning import FakeCursor


class AudioAlternativeTests(SimpleTestCase):
    def test_native_save_keeps_primary_media_and_alternative(self):
        mp3 = 'https://kentbusinesscollege.org/audio.mp3'
        youtube = 'https://youtu.be/abcdefghijk'
        for metadata in ({'alternativeYouTubeUrl': youtube},
                         {'legacySettings': json.dumps({'alternativeYouTubeUrl': youtube})}):
            first = normalise_component_settings_payload('podcast', {'podcastUrl': mp3, **metadata})
            second = normalise_component_settings_payload('podcast', first)
            self.assertEqual(first, second)
            self.assertEqual(second['podcastUrl'], mp3)
            self.assertEqual(audio_alternative_projection(second, 'podcast', mp3),
                             {'alternativeYouTubeUrl': 'https://www.youtube.com/watch?v=abcdefghijk'})

    def test_full_and_compact_native_reader_keep_exact_identity_and_primary_audio(self):
        class Cursor(FakeCursor):
            def execute(self, sql, params=None):
                super().execute(sql, params)
                if 'FROM curriculum.components WHERE' in sql:
                    self.rows = [('A1', 'W1', 'M1', 'podcast', 'Listen', '', json.dumps({
                        'podcastUrl': 'https://kentbusinesscollege.org/audio.mp3',
                        '_audioAlternativeLegacy': json.dumps({'alternativeYouTubeUrl': 'https://youtu.be/abcdefghijk'})}),
                        None, 1, None, False, None, False, 1.5)]
        for options in ({}, {'compact': True}, {'compact': True, 'compact_content': True}):
            connection = MagicMock()
            connection.cursor.return_value = Cursor()
            with patch.object(learner_detail, 'connections', {'enrolment': connection}):
                _, _, rows = learner_detail._resolve_from_master([], [], [], assigned_modules=[{'moduleId': 'M1'}], **options)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['componentId'], 'A1')
            self.assertEqual(rows[0]['type'], 'podcast')
            self.assertEqual(rows[0]['audioUrl'], 'https://kentbusinesscollege.org/audio.mp3')
            self.assertEqual(rows[0]['alternativeYouTubeUrl'], 'https://www.youtube.com/watch?v=abcdefghijk')
            self.assertNotIn('_audioAlternativeLegacy', json.dumps(rows))
