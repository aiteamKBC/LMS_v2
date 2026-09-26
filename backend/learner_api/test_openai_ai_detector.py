"""Run with unittest: no Django setup, database, or network. The OpenAI client is a fake."""
import json
import unittest
from types import SimpleNamespace
from . import openai_ai_detector as detector
from .local_ai_detector import DetectorUnavailable


class FakeClient:
    def __init__(self, output):
        self.output, self.calls = output, []
        self.responses = SimpleNamespace(create=self._create)

    def with_options(self, **options):
        self.options = options
        return self

    def _create(self, **request):
        self.calls.append(request)
        return SimpleNamespace(output_text=self.output if isinstance(self.output, str) else json.dumps(self.output))


def passages(*flags):
    return {'passages': [{'number': n, 'likely_ai': f} for n, f in enumerate(flags, 1)]}


class OpenAiDetectorTests(unittest.TestCase):
    def test_short_text_does_not_call_openai(self):
        client = FakeClient(passages())
        result = detector.check_text('brief answer', client=client, model='test-model')
        self.assertEqual(result['status'], 'insufficient_text')
        self.assertEqual(client.calls, [])

    def test_mixed_passages_preserve_all_text_and_utf16_offsets(self):
        text = '\U0001f600 ' + 'learning ' * 360
        client = FakeClient(passages(True, False))
        result = detector.check_text(text, client=client, model='test-model')
        self.assertEqual(result['status'], 'review_suggested')
        self.assertTrue(result['advisoryOnly'])
        segments = result['segments']
        self.assertEqual([s['flagged'] for s in segments], [True, False])
        self.assertEqual(segments[0]['start'], 0)
        self.assertEqual(segments[0]['end'], segments[1]['start'])
        self.assertEqual(segments[-1]['end'], len(text.encode('utf-16-le')) // 2)
        request = client.calls[0]
        self.assertEqual(request['model'], 'test-model')
        self.assertTrue(request['text']['format']['strict'])
        self.assertIn('<passage number="2">', request['input'][1]['content'])
        self.assertEqual(client.options['timeout'], detector.REQUEST_TIMEOUT_SECONDS)

    def test_no_flags_is_no_signal(self):
        result = detector.check_text('word ' * 100, client=FakeClient(passages(False)), model='m')
        self.assertEqual(result['status'], 'no_signal')

    def test_incomplete_or_invalid_output_is_never_a_result(self):
        text = 'learning ' * 360
        for output in (passages(True), passages(True, False, False), 'not json', {'other': []},
                       {'passages': [{'number': 1, 'likely_ai': True}, {'number': 1, 'likely_ai': False}]},
                       {'passages': [{'number': 1, 'likely_ai': 'yes'}, {'number': 2, 'likely_ai': False}]}):
            with self.subTest(output=output), self.assertRaises(DetectorUnavailable):
                detector.check_text(text, client=FakeClient(output), model='m')

    def test_invalid_inputs(self):
        for text in (None, '', 'x' * 24001):
            with self.assertRaises(ValueError):
                detector.check_text(text, client=FakeClient(passages()), model='m')
