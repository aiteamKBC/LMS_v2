"""Authored component HTML survives the curriculum save path unchanged.

Database-free: covers the serialiser the module save writes settings_json
with, and the guards that stop a partial read from erasing content.
"""
import json

from django.test import SimpleTestCase

from . import views

READING_HTML = ("<h2 class='title'>Week 1</h2><p>Line<br/>two &amp; more</p><ol><li>One</li></ol>"
                "<p><a href=\"/curriculum_api/curriculum/uploads/2026/notes.pdf\" target=\"_blank\">Notes (PDF)</a></p>"
                "<table><tr><td style=\"color:red\">1 week&lt;US$100K</td></tr></table>"
                "<iframe src=\"https://www.youtube.com/embed/abc\" allowfullscreen=\"allowfullscreen\"></iframe>"
                "<p dir=\"rtl\">نص عربي</p>")
LESSON_HTML = "<h3>Watch for</h3><ul><li>Point <strong>one</strong></li></ul>"


class ComponentHtmlStorageTests(SimpleTestCase):
    def test_settings_json_round_trips_html_byte_for_byte(self):
        settings = {'readingContent': READING_HTML, 'lessonContent': LESSON_HTML,
                    'shortDescription': 'Plain & simple < 5', 'videoUrl': 'https://youtu.be/abc'}
        stored = views.json_db_value(settings)
        self.assertEqual(json.loads(stored), settings)

    def test_list_reads_that_trim_content_name_it_and_cannot_be_saved_back(self):
        row = {'id': 'COMP-1', 'settings': {'readingContent': READING_HTML, 'lessonContent': LESSON_HTML,
                                            'videoUrl': 'https://youtu.be/abc'}}
        [trimmed] = views.component_rows_without_content([row])
        self.assertEqual(sorted(trimmed['settingsOmitted']), ['lessonContent', 'readingContent'])
        self.assertEqual(trimmed['settings'], {'videoUrl': 'https://youtu.be/abc'})
        # The shared cached row is copied, not edited.
        self.assertEqual(row['settings']['readingContent'], READING_HTML)
        # Saving the trimmed copy is refused rather than wiping the HTML.
        errors = views.partial_read_errors(trimmed)
        self.assertEqual([error['path'] for error in errors], ['settings'])

    def test_full_rows_are_not_flagged(self):
        row = {'id': 'COMP-2', 'settings': {'readingContent': READING_HTML}}
        self.assertEqual(views.partial_read_errors(row), [])
