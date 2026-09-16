"""Pure media rules and AST-loaded archive upsert. No Django setup or database."""
import hashlib
import json
import types
import unittest
from contextlib import nullcontext
from unittest.mock import Mock, patch

from test_session_results_no_db import ROOT, functions
from curriculum_api.session_media_policy import hidden_artifact_ids, recordings_for_transcript, recording_transcript_links
from curriculum_api.session_transcripts import parse_vtt_cues
from curriculum_api.session_results_policy import instant


class MediaPolicyTests(unittest.TestCase):
    def test_vtt_retains_timestamps_speakers_and_unicode_without_html(self):
        cues = parse_vtt_cues('WEBVTT\n\nNOTE ignored\nnot speech\n\ncue-1\n00:00:01.500 --> 00:00:03.750 align:start\n<v Tutor>Hi &amp; <b>مرحبا</b></v>\n\n00:04.000 --> 00:06.000\nSecond line\ncontinued')
        self.assertEqual(cues, [
            {'start': 1.5, 'end': 3.75, 'speaker': 'Tutor', 'text': 'Hi & مرحبا'},
            {'start': 4, 'end': 6, 'speaker': '', 'text': 'Second line\ncontinued'},
        ])

    def test_invalid_times_are_not_invented_and_duplicates_do_not_repeat(self):
        cue = '01:02:03.000 --> 01:02:04.000\nValid'
        self.assertEqual(len(parse_vtt_cues(f'WEBVTT\n\n{cue}\n\n{cue}\n\n00:00:04.000 --> 00:00:01.000\nInvalid')), 1)
        with self.assertRaises(ValueError):
            parse_vtt_cues('Plain text without timestamps')

    def test_pairing_offsets_early_transcription_to_the_recording_start(self):
        recording = {'id': 'V', 'artifact_type': 'recording', 'content_correlation_id': 'PAIR', 'created_datetime': '2026-09-16T09:02Z'}
        transcript = {'id': 'T', 'artifact_type': 'transcript', 'content_correlation_id': 'PAIR', 'created_datetime': '2026-09-16T09:00Z',
            'metadata': {'lmsTranscriptTimeline': {'version': 1, 'cues': []}}}
        self.assertEqual(recording_transcript_links(recording, [recording, transcript]), [{'id': 'T', 'timingReady': True, 'offsetSeconds': -120}])
        transcript['created_datetime'] = None
        self.assertIsNone(recording_transcript_links(recording, [recording, transcript])[0]['offsetSeconds'])

    def test_negative_graph_offsets_remain_available_for_recording_alignment(self):
        cues = parse_vtt_cues('WEBVTT\n\n-00:00:02.000 --> 00:00:01.000\nSpeech around transcription start')
        self.assertEqual(cues[0]['start'], -2)
        self.assertEqual(cues[0]['end'], 1)

    def test_different_explicit_correlations_cannot_pair_through_call_fallback(self):
        recording = {'id': 'V', 'content_correlation_id': 'first', 'call_id': 'CALL',
                     'created_datetime': '2026-09-16T09:00Z', 'end_datetime': '2026-09-16T09:10Z'}
        transcript = {**recording, 'id': 'T', 'content_correlation_id': 'second'}
        self.assertEqual(recordings_for_transcript(transcript, [recording]), [])

    def test_explicit_correlation_does_not_follow_array_order_or_another_run(self):
        rows = [{'id': 'V2', 'artifact_type': 'recording', 'content_correlation_id': 'second'},
                {'id': 'V1', 'artifact_type': 'recording', 'content_correlation_id': 'first', 'metadata': {'lmsHiddenFromLearners': True}},
                {'id': 'T1', 'artifact_type': 'transcript', 'content_correlation_id': 'first'},
                {'id': 'T2', 'artifact_type': 'transcript', 'content_correlation_id': 'second'}]
        self.assertEqual(hidden_artifact_ids(rows), {'V1', 'T1'})
        self.assertEqual(recordings_for_transcript(rows[2], rows[:2]), [rows[1]])

    def test_ambiguous_transcript_is_withheld_if_it_could_expose_hidden_speech(self):
        self.assertEqual(hidden_artifact_ids([
            {'id': 'V', 'artifact_type': 'recording', 'metadata': '{"lmsHiddenFromLearners":true}'},
            {'id': 'T', 'artifact_type': 'transcript'},
        ]), {'V', 'T'})

    def test_same_call_pairs_only_overlapping_segments(self):
        rows = [{'id': 'V1', 'call_id': 'CALL', 'created_datetime': '2026-09-16T09:00Z', 'end_datetime': '2026-09-16T09:10Z'},
                {'id': 'V2', 'call_id': 'CALL', 'created_datetime': '2026-09-16T09:20Z', 'end_datetime': '2026-09-16T09:30Z'}]
        transcript = {'call_id': 'CALL', 'created_datetime': '2026-09-16T09:00Z', 'end_datetime': '2026-09-16T09:09Z'}
        self.assertEqual(recordings_for_transcript(transcript, rows), rows[:1])

    def test_graph_refresh_preserves_staff_visibility_under_row_lock(self):
        cursor = Mock(); cursor.__enter__ = Mock(return_value=cursor); cursor.__exit__ = Mock(return_value=False)
        timeline = {'version': 1, 'cues': [{'start': 1, 'end': 2, 'text': 'Saved'}]}
        cursor.fetchone.return_value = ({'lmsHiddenFromLearners': True, 'lmsTranscriptTimeline': timeline},)
        ns = {'hashlib': hashlib, 'clean_str': lambda value: str(value or ''), 'parse_graph_datetime': instant,
              'json_db_value': lambda value: value, 'parse_json_value': lambda value, default: value or default,
              'LIVE_SESSION_ARTIFACTS_TABLE': 'live_session_artifacts', 'authoring_table_name': lambda name: name,
              'authoring_upsert': Mock(), 'transaction': types.SimpleNamespace(atomic=nullcontext),
              'connection': types.SimpleNamespace(vendor='postgresql', cursor=lambda: cursor)}
        functions(ROOT / 'views.py', {'upsert_live_session_artifact'}, ns)
        self.assertTrue(ns['upsert_live_session_artifact']({'id': 'O'}, 'recording', {'id': 'G', 'lmsHiddenFromLearners': False}))
        self.assertIn('FOR UPDATE', cursor.execute.call_args.args[0])
        saved = ns['authoring_upsert'].call_args.args[2]
        self.assertTrue(saved['metadata']['lmsHiddenFromLearners'])
        self.assertEqual(saved['metadata']['lmsTranscriptTimeline'], timeline)
        self.assertEqual(saved['occurrence_id'], 'O')
        self.assertEqual(saved['graph_artifact_id'], 'G')


if __name__ == '__main__':
    with patch('socket.socket', side_effect=AssertionError('Network forbidden')):
        unittest.main(verbosity=2)
