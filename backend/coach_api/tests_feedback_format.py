from django.test import SimpleTestCase

from .feedback_format import feedback_plain_text, sanitize_feedback


class FeedbackFormatTests(SimpleTestCase):
    def test_supported_markup_survives_server_sanitization(self):
        value = sanitize_feedback('<h3>Next steps</h3><ul><li><strong>Measure results</strong></li></ul>')
        self.assertIn('<h3>Next steps</h3>', value)
        self.assertIn('<strong>Measure results</strong>', value)

    def test_scripts_and_attributes_are_removed(self):
        value = sanitize_feedback('<p onclick="alert(1)">Safe</p><script>alert(2)</script>')
        self.assertNotIn('onclick', value)
        self.assertNotIn('<script', value)
        self.assertEqual(feedback_plain_text(value), 'Safe')

    def test_plain_feedback_remains_plain_text_compatible(self):
        self.assertEqual(sanitize_feedback('Line one\nLine two'), 'Line one\nLine two')
        self.assertEqual(feedback_plain_text('<p>One</p><p>Two</p>'), 'One Two')
