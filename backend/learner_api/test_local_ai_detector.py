"""Run with unittest: no Django setup, database, model download, or network."""
import unittest
from . import local_ai_detector as detector


class LocalDetectorTests(unittest.TestCase):
    def test_short_text_is_not_a_clean_result(self):
        result = detector.check_text('brief answer', predict=lambda _: self.fail('must not infer'))
        self.assertEqual(result['status'], 'insufficient_text')

    def test_mixed_windows_preserve_all_text_and_utf16_offsets(self):
        text = '\U0001f600 ' + 'learning ' * 360
        scores = iter([.9, .1])
        result = detector.check_text(text, predict=lambda _: next(scores))
        self.assertEqual(result['status'], 'review_suggested')
        self.assertTrue(result['advisoryOnly'])
        segments = result['segments']
        self.assertEqual([s['flagged'] for s in segments], [True, False])
        self.assertEqual(segments[0]['start'], 0)
        self.assertEqual(segments[0]['end'], segments[1]['start'])
        self.assertEqual(segments[-1]['end'], len(text.encode('utf-16-le')) // 2)

    def test_unassessable_window_does_not_report_partial_success(self):
        result = detector.check_text('word ' * 100, predict=lambda _: None)
        self.assertEqual(result['status'], 'unsupported_text')
        self.assertEqual(result['segments'], [])

    def test_invalid_score_releases_lock(self):
        with self.assertRaises(detector.DetectorUnavailable):
            detector.check_text('word ' * 100, predict=lambda _: float('nan'))
        self.assertEqual(detector.check_text('word ' * 100, predict=lambda _: .1)['status'], 'no_signal')

    def test_busy_does_not_start_inference(self):
        detector._lock.acquire()
        try:
            with self.assertRaises(detector.DetectorBusy):
                detector.check_text('word ' * 100, predict=lambda _: self.fail('busy'))
        finally:
            detector._lock.release()

    def test_invalid_inputs(self):
        for text in (None, '', 'x' * 24001):
            with self.assertRaises(ValueError):
                detector.check_text(text)
